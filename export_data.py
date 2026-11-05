#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export the minimal constant data the HTML tool needs, as a compact JS blob."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core

C = core.CONST

# --- magical_properties: keep only fields the parser/editor needs ---
mp = []
for p in C['magical_properties']:
    if p is None:
        mp.append(None)
        continue
    q = {}
    for k in ('s', 'sB', 'sA', 'sP', 'e', 'dF', 'np', 'cB'):
        if k in p:
            q[k] = p[k]
    mp.append(q)

# --- item tables: keep only categories (for type_id / Quest) and display name ---
def slim_items(tbl):
    out = {}
    for code, d in tbl.items():
        if not d:
            continue
        o = {}
        if 'c' in d:
            o['c'] = d['c']
        if 'n' in d:
            o['n'] = d['n']
        out[code] = o
    return out

# --- name tables (display) ---
def slim_names(lst):
    return [(d.get('n') if isinstance(d, dict) else None) for d in lst]

data = {
    'mp': mp,
    'armor': slim_items(C['armor_items']),
    'weapon': slim_items(C['weapon_items']),
    'other': slim_items(C['other_items']),
    'stackables': list(C['stackables'].keys()),
    'classes': [d.get('n') if d else None for d in C['classes']],
    # skills.txt uses "s" (not "n") for the skill name
    'skills': [d.get('s') if d else None for d in C['skills']],
    'magic_prefixes': slim_names(C['magic_prefixes']),
    'magic_suffixes': slim_names(C['magic_suffixes']),
    'set_items': slim_names(C['set_items']),
    'unq_items': slim_names(C['unq_items']),
    'rare_names': slim_names(C['rare_names']),
    'runewords': slim_names(C['runewords']),
}

# Simplified-Chinese item / affix names extracted from the CHS game's TBL files
_cn_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'item_cn.json')
if os.path.exists(_cn_path):
    with open(_cn_path, encoding='utf-8') as f:
        data['cn'] = json.load(f)

# Metadata for the "add property / add skill" feature (Chinese stat names,
# writable stat descriptors, Chinese skill names, classes and skill tabs).
_add_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'add_meta.json')
if os.path.exists(_add_path):
    with open(_add_path, encoding='utf-8') as f:
        data['add'] = json.load(f)

out = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'd2s_data.json')
open(path, 'w', encoding='utf-8').write(out)
print('wrote', path, len(out), 'bytes')
for k, v in data.items():
    print('  %-16s %s' % (k, len(v) if hasattr(v, '__len__') else '?'))
