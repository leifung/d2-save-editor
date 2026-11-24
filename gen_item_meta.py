#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_item_meta.py — build item_meta.json from the CHS 1.13c game data tables.

Sources (extracted from Patch_D2.mpq by extract_mpq.py):
    data/global/excel/armor.txt / weapons.txt / misc.txt   -> invwidth/invheight,
        durability, level, cost, NPC vendor Min/Max columns
    data/global/excel/uniqueitems.txt / setitems.txt        -> base item code by name

Produces:
    size       code -> [invwidth, invheight]      (auto-placement of imported items)
    dur        code -> default durability
    lvl        code -> base item level
    cost       code -> base price
    uniq_base  unique_id -> base code  (matched by official English name)
    set_base   set_id    -> base code
    vendors    [{id, cn, codes:[...]}]           (what each NPC normally stocks)
    shop       [{id, cn, desc, goods:[...]}]     (built-in shop catalog)
"""
import csv, json, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(BASE, 'ref', 'd2s')


def rows(name):
    with open(os.path.join(PROBE, '_probe_' + name + '.txt'), encoding='latin-1') as f:
        return list(csv.reader(f, delimiter='\t'))


def num(v, default=0):
    try:
        return int(str(v).strip())
    except (ValueError, AttributeError):
        return default


def col(hdr, name):
    return hdr.index(name) if name in hdr else None


DATA = json.load(open(os.path.join(BASE, 'd2s_data.json'), encoding='utf-8'))
CN = DATA.get('cn', {}).get('item', {})

size, dur, lvl, cost = {}, {}, {}, {}
vendor_raw = {}

# NPC vendor columns in the three item tables. Max>0 means the NPC can stock it.
VENDORS = [
    ('akara',   '阿卡拉 · ACT1 药水/法杖/卷轴', 'AkaraMax'),
    ('charsi',  '恰西 · ACT1 武器/防具',       'CharsiMax'),
    ('gheed',   '基德 · ACT1 杂货/赌博',       'GheedMax'),
    ('fara',    '法拉 · ACT2 武器/防具',       'FaraMax'),
    ('drognan', '卓格南 · ACT2 法杖/卷轴',     'DrognanMax'),
    ('elzix',   '艾利克斯 · ACT2 杂货',        'ElzixMax'),
    ('ormus',   '奥玛斯 · ACT3 法术/药水',     'OrmusMax'),
    ('asheara', '艾席拉 · ACT3 武器/防具',     'AshearaMax'),
    ('hratli',  '赫拉铁力 · ACT3 杂货',        'HraltiMax'),
    ('halbu',   '哈尔布 · ACT4 武器/防具',     'HalbuMax'),
    ('jamella', '贾梅拉 · ACT4 杂货/药水',     'JamellaMax'),
    ('larzuk',  '拉苏克 · ACT5 武器/防具',     'LarzukMax'),
    ('malah',   '马拉 · ACT5 药水/卷轴',       'MalahMax'),
    ('anya',    '安雅 · ACT5 杂货',            'DrehyaMax'),
]
for vid, _, _ in VENDORS:
    vendor_raw[vid] = []

for tbl in ('armor', 'weapons', 'misc'):
    r = rows(tbl)
    h = r[0]
    ci = {k: col(h, k) for k in ('code', 'invwidth', 'invheight', 'durability',
                                  'level', 'cost', 'name')}
    vi = {vid: col(h, cname) for vid, _, cname in VENDORS}
    for row in r[1:]:
        if ci['code'] is None or ci['code'] >= len(row):
            continue
        code = (row[ci['code']] or '').strip()
        if not code or len(code) > 4:
            continue
        w = num(row[ci['invwidth']], 1) if ci['invwidth'] is not None and ci['invwidth'] < len(row) else 1
        ht = num(row[ci['invheight']], 1) if ci['invheight'] is not None and ci['invheight'] < len(row) else 1
        size[code] = [max(1, min(10, w)), max(1, min(10, ht))]
        d = num(row[ci['durability']], 0) if ci['durability'] is not None and ci['durability'] < len(row) else 0
        if d > 0:
            dur[code] = min(255, d)
        lv = num(row[ci['level']], 1) if ci['level'] is not None and ci['level'] < len(row) else 1
        lvl[code] = max(1, min(99, lv))
        c = num(row[ci['cost']], 0) if ci['cost'] is not None and ci['cost'] < len(row) else 0
        cost[code] = c
        for vid, _, _ in VENDORS:
            k = vi[vid]
            if k is not None and k < len(row) and num(row[k], 0) > 0:
                vendor_raw[vid].append(code)

# ---- unique / set base item codes, matched by official English name ----
uniq_by_name, set_by_name = {}, {}
for row in rows('uniqueitems')[1:]:
    if len(row) > 8 and row[0].strip() and row[8].strip():
        uniq_by_name.setdefault(row[0].strip(), row[8].strip())
for row in rows('setitems')[1:]:
    if len(row) > 2 and row[0].strip() and row[2].strip():
        set_by_name.setdefault(row[0].strip(), row[2].strip())

uniq_base, set_base = {}, {}
for uid, nm in enumerate(DATA['unq_items']):
    if nm and nm in uniq_by_name:
        uniq_base[uid] = uniq_by_name[nm]
for sid, nm in enumerate(DATA['set_items']):
    if nm and nm in set_by_name:
        set_base[sid] = set_by_name[nm]

# ---- helpers to build catalog goods ----
ALL_ITEMS = {}
for t in ('armor', 'weapon', 'other'):
    ALL_ITEMS.update(DATA[t])


def cats(code):
    d = ALL_ITEMS.get(code) or {}
    return d.get('c') or []


def has(code, *names):
    c = cats(code)
    return any(n in c for n in names)


def g(code, **kw):
    """A shop good: c=code q=quality n=quantity t=target s=sockets l=level."""
    o = {'c': code}
    for k, v in kw.items():
        if v is not None and v != 0 and v != '':
            o[k] = v
    return o


def codes_by_cat(*names):
    return sorted(k for k, v in ALL_ITEMS.items() if any(n in (v.get('c') or []) for n in names))


def codes_by_name(*needles):
    out = []
    for k, v in ALL_ITEMS.items():
        nm = (v.get('n') or '').lower()
        if any(x.lower() in nm for x in needles):
            out.append(k)
    return sorted(set(out))


# ---- built-in shop catalog ----
shop = []

runes = [g('r%02d' % i, n=1) for i in range(1, 34) if 'r%02d' % i in ALL_ITEMS]
shop.append({'id': 'runes', 'cn': '符文 · El ~ Zod', 'desc': '全部 33 枚符文，各 1 枚',
             'goods': runes, 't': 'stash'})

gems = codes_by_cat('Gem') + [k for k in ALL_ITEMS if k.startswith('sk') and len(k) == 3]
gems = sorted(set(gems))
shop.append({'id': 'gems', 'cn': '宝石与骷髅', 'desc': '各色碎裂 / 完美宝石与骷髅，共 %d 种' % len(gems),
             'goods': [g(c, n=1) for c in gems], 't': 'stash'})

potions = codes_by_cat('Healing Potion', 'Mana Potion', 'Rejuvenation Potion',
                       'Antidote Potion', 'Stamina Potion', 'Thawing Potion', 'Elixir')
shop.append({'id': 'potions', 'cn': '药水与药剂', 'desc': '治疗 / 法力 / 全面回复 / 解毒 / 体力 / 融解药剂',
             'goods': [g(c, n=1) for c in potions], 't': 'inventory'})

books = [c for c in ALL_ITEMS if c in ('tbk', 'ibk', 'key', 'tsc', 'isc', 'box', 'gld')]
shop.append({'id': 'consumables', 'cn': '卷轴 · 书 · 钥匙 · 金币', 'desc': '回城/鉴定书、传送/鉴定卷轴、钥匙、金币堆',
             'goods': [g(c, n=(20 if c in ('tbk', 'ibk', 'tsc', 'isc', 'key') else (50000 if c == 'gld' else 1)))
                       for c in books], 't': 'inventory'})

ammo = [c for c in ALL_ITEMS if has(c, 'Bow Ammo', 'Crossbow Ammo') or c in ('aqv', 'cqv', 'jav', 'pil', 'ssp')]
ammo = sorted(set(ammo))
shop.append({'id': 'ammo', 'cn': '箭矢 · 弩矢 · 投掷武器', 'desc': '箭矢 / 弩矢 / 标枪类，数量 150',
             'goods': [g(c, n=150) for c in ammo], 't': 'inventory'})

trinkets = [c for c in ALL_ITEMS if c in ('jew', 'cm1', 'cm2', 'cm3', 'rin', 'amu')]
shop.append({'id': 'trinkets', 'cn': '珠宝 · 护身符 · 戒指 · 项链', 'desc': '可用于镶嵌 / 洗练 / 打词的底材',
             'goods': [g(c, n=1, l=85) for c in trinkets], 't': 'stash'})

bases = []
for needle, s in [('Crystal Sword', 4), ('Flail', 4), ('War Scepter', 4),
                  ('Thresher', 4), ('Giant Thresher', 4), ('Poleaxe', 4),
                  ('Monarch', 4), ('Archon Plate', 4), ('Dusk Shroud', 3),
                  ('Bone Shield', 3), ('Kite Shield', 3), ('Great Hauberk', 4),
                  ('Diamond Bow', 4), ('Matriarchal Bow', 4)]:
    for c in codes_by_name(needle):
        bases.append(g(c, s=s, l=85))
bases = [dict(t) for t in {tuple(d.items()): d for d in bases}.values()]
shop.append({'id': 'bases', 'cn': '常用带孔底材', 'desc': '精神 / 眼光 / 无限 / 谜团 等符文之语常用底材，已开孔',
             'goods': bases, 't': 'stash'})

# NPC vendor assortments — real 1.13c data, grouped by merchant.
vendors = []
for vid, cn, _ in VENDORS:
    cs = sorted(set(vendor_raw[vid]))
    # keep a representative, not overwhelming, assortment
    if len(cs) > 48:
        cs = cs[:48]
    if cs:
        vendors.append({'id': vid, 'cn': cn, 'codes': cs})
shop.append({'id': 'vendors', 'cn': '游戏内商人常售（真实数据表）',
             'desc': '按 1.13c 各 NPC 的 Min/Max 列提取，可作为商品种类模板直接上架',
             'groups': vendors})

meta = {
    'size': size, 'dur': dur, 'lvl': lvl, 'cost': cost,
    'uniq_base': uniq_base, 'set_base': set_base,
    'vendors': vendors, 'shop': shop,
}

out = os.path.join(BASE, 'item_meta.json')
json.dump(meta, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('wrote', out, os.path.getsize(out), 'bytes')
print('  size entries :', len(size), 'dur:', len(dur), 'lvl:', len(lvl))
print('  uniq_base    :', len(uniq_base), '/', len(DATA['unq_items']), ' set_base:', len(set_base))
for s in shop:
    print('  shop %-12s %-28s goods=%s groups=%s' % (s['id'], s['cn'], len(s.get('goods', [])), len(s.get('groups', []))))
