/* Validate the FINAL single-file HTML: extract its inline scripts, verify JSON
 * data + engine are intact and parse the real save to exact EOF. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '暗黑2存档修改器_1.13c.html'), 'utf8');
let pass = 0, fail = 0;
function ck(n, c, x) { (c ? pass++ : fail++); console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? '  ' + x : '')); }

// split scripts
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1], body: m[2] }));
ck('3 inline scripts found', scripts.length === 3, String(scripts.length));
const dataScript = scripts.find(s => s.attrs.includes('d2s-data'));
ck('data script is application/json', !!dataScript && dataScript.attrs.includes('application/json'));

let DATA;
try { DATA = JSON.parse(dataScript.body); ck('inline JSON parses', true, Object.keys(DATA).length + ' tables'); }
catch (e) { ck('inline JSON parses', false, e.message); }

const engineBody = scripts[1].body;
const uiBody = scripts[2].body;
ck('engine body non-empty', engineBody.length > 5000, engineBody.length + ' chars');
ck('UI body non-empty', uiBody.length > 5000, uiBody.length + ' chars');
ck('no unresolved placeholders', !html.includes('__D2S_') && !html.includes('&lt;/script'));

// syntax-check the UI script (without executing DOM code)
try { new Function(uiBody); ck('UI script syntax valid', true); }
catch (e) { ck('UI script syntax valid', false, e.message); }

// run engine in a sandbox where `module` is undefined -> UMD attaches to root
const sandbox = { console };
sandbox.self = sandbox;
vm.createContext(sandbox);
try {
  vm.runInContext(engineBody, sandbox);
  ck('engine evaluates inlined', typeof sandbox.D2SEngine === 'object');
} catch (e) { ck('engine evaluates inlined', false, e.message); }

if (sandbox.D2SEngine && DATA) {
  const E = sandbox.D2SEngine.makeEngine(DATA);
  const SAVE = 'D:\\3DMGAME_DiabloII.V1.13C.CHS.Green\\Diablo II原始\\Diablo II\\Save\\leiya.d2s';
  const orig = new Uint8Array(fs.readFileSync(SAVE));
  let r;
  try { r = E.parse(orig); ck('inlined engine parses real save', true); }
  catch (e) { ck('inlined engine parses real save', false, e.message); }
  if (r) {
    ck('exact EOF', r.ok === true, r.end_byte + '/' + r.size);
    ck('checksum valid', r.checksum_ok, '0x' + r.checksum_field.toString(16));
    ck('attributes', r.attributes.length === 14);
    const flat = E.flatten(r.items); r.corpses.forEach(c => E.flatten(c, flat)); E.flatten(r.merc_items, flat);
    ck('items', flat.length >= 5, String(flat.length));
    ck('Chinese prop names present', flat.some(it => it.props.some(p => p.cn)), 'e.g. ' +
      (flat.find(it => it.props.some(p => p.cn)) || { props: [{}] }).props.find(p => p.cn).cn);
    ck('display names resolved', flat.some(it => it.display_name && it.display_name !== it.type));
    // simulate editing + save exactly like the UI does
    const byId = {}; r.attributes.forEach(a => byId[a.id] = a);
    const edits = [{ anchor: byId[0].anchor, value: 333 }];
    let eq = null;
    for (const it of flat) for (const p of it.props) if (p.name === 'strength') { eq = p; break; }
    if (eq) edits.push({ anchor: eq.values[0], value: 45 });
    const out = E.applyEdits(orig, edits, 99);
    const r2 = E.parse(out);
    ck('save->reload exact EOF', r2.ok === true);
    ck('UI-like edit readback', byId[0] && (() => { const a2 = {}; r2.attributes.forEach(a => a2[a.id] = a); return a2[0].value === 333; })());
    ck('checksum recomputed', r2.checksum_ok);
  }
}
console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
