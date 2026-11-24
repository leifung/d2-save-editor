#!/usr/bin/env python3
"""Extract a file from a D2 MPQ (adds file-data decryption on top of mpyq)."""
import sys, struct, zlib, bz2
import pwexplode
from mpyq import (MPQArchive, MPQ_FILE_ENCRYPTED, MPQ_FILE_COMPRESS,
                  MPQ_FILE_SINGLE_UNIT, MPQ_FILE_FIX_KEY, MPQ_FILE_SECTOR_CRC,
                  MPQ_FILE_EXISTS)

# D2 MPQs use BOTH the legacy IMPLODE flag (0x100) and COMPRESS (0x200).
# mpyq only defines MPQ_FILE_COMPRESS = 0x200, so check 0x100 explicitly.
MPQ_FILE_IMPLODE = 0x00000100
COMPRESSED = MPQ_FILE_COMPRESS | MPQ_FILE_IMPLODE

class MPQArchiveX(MPQArchive):
    def read_file_x(self, filename, fix_key=True):
        def decompress(data):
            # strip per-sector compression-type byte
            cbyte = data[0]
            body = data[1:]
            if cbyte == 0:
                return body
            elif cbyte == 2:
                return zlib.decompress(body, 15)
            elif cbyte == 16:
                return bz2.decompress(body)
            elif cbyte == 8:
                return pwexplode.explode(body)
            else:
                raise RuntimeError("Unsupported compression type %d" % cbyte)

        he = self.get_hash_table_entry(filename)
        if he is None:
            return None
        be = self.block_table[he.block_table_index]
        if not (be.flags & MPQ_FILE_EXISTS) or be.archived_size == 0:
            return None
        offset = be.offset + self.header['offset']
        self.file.seek(offset)
        raw = self.file.read(be.archived_size)

        if be.flags & MPQ_FILE_SINGLE_UNIT:
            if be.flags & COMPRESSED and be.size > be.archived_size:
                # single-unit files: first byte is the (only) compression type
                return decompress(raw)
            return raw

        sector_size = 512 << self.header['sector_size_shift']
        sectors = be.size // sector_size + 1
        crc = bool(be.flags & MPQ_FILE_SECTOR_CRC)
        npos = sectors + (2 if crc else 1)
        # Sector offset table. It is XOR-encrypted only when MPQ_FILE_ENCRYPTED.
        if be.flags & MPQ_FILE_ENCRYPTED:
            key = self._hash(filename, 'TABLE')
            if fix_key and (be.flags & MPQ_FILE_FIX_KEY):
                key = (key + be.offset) ^ be.size
                key &= 0xFFFFFFFF
            tbl = self._decrypt(raw[:4*npos], key)
        else:
            tbl = raw[:4*npos]
        positions = struct.unpack('<%dI' % npos, tbl)
        out = bytearray()
        left = be.size
        for i in range(len(positions) - (2 if crc else 1)):
            sector = raw[positions[i]:positions[i+1]]
            expected = min(sector_size, be.size - i * sector_size)
            # MPQ stores a sector UNCOMPRESSED (with no leading method byte)
            # whenever compression would not make it smaller. Only strip the
            # method byte when the stored sector is actually shorter.
            if be.flags & COMPRESSED and len(sector) < expected:
                # Legacy IMPLODE (0x100) sectors are raw implode streams with
                # NO leading method byte. COMPRESS (0x200) sectors do carry it.
                if be.flags & MPQ_FILE_IMPLODE and not (be.flags & MPQ_FILE_COMPRESS):
                    sector = pwexplode.explode(sector)
                else:
                    sector = decompress(sector)
            left -= len(sector)
            out.extend(sector)
        return bytes(out)

def try_extract(mpq_path, target, out_path):
    try:
        arch = MPQArchiveX(mpq_path, listfile=False)
    except Exception as e:
        return f"open fail: {e}"
    data = arch.read_file_x(target)
    if data is None:
        return None
    open(out_path, 'wb').write(data)
    return len(data)

if __name__ == '__main__':
    base = r"D:\3DMGAME_DiabloII.V1.13C.CHS.Green\Diablo II原始\Diablo II"
    target = r"data\global\excel\itemstatcost.txt"
    out = r"C:\Users\admin\WorkBuddy\2026-11-05-13-14-32\ref\d2s\itemstatcost.txt"
    found = False
    for mpq in ["D2Data.mpq", "D2Exp.mpq", "Patch_D2.mpq"]:
        p = f"{base}\\{mpq}"
        res = try_extract(p, target, out)
        print(f"{mpq}: {res}")
        if isinstance(res, int):
            found = True
            break
    if not found:
        print("NOT FOUND in tried MPQs")
