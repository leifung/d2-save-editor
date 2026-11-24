#!/usr/bin/env node
/* =========================================================================
 * test_import_ui.js — real-browser E2E for the import / shop UI
 *
 * Chrome DevTools Protocol (Edge headless), no external deps (Node 22 WebSocket).
 * ========================================================================= */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const E = require('./d2s_engine.js');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'd2s_data.json'), 'utf8'));
const engine = E.makeEngine(DATA);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.join(__dirname, '暗黑2存档修改器_1.13c.html');
const SAVE = 'D:\\3DMGAME_DiabloII.V1.13C.CHS.Green\\Diablo II原始\\Diablo II\\Save\\leiya.d2s';
const PORT = 9347;
const UDD = path.join(os.tmpdir(), 'd2s_import_ui_' + Date.now());

let pass = 0, fail = 0;
function ck(n, c, x) { (c ? pass++ : fail++); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? '  ' + x : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + UDD,
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

async function main() {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find(t => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('Edge CDP did not start');
  ck('Edge headless CDP connected', true);

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' +
      (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  };
  function send(method, params) {
    return new Promise(resolve => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }
  async function ev(expr, awaitPromise) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  }

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "(function(){var o=URL.createObjectURL.bind(URL);URL.createObjectURL=function(b){window.__BLOBS__=(window.__BLOBS__||[]);window.__BLOBS__.push(b);window.__LAST_BLOB__=b;return o(b)};})();"
  });
  await send('Page.navigate', { url: 'file:///' + HTML.replace(/\\/g, '/') });
  await sleep(1100);

  ck('page loaded', await ev('document.title') === '暗黑破坏神 II 存档修改器 · 1.13c');
  ck('item metadata inlined', await ev("JSON.parse(document.getElementById('d2s-data').textContent).meta.size") !== undefined);
  ck('5 tabs rendered', await ev("document.querySelectorAll('.tab').length") === 5,
    String(await ev("document.querySelectorAll('.tab').length")));
  ck('base item datalist populated', await ev("document.querySelectorAll('#baselist option').length") >= 650,
    String(await ev("document.querySelectorAll('#baselist option').length")));
  ck('shop categories rendered', await ev("document.querySelectorAll('#shop-cats .shopcat').length") === 8,
    String(await ev("document.querySelectorAll('#shop-cats .shopcat').length")));

  // choose the main .d2s
  const doc = (await send('DOM.getDocument', { depth: 1 })).result.root;
  const inp = (await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#file' })).result;
  await send('DOM.setFileInputFiles', { files: [SAVE], nodeId: inp.nodeId });
  await ev("document.getElementById('file').dispatchEvent(new Event('change',{bubbles:true}))");
  await sleep(900);
  ck('main save parsed', await ev("document.querySelectorAll('#attr-grid .attr').length") === 14);

  // ---- import tab: create from scratch ----
  await ev("document.querySelector('[data-tab=import]').click()");
  await sleep(150);
  ck('import tab visible', await ev("document.getElementById('page-import').classList.contains('on')"));
  await ev("document.querySelector('[data-src=create]').click()");
  await sleep(150);
  ck('create form rendered', await ev("!!document.getElementById('c-code')"));
  ck('create form has base picker', await ev("document.getElementById('c-code').getAttribute('list')") === 'baselist');
  await ev("document.getElementById('c-gen').click()");
  await sleep(150);
  ck('generated item added to queue', await ev("document.getElementById('imp-count').textContent") === '1',
    String(await ev("document.getElementById('imp-count').textContent")));
  // add a magic property and generate a second item
  await ev("document.getElementById('cp-add').click()");
  await sleep(120);
  ck('create prop added', await ev("document.querySelectorAll('#srcbody .additem').length") === 1);
  await ev("document.getElementById('c-gen').click()");
  await sleep(150);
  ck('second item (with prop) added', await ev("document.getElementById('imp-count').textContent") === '2',
    String(await ev("document.getElementById('imp-count').textContent")));

  // ---- hex import ----
  const orig = new Uint8Array(fs.readFileSync(SAVE));
  const oneItem = engine.parseItemBlob(orig).items[0];
  const hex = Buffer.from(oneItem.bytes).toString('hex');
  await ev("document.querySelector('[data-src=blob]').click()");
  await sleep(150);
  await ev("(function(){var t=document.getElementById('src-hex');t.value='" + hex + "';t.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.getElementById('src-hexgo').click()");
  await sleep(250);
  ck('hex item parsed in UI', await ev("document.querySelectorAll('#src-list .srcitem').length") === 1,
    String(await ev("document.querySelectorAll('#src-list .srcitem').length")));
  await ev("(function(){var c=document.querySelector('#src-list input[type=checkbox]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await ev("document.getElementById('src-join').click()");
  await sleep(150);
  ck('hex item added to queue', await ev("document.getElementById('imp-count').textContent") === '3',
    String(await ev("document.getElementById('imp-count').textContent")));

  // ---- load another .d2s as an import source ----
  await ev("document.querySelector('[data-src=d2s]').click()");
  await sleep(150);
  const srcNode = (await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#src-d2s-file' })).result;
  await send('DOM.setFileInputFiles', { files: [SAVE], nodeId: srcNode.nodeId });
  await ev("document.getElementById('src-d2s-file').dispatchEvent(new Event('change',{bubbles:true}))");
  await sleep(500);
  ck('other .d2s parsed as item source', await ev("document.querySelectorAll('#src-list .srcitem').length") >= 100,
    String(await ev("document.querySelectorAll('#src-list .srcitem').length")));

  // ---- library: save an equipment item ----
  await ev("document.querySelector('[data-tab=equip]').click()");
  await sleep(150);
  await ev("document.querySelector('#eq-scroll .eq-item').click()");
  await sleep(150);
  ck('equip detail shows export buttons', await ev("!!document.querySelector('[data-eqlib]')"));
  await ev("document.querySelector('[data-eqlib]').click()");
  await sleep(150);
  ck('item stored in local library', await ev("JSON.parse(localStorage.getItem('d2s_itemlib_v1')||'[]').length") === 1);
  await ev("document.querySelector('[data-tab=import]').click()");
  await ev("document.querySelector('[data-src=library]').click()");
  await sleep(150);
  ck('library panel lists stored item', await ev("document.querySelectorAll('#src-list .srcitem').length") === 1,
    String(await ev("document.querySelectorAll('#src-list .srcitem').length")));

  // ---- shop: one-click shelf of all 33 runes ----
  await ev("document.querySelector('[data-tab=shop]').click()");
  await sleep(150);
  ck('shop tab visible', await ev("document.getElementById('page-shop').classList.contains('on')"));
  ck('rune catalog has 33 goods', await ev("document.querySelectorAll('#shop-goods .shopgood').length") === 33,
    String(await ev("document.querySelectorAll('#shop-goods .shopgood').length")));
  await ev("document.getElementById('shop-all').click()");
  await sleep(120);
  ck('all runes selected', await ev("document.querySelectorAll('#shop-goods input:checked').length") === 33);
  await ev("document.getElementById('shop-shelf').click()");
  await sleep(250);
  ck('33 runes added to queue', await ev("document.getElementById('imp-count').textContent") === '36',
    String(await ev("document.getElementById('imp-count').textContent")));

  // ---- custom shop category ----
  await ev("document.getElementById('shop-new').click()");
  await sleep(120);
  await ev("(function(){var n=document.getElementById('sc-name');n.value='我的测试商品';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await ev("document.getElementById('sc-add').click()");
  await sleep(120);
  ck('custom category can hold multiple goods', await ev("document.querySelectorAll('#sc-goods .goodsrow').length") === 2);
  await ev("document.getElementById('sc-save').click()");
  await sleep(200);
  ck('custom shop category added', await ev("document.querySelectorAll('#shop-cats .shopcat').length") === 9,
    String(await ev("document.querySelectorAll('#shop-cats .shopcat').length")));
  ck('custom category persisted', await ev("JSON.parse(localStorage.getItem('d2s_shopcats_v1')||'[]').length") === 1);
  ck('custom category has 2 goods', await ev("JSON.parse(localStorage.getItem('d2s_shopcats_v1')||'[]')[0].goods.length") === 2);

  // ---- vendor assortment category (largest catalog) ----
  const vendId = await ev("(JSON.parse(document.getElementById('d2s-data').textContent).meta.shop.filter(function(c){return c.id==='vendors'})[0]||{}).id");
  await ev("document.querySelector('[data-shopcat=\"" + vendId + "\"]').click()");
  await sleep(300);
  ck('vendor assortment renders', await ev("document.querySelectorAll('#shop-goods .shopgood').length") > 100,
    String(await ev("document.querySelectorAll('#shop-goods .shopgood').length")));

  // ---- .d2i export from equipment detail ----
  const blobsBefore = await ev("(window.__BLOBS__||[]).length");
  await ev("document.querySelector('[data-tab=equip]').click()");
  await sleep(120);
  await ev("document.querySelector('[data-equipdl]').click()");
  await sleep(180);
  ck('.d2i export produced a Blob', await ev("(window.__BLOBS__||[]).length") === blobsBefore + 1);

  // ---- save & verify bytes ----
  await ev("document.getElementById('save').click()");
  await sleep(600);
  const b64 = await ev("(async function(){var b=window.__LAST_BLOB__;if(!b)return null;var a=await b.arrayBuffer();var u=new Uint8Array(a);var s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)})()", true);
  ck('download Blob produced', !!b64 && b64.length > 100);
  if (!b64) throw new Error('no blob captured');
  const out = new Uint8Array(Buffer.from(b64, 'base64'));
  const rOut = engine.parse(out);
  ck('saved file grew', out.length > orig.length, orig.length + ' -> ' + out.length + ' B');
  ck('saved file parses to exact EOF', rOut.ok, 'end=' + rOut.end_byte + '/' + out.length);
  ck('saved file checksum valid', rOut.checksum_ok);
  ck('36 items imported', rOut.item_count === 106 + 36, '106 -> ' + rOut.item_count);
  const names = rOut.items.map(i => i.display_name).join('|');
  ck('imported runes visible in saved file', /艾尔/.test(names) && /佐德|萨德|Zod/.test(names) || /符文/.test(names));
  ck('no JS runtime exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
  ws.close(); edge.kill();
  setTimeout(() => process.exit(fail ? 1 : 0), 200);
}
main().catch(e => { console.error('E2E ERROR', e); edge.kill(); process.exit(1); });
