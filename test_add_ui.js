/* Real-browser E2E for the "add skill / add property" UI (Edge + CDP). */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const E = require('./d2s_engine.js');
const DATA = JSON.parse(fs.readFileSync('d2s_data.json', 'utf8'));
const engine = E.makeEngine(DATA);

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.join(__dirname, '暗黑2存档修改器_1.13c.html');
const SAVE = 'D:\\3DMGAME_DiabloII.V1.13C.CHS.Green\\Diablo II原始\\Diablo II\\Save\\leiya.d2s';
const PORT = 9377;
const UDD = path.join(os.tmpdir(), 'd2s_add_ui_' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ck(n, c, x) { (c ? pass++ : fail++); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? '  ' + x : '')); }

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1400,1100', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + UDD, '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

async function main() {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find(t => t.type === 'page');
      if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch (e) { }
    await sleep(250);
  }
  if (!wsUrl) throw new Error('Edge CDP did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.text + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      errors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  };
  const send = (method, params) => new Promise(resolve => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr, awaitPromise) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false });
  // Capture the Blob produced by "save & download" so we can verify the bytes.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "(function(){var o=URL.createObjectURL.bind(URL);URL.createObjectURL=function(b){window.__LAST_BLOB__=b;return o(b)};})();"
  });
  await send('Page.navigate', { url: 'file:///' + HTML.replace(/\\/g, '/') });
  await sleep(1100);

  ck('page loaded', await ev('document.title') === '暗黑破坏神 II 存档修改器 · 1.13c');
  ck('add metadata inlined', await ev("JSON.parse(document.getElementById('d2s-data').textContent).add.addable.length") === 239);

  // choose the .d2s file
  const doc = (await send('DOM.getDocument', { depth: 1 })).result.root;
  const inp = (await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#file' })).result;
  await send('DOM.setFileInputFiles', { files: [SAVE], nodeId: inp.nodeId });
  await ev("document.getElementById('file').dispatchEvent(new Event('change',{bubbles:true}))");
  await sleep(900);
  ck('save parsed', await ev("document.querySelectorAll('#attr-grid .attr').length") === 14);

  await ev("document.querySelector('.tab[data-tab=equip]').click()");
  await sleep(200);
  // pick first item that has an add panel enabled
  const picked = await ev("(function(){var e=document.querySelectorAll('#eq-scroll .eq-item');for(var i=0;i<e.length;i++){e[i].click();if(document.querySelector('#add-join'))return e[i].querySelector('.eq-nm').innerText}return null})()");
  await sleep(200);
  ck('add panel shown for an editable item', await ev("!!document.querySelector('#add-panel')"), picked || '');
  ck('default category = 技能', await ev("document.querySelector('.addcat.on') && document.querySelector('.addcat.on').dataset.cat") === 'skill');
  ck('skill category contains +所有技能等级', await ev("!!document.querySelector('#add-prop option[value=\"127\"]')"));
  ck('239 writable stats available in 全部', await ev("(function(){document.querySelector('[data-cat=all]').click();return document.querySelectorAll('#add-prop option').length})()") === 239);

  // back to skill category, add "+7 All Skills"
  await ev("document.querySelector('[data-cat=skill]').click()");
  await ev("(function(){var s=document.getElementById('add-prop');s.value='127';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await sleep(120);
  ck('form shows 1 numeric field for stat 127', await ev("document.querySelectorAll('#add-panel .addv').length") === 1);
  await ev("(function(){var i=document.querySelector('#add-panel .addv');i.value='7';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await ev("document.getElementById('add-join').click()");
  await sleep(150);
  ck('one pending addition', await ev("document.querySelectorAll('.additem').length") === 1);
  ck('bottom counter = 1', await ev("document.getElementById('add-count').textContent") === '1');

  // add a charged skill
  await ev("(function(){var s=document.getElementById('add-prop');s.value='204';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await sleep(120);
  ck('charged skill form has 4 fields', await ev("document.querySelectorAll('#add-panel .addv').length") === 4);
  ck('skill dropdown has Chinese skill names', await ev("(function(){var s=document.querySelector('#add-panel .addv[data-k=\"1\"]');return s && /传送/.test(s.options[s.selectedIndex].text)})()"));
  await ev("(function(){function set(k,v){var e=document.querySelector('#add-panel .addv[data-k=\"'+k+'\"]');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}set(0,8);set(1,54);set(2,10);set(3,20)})()");
  await ev("document.getElementById('add-join').click()");
  await sleep(150);
  ck('two pending additions', await ev("document.querySelectorAll('.additem').length") === 2);
  ck('pending list shows Chinese names', await ev("document.querySelector('.addlist').innerText.indexOf('充能技能')>=0"));

  // search + delete (search across all categories; skill-only has no resist stats)
  await ev("document.querySelector('[data-cat=all]').click()");
  await ev("(function(){var q=document.getElementById('add-q');q.value='抗性';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await sleep(150);
  ck('Chinese search filters stats', await ev("document.querySelectorAll('#add-prop option').length") > 0 &&
    await ev("document.querySelectorAll('#add-prop option').length") < 239 &&
    await ev("document.getElementById('add-q').value") === '抗性',
    'options=' + await ev("document.querySelectorAll('#add-prop option').length"));
  await ev("(function(){var q=document.getElementById('add-q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
  await sleep(120);
  await ev("document.querySelector('[data-add-del]').click()");
  await sleep(120);
  ck('delete removes one pending item', await ev("document.querySelectorAll('.additem').length") === 1);
  // re-add all-skills so both encodings end up in the saved file
  await ev("(function(){var s=document.getElementById('add-prop');s.value='127';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await sleep(120);
  await ev("(function(){var i=document.querySelector('#add-panel .addv');i.value='7';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await ev("document.getElementById('add-join').click()");
  await sleep(150);
  ck('two pending additions again', await ev("document.querySelectorAll('.additem').length") === 2);

  // screenshot of the panel (scroll it into view first)
  ck('quick-jump button exists', await ev("!!document.querySelector('[data-goadd]')"));
  await ev("document.querySelector('[data-goadd]').click()");
  await sleep(450);
  let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, 'add_ui.png'), Buffer.from(shot.result.data, 'base64'));

  // save & download
  await ev("document.getElementById('save').click()");
  await sleep(500);
  const b64 = await ev("(async function(){var b=window.__LAST_BLOB__;if(!b)return null;var a=await b.arrayBuffer();var u=new Uint8Array(a);var s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)})()", true);
  ck('download Blob produced', !!b64 && b64.length > 100);
  if (!b64) throw new Error('no blob captured');
  const out = new Uint8Array(Buffer.from(b64, 'base64'));
  fs.writeFileSync('add_ui_out.d2s', Buffer.from(out));
  const orig = new Uint8Array(fs.readFileSync(SAVE));
  ck('saved file grew', out.length > orig.length, orig.length + ' -> ' + out.length);
  const r2 = engine.parse(out);
  ck('saved file parses to exact EOF', r2.ok, 'end=' + r2.end_byte + '/' + out.length);
  ck('saved file checksum valid', r2.checksum_ok);

  const flat = [];
  for (const t of r2.toplevel) engine.flatten([t], flat);
  const target = flat.find(i => i.display_name === picked);
  ck('target item found in saved file', !!target, picked);
  if (target) {
    const all = target.props.find(p => p.id === 127);
    const charged = target.props.find(p => p.id === 204);
    ck('+7 All Skills written', !!all && (all.values[0].raw - all.values[0].sA) === 7,
      all ? String(all.values[0].raw - all.values[0].sA) : 'missing');
    ck('charged skill written', !!charged, charged ? 'param=' + charged.params[0].raw : 'missing');
    if (charged) {
      ck('charged skill = Teleport#54 lvl8', charged.params[0].raw === (8 | (54 * 64)), 'raw=' + charged.params[0].raw);
      const d = engine.decodeVal(charged.values[0]);
      ck('charged skill charges = 10/20', d[0] === 10 && d[1] === 20, JSON.stringify(d));
    }
  }
  ck('no JS exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
  ws.close();
}
main().catch(e => { console.error('ERR', e.message); process.exitCode = 1; })
  .finally(() => { try { edge.kill(); } catch (e) { } setTimeout(() => process.exit(process.exitCode || 0), 250); });
