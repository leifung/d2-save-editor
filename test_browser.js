/* Real-browser E2E test via Chrome DevTools Protocol (Edge headless).
 * No external deps: uses Node 22 global WebSocket. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.join(__dirname, '暗黑2存档修改器_1.13c.html');
const SAVE = 'D:\\3DMGAME_DiabloII.V1.13C.CHS.Green\\Diablo II原始\\Diablo II\\Save\\leiya.d2s';
const PORT = 9333;
const UDD = path.join(os.tmpdir(), 'd2s_edge_test_' + Date.now());

let pass = 0, fail = 0;
function ck(n, c, x) { (c ? pass++ : fail++); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? '  ' + x : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + UDD,
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

async function main() {
  // wait for CDP
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  };
  function send(method, params) {
    return new Promise(resolve => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }
  async function evalJS(expr, awaitPromise) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  }

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  const fileUrl = 'file:///' + HTML.replace(/\\/g, '/');
  await send('Page.navigate', { url: fileUrl });
  await sleep(1200);
  ck('HTML page loaded', await evalJS('document.title') === '暗黑破坏神 II 存档修改器 · 1.13c');
  ck('engine + data inlined & ready', await evalJS('typeof D2SEngine') === 'object' && await evalJS("JSON.parse(document.getElementById('d2s-data').textContent).mp.length") === 359);

  // --- simulate choosing the .d2s file via CDP DOM.setFileInputFiles ---
  const doc = (await send('DOM.getDocument', { depth: 1 })).result.root;
  const q = (await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#file' })).result;
  ck('file input found', !!q.nodeId);
  await send('DOM.setFileInputFiles', { files: [SAVE], nodeId: q.nodeId });
  await evalJS("document.getElementById('file').dispatchEvent(new Event('change',{bubbles:true}))");
  await sleep(900);

  ck('app panel shown after load', await evalJS("document.getElementById('app').style.display") !== 'none');
  ck('bottom bar shown', await evalJS("document.getElementById('bar').style.display") !== 'none');
  const infoTxt = await evalJS("document.getElementById('info').innerText");
  ck('character info rendered', /leiya/.test(infoTxt || '') && /Amazon/.test(infoTxt || ''), (infoTxt || '').replace(/\n/g, ' | ').slice(0, 110));
  ck('EOF + checksum chips OK', /精确对齐 EOF/.test(infoTxt || '') && /校验和 有效/.test(infoTxt || ''));
  ck('14 attribute cards rendered', await evalJS("document.querySelectorAll('#attr-grid .attr').length") === 14,
    String(await evalJS("document.querySelectorAll('#attr-grid .attr').length")));
  ck('attribute value filled', await evalJS("document.querySelector('#attr-grid .attr input.num').value") === '110',
    String(await evalJS("document.querySelector('#attr-grid .attr input.num').value")));

  // --- edit a character attribute through the real UI ---
  await evalJS("(function(){var i=document.querySelector('#attr-grid .attr input.num');i.value='321';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()");
  ck('edit counter increments', await evalJS("document.getElementById('edit-count').textContent") === '1',
    String(await evalJS("document.getElementById('edit-count').textContent")));
  ck('edited card highlighted', await evalJS("document.querySelectorAll('#attr-grid .attr.changed').length") === 1);
  ck('edited value shown', await evalJS("document.querySelector('#attr-grid .attr input.num').value") === '321');

  // --- preset button ---
  await evalJS("document.querySelector('[data-preset=lvl99]').click()");
  ck('preset applied (2 edits)', Number(await evalJS("document.getElementById('edit-count').textContent")) >= 2,
    String(await evalJS("document.getElementById('edit-count').textContent")));

  // --- switch to equipment tab ---
  await evalJS("document.querySelector('.tab[data-tab=equip]').click()");
  await sleep(150);
  const eqCount = await evalJS("document.querySelectorAll('#eq-scroll .eq-item').length");
  ck('equipment list rendered', eqCount >= 5, String(eqCount));
  const firstItem = await evalJS("document.querySelector('#eq-scroll .eq-item .eq-nm').textContent");
  ck('item display name resolved', !!firstItem && firstItem.length > 1, firstItem);

  // --- open an item with properties ---
  await evalJS("(function(){var els=document.querySelectorAll('#eq-scroll .eq-item');for(var i=0;i<els.length;i++){if(/条/.test(els[i].querySelector('.eq-badge').textContent)){els[i].click();return}}})()");
  await sleep(150);
  ck('equipment detail rendered with prop table', await evalJS("document.querySelectorAll('#eq-detail table.props').length") >= 1,
    String(await evalJS("document.querySelectorAll('#eq-detail table.props').length")));
  ck('Chinese prop names in detail', /[\u4e00-\u9fa5]/.test(await evalJS("(document.querySelector('#eq-detail .pname')||{}).textContent||''")));
  ck('prop inputs present', await evalJS("document.querySelectorAll('#eq-detail .pedit input.num').length") >= 1,
    String(await evalJS("document.querySelectorAll('#eq-detail .pedit input.num').length")));

  // --- edit a magic property value ---
  const before = await evalJS("document.getElementById('edit-count').textContent");
  await evalJS("(function(){var i=document.querySelector('#eq-detail .pedit input.num');i.value='42';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()");
  const after = await evalJS("document.getElementById('edit-count').textContent");
  ck('magic prop edit registered', Number(after) === Number(before) + 1, before + ' -> ' + after);

  // --- search filter ---
  await evalJS("(function(){var q=document.getElementById('q');q.value='zzzznotexist';q.dispatchEvent(new Event('input',{bubbles:true}));})()");
  ck('search filter works', await evalJS("document.querySelectorAll('#eq-scroll .eq-item').length") === 0);
  await evalJS("(function(){var q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));})()");

  // --- help tab ---
  await evalJS("document.querySelector('.tab[data-tab=help]').click()");
  const helpTxt = await evalJS("document.getElementById('page-help').innerText") || '';
  ck('help tab visible & content shown', /使用步骤/.test(helpTxt) && /备份/.test(helpTxt) && await evalJS("document.getElementById('page-help').classList.contains('on')"), helpTxt.slice(0, 60).replace(/\n/g, ' | '));

  // --- save (download) ---
  await evalJS("document.getElementById('save').click()");
  await sleep(400);
  const toastTxt = await evalJS("document.getElementById('toast').textContent");
  ck('save produced success toast (no exception)', /已保存/.test(toastTxt || ''), toastTxt);

  ck('no JS runtime exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));

  ws.close();
  console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
}

main().catch(e => { console.error('TEST ERROR:', e.message); fail++; console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ==='); })
  .finally(() => {
    try { edge.kill(); } catch (e) {}
    setTimeout(() => process.exit(fail ? 1 : 0), 200);
  });
