import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { once } from "node:events";
import { daemonEndpoint } from "../../runtime/daemon-endpoint.js";
import { JavisError } from "../../runtime/error.js";
import {
  createBrowserChannel,
  type BrowserChannel,
  type BrowserEvent,
} from "./browser-channel.js";
import {
  createExternalBrowserProvider,
  type ExternalBrowserProvider,
} from "./external-browser-provider.js";

export type BrowserProcessOptions = {
  executable: string;
  entry: string;
  applicationDirectory?: string;
  launchArguments?: readonly string[];
  dataDirectory: string;
  background?: boolean;
  onEvent?(event: BrowserEvent): void;
};

export class BrowserProcess {
  private child?: ChildProcess;
  private channel?: BrowserChannel;
  private startup?: Promise<void>;
  private started = false;
  private runDirectory?: string;
  private stopping?: Promise<void>;

  constructor(private options: BrowserProcessOptions) {}

  ensureStarted(): Promise<void> {
    return this.start();
  }

  async call(
    method: string,
    params: Record<string, unknown>,
    canDeliver: () => boolean = () => true,
  ): Promise<unknown> {
    if (this.stopping)
      throw new JavisError(
        "browser_host_unavailable",
        "The browser is shutting down",
      );
    await this.start();
    if (!canDeliver())
      throw new JavisError(
        "action_timeout",
        "Caller disconnected before browser request delivery",
        { mayHaveStarted: false },
      );
    const channel = this.channel;
    if (!channel)
      throw new JavisError(
        "browser_host_unavailable",
        "The browser is unavailable",
      );
    const requestedTimeout =
      typeof params.timeout === "number" &&
      Number.isFinite(params.timeout) &&
      params.timeout > 0
        ? params.timeout
        : 0;
    const requestParams =
      method === "browser.open" && process.env.ORCA_BACKGROUND_LAUNCH !== "1"
        ? { ...params, __javisForeground: true }
        : params;
    return channel.request(
      method,
      requestParams,
      Math.max(60_000, Math.ceil(requestedTimeout) + 10_000),
    );
  }

  shutdown(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stop();
    return this.stopping;
  }

  private async start(): Promise<void> {
    if (this.startup && (!this.started || this.channel?.connected()))
      return this.startup;
    const launch = this.startup
      ? this.cleanup().then(() => this.launch())
      : this.launch();
    this.started = false;
    this.startup = launch.catch(async (error) => {
      await this.cleanup();
      this.startup = undefined;
      throw error;
    });
    return this.startup;
  }

  private async launch(): Promise<void> {
    if (
      !isAbsolute(this.options.executable) ||
      !isAbsolute(this.options.entry) ||
      !isAbsolute(this.options.dataDirectory)
    ) {
      throw new JavisError(
        "invalid_argument",
        "Browser executable, entry and data directory must be absolute paths",
      );
    }
    await access(this.options.executable);
    await access(this.options.entry);
    if (this.options.applicationDirectory) {
      if (!isAbsolute(this.options.applicationDirectory))
        throw new JavisError(
          "invalid_argument",
          "Browser application directory must be absolute",
        );
      await access(this.options.applicationDirectory);
    }
    await mkdir(this.options.dataDirectory, { recursive: true, mode: 0o700 });
    const state = await lstat(this.options.dataDirectory);
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      (process.getuid && state.uid !== process.getuid())
    ) {
      throw new JavisError(
        "access_denied",
        "Browser state directory must be a private directory owned by the current user",
      );
    }
    if (process.platform !== "win32")
      await chmod(this.options.dataDirectory, 0o700);
    const token = randomBytes(32).toString("hex");
    this.runDirectory = await mkdtemp(join(tmpdir(), "javis-browser-"));
    const address =
      process.platform === "win32"
        ? `\\\\.\\pipe\\javis-browser-${token}`
        : join(this.runDirectory, "b.sock");
    const channel = await createBrowserChannel({
      address,
      token,
      expectedPid: () => this.child?.pid,
      onEvent: this.options.onEvent,
    });
    this.channel = channel;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      JAVIS_BROWSER_CHANNEL: address,
      JAVIS_BROWSER_TOKEN: token,
      JAVIS_BROWSER_DATA_DIRECTORY: this.options.dataDirectory,
      JAVIS_BROWSER_BACKGROUND: this.options.background === false ? "0" : "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      this.options.executable,
      [
        ...(this.options.launchArguments ?? []),
        this.options.applicationDirectory ?? this.options.entry,
      ],
      { shell: false, stdio: "ignore", windowsHide: true, env },
    );
    this.child = child;
    child.once("error", () => {
      void channel.close(
        new JavisError(
          "browser_startup_failed",
          "Could not start the Javis browser process",
        ),
      );
    });
    child.once("exit", () => {
      void channel.close();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        channel.ready(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new JavisError(
                  "browser_startup_timeout",
                  "The browser did not establish its private connection",
                ),
              ),
            20_000,
          );
        }),
      ]);
      this.started = true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async stop(): Promise<void> {
    await this.startup?.catch(() => {});
    if (this.channel)
      await this.channel.request("__shutdown", {}, 10_000).catch(() => {});
    await this.cleanup();
    this.startup = undefined;
  }

  private async cleanup(): Promise<void> {
    this.started = false;
    const child = this.child;
    this.child = undefined;
    await this.channel?.close();
    this.channel = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit").catch(() => {});
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 5_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    if (this.runDirectory) {
      await rm(this.runDirectory, { recursive: true, force: true });
      this.runDirectory = undefined;
    }
  }
}

type LocalBrowserOwner =
  | { kind: "electron"; process: BrowserProcess }
  | { kind: "chromium"; process: ExternalBrowserProvider };
let localOwner: Promise<LocalBrowserOwner> | undefined;
let ownerGeneration = 0;
let stoppingOwner: Promise<void> | undefined;
const listeners = new Set<(event: BrowserEvent) => void>();

export function subscribeBrowserEvents(
  listener: (event: BrowserEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function browserOptions(): Promise<BrowserProcessOptions> {
  const cliEntry = process.env.JAVIS_CLI_ENTRY ?? process.argv[1];
  if (!cliEntry || !isAbsolute(cliEntry))
    throw new JavisError(
      "browser_startup_failed",
      "The Javis CLI entry path is required",
    );
  const browserDirectory = join(dirname(cliEntry), "browser");
  const entry = join(browserDirectory, "main", "main.cjs");
  try {
    await access(entry);
  } catch {
    throw new JavisError(
      "browser_not_built",
      "The browser runtime is missing; build Javis with npm run build before using browser commands",
    );
  }
  const bundled =
    process.platform === "darwin"
      ? [
          join(
            browserDirectory,
            "Javis Browser.app/Contents/MacOS/Javis Browser",
          ),
          join(
            browserDirectory,
            "electron/Electron.app/Contents/MacOS/Electron",
          ),
        ]
      : [
          join(
            browserDirectory,
            "electron",
            process.platform === "win32" ? "electron.exe" : "electron",
          ),
        ];
  let executable: string | undefined;
  for (const candidate of bundled) {
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {}
  }
  if (!executable) {
    const require = createRequire(cliEntry);
    try {
      executable = require("electron") as string;
    } catch {
      throw new JavisError(
        "browser_executable_missing",
        "The packaged Javis browser executable is missing",
      );
    }
  }
  const dataDirectory = join(
    daemonEndpoint(process.platform, homedir(), process.env).directory,
    "browser",
  );
  const debugPort = Number(process.env.JAVIS_BROWSER_DEBUG_PORT);
  const launchArguments =
    Number.isInteger(debugPort) && debugPort > 0 && debugPort < 65536
      ? [
          `--remote-debugging-port=${debugPort}`,
          "--remote-debugging-address=127.0.0.1",
        ]
      : undefined;
  return {
    executable,
    entry,
    launchArguments,
    applicationDirectory: browserDirectory,
    dataDirectory,
    background: true,
    onEvent: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

export async function callBrowser(
  method: string,
  params: Record<string, unknown>,
  target: { host?: string; context?: string } = {},
  canDeliver: () => boolean = () => true,
): Promise<unknown> {
  const routed =
    target.context === undefined
      ? params
      : { ...params, worktree: target.context };
  if (target.host) {
    const { callRemoteJavis } = await import("../../runtime/remote-stdio.js");
    return callRemoteJavis(
      method as Parameters<typeof callRemoteJavis>[0],
      routed,
      target.host,
    );
  }
  if (stoppingOwner)
    throw new JavisError(
      "browser_host_unavailable",
      "The browser is shutting down",
    );
  const generation = ownerGeneration;
  const owner = await getLocalOwner(generation);
  if (generation !== ownerGeneration || stoppingOwner || !canDeliver())
    throw new JavisError(
      "action_timeout",
      "Browser ownership changed before request delivery",
      { mayHaveStarted: false },
    );
  return owner.kind === "electron"
    ? owner.process.call(
        method,
        routed,
        () => generation === ownerGeneration && !stoppingOwner && canDeliver(),
      )
    : owner.process.call(method, routed);
}

function getLocalOwner(generation: number): Promise<LocalBrowserOwner> {
  if (localOwner) return localOwner;
  const pending = createLocalOwner(generation);
  localOwner = pending;
  void pending.catch(() => {
    if (localOwner === pending && ownerGeneration === generation)
      localOwner = undefined;
  });
  return pending;
}

async function createLocalOwner(
  generation: number,
): Promise<LocalBrowserOwner> {
  let browser: BrowserProcess | undefined;
  let owner: LocalBrowserOwner;
  try {
    const options = await browserOptions();
    if (generation !== ownerGeneration || stoppingOwner)
      throw new JavisError(
        "browser_host_unavailable",
        "Browser startup was cancelled",
      );
    browser = new BrowserProcess(options);
    await browser.ensureStarted();
    owner = { kind: "electron", process: browser };
  } catch (error) {
    await browser?.shutdown();
    if (generation !== ownerGeneration || stoppingOwner) throw error;
    const executable = process.env.JAVIS_BROWSER_EXECUTABLE?.trim();
    if (!executable) {
      throw error;
    }
    const cliEntry = process.env.JAVIS_CLI_ENTRY ?? process.argv[1];
    if (!cliEntry) {
      throw new JavisError(
        "browser_startup_failed",
        "The Javis CLI entry path is required",
      );
    }
    const external = await createExternalBrowserProvider({
      executable,
      cliEntry,
      dataDirectory: join(
        daemonEndpoint(process.platform, homedir(), process.env).directory,
        "browser",
      ),
      emit: (event) => {
        for (const listener of listeners) listener(event);
      },
    });
    owner = { kind: "chromium", process: external };
  }
  if (generation !== ownerGeneration || stoppingOwner) {
    await owner.process.shutdown();
    throw new JavisError(
      "browser_host_unavailable",
      "Browser startup was cancelled",
    );
  }
  return owner;
}

export function stopBrowserProcess(): Promise<void> {
  if (stoppingOwner) return stoppingOwner;
  const pending = localOwner;
  ownerGeneration++;
  stoppingOwner = (async () => {
    const owner = await pending?.catch(() => undefined);
    await owner?.process.shutdown();
  })().finally(() => {
    if (localOwner === pending) localOwner = undefined;
    stoppingOwner = undefined;
  });
  return stoppingOwner;
}
