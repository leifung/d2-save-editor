# -*- coding: utf-8 -*-
"""Parse Diablo II .tbl string tables (NUL-delimited key/value pairs)."""
import re, os

ASCII_OK = re.compile(rb'^[ -~]{1,120}$')

def parse_tbl(path):
    d = open(path, 'rb').read()
    parts = d.split(b'\x00')
    out = {}
    i = 0
    while i + 1 < len(parts):
        k, v = parts[i], parts[i+1]
        if ASCII_OK.match(k):
            try:
                s = v.decode('utf-8')
            except UnicodeDecodeError:
                i += 1
                continue
            # reject binary-ish values (control chars other than newline/tab)
            if all(c == '\n' or c == '\t' or ord(c) >= 0x20 for c in s):
                key = k.decode('ascii')
                out.setdefault(key.lower(), s)
                i += 2
                continue
        i += 1
    return out

def load_all():
    # later tables override earlier ones (patch > expansion > base)
    merged = {}
    for name in ['string.tbl', 'expansionstring.tbl', 'patchstring.tbl']:
        t = parse_tbl(os.path.join('ref', 'tbl', 'zh_' + name))
        print('  %-24s %5d entries' % (name, len(t)))
        merged.update(t)
    return merged

if __name__ == '__main__':
    import json
    T = load_all()
    print('merged:', len(T), 'keys')
    for k in ['cap', 'skp', 'hax', 'qui', 'elx', 'of health', 'sturdy', 'strength', 'shako']:
        print('  %-14s -> %r' % (k, T.get(k)))
    D = json.load(open('d2s_data.json', encoding='utf-8'))
    codes = list(D['armor']) + list(D['weapon']) + list(D['other'])
    hit = [c for c in codes if c.lower() in T]
    print('item code coverage: %d / %d' % (len(hit), len(codes)))
    print('  sample hits:', [(c, T[c.lower()]) for c in hit[:10]])
    print('  misses:', [c for c in codes if c.lower() not in T][:30])
    for tbl in ['magic_prefixes', 'magic_suffixes', 'set_items', 'unq_items', 'rare_names', 'runewords']:
        vals = [v for v in D[tbl] if v]
        h = [v for v in vals if v.lower() in T]
        print('  %-16s %4d / %4d  e.g. %s' % (tbl, len(h), len(vals), [(v, T[v.lower()]) for v in h[:3]]))
