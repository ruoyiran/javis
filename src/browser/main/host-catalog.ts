import { BrowserError } from "../source/main/browser/browser-error";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import { z } from "zod";
import {
  KnownRuntimeEnvironmentSchema,
  type KnownRuntimeEnvironment,
} from "../source/shared/remote-runtime/host-catalog/runtime-environments";
import { prepareBrowserClientHostPlacement } from "../source/main/browser/client-hosts/lifecycle/browser-client-host-placement-preparation";
import {
  startPairedRuntimeBrowserClientHost,
  closePairedRuntimeBrowserClientHostEnvironment,
  invokePairedRuntimeBrowser,
} from "../source/main/browser/client-hosts/lifecycle/paired-runtime-browser-client-host-runtime";
import { BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES } from "../source/shared/browser/client-hosting/browser-client-hosting-eligibility";
import { BROWSER_SCREENCAST_RUNTIME_CAPABILITY } from "../source/shared/browser/runtime/browser-runtime-capabilities";
import type { BrowserHostBridge } from "./host-bridge";
import type { BrowserClientHostPlacementPreference } from "../source/shared/browser/client-hosting/browser-client-host-placement";
const ExtraContext = z.object({
  context: z.string().min(1),
  nativeContext: z.string().min(1),
  root: z
    .string()
    .min(1)
    .refine((path) => posix.isAbsolute(path) || win32.isAbsolute(path)),
});
const Host = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .refine((value) => value !== "local"),
  alias: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/)
    .refine((value) => value !== "local"),
  name: z.string().min(1),
  revision: z.number().int().positive(),
  context: z.string().min(1),
  nativeContext: z.string().min(1),
  contexts: z.array(ExtraContext).default([]),
  root: z
    .string()
    .min(1)
    .refine((path) => posix.isAbsolute(path) || win32.isAbsolute(path)),
});
const Engine = z.object({
  running: z.literal(true),
  hostInstanceId: z.string().min(1),
  runtimeId: z.string().min(1),
  startedAt: z.number().int(),
  protocolVersion: z.literal(1),
  capabilities: z.array(z.string()).default([]),
});
type HostEntry = z.infer<typeof Host>;
export class BrowserHostCatalog {
  private hosts: HostEntry[] = [];
  private statuses = new Map<string, ReturnType<typeof Engine.parse>>();
  private readonly path: string;
  constructor(
    directory: string,
    private readonly bridge: BrowserHostBridge,
    private readonly changed: () => void,
    private readonly contactRestored: (id: string) => void = () => {},
  ) {
    this.path = join(directory, "hosts.json");
    try {
      this.hosts = z
        .array(Host)
        .parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.routes();
  }
  list() {
    return this.hosts.map((host) => ({
      ...host,
      available: this.statuses.has(host.id),
      runtimeId: this.statuses.get(host.id)?.runtimeId ?? null,
    }));
  }
  async register(input: unknown) {
    const args = Host.omit({
      revision: true,
      nativeContext: true,
      contexts: true,
    }).parse(input);
    if (args.context.startsWith("cwd:") && args.context.slice(4) !== args.root)
      throw new Error("Browser context root must match its remote folder");
    const prior = this.hosts.find((host) => host.id === args.id);
    if (prior) await closePairedRuntimeBrowserClientHostEnvironment(prior.id);
    this.hosts = this.hosts.filter((host) => host.id !== args.id);
    this.hosts.push({
      ...args,
      contexts: [],
      nativeContext: args.context.startsWith("cwd:")
        ? args.context
        : `cwd:${args.root}`,
      revision: Math.max(Date.now(), (prior?.revision ?? 0) + 1),
    });
    this.persist();
    this.routes();
    await this.probe(args.id).catch(() => {});
    this.changed();
    return this.list();
  }
  async remove(id: string) {
    await closePairedRuntimeBrowserClientHostEnvironment(id);
    this.hosts = this.hosts.filter((host) => host.id !== id);
    this.statuses.delete(id);
    this.persist();
    this.routes();
    this.changed();
    return this.list();
  }
  private host(id: string) {
    const host = this.hosts.find((host) => host.id === id);
    if (!host)
      throw new BrowserError(
        "browser_host_unavailable",
        "The SSH browser host is not registered",
      );
    return host;
  }
  environment(id: string): KnownRuntimeEnvironment {
    const host = this.host(id);
    return KnownRuntimeEnvironmentSchema.parse({
      id: host.id,
      name: host.name,
      createdAt: host.revision,
      updatedAt: host.revision,
      pairingRevision: host.revision,
      lastUsedAt: null,
      runtimeId: this.statuses.get(id)?.runtimeId ?? null,
      javisSsh: {
        alias: host.alias,
        hostInstanceId: this.statuses.get(id)?.hostInstanceId,
      },
      endpoints: [],
      preferredEndpointId: "ssh",
    });
  }
  environments() {
    return this.hosts.map((host) => this.environment(host.id));
  }
  contextId(id: string, context?: string) {
    const host = this.host(id);
    return `runtime:${encodeURIComponent(id)}::${encodeURIComponent(context ?? host.context)}`;
  }
  contexts() {
    return this.hosts.flatMap((host) =>
      [
        {
          context: host.context,
          nativeContext: host.nativeContext,
          root: host.root,
        },
        ...host.contexts,
      ].map((row) => ({
        id: this.contextId(host.id, row.context),
        root: row.root,
        label: host.name,
        owner: { kind: "runtime" as const, environmentId: host.id },
        available: this.statuses.has(host.id),
      })),
    );
  }
  hostForContext(context: string) {
    return this.hosts.find((host) =>
      [host.context, ...host.contexts.map((row) => row.context)].some(
        (native) => this.contextId(host.id, native) === context,
      ),
    );
  }
  async registerContext(input: unknown) {
    const args = z
      .object({
        id: z.string(),
        context: z.string().min(1),
        root: z
          .string()
          .refine((path) => posix.isAbsolute(path) || win32.isAbsolute(path)),
      })
      .parse(input);
    const host = this.host(args.id);
    if (
      args.context === host.context ||
      host.contexts.some((row) => row.context === args.context)
    )
      throw new Error("Browser context is already registered");
    host.contexts.push({
      context: args.context,
      nativeContext: `cwd:${args.root}`,
      root: args.root,
    });
    this.persist();
    this.changed();
    return this.contexts();
  }
  nativeParams(id: string, params: unknown) {
    if (!params || typeof params !== "object") return params;
    const host = this.host(id),
      values = { ...params } as Record<string, unknown>;
    if (
      typeof values.worktree === "string" &&
      values.worktree.replace(/^id:/, "") === this.contextId(id)
    )
      values.worktree = `id:${host.nativeContext}`;
    for (const row of host.contexts)
      if (
        typeof values.worktree === "string" &&
        values.worktree.replace(/^id:/, "") === this.contextId(id, row.context)
      )
        values.worktree = `id:${row.nativeContext}`;
    return values;
  }
  async probe(id: string) {
    const host = this.host(id);
    try {
      const response = await this.bridge.call(host.alias, "browser.status", {});
      if (!response.ok)
        throw new BrowserError(
          response.error.code,
          response.error.message,
          response.error.data,
        );
      const status = Engine.parse(response.result);

      const reconnected = !this.statuses.has(id);
      this.statuses.set(id, status);
      if (reconnected) this.contactRestored(id);
      this.changed();
      return status;
    } catch (error) {
      this.statuses.delete(id);

      this.changed();
      throw error;
    }
  }
  statusSnapshots() {
    return this.hosts.map((host) => ({
      environmentId: host.id,
      status: this.statuses.has(host.id)
        ? {
            runtimeId: this.statuses.get(host.id)!.runtimeId,
            graphStatus: "ready" as const,
            deviceScope: "runtime" as const,
            capabilities: this.statuses.get(host.id)!.capabilities,
          }
        : null,
      connected: this.statuses.has(host.id),
    }));
  }
  async prepare(args: {
    selector: string;
    preference: BrowserClientHostPlacementPreference;
    expectedPairingRevision?: number;
  }) {
    return prepareBrowserClientHostPlacement({
      ...args,
      enabled: true,
      resolveEnvironment: (id) => this.environment(id),
      getStatus: async (id) => {
        const status = await this.probe(id);
        return {
          id: "status",
          ok: true as const,
          result: {
            runtimeId: status.runtimeId,
            graphStatus: "ready" as const,
            deviceScope: "runtime" as const,
            capabilities: [
              ...BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
              BROWSER_SCREENCAST_RUNTIME_CAPABILITY,
            ].filter((cap) => status.capabilities.includes(cap)),
          },
          _meta: { runtimeId: status.runtimeId },
        };
      },
      startHost: startPairedRuntimeBrowserClientHost,
      closeHost: closePairedRuntimeBrowserClientHostEnvironment,
    });
  }
  async create(input: {
    context: string;
    url?: string;
    page?: string;
    profileId?: string;
    targetGroupId?: string;
    preference?: BrowserClientHostPlacementPreference;
  }) {
    const host = this.hostForContext(input.context);
    if (!host)
      throw new BrowserError(
        "browser_host_unavailable",
        "The SSH browser host is not registered",
      );
    const placement = await this.prepare({
      selector: host.id,
      preference: input.preference ?? "auto",
    });
    const response = await this.call(host.id, "browser.tabCreate", {
      worktree: input.context,
      url: input.url ?? "about:blank",
      page: input.page,
      profileId: input.profileId,
      targetGroupId: input.targetGroupId,
      placement,
      activate: false,
    });
    if (!response.ok)
      throw new BrowserError(
        response.error.code,
        response.error.message,
        response.error.data,
      );
    const pageId = (response.result as { browserPageId: string }).browserPageId;
    const status =
      placement.kind === "client"
        ? await this.call(host.id, "browser.clientHost.pageStatus", {
            page: pageId,
          })
        : null;
    if (status && !status.ok) throw new Error(status.error.message);
    return {
      environmentId: host.id,
      context: input.context,
      browserPageId: pageId,
      placement: status
        ? (status.result as { placement: unknown }).placement
        : { kind: "server" },
      runtimeId: this.statuses.get(host.id)!.runtimeId,
    };
  }
  async network(context: string) {
    const host = this.hostForContext(context);
    if (!host) return undefined;
    const status = await this.probe(host.id);
    return {
      kind: "native" as const,
      runtimeId: status.runtimeId,
      revision: status.startedAt,
    };
  }
  async call(id: string, method: string, params: unknown) {
    if (id === "local") return this.bridge.call("local", method, params);
    await this.probe(id);
    return (
      invokePairedRuntimeBrowser(id, method, this.nativeParams(id, params)) ??
      this.bridge.call(
        this.host(id).alias,
        method,
        this.nativeParams(id, params),
      )
    );
  }
  private routes() {
    this.bridge.resetRoutes(
      Object.fromEntries(
        this.hosts.flatMap((host) => [
          [host.id, host.alias],
          [`ssh://${host.alias}`, host.alias],
        ]),
      ),
    );
  }
  private persist() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.hosts), {
      mode: 0o600,
    });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
