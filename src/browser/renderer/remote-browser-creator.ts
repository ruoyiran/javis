import { browserBridge } from "./workspace-bootstrap";
import { registerPairedBrowserTabCreator } from "../source/renderer/src/store/slices/browser/tabs/paired-browser-tab-creator";
import {
  stageWebRuntimeBrowserTab,
  isStagedWebRuntimeBrowserTabLive,
  discardStagedWebRuntimeBrowserTab,
  rehomeStagedWebRuntimeBrowserTab,
  resolveStagedWebRuntimeBrowserTabGroupId,
  releaseHeldBrowserTabsTheServerLists,
} from "../source/renderer/src/runtime/browser/creation/web-runtime-browser-tab-staging";
import { useAppStore } from "../source/renderer/src/store";
import { javisContext } from "../source/renderer/src/store/workspaces/javis-context-catalog";
import type { RemoteBrowserPageHandle } from "../source/renderer/src/store/slices/browser/browser-slice-contract";
export function installJavisRemoteBrowserCreator(): void {
  const creating = new Set<string>();
  const cancelled = new Set<string>();
  const key = (environment: string, page: string) =>
    JSON.stringify([environment, page]);
  const closeOwned = async (
    environmentId: string,
    context: string,
    page: string,
  ) => {
    try {
      const response = (await browserBridge().call("browser.catalog.invoke", {
        selector: environmentId,
        method: "browser.tabClose",
        params: { page, worktree: `id:${context}` },
      })) as {
        ok: boolean;
        error?: { code?: string; message: string };
        result?: { closed?: boolean };
      };
      if (!response.ok && response.error?.code === "browser_tab_not_found")
        return;
      if (!response.ok || response.result?.closed === false)
        throw new Error(
          response.error?.message ?? "The remote page did not close",
        );
    } catch (error) {
      useAppStore
        .getState()
        .recordClientHostedBrowserCloseIntents([
          { environmentId, browserPageId: page, worktreeId: context },
        ]);
      throw error;
    }
  };

  const replayCloses = () => {
    for (const [environmentId, intents] of Object.entries(
      useAppStore.getState().clientHostedBrowserCloseIntentsByEnvironment,
    ))
      for (const intent of intents) {
        void closeOwned(environmentId, intent.worktreeId, intent.browserPageId)
          .then(() =>
            useAppStore
              .getState()
              .clearClientHostedBrowserCloseIntents(environmentId, [
                intent.browserPageId,
              ]),
          )
          .catch(() => {});
      }
  };
  replayCloses();
  browserBridge().onEvent((event) => {
    if (event.method === "browser.runtimeContactRestored") {
      for (const [environmentId, intents] of Object.entries(
        useAppStore.getState().clientHostedBrowserCloseIntentsByEnvironment,
      ))
        for (const intent of intents) {
          void closeOwned(
            environmentId,
            intent.worktreeId,
            intent.browserPageId,
          )
            .then(() =>
              useAppStore
                .getState()
                .clearClientHostedBrowserCloseIntents(environmentId, [
                  intent.browserPageId,
                ]),
            )
            .catch(() => {});
        }
    }
    if (event.method === "browser.remotePageStatuses") {
      const data = event.params as {
        environmentId: string;
        pages: {
          browserPageId: string;
          placement: RemoteBrowserPageHandle["placement"];
          url: string;
          title: string;
        }[];
      };
      for (const [id, handle] of Object.entries(
        useAppStore.getState().remoteBrowserPageHandlesByPageId,
      )) {
        const page = data.pages.find(
          (page) => page.browserPageId === handle.remotePageId,
        );
        if (handle.environmentId === data.environmentId && page)
          useAppStore.getState().setRemoteBrowserPageHandle(id, {
            environmentId: handle.environmentId,
            remotePageId: handle.remotePageId,
            placement: page.placement,
          });
      }
      return;
    }
    if (event.method !== "browser.remotePageCreated") return;
    const data = event.params as {
      context: string;
      environmentId: string;
      browserPageId: string;
      url: string;
      placement: RemoteBrowserPageHandle["placement"];
    };
    if (creating.has(key(data.environmentId, data.browserPageId))) return;
    if (cancelled.has(key(data.environmentId, data.browserPageId))) {
      void closeOwned(
        data.environmentId,
        data.context,
        data.browserPageId,
      ).catch(() => {});
      return;
    }
    if (
      Object.values(
        useAppStore.getState().remoteBrowserPageHandlesByPageId,
      ).some(
        (handle) =>
          handle.environmentId === data.environmentId &&
          handle.remotePageId === data.browserPageId,
      )
    )
      return;
    const staged = stageWebRuntimeBrowserTab({
      environmentId: data.environmentId,
      worktreeId: data.context,
      remotePageId: data.browserPageId,
      url: data.url,
      activate: false,
      clientHosted: data.placement?.kind === "client",
    });
    if (staged)
      useAppStore.getState().setRemoteBrowserPageHandle(staged.pageId, {
        environmentId: data.environmentId,
        remotePageId: data.browserPageId,
        placement: data.placement,
      });
  });
  registerPairedBrowserTabCreator(async (args) => {
    const owner = javisContext(args.worktreeId)?.owner;
    if (owner?.kind !== "runtime") return false;
    const page = crypto.randomUUID();
    const staged = stageWebRuntimeBrowserTab({
      environmentId: owner.environmentId,
      worktreeId: args.worktreeId,
      remotePageId: page,
      url: args.url,
      profileId: args.profileId,
      targetGroupId: args.targetGroupId,
      activate: args.focusOnCreate !== false,
      clientHosted: true,
    });
    if (!staged)
      throw new Error("Browser workspace could not stage the remote page");
    const operation = key(owner.environmentId, page);
    creating.add(operation);
    let confirmed: string | undefined;
    try {
      const result = (await browserBridge().call("browser.catalog.create", {
        context: args.worktreeId,
        url: args.url,
        page,
        preference: args.placementPreference ?? "auto",
        profileId: args.profileId ?? undefined,
        targetGroupId: args.targetGroupId,
      })) as {
        placement: RemoteBrowserPageHandle["placement"];
        browserPageId: string;
      };
      confirmed = result.browserPageId;
      if (!isStagedWebRuntimeBrowserTabLive(staged, args.worktreeId)) {
        cancelled.add(operation);
        await closeOwned(owner.environmentId, args.worktreeId, confirmed);
        return false;
      }
      if (confirmed !== page)
        rehomeStagedWebRuntimeBrowserTab(staged, {
          environmentId: owner.environmentId,
          worktreeId: args.worktreeId,
          remotePageId: confirmed,
        });
      const group = resolveStagedWebRuntimeBrowserTabGroupId(
        staged,
        args.worktreeId,
      );
      if (!group)
        throw new Error("The remote browser tab lost its owning group");
      useAppStore.getState().setRemoteBrowserPageHandle(staged.pageId, {
        environmentId: owner.environmentId,
        remotePageId: result.browserPageId,
        placement: result.placement,
      });
      releaseHeldBrowserTabsTheServerLists(
        owner.environmentId,
        new Map([[args.worktreeId, new Set([result.browserPageId])]]),
      );
      args.onMaterialized?.(result.browserPageId);
      return true;
    } catch (error) {
      cancelled.add(operation);
      discardStagedWebRuntimeBrowserTab(staged);
      if (confirmed)
        await closeOwned(owner.environmentId, args.worktreeId, confirmed).catch(
          () => {},
        );
      else
        useAppStore.getState().recordClientHostedBrowserCloseIntents([
          {
            environmentId: owner.environmentId,
            browserPageId: page,
            worktreeId: args.worktreeId,
          },
        ]);
      throw error;
    } finally {
      creating.delete(operation);
    }
  });
}
