"""List Blueprint-declared variables (name + type, in declaration order) from a BP class export.

usage: python -I bpvars.py <pkg.uasset>
"""
import struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exports import read_package

names, imports, exports = read_package(sys.argv[1])
idx = {n: i for i, n in enumerate(names)}
types = {idx[n]: n for n in names if n.endswith('Property') and n in idx}
for e in exports:
    if e['class'] != 'BlueprintGeneratedClass':
        continue
    d = e['data']
    out = []
    for o in range(0, len(d) - 16):
        t = struct.unpack_from('<i', d, o)[0]
        if t in types and struct.unpack_from('<i', d, o + 4)[0] == 0:
            n = struct.unpack_from('<i', d, o + 8)[0]
            if 0 <= n < len(names) and struct.unpack_from('<i', d, o + 12)[0] == 0 and not names[n].endswith('Property'):
                out.append(f"{names[n]}:{types[t].replace('Property','')}")
    print(e['name'], '->', ', '.join(out))
