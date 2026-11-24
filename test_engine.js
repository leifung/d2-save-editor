/* Node headless test for d2s_engine.js — mirrors python roundtrip.py */
const fs = require('fs');
const path = require('path');
const { makeEngine } = require('./d2s_engine.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'd2s_data.json'), 'utf8'));
const E = makeEngine(DATA);
const SAVE = 'D:\\3DMGAME_DiabloII.V1.13C.CHS.Green\\Diablo II原始\\Diablo II\\Save\\leiya.d2s';
const orig = new Uint8Array(fs.readFileSync(SAVE));

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  (cond ? pass++ : fail++);
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
}

const res = E.parse(orig);
console.log('=== 1. parse ===');
ck('magic aa55aa55', res.magic === 0xaa55aa55, '0x' + res.magic.toString(16));
ck('version 0x60', res.version === 0x60);
ck('name leiya', res.name === 'leiya', res.name);
ck('class resolved', !!res.class_name, res.class_name);
ck('EXACT EOF', res.ok === true, res.end_byte + '/' + res.size);
ck('checksum matches stored', res.checksum_ok, '0x' + res.checksum_field.toString(16) + ' / 0x' + res.checksum_computed.toString(16));
ck('attributes count', res.attributes.length >= 14, String(res.attributes.length));
ck('item count', res.item_count >= 40, String(res.item_count));
const flat = E.flatten(res.items);
res.corpses.forEach(c => E.flatten(c, flat));
E.flatten(res.merc_items, flat);
if (res.golem_item) flat.push(res.golem_item);
let propCount = 0; flat.forEach(it => propCount += it.props.length);
ck('total items (flat)', flat.length >= 40, String(flat.length));
ck('magic props parsed', propCount >= 50, String(propCount));
ck('anchors recorded', res.fields.length >= 50 && res.fields.every(f =>
  Number.isInteger(f.off) && f.off >= 0 && f.bits > 0 && f.bits <= 32), String(res.fields.length));

console.log('=== 2. identity rewrite (byte identical) ===');
// Write each anchor's ORIGINAL raw value directly. This validates setBits()
// without going through decode->encode (HP/mana are 8.8 fixed point, so the
// low byte is a fraction that a decoded integer cannot round-trip exactly).
const ident = new Uint8Array(orig);
res.fields.forEach(f => E.setBits(ident, f.off, f.bits, f.raw));
E.fixHeader(ident);
let same = ident.length === orig.length;
for (let i = 0; i < orig.length && same; i++) if (ident[i] !== orig[i]) same = false;
ck('identity rewrite byte-identical', same);

// Also verify the full decode->encode chain round-trips the DISPLAY value
// (this is what the UI actually does when a user edits a field).
let chainBad = 0;
for (const f of res.fields) {
  let disp;
  if (f.kind === 'propval') disp = E.decodeVal(f);
  else if (f.kind === 'attr') disp = f.raw >> (f.shift || 0);
  else disp = f.raw - (f.sA || 0);
  const raw2 = E.encodeField(f, disp);
  const back = f.kind === 'propval' ? E.decodeVal({ raw: raw2, sA: f.sA, e: f.e }) :
    (f.kind === 'attr' ? (raw2 >> (f.shift || 0)) : (raw2 - (f.sA || 0)));
  const a = f.kind === 'propval' ? JSON.stringify(disp) : disp;
  const b = f.kind === 'propval' ? JSON.stringify(back) : back;
  if (a !== b) chainBad++;
}
ck('UI decode/encode display chain stable', chainBad === 0, chainBad + ' mismatches of ' + res.fields.length);

console.log('=== 3. real edits ===');
const byId = {}; res.attributes.forEach(a => byId[a.id] = a);
const edits = [
  { anchor: byId[0].anchor, value: 400 },
  { anchor: byId[3].anchor, value: 500 },
  { anchor: byId[7].anchor, value: 8191 },
  { anchor: byId[14].anchor, value: 2500000 },
  { anchor: byId[13].anchor, value: 2000000000 },
  { anchor: byId[12].anchor, value: 99 }
];
let target = null, defAnchor = null;
for (const it of flat) {
  for (const p of it.props) if (p.name === 'strength' && p.values.length) { target = p; break; }
  if (target) break;
}
if (target) edits.push({ anchor: target.values[0], value: 30 });
for (const f of res.fields) if (f.kind === 'defense') { defAnchor = f; break; }
if (defAnchor) edits.push({ anchor: defAnchor, value: 999 });
const out = E.applyEdits(orig, edits, 99);
ck('size unchanged', out.length === orig.length, String(out.length));
const cs = (out[12] | (out[13] << 8) | (out[14] << 16) | (out[15] << 24)) >>> 0;
ck('checksum field == recomputed', cs === E.checksum(out), '0x' + cs.toString(16));

const res2 = E.parse(out);
ck('reload EXACT EOF', res2.ok === true, res2.end_byte + '/' + res2.size);
const byId2 = {}; res2.attributes.forEach(a => byId2[a.id] = a);
const expect = { 0: 400, 3: 500, 7: 8191, 14: 2500000, 13: 2000000000, 12: 99 };
for (const k in expect) ck('attr ' + k + ' = ' + expect[k], byId2[k].value === expect[k], 'got ' + byId2[k].value);
ck('header level byte synced', out[0x2b] === 99);

// verify non-edited anchors unchanged
const editedOff = new Set(edits.map(e => e.anchor.off));
let changed = 0;
for (let i = 0; i < res.fields.length; i++) {
  const f1 = res.fields[i], f2 = res2.fields[i];
  if (editedOff.has(f1.off)) continue;
  if (f1.raw !== f2.raw) { changed++; if (changed <= 3) console.log('      changed bit ' + f1.off + ' ' + f1.kind + ' ' + f1.raw + '->' + f2.raw); }
}
ck('non-edited anchors unchanged', changed === 0, changed + ' changed of ' + res.fields.length);

// equipment prop + defense readback
const flat2 = E.flatten(res2.items);
let eqOK = false, defOK = false;
for (const it of flat2) {
  for (const p of it.props) {
    if (p.name === 'strength' && p.values[0] && E.decodeVal(p.values[0])[0] === 30) eqOK = true;
  }
  if (it.defense === 999) defOK = true;
}
ck('equipment prop edit readback', eqOK);
ck('equipment defense edit readback', defOK);

fs.writeFileSync(path.join(__dirname, 'engine_out.d2s'), Buffer.from(out));
console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
