/* Structural "add property / add skill" regression tests.
 * Run: node test_add_props.js [path/to/save.d2s]
 */
const E = require('./d2s_engine.js');
const fs = require('fs');
const cp = require('child_process');
const DATA = JSON.parse(fs.readFileSync('d2s_data.json', 'utf8'));
const engine = E.makeEngine(DATA);

const SAVE = process.argv[2] || process.env.D2S_TEST_SAVE;
if (!SAVE) {
  console.error('用法: node test_add_props.js <path/to/save.d2s>');
  console.error('   或设置环境变量 D2S_TEST_SAVE');
  process.exit(2);
}
const orig = new Uint8Array(fs.readFileSync(SAVE));

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  ' + detail : '')); }
}
function allItems(r) {
  const out = [];
  for (const t of r.toplevel) engine.flatten([t], out);
  return out;
}
function propsOf(item) {
  return item.props.map(p => ({
    id: p.id, name: p.name, group: p.group,
    params: p.params.map(x => x.raw),
    values: p.values.map(x => x.raw - (x.sA || 0))
  }));
}
function findItem(r, pred) { return allItems(r).find(pred); }

console.log('=== save: ' + SAVE + ' (' + orig.length + ' bytes) ===');
const r0 = engine.parse(orig);
ck('baseline parses to exact EOF', r0.ok && r0.checksum_ok, 'end=' + r0.end_byte);

// ---------------------------------------------------------------- 1. identity
console.log('\n--- 1. save() with no additions is identical to applyEdits() ---');
const ident = engine.save(orig, { edits: [], additions: [] });
let same = ident.length === orig.length;
for (let i = 0; i < orig.length && same; i++) if (ident[i] !== orig[i]) same = false;
ck('byte-identical', same);

// ---------------------------------------------------------------- 2. plain stat
console.log('\n--- 2. add a plain stat (+All Skills) ---');
const target0 = allItems(r0).find(i => i.can_add_props && i.depth === 0);
ck('found an editable item', !!target0, target0 && target0.display_name);
const before0 = propsOf(target0);
const out2 = engine.save(orig, {
  additions: [{ item: target0.start_byte, id: 127, values: [5] }]
});
const r2 = engine.parse(out2);
ck('exact EOF after insertion', r2.ok, 'size ' + orig.length + ' -> ' + out2.length);
ck('checksum valid', r2.checksum_ok);
const t2 = findItem(r2, i => i.start_byte === target0.start_byte);
ck('target item still at same byte offset', !!t2);
const after2 = propsOf(t2);
ck('one extra property', after2.length === before0.length + 1,
  before0.length + ' -> ' + after2.length);
ck('new stat id=127 value=5', after2.some(p => p.id === 127 && p.values[0] === 5),
  JSON.stringify(after2.filter(p => p.id === 127)));
// every original property survives untouched
let lost = 0;
for (const p of before0) {
  if (!after2.some(q => q.id === p.id && q.group === p.group &&
    JSON.stringify(q.params) === JSON.stringify(p.params) &&
    JSON.stringify(q.values) === JSON.stringify(p.values))) lost++;
}
ck('all original properties unchanged', lost === 0, 'lost=' + lost);
ck('item count unchanged', allItems(r2).length === allItems(r0).length);
ck('attributes unchanged', JSON.stringify(r2.attributes.map(a => a.value)) ===
  JSON.stringify(r0.attributes.map(a => a.value)));

// ---------------------------------------------------------------- 3. skill encodes
console.log('\n--- 3. skill stat encodings (e=1/2/3, dF=14, np group) ---');
const cases = [
  { id: 127, values: [7], label: '+7 All Skills', check: p => p.values[0] === 7 },
  { id: 107, values: [54, 3], label: '+3 Teleport (single skill)', check: p => p.params[0] === 54 && p.values[0] === 3 },
  { id: 97, values: [64, 12], label: 'non-class skill lvl 12', check: p => p.params[0] === 64 && p.values[0] === 12 },
  { id: 83, values: [1, 4], label: '+4 Sorceress skills', check: p => p.params[0] === 1 && p.values[0] === 4 },
  { id: 188, values: [2, 1, 5], label: '+5 Lightning skill tab', check: p => p.values[0] === 5 },
  { id: 195, values: [10, 56, 25], label: '25% lvl10 skill on attack', check: p => p.values[0] === 25 },
  { id: 204, values: [8, 54, 10, 20], label: 'charged Teleport 10/20', check: p => p.values[0] === (10 | (20 * 256)) },
  { id: 17, values: [300, 350], label: 'ED 300/350 (np=2 group)', check: p => p.id === 17 },
  { id: 39, values: [75], label: '+75 fire resist (sA=50)', check: p => p.values[0] === 75 }
];
for (const c of cases) {
  let out, r, err = null;
  try {
    out = engine.save(orig, { additions: [{ item: target0.start_byte, id: c.id, values: c.values }] });
    r = engine.parse(out);
  } catch (e) { err = e.message; }
  if (err) { ck(c.label, false, err); continue; }
  const t = findItem(r, i => i.start_byte === target0.start_byte);
  const ps = t ? t.props.filter(p => p.id === c.id) : [];
  const view = ps.map(p => ({ id: p.id, params: p.params.map(x => x.raw), values: p.values.map(x => x.raw - (x.sA || 0)) }));
  const ok = r.ok && r.checksum_ok && ps.length > 0 && c.check({ values: view[0].values, params: view[0].params, id: view[0].id });
  ck(c.label, ok, JSON.stringify(view[0]));
}
// np group must have BOTH members written
{
  const out = engine.save(orig, { additions: [{ item: target0.start_byte, id: 17, values: [300, 350] }] });
  const rr = engine.parse(out);
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  const g = t.props.filter(p => p.id >= 17 && p.id <= 18);
  ck('np=2 group wrote both members', g.length === 2 &&
    (g[0].values[0].raw - g[0].values[0].sA) === 300 &&
    (g[1].values[0].raw - g[1].values[0].sA) === 350,
    JSON.stringify(g.map(x => [x.id, x.values[0].raw - x.values[0].sA])));
}
// charged skill sub-values must round-trip through the 8/8 split
{
  const out = engine.save(orig, { additions: [{ item: target0.start_byte, id: 204, values: [8, 54, 10, 20] }] });
  const rr = engine.parse(out);
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  const p = t.props.find(x => x.id === 204);
  const dec = engine.decodeVal(p.values[0]);
  ck('charged skill current/max = 10/20', dec[0] === 10 && dec[1] === 20, JSON.stringify(dec));
  ck('charged skill param = lvl8|skill54', p.params[0].raw === (8 | (54 * 64)),
    'raw=' + p.params[0].raw + ' expected=' + (8 | (54 * 64)));
}
// chance-to-cast param encoding
{
  const out = engine.save(orig, { additions: [{ item: target0.start_byte, id: 195, values: [10, 56, 25] }] });
  const rr = engine.parse(out);
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  const p = t.props.find(x => x.id === 195);
  ck('chance-to-cast param = lvl10|skill56', p.params[0].raw === (10 | (56 * 64)),
    'raw=' + p.params[0].raw + ' expected=' + (10 | (56 * 64)));
}
// skill tab param encoding
{
  const out = engine.save(orig, { additions: [{ item: target0.start_byte, id: 188, values: [2, 1, 5] }] });
  const rr = engine.parse(out);
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  const p = t.props.find(x => x.id === 188);
  ck('skill tab param = tab2|class1<<3', p.params[0].raw === (2 | (1 * 8)),
    'raw=' + p.params[0].raw + ' expected=' + (2 | (1 * 8)));
}

// ---------------------------------------------------------------- 4. ordering
console.log('\n--- 4. stat-id ascending order preserved ---');
{
  const adds = [204, 0, 127, 39, 83].map(id => ({
    item: target0.start_byte, id,
    values: engine.describeAddProp(id).defaults
  }));
  const out = engine.save(orig, { additions: adds });
  const rr = engine.parse(out);
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  const seg = t.prop_segments.find(s => s.group === 'magic');
  const ids = seg.props.map(p => p.id);
  let asc = true;
  for (let i = 1; i < ids.length; i++) if (ids[i] < ids[i - 1]) asc = false;
  ck('magic list is ascending by stat id', asc, JSON.stringify(ids));
  ck('all 5 new stats present', [0, 39, 83, 127, 204].every(id => ids.includes(id)));
  ck('exact EOF + checksum', rr.ok && rr.checksum_ok);
}

// ---------------------------------------------------------------- 5. multi item / nested
console.log('\n--- 5. multiple items, nested sockets, other sections ---');
{
  const items = allItems(r0).filter(i => i.can_add_props);
  const nested = items.find(i => i.socketed_items.length > 0);
  const nestedChild = nested && nested.socketed_items.find(c => c.can_add_props);
  const later = items.filter(i => i.start_byte > target0.start_byte).slice(0, 3);
  const adds = [{ item: target0.start_byte, id: 127, values: [3] }];
  for (const it of later) adds.push({ item: it.start_byte, id: 39, values: [60] });
  if (nestedChild) adds.push({ item: nestedChild.start_byte, id: 0, values: [10] });
  let out, rr, err = null;
  try { out = engine.save(orig, { additions: adds }); rr = engine.parse(out); }
  catch (e) { err = e.message; }
  ck('multi-item rebuild succeeded', !err, err || ('+ ' + (out.length - orig.length) + ' bytes'));
  if (!err) {
    ck('exact EOF + checksum', rr.ok && rr.checksum_ok);
    ck('item count unchanged', allItems(rr).length === allItems(r0).length,
      allItems(r0).length + ' -> ' + allItems(rr).length);
    // Later items shift forward in the file, so match by ordinal position
    // in the flattened item list instead of by byte offset.
    const list0 = allItems(r0), list2 = allItems(rr);
    let found = 0;
    for (const a of adds) {
      const idx = list0.findIndex(i => i.start_byte === a.item);
      if (idx >= 0 && list2[idx] && list2[idx].props.some(p => p.id === a.id)) found++;
    }
    ck('new stats found at their target items', found === adds.length, found + '/' + adds.length);
    ck('flattened item order preserved', list0.length === list2.length &&
      list0.every((i, k) => i.display_name === list2[k].display_name));
    if (nestedChild) {
      const parent2 = allItems(rr).find(i => i.display_name === nested.display_name);
      ck('nested socketed child still parses', parent2 && parent2.socketed_items.length === nested.socketed_items.length,
        parent2 ? String(parent2.socketed_items.length) : 'parent missing');
      const anyChildHasStr = parent2 && parent2.socketed_items.some(c => c.props.some(p => p.id === 0));
      ck('nested child got its new stat', !!anyChildHasStr);
    }
  }
}

// ---------------------------------------------------------------- 6. combined with edits
console.log('\n--- 6. ordinary edits + additions together ---');
{
  const a0 = r0.attributes[0];
  const propEdit = r0.fields.find(f => f.kind === 'propval');
  const edits = [{ anchor: a0.anchor, value: 211 }];
  if (propEdit) edits.push({ anchor: propEdit, value: 7 });
  const out = engine.save(orig, {
    edits, additions: [{ item: target0.start_byte, id: 127, values: [2] }],
    levelSync: null
  });
  const rr = engine.parse(out);
  ck('exact EOF + checksum', rr.ok && rr.checksum_ok);
  ck('attribute edit survived', rr.attributes[0].value === 211, String(rr.attributes[0].value));
  const t = findItem(rr, i => i.start_byte === target0.start_byte);
  ck('new stat present after edits', t.props.some(p => p.id === 127 && p.values[0].raw - p.values[0].sA === 2));
}

// ---------------------------------------------------------------- 7. byte preservation
console.log('\n--- 7. non-target bytes preserved ---');
{
  const out = engine.save(orig, { additions: [{ item: target0.start_byte, id: 204, values: [3, 54, 5, 10] }] });
  const delta = out.length - orig.length;
  // bytes 8..15 are filesize + checksum and MUST change after a length change
  const h0 = Buffer.from(orig.slice(0, target0.start_byte));
  const h1 = Buffer.from(out.slice(0, target0.start_byte));
  h0.fill(0, 8, 16); h1.fill(0, 8, 16);
  ck('bytes before target unchanged (excl. filesize/checksum)', Buffer.compare(h0, h1) === 0);
  const tailSame = Buffer.compare(Buffer.from(out.slice(target0.end_byte + delta)),
    Buffer.from(orig.slice(target0.end_byte))) === 0;
  ck('filesize field updated', (out[8] | (out[9] << 8) | (out[10] << 16) | (out[11] << 24)) >>> 0 === out.length);
  ck('bytes after target unchanged (shifted)', tailSame, 'delta=' + delta);
  ck('file length grew by whole bytes', Number.isInteger(delta) && delta > 0, 'delta=' + delta);
}

// ---------------------------------------------------------------- 8. validation
console.log('\n--- 8. safety guards ---');
{
  const simple = allItems(r0).find(i => !i.can_add_props);
  if (simple) {
    let threw = false;
    try { engine.save(orig, { additions: [{ item: simple.start_byte, id: 127, values: [1] }] }); }
    catch (e) { threw = true; }
    ck('rejects simple/ear items', threw);
  } else ck('rejects simple/ear items', true, '(none in save, skipped)');
  let threw2 = false;
  try { engine.save(orig, { additions: [{ item: 999999, id: 127, values: [1] }] }); }
  catch (e) { threw2 = true; }
  ck('rejects unknown item offset', threw2);
  const norm = engine.normalizeAddValues(127, [99999]);
  ck('clamps out-of-range values', norm[0] === 7, JSON.stringify(norm));
}

// ---------------------------------------------------------------- 9. Python cross-check
console.log('\n--- 9. independent Python parser cross-check ---');
{
  const out = engine.save(orig, { additions: [
    { item: target0.start_byte, id: 127, values: [7] },
    { item: target0.start_byte, id: 107, values: [54, 3] },
    { item: target0.start_byte, id: 204, values: [8, 54, 10, 20] }
  ] });
  const tmp = 'add_props_out.d2s';
  fs.writeFileSync(tmp, Buffer.from(out));
  let pout = '';
  try { pout = cp.execFileSync('python3', ['core.py', tmp], { encoding: 'utf8' }); }
  catch (e) { pout = String(e.stdout || '') + String(e.stderr || ''); }
  ck('core.py: EXACT_EOF', /EXACT_EOF\s*=\s*True/.test(pout), pout.split('\n').filter(l => /EOF|checksum/i.test(l)).slice(0, 2).join(' | '));
  ck('core.py: checksum matches', /checksum[^:]*:?\s*(ok|match|True)/i.test(pout) || /MATCH/i.test(pout),
    pout.split('\n').filter(l => /checksum/i.test(l)).slice(0, 2).join(' | '));
  fs.unlinkSync(tmp);
}

console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
