import { JavisError } from "./error.js";
import type { JavisMethod } from "./session.js";
import {
  browserMethods,
  validateBrowserParams,
  type BrowserMethod,
} from "../browser/contract/index.js";

export type BrowserDaemonMethod =
  | BrowserMethod
  | "browser.open"
  | "browser.status"
  | "browser.workspaceSnapshot"
  | "browser.catalog.context"
  | "browser.catalog.list"
  | "browser.catalog.register"
  | "browser.catalog.remove"
  | "browser.catalog.refresh";
export type JavisDaemonMethod =
  | JavisMethod
  | "permissionsStatus"
  | "permissionsOpen"
  | "permissionsReset"
  | BrowserDaemonMethod;
const browserMethodNames = new Set<string>([
  ...browserMethods,
  "browser.open",
  "browser.status",
  "browser.workspaceSnapshot",
  "browser.catalog.context",
  "browser.catalog.list",
  "browser.catalog.register",
  "browser.catalog.remove",
  "browser.catalog.refresh",
]);
export function isBrowserDaemonMethod(
  method: string,
): method is BrowserDaemonMethod {
  return browserMethodNames.has(method);
}
export function browserDaemonParams(
  method: BrowserDaemonMethod,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (method === "browser.open") {
    if (
      Object.keys(params).some((key) => key !== "worktree") ||
      (params.worktree !== undefined &&
        (typeof params.worktree !== "string" || !params.worktree))
    )
      throw new JavisError(
        "invalid_argument",
        "Browser open accepts only a non-empty worktree context",
      );
    return params;
  }
  if (method === "browser.status") {
    if (Object.keys(params).length)
      throw new JavisError(
        "invalid_argument",
        "Browser status does not accept parameters",
      );
    return params;
  }
  if (method === "browser.workspaceSnapshot") {
    if (Object.keys(params).some(key => key !== 'worktree') || (params.worktree !== undefined && (typeof params.worktree !== 'string' || !params.worktree))) throw new JavisError('invalid_argument', 'Browser workspace snapshot accepts only a non-empty worktree')
    return params
  }
  if (method.startsWith("browser.catalog.")) return params;
  return validateBrowserParams(method, params);
}

type PermissionId = "accessibility" | "screenshots";
type PermissionOperations = {
  status: () => Promise<unknown>;
  open: (id?: PermissionId, canDeliver?: () => boolean) => Promise<unknown>;
  reset: (canDeliver?: () => boolean) => Promise<unknown>;
};

export function createDaemonDispatch(
  computer: (
    method: JavisMethod,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
  permissions: PermissionOperations,
  browser?: (
    method: BrowserDaemonMethod,
    params: Record<string, unknown>,
    canDeliver: () => boolean,
  ) => Promise<unknown>,
): (
  method: JavisDaemonMethod,
  params: Record<string, unknown>,
  canDeliver?: () => boolean,
) => Promise<unknown> {
  return async (method, params, canDeliver = () => true) => {
    if (!canDeliver())
      throw new JavisError(
        "action_timeout",
        "Caller disconnected before request delivery",
      );
    if (isBrowserDaemonMethod(method)) {
      const validated = browserDaemonParams(method, params);
      if (!browser)
        throw new JavisError(
          "browser_host_unavailable",
          "The browser service is unavailable",
        );
      return browser(method, validated, canDeliver);
    }
    if (method === "permissionsStatus" || method === "permissionsReset") {
      if (Object.keys(params).length)
        throw new JavisError(
          "invalid_argument",
          `${method} does not accept parameters`,
        );
      return method === "permissionsStatus"
        ? permissions.status()
        : permissions.reset(canDeliver);
    }
    if (method === "permissionsOpen") {
      if (Object.keys(params).some((key) => key !== "id"))
        throw new JavisError(
          "invalid_argument",
          "Unknown permission setup parameter",
        );
      const id = params.id;
      if (id !== undefined && id !== "accessibility" && id !== "screenshots") {
        throw new JavisError(
          "invalid_argument",
          "Permission ID must be accessibility or screenshots",
        );
      }
      const result = await permissions.open(
        id as PermissionId | undefined,
        canDeliver,
      );
      return {
        opened: true,
        permissionId: id ?? null,
        ...(result && typeof result === "object" ? result : {}),
      };
    }
    return computer(method, params);
  };
}
