import { EventEmitter } from "node:events";
import type net from "node:net";
import { expect, test, vi } from "vitest";
import type { BrowserStreamEvent } from "../../../src/browser/remote/framed-channel.js";

const engine = vi.hoisted(() => ({
  listeners: new Set<(event: BrowserStreamEvent) => void>(),
  call: undefined as unknown as (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
}));
vi.mock("../../../src/browser/runtime/browser-process.js", () => ({
  callBrowser: (method: string, params: Record<string, unknown>) =>
    engine.call(method, params),
  subscribeBrowserEvents: (listener: (event: BrowserStreamEvent) => void) => {
    engine.listeners.add(listener);
    return () => engine.listeners.delete(listener);
  },
}));
vi.mock("../../../src/browser/remote/host-dispatch.js", () => ({
  dispatchBrowserHostRequest: async () => ({ ok: true, result: {} }),
}));
import { serveBrowserDaemonStream } from "../../../src/browser/remote/daemon-stream.js";
import {
  BrowserFrameDecoder,
  writeBrowserFrame,
} from "../../../src/browser/remote/framed-channel.js";

const ready = {
  type: "ready",
  authorityEpoch: "epoch-1",
  browserHostGeneration: 3,
};
function emit(method: string, params: Record<string, unknown>) {
  for (const listener of engine.listeners) listener({ method, params });
}
function publication(
  input: Record<string, unknown>,
  marker: string,
  overrides: Record<string, unknown> = {},
) {
  const caller = input.__javisCaller as {
    connectionId: string;
    pairedDeviceId: string;
  };
  return {
    authorityRuntimeId: "authority-1",
    authorityEpoch: "epoch-1",
    browserHostGeneration: 3,
    browserHostClientId: "host-1",
    pairedDeviceId: caller.pairedDeviceId,
    __javisConnectionId: caller.connectionId,
    marker,
    pages: [
      {
        browserPageId: "page-1",
        pairedDeviceId: caller.pairedDeviceId,
        placement: {
          kind: "client",
          browserHostClientId: "host-1",
          browserHostGeneration: 3,
          pageHostGeneration: 2,
        },
      },
    ],
    ...overrides,
  };
}
function sourceEvent(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const caller = input.__javisCaller as {
    connectionId: string;
    pairedDeviceId: string;
  };
  emit("browser.clientHost.attach", {
    ...result,
    __javisAttachId: input.__javisAttachId,
    __javisConnectionId: caller.connectionId,
    authorityRuntimeId: "authority-1",
    browserHostClientId: input.browserHostClientId,
    pairedDeviceId: caller.pairedDeviceId,
  });
}
function peer(device = "device-1") {
  const socket = new EventEmitter() as net.Socket;
  const decoder = new BrowserFrameDecoder();
  const frames: Record<string, unknown>[] = [];
  Object.assign(socket, {
    destroyed: false,
    writableNeedDrain: false,
    writableLength: 0,
    write: (chunk: Buffer) => {
      frames.push(...decoder.push(chunk));
      return true;
    },
    destroy: () => {
      Object.assign(socket, { destroyed: true });
      socket.emit("close");
      return socket;
    },
  });
  serveBrowserDaemonStream(
    socket,
    { clientKind: "runtime", pairedDeviceId: device },
    "token",
    () => {},
  );
  let id = 0;
  return {
    frames,
    close: () => socket.destroy(),
    attach: (host = "host-1") => {
      const requestId = ++id;
      writeBrowserFrame(
        {
          write: (chunk: Buffer) => socket.emit("data", chunk),
          writableLength: 0,
        } as unknown as net.Socket,
        {
          token: "token",
          id: requestId,
          method: "browser.clientHost.attach",
          params: {
            authorityRuntimeId: "authority-1",
            browserHostClientId: host,
            hostCapabilities: ["webview"],
          },
        },
      );
      return requestId;
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const markers = (frames: Record<string, unknown>[]) =>
  frames
    .filter((frame) => frame.method === "browser.clientHost.pages")
    .map((frame) => (frame.params as Record<string, unknown>).marker);

test("authenticated source-ready admits initial and later owner publications before the attach response settles", async () => {
  let attach!: Record<string, unknown>;
  engine.call = async (method, input) => {
    if (method !== "browser.clientHost.attach") return {};
    attach = input;
    const beforeReady = publication(input, "before-ready");
    emit("browser.clientHost.pages", beforeReady);
    emit("browser.clientHost.attach", {
      ...beforeReady,
      ...ready,
      __javisAttachId: input.__javisAttachId,
      pairedDeviceId: "device-2",
    });
    emit(
      "browser.clientHost.pages",
      publication(input, "foreign-ready-device"),
    );
    emit("browser.clientHost.attach", {
      ...beforeReady,
      ...ready,
      __javisAttachId: input.__javisAttachId,
      browserHostClientId: "host-2",
    });
    emit("browser.clientHost.pages", publication(input, "foreign-ready-host"));
    sourceEvent(input, ready);
    sourceEvent(input, { ...ready, browserHostGeneration: 2 });
    sourceEvent(input, {
      ...ready,
      type: "revoked",
      authorityEpoch: "old-epoch",
      reason: "released",
    });
    emit("browser.clientHost.pages", publication(input, "initial"));
    return ready;
  };
  const owner = peer(),
    foreign = peer("device-2");
  try {
    owner.attach();
    emit("browser.clientHost.pages", publication(attach, "later"));
    emit(
      "browser.clientHost.pages",
      publication(attach, "foreign-host", { browserHostClientId: "host-2" }),
    );
    emit(
      "browser.clientHost.pages",
      publication(attach, "foreign-device", { pairedDeviceId: "device-2" }),
    );
    emit(
      "browser.clientHost.pages",
      publication(attach, "stale-epoch", { authorityEpoch: "old-epoch" }),
    );
    emit(
      "browser.clientHost.pages",
      publication(attach, "stale-lease", { browserHostGeneration: 2 }),
    );
    emit(
      "browser.clientHost.pages",
      publication(attach, "stale-page", {
        pages: [
          {
            browserPageId: "page-1",
            pairedDeviceId: "device-1",
            placement: {
              kind: "client",
              browserHostClientId: "host-1",
              browserHostGeneration: 2,
              pageHostGeneration: 2,
            },
          },
        ],
      }),
    );
    await settle();
    expect(markers(owner.frames)).toEqual(["initial", "later"]);
    expect(markers(foreign.frames)).toEqual([]);
    expect(
      owner.frames.some((frame) => frame.id === 1 && frame.ok === true),
    ).toBe(true);
  } finally {
    owner.close();
    foreign.close();
  }
});

test("invalid ready, rejected attach, and ended or revoked leases cannot forward pages", async () => {
  let attach!: Record<string, unknown>;
  engine.call = async (method, input) => {
    if (method !== "browser.clientHost.attach") return {};
    attach = input;
    sourceEvent(input, { ...ready, browserHostGeneration: 0 });
    emit("browser.clientHost.pages", publication(input, "invalid-ready"));
    throw new Error("Source attach denied");
  };
  const owner = peer();
  try {
    owner.attach();
    await settle();
    emit("browser.clientHost.pages", publication(attach, "failed"));
    engine.call = async (method, input) => {
      if (method !== "browser.clientHost.attach") return {};
      attach = input;
      sourceEvent(input, ready);
      return ready;
    };
    owner.attach();
    emit("browser.clientHost.pages", publication(attach, "repaired"));
    sourceEvent(attach, { type: "end" });
    emit("browser.clientHost.pages", publication(attach, "ended"));
    owner.attach();
    sourceEvent(attach, { ...ready, type: "revoked", reason: "released" });
    emit("browser.clientHost.pages", publication(attach, "revoked"));
    owner.attach();
    sourceEvent(attach, { type: "error" });
    emit("browser.clientHost.pages", publication(attach, "error"));
    expect(markers(owner.frames)).toEqual(["repaired"]);
  } finally {
    owner.close();
  }
});

test("one connection cannot attach another live host or replace its publication claim", async () => {
  let attach!: Record<string, unknown>;
  engine.call = async (method, input) => {
    if (method !== "browser.clientHost.attach") return {};
    attach = input;
    sourceEvent(input, ready);
    return ready;
  };
  const owner = peer();
  try {
    owner.attach();
    const denied = owner.attach("host-2");
    await settle();
    emit("browser.clientHost.pages", publication(attach, "still-owned"));
    expect(owner.frames.find((frame) => frame.id === denied)).toMatchObject({
      ok: false,
      error: { code: "access_denied" },
    });
    expect(markers(owner.frames)).toEqual(["still-owned"]);
  } finally {
    owner.close();
  }
});
