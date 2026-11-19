import { isAbsolute, relative, resolve, dirname, sep } from "node:path";
import {
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
  chmod,
} from "node:fs/promises";

export class BrowserWorkspaceFiles {
  constructor(private readonly rootForContext: (context: string) => string) {}
  private async path(context: string, name: string): Promise<string> {
    const root = await realpath(this.rootForContext(context));
    if (isAbsolute(name))
      throw new Error("browser_file_path_outside_workspace");
    const candidate = resolve(root, name);
    const admitted = (path: string) => {
      const diff = relative(root, path);
      if (diff === ".." || diff.startsWith(`..${sep}`) || isAbsolute(diff))
        throw new Error("browser_file_path_outside_workspace");
    };
    admitted(candidate);
    let ancestor = candidate;
    for (;;) {
      try {
        admitted(await realpath(ancestor));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    return candidate;
  }
  async readFileExplorerChunk(
    context: string,
    name: string,
    offset: number,
    length: number,
  ) {
    const file = await open(await this.path(context, name), "r");
    try {
      const bytes = Buffer.alloc(Math.min(length, 512 * 1024));
      const result = await file.read(bytes, 0, bytes.length, offset);
      const size = (await file.stat()).size;
      return {
        contentBase64: bytes.subarray(0, result.bytesRead).toString("base64"),
        bytesRead: result.bytesRead,
        eof: offset + result.bytesRead >= size,
      };
    } finally {
      await file.close();
    }
  }
  async writeFileExplorerFileBase64Chunk(
    context: string,
    name: string,
    content: string,
    append: boolean,
  ) {
    const path = await this.path(context, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(content, "base64"), {
      flag: append ? "a" : "w",
      mode: 0o600,
    });
    return { written: true };
  }
  async commitFileExplorerUpload(context: string, temp: string, name: string) {
    const staging = await this.path(context, temp);
    const target = await this.path(context, name);
    if (process.platform !== "win32") {
      try {
        const previous = await stat(target);
        await chmod(staging, previous.mode & 0o777);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await rename(staging, target);
    return { committed: true };
  }
  async deleteFileExplorerPath(
    context: string,
    name: string,
    recursive: boolean,
  ) {
    await rm(await this.path(context, name), { recursive, force: true });
    return { deleted: true };
  }
  async createFileExplorerDir(context: string, name: string) {
    await mkdir(await this.path(context, name), { recursive: true });
    return { created: true };
  }
  async statRuntimeFile(context: string, name: string) {
    const value = await stat(await this.path(context, name));
    return {
      size: value.size,
      isDirectory: value.isDirectory(),
      mtimeMs: value.mtimeMs,
    };
  }
}
