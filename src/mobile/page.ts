export const mobileHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Javis Mobile</title>
  <link rel="stylesheet" href="/mobile.css">
  <script src="/mobile.js" defer></script>
</head>
<body>
  <header><h1>Javis Mobile</h1><p>Control the desktop running Javis</p></header>
  <p id="status" role="status" aria-live="polite">Connecting…</p>
  <section id="pair-panel" hidden>
    <h2>Pair this phone</h2>
    <form id="pair-form">
      <label for="pair-code">Code shown by Javis on your desktop</label>
      <input id="pair-code" name="code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" required>
      <button type="submit">Pair</button>
    </form>
  </section>
  <main id="workspace" hidden>
    <section aria-label="Target window" class="target-grid">
      <label>App<select id="app-select" aria-label="App"></select></label>
      <label>Window<select id="window-select" aria-label="Window"></select></label>
      <button id="observe-button" type="button">Refresh observation</button>
    </section>
    <section class="observation" aria-label="Desktop observation">
      <h2>Screenshot</h2>
      <p id="image-note">Refresh to capture the selected window.</p>
      <img id="screenshot" alt="Desktop window screenshot; tap to click" hidden>
      <h2>Accessibility tree</h2>
      <pre id="tree" aria-label="Accessibility tree"></pre>
    </section>
    <section aria-label="Desktop actions">
      <h2>Actions</h2>
      <p id="delivery-warning" role="alert" hidden>Action delivery or observation is uncertain. Refresh before acting again.</p>
      <label class="foreground"><input type="checkbox" id="restore-window"> Bring the desktop window forward for input</label>
      <div class="action-grid">
        <form data-action="click"><h3>Click</h3><label>Element index<input name="elementIndex" type="number" min="0" step="1" required></label><label>Click count<input name="clickCount" type="number" min="1" max="3" value="1"></label><button type="submit">Click element</button><p>Or tap the screenshot.</p></form>
        <form data-action="setValue"><h3>Set value</h3><label>Element index<input name="elementIndex" type="number" min="0" step="1" required></label><label>Value<textarea name="value" rows="2"></textarea></label><button type="submit">Set value</button></form>
        <form data-action="typeText"><h3>Type text</h3><label>Text<textarea name="text" rows="2" required></textarea></label><button type="submit">Type text</button></form>
        <form data-action="pressKey"><h3>Press key</h3><label>Key<input name="key" required placeholder="Return"></label><button type="submit">Press key</button></form>
        <form data-action="hotkey"><h3>Hotkey</h3><label>Keys<input name="key" required placeholder="Cmd+S"></label><button type="submit">Press hotkey</button></form>
        <form data-action="pasteText"><h3>Paste text</h3><label>Text<textarea name="text" rows="2" required></textarea></label><button type="submit">Paste text</button></form>
        <form data-action="scroll"><h3>Scroll</h3><label>Element index<input name="elementIndex" type="number" min="0" step="1" required></label><label>Direction<select name="direction"><option>down</option><option>up</option><option>left</option><option>right</option></select></label><label>Pages<input name="pages" type="number" min="0.1" step="0.1" value="1"></label><button type="submit">Scroll</button></form>
        <form data-action="drag"><h3>Drag</h3><label>From element<input name="fromElementIndex" type="number" min="0" step="1" required></label><label>To element<input name="toElementIndex" type="number" min="0" step="1" required></label><button type="submit">Drag</button></form>
        <form data-action="performSecondaryAction"><h3>Secondary action</h3><label>Element index<input name="elementIndex" type="number" min="0" step="1" required></label><label>Action name<input name="action" required></label><button type="submit">Perform action</button></form>
      </div>
    </section>
  </main>
</body>
</html>`

export const mobileCss = `
:root { font-family: system-ui, sans-serif; color-scheme: light dark; line-height: 1.4; }
* { box-sizing: border-box; }
body { max-width: 1100px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); }
header h1 { margin: 0; font-size: 1.5rem; }
header p { margin: 4px 0 16px; opacity: .75; }
h2 { font-size: 1.15rem; }
h3 { font-size: 1rem; margin: 0 0 8px; }
section { margin: 16px 0 24px; }
label { display: block; font-weight: 600; margin: 8px 0; }
input, select, textarea, button { width: 100%; padding: 10px; font: inherit; border-radius: 8px; border: 1px solid currentColor; }
textarea { resize: vertical; }
button { cursor: pointer; font-weight: 600; }
button:disabled { cursor: not-allowed; opacity: .5; }
#status, #delivery-warning { padding: 10px 12px; border: 1px solid currentColor; border-radius: 8px; }
#delivery-warning { color: #a33; }
.target-grid, .action-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; align-items: end; }
.action-grid form { border: 1px solid currentColor; border-radius: 10px; padding: 12px; }
.action-grid form p { margin-bottom: 0; opacity: .7; }
.observation { overflow: hidden; }
#screenshot { display: block; width: 100%; max-width: 800px; height: auto; border: 1px solid currentColor; touch-action: manipulation; }
#screenshot[hidden] { display: none; }
#tree { max-height: 45vh; overflow: auto; padding: 12px; border: 1px solid currentColor; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.foreground { display: flex; align-items: center; gap: 8px; }
.foreground input { width: auto; }
`

export const mobileJavaScript = `
'use strict';
const pairPanel = document.getElementById('pair-panel');
const workspace = document.getElementById('workspace');
const status = document.getElementById('status');
const warning = document.getElementById('delivery-warning');
const appSelect = document.getElementById('app-select');
const windowSelect = document.getElementById('window-select');
const screenshot = document.getElementById('screenshot');
const imageNote = document.getElementById('image-note');
const tree = document.getElementById('tree');
let csrfToken = '';
let pairToken = '';
let windows = [];
let fresh = false;
let busy = false;

function message(value) { status.textContent = value; }
function ready(value) {
  fresh = value;
  for (const button of document.querySelectorAll('[data-action] button[type="submit"]')) button.disabled = !value || busy;
}
function uncertain(value) { warning.hidden = !value; if (value) ready(false); }
async function request(path, options) {
  const response = await fetch(path, Object.assign({ cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(70000) }, options || {}));
  const value = await response.json();
  if (!response.ok) throw new Error(value.error && value.error.message || 'Request failed');
  return value;
}
function post(path, value, token) {
  return request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-javis-csrf': token }, body: JSON.stringify(value) });
}
function render(value) {
  if (value.snapshot) {
    tree.textContent = value.snapshot.treeText || '';
  } else {
    tree.textContent = '';
  }
  if (value.screenshot && value.screenshot.format === 'png' && value.screenshot.data) {
    screenshot.src = 'data:image/png;base64,' + value.screenshot.data;
    screenshot.hidden = false;
    imageNote.hidden = true;
  } else {
    screenshot.removeAttribute('src');
    screenshot.hidden = true;
    imageNote.hidden = false;
    imageNote.textContent = 'No screenshot is available for this observation.';
  }
  uncertain(Boolean(value.observationError));
  if (value.observationError) message('Input may have been delivered. Refresh before another action.');
  else { ready(true); message('Observation is ready.'); }
}
function fillSelect(select, options) {
  select.replaceChildren();
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
}
async function loadWindows() {
  ready(false);
  uncertain(false);
  const app = appSelect.value;
  if (!app) { fillSelect(windowSelect, []); return; }
  const result = await request('/api/windows?app=' + encodeURIComponent(app));
  windows = Array.isArray(result.windows) ? result.windows : [];
  fillSelect(windowSelect, [{ value: '', label: 'Default window' }].concat(windows.map((window, index) => ({ value: String(index), label: window.title || 'Window ' + (index + 1) }))));
}
async function loadApps() {
  const result = await request('/api/apps');
  const apps = Array.isArray(result.apps) ? result.apps : [];
  fillSelect(appSelect, apps.map(app => ({ value: app.bundleId || 'pid:' + app.pid, label: app.name || app.bundleId || 'PID ' + app.pid })));
  if (apps.length) await loadWindows();
  else message('No desktop apps found.');
}
async function observe() {
  if (!appSelect.value) { message('Choose an app first.'); return; }
  ready(false);
  busy = true;
  message('Refreshing observation…');
  const selection = { app: appSelect.value };
  if (windowSelect.value !== '') {
    const window = windows[Number(windowSelect.value)];
    if (window && Number.isInteger(window.id)) selection.windowId = window.id;
    else if (window && Number.isInteger(window.index)) selection.windowIndex = window.index;
  }
  try { render(await post('/api/observe', selection, csrfToken)); }
  catch (error) { uncertain(true); message(String(error.message || error)); }
  finally { busy = false; ready(fresh); }
}
async function runAction(method, params) {
  if (!fresh || busy) return;
  busy = true;
  ready(false);
  message('Sending action…');
  if (document.getElementById('restore-window').checked) params.restoreWindow = true;
  try {
    const result = await post('/api/action', { method, params, requestId: crypto.randomUUID() }, csrfToken);
    render(result);
  } catch (error) {
    uncertain(true);
    message('Action outcome is uncertain. Refresh before acting again. ' + String(error.message || error));
  } finally { busy = false; ready(fresh); }
}
function formParams(form) {
  const params = {};
  for (const [key, value] of new FormData(form)) {
    if (value === '' && key !== 'value') continue;
    params[key] = ['elementIndex', 'fromElementIndex', 'toElementIndex', 'clickCount', 'pages'].includes(key) ? Number(value) : value;
  }
  return params;
}
document.getElementById('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('pair-code');
  try {
    const result = await post('/api/pair', { code: input.value.trim() }, pairToken);
    input.value = '';
    csrfToken = result.csrfToken;
    pairPanel.hidden = true;
    workspace.hidden = false;
    message('Paired. Loading apps…');
    await loadApps();
  } catch (error) { message(String(error.message || error)); }
});
document.getElementById('observe-button').addEventListener('click', observe);
appSelect.addEventListener('change', () => { loadWindows().catch(error => message(String(error.message || error))); });
windowSelect.addEventListener('change', () => { ready(false); uncertain(false); });
for (const form of document.querySelectorAll('[data-action]')) {
  form.addEventListener('submit', event => { event.preventDefault(); runAction(form.dataset.action, formParams(form)); });
}
screenshot.addEventListener('click', event => {
  if (!fresh || busy) return;
  const rect = screenshot.getBoundingClientRect();
  runAction('click', { tap: { clientX: event.clientX - rect.left, clientY: event.clientY - rect.top, rectWidth: rect.width, rectHeight: rect.height } });
});
async function start() {
  ready(false);
  try {
    const session = await request('/api/session');
    csrfToken = session.csrfToken;
    workspace.hidden = false;
    message('Paired. Refresh before acting.');
    await loadApps();
  } catch (error) {
    try {
      const token = await request('/api/pair-token');
      pairToken = token.csrfToken;
      pairPanel.hidden = false;
      message('Enter the one-time pairing code.');
    } catch (tokenError) { message(String(tokenError.message || tokenError)); }
  }
}
start();
`
