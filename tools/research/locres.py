"""Dump UE .locres (v2/v3) and StringTable .uexp strings to text."""
import struct, sys, re
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from pak import R

def locres(path):
    b = open(path, 'rb').read(); r = R(b)
    r.raw(16); ver = b[16]; r.p = 17
    soff = r.u64()
    if ver >= 2: r.u32()
    r2 = R(b); r2.p = soff; strs = []
    for _ in range(r2.i32()):
        s = r2.fstr()
        if ver >= 3: r2.i32()
        strs.append(s)
    out = []
    for _ in range(r.u32()):
        if ver >= 2: r.u32()
        ns = r.fstr()
        for _ in range(r.u32()):
            if ver >= 2: r.u32()
            k = r.fstr(); r.u32(); i = r.i32()
            out.append((ns, k, strs[i] if 0 <= i < len(strs) else ''))
    return out

def stringtable(path):
    """Scan uexp for consecutive FStrings (key,value pairs)."""
    b = open(path, 'rb').read(); out = []; p = 0
    while p < len(b) - 4:
        n = struct.unpack_from('<i', b, p)[0]
        try:
            if 1 < n < 20000 and b[p+4+n-1] == 0:
                s = b[p+4:p+4+n-1].decode('utf-8')
                if s.isprintable() or '\n' in s or '\r' in s:
                    out.append(s); p += 4 + n; continue
            if -20000 < n < -1 and b[p+4-2*n-2:p+4-2*n] == b'\0\0':
                s = b[p+4:p+4-2*n-2].decode('utf-16-le'); out.append(s); p += 4 - 2*n; continue
        except Exception: pass
        p += 1
    return out

if __name__ == '__main__':
    mode, src, dst = sys.argv[1:4]
    with open(dst, 'w', encoding='utf-8') as o:
        if mode == 'locres':
            for ns, k, s in locres(src): o.write(f'[{ns}] {k} = {s!r}\n')
        else:
            ss = stringtable(src)
            for i in range(0, len(ss) - 1, 2): o.write(f'{ss[i]} = {ss[i+1]!r}\n')
