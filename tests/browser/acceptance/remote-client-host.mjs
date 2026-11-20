import { browserFixtureCli } from './browser-fixture-distribution.mjs'
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { waitForBrowserFixtureState } from "./browser-fixture-state.mjs";
const directory = await mkdtemp(join(tmpdir(), "javis-remote-client-"));
const remoteState = join(directory, "remote-state"),
  localState = join(directory, "local-state"),
  root = join(directory, "project");
await mkdir(root);
const probe = net.createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
let initializationResponse;
const server = http.createServer((req, res) => {
  if (req.url === "/initializing") {
    initializationResponse = res;
    res.writeHead(200, { "content-type": "text/html" });
    res.write('<!doctype html><title>Pending client fixture</title>');
    return;
  }
  res.end(
    '<!doctype html><title>Real remote client</title><label>Remote input<input id="remote"></label>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;
const ssh = join(directory, "ssh.cjs");
await writeFile(
  ssh,
  `#!${process.execPath}
const fs=require('node:fs'), {spawn}=require('node:child_process');
fs.appendFileSync(${JSON.stringify(join(directory, "ssh-pids"))},process.pid+'\\n');
if(fs.existsSync(${JSON.stringify(join(directory, "offline"))}))process.exit(255);
const mode=process.argv.at(-1), stream=mode==='--stream-stdio';
const child=spawn(process.execPath,[${JSON.stringify(browserFixtureCli)},'rpc',mode],{env:{...process.env,JAVIS_STATE_DIR:${JSON.stringify(remoteState)},JAVIS_BROWSER_DEBUG_PORT:'',JAVIS_CLI_ENTRY:${JSON.stringify(browserFixtureCli)}},stdio:stream?['pipe','pipe','pipe']:'inherit',windowsHide:true});
if(stream){
  const hold=${JSON.stringify(join(directory, "hold-create-result"))}, marker=${JSON.stringify(join(directory, "create-result-held"))};
  let pending=Buffer.alloc(0), outbound=Buffer.alloc(0), held=[], delayed=false;
  const creates=new Set();
  child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
  child.stdout.on('data',bytes=>{
    outbound=Buffer.concat([outbound,bytes]);
    while(outbound.length>=4){
      const length=outbound.readUInt32BE(0);if(outbound.length<length+4)break;
      const message=JSON.parse(outbound.subarray(4,length+4));outbound=outbound.subarray(length+4);
      if(message.type==='event'&&message.method==='browser.clientHost.attach'&&message.params?.type==='command'&&message.params.command?.type==='createPage')creates.add(message.params.commandId);
    }
  });
  process.stdin.on('data',bytes=>{
    pending=Buffer.concat([pending,bytes]);
    while(pending.length>=4){
      const length=pending.readUInt32BE(0);if(length>32*1024*1024)process.exit(2);if(pending.length<length+4)break;
      const frame=pending.subarray(0,length+4), request=JSON.parse(frame.subarray(4));pending=pending.subarray(length+4);
      if(fs.existsSync(hold)&&request.method==='browser.clientHost.commandResult'&&request.params.browserPageId==='latest-pending-client'&&(delayed||creates.has(request.params.commandId))){
        held.push(Buffer.from(frame));
        if(!delayed){
          delayed=true;fs.writeFileSync(marker,'held');
          const poll=setInterval(()=>{if(!fs.existsSync(hold)){for(const value of held)child.stdin.write(value);held=[];clearInterval(poll);}},50);
        }
      }else child.stdin.write(frame);
    }
  });
  process.stdin.on('end',()=>child.stdin.end());
}
process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??1));`,
  { mode: 0o700 },
);
process.env.ORCA_BACKGROUND_LAUNCH = "1";
process.env.JAVIS_STATE_DIR = localState;
process.env.JAVIS_CLI_ENTRY = browserFixtureCli;
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
async function resolveFixtureGuest(renderer, id, context) {
  const marked = await renderer.evaluate(({ id, context }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: `document.documentElement.dataset.fixturePage=${JSON.stringify(id)}` } }), { id, context });
  assert.equal(marked.ok, true, marked.error?.message);
  for (const guest of browser.contexts().flatMap(context => context.pages()))
    if (await guest.evaluate(id => document.documentElement?.dataset.fixturePage === id, id)) return guest;
  throw new Error("The selected fixture guest was not present in CDP");
}
try {
  const cli = await promisify(execFile)(
    process.execPath,
    [
      browserFixtureCli,
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
  const headless = await promisify(execFile)(process.execPath, [browserFixtureCli, "browser", "tab", "create", "--host", "fixture", "--worktree", `cwd:${root}`, "--url", url, "--headless", "--json"], { env: process.env });
  const serverOwnedPage = JSON.parse(headless.stdout).result.browserPageId;
  const remoteEngine = await page.evaluate(() => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.status", params: {} }));
  assert.equal(remoteEngine.result.pages.some(tab => tab.browserPageId === serverOwnedPage), true, "--headless must keep the page in the server engine while a desktop client is attached");
  const census = await page.evaluate(({ context }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "session.tabs.list", params: { worktree: `id:${context}` } }), { context });
  assert.equal(census.ok, true, census.error?.message);
  assert.equal(census._meta.runtimeId, census.result.publicationEpoch);
  const censusPage = census.result.tabs.find(tab => tab.browserPageId === created.browserPageId);
  assert(censusPage);
  assert.deepEqual(censusPage.placement, created.placement);
  const chunked = await page.evaluate(({ id, context }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: '"chunk-start" + "x".repeat(819200) + "chunk-end"' } }), { id: created.browserPageId, context });
  assert.equal(chunked.ok, true, chunked.error?.message);
  assert.equal(chunked.result.result.length, 819220);
  assert.equal(createHash("sha256").update(chunked.result.result).digest("hex"), "c137af15d22cb9e222d222994b13b82177f849494c3bcc3c48fb7e2166375e33");
  const initialization = await page.evaluate(({ id, context, placement, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "navigate", url } } }), { id: created.browserPageId, context, placement: created.placement, url: `${url}initialized` });
  assert.equal(initialization.ok, true, initialization.error?.message);
  assert.equal(initialization._meta.runtimeId, initialization.result.publicationEpoch);
  await waitForBrowserFixtureState(() => page.evaluate(async ({ id, context, url }) => {
    const result = await window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: "location.href" } });
    return result.ok && result.result.result === url;
  }, { id: created.browserPageId, context, url: `${url}initialized` }), "the initialized client navigation");
  const stoppedInitialization = await page.evaluate(({ id, context, placement }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "stop" } } }), { id: created.browserPageId, context, placement: created.placement });
  assert.equal(stoppedInitialization.ok, true);
  const stalePlacement = await page.evaluate(({ id, context, placement, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: { ...placement, pageHostGeneration: placement.pageHostGeneration + 1 }, action: { type: "navigate", url } } }), { id: created.browserPageId, context, placement: created.placement, url });
  assert.equal(stalePlacement.ok, false);
  const wrongWorkspace = await page.evaluate(({ id, context, placement, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "navigate", url } } }), { id: created.browserPageId, context: secondContext, placement: created.placement, url });
  assert.equal(wrongWorkspace.ok, false);
  await page.evaluate(({ id, context, url }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.goto", params: { page: id, worktree: `id:${context}`, url } }), { id: created.browserPageId, context, url });
  const environments = await page.evaluate(() => window.api.runtimeEnvironments.list());
  const remoteEnvironment = environments.find(environment => environment.id === "remote");
  const stalePairing = await page.evaluate(({ id, context, revision, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.fill", expectedEnvironmentPairingRevision: revision + 1, params: { page: id, worktree: `id:${context}`, element: "#remote", value: "stale-pairing", expectUrl: url } }), { id: created.browserPageId, context, revision: remoteEnvironment.pairingRevision, url });
  assert.equal(stalePairing.ok, false);
  assert.equal(stalePairing.error.code, "runtime_environment_changed");
  const unchanged = await page.evaluate(({ id, context }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: 'document.getElementById("remote").value' } }), { id: created.browserPageId, context });
  assert.equal(unchanged.result.result, "");
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
  const clientGuest = await resolveFixtureGuest(page, created.browserPageId, context);
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
  let recoveryFailure;
  try { await waitForBrowserFixtureState(async () => {
    try {
      const fresh = await page.evaluate(({ id, context }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.snapshot", params: { page: id, worktree: `id:${context}`, interactive: true } }), { id: created.browserPageId, context });
      recoveryFailure = fresh.ok ? null : fresh.error;
      return fresh.ok && JSON.stringify(fresh.result).includes("Remote input");
    } catch (error) { recoveryFailure = { message: error.message }; return false; }
  }, "a fresh client observation after link recovery"); } catch(error) { throw new Error(`${error.message}: ${JSON.stringify(recoveryFailure)}`); }
  const retainedValue = await page.evaluate(({ id, context }) => window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: 'document.getElementById("remote").value' } }), { id: created.browserPageId, context });
  assert.equal(retainedValue.result.result, "volatile value");
  const pendingPageId = "latest-pending-client";
  const pendingCreated = await page.evaluate(({ id, context, url }) => window.api.javisBrowser.call("browser.catalog.create", { page: id, context, url }), { id: pendingPageId, context, url });
  const initialPendingNavigation = await page.evaluate(({ id, context, placement, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "navigate", url } } }), { id: pendingPageId, context, placement: pendingCreated.placement, url: `${url}initializing` });
  assert.equal(initialPendingNavigation.ok, true);
  await waitForBrowserFixtureState(() => page.evaluate(async ({ id, context, url }) => {
    const response = await window.api.runtimeEnvironments.call({ selector: "remote", method: "session.tabs.list", params: { worktree: `id:${context}` } });
    return response.ok && response.result.tabs.some(tab => tab.browserPageId === id && tab.url === url);
  }, { id: pendingPageId, context, url: `${url}initializing` }), "the saved client navigation before restart");
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
  initializationResponse?.end();
  initializationResponse = undefined;
  await writeFile(join(directory, "hold-create-result"), "hold");
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
  await waitForBrowserFixtureState(async () => { try { await stat(join(directory, "create-result-held")); return true; } catch { return false; } }, "the actual uncommitted client creation result");
  const pendingCensus = await restoredPage.evaluate(({ context }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "session.tabs.list", params: { worktree: `id:${context}` } }), { context });
  const pendingTab = pendingCensus.result.tabs.find(tab => tab.browserPageId === pendingPageId);
  assert(pendingTab);
  assert.equal(pendingTab.initializationState, "pending");
  const pendingStop = await restoredPage.evaluate(({ id, context, placement }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "stop" } } }), { id: pendingPageId, context, placement: pendingTab.placement });
  assert.equal(pendingStop.ok, true, pendingStop.error?.message);
  assert.equal(pendingStop.result.tabs.find(tab => tab.browserPageId === pendingPageId).initializationState, "stopped");
  initializationResponse?.end();
  const resumed = await restoredPage.evaluate(({ id, context, placement, url }) => window.api.runtimeEnvironments.call({ selector: "remote", method: "browser.clientPage.initializationAction", params: { page: id, worktree: `id:${context}`, expectedPlacement: placement, action: { type: "navigate", url } } }), { id: pendingPageId, context, placement: pendingStop.result.tabs.find(tab => tab.browserPageId === pendingPageId).placement, url: `${url}resumed` });
  assert.equal(resumed.ok, true, resumed.error?.message);
  await rm(join(directory, "hold-create-result"));
  await waitForBrowserFixtureState(() => restoredPage.evaluate(async ({ id, context, url }) => {
    const result = await window.api.runtimeEnvironments.invoke({ selector: "remote", method: "browser.eval", params: { page: id, worktree: `id:${context}`, expression: "location.href" } });
    return result.ok && result.result.result === url;
  }, { id: pendingPageId, context, url: `${url}resumed` }), "the resumed initial client load");
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
  const recoveredGuest = await resolveFixtureGuest(restoredPage, created.browserPageId, context);
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
  await waitForBrowserFixtureState(() => restoredPage.evaluate(async (id) => {
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
  }, created.browserPageId), "the recovered renderer metadata");

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
      actualStagedCommandResult: true,
      actualHeadlessServerPlacement: true,
      initializationNavigateAndStop: true,
      pendingInitializationStopAndResume: true,
      stalePlacementAndWorkspaceRejected: true,
      stalePairingRejectedBeforeInput: true,
      authorityStampedCensus: true,
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
  await rm(join(directory, "hold-create-result"), { force: true });
  initializationResponse?.end();
  await browser?.close().catch(() => {});
  await stopJavisDaemon();
  process.env.JAVIS_STATE_DIR = remoteState;
  await stopJavisDaemon().catch(() => {});
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
