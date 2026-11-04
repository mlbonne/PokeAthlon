"""Read UE5 cooked .uasset summary: flags, name map, imports, exports."""
import struct, sys
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from pak import R

def summary(path):
    b = open(path, 'rb').read(); r = R(b)
    tag = r.u32(); legacy = r.i32()
    if legacy != -4: r.i32()
    ue4 = r.i32(); ue5 = r.i32() if legacy <= -8 else 0; lic = r.i32()
    for _ in range(r.i32()): r.raw(20)
    total = r.i32(); folder = r.fstr(); flags = r.u32()
    ncount = r.i32(); noff = r.i32()
    if ue5 >= 1008: r.i32(); r.i32()
    if not (flags & 0x80000000): r.fstr()
    r.i32(); r.i32()
    ecount = r.i32(); eoff = r.i32(); icount = r.i32(); ioff = r.i32()
    r2 = R(b); r2.p = noff; names = []
    for _ in range(ncount):
        names.append(r2.fstr()); r2.raw(4)
    return dict(ue4=ue4, ue5=ue5, flags=flags, unversioned=bool(flags & 0x2000), names=names,
                ecount=ecount, eoff=eoff, icount=icount, ioff=ioff, total=total)

if __name__ == '__main__':
    s = summary(sys.argv[1])
    print('ue4', s['ue4'], 'ue5', s['ue5'], 'flags', hex(s['flags']), 'unversioned', s['unversioned'], 'exports', s['ecount'])
    print(' | '.join(s['names']))
