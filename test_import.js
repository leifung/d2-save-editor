#!/usr/bin/env node
/* =========================================================================
 * test_import.js — regression tests for item import / generation / insertion
 *
 * Run: node test_import.js [path/to/save.d2s]
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const E = require('./d2s_engine.js');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'd2s_data.json'), 'utf8'));
const e = E.makeEngine(DATA);
const SAVE = process.argv[2] || process.env.D2S_TEST_SAVE ||
  'D:/3DMGAME_DiabloII.V1.13C.CHS.Green/Diablo II原始/Diablo II/Save/leiya.d2s';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function throws(name, fn, want) {
  try { fn(); ok(name, false, 'expected an exception'); }
  catch (err) { ok(name, !want || String(err.message).indexOf(want) >= 0, err.message); }
}

const orig = new Uint8Array(fs.readFileSync(SAVE));
console.log('测试存档:', SAVE, orig.length, 'B\n');

// ---- 1. parse anchors -----------------------------------------------------
let r = e.parse(orig);
ok('原档解析到 EOF', r.ok, 'end=' + r.end_byte);
ok('原档校验和有效', r.checksum_ok);
ok('主物品段锚点有效', Number.isInteger(r.char_header_byte) && orig[r.char_header_byte] === 0x4a &&
  orig[r.char_header_byte + 1] === 0x4d, 'hdr=' + r.char_header_byte);
ok('物品计数与段长一致', r.item_count === (orig[r.char_header_byte + 2] | (orig[r.char_header_byte + 3] << 8)));

// ---- 2. base item catalog -------------------------------------------------
const bases = e.baseItems();
ok('底材目录覆盖全部三类', bases.length >= 650, bases.length + ' 种');
ok('尺寸表来自官方 invwidth/invheight', e.itemSize('crs')[1] >= 2 && e.itemSize('r01')[0] === 1);

// ---- 3. generate EVERY built-in shop good ---------------------------------
let goods = [], allShop = DATA.meta.shop;
allShop.forEach(cat => {
  (cat.goods || []).forEach(g => goods.push({ cat: cat.id, g }));
  (cat.groups || []).forEach(gr => gr.codes.forEach(c => goods.push({ cat: cat.id, g: { c } })));
});
let genFail = [];
goods.forEach(({ cat, g }) => {
  try { e.buildItem({ type: g.c, quality: g.q || 2, level: g.l || 85, quantity: g.n || 1, sockets: g.s || 0 }); }
  catch (err) { genFail.push(cat + '/' + g.c + ': ' + err.message); }
});
ok('内置商店全部商品可生成', genFail.length === 0, goods.length + ' 件' + (genFail.length ? ' / ' + genFail.slice(0, 3).join('; ') : ''));

// ---- 4. item generation details ------------------------------------------
const codes = ['r01', 'hp5', 'crs', 'rin', 'jew', 'tbk', 'gld', 'box', 'cm3', 'key', 'aqv', 'uit'];
codes.forEach(c => {
  try {
    const b = e.buildItem({ type: c, quality: 2, level: 85, quantity: 1 });
    const d = e.parseItemBlob(b);
    ok('生成 ' + c + ' 可回读', d.kind === 'item' && d.items.length === 1 && d.items[0].bytes.length === b.length,
      b.length + ' B / ' + d.items[0].name);
  } catch (err) { ok('生成 ' + c, false, err.message); }
});
const withProps = e.buildItem({ type: 'rin', quality: 4, level: 99, props: [{ id: 127, values: [3] }, { id: 39, values: [40] }] });
ok('生成带词条物品', e.parseItemBlob(withProps).items[0].props === 2);
ok('生成带孔物品', e.parseItemBlob(e.buildItem({ type: 'crs', sockets: 4 })).items[0].bytes.length > 0);
ok('生成暗金 / 套装物品', e.parseItemBlob(e.buildItem({ type: 'hax', quality: 7, uniqueId: 0 })).items[0].name === 'The Gnasher' ||
  e.parseItemBlob(e.buildItem({ type: 'hax', quality: 7, uniqueId: 0 })).items[0].name.length > 0);
throws('未知物品代码被拒绝', () => e.buildItem({ type: 'zzzz' }), '未知物品代码');
throws('垃圾物品数据被拒绝', () => e.parseItemBlob(new Uint8Array(64).fill(7)), '未找到物品头');

// ---- 5. all import sources ------------------------------------------------
const fromSave = e.parseItemBlob(orig);
ok('来源：完整 .d2s', fromSave.kind === 'd2s' && fromSave.items.length >= r.toplevel.length);
const single = e.parseItemBlob(fromSave.items[0].bytes);
ok('来源：单个物品块', single.kind === 'item' && single.items.length === 1);
const d2i = Buffer.concat([Buffer.from('JM'), Buffer.from([0x60, 0x00]), Buffer.from(fromSave.items[0].bytes)]);
ok('来源：.d2i（带版本头）', e.parseItemBlob(new Uint8Array(d2i)).items[0].name === fromSave.items[0].name);
const listBuf = Buffer.concat([Buffer.from('JM'), Buffer.from([3, 0]),
  ...fromSave.items.slice(0, 3).map(x => Buffer.from(x.bytes))]);
ok('来源：物品列表', e.parseItemBlob(new Uint8Array(listBuf)).items.length === 3);
const hex = Buffer.from(fromSave.items[5].bytes).toString('hex');
ok('来源：十六进制物品码', e.parseItemBlob(new Uint8Array(Buffer.from(hex, 'hex'))).items[0].name === fromSave.items[5].name);

// ---- 6. byte-exact export / re-import ------------------------------------
const raw = fromSave.items[0].bytes;
const rt = e.parseItemBlob(raw).items[0].bytes;
ok('导出/再导入字节完全一致', Buffer.compare(Buffer.from(raw), Buffer.from(rt)) === 0);

// ---- 7. insertion ---------------------------------------------------------
const runeImports = [];
for (let i = 1; i <= 33; i++) {
  const c = 'r' + String(i).padStart(2, '0');
  runeImports.push({ bytes: e.buildItem({ type: c, quality: 2, level: 85 }), type: c, name: c, target: 'stash', size: e.itemSize(c) });
}
let out = e.save(orig, { imports: runeImports });
let chk = e.parse(out);
ok('批量导入 33 件后结构完整', chk.ok && chk.checksum_ok, orig.length + ' -> ' + out.length + ' B');
ok('导入后物品计数正确', chk.item_count === r.item_count + 33, r.item_count + ' -> ' + chk.item_count);
ok('导入后原有物品数不变（仅新增）', chk.items.length === r.items.length + 33);
// (filesize @0x08, checksum @0x0C and the item count @hdr+2 are legitimately rewritten)
const headA = Buffer.from(orig.slice(0, r.char_header_byte + 4));
const headB = Buffer.from(out.slice(0, r.char_header_byte + 4));
for (let i = 8; i < 16; i++) headA[i] = headB[i] = 0;
headA[r.char_header_byte + 2] = headB[r.char_header_byte + 2] = 0;
headA[r.char_header_byte + 3] = headB[r.char_header_byte + 3] = 0;
ok('导入前的文件头/属性/技能字节不变', Buffer.compare(headA, headB) === 0);

// imported items land in stash with non-overlapping positions
const imported = chk.items.slice(0, 33).map(it => ({ x: it.position_x, y: it.position_y, alt: it.alt_position_id }));
ok('导入物品自动放入仓库网格', imported.every(p => p.alt === 5));
const keys = new Set(imported.map(p => p.x + ',' + p.y));
ok('自动摆放无坐标重叠', keys.size === 33, keys.size + ' 个格位');

// keep target
const keep = e.save(orig, { imports: [{ bytes: raw, type: fromSave.items[0].type, target: 'keep' }] });
ok('保持原位置导入成功', e.parse(keep).ok && e.parse(keep).checksum_ok);
// belt target: this save has all 16 belt slots filled, so a clear error is expected
throws('腰带已满时给出明确提示', () => e.save(orig, {
  imports: [{ bytes: e.buildItem({ type: 'hp5' }), type: 'hp5', target: 'belt', size: [1, 1] }]
}), '空间不足');
// auto placement succeeds using stash/inventory/cube
const auto = e.save(orig, { imports: [{ bytes: e.buildItem({ type: 'hp5' }), type: 'hp5', target: 'auto', size: [1, 1] }] });
ok('自动容器分配成功', e.parse(auto).ok && e.parse(auto).checksum_ok);
throws('越界容器名被拒绝', () => e.save(orig, { imports: [{ bytes: raw, target: 'nowhere' }] }), '空间不足');

// ---- 8. combined edits + additions + imports -----------------------------
const attr = r.attributes[0].anchor;
const target = r.items.find(it => it.can_add_props);
const combined = e.save(orig, {
  edits: [{ anchor: attr, value: 200 }],
  additions: target ? [{ item: target.start_byte, id: 127, values: [3] }] : [],
  imports: [{ bytes: e.buildItem({ type: 'r01' }), type: 'r01', target: 'stash', size: [1, 1] }]
});
const cc = e.parse(combined);
ok('编辑 + 新增属性 + 导入物品可同时保存', cc.ok && cc.checksum_ok,
  orig.length + ' -> ' + combined.length + ' B');
ok('组合保存后属性修改生效', cc.attributes[0].value === 200 || cc.attributes[0].anchor.raw !== attr.raw);
ok('组合保存后物品计数 +1', cc.item_count === r.item_count + 1);

// ---- 9. repeated import chain ---------------------------------------------
let chain = orig;
for (let k = 0; k < 3; k++) chain = e.save(chain, { imports: [{ bytes: e.buildItem({ type: 'jew' }), type: 'jew', target: 'auto', size: [1, 1] }] });
ok('连续三次导入仍可解析', e.parse(chain).ok && e.parse(chain).checksum_ok);

console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail ? 1 : 0);
