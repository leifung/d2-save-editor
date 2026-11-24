# -*- coding: utf-8 -*-
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_mpq import MPQArchiveX

BASE = r"D:/3DMGAME_DiabloII.V1.13C.CHS.Green/Diablo II原始/Diablo II"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref", "tbl")
os.makedirs(OUT, exist_ok=True)
a = MPQArchiveX(os.path.join(BASE, "Patch_D2.mpq"), listfile=False)

for name in ["string.tbl", "expansionstring.tbl", "patchstring.tbl"]:
    fn = "data\\local\\LNG\\chi\\" + name
    t = time.time()
    d = a.read_file_x(fn)
    p = os.path.join(OUT, "zh_" + name)
    open(p, "wb").write(d)
    print("%-24s %7d bytes  %.1fs  head=%s" % (name, len(d), time.time()-t, d[:10].hex(' ')), flush=True)
