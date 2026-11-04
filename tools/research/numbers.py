"""Dump plausible numeric values (floats and doubles) of each export in a cooked package,
plus its interesting names. Unversioned data has no property names, so values are listed
in serialization order; compare across related assets to identify them.

usage: python -I numbers.py <pkg.uasset> [--all]
"""
import struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exports import read_package


def nice(v, lo=1e-3, hi=1e6):
    return v == v and lo <= abs(v) <= hi and abs(v * 1000 - round(v * 1000)) < 1e-3


def numbers(d):
    out = []
    o = 0
    while o + 4 <= len(d):
        f = struct.unpack_from('<f', d, o)[0]
        if o + 8 <= len(d):
            g = struct.unpack_from('<d', d, o)[0]
            if nice(g) and not nice(f):
                out.append((o, 'd', g)); o += 8; continue
        if nice(f):
            out.append((o, 'f', f)); o += 4; continue
        o += 1
    return out


if __name__ == '__main__':
    path = sys.argv[1]
    names, imports, exports = read_package(path)
    skip = ('/Script/', '/Game/', 'Default__', 'K2Node', 'Function', 'ExecuteUbergraph')
    print('NAMES:', ' | '.join(n for n in names if not n.startswith(skip))[:3000])
    for e in exports:
        if e['class'] in ('Function',) and '--all' not in sys.argv:
            continue
        nums = numbers(e['data'])
        if nums:
            print(f"[{e['name']} <{e['class']}> {len(e['data'])}B]", ', '.join(f"{t}{o}:{v:g}" for o, t, v in nums[:40]))
