#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inline data + engine into tool_template.html -> single self-contained HTML.

Usage:
    python3 build_html.py                    -> index.html (GitHub Pages entry)
    python3 build_html.py my-tool.html       -> custom output filename
"""
import os, json, sys

BASE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(BASE, 'tool_template.html'), encoding='utf-8').read()
data = open(os.path.join(BASE, 'd2s_data.json'), encoding='utf-8').read()
engine = open(os.path.join(BASE, 'd2s_engine.js'), encoding='utf-8').read()

# Guard against accidental </script> in JSON breaking the inline block.
data_safe = data.replace('</', '<\\/')

out = tpl.replace('__D2S_DATA_JSON__', data_safe).replace('__D2S_ENGINE_JS__', engine)

out_name = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
path = os.path.join(BASE, out_name)
open(path, 'w', encoding='utf-8').write(out)
print('built:', path)
print('size: %d bytes (%.1f KB)' % (len(out.encode('utf-8')), len(out.encode('utf-8')) / 1024))
assert '__D2S_DATA_JSON__' not in out and '__D2S_ENGINE_JS__' not in out, 'placeholder left!'
print('placeholders: all replaced')
