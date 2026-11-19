import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import net from "node:net";
import { chromium } from "playwright-core";

process.env.ORCA_BACKGROUND_LAUNCH = "1";
const directory = await mkdtemp(join(tmpdir(), "javis-hidden-acceptance-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(
    '<!doctype html><title>Browser acceptance</title><label>Fixture name<input id="name"></label><button id="save" onclick="document.getElementById(\'result\').textContent=document.getElementById(\'name\').value">Save fixture</button><p id="result"></p>',
  );
});
const portServer = net.createServer();
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const html = join(directory, "owned.html");
const content =
  '<!doctype html><label>Fixture name<input id="name"></label><button id="save" onclick="document.getElementById(\'result\').textContent=document.getElementById(\'name\').value">Save</button><p id="result"></p>';
await writeFile(html, content);
await writeFile(join(directory, "unopened.html"), "unopened");
const url = pathToFileURL(html).href;
let processHandle;
let browser;
try {
  const runtime = join(directory, "runtime.cjs");
  await build({
    entryPoints: ["src/browser/runtime/browser-process.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: runtime,
    external: ["electron", "node-pty"],
    logLevel: "silent",
  });
  const require = createRequire(runtime);
  const { BrowserProcess } = require(runtime);
  processHandle = new BrowserProcess({
    executable: createRequire(resolve("package.json"))("electron"),
    entry: resolve("dist/browser/main/main.cjs"),
    applicationDirectory: resolve("dist/browser"),
    dataDirectory: join(directory, "state"),
    launchArguments: [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
    ],
  });
  const context = `cwd:${directory}`;
  await processHandle.call("browser.open", { worktree: context });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url().includes("/renderer/index.html"));
  assert.ok(page, "The real browser workspace must exist");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector("input") !== null);
  const created = await processHandle.call("browser.tabCreate", {
    worktree: context,
    url,
  });
  assert.ok(
    created.browserPageId,
    "The renderer must create a real browser guest",
  );
  const snapshot = await processHandle.call("browser.snapshot", {
    page: created.browserPageId,
    interactive: true,
  });
  assert.ok(JSON.stringify(snapshot).includes("Fixture name"));
  await processHandle.call("browser.fill", {
    page: created.browserPageId,
    element: "#name",
    value: "accepted value",
    expectUrl: url,
  });
  await processHandle.call("browser.click", {
    page: created.browserPageId,
    element: "#save",
    expectUrl: url,
  });
  const result = await processHandle.call("browser.eval", {
    page: created.browserPageId,
    expression: 'document.getElementById("result").textContent',
  });
  assert.equal(result.result, "accepted value");
  const artifact = await page.evaluate(
    async (filePath) => ({
      stat: await window.api.fs.stat({
        filePath,
        access: { kind: "user-named" },
      }),
      file: await window.api.fs.readFile({
        filePath,
        access: { kind: "user-named" },
      }),
    }),
    html,
  );
  assert.equal(artifact.file.content, content);
  assert.equal(artifact.stat.size, Buffer.byteLength(content));
  await assert.rejects(() =>
    page.evaluate(
      (filePath) =>
        window.api.fs.readFile({ filePath, access: { kind: "user-named" } }),
      join(directory, "unopened.html"),
    ),
  );
  const status = await processHandle.call("browser.status", {});
  assert.equal(status.visible, false);
  const artifacts = process.env.JAVIS_TEST_ARTIFACT_DIRECTORY
    ? resolve(process.env.JAVIS_TEST_ARTIFACT_DIRECTORY)
    : directory;
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: join(artifacts, "hidden-browser-workspace.png"),
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      renderer: true,
      guest: true,
      snapshot: true,
      urlGuardedInput: true,
      hidden: true,
      pageErrors: 0,
      authorizedHtmlRead: true,
      unopenedFileDenied: true,
    }),
  );
} finally {
  await browser?.close().catch(() => {});
  await processHandle?.shutdown();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
