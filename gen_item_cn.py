# -*- coding: utf-8 -*-
"""Build Simplified-Chinese item/affix name tables from the CHS game's TBL files."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_tbl import load_all
import zhconv

BASE = os.path.dirname(os.path.abspath(__file__))
T = load_all()
D = json.load(open(os.path.join(BASE, 'd2s_data.json'), encoding='utf-8'))

# Some TBL keys drop apostrophes/hyphens ("the generals tan do li ga").
def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

TN = {}
for _k, _v in T.items():
    TN.setdefault(norm(_k), _v)

# A few unique items this CHS build never translated; well-known CN names.
EXTRA_UNQ_CN = {
    'War Traveler': '战争旅者',
    'Jade Talon': '碧玉爪',
    'The General\'s Tan Do Li Ga': '坦-杜-里-嘎将军',
}

POTION_CN = {
    'hpo': '治疗药水', 'mpo': '法力药水',
    'hpf': '完全治疗药水', 'mpf': '完全法力药水',
    'rps': '小型红色药水', 'rpl': '大型红色药水',
    'bps': '小型蓝色药水', 'bpl': '大型蓝色药水',
}

def clean(val, key):
    if val is None: return None
    s = val.replace('\r', ' ').replace('\n', ' ').strip()
    s = zhconv.convert(s, 'zh-cn')
    # CHS patch often appends the original English name after the Chinese one
    # (e.g. "軍帽 Shako", "牙齒 The Gnasher"). Drop trailing ASCII-only words.
    low, klow = s.lower(), key.lower()
    if low.endswith(klow):
        s = s[:-len(key)].strip()
    parts = s.split(' ')
    while len(parts) > 1 and not re.search(r'[\u4e00-\u9fff]', parts[-1]):
        parts.pop()
    s = ' '.join(parts)
    s = re.sub(r'\s+', ' ', s).strip(' ·-')
    if not s: return None
    # Untranslated / descriptive entries are not usable as names
    if len(s) > 34: return None
    if not re.search(r'[\u4e00-\u9fff]', s): return None
    return s

def lookup(key):
    v = T.get(key.lower())
    if v is None:
        v = TN.get(norm(key))
    return clean(v, key)

def build_map(keys, label):
    out = {}
    for k in keys:
        if not k: continue
        v = lookup(k)
        if v: out[k] = v
    print('  %-16s %4d / %4d' % (label, len(out), len([k for k in keys if k])))
    return out

codes = list(D['armor']) + list(D['weapon']) + list(D['other'])
cn = {
    'item':   build_map(codes, 'item codes'),
    'prefix': build_map(D['magic_prefixes'], 'prefixes'),
    'suffix': build_map(D['magic_suffixes'], 'suffixes'),
    'set':    build_map(D['set_items'], 'set items'),
    'unq':    build_map(D['unq_items'], 'unique items'),
    'rare':   build_map(D['rare_names'], 'rare names'),
    'rw':     build_map(D['runewords'], 'runewords'),
}
cn['item'].update(POTION_CN)
for _k, _v in EXTRA_UNQ_CN.items():
    cn['unq'].setdefault(_k, _v)

out = json.dumps(cn, ensure_ascii=False, separators=(',', ':'))
p = os.path.join(BASE, 'item_cn.json')
open(p, 'w', encoding='utf-8').write(out)
print('wrote', p, len(out), 'bytes')
print('\nsample item names:')
for c in ['cap','skp','hlm','xap','uap','hax','axe','qui','lea','elx','hpo','mpo','r01','jav','rin','amu']:
    print('  %-5s -> %s   (en: %s)' % (c, cn['item'].get(c, '?'), (D['armor'].get(c) or D['weapon'].get(c) or D['other'].get(c) or {}).get('n', '?')))
print('\nsample affix/name:')
for k in ['Sturdy','Strong','of Health','of Protection','Bite','Scratch','The Gnasher','Deathspade',"Civerb's Ward"]:
    for t in ['prefix','suffix','rare','unq','set']:
        if k in cn[t]: print('  %-18s [%s] -> %s' % (k, t, cn[t][k]))
