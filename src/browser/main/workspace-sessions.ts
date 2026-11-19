import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getDefaultUIState,
  getDefaultWorkspaceSession,
  FLOATING_TERMINAL_WORKTREE_ID,
} from "../source/shared/constants";
import type { WorkspaceSessionState } from "../source/shared/workspace-session/workspace-session-state-types";
import {
  withOpenedServeBrowserTab,
  findSavedBrowserPage,
} from "../source/main/runtime/browser/headless/serve-browser-tab-layout";

import type { BrowserPageAnnotation } from "../source/shared/browser/element-grab/browser-grab-types";
type BrowserSession = WorkspaceSessionState & {
  browserAnnotationsByPageId?: Record<string, BrowserPageAnnotation[]>;
};
export const browserContextId = (selector: string) =>
  selector.replace(/^id:/, "");
export class BrowserWorkspaceSessions {
  private state: {
    context: string;
    generation: number;
    generations: Record<string, number>;
    sessions: Record<string, BrowserSession>;
    ui: Record<string, any>;
    floating?: WorkspaceSessionState;
  };
  private readonly listeners = new Set<(hostId?: string) => void>();
  private readonly path: string;
  constructor(directory: string) {
    this.path = join(directory, "workspace.json");
    let saved: any = {};
    try {
      saved = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const context = browserContextId(saved.context ?? "default");
    const sessions: Record<string, BrowserSession> = {};
    for (const [key, session] of Object.entries(
      saved.sessions ?? {
        [context]: saved.session ?? getDefaultWorkspaceSession(),
      },
    ))
      sessions[browserContextId(key)] = session as WorkspaceSessionState;
    this.state = {
      context,
      generation: saved.generation ?? 0,
      generations: saved.generations ?? { [context]: saved.generation ?? 0 },
      sessions,
      ui: saved.ui ?? getDefaultUIState(),
      floating: saved.floating,
    };
    for (const page of Object.values(saved.pages ?? {}) as any[]) {
      const owner = browserContextId(page.worktreeId ?? context);
      const session = this.session(owner);
      if (!findSavedBrowserPage(session, owner, page.pageId))
        this.state.sessions[owner] =
          withOpenedServeBrowserTab("local", session, {
            ...page,
            worktreeId: owner,
          }) ?? session;
    }
  }
  get context() {
    return this.state.context;
  }
  get generation() {
    return this.state.generation;
  }
  get ui() {
    return this.state.ui;
  }
  contexts() {
    return [
      ...new Set([
        ...Object.keys(this.state.sessions),
        FLOATING_TERMINAL_WORKTREE_ID,
      ]),
    ];
  }
  session(context = this.context): BrowserSession {
    const session =
      this.state.sessions[browserContextId(context)] ??
      getDefaultWorkspaceSession();
    return this.state.floating
      ? this.mergeFloating(session, this.state.floating)
      : session;
  }
  select(selector: string): boolean {
    const context = browserContextId(selector);
    if (context === this.context) return false;
    this.state.context = context;
    this.state.generation++;
    this.state.generations[context] = this.state.generation;
    this.state.sessions[context] ??= getDefaultWorkspaceSession();
    this.persist();
    return true;
  }
  replace(input: {
    context: string;
    generation: number;
    session: WorkspaceSessionState;
  }): void {
    if (input.generation !== this.state.generations[input.context])
      throw new Error("browser_workspace_revision_stale");
    this.save(input.context, input.session);
  }
  save(context: string, session: WorkspaceSessionState): void {
    this.state.sessions[browserContextId(context)] = session;
    for (const [owner, tabs] of Object.entries(
      session.browserTabsByWorktree ?? {},
    )) {
      if (
        owner === context ||
        (this.state.generations[owner] ?? 0) >
          (this.state.generations[context] ?? 0)
      )
        continue;
      const tabIds = new Set(tabs.map((tab) => tab.id));
      const prior = this.state.sessions[owner] ?? getDefaultWorkspaceSession();
      this.state.sessions[owner] = {
        ...prior,
        browserTabsByWorktree: {
          ...prior.browserTabsByWorktree,
          [owner]: tabs,
        },
        browserPagesByWorkspace: {
          ...prior.browserPagesByWorkspace,
          ...Object.fromEntries(
            Object.entries(session.browserPagesByWorkspace ?? {}).filter(
              ([id]) => tabIds.has(id),
            ),
          ),
        },
        unifiedTabs: {
          ...prior.unifiedTabs,
          [owner]: session.unifiedTabs?.[owner] ?? [],
        },
        tabGroups: {
          ...prior.tabGroups,
          [owner]: session.tabGroups?.[owner] ?? [],
        },
        tabGroupLayouts: {
          ...prior.tabGroupLayouts,
          ...(session.tabGroupLayouts?.[owner]
            ? { [owner]: session.tabGroupLayouts[owner] }
            : {}),
        },
        activeBrowserTabIdByWorktree: {
          ...prior.activeBrowserTabIdByWorktree,
          [owner]: session.activeBrowserTabIdByWorktree?.[owner] ?? null,
        },
      };
    }
    if (
      session.browserTabsByWorktree?.[FLOATING_TERMINAL_WORKTREE_ID] !==
      undefined
    )
      this.state.floating = this.mergeFloating(
        getDefaultWorkspaceSession(),
        session,
      );
    this.persist();
    for (const notify of this.listeners) notify("local");
  }
  updateUI(patch: Record<string, unknown>): void {
    this.state.ui = { ...this.ui, ...patch };
    this.persist();
  }
  owner(page: string): string | undefined {
    return this.contexts().find(
      (context) =>
        findSavedBrowserPage(this.session(context), context, page) !== null,
    );
  }
  annotations(page: string): BrowserPageAnnotation[] {
    const context = this.owner(page);
    return context === undefined
      ? []
      : (this.session(context).browserAnnotationsByPageId?.[page] ??
          Object.values(this.session(context).browserPagesByWorkspace ?? {})
            .flat()
            .find((entry) => entry.id === page)?.annotations ??
          []);
  }
  setProfile(page: string, profileId: string): void {
    const context = this.owner(page);
    if (!context) return;
    const session = this.session(context);
    const saved = findSavedBrowserPage(session, context, page);
    if (!saved) return;
    this.save(context, {
      ...session,
      browserTabsByWorktree: {
        ...session.browserTabsByWorktree,
        [context]: (session.browserTabsByWorktree?.[context] ?? []).map(
          (tab) =>
            tab.id === saved.tabId
              ? { ...tab, sessionProfileId: profileId }
              : tab,
        ),
      },
    });
  }
  getWorkspaceSessionHostIds = () => ["local"];
  getWorkspaceSession = (_hostId: string): WorkspaceSessionState => {
    const merged = getDefaultWorkspaceSession();
    for (const context of this.contexts())
      for (const key of [
        "browserTabsByWorktree",
        "browserPagesByWorkspace",
        "activeBrowserTabIdByWorktree",
      ] as const)
        merged[key] = { ...merged[key], ...this.session(context)[key] } as any;
    return merged;
  };
  onWorkspaceSessionWritten = (callback: (hostId?: string) => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private mergeFloating(
    session: BrowserSession,
    floating: WorkspaceSessionState,
  ): BrowserSession {
    const id = FLOATING_TERMINAL_WORKTREE_ID;
    const merge = <T>(
      current: Record<string, T> | undefined,
      global: Record<string, T> | undefined,
    ): Record<string, T> | undefined =>
      global?.[id] !== undefined ? { ...current, [id]: global[id] } : current;
    const next: BrowserSession = {
      ...session,
      browserTabsByWorktree: merge(
        session.browserTabsByWorktree,
        floating.browserTabsByWorktree,
      ),
      activeBrowserTabIdByWorktree: merge(
        session.activeBrowserTabIdByWorktree,
        floating.activeBrowserTabIdByWorktree,
      ),
      unifiedTabs: merge(session.unifiedTabs, floating.unifiedTabs),
      tabGroups: merge(session.tabGroups, floating.tabGroups),
      tabGroupLayouts: merge(session.tabGroupLayouts, floating.tabGroupLayouts),
    };
    const tabIds = new Set(
      (floating.browserTabsByWorktree?.[id] ?? []).map((tab) => tab.id),
    );
    next.browserPagesByWorkspace = {
      ...session.browserPagesByWorkspace,
      ...Object.fromEntries(
        Object.entries(floating.browserPagesByWorkspace ?? {}).filter(([key]) =>
          tabIds.has(key),
        ),
      ),
    };
    return next;
  }
  private persist() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.state), {
      mode: 0o600,
    });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
