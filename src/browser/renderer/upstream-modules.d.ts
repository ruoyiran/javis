declare module 'monaco-editor/esm/vs/basic-languages/python/python.js' {
  export const conf: import('monaco-editor').languages.LanguageConfiguration
  export const language: import('monaco-editor').languages.IMonarchLanguage
}

declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js' {
  export const conf: import('monaco-editor').languages.LanguageConfiguration
  export const language: import('monaco-editor').languages.IMonarchLanguage
}

declare module 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js' {
  export const conf: import('monaco-editor').languages.LanguageConfiguration
  export const language: import('monaco-editor').languages.IMonarchLanguage
}

// Monaco contributions lack public types; declare only Orca’s paste-override surface.
declare module 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js' {
  type PasteImplementation = () => boolean | Promise<unknown>
  export const PasteAction:
    | {
        addImplementation: (
          priority: number,
          name: string,
          implementation: PasteImplementation
        ) => { dispose: () => void }
      }
    | undefined
}

declare module 'monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js' {
  export const InMemoryClipboardMetadataManager: {
    INSTANCE: {
      get: (pastedText: string) => {
        isFromEmptySelection?: boolean
        multicursorText?: string[] | null
        mode?: string | null
      } | null
    }
  }
}

// The same class the public `monaco.Uri` re-exports, reachable without loading the editor bundle.
declare module 'monaco-editor/esm/vs/base/common/uri.js' {
  export class URI {
    static file(path: string): URI
    static parse(value: string): URI
    static from(components: { scheme: string; authority?: string; path?: string }): URI
    readonly scheme: string
    readonly authority: string
    readonly path: string
    readonly fragment: string
    readonly fsPath: string
    with(change: { path?: string; fragment?: string }): URI
    toString(skipEncoding?: boolean): string
  }
}

// The same enum objects and class the public `monaco.import('monaco-editor').editor.*` / `monaco.Range` re-export, reachable
// without evaluating the editor bundle (which bakes its NLS labels on first evaluation).
declare module 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js' {
  export const EditorOption: typeof import('monaco-editor').editor.EditorOption
  export const MouseTargetType: typeof import('monaco-editor').editor.MouseTargetType
}

declare module 'monaco-editor/esm/vs/editor/common/core/range.js' {
  export { Range } from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/base/common/async.js' {
  export class Delayer<T = unknown> {
    constructor(defaultDelay: number)
    trigger(task: () => T | Promise<T>, delay?: number): Promise<T | undefined>
    cancel(): void
    dispose(): void
  }
}

declare module 'monaco-editor/esm/vs/base/common/lifecycle.js' {
  type Disposable = {
    dispose(): void
  }

  export class DisposableStore {
    add<T extends Disposable>(disposable: T): T
    clear(): void
    dispose(): void
  }
}

// Only the gutter-disposal patch test constructs this directly (config/patches/monaco-editor@0.55.1.patch).
declare module 'monaco-editor/esm/vs/editor/browser/widget/diffEditor/utils/editorGutter.js' {
  type GutterEvent = (listener: () => void) => { dispose(): void }
  type GutterRange = {
    startLineNumber: number
    endLineNumberExclusive: number
    intersect(other: unknown): unknown
  }
  export class EditorGutter {
    constructor(
      editor: {
        onDidScrollChange: GutterEvent
        onDidChangeModel: GutterEvent
        onDidChangeViewZones: GutterEvent
        onDidContentSizeChange: GutterEvent
        getScrollTop(): number
        hasModel(): boolean
        getModel(): { getLineCount(): number }
        getVisibleRanges(): { startLineNumber: number; endLineNumber: number }[]
        getTopForLineNumber(line: number, includeViewZones?: boolean): number
        getBottomForLineNumber(line: number, includeViewZones?: boolean): number
      },
      domNode: HTMLElement,
      itemProvider: {
        getIntersectingGutterItems(
          range: unknown,
          reader: unknown
        ): { id: string; range: GutterRange }[]
        createView(
          item: unknown,
          target: HTMLElement
        ): { layout(...args: unknown[]): void; dispose(): void }
      }
    )
    dispose(): void
  }
}


declare module 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/peek/referencesWidget.js' { export class ReferenceWidget { revealReference(...args: unknown[]): void } }
