import {
  BrowserClientHostReady,
  BrowserClientHostLeaseAuthority,
} from "../source/shared/browser/client-hosting/browser-client-host-protocol.js";
import { BrowserHostNetworkSessions } from "./network-session.js";
import { dispatchBrowserHostRequest } from "./host-dispatch.js";
import type net from "node:net";
import { randomUUID } from "node:crypto";
import { browserMethods, validateBrowserParams } from "../contract/index.js";
import {
  callBrowser,
  subscribeBrowserEvents,
} from "../runtime/browser-process.js";
import { runtimeErrorDetails, JavisError } from "../../runtime/error.js";
import { browserDaemonParams } from "../../runtime/daemon-dispatch.js";
import {
  BrowserFrameDecoder,
  writeBrowserFrame,
  type BrowserCallerIdentity,
} from "./framed-channel.js";

const allowed = new Set<string>([
  ...browserMethods,
  "browser.status",
  "browser.clientHost.pageStatus",
  "browser.workspaceSnapshot",
]);

export function serveBrowserDaemonStream(
  socket: net.Socket,
  identity: BrowserCallerIdentity,
  token: string,
  onClose: () => void,
): void {
  const connectionId = randomUUID();
  const caller = { ...identity, connectionId };
  const decoder = new BrowserFrameDecoder();
  const requestIds = new Set<number>();
  const admissions = new Map<string, number>();
  const subscriptions = new Set<string>();
  let clientHostAttach:
    | {
        id: string;
        browserHostClientId: string;
        authorityRuntimeId: string;
        lease?: { authorityEpoch: string; browserHostGeneration: number };
      }
    | undefined;
  let closed = false;
  let activeRequests = 0;
  const network = new BrowserHostNetworkSessions((event) => {
    if (closed) return false;
    try {
      return writeBrowserFrame(socket, { type: "event", ...event }) === true;
    } catch {
      socket.destroy();
      return false;
    }
  });
  const unsubscribe = subscribeBrowserEvents((event) => {
    if (closed) return;
    if (event.method === "browser.clientHost.pages") {
      const claim = clientHostAttach;
      const authority = BrowserClientHostLeaseAuthority.safeParse(event.params);
      if (
        !claim?.lease ||
        !authority.success ||
        event.params.__javisConnectionId !== connectionId ||
        event.params.pairedDeviceId !== caller.pairedDeviceId ||
        authority.data.authorityRuntimeId !== claim.authorityRuntimeId ||
        authority.data.browserHostClientId !== claim.browserHostClientId ||
        authority.data.authorityEpoch !== claim.lease.authorityEpoch ||
        authority.data.browserHostGeneration !==
          claim.lease.browserHostGeneration ||
        !Array.isArray(event.params.pages) ||
        !event.params.pages.every(
          (page) =>
            page &&
            typeof page === "object" &&
            page.pairedDeviceId === caller.pairedDeviceId &&
            typeof page.browserPageId === "string" &&
            page.placement?.kind === "client" &&
            page.placement.browserHostClientId === claim.browserHostClientId &&
            page.placement.browserHostGeneration ===
              claim.lease!.browserHostGeneration &&
            Number.isInteger(page.placement.pageHostGeneration) &&
            page.placement.pageHostGeneration >= 1 &&
            page.placement.pageHostGeneration <= 0xffff_ffff,
        )
      )
        return;
    } else if (event.params.__javisConnectionId !== connectionId) return;
    if (event.method === "browser.clientHost.attach") {
      const claim = clientHostAttach;
      if (!claim || event.params.__javisAttachId !== claim.id) return;
      if (event.params.type === "ready") {
        const ready = BrowserClientHostReady.safeParse(event.params);
        if (
          !ready.success ||
          event.params.authorityRuntimeId !== claim.authorityRuntimeId ||
          event.params.browserHostClientId !== claim.browserHostClientId ||
          event.params.pairedDeviceId !== caller.pairedDeviceId
        )
          return;
        if (
          claim.lease &&
          (claim.lease.authorityEpoch !== ready.data.authorityEpoch ||
            claim.lease.browserHostGeneration !==
              ready.data.browserHostGeneration)
        )
          return;
        claim.lease = ready.data;
      } else if (
        ["revoked", "end", "error"].includes(String(event.params.type))
      ) {
        if (
          event.params.type === "revoked" &&
          (event.params.authorityEpoch !== claim.lease?.authorityEpoch ||
            event.params.browserHostGeneration !==
              claim.lease?.browserHostGeneration)
        )
          return;
        clientHostAttach = undefined;
      }
    }
    if (
      event.method === "browser.host.revoked" &&
      typeof event.params.id === "string"
    ) {
      admissions.delete(event.params.id);
      network.closeAdmission(event.params.id);
    }
    const {
      __javisConnectionId: _connection,
      __javisAttachId: _attach,
      ...params
    } = event.params;
    try {
      const result = writeBrowserFrame(
        socket,
        { type: "event", method: event.method, params },
        { dropWhenBacklogged: event.method === "browser.stream.binary" },
      );
      if (result === "backlogged")
        void callBrowser("browser.stream.delivery", {
          connectionId,
          packetId: params.packetId,
          outcome: "backlogged",
          backlogged: true,
        }).catch(() => socket.destroy());
    } catch {
      socket.destroy();
    }
  });
  socket.on("drain", () => {
    void callBrowser("browser.stream.flow", {
      connectionId,
      backlogged: false,
    }).catch(() => {});
  });
  socket.once("close", () => {
    if (closed) return;
    closed = true;
    clientHostAttach = undefined;
    network.close();
    unsubscribe();
    onClose();
    for (const subscriptionId of subscriptions)
      void callBrowser("browser.screencast.unsubscribe", {
        subscriptionId,
        __javisCaller: caller,
      }).catch(() => {});
    void callBrowser("browser.connection.close", { connectionId }).catch(
      () => {},
    );
  });
  const authority = async (
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const method = String(params.method);
    if (!["browser.host.admit", "browser.host.release"].includes(method))
      throw new JavisError(
        "access_denied",
        "Invalid browser authority request",
      );
    const input = params.params as Record<string, unknown>;
    const result = (await callBrowser(method, {
      ...input,
      __javisCaller: caller,
    })) as { admitted?: boolean; tunnelGeneration?: number };
    if (
      method === "browser.host.admit" &&
      result.admitted &&
      typeof result.tunnelGeneration === "number"
    )
      admissions.set(String(input.id), result.tunnelGeneration);
    if (method === "browser.host.release") {
      admissions.delete(String(input.id));
      network.closeAdmission(String(input.id));
    }
    return result;
  };
  const networkCall = (params: Record<string, unknown>): unknown => {
    if (
      params.action === "open" &&
      (typeof params.admissionId !== "string" ||
        admissions.get(params.admissionId) !== params.tunnelGeneration)
    )
      throw new JavisError(
        "access_denied",
        "Source browser network admission required",
      );
    return network.call(params);
  };
  socket.on("data", (chunk) => {
    try {
      for (const frame of decoder.push(chunk)) {
        if (
          frame.token !== token ||
          !Number.isSafeInteger(frame.id) ||
          (frame.id as number) < 1 ||
          requestIds.has(frame.id as number)
        )
          throw new JavisError(
            "access_denied",
            "Invalid authenticated browser stream request",
          );
        if (activeRequests >= 2048)
          throw new JavisError(
            "transport_error",
            "Browser channel request budget exhausted",
          );
        requestIds.add(frame.id as number);
        if (requestIds.size > 100_000)
          throw new JavisError(
            "transport_error",
            "Reconnect browser channel to renew request identifiers",
          );
        if (
          typeof frame.method !== "string" ||
          (!allowed.has(frame.method) &&
            frame.method !== "__browserHost" &&
            frame.method !== "__browserNetwork" &&
            frame.method !== "__browserAuthority" &&
            frame.method !== "__browserDelivery" &&
            frame.method !== "__browserFlow")
        )
          throw new JavisError(
            "access_denied",
            "Browser stream method is not allowed",
          );
        const method = frame.method;
        if (
          ["__browserHost", "__browserNetwork", "__browserAuthority", "browser.workspaceSnapshot"].includes(
            method,
          ) &&
          identity.clientKind !== "runtime"
        )
          throw new JavisError(
            "access_denied",
            "Authenticated execution host required",
          );
        if (
          !frame.params ||
          typeof frame.params !== "object" ||
          Array.isArray(frame.params)
        )
          throw new JavisError(
            "invalid_argument",
            "Browser stream parameters must be an object",
          );
        const params =
          method === "browser.workspaceSnapshot"
            ? browserDaemonParams(method, frame.params as Record<string, unknown>)
            : method.startsWith("__browser") ||
          method === "browser.status" ||
          method === "browser.clientHost.pageStatus"
            ? (frame.params as Record<string, unknown>)
            : validateBrowserParams(method, frame.params);
        if (method === "browser.clientHost.attach") {
          if (caller.clientKind !== "runtime" || !caller.pairedDeviceId)
            throw new JavisError(
              "access_denied",
              "Authenticated browser client host required",
            );
          if (clientHostAttach) {
            writeBrowserFrame(socket, {
              id: frame.id,
              ok: false,
              error: {
                code: "access_denied",
                message:
                  "One live browser client host attach is allowed per connection",
              },
            });
            continue;
          }
          clientHostAttach = {
            id: randomUUID(),
            browserHostClientId: String(params.browserHostClientId),
            authorityRuntimeId: String(params.authorityRuntimeId),
          };
        }
        const attach =
          method === "browser.clientHost.attach" ? clientHostAttach : undefined;
        const operation =
          method === "__browserDelivery"
            ? callBrowser("browser.stream.delivery", {
                ...params,
                connectionId,
              })
            : method === "__browserFlow"
              ? callBrowser("browser.stream.flow", { ...params, connectionId })
              : method === "__browserAuthority"
                ? authority(params)
                : method === "__browserNetwork"
                  ? Promise.resolve().then(() => networkCall(params))
                  : method === "__browserHost"
                    ? dispatchBrowserHostRequest({
                        target: "local",
                        method: String(params.method),
                        params: params.params as Record<string, unknown>,
                      }).then((response) => {
                        if (!response.ok)
                          throw new JavisError(
                            response.error.code,
                            response.error.message,
                            response.error.data,
                          );
                        return response.result;
                      })
                    : callBrowser(
                        method,
                        {
                          ...params,
                          __javisCaller: caller,
                          ...(attach ? { __javisAttachId: attach.id } : {}),
                        },
                        {},
                        () => !closed && !socket.destroyed,
                      );
        activeRequests++;
        void operation
          .then(
            (result) => {
              if (closed) {
                if (
                  method === "browser.screencast" &&
                  result &&
                  typeof result === "object" &&
                  "subscriptionId" in result
                )
                  void callBrowser("browser.screencast.unsubscribe", {
                    subscriptionId: result.subscriptionId,
                  }).catch(() => {});
                return;
              }
              if (
                method === "browser.screencast" &&
                result &&
                typeof result === "object" &&
                "subscriptionId" in result
              )
                subscriptions.add(String(result.subscriptionId));
              writeBrowserFrame(socket, { id: frame.id, ok: true, result });
            },
            (error) => {
              if (attach && clientHostAttach === attach)
                clientHostAttach = undefined;
              if (!closed)
                writeBrowserFrame(socket, {
                  id: frame.id,
                  ok: false,
                  error: runtimeErrorDetails(error),
                });
            },
          )
          .catch(() => socket.destroy())
          .finally(() => activeRequests--);
      }
    } catch {
      socket.destroy();
    }
  });
}
