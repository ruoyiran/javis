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
