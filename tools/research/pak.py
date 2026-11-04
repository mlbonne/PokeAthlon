"""Minimal UE4 pak v11 (uncompressed, unencrypted) reader: list + extract."""
import struct, sys, os, json

class R:
    def __init__(s, b): s.b, s.p = b, 0
    def u32(s): v = struct.unpack_from('<I', s.b, s.p)[0]; s.p += 4; return v
    def i32(s): v = struct.unpack_from('<i', s.b, s.p)[0]; s.p += 4; return v
    def u64(s): v = struct.unpack_from('<Q', s.b, s.p)[0]; s.p += 8; return v
    def raw(s, n): v = s.b[s.p:s.p+n]; s.p += n; return v
    def fstr(s):
        n = s.i32()
        if n == 0: return ''
        if n < 0:
            v = s.b[s.p:s.p-2*n].decode('utf-16-le'); s.p += -2*n; return v[:-1]
        v = s.b[s.p:s.p+n].decode('latin-1'); s.p += n; return v[:-1]

def load(path):
    f = open(path, 'rb'); f.seek(-204, 2); foot = f.read(204)
    magic, ver, ioff, isz = struct.unpack('<IiQQ', foot[:24])
    f.seek(ioff); r = R(f.read(isz))
    mount = r.fstr(); n = r.i32(); seed = r.u64()
    if r.i32(): r.u64(); r.u64(); r.raw(20)
    has_fdi = r.i32(); fdi = None
    if has_fdi: fdi = (r.u64(), r.u64()); r.raw(20)
    enc = r.raw(r.i32())
    f.seek(fdi[0]); d = R(f.read(fdi[1]))
    files = {}
    for _ in range(d.i32()):
        dn = d.fstr()
        for _ in range(d.i32()):
            fn = d.fstr(); loc = d.i32()
            files[(mount + dn + fn).replace('../../../', '')] = loc
    return f, enc, files

def entry(enc, loc):
    r = R(enc); r.p = loc
    v = r.u32()
    if (v & 0x3f) == 0x3f: r.u32()
    off = r.u32() if v & (1 << 31) else r.u64()
    usz = r.u32() if v & (1 << 30) else r.u64()
    meth = (v >> 23) & 0x3f
    size = (r.u32() if v & (1 << 29) else r.u64()) if meth else usz
    return off, size, usz, meth, (v >> 22) & 1, (v >> 6) & 0xffff

def read(f, enc, loc):
    off, size, usz, meth, encr, blocks = entry(enc, loc)
    assert meth == 0 and not encr, ('compressed/encrypted', meth, encr)
    f.seek(off + 53)
    return f.read(usz)

if __name__ == '__main__':
    pak, cmd = sys.argv[1], sys.argv[2]
    f, enc, files = load(pak)
    if cmd == 'list':
        with open(sys.argv[3], 'w', encoding='utf-8') as o:
            for k in sorted(files): o.write(k + '\n')
        print(len(files), 'files')
    elif cmd == 'extract':  # extract <outdir> <substring filters...>
        out = sys.argv[3]; pats = sys.argv[4:]; c = 0
        for k, loc in files.items():
            if any(p.lower() in k.lower() for p in pats):
                dst = os.path.join(out, k); os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, 'wb').write(read(f, enc, loc)); c += 1
        print(c, 'extracted')
