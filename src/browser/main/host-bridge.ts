import type {
  BrowserHostSubscriptionOptions,
  BrowserHostCallbacks,
} from "../source/main/ipc/runtime-environments/runtime-environment-transport-routing";
import type {
  RemoteRuntimeTransportSubscription,
  RemoteRuntimeTransportSubscriptionCallbacks,
  RemoteRuntimeSubscriptionOptions,
} from "../source/shared/remote-runtime/requests/remote-runtime-subscription-contract";
import type { RuntimeRpcResponse } from "../source/shared/runtime-rpc-envelope";
import { RemoteRuntimeClientError } from "../source/shared/remote-runtime/remote-runtime-client-error";
import { randomUUID } from "node:crypto";
export class BrowserHostBridge {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly streams = new Map<
    string,
    { callbacks: BrowserHostCallbacks; runtimeId?: string; release: () => void }
  >();
  private readonly invocations = new Map<
    string,
    {
      subscriptionId: string;
      resolve: (value: RuntimeRpcResponse<unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly routes = new Map<string, string>();
  resetRoutes(routes: Record<string, string>): void {
    this.routes.clear();
    this.configure(routes);
  }
  configure(routes: Record<string, string>): void {
    for (const [selector, target] of Object.entries(routes))
      this.routes.set(selector, target);
  }
  private target(selector: string): string {
    const registered = this.routes.get(selector);
    if (registered) return registered;
    if (
      selector !== "local" &&
      (/^[a-z]+:\/\//i.test(selector) ||
        /^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(selector))
    )
      throw new Error("browser_host_route_unavailable");
    return selector;
  }
  constructor(
    private readonly emit: (event: {
      method: string;
      params: Record<string, unknown>;
    }) => void,
  ) {}
  call(
    target: string,
    method: string,
    params: unknown,
    timeoutMs = 15_000,
  ): Promise<any> {
    target = this.target(target);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("browser_host_request_timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.emit({
        method: "browser.host.request",
        params: { id, target, method, params },
      });
    });
  }
  reply(params: Record<string, any>): boolean {
    const pending = this.pending.get(params.id);
    if (!pending) return false;
    this.pending.delete(params.id);
    clearTimeout(pending.timer);
    pending.resolve(params.response);
    return true;
  }
  async subscribe(
    target: string,
    method: string,
    params: unknown,
    callbacks: BrowserHostCallbacks,
    options?: BrowserHostSubscriptionOptions,
  ): Promise<RemoteRuntimeTransportSubscription> {
    target = this.target(target);
    const id = randomUUID();
    const close = () => {
      const stream = this.streams.get(id);
      if (!stream) return;
      this.streams.delete(id);
      for (const [requestId, pending] of this.invocations)
        if (pending.subscriptionId === id) {
          clearTimeout(pending.timer);
          pending.reject(new Error("browser_host_disconnected"));
          this.invocations.delete(requestId);
        }
      stream.release();
      this.emit({ method: "browser.host.unsubscribe", params: { id } });
      stream.callbacks.onClose?.();
    };
    options?.signal?.addEventListener("abort", close, { once: true });
    this.streams.set(id, {
      callbacks,
      runtimeId: (params as { authorityRuntimeId?: string })
        ?.authorityRuntimeId,
      release: () => options?.signal?.removeEventListener("abort", close),
    });
    if (options?.signal?.aborted) close();
    else
      this.emit({
        method: "browser.host.subscribe",
        params: {
          id,
          target,
          method,
          params,
          environmentId: options?.javisEnvironmentId,
          __javisCaller: options?.javisCaller,
          options: { clientCapabilities: options?.clientCapabilities },
        },
      });
    return {
      requestId: id,
      close,
      sendRequest: (method, params, timeoutMs) => {
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.invocations.delete(requestId);
            reject(new Error("browser_host_request_timeout"));
          }, timeoutMs);
          this.invocations.set(requestId, {
            subscriptionId: id,
            resolve,
            reject,
            timer,
          });
          this.emit({
            method: "browser.host.invoke",
            params: { id, requestId, method, params },
          });
        });
      },
      sendBinary: (bytes) => {
        if (!this.streams.has(id)) return false;
        this.emit({
          method: "browser.host.sendBinary",
          params: { id, bytes: Buffer.from(bytes).toString("base64") },
        });
        return true;
      },
    };
  }
  flow(params: Record<string, unknown>): void {
    this.emit({ method: "browser.host.flow", params });
  }
  delivery(params: Record<string, unknown>): void {
    this.emit({ method: "browser.host.delivery", params });
  }
  invocationReply(input: {
    requestId: string;
    response: RuntimeRpcResponse<unknown>;
  }): boolean {
    const pending = this.invocations.get(input.requestId);
    if (!pending) return false;
    this.invocations.delete(input.requestId);
    clearTimeout(pending.timer);
    pending.resolve(input.response);
    return true;
  }
  subscriptionReply(params: {
    id: string;
    response: RuntimeRpcResponse<unknown>;
  }): boolean {
    const stream = this.streams.get(params.id);
    if (!stream) return false;
    if (!params.response.ok) {
      stream.callbacks.onError(
        new RemoteRuntimeClientError(
          params.response.error.code,
          params.response.error.message,
        ),
      );
      return true;
    }
    if (typeof params.response._meta?.runtimeId !== "string") {
      stream.callbacks.onError(
        new RemoteRuntimeClientError(
          "invalid_response",
          "Browser host response is missing its authenticated runtime identity",
        ),
      );
      return false;
    }
    stream.callbacks.onResponse({ ...params.response, id: params.id });
    return true;
  }
  binary(params: {
    id: string;
    bytes: string;
    packetId?: string;
    subscriptionId?: string;
    __javisConnectionId?: string;
  }): boolean {
    const stream = this.streams.get(params.id);
    if (!stream) return false;
    if (stream.callbacks.onPacket) stream.callbacks.onPacket(params);
    else stream.callbacks.onBinary?.(Buffer.from(params.bytes, "base64"));
    return true;
  }
  close(): void {
    for (const request of this.invocations.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("browser_host_disconnected"));
    }
    this.invocations.clear();
    for (const stream of this.streams.values()) {
      stream.release();
      stream.callbacks.onError(
        new RemoteRuntimeClientError(
          "runtime_unreachable",
          "Browser host disconnected",
        ),
      );
      stream.callbacks.onClose?.();
    }
    this.streams.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("browser_host_disconnected"));
    }
    this.pending.clear();
  }
}
