#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
core.py — Faithful Python port of dschu012/d2s read logic for Diablo II 1.13c (.d2s, version 0x60).

Purposes:
  1. Correctly parse a .d2s to EOF (verified against the real save).
  2. Record a bit-level ANCHOR (absolute bit offset + width + decoding metadata) for every
     editable numeric field, so values can be rewritten IN PLACE without re-serializing the
     whole file (which keeps every unknown byte intact).
  3. Recompute the D2S checksum / filesize after edits.

This is the reference implementation. The single-file HTML tool embeds a direct JS port.

Key corrections vs. earlier attempts (all verified against dschu012 TypeScript source):
  * Rare/Crafted 6x (bit + optional 11 bits) name loop belongs INSIDE the Rare/Crafted branch only.
  * Defense (MP[31]) is Armor-only; max_durability uses MP[73]; current_durability uses MP[72].
  * Corpse section: "JM" + uint16 corpse_count, then per corpse SkipBytes(12) + readItems("JM"+count+items).
  * Constants: use dschu012 v96 magical_properties verbatim (it comes from the FULL 1.13c/1.14
    ItemStatCost.txt incl. Save Param Bits / CSvBits / Signed). Do NOT override with the older
    16-column table found in D2Exp.mpq.
"""
import json, re, struct, sys, os

BASE = os.path.dirname(os.path.abspath(__file__))
CONST_PATH = os.path.join(BASE, 'ref', 'd2s', 'src_data_versions_96_constant_data.ts')


def load_constants(path=CONST_PATH):
    txt = open(path, encoding='utf-8').read()
    m = re.search(r'export let constants =\s*', txt)
    return json.loads(txt[m.end():])


CONST = load_constants()
MP = CONST['magical_properties']          # 359 entries
STACKABLES = CONST['stackables']
ARMOR_ITEMS = CONST['armor_items']
WEAPON_ITEMS = CONST['weapon_items']
OTHER_ITEMS = CONST['other_items']

ITEM_TYPE = {'Armor': 1, 'Shield': 2, 'Weapon': 3, 'Other': 4}
QUALITY = {'Low': 1, 'Normal': 2, 'Superior': 3, 'Magic': 4,
           'Set': 5, 'Rare': 6, 'Unique': 7, 'Crafted': 8}

# Attribute stat ids (the "gf" section) -> human friendly labels
ATTR_LABEL = {
    0: '力量 Strength', 1: '精力 Energy', 2: '敏捷 Dexterity', 3: '体力 Vitality',
    4: '剩余属性点 Stat Pts', 5: '剩余技能点 Skill Pts',
    6: '当前生命 Current HP', 7: '最大生命 Max HP',
    8: '当前法力 Current Mana', 9: '最大法力 Max Mana',
    10: '当前耐力 Current Stamina', 11: '最大耐力 Max Stamina',
    12: '等级 Level', 13: '经验 Experience',
    14: '身上金币 Gold', 15: '仓库金币 Stashed Gold',
}


class Reader:
    """LSB-first bit reader. rb(n) == BitReader.ReadUInt16/32(n) for n<=32."""
    def __init__(self, data):
        self.data = data
        self.bits = []
        for c in data:
            for b in range(8):
                self.bits.append((c >> b) & 1)
        self.off = 0
        self.fields = []       # anchors

    def rb(self, n=1):
        if self.off + n > len(self.bits):
            raise IndexError('bit overrun at bit %d reading %d bits (have %d)'
                             % (self.off, n, len(self.bits)))
        v = 0
        for i in range(n):
            v |= self.bits[self.off + i] << i
        self.off += n
        return v

    def rbytes(self, n):
        return bytes(self.rb(8) for _ in range(n))

    def rstr(self, n):
        return self.rbytes(n).decode('latin-1')

    def skip(self, n):
        self.off += n

    def align(self):
        self.off = (self.off + 7) & ~7

    def seek_byte(self, b):
        self.off = b * 8

    def mark(self, n, **meta):
        """Read n bits and record an anchor describing this field."""
        rec = {'off': self.off, 'bits': n}
        rec.update(meta)
        v = self.rb(n)
        rec['raw'] = v
        self.fields.append(rec)
        return v, rec


def get_item_txt(t):
    for tbl in (ARMOR_ITEMS, WEAPON_ITEMS, OTHER_ITEMS):
        d = tbl.get(t)
        if d:
            return d
    return None


def decode_prop_value(prop, raw):
    """Inverse of the value written by _writeMagicProperties -> decoded display values."""
    sA = prop.get('sA', 0) or 0
    e = prop.get('e', 0) or 0
    v = raw - sA
    if e == 3:  # charges: low byte = current, high byte = max
        return [v & 0xff, (v >> 8) & 0xff]
    return [v]


def encode_prop_value(prop, values):
    """Re-encode display values into the raw integer for the sB-bit field."""
    sA = prop.get('sA', 0) or 0
    e = prop.get('e', 0) or 0
    if e == 3:
        v = (values[0] & 0xff) | ((values[1] & 0xff) << 8)
    else:
        v = values[0]
    return (v + sA) & ((1 << prop['sB']) - 1)


def read_magic_props(r, out_props, group='magic'):
    """Faithful _readMagicProperties, recording anchors for param and value fields."""
    pid = r.rb(9)
    while pid != 0x1ff:
        if pid >= len(MP) or MP[pid] is None:
            raise ValueError('Invalid Stat Id %d at bit %d' % (pid, r.off - 9))
        np = MP[pid].get('np', 1) or 1
        for j in range(np):
            idx = pid + j
            prop = MP[idx]
            if prop is None:
                raise ValueError('Cannot find Magical Property for id %d at bit %d' % (idx, r.off))
            if not prop.get('sB'):
                raise ValueError('Save Bits undefined for stat %d:%s at bit %d'
                                 % (pid, prop.get('s'), r.off))
            p = {'id': idx, 'name': prop.get('s', ''), 'group': group,
                 'dF': prop.get('dF', 0) or 0, 'e': prop.get('e', 0) or 0,
                 'sB': prop['sB'], 'sA': prop.get('sA', 0) or 0,
                 'sP': prop.get('sP', 0) or 0,
                 'param_fields': [], 'value_fields': []}
            sP = p['sP']
            if sP:
                raw, rec = r.mark(sP, kind='param', prop_id=idx, name=p['name'], group=group)
                p['param_fields'].append(rec)
            raw, rec = r.mark(prop['sB'], kind='propval', prop_id=idx, name=p['name'],
                              group=group, sA=p['sA'], e=p['e'], sB=prop['sB'])
            rec['decoded'] = decode_prop_value(prop, raw)
            p['value_fields'].append(rec)
            out_props.append(p)
        pid = r.rb(9)


def read_simple_bits(r, version, item):
    """Faithful _readSimpleBits (version <= 0x60)."""
    r.skip(4)                       # b0_3
    item['identified'] = r.rb(1)
    r.skip(6)                       # b5_10
    item['socketed'] = r.rb(1)
    r.skip(1)                       # b12
    item['new'] = r.rb(1)
    r.skip(2)                       # b14_15
    item['is_ear'] = r.rb(1)
    item['starter_item'] = r.rb(1)
    r.skip(3)                       # b18_20
    item['simple_item'] = r.rb(1)
    item['ethereal'] = r.rb(1)
    r.skip(1)                       # b23
    item['personalized'] = r.rb(1)
    r.skip(1)                       # b25
    item['given_runeword'] = r.rb(1)
    r.skip(5)                       # b27_31
    r.skip(10)                      # item version (10 bits for version<=0x60)
    item['location_id'] = r.rb(3)
    item['equipped_id'] = r.rb(4)
    item['position_x'] = r.rb(4)
    item['position_y'] = r.rb(4)
    item['alt_position_id'] = r.rb(3)
    if item['is_ear']:
        r.skip(3)
        r.skip(7)
        for i in range(15):
            b = r.rb(7)
            if b == 0:
                break
        item['type'] = '(ear)'
        return
    item['type'] = r.rstr(4).replace('\x00', '').strip()
    d = get_item_txt(item['type'])
    cats = d.get('c') if d else None
    item['categories'] = cats or ''
    if cats and 'Any Armor' in cats:
        item['type_id'] = ITEM_TYPE['Armor']
    elif cats and 'Weapon' in cats:
        item['type_id'] = ITEM_TYPE['Weapon']
    else:
        item['type_id'] = ITEM_TYPE['Other']
    bits = 1 if item['simple_item'] else 3
    if cats and 'Quest' in cats:
        r.rb(MP[356]['sB'])         # quest difficulty
        bits = 1
    item['nr_of_items_in_sockets'] = r.rb(bits)


def read_item(r, version=0x60, parent=None):
    """Faithful readItem (version <= 0x60)."""
    if version <= 0x60:
        if r.rstr(2) != 'JM':
            raise ValueError("Item header 'JM' not found at bit %d" % (r.off - 16))
    item = {'props': [], 'socketed_items': [], 'parent': parent}
    item['start_byte'] = (r.off - 16) // 8
    read_simple_bits(r, version, item)
    if not item['simple_item']:
        item['id'] = r.rb(32)
        item['level'], _ = r.mark(7, kind='item_level')
        q = r.rb(4)
        item['quality'] = q
        if r.rb(1):                 # multiple_pictures
            r.rb(3)
        if r.rb(1):                 # class_specific
            r.rb(11)
        if q == QUALITY['Low']:
            r.rb(3)
        elif q == QUALITY['Superior']:
            r.rb(3)
        elif q == QUALITY['Magic']:
            r.rb(11); r.rb(11)
        elif q == QUALITY['Set']:
            r.rb(12)
        elif q == QUALITY['Unique']:
            r.rb(12)
        elif q in (QUALITY['Rare'], QUALITY['Crafted']):
            r.rb(8); r.rb(8)
            # NOTE: this 6x name loop is ONLY for Rare/Crafted (was a bug before)
            for _ in range(6):
                if r.rb(1):
                    r.rb(11)
        if item['given_runeword']:
            r.rb(12); r.rb(4)
        if item['personalized']:
            for _ in range(16):
                if r.rb(7) == 0:
                    break
        if item['type'] in ('tbk', 'ibk'):
            r.rb(5)
        r.rb(1)                     # timestamp
        # Defense / durability — corrected
        if item['type_id'] == ITEM_TYPE['Armor']:
            item['defense'], rec = r.mark(MP[31]['sB'], kind='defense', sA=MP[31].get('sA', 0))
            rec['decoded'] = [item['defense'] - (MP[31].get('sA', 0) or 0)]
        if item['type_id'] in (ITEM_TYPE['Armor'], ITEM_TYPE['Weapon']):
            maxd, rec = r.mark(MP[73]['sB'], kind='maxdur', sA=MP[73].get('sA', 0))
            rec['decoded'] = [maxd - (MP[73].get('sA', 0) or 0)]
            item['max_durability'] = maxd - (MP[73].get('sA', 0) or 0)
            if item['max_durability'] > 0:
                curd, rec2 = r.mark(MP[72]['sB'], kind='curdur', sA=MP[72].get('sA', 0))
                rec2['decoded'] = [curd - (MP[72].get('sA', 0) or 0)]
                item['current_durability'] = curd - (MP[72].get('sA', 0) or 0)
        if item['type'] in STACKABLES:
            item['quantity'], rec = r.mark(9, kind='quantity')
            rec['decoded'] = [item['quantity']]
        if item['socketed'] == 1:
            item['total_nr_of_sockets'], rec = r.mark(4, kind='total_sockets')
            rec['decoded'] = [item['total_nr_of_sockets']]
        plist_flag = 0
        if q == QUALITY['Set']:
            plist_flag = r.rb(5)
        read_magic_props(r, item['props'], 'magic')
        while plist_flag > 0:
            if plist_flag & 1:
                read_magic_props(r, item['props'], 'set')
            plist_flag >>= 1
        if item['given_runeword'] == 1:
            read_magic_props(r, item['props'], 'runeword')
    r.align()
    if item.get('nr_of_items_in_sockets', 0) > 0 and item['simple_item'] == 0:
        for _ in range(item['nr_of_items_in_sockets']):
            item['socketed_items'].append(read_item(r, version, parent=item['type']))
    return item


def read_items(r, version=0x60):
    """Faithful readItems: "JM" + uint16 count + count items."""
    if r.rstr(2) != 'JM':
        raise ValueError("Item list header 'JM' not found at bit %d" % (r.off - 16))
    cnt = int.from_bytes(r.rbytes(2), 'little')
    items = []
    for i in range(cnt):
        items.append(read_item(r, version))
    return items, cnt


def parse(data, do_raise=True):
    """Parse a full .d2s byte string. Returns (result_dict, reader)."""
    r = Reader(data)
    res = {'size': len(data)}
    # ---- header (fixed 765 bytes) ----
    r.seek_byte(0)
    magic = r.rb(32)
    version = r.rb(32)
    res['magic'] = magic
    res['version'] = version
    res['filesize_field'] = struct.unpack_from('<I', data, 8)[0]
    res['checksum_field'] = struct.unpack_from('<I', data, 12)[0]
    res['name'] = data[0x14:0x24].split(b'\x00')[0].decode('latin-1')
    res['status'] = data[0x24]
    res['expansion'] = bool(data[0x24] & 0x20)
    res['class_id'] = data[0x28]
    res['level_byte'] = data[0x2B]
    r.seek_byte(765)
    # ---- attributes "gf" ----
    if r.rstr(2) != 'gf':
        raise ValueError("Attribute header 'gf' not found at byte 765")
    attrs = []
    pid = r.rb(9)
    while pid != 0x1ff:
        if pid >= len(MP) or MP[pid] is None:
            raise ValueError('Invalid attribute id %d at bit %d' % (pid, r.off - 9))
        f = MP[pid]
        cB = f['cB']
        raw, rec = r.mark(cB, kind='attr', id=pid, key=ATTR_LABEL.get(pid, f.get('s', '')),
                          label=ATTR_LABEL.get(pid, f.get('s', str(pid))),
                          shift=8 if 6 <= pid <= 11 else 0)
        rec['decoded'] = [raw >> 8] if 6 <= pid <= 11 else [raw]
        attrs.append({'id': pid, 'label': ATTR_LABEL.get(pid, f.get('s', str(pid))),
                      'raw': raw, 'value': rec['decoded'][0], 'cB': cB, 'anchor': rec})
        pid = r.rb(9)
    r.align()
    res['attributes'] = attrs
    # ---- skills "if" ----
    if r.rstr(2) != 'if':
        raise ValueError("Skills header 'if' not found at bit %d" % (r.off - 16))
    r.rbytes(30)
    # ---- character items ----
    res['items'], res['item_count'] = read_items(r, version)
    # ---- corpse items ----
    if r.rstr(2) != 'JM':
        raise ValueError("Corpse header 'JM' not found at bit %d" % (r.off - 16))
    corpse_count = int.from_bytes(r.rbytes(2), 'little')
    res['corpse_count'] = corpse_count
    res['corpses'] = []
    for _ in range(corpse_count):
        r.rbytes(12)
        its, _ = read_items(r, version)
        res['corpses'].append(its)
    # ---- mercenary + golem (expansion only) ----
    if res['expansion']:
        if r.rstr(2) != 'jf':
            raise ValueError("Merc header 'jf' not found at bit %d" % (r.off - 16))
        merc_id = int.from_bytes(data[0xB3:0xB7], 'little')
        res['merc_id'] = merc_id
        if merc_id != 0:
            res['merc_items'], _ = read_items(r, version)
        else:
            res['merc_items'] = []
        if r.rstr(2) != 'kf':
            raise ValueError("Golem header 'kf' not found at bit %d" % (r.off - 16))
        has_golem = r.rb(8)
        if has_golem == 1:
            res['golem_item'] = read_item(r, version)
    r.align()
    res['end_byte'] = r.off // 8
    res['fields'] = r.fields
    res['ok'] = (res['end_byte'] == len(data))
    return res, r


def set_bits(buf, bit_off, n, value):
    """Write n LSB-first bits of `value` into bytearray buf at absolute bit offset bit_off."""
    for i in range(n):
        byte_i, bit_i = divmod(bit_off + i, 8)
        b = (value >> i) & 1
        if b:
            buf[byte_i] |= (1 << bit_i)
        else:
            buf[byte_i] &= ~(1 << bit_i) & 0xff


def apply_edit(buf, anchor, new_value):
    """Write a decoded display value back into its bit field."""
    kind = anchor['kind']
    if kind == 'attr':
        shift = anchor.get('shift', 0)
        raw = (int(new_value) << shift) & ((1 << anchor['bits']) - 1)
    elif kind == 'propval':
        # new_value may be a scalar or a list (charges)
        vals = new_value if isinstance(new_value, (list, tuple)) else [new_value]
        p = {'sA': anchor.get('sA', 0), 'e': anchor.get('e', 0), 'sB': anchor['bits']}
        raw = encode_prop_value(p, vals)
    else:
        # defense/maxdur/curdur carry an sA bias; quantity/sockets/level do not
        bias = anchor.get('sA', 0) or 0
        raw = (int(new_value) + bias) & ((1 << anchor['bits']) - 1)
    set_bits(buf, anchor['off'], anchor['bits'], raw)
    return raw


def fix_header(buf):
    """Recompute filesize + checksum exactly like dschu012 fixHeader()."""
    eof = len(buf)
    struct.pack_into('<I', buf, 0x08, eof)
    struct.pack_into('<I', buf, 0x0C, 0)
    c = 0
    for i in range(eof):
        byte = buf[i]
        if c & 0x80000000:
            byte += 1
        c = (byte + c * 2) & 0xFFFFFFFF
    struct.pack_into('<I', buf, 0x0C, c)
    return c


def checksum_of(data):
    b = bytearray(data)
    struct.pack_into('<I', b, 0x0C, 0)
    c = 0
    for i in range(len(b)):
        byte = b[i]
        if c & 0x80000000:
            byte += 1
        c = (byte + c * 2) & 0xFFFFFFFF
    return c


def _iter_items(items):
    for it in items:
        yield it
        for s in it.get('socketed_items', []):
            yield from _iter_items([s])


def diagnostic(data, verbose=True):
    res, r = parse(data)
    print("magic=%08x version=%s size=%d name=%r class=%d level=%d expansion=%s"
          % (res['magic'], hex(res['version']), res['size'], res['name'],
             res['class_id'], res['level_byte'], res['expansion']))
    print("checksum field = %08x   computed = %08x   MATCH=%s"
          % (res['checksum_field'], checksum_of(data),
             res['checksum_field'] == checksum_of(data)))
    print("filesize field = %d" % res['filesize_field'])
    print("PARSE end_byte=%d / total=%d  EXACT_EOF=%s" % (res['end_byte'], res['size'], res['ok']))
    print("\n--- 人物属性 (gf section) ---")
    for a in res['attributes']:
        print("  id=%2d %-22s value=%-12d cB=%2d bit_off=%d"
              % (a['id'], a['label'], a['value'], a['cB'], a['anchor']['off']))
    all_items = list(_iter_items(res['items']))
    for ci, corpse in enumerate(res['corpses']):
        all_items += list(_iter_items(corpse))
    all_items += list(_iter_items(res.get('merc_items', [])))
    if res.get('golem_item'):
        all_items += [res['golem_item']]
    print("\n--- 装备 items=%d (incl. nested), corpse_count=%d, merc_items=%d ---"
          % (len(all_items), res['corpse_count'], len(res.get('merc_items', []))))
    seen_props = {}
    for it in all_items:
        props = it['props']
        pstr = ', '.join('%s=%s' % (p['name'], p['value_fields'][0]['decoded']) for p in props[:6])
        if len(props) > 6:
            pstr += ' ...'
        print("  type=%-5s q=%d simple=%d lvl=%-3s def=%-4s dur=%-4s props=%d [%s]"
              % (it.get('type', '?'), it.get('quality', 0), it.get('simple_item', 1),
                 it.get('level', '-'), it.get('defense', '-'),
                 it.get('max_durability', '-'), len(props), pstr))
        for p in props:
            seen_props.setdefault(p['id'], p['name'])
    print("\n--- 出现的魔法属性 id 汇总 (%d 种) ---" % len(seen_props))
    print('  ' + ', '.join('%d:%s' % (k, v) for k, v in sorted(seen_props.items())))
    print("\nanchors total = %d" % len(res['fields']))
    return res


if __name__ == '__main__':
    # Usage: python3 core.py <path-to-save.d2s>
    path = sys.argv[1] if len(sys.argv) > 1 else ''
    if not path or not os.path.isfile(path):
        print('用法: python3 core.py <存档路径.d2s>')
        sys.exit(2)
    data = open(path, 'rb').read()
    try:
        diagnostic(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('FAILED:', e)
