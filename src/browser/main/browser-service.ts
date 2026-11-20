import { FLOATING_TERMINAL_WORKTREE_ID } from "../source/shared/workspace/identity/floating-workspace-id";
import { browserSiteDisplayController } from "../source/main/browser/site-settings/display/browser-site-display-controller";
import { actOnRuntimeBrowserInitialization, captureRuntimeBrowserInitializationAction } from "../source/main/runtime/browser/client-pages/runtime-browser-page-initialization-action";
import { BrowserPageInitializationActionParams } from "../source/shared/browser/client-hosting/browser-page-initialization-action";
import type { RuntimeMobileSessionTabsResult } from "../source/shared/runtime-session-contracts";
import { reuseEqualJson } from "../source/shared/reuse-equal-json";
import type { z } from "zod";
import { DEFAULT_LOCAL_ORCA_PROFILE_ID } from "../source/shared/orca-profiles";
import { runWithRequestedPageUrl } from "../source/main/browser/cdp/input/browser-expected-page-url";
import { routeRuntimeBrowserClientAutomation } from "../source/main/runtime/browser/client-pages/runtime-browser-client-automation";
import { configureBrowserClientPageAutomationRuntime } from "../source/main/browser/client-pages/execution/browser-client-page-automation-runtime";
import {
  persistClientHostedBrowserPages,
  rehydrateClientHostedBrowserPages,
} from "../source/main/runtime/browser/client-pages/client-hosted-browser-page-persistence";
import { formatBrowserClientHostIdArgument } from "../source/shared/browser/client-hosting/browser-client-host-id-argument";
import {
  initializeBrowserClientHostId,
  getBrowserClientHostId,
} from "../source/main/browser/client-hosts/lifecycle/browser-client-host-id";
import { BrowserHostCatalog } from "./host-catalog";
import {
  attachBrowserClientPageRenderer,
  retireBrowserClientPageRenderer,
} from "../source/main/browser/client-pages/renderer/browser-client-page-renderer-runtime";
import { BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES } from "../source/shared/browser/client-hosting/browser-client-hosting-eligibility";
import { BROWSER_SCREENCAST_RUNTIME_CAPABILITY } from "../source/shared/browser/runtime/browser-runtime-capabilities";
import {
  shutdownPairedRuntimeBrowserClientHosts,
  pairedRuntimeBrowserClientHostsPage,
} from "../source/main/browser/client-hosts/lifecycle/paired-runtime-browser-client-host-runtime";
import { BrowserStreamDelivery } from "./stream-delivery";
import { KeybindingService } from "../source/main/keybindings/keybinding-service";
import { ClientHostedBrowserRowPublisher } from "../source/main/runtime/browser/client-pages/client-hosted-browser-row-publication";
import {
  BrowserWorkspaceSessions,
  browserContextId,
} from "./workspace-sessions";
import { RuntimeBrowserScreencastController } from "../source/main/runtime/browser/screencast/runtime-browser-screencast-controller";
import { RuntimeBrowserDriverController } from "../source/main/runtime/browser/driver/runtime-browser-driver-controller";
import { ServeBrowserTabs } from "../source/main/runtime/browser/headless/serve-browser-tabs";
import { findSavedBrowserPage } from "../source/main/runtime/browser/headless/serve-browser-tab-layout";
import { initializeBrowserSessionsForApp } from "../source/main/browser/sessions/browser-session-startup";
import { trackBrowserExtensionMainWindow } from "../source/main/browser/extensions/tabs-and-windows/browser-extension-window-model";
import { registerDocPreviewGrantHandlers } from "../source/main/ipc/doc-preview-grant-ipc";
import { installDocPreviewProtocolHandler } from "../source/main/browser/document-preview/doc-preview-protocol";
import { releaseBrowserClientDownloadTransfersForPage } from "../source/main/runtime/browser/downloads/browser-client-download-transfer-store";
import { retainRuntimeBrowserClientPageRecord } from "../source/main/runtime/browser/client-pages/runtime-browser-client-page-release";
import { setMainUiLanguage } from "../source/main/i18n/main-i18n";
import { normalizeExternalBrowserUrl } from "../source/shared/browser-url";
import { installMainWindowWebviewSecurity } from "../source/main/window/main-window-webview-security";
import { BROWSER_IDENTITY_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-identity-rpc";
import { initializeBrowserIdentityModeStore } from "../source/main/browser/identity/mode/browser-identity-mode-store";
import { BrowserHostBridge } from "./host-bridge";
import { setBrowserHostTransport } from "../source/main/ipc/runtime-environments/runtime-environment-transport-routing";
import {
  initializeBrowserExtensionSupport,
  switchBrowserExtensionSupport,
} from "../source/main/browser/extensions/browser-extension-startup";
import { BROWSER_CLIENT_HOST_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-client-host";
import { BROWSER_SCREENCAST_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-screencast";
import {
  BrowserClientHostAttachParams,
  BrowserNetworkTunnelAttachParams,
} from "../source/shared/browser/client-hosting/browser-client-host-protocol";
import { browserNetworkExecutionHostKey } from "../source/shared/browser/client-hosting/browser-network-execution-host";
import { AnnotationQueue } from "./annotation-queue";
import {
  getDefaultWorkspaceSession,
  getDefaultUIState,
} from "../source/shared/constants";
import { isBinaryBuffer } from "../source/shared/file-preview/binary-buffer";
import { resolveDocPreviewUrlFilePath } from "../source/main/browser/document-preview/doc-preview-grant-registry";
import { fileURLToPath } from "node:url";
import { realpath, stat, readFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  webContents,
} from "electron";
import { BrowserWorkspaceFiles } from "./workspace-files";
import { BROWSER_CLIENT_FILE_CHANNEL_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-client-file-channel";
import {
  BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
  BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
} from "../source/shared/browser/runtime/browser-runtime-capabilities";
import { BROWSER_CLIENT_HOST_REQUEST_CAPABILITY } from "../source/shared/browser/client-hosting/browser-client-host-request-protocol";
import { isAbsolute } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { browserManager } from "../source/main/browser/guest-lifecycle/manager/browser-manager";
import { AgentBrowserBridge } from "../source/main/browser/agent-browser/agent-browser-bridge";
import { OffscreenBrowserBackend } from "../source/main/browser/backends/offscreen-browser-backend";
import { RuntimeBrowserCommands } from "../source/main/runtime/browser/commands/browser-commands";
import type { RuntimeBrowserCommandHost } from "../source/main/runtime/browser/commands/browser-command-contracts";
import { BrowserHostLeaseRegistry } from "../source/main/runtime/browser-host/leases/browser-host-lease-registry";
import { BrowserHostRequestRegistry } from "../source/main/runtime/browser-host/leases/browser-host-request-registry";
import { RuntimeBrowserPageRegistry } from "../source/main/runtime/browser/client-pages/runtime-browser-page-registry";
import { browserSessionRegistry } from "../source/main/browser/sessions/profiles/browser-session-registry";
import {
  registerBrowserHandlers,
  setAgentBrowserBridgeRef,
} from "../source/main/ipc/browser/browser";
import { setTrustedBrowserRendererWebContentsId } from "../source/main/ipc/browser/browser-renderer-trust";
import {
  watchBrowserMainWindowReadiness,
  whenBrowserMainWindowReady,
  resetBrowserMainWindowReadiness,
} from "../source/main/browser/guest-lifecycle/browser-main-window-readiness";
import { BROWSER_CORE_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-core";
import { BROWSER_EXTRA_METHODS } from "../source/main/runtime/rpc/methods/browser/browser-extras";
import { installElectronBrowserCommands } from "../source/main/host/electron-browser-commands";
import { setAppEnvironment } from "../source/shared/app-environment";
import { ElectronAppEnvironment } from "../source/main/host/electron-app-environment";
import { Store } from "../source/main/persistence/loading-store/store";
import { BrowserError } from "../source/main/browser/browser-error";

export type BrowserCallParams = Record<string, unknown>;
export type BrowserCall = (
  method: string,
  params: BrowserCallParams,
) => Promise<unknown>;
export type BrowserService = { call: BrowserCall; shutdown(): Promise<void> };
export type BrowserServiceOptions = {
  dataDirectory: string;
  background: boolean;
  emit(event: { method: string; params: Record<string, unknown> }): void;
};

export async function createBrowserService(
  options: BrowserServiceOptions,
): Promise<BrowserService> {
  setAppEnvironment(new ElectronAppEnvironment());
  mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
  let window: BrowserWindow | null = null;
  let rendererId: number | null = null;
  const emit = (event: { method: string; params: Record<string, unknown> }) => {
    options.emit(event);
    if (window && !window.isDestroyed())
      window.webContents.send("javis:browser:event", event);
  };
  initializeBrowserClientHostId(options.dataDirectory);
  const workspace = new BrowserWorkspaceSessions(options.dataDirectory);
  const store = new Store(() => workspace.ui as import("../source/shared/persisted-ui-state-types").PersistedUIState);
  const hostBridge = new BrowserHostBridge(emit);
  setBrowserHostTransport(
    (target, method, params, timeout) =>
      hostBridge.call(target, method, params, timeout),
    (target, method, params, callbacks, config) =>
      hostBridge.subscribe(target, method, params, callbacks, config),
  );
  const uiSubscriptions = new Map<
    string,
    Awaited<ReturnType<BrowserHostBridge["subscribe"]>>
  >();
  const catalog = new BrowserHostCatalog(
    options.dataDirectory,
    hostBridge,
    () => {
      emit({
        method: "browser.contextCatalogChanged",
        params: { contexts: contextCatalog() },
      });
      emit({
        method: "browser.runtimeCatalogChanged",
        params: {
          environments: catalog.environments(),
          statuses: catalog.statusSnapshots(),
        },
      });
    },
    (id) =>
      emit({
        method: "browser.runtimeContactRestored",
        params: { environmentId: id },
      }),
  );
  const contextCatalog = () => [
    ...catalog.contexts(),
    ...workspace
      .contexts()
      .filter((id) => !catalog.hostForContext(id))
      .map((id) => ({
        id,
        root: isAbsolute(id.replace(/^cwd:/, ""))
          ? id.replace(/^cwd:/, "")
          : join(options.dataDirectory, "workspaces", encodeURIComponent(id)),
        owner: { kind: "local" as const },
      })),
  ];
  const annotations = new AnnotationQueue(
    join(options.dataDirectory, "annotation-deliveries.json"),
  );
  const runtimeId = randomUUID();
  const startedAt = Date.now();
  const subscriptions = new Map<
    string,
    { cleanup: () => void; connectionId: string }
  >();
  const connections = new Map<string, AbortController>();
  const delivery = new BrowserStreamDelivery(emit);
  const lifetime = new AbortController();
  const leases = new BrowserHostLeaseRegistry({
    authorityRuntimeId: runtimeId,
    onClientPageReleased: (page, generation) => {
      void releaseBrowserClientDownloadTransfersForPage(
        callerRuntime,
        page,
        generation,
      ).catch((error) =>
        console.warn("[browser] Transfer cleanup failed", error.message),
      );
    },
    onClientPageFenced: (page, placement) => {
      retainRuntimeBrowserClientPageRecord(callerRuntime, page, placement);
    },
  });
  const requests = new BrowserHostRequestRegistry();
  const pages = new RuntimeBrowserPageRegistry();
  rehydrateClientHostedBrowserPages(pages, {
    listWorkspaceSessions: () =>
      workspace.contexts().map((id) => workspace.session(id)),
    isKnownWorktree: (id) => workspace.contexts().includes(id),
  });
  const persistClientPages = (context: string) =>
    persistClientHostedBrowserPages(
      {
        getWorkspaceSession: (id) => workspace.session(id),
        setWorkspaceSession: (id, session) => workspace.save(id, session),
      },
      pages,
      context,
    );
  const bridge = new AgentBrowserBridge(browserManager);
  const offscreen = new OffscreenBrowserBackend(browserManager, {
    getAgentBrowserBridge: () => bridge,
    onPageNavigated: (page) => {
      serveTabs.navigated(page);
      emit({ method: "browser.pageNavigated", params: page });
    },
  });
  const serveTabs = new ServeBrowserTabs({
    backend: (context) =>
      host.isBrowserWorkspaceRendered?.(context) ? null : offscreen,
    livePageIds: (context) => new Set(bridge.getRegisteredTabs(context).keys()),
    savedWorktreeIds: () => workspace.contexts(),
    session: (context) => workspace.session(context),
    hostId: () => "local",
    save: (context, session) => workspace.save(context, session),
  });
  const host: RuntimeBrowserCommandHost = {
    getRuntimeId: () => runtimeId,
    getAgentBrowserBridge: () => bridge,
    getBrowserPageWorkspaceId: (page) =>
      browserManager.getWorktreeIdForTab(page) ?? workspace.owner(page),
    resolveWorkspaceSelector: async (selector) => ({
      id: browserContextId(selector),
      hostId: "local",
    }),
    resolveBrowserWorkspace: async (selector) => ({
      id: browserContextId(selector),
      hostId: "local",
    }),
    resolveBrowserNetworkExecutionHost: async (context) =>
      (await catalog.network(context?.id ?? workspace.context)) ?? {
        kind: "native",
        runtimeId,
        revision: startedAt,
      },
    getBrowserHostLeaseRegistry: () => leases,
    getBrowserHostRequestRegistry: () => requests,
    getRuntimeBrowserPageRegistry: () => pages,
    getAuthoritativeWindow: () => {
      if (!window || window.isDestroyed())
        throw new BrowserError(
          "browser_host_unavailable",
          "Browser workspace is closed",
        );
      return window;
    },
    getAvailableAuthoritativeWindow: () =>
      window && !window.isDestroyed() ? window : null,
    getOffscreenBrowserBackend: () => offscreen,
    isBrowserWorkspaceRendered: (context) =>
      Boolean(
        window &&
        !window.isDestroyed() &&
        (!context ||
          context === workspace.context ||
          context === FLOATING_TERMINAL_WORKTREE_ID),
      ),
    markHeadlessBrowserSessionTabActive: async (context, page) => {
      const owner = context ?? workspace.owner(page) ?? workspace.context;
      const session = workspace.session(owner);
      const saved = findSavedBrowserPage(session, owner, page);
      workspace.save(owner, {
        ...session,
        activeBrowserTabIdByWorktree: {
          ...session.activeBrowserTabIdByWorktree,
          [owner]: saved?.tabId ?? page,
        },
      });
    },
    notifyHeadlessBrowserSessionTabsChanged: (context) => {
      persistClientPages(context);
      emit({ method: "browser.tabsChanged", params: { context } });
    },
    readBrowserPageAnnotations: (page) => workspace.annotations(page),
    serveBrowserTabs: serveTabs,
    readBrowserTabBar: (context) =>
      (context ? [context] : workspace.contexts()).flatMap((owner) =>
        (workspace.session(owner).browserTabsByWorktree?.[owner] ?? []).flatMap(
          (tab) => {
            const pageId = tab.activePageId ?? tab.pageIds?.[0];
            const page = pageId
              ? findSavedBrowserPage(workspace.session(owner), owner, pageId)
                  ?.page
              : undefined;
            return page
              ? [
                  {
                    browserPageId: page.id,
                    worktreeId: owner,
                    title: page.title,
                    url: page.url,
                    loadError: null,
                    certificateFailure: null,
                  },
                ]
              : [];
          },
        ),
      ),
    retireRuntimeOwnedBrowserSessionTab: (context, page) =>
      serveTabs.closed(context, page),
  };
  const commands = new RuntimeBrowserCommands(host);
  const methods = new Map(
    [
      ...BROWSER_CORE_METHODS,
      ...BROWSER_EXTRA_METHODS,
      ...BROWSER_IDENTITY_METHODS,
      ...BROWSER_CLIENT_HOST_METHODS,
      ...BROWSER_SCREENCAST_METHODS,
      ...BROWSER_CLIENT_FILE_CHANNEL_METHODS,
    ].map((method) => [method.name, method]),
  );
  installElectronBrowserCommands();
  initializeBrowserExtensionSupport({
    enabled: store.getSettings().browserExtensionsEnabled !== false,
    savedBrowserTabs: workspace,
  });
  initializeBrowserSessionsForApp({
    orcaProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
    profileDirectory: options.dataDirectory,
  });
  browserSiteDisplayController.followZoomSettings({
    getUI: () => store.getUI(),
    onUIChanged: (listener) => workspace.onUIChanged(listener),
  });
  browserManager.setSiteDisplayController(browserSiteDisplayController);
  await setMainUiLanguage(store.getSettings().uiLanguage);
  browserSessionRegistry.onProfilesChanged = () => {
    window?.webContents.send("browser:session:profilesChanged");
    emit({ method: "browser.profilesChanged", params: {} });
  };
  installDocPreviewProtocolHandler();
  registerDocPreviewGrantHandlers();
  setAgentBrowserBridgeRef(bridge);
  registerBrowserHandlers(store);
  const files = new BrowserWorkspaceFiles((context) => {
    const selector = context.replace(/^(?:id:|cwd:)/, "");
    const root = isAbsolute(selector)
      ? selector
      : join(options.dataDirectory, "workspaces", encodeURIComponent(selector));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
  });
  const sessionSnapshots = new Map<string, RuntimeMobileSessionTabsResult>();
  const callerRuntime = Object.assign(Object.create(commands), host, {
    actOnClientPageInitialization: async (params: z.infer<typeof BrowserPageInitializationActionParams>) => {
      const current = captureRuntimeBrowserInitializationAction(pages, leases, params.page, params.expectedPlacement);
      const selected = await host.resolveBrowserWorkspace(params.worktree);
      const page = current();
      if (page.workspaceId !== selected.id) throw new BrowserError("browser_page_workspace_mismatch", "Browser page belongs to another context");
      const completion = actOnRuntimeBrowserInitialization({
        pages, authority: leases, page, action: params.action, explicitUrl: true,
        resolveExecutionHostKey: (id) => callerRuntime.resolveBrowserExecutionHostKeyForWorkspace(id),
        notifyWorkspace: (id) => callerRuntime.notifyMobileSessionTabsChanged(id),
      });
      void completion.catch(() => {});
    },
    listMobileSessionTabs: async (selector: string): Promise<RuntimeMobileSessionTabsResult> => {
      const context = browserContextId(selector.replace(/^id:/, ""));
      const listing = await commands.browserTabList({ worktree: context });
      const saved = workspace.session(context);
      const browserTabs: RuntimeMobileSessionTabsResult["tabs"] = listing.tabs.map((tab) => {
        const owned = pages.getPage(tab.browserPageId);
        const active = tab.active;
        return {
          type: "browser", id: findSavedBrowserPage(saved, context, tab.browserPageId)?.tabId ?? tab.browserPageId,
          title: tab.title, browserWorkspaceId: context, browserPageId: tab.browserPageId,
          ...(tab.profileId ? { browserProfileId: tab.profileId } : {}),
          ...(owned ? { placement: owned.placement, executionHostKey: owned.executionHostKey, initializationState: leases.clientPageInitializations.status(owned.browserPageId, owned.placement) } : {}),
          url: tab.url, loading: owned?.loading ?? false, canGoBack: owned?.canGoBack ?? false,
          canGoForward: owned?.canGoForward ?? false, isActive: active,
          loadError: tab.loadError, certificateFailure: tab.certificateFailure,
        };
      });
      const editorTabs: RuntimeMobileSessionTabsResult["tabs"] = (saved.openFilesByWorktree?.[context] ?? []).map((file) => ({
        type: "file", id: file.filePath, title: basename(file.filePath), filePath: file.filePath,
        relativePath: file.relativePath, language: file.language, mode: "edit",
        isDirty: file.dirtyDraftContent !== undefined, isActive: saved.activeFileIdByWorktree?.[context] === file.filePath,
        ...(file.runtimeEnvironmentId ? { hostRuntimeEnvironmentId: file.runtimeEnvironmentId } : {}),
      }));
      const tabs = [...browserTabs, ...editorTabs];
      const ids = new Set(tabs.map((tab) => tab.id));
      const groups = (saved.tabGroups?.[context] ?? []).map((group) => ({ ...group, tabOrder: group.tabOrder.filter((id) => ids.has(id)), activeTabId: ids.has(group.activeTabId ?? "") ? group.activeTabId : null })).filter((group) => group.tabOrder.length > 0);
      const active = tabs.find((tab) => tab.id === saved.activeTabIdByWorktree?.[context]) ?? tabs.find((tab) => tab.isActive) ?? tabs[0];
      const previous = sessionSnapshots.get(context);
      const snapshot = reuseEqualJson(previous, {
        worktree: context, publicationEpoch: runtimeId, snapshotVersion: previous?.snapshotVersion ?? 0,
        activeGroupId: groups.find((group) => group.id === saved.activeGroupIdByWorktree?.[context])?.id ?? groups[0]?.id ?? null,
        activeTabId: active?.id ?? null, activeTabType: active?.type ?? null,
        tabGroups: groups, ...(groups.length === (saved.tabGroups?.[context]?.length ?? 0) ? { tabGroupLayout: saved.tabGroupLayouts?.[context] } : {}),
        tabs: tabs.map((tab) => ({ ...tab, isActive: tab.id === active?.id })),
      });
      if (snapshot === previous) return previous;
      const published = { ...snapshot, snapshotVersion: (previous?.snapshotVersion ?? 0) + 1 };
      sessionSnapshots.set(context, published);
      return published;
    },
    getStartedAt: () => startedAt,
    resolveRuntimeFileTarget: async () => ({ executionHostId: "local" }),
    readFileExplorerChunk: files.readFileExplorerChunk.bind(files),
    writeFileExplorerFileBase64Chunk:
      files.writeFileExplorerFileBase64Chunk.bind(files),
    commitFileExplorerUpload: files.commitFileExplorerUpload.bind(files),
    deleteFileExplorerPath: files.deleteFileExplorerPath.bind(files),
    createFileExplorerDir: files.createFileExplorerDir.bind(files),
    statRuntimeFile: files.statRuntimeFile.bind(files),
    registerSubscriptionCleanup: (
      id: string,
      cleanup: () => void,
      connectionId = "javis-controller",
    ) => subscriptions.set(id, { cleanup, connectionId }),
    cleanupSubscription: (id: string) => {
      subscriptions.get(id)?.cleanup();
      subscriptions.delete(id);
    },
    notifyMobileSessionTabsChanged: (context: string) => {
      persistClientPages(context);
      for (const clientId of new Set(
        pages
          .listPages(context)
          .map((page) => page.placement.browserHostClientId),
      )) {
        let lease;
        try {
          lease = leases.select(clientId);
        } catch {
          continue;
        }
        emit({
          method: "browser.clientHost.pages",
          params: {
            authorityRuntimeId: lease.authorityRuntimeId,
            authorityEpoch: lease.authorityEpoch,
            browserHostClientId: lease.browserHostClientId,
            browserHostGeneration: lease.browserHostGeneration,
            pairedDeviceId: lease.pairedDeviceId,
            __javisConnectionId: lease.connectionId,
            pages: pages
              .listPages(context)
              .filter(
                (page) =>
                  page.placement.browserHostClientId === clientId &&
                  page.placement.browserHostGeneration ===
                    lease.browserHostGeneration &&
                  page.pairedDeviceId === lease.pairedDeviceId,
              ),
          },
        });
      }
      rows.publish(context);
      emit({ method: "browser.tabsChanged", params: { context } });
    },
    resolveBrowserExecutionHostKeyForWorkspace: async () => ({
      status: "resolved",
      executionHostKey: browserNetworkExecutionHostKey({
        kind: "native",
        runtimeId,
        revision: startedAt,
      }),
    }),
    markClientHostedPagesReconciled: (id: string) =>
      emit({
        method: "browser.clientHost.reconciled",
        params: { pairedDeviceId: id },
      }),
    browserScreencast: (
      params: Parameters<RuntimeBrowserCommands["browserScreencast"]>[0],
      stream: Parameters<RuntimeBrowserScreencastController["start"]>[1],
    ) => screencasts.start(params, stream),
  });
  const drivers = new RuntimeBrowserDriverController({
    notifyChanged: (page, driver) => {
      window?.webContents.send("runtime:browserDriverChanged", {
        browserPageId: page,
        driver,
      });
      emit({
        method: "browser.driverChanged",
        params: { browserPageId: page, driver },
      });
    },
    cancelScreencast: (page) => screencasts.cancelMobilePage(page, true),
  });
  const screencasts = new RuntimeBrowserScreencastController({
    getCommands: () => commands,
    registerSubscriptionCleanup: (
      id,
      cleanup,
      connectionId = "javis-controller",
    ) => subscriptions.set(id, { cleanup, connectionId }),
    cleanupSubscription: (id) => {
      subscriptions.get(id)?.cleanup();
      subscriptions.delete(id);
    },
    getDriver: (page) => drivers.get(page),
    setDriver: (page, driver) => drivers.set(page, driver),
    notifyRemoteViewersChanged: (page, hasRemoteViewers) => {
      window?.webContents.send("runtime:browserRemoteViewersChanged", {
        browserPageId: page,
        hasRemoteViewers,
      });
      emit({
        method: "browser.remoteViewersChanged",
        params: { browserPageId: page, hasRemoteViewers },
      });
    },
  });
  const rows = new ClientHostedBrowserRowPublisher({
    listClientPages: (context) => pages.listPages(context),
    hasLivePlacement: (page) => leases.getPlacement(page) !== undefined,
    resolveDeviceName: () => null,
    getEmitter: () =>
      window
        ? (event) =>
            window!.webContents.send(
              "runtime:clientHostedBrowserRowsChanged",
              event,
            )
        : null,
  });
  const keybindings = new KeybindingService({
    homePath: options.dataDirectory,
  });
  const call: BrowserCall = async (method, params) => {
    if (method === "browser.workspaceSnapshot") return callerRuntime.listMobileSessionTabs(typeof params.worktree === "string" ? params.worktree : workspace.context);
    if (method === "__shutdown") {
      await shutdown();
      return { stopped: true };
    }
    if (method === "browser.stream.delivery")
      return { accepted: delivery.acknowledge(params as any) };
    if (method === "browser.stream.flow") {
      delivery.flow(String(params.connectionId), params.backlogged === true);
      return { updated: true };
    }
    if (method === "browser.remotePageStatuses") {
      emit({ method: "browser.remotePageStatuses", params });
      return { updated: true };
    }
    if (method === "browser.catalog.invoke") {
      if (!String(params.method).startsWith("browser."))
        throw new BrowserError(
          "invalid_argument",
          "Unknown browser runtime method",
        );
      return catalog.call(
        String(params.selector),
        String(params.method),
        params.params,
      );
    }
    if (method === "browser.catalog.create") {
      if ((await whenBrowserMainWindowReady(8000)) !== window)
        throw new BrowserError(
          "browser_host_unavailable",
          "Open the local browser workspace before hosting client pages",
        );
      const created = await catalog.create(params as any);
      emit({
        method: "browser.remotePageCreated",
        params: { ...created, url: params.url ?? "about:blank" },
      });
      return created;
    }
    if (method === "browser.catalog.context")
      return catalog.registerContext(params);
    if (method === "browser.catalog.list")
      return { hosts: catalog.list(), contexts: catalog.contexts() };
    if (method === "browser.catalog.register") return catalog.register(params);
    if (method === "browser.catalog.remove")
      return catalog.remove(String(params.id));
    if (method === "browser.catalog.refresh") {
      await Promise.allSettled(
        catalog.list().map((host) => catalog.probe(host.id)),
      );
      return { hosts: catalog.list(), contexts: catalog.contexts() };
    }
    if (method === "browser.clientHost.pageStatus") {
      const page = pages.getPage(String(params.page));
      if (!page)
        throw new BrowserError(
          "browser_tab_not_found",
          "Client page is unavailable",
        );
      if (
        (params.__javisCaller as any)?.clientKind !== "runtime" ||
        page.pairedDeviceId !== (params.__javisCaller as any)?.pairedDeviceId
      )
        throw new BrowserError(
          "forbidden",
          "Client page belongs to another authenticated device",
        );
      return page;
    }
    if (method === "browser.driver.get")
      return {
        driver: drivers.get(String(params.page)),
        remoteViewerPages: screencasts.getRemoteViewerPages(),
      };
    if (method === "browser.connection.close") {
      const id = String(params.connectionId);
      connections.get(id)?.abort();
      connections.delete(id);
      delivery.close(id);
      for (const [key, entry] of subscriptions)
        if (entry.connectionId === id) {
          entry.cleanup();
          subscriptions.delete(key);
        }
      return { closed: true };
    }
    if (method === "browser.host.call") {
      if (
        ![
          "files.stat",
          "files.readChunk",
          "files.writeBase64Chunk",
          "files.commitUpload",
        ].includes(String(params.method))
      )
        throw new BrowserError(
          "invalid_argument",
          "Unknown browser file method",
        );
      const response = await hostBridge.call(
        String(params.target),
        String(params.method),
        params.params,
      );
      if (!response.ok)
        throw new BrowserError(
          response.error.code,
          response.error.message,
          response.error.data,
        );
      return response.result;
    }
    if (method === "browser.host.configure") {
      hostBridge.configure(params.routes as Record<string, string>);
      return { configured: true };
    }
    if (method === "browser.host.admit") {
      const request = BrowserNetworkTunnelAttachParams.parse(params.params);
      if (request.authorityRuntimeId !== runtimeId)
        throw new BrowserError(
          "invalid_argument",
          "Browser network authority mismatch",
        );
      const identity = {
        authorityEpoch: request.authorityEpoch,
        browserHostClientId: request.browserHostClientId,
        browserHostGeneration: request.browserHostGeneration,
        pairedDeviceId: String(
          (params.__javisCaller as any)?.pairedDeviceId ?? "javis-controller",
        ),
        executionHostKey: browserNetworkExecutionHostKey(request.executionHost),
      };
      leases.requireLease(identity);
      if (request.executionHost.kind !== "native")
        leases.requireExecutionHost(identity, identity.executionHostKey);
      else if (
        request.executionHost.runtimeId !== runtimeId ||
        request.executionHost.revision !== startedAt
      )
        throw new BrowserError(
          "invalid_argument",
          "Browser network execution host is stale",
        );
      const id = String(params.id);
      const connectionId = String(
        (params.__javisCaller as any)?.connectionId ?? "javis-controller",
      );
      const existing = subscriptions.get(`host-network:${id}`);
      if (existing && existing.connectionId !== connectionId)
        throw new BrowserError(
          "invalid_argument",
          "Browser tunnel belongs to another connection",
        );
      existing?.cleanup();
      const handle = leases.openTunnel(identity, {
        requireExecutionHostGrant: request.executionHost.kind !== "native",
      });
      subscriptions.set(`host-network:${id}`, {
        cleanup: handle.release,
        connectionId,
      });
      void handle.whenFenced.then((reason) => {
        if (subscriptions.get(`host-network:${id}`)?.cleanup === handle.release)
          subscriptions.delete(`host-network:${id}`);
        emit({
          method: "browser.host.revoked",
          params: { id, reason, __javisConnectionId: connectionId },
        });
      });
      return {
        admitted: true,
        tunnelGeneration: handle.tunnelGeneration,
        _meta: { runtimeId },
      };
    }
    if (method === "browser.host.release") {
      const key = `host-network:${params.id}`;
      const entry = subscriptions.get(key);
      const connectionId = String(
        (params.__javisCaller as any)?.connectionId ?? "javis-controller",
      );
      if (entry && entry.connectionId !== connectionId)
        throw new BrowserError(
          "invalid_argument",
          "Browser tunnel belongs to another connection",
        );
      entry?.cleanup();
      subscriptions.delete(key);
      return { released: entry !== undefined };
    }
    if (method === "browser.host.invokeReply")
      return { accepted: hostBridge.invocationReply(params as any) };
    if (method === "browser.host.subscription")
      return { accepted: hostBridge.subscriptionReply(params as any) };
    if (method === "browser.host.closed")
      return { accepted: hostBridge.subscriptionClosed(String(params.id)) };
    if (method === "browser.host.binary")
      return { accepted: hostBridge.binary(params as any) };
    if (method === "browser.host.reply")
      return { accepted: hostBridge.reply(params) };
    if (method === "browser.annotations.targets")
      return {
        context: params.context ?? workspace.context,
        targets: [
          {
            id: "context-queue",
            label: "Context queue",
            kind: "queue",
            available: true,
          },
        ],
        consumers: [],
      };
    if (method === "browser.annotations.enqueue") {
      const result = annotations.enqueue(params);
      emit({
        method: "browser.annotations.changed",
        params: {
          context: params.context,
          delivery: annotations.get(result.id),
        },
      });
      return result;
    }
    if (method === "browser.annotations.list")
      return annotations.list(
        typeof params.context === "string" ? params.context : undefined,
        params.includeAcknowledged === true,
      );
    if (method === "browser.annotations.ack") {
      const result = annotations.acknowledge(String(params.id));
      emit({
        method: "browser.annotations.acknowledged",
        params: { ...result, delivery: annotations.get(String(params.id)) },
      });
      return result;
    }
    if (method === "browser.status")
      return {
        running: true,
        pid: process.pid,
        protocolVersion: 1,
        hostInstanceId: getBrowserClientHostId(),
        capabilities: [
          ...BROWSER_CLIENT_HOSTING_RUNTIME_CAPABILITIES,
          BROWSER_SCREENCAST_RUNTIME_CAPABILITY,
        ],
        runtimeId,
        startedAt,
        authorityEpoch: leases.authorityEpoch,
        pages: bridge.tabList().tabs,
        visible: window?.isVisible() ?? false,
      };
    if (method === "browser.open") {
      const changed =
        typeof params.worktree === "string" &&
        workspace.select(params.worktree);
      // Renderer ownership replaces only the selected context's offscreen guests; their saved rows remain.
      for (const [page] of bridge.getRegisteredTabs(workspace.context))
        if (offscreen.ownsTab(page)) await offscreen.closeTab(page);
      const createsWindow = !window || window.isDestroyed();
      if (createsWindow) {
        const directory = __dirname;
        window = new BrowserWindow({
          show: false,
          width: 1280,
          height: 800,
          webPreferences: {
            additionalArguments: [
              formatBrowserClientHostIdArgument(getBrowserClientHostId()),
            ],
            preload: join(directory, "../preload/javis-browser.cjs"),
            webviewTag: true,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        rendererId = window.webContents.id;
        window.webContents.ipc.on("browser:tabRequestsReady", () =>
          attachBrowserClientPageRenderer(window!.webContents),
        );
        window.webContents.on("destroyed", () => {
          if (window) retireBrowserClientPageRenderer(window.webContents);
        });
        trackBrowserExtensionMainWindow(window);
        installMainWindowWebviewSecurity(window);
        setTrustedBrowserRendererWebContentsId(window.webContents.id);
        watchBrowserMainWindowReadiness(window);
        window.on("closed", () => {
          window = null;
          setTrustedBrowserRendererWebContentsId(null);
        });
        await window.loadFile(join(directory, "../renderer/index.html"));
        window.webContents.send("javis:browser:event", {
          method: "browser.contextChanged",
          params: {
            context: workspace.context,
            generation: workspace.generation,
          },
        });
      }
      if (changed && !createsWindow) {
        resetBrowserMainWindowReadiness(window!);
        emit({
          method: "browser.contextChanged",
          params: {
            context: workspace.context,
            generation: workspace.generation,
          },
        });
      }
      const openedWindow = window;
      const readyWindow = await whenBrowserMainWindowReady(8000);
      if (
        !openedWindow ||
        openedWindow.isDestroyed() ||
        readyWindow !== openedWindow ||
        window !== openedWindow
      )
        throw new BrowserError(
          "browser_host_unavailable",
          "Browser workspace did not finish initializing",
        );
      if (
        process.env.ORCA_BACKGROUND_LAUNCH !== "1" &&
        (params.__javisForeground === true || !options.background)
      )
        openedWindow.show();
      return {
        opened: true,
        background: options.background,
        context: workspace.context,
      };
    }
    const remoteOwner =
      typeof params.worktree === "string"
        ? catalog.hostForContext(params.worktree.replace(/^id:/, ""))
        : typeof params.page === "string"
          ? catalog
              .list()
              .find((host) =>
                pairedRuntimeBrowserClientHostsPage(
                  host.id,
                  params.page as string,
                ),
              )
          : undefined;
    if (remoteOwner && method === "browser.tabCreate") {
      const created = await catalog.create({
        context:
          params.worktree?.toString().replace(/^id:/, "") ??
          catalog.contextId(remoteOwner.id),
        url: params.url as string | undefined,
        page: params.page as string | undefined,
        profileId: params.profileId as string | undefined,
        preference:
          (params.placement as { kind?: "server" })?.kind === "server"
            ? "server"
            : "auto",
      });
      emit({
        method: "browser.remotePageCreated",
        params: { ...created, url: params.url ?? "about:blank" },
      });
      return created;
    }
    if (remoteOwner) {
      const response = await catalog.call(remoteOwner.id, method, params);
      if (!response.ok)
        throw new BrowserError(
          response.error.code,
          response.error.message,
          response.error.data,
        );
      return response.result;
    }
    const clientRoute = await routeRuntimeBrowserClientAutomation({
      method,
      params,
      caller: undefined,
      pages,
      leases,
      resolveWorkspace: host.resolveBrowserWorkspace,
      resolveWorkspacePath: async (context) => {
        const root = contextCatalog().find((entry) => entry.id === browserContextId(context))?.root;
        if (!root) throw new BrowserError("browser_workspace_not_found", "Browser context has no workspace root");
        return root;
      },
      resolveExecutionHostKey: (context) => callerRuntime.resolveBrowserExecutionHostKeyForWorkspace(context),
      notifyWorkspace: (context) => callerRuntime.notifyMobileSessionTabsChanged(context),
    });
    if (clientRoute.handled) return clientRoute.result;
    const definition = methods.get(method);
    if (!definition)
      throw new BrowserError(
        "invalid_argument",
        `Unknown browser method: ${method}`,
      );
    const parsed = definition.params
      ? definition.params.parse(params)
      : undefined;
    const connectionId = String(
      (params.__javisCaller as any)?.connectionId ?? "javis-controller",
    );
    let connection = connections.get(connectionId);
    if (!connection) {
      connection = new AbortController();
      connections.set(connectionId, connection);
    }
    const attachParams =
      method === "browser.clientHost.attach"
        ? BrowserClientHostAttachParams.parse(params)
        : undefined;
    let subscriptionId: string | undefined;
    const streamEmit = (event: any) => {
      if (typeof event.subscriptionId === "string") {
        subscriptionId = event.subscriptionId;
        delivery.replace(connectionId, event.subscriptionId);
      }
      emit({
        method,
        params: {
          ...event,
          ...(method === "browser.clientHost.attach"
            ? {
                __javisAttachId: params.__javisAttachId,
                authorityRuntimeId: runtimeId,
                browserHostClientId: attachParams?.browserHostClientId,
                pairedDeviceId:
                  (params.__javisCaller as any)?.pairedDeviceId ??
                  "javis-controller",
              }
            : {}),
          __javisConnectionId: connectionId,
        },
      });
    };
    const context = {
      runtime: callerRuntime,
      clientKind: (params.__javisCaller as any)?.clientKind ?? "runtime",
      connectionId:
        (params.__javisCaller as any)?.connectionId ?? "javis-controller",
      pairedDeviceId:
        (params.__javisCaller as any)?.pairedDeviceId ?? "javis-controller",
      clientCapabilities: (params.__javisCaller as any)?.clientCapabilities ?? [
        BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY,
        BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY,
        BROWSER_CLIENT_HOST_REQUEST_CAPABILITY,
      ],
      signal: connection.signal,
      sendBinary: (
        bytes: Uint8Array,
        options?: { dropWhenBacklogged?: boolean },
      ) =>
        delivery.send(
          connectionId,
          subscriptionId,
          method,
          bytes,
          options?.dropWhenBacklogged === true,
        ),
    };
    const result = (definition as any).streaming
      ? await new Promise<any>((resolve, reject) => {
          let ready = false;
          Promise.resolve(
            runWithRequestedPageUrl(parsed, () =>
              definition.handler(parsed, context, (event) => {
                streamEmit(event);
                if (event.type === "ready") {
                  ready = true;
                  resolve(event);
                }
              }),
            ),
          ).then(
            (value) => {
              if (method === "browser.clientHost.attach")
                streamEmit({ type: "end" });
              if (!ready) resolve(value);
            },
            (error) => {
              if (method === "browser.clientHost.attach")
                streamEmit({ type: "error" });
              reject(error);
            },
          );
        })
      : await runWithRequestedPageUrl(parsed, () =>
          definition.handler(parsed, context, streamEmit),
        );
    if (method === "browser.tabSetProfile" && result)
      workspace.setProfile(result.browserPageId, result.profileId);
    return result;
  };
  configureBrowserClientPageAutomationRuntime({
    browserManager,
    getAgentBrowserBridge: () => bridge,
    executeRpc: async (method, params, _agent, signal) => {
      if (signal.aborted)
        throw new Error("browser_client_page_command_aborted");
      const definition = methods.get(method);
      if (!definition)
        throw new BrowserError("invalid_argument", "Unknown browser action");
      const parsed = definition.params
        ? definition.params.parse(params)
        : undefined;
      return runWithRequestedPageUrl(parsed, () =>
        definition.handler(parsed, { runtime: callerRuntime }, () => {}),
      );
    },
  });
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender.id !== window.webContents.id)
      throw new BrowserError("invalid_argument", "Untrusted browser workspace");
  };
  const trustedPersistence = (event: Electron.IpcMainInvokeEvent) => {
    if (stopping && event.sender.id === rendererId) return;
    trusted(event);
  };
  ipcMain.handle("javis:browser:call", async (event, method, params) => {
    trusted(event);
    if (method === "agent.status" || method === "agent.install") {
      const response = await hostBridge.call("local", method, params);
      if (!response.ok)
        throw new BrowserError(response.error.code, response.error.message);
      return response.result;
    }
    return call(method, params);
  });
  ipcMain.handle("javis:browser:bootstrap", async (event) => {
    trusted(event);
    await Promise.allSettled(
      catalog.list().map((host) => catalog.probe(host.id)),
    );
    return {
      context: workspace.context,
      host: "local",
      ui: workspace.ui,
      generation: workspace.generation,
      settings: store.getSettings(),
      session: workspace.session(),
      contexts: contextCatalog(),
      runtimeEnvironments: catalog.environments(),
      runtimeStatuses: catalog.statusSnapshots(),
    };
  });
  ipcMain.handle("javis:browser:persist-workspace", (event, input) => {
    trustedPersistence(event);
    workspace.replace(input);
    return true;
  });
  ipcMain.handle("javis:browser:prepare-client-host", async (event, args) => {
    trusted(event);
    if ((await whenBrowserMainWindowReady(8000)) !== window)
      throw new BrowserError(
        "browser_host_unavailable",
        "Renderer is unavailable",
      );
    return catalog.prepare(args);
  });
  ipcMain.handle("javis:browser:runtime-invoke", async (event, args) => {
    trusted(event);
    if (args.method === "runtime.status")
      args = { ...args, method: "browser.status" };
    if (!String(args.method).startsWith("browser."))
      throw new BrowserError(
        "invalid_argument",
        "Unknown browser runtime method",
      );
    if (args.selector === "local") return { ok: true, result: await call(args.method, args.params ?? {}), _meta: { runtimeId } };
    const response = await catalog.call(args.selector, args.method, args.params, args.expectedEnvironmentPairingRevision);
    if (response.ok && (args.method === "browser.workspaceSnapshot" || args.method === "browser.clientPage.initializationAction") && typeof response.result?.publicationEpoch === "string") return { ...response, _meta: { ...response._meta, runtimeId: response.result.publicationEpoch } };
    return response;
  });
  ipcMain.handle("javis:browser:subscribe", async (event, args) => {
    trusted(event);
    if (args.method !== "browser.screencast")
      throw new BrowserError(
        "invalid_argument",
        "Unknown browser subscription",
      );
    const forward = (message: Record<string, unknown>) =>
      event.sender.send("javis:browser:subscription", {
        subscriptionId: args.subscriptionId,
        ...message,
      });
    const handle = await hostBridge.subscribe(
      args.selector,
      args.method,
      args.selector === "local"
        ? args.params
        : catalog.nativeParams(args.selector, args.params),
      {
        onResponse: (response) => forward({ type: "response", response }),
        onPacket: (packet) => forward({ type: "binary", packet }),
        onError: (error) =>
          forward({ type: "error", code: error.code, message: error.message }),
        onClose: () => forward({ type: "close" }),
      },
      {
        javisCaller: {
          connectionId: `renderer:${event.sender.id}:${args.subscriptionId}`,
          pairedDeviceId: "javis-controller",
          clientKind: "runtime",
        },
      },
    );
    uiSubscriptions.set(args.subscriptionId, handle);
    return { id: handle.requestId };
  });
  ipcMain.handle("javis:browser:unsubscribe", (event, id) => {
    trusted(event);
    uiSubscriptions.get(id)?.close();
    uiSubscriptions.delete(id);
    return true;
  });
  ipcMain.handle("javis:browser:subscription-request", (event, args) => {
    trusted(event);
    const handle = uiSubscriptions.get(args.id);
    if (!handle?.sendRequest) throw new Error("browser_subscription_closed");
    return handle
      .sendRequest(args.method, args.params, 15000)
      .then((response) => {
        if (args.method === "browser.screencast.ack")
          hostBridge.flow({ id: handle.requestId, backlogged: false });
        return response;
      });
  });
  ipcMain.on("javis:browser:subscription-delivery", (event, args) => {
    if (window && event.sender.id === window.webContents.id) {
      hostBridge.delivery(args);
      if (args.outcome !== "backlogged")
        hostBridge.flow({ id: args.id, backlogged: false });
    }
  });
  const authorizedHtml = async (filePath: string) => {
    if (!/\.html?$/i.test(filePath))
      throw new BrowserError(
        "invalid_argument",
        "Only browser HTML artifacts are readable through this bridge",
      );
    const path = await realpath(filePath);
    for (const id of browserManager.getWebContentsIdByTabId().values()) {
      const guest = webContents.fromId(id);
      try {
        const url = guest?.getURL();
        const opened = url?.startsWith("file:")
          ? fileURLToPath(url)
          : url
            ? resolveDocPreviewUrlFilePath(url)
            : null;
        if (opened && (await realpath(opened)) === path) return path;
      } catch {}
    }
    throw new BrowserError(
      "forbidden",
      "The HTML file is not loaded in an owned browser page",
    );
  };
  ipcMain.handle("javis:browser:fs-stat", async (event, args) => {
    trusted(event);
    const value = await stat(await authorizedHtml(args.filePath));
    return {
      size: value.size,
      isDirectory: value.isDirectory(),
      mtimeMs: value.mtimeMs,
    };
  });
  ipcMain.handle("javis:browser:fs-read", async (event, args) => {
    trusted(event);
    const path = await authorizedHtml(args.filePath);
    const value = await stat(path);
    if (value.size > 20 * 1024 * 1024)
      throw new BrowserError("invalid_argument", "HTML artifact is too large");
    const bytes = await readFile(path);
    return { content: bytes.toString("utf8"), isBinary: isBinaryBuffer(bytes) };
  });
  ipcMain.handle("settings:get", (event) => {
    trusted(event);
    return store.getSettings();
  });
  ipcMain.handle("settings:set", (event, patch) => {
    trusted(event);
    store.updateSettings(patch);
    if ("uiLanguage" in patch) void setMainUiLanguage(patch.uiLanguage);
    if ("browserExtensionsEnabled" in patch)
      void switchBrowserExtensionSupport(
        patch.browserExtensionsEnabled !== false,
      );
    window?.webContents.send("settings:changed", patch);
    return store.getSettings();
  });
  ipcMain.on("settings:get-sync", (event) => {
    if (window && event.sender.id === window.webContents.id)
      event.returnValue = store.getSettings();
  });
  ipcMain.handle("ui:get", (event) => {
    trusted(event);
    return workspace.ui;
  });
  ipcMain.handle("ui:set", (event, patch) => {
    trusted(event);
    workspace.updateUI(patch);
    window?.webContents.send("ui:stateChanged", workspace.ui);
    return workspace.ui;
  });
  ipcMain.handle("app:get-locale", (event) => {
    trusted(event);
    return app.getLocale();
  });
  ipcMain.handle("app:get-version", (event) => {
    trusted(event);
    return app.getVersion();
  });
  ipcMain.handle("clipboard:writeText", (event, text) => {
    trusted(event);
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("app:await-before-unload-checkpoint", (event) => {
    trustedPersistence(event);
    workspace.save(workspace.context, workspace.session());
    return { ok: true };
  });
  ipcMain.handle("shell:openUrl", (event, url) => {
    trusted(event);
    const target = normalizeExternalBrowserUrl(url);
    if (!target)
      throw new BrowserError("invalid_argument", "Invalid external URL");
    return shell.openExternal(target);
  });
  ipcMain.handle("ui:recordFeatureInteraction", (event, id) => {
    trusted(event);
    workspace.updateUI({
      featureInteractions: {
        ...(workspace.ui.featureInteractions ?? {}),
        [id]: Date.now(),
      },
    });
    return true;
  });
  ipcMain.handle("runtime:getBrowserDrivers", (event) => {
    trusted(event);
    return [...drivers.getAll()].map(([browserPageId, driver]) => ({
      browserPageId,
      driver,
    }));
  });
  ipcMain.handle("runtime:getBrowserRemoteViewerPages", (event) => {
    trusted(event);
    return screencasts.getRemoteViewerPages();
  });
  ipcMain.handle("runtime:getClientHostedBrowserRows", (event) => {
    trusted(event);
    return rows.deliverHydrationSnapshot();
  });
  ipcMain.handle(
    "runtime:reclaimBrowserForDesktop",
    (event, { browserPageId }) => {
      trusted(event);
      return { reclaimed: drivers.reclaimForDesktop(browserPageId) };
    },
  );
  ipcMain.handle("keybindings:get", (event) => {
    trusted(event);
    return keybindings.getSnapshot();
  });
  ipcMain.handle("keybindings:ensureFile", (event) => {
    trusted(event);
    const snapshot = keybindings.ensureFile();
    window?.webContents.send("keybindings:changed", snapshot);
    return snapshot;
  });
  ipcMain.handle("keybindings:setAction", (event, args) => {
    trusted(event);
    const snapshot = keybindings.setActionBindings(
      args.actionId,
      args.bindings,
    );
    window?.webContents.send("keybindings:changed", snapshot);
    return snapshot;
  });
  ipcMain.handle("keybindings:openFile", async (event) => {
    trusted(event);
    const snapshot = keybindings.ensureFile();
    const error = await shell.openPath(snapshot.path);
    if (error) throw new Error(error);
    return snapshot;
  });
  ipcMain.handle("keybindings:revealFile", (event) => {
    trusted(event);
    const snapshot = keybindings.ensureFile();
    shell.showItemInFolder(snapshot.path);
    return snapshot;
  });
  ipcMain.handle("keybindings:reload", (event) => {
    trusted(event);
    const snapshot = keybindings.reload();
    window?.webContents.send("keybindings:changed", snapshot);
    return snapshot;
  });
  ipcMain.on("app:stage-before-unload-sync", (event, input) => {
    try {
      trustedPersistence(event as Electron.IpcMainInvokeEvent);
      if (input.args.sessions?.[0])
        workspace.replace({
          ...input.workspace,
          session: input.args.sessions[0].state,
        });
      if (input.workspace.context === workspace.context)
        workspace.updateUI(input.args.ui ?? {});
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: (error as Error).message };
    }
  });
  let stopping: Promise<void> | null = null;
  function shutdown(): Promise<void> {
    return (stopping ??= (async () => {
      lifetime.abort();
      for (const entry of subscriptions.values()) entry.cleanup();
      for (const connection of connections.values()) connection.abort();
      connections.clear();
      subscriptions.clear();
      for (const handle of uiSubscriptions.values()) handle.close();
      uiSubscriptions.clear();
      await shutdownPairedRuntimeBrowserClientHosts();
      hostBridge.close();
      await offscreen.destroyAll();
      await bridge.destroyAllSessions();
      if (window && !window.isDestroyed()) window.destroy();
      setAgentBrowserBridgeRef(null);
    })());
  }
  return { call, shutdown };
}
