import { mkdtemp, writeFile, stat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { BrowserWorkspaceFiles } from "../../../src/browser/main/workspace-files";
it.skipIf(process.platform === "win32")(
  "keeps executable permissions when an atomic editor save replaces a file",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "javis-save-mode-"));
    try {
      await writeFile(join(directory, "program.sh"), "old", { mode: 0o755 });
      const files = new BrowserWorkspaceFiles(() => directory);
      await files.writeFileExplorerFileBase64Chunk(
        "context",
        "staged",
        Buffer.from("new").toString("base64"),
        false,
      );
      await files.commitFileExplorerUpload("context", "staged", "program.sh");
      expect((await stat(join(directory, "program.sh"))).mode & 0o777).toBe(
        0o755,
      );
      expect(await readFile(join(directory, "program.sh"), "utf8")).toBe("new");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
