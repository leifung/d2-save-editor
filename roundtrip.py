#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Round-trip test: parse -> rewrite every anchor in place -> verify byte-identical;
then apply real edits -> verify reload reads them back, all other anchors unchanged,
EOF exact and checksum valid."""
import sys, os, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core

# Usage: python3 roundtrip.py <path-to-save.d2s>
PATH = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('D2S_SAVE', '')
if not PATH or not os.path.isfile(PATH):
    print('用法: python3 roundtrip.py <存档路径.d2s>')
    print('  或设置环境变量 D2S_SAVE 指向一个 .d2s 存档')
    sys.exit(2)
original = open(PATH, 'rb').read()

# ---- 1. identity round trip: write every anchor's raw back, expect byte-identical ----
res, r = core.parse(original)
buf = bytearray(original)
for f in res['fields']:
    core.set_bits(buf, f['off'], f['bits'], f['raw'])
print('[1] identity rewrite byte-identical:', bytes(buf) == original)

# ---- 2. verify checksum function reproduces original ----
cs = core.checksum_of(original)
print('[2] checksum computed=%08x stored=%08x match=%s'
      % (cs, res['checksum_field'], cs == res['checksum_field']))

# ---- 3. apply real edits ----
buf = bytearray(original)
attrs = {a['id']: a for a in res['attributes']}
edits = {}
edits['strength']  = (attrs[0]['anchor'], 400)
edits['vitality']  = (attrs[3]['anchor'], 500)
edits['maxhp']     = (attrs[7]['anchor'], 8191)
edits['gold']      = (attrs[14]['anchor'], 2500000)
edits['experience']= (attrs[13]['anchor'], 2000000000)
edits['level']     = (attrs[12]['anchor'], 99)
for name, (anchor, val) in edits.items():
    core.apply_edit(buf, anchor, val)
# keep header level byte in sync with gf level
buf[0x2B] = 99

# pick a real equipment property anchor and edit it
target = None
for it in res['items']:
    for p in it['props']:
        if p['name'] == 'strength' and p['value_fields']:
            target = p
            break
    if target:
        break
print('[3] equipment edit target:', target['name'], target['value_fields'][0]['decoded'] if target else None)
if target:
    vf = target['value_fields'][0]
    core.apply_edit(buf, vf, 30)

# also edit an item defense
def_anchor = None
for f in res['fields']:
    if f['kind'] == 'defense':
        def_anchor = f
        break
if def_anchor:
    core.apply_edit(buf, def_anchor, 999)

# ---- 4. fix header (filesize + checksum) ----
core.fix_header(buf)
out = bytes(buf)
print('[4] size unchanged:', len(out) == len(original), len(out))
print('    new checksum field=%08x recomputed=%08x match=%s'
      % (struct.unpack_from('<I', out, 12)[0], core.checksum_of(out),
         struct.unpack_from('<I', out, 12)[0] == core.checksum_of(out)))

# ---- 5. reload and verify ----
res2, r2 = core.parse(out)
print('[5] reload EXACT_EOF=%s  end=%d/%d' % (res2['ok'], res2['end_byte'], len(out)))
a2 = {a['id']: a for a in res2['attributes']}
for name, (anchor, val) in edits.items():
    aid = {'strength':0,'vitality':3,'maxhp':7,'gold':14,'experience':13,'level':12}[name]
    print('    %-11s expected=%-12d actual=%-12d %s'
          % (name, val, a2[aid]['value'], 'OK' if a2[aid]['value'] == val else 'FAIL'))
print('    header level byte =', out[0x2B])

# ---- 6. verify all NON-edited anchors unchanged ----
edited_offsets = set()
for anchor, _ in edits.values():
    edited_offsets.add(anchor['off'])
if target:
    edited_offsets.add(target['value_fields'][0]['off'])
if def_anchor:
    edited_offsets.add(def_anchor['off'])
changed_other = 0
for f1, f2 in zip(res['fields'], res2['fields']):
    if f1['off'] in edited_offsets:
        continue
    if f1['raw'] != f2['raw']:
        changed_other += 1
        if changed_other <= 5:
            print('    UNEXPECTED CHANGE at bit %d kind=%s %s -> %s'
                  % (f1['off'], f1['kind'], f1['raw'], f2['raw']))
print('[6] anchors total=%d, non-edited anchors changed=%d %s'
      % (len(res['fields']), changed_other, 'OK' if changed_other == 0 else 'FAIL'))

# ---- 7. write to disk for optional manual in-game test ----
outpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'roundtrip_out.d2s')
open(outpath, 'wb').write(out)
print('[7] wrote', outpath)
