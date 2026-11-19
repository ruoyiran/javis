export const mobileBrowserHtml = `
<section id="browser-workspace" aria-label="Javis browser">
  <h2>Browser</h2>
  <label>Page<select id="browser-pages"></select></label>
  <button id="browser-pages-refresh" type="button">Load browser pages</button>
  <button id="browser-observe" type="button">Refresh browser observation</button>
  <button id="browser-stream" type="button">View live browser</button>
  <form id="browser-address-form"><label>Address<input id="browser-address" type="url" required></label><button type="submit">Navigate</button></form>
  <p id="browser-status" role="status" aria-live="polite">Load pages to select a browser tab.</p>
  <img id="browser-frame" alt="Live browser page; tap to click" hidden>
  <pre id="browser-snapshot" aria-label="Browser observation"></pre>
  <form id="browser-type-form"><label>Text<textarea id="browser-text" rows="2" required></textarea></label><button type="submit">Type in browser</button></form>
  <button id="browser-scroll" type="button">Scroll down</button>
</section>`

export const mobileBrowserJavaScript = `'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const pages = byId('browser-pages');
  const frame = byId('browser-frame');
  let csrf, target, events, fresh = false, busy = false, imageUrl, pendingImageUrl, displayedFrame, streamGeneration = 0;
  const status = text => { byId('browser-status').textContent = text; };
  function clearFrame() {
    streamGeneration++; displayedFrame = undefined; frame.onload = null; frame.onerror = null; frame.hidden = true; frame.removeAttribute('src');
    if (imageUrl) URL.revokeObjectURL(imageUrl); if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
    imageUrl = undefined; pendingImageUrl = undefined;
  }
  async function call(path, body) {
    if (!csrf) { const session = await fetch('/api/session').then(r => r.json()); csrf = session.csrfToken; }
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'x-javis-csrf': csrf } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(95000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Browser request failed');
    return result;
  }
  function observed(result) {
    if (result.observationError) { fresh = false; status('Refresh before acting again.'); return; }
    target = result.target; fresh = Boolean(target);
    byId('browser-snapshot').textContent = JSON.stringify(result.snapshot, null, 2);
    if (target) byId('browser-address').value = target.url;
    status('Browser observation is current.');
  }
  async function action(method, params) {
    if (!fresh || busy) { status('Refresh before acting.'); return; }
    fresh = false; busy = true; const page = target?.page; const generation = streamGeneration;
    try { const result = await call('/api/browser/action', { method, params, frame: displayedFrame ? { subscriptionId: displayedFrame.subscriptionId, seq: displayedFrame.seq } : undefined, requestId: crypto.randomUUID() }); if (generation === streamGeneration && page === target?.page) observed(result); }
    catch (error) { status(error.message + ' Refresh before acting again.'); }
    finally { busy = false; }
  }
  byId('browser-pages-refresh').addEventListener('click', async () => {
    try {
      const result = await call('/api/browser/pages'); pages.replaceChildren();
      for (const tab of result.tabs || []) { const option = document.createElement('option'); option.value = tab.pageId || tab.browserPageId; option.textContent = tab.title || tab.url || option.value; pages.append(option); }
      status('Select a page and refresh its observation.');
    } catch (error) { status(error.message); }
  });
  async function select() { clearFrame(); fresh = false; target = undefined; const generation = streamGeneration; const page = pages.value; const result = await call('/api/browser/select', { page }); if (generation === streamGeneration && pages.value === page) observed(result); }
  pages.addEventListener('change', () => { events?.close(); events = undefined; select().catch(error => status(error.message)); });
  byId('browser-observe').addEventListener('click', () => { (target && target.page === pages.value ? call('/api/browser/observe', {}) : call('/api/browser/select', { page: pages.value })).then(observed).catch(error => { fresh = false; status(error.message); }); });
  byId('browser-stream').addEventListener('click', async () => {
    try {
      if (!target || target.page !== pages.value) await select();
      clearFrame(); const generation = streamGeneration; const selectedPage = target.page;
      events?.close(); events = new EventSource('/api/browser/events');
      const currentEvents = events;
      events.onmessage = event => {
        if (generation !== streamGeneration || selectedPage !== target?.page || currentEvents !== events) return;
        try {
          const message = JSON.parse(event.data);
          if (message.method === 'browser.stream.binary') {
            if (message.params.page !== selectedPage || !message.params.subscriptionId) return;
            const bytes = Uint8Array.from(atob(message.params.bytes), c => c.charCodeAt(0));
            const view = new DataView(bytes.buffer);
            if (bytes.length < 16 || view.getUint8(0) !== 98 || view.getUint8(1) !== 1 || view.getUint8(2) !== 1 || view.getUint32(12, true) !== 0) throw new Error('Invalid browser frame');
            const length = view.getUint32(8, true); if (length > 65536 || length + 16 > bytes.length) throw new Error('Invalid frame metadata');
            const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)));
            const seq = view.getUint32(4, true); const format = view.getUint8(3);
            if (format !== 1 && format !== 2) throw new Error('Invalid frame format');
            const next = URL.createObjectURL(new Blob([bytes.subarray(16 + length)], { type: format === 2 ? 'image/png' : 'image/jpeg' }));
            if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl); pendingImageUrl = next;
            frame.onload = () => {
              if (generation !== streamGeneration || selectedPage !== target?.page || pendingImageUrl !== next) { URL.revokeObjectURL(next); return; }
              if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = next; pendingImageUrl = undefined;
              displayedFrame = { page: selectedPage, subscriptionId: message.params.subscriptionId, seq }; frame.hidden = false;
              call('/api/browser/ack', { seq }).catch(error => status(error.message));
            };
            frame.onerror = () => { if (generation === streamGeneration) { clearFrame(); fresh = false; status('Browser frame could not be decoded. Reconnect and refresh.'); } };

            frame.src = next;
            if (target && metadata.deviceWidth && metadata.deviceHeight && (metadata.deviceWidth !== target.width || metadata.deviceHeight !== target.height)) { fresh = false; status('Browser geometry changed. Refresh before acting.'); }
          } else if (message.params.type === 'end' || message.params.type === 'error') { fresh = false; clearFrame(); currentEvents.close(); status('Browser stream ended. Refresh before acting.'); }
        } catch (error) { fresh = false; clearFrame(); currentEvents.close(); status(error.message); }
      };
      events.onerror = () => { if (generation !== streamGeneration) return; fresh = false; clearFrame(); currentEvents.close(); status('Browser disconnected. Refresh before acting.'); };
      await new Promise((resolve, reject) => { events.onopen = resolve; const failed = events.onerror; events.onerror = () => { failed(); reject(new Error('Browser stream disconnected')); }; });
      const streamResult = await call('/api/browser/stream', { width: Math.min(3840, Math.max(1, Math.round(frame.parentElement.clientWidth))), height: Math.min(2160, Math.max(1, window.innerHeight)), deviceScaleFactor: Math.min(3, window.devicePixelRatio || 1) }); if (generation === streamGeneration && selectedPage === target?.page) observed(streamResult);
    } catch (error) { fresh = false; status(error.message); }
  });
  frame.addEventListener('click', event => { if (!target || frame.hidden || !displayedFrame || displayedFrame.page !== target.page) return; const rect = frame.getBoundingClientRect(); action('browser.mouseClick', { x: (event.clientX - rect.left) * target.width / rect.width, y: (event.clientY - rect.top) * target.height / rect.height }); });
  byId('browser-address-form').addEventListener('submit', event => { event.preventDefault(); action('browser.goto', { url: byId('browser-address').value }); });
  byId('browser-type-form').addEventListener('submit', event => { event.preventDefault(); action('browser.type', { input: byId('browser-text').value }); });
  byId('browser-scroll').addEventListener('click', () => action('browser.scroll', { direction: 'down', amount: 500 }));
  window.addEventListener('pagehide', () => { events?.close(); clearFrame(); });
})();`
