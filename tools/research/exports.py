"""List imports/exports of a cooked UE5.1 package and scan export blobs for vectors.

Unversioned packages store property values without names, so this does NOT decode
properties. It finds candidate FVector/FRotator values (three consecutive doubles
in a plausible range) inside each export's serialized data, which is enough to
recover actor/component transforms (RelativeLocation / RelativeScale3D) and shape
extents for gameplay layout study.

usage: python -I exports.py <package.umap|.uasset> [--vectors] [--filter SUBSTR]
"""
import struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pak import R


def fname(r, names):
    i = r.i32(); n = r.i32()
    s = names[i] if 0 <= i < len(names) else f'?{i}'
    return s if n == 0 else f'{s}_{n - 1}'


def read_package(path):
    head = open(path, 'rb').read()
    uexp = path[: path.rfind('.')] + '.uexp'
    tail = open(uexp, 'rb').read() if os.path.exists(uexp) else b''
    r = R(head)
    r.u32(); legacy = r.i32()
    if legacy != -4: r.i32()
    r.i32(); r.i32(); r.i32()  # UE4, UE5, licensee (0 when unversioned)
    for _ in range(r.i32()): r.raw(20)
    total = r.i32(); r.fstr(); flags = r.u32()
    ncount = r.i32(); noff = r.i32()
    r.i32(); r.i32()  # soft object paths (UE5.1+)
    if not (flags & 0x80000000): r.fstr()
    r.i32(); r.i32()  # gatherable text
    ecount = r.i32(); eoff = r.i32(); icount = r.i32(); ioff = r.i32()

    rn = R(head); rn.p = noff; names = []
    for _ in range(ncount):
        names.append(rn.fstr()); rn.raw(4)

    ri = R(head); ri.p = ioff; imports = []
    for _ in range(icount):
        cpkg = fname(ri, names); cls = fname(ri, names); outer = ri.i32(); name = fname(ri, names); ri.i32()
        imports.append(dict(cls=cls, name=name, outer=outer, pkg=cpkg))

    re_ = R(head); re_.p = eoff; exports = []
    for _ in range(ecount):
        ci = re_.i32(); si = re_.i32(); ti = re_.i32(); oi = re_.i32()
        name = fname(re_, names); oflags = re_.u32()
        size = struct.unpack('<q', re_.raw(8))[0]; off = struct.unpack('<q', re_.raw(8))[0]
        re_.raw(4 * 3)            # forced, notForClient, notForServer
        re_.raw(4)                # isInheritedInstance
        re_.raw(4)                # package flags
        re_.raw(4 * 3)            # notAlwaysLoaded, isAsset, generatePublicHash
        re_.raw(4 * 5)            # dependency info
        exports.append(dict(cls=ci, outer=oi, name=name, size=size, off=off, template=ti))

    def ref(i):
        if i < 0: return imports[-i - 1]['name']
        if i > 0: return exports[i - 1]['name']
        return ''

    for e in exports:
        e['class'] = ref(e['cls']); e['outerName'] = ref(e['outer'])
        rel = e['off'] - total
        e['data'] = tail[rel: rel + e['size']] if 0 <= rel <= len(tail) else b''
    return names, imports, exports


def vectors(blob, lo=1e-3, hi=50000.0):
    """Candidate (offset, x, y, z) triples of doubles."""
    out = []
    for o in range(0, len(blob) - 23):
        x, y, z = struct.unpack_from('<ddd', blob, o)
        vals = (x, y, z)
        if all(v == v and abs(v) < hi and (v == 0 or abs(v) > lo) for v in vals) and any(abs(v) >= 1 for v in vals):
            # Prefer "designer" numbers: few decimals.
            if all(abs(v * 16 - round(v * 16)) < 1e-6 or abs(v) < 1e-9 for v in vals) or any(abs(v) > 10 for v in vals):
                out.append((o, x, y, z))
    return out


if __name__ == '__main__':
    path = sys.argv[1]
    want_vec = '--vectors' in sys.argv
    flt = sys.argv[sys.argv.index('--filter') + 1] if '--filter' in sys.argv else None
    names, imports, exports = read_package(path)
    print(f'{len(imports)} imports, {len(exports)} exports')
    for i, e in enumerate(exports, 1):
        line = f'[{i}] {e["name"]} : {e["class"]}  (outer {e["outerName"]}, {e["size"]} B)'
        if flt and flt.lower() not in line.lower(): continue
        print(line)
        if want_vec and e['data']:
            seen = set()
            for o, x, y, z in vectors(e['data']):
                key = (round(x, 3), round(y, 3), round(z, 3))
                if key in seen: continue
                seen.add(key)
                print(f'      @{o:4d}  ({x:.3f}, {y:.3f}, {z:.3f})')


def double_run(blob, lo=1e-4, hi=1e6):
    """Longest run of plausible doubles (8-byte stride). Returns (offset, [values])."""
    best = (0, [])
    for start in range(0, min(16, len(blob))):
        vals = []
        o = start
        while o + 8 <= len(blob):
            v = struct.unpack_from('<d', blob, o)[0]
            if not (v == v and abs(v) < hi and (v == 0 or abs(v) > lo)):
                break
            vals.append(v)
            o += 8
        if len(vals) > len(best[1]):
            best = (start, vals)
    return best
