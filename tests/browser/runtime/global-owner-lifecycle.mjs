import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  copyFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const root = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "javis-whole-review-"));
const browser = join(dir, "browser");
await mkdir(join(browser, "main"), { recursive: true });
const executable =
  process.platform === "darwin"
    ? join(browser, "electron/Electron.app/Contents/MacOS/Electron")
    : join(
        browser,
        "electron",
        process.platform === "win32" ? "electron.exe" : "electron",
      );
await mkdir(
  process.platform === "darwin"
    ? join(browser, "electron/Electron.app/Contents/MacOS")
    : join(browser, "electron"),
  { recursive: true },
);
await writeFile(join(browser, "main/main.cjs"), "");
await writeFile(
  join(browser, "package.json"),
  JSON.stringify({ main: "peer.cjs" }),
);
if (process.platform === "win32") await copyFile(process.execPath, executable);
else await symlink(process.execPath, executable);
await writeFile(
  join(browser, "peer.cjs"),
  `
const net=require('node:net'), fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(join(dir, "launched"))},process.pid+'\\n');
const sock=net.createConnection(process.env.JAVIS_BROWSER_CHANNEL);
sock.on('connect',()=>sock.write(JSON.stringify({kind:'ready',token:process.env.JAVIS_BROWSER_TOKEN,pid:process.pid,protocolVersion:1})+'\\n'));
let buf='';sock.on('data',chunk=>{buf+=chunk; const lines=buf.split('\\n');buf=lines.pop();for(const line of lines){const req=JSON.parse(line);if(req.method==='browser.eval'){fs.appendFileSync(${JSON.stringify(join(dir, "delivery"))},'delivered\\n');sock.destroy();continue;}sock.write(JSON.stringify({kind:'response',id:req.id,ok:true,result:{pid:process.pid}})+'\\n');if(req.method==='__shutdown')sock.end();}});
sock.on('close',()=>process.exit(0));
`,
);
process.env.JAVIS_CLI_ENTRY = join(dir, "cli.cjs");
process.env.JAVIS_STATE_DIR = join(dir, "state");
const bundled = join(dir, "probe.cjs");
await build({
  entryPoints: [join(root, "src/browser/runtime/browser-process.ts")],
  outfile: bundled,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "node-pty"],
  logLevel: "silent",
});
const runtime = createRequire(import.meta.url)(bundled);
let pids = [];
try {
  const results = await Promise.all([
    runtime.callBrowser("browser.status", {}),
    runtime.callBrowser("browser.status", {}),
  ]);
  pids = (await readFile(join(dir, "launched"), "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  assert.equal(results[0].pid, results[1].pid);

  await runtime.stopBrowserProcess();
  const alive = pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(alive, []);
  const cancelled = runtime.callBrowser("browser.status", {});
  await runtime.stopBrowserProcess();
  await assert.rejects(cancelled);
  process.env.JAVIS_BROWSER_EXECUTABLE = join(dir, "missing-chromium");
  await rm(join(browser, "main/main.cjs"));
  await assert.rejects(() => runtime.callBrowser("browser.status", {}));
  await writeFile(join(browser, "main/main.cjs"), "");
  delete process.env.JAVIS_BROWSER_EXECUTABLE;
  const repaired = await runtime.callBrowser("browser.status", {});
  assert.ok(repaired.pid);
  await assert.rejects(() =>
    runtime.callBrowser("browser.eval", { expression: "fixture-delivery" }),
  );
  await runtime.callBrowser("browser.status", {});
  assert.equal(await readFile(join(dir, "delivery"), "utf8"), "delivered\n");
  await runtime.stopBrowserProcess();
  pids = (await readFile(join(dir, "launched"), "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  assert.deepEqual(
    pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }),
    [],
  );
  console.log(
    JSON.stringify({
      coalesced: true,
      pendingShutdownReaped: true,
      failedFallbackRepaired: true,
      deliveredActionNotReplayed: true,
      noOwnedPeerAlive: true,
    }),
  );
} finally {
  for (const pid of pids)
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  await rm(dir, { recursive: true, force: true });
}
