import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";
import { chromium } from "playwright-core";
const directory = await mkdtemp(join(tmpdir(), "javis-remote-client-"));
const remoteState = join(directory, "remote-state"),
  localState = join(directory, "local-state"),
  root = join(directory, "project");
await mkdir(root);
const probe = net.createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const server = http.createServer((req, res) =>
  res.end(
    '<!doctype html><title>Real remote client</title><label>Remote input<input id="remote"></label>',
  ),
);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;
const ssh = join(directory, "ssh.cjs");
await writeFile(
  ssh,
  `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(join(directory, "ssh-pids"))},process.pid+'\\n');if(fs.existsSync(${JSON.stringify(join(directory, "offline"))}))process.exit(255);const {spawn}=require('node:child_process');const child=spawn(process.execPath,[${JSON.stringify(resolve("dist/cli.cjs"))},'rpc','--stream-stdio'],{env:{...process.env,JAVIS_STATE_DIR:${JSON.stringify(remoteState)},JAVIS_BROWSER_DEBUG_PORT:'',JAVIS_CLI_ENTRY:${JSON.stringify(resolve("dist/cli.cjs"))}},stdio:'inherit'});process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));`,
  { mode: 0o700 },
);
process.env.ORCA_BACKGROUND_LAUNCH = "1";
process.env.JAVIS_STATE_DIR = localState;
process.env.JAVIS_CLI_ENTRY = resolve("dist/cli.cjs");
process.env.JAVIS_BROWSER_DEBUG_PORT = String(port);
process.env.JAVIS_SSH_EXECUTABLE = ssh;

const runtime = join(directory, "runtime.cjs");
await build({
  entryPoints: ["src/runtime/public.ts"],
  outfile: runtime,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "node-pty"],
  logLevel: "silent",
});
const { callJavis, stopJavisDaemon } = createRequire(runtime)(runtime);
let browser;
try {
  const cli = await promisify(execFile)(
    process.execPath,
    [
      resolve("dist/cli.cjs"),
      "browser",
      "host",
      "add",
      "--id",
      "remote",
      "--alias",
      "fixture",
      "--name",
      "Remote fixture",
      "--context",
      "remote-project",
      "--root",
      root,
      "--json",
    ],
    { env: process.env },
  );
  assert(cli.stdout.includes("fixture"));

  const secondRoot = join(directory, "second-project");
  await mkdir(secondRoot);
  await callJavis("browser.catalog.context", {
    id: "remote",
    context: "second-project",
    root: secondRoot,
  });
  await callJavis("browser.open", { worktree: `cwd:${root}` });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url().includes("/renderer/index.html"));
  assert(page);
  const catalog = await callJavis("browser.catalog.list", {});
  const context = catalog.contexts.find(
    (row) => row.owner.kind === "runtime",
  ).id;
  const created = await page.evaluate(
    async ({ context, url }) =>
      window.api.javisBrowser.call("browser.catalog.create", { context, url }),
    { context, url },
  );
  const contexts = await callJavis("browser.catalog.list", {});
  const secondContext = contexts.contexts.find(
    (row) => row.id !== context && row.owner.kind === "runtime",
  ).id;
  const second = await page.evaluate(
    ({ context, url }) =>
      window.api.javisBrowser.call("browser.catalog.create", { context, url }),
    { context: secondContext, url },
  );
  assert.equal(second.placement.kind, "client");
  assert.equal(created.placement.kind, "client");
  const snapshot = await page.evaluate(
    async ({ environmentId, page, context }) =>
      window.api.runtimeEnvironments.invoke({
        selector: environmentId,
        method: "browser.snapshot",
        params: { page, worktree: `id:${context}`, interactive: true },
      }),
    {
      environmentId: created.environmentId,
      page: created.browserPageId,
      context,
    },
  );
  if (!snapshot.ok) throw new Error(JSON.stringify(snapshot));
  assert.equal(snapshot.ok, true);
  assert(JSON.stringify(snapshot.result).includes("Remote input"));
  assert.equal(
    await page.evaluate(() =>
      window.api.javisBrowser.bootstrap().then((value) => value.context),
    ),
    `cwd:${root}`,
  );
  await page.evaluate(
    async ({ id, context, url }) =>
      window.api.runtimeEnvironments.invoke({
        selector: "remote",
        method: "browser.fill",
        params: {
          page: id,
          worktree: `id:${context}`,
          element: "#remote",
          value: "volatile value",
          expectUrl: url,
        },
      }),
    { id: created.browserPageId, context, url },
  );
  const clientGuest = browser
    .contexts()[0]
    .pages()
    .find((candidate) => candidate.url() === url);
  assert(clientGuest);
  await writeFile(join(directory, "offline"), "offline");
  const peerPids = (
    await (
      await import("node:fs/promises")
    ).readFile(join(directory, "ssh-pids"), "utf8")
  )
    .trim()
    .split("\n")
    .map(Number);
  for (const pid of peerPids)
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  await page.evaluate(() =>
    window.api.javisBrowser.call("browser.catalog.refresh", {}),
  );
  assert.equal(
    await clientGuest.evaluate(() => document.getElementById("remote").value),
    "volatile value",
  );
  await rm(join(directory, "offline"));
  await page.evaluate(() =>
    window.api.runtimeEnvironments.prepareBrowserClientHostPlacement({
      selector: "remote",
      preference: "auto",
    }),
  );
  await page.evaluate(() => window.api.app.awaitBeforeUnloadCheckpoint());
  await writeFile(
    ".superpowers/sdd/2026-11-19-orca-browser-parity/final-wave-before-restart.json",
    JSON.stringify(
      await page.evaluate(() => window.api.javisBrowser.bootstrap()),
    ),
  );
  await browser.close();
  browser = undefined;
  await stopJavisDaemon();
  process.env.JAVIS_STATE_DIR = remoteState;
  await stopJavisDaemon();
  process.env.JAVIS_STATE_DIR = localState;
  await callJavis("browser.open", { worktree: `cwd:${root}` });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const restoredPage = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url().includes("/renderer/index.html"));
  assert(restoredPage);
  await writeFile(
    ".superpowers/sdd/2026-11-19-orca-browser-parity/final-wave-after-restart.json",
    JSON.stringify(
      await restoredPage.evaluate(() => window.api.javisBrowser.bootstrap()),
    ),
  );
  await restoredPage.evaluate(() =>
    window.api.runtimeEnvironments.prepareBrowserClientHostPlacement({
      selector: "remote",
      preference: "auto",
    }),
  );
  let restored;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      restored = await restoredPage.evaluate(
        async ({ id, context }) =>
          window.api.runtimeEnvironments.invoke({
            selector: "remote",
            method: "browser.snapshot",
            params: { page: id, worktree: `id:${context}`, interactive: true },
          }),
        { id: created.browserPageId, context },
      );
    } catch (error) {
      restored = { ok: false, error: { message: error.message } };
    }
    if (restored.ok) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!restored.ok) throw new Error(JSON.stringify(restored));
  assert(JSON.stringify(restored.result).includes("Remote input"));
  const recoveredGuest = browser
    .contexts()[0]
    .pages()
    .find((candidate) => candidate.url() === url);
  assert(recoveredGuest);
  assert.equal(
    await recoveredGuest.evaluate(
      () => document.getElementById("remote").value,
    ),
    "",
  );
  // The original rendered pane publishes its current placement through the authenticated lease.
  await recoveredGuest.evaluate(() => {
    document.title = "Recovered renderer metadata";
  });
  const recoveryScreenshot = await restoredPage.evaluate(
    ({ id, context }) =>
      window.api.runtimeEnvironments.invoke({
        selector: "remote",
        method: "browser.screenshot",
        params: { page: id, worktree: `id:${context}` },
      }),
    { id: created.browserPageId, context },
  );
  assert.equal(recoveryScreenshot.ok, true);
  await restoredPage.waitForFunction(async (id) => {
    const status = await window.api.javisBrowser.call(
      "browser.catalog.invoke",
      {
        selector: "remote",
        method: "browser.clientHost.pageStatus",
        params: { page: id },
      },
    );
    return (
      status.ok &&
      status.result.title === "Recovered renderer metadata" &&
      status.result.placement.kind === "client" &&
      status.result.placement.browserHostGeneration >= 1 &&
      status.result.placement.pageHostGeneration >= 1
    );
  }, created.browserPageId);

  const serverPage = await restoredPage.evaluate(
    ({ context, url }) =>
      window.api.javisBrowser.call("browser.catalog.create", {
        context,
        url,
        preference: "server",
      }),
    { context, url },
  );
  assert.equal(serverPage.placement.kind, "server");
  await restoredPage.evaluate(() =>
    window.api.javisBrowser.call("browser.catalog.remove", { id: "remote" }),
  );
  await assert.rejects(() =>
    restoredPage.evaluate(
      ({ id, context }) =>
        window.api.runtimeEnvironments.invoke({
          selector: "remote",
          method: "browser.snapshot",
          params: { page: id, worktree: `id:${context}` },
        }),
      { id: created.browserPageId, context },
    ),
  );
  console.log(
    JSON.stringify({
      remoteClientGuest: true,
      authenticatedSourceLease: true,
      actualRemoteSnapshot: true,
      activeLocalContextPreserved: true,
      sameHostContextsCoexist: true,
      retainedDomThroughLinkLoss: true,
      renderedRecoveryPlacement: true,
      recoveredRendererMetadataAccepted: true,
      noInputReplayAfterRecovery: true,
      restoredClientGuest: true,
      serverNetworkTransition: true,
      removedOwnerUnavailable: true,
    }),
  );
} finally {
  await browser?.close().catch(() => {});
  await stopJavisDaemon();
  process.env.JAVIS_STATE_DIR = remoteState;
  await stopJavisDaemon().catch(() => {});
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
