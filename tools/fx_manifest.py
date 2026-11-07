"""Build assets/fx/pmd/manifest.json: frame layout of each PMD effect sheet (RogueEssence DirSheet rules)."""
import json, os, struct, sys
root = sys.argv[1] if len(sys.argv) > 1 else 'assets/fx/pmd'
DIRS = {'Dir2': 2, 'Dir5': 5, 'Dir8': 8}
def size(p):
    with open(p, 'rb') as f:
        h = f.read(24)
    return struct.unpack('>II', h[16:24])
out = {}
for fn in sorted(os.listdir(os.path.join(root, 'particle'))):
    if not fn.endswith('.png'): continue
    base, kind = fn[:-4].rsplit('.', 1)
    w, h = size(os.path.join(root, 'particle', fn))
    if kind.isdigit():
        n = int(kind); fw, fh, rows = w // n, h, 1
    else:
        rows = DIRS.get(kind, 1); fh = h // rows; fw = fh; n = w // fw
    out[base] = {'file': 'particle/' + fn, 'kind': kind, 'fw': fw, 'fh': fh, 'frames': n, 'rows': rows}
for b in sorted(os.listdir(os.path.join(root, 'beam'))):
    d = os.path.join(root, 'beam', b)
    frames = int(open(os.path.join(d, 'BeamData.xml'), encoding='utf-8-sig').read().split('<TotalFrames>')[1].split('<')[0])
    parts = {}
    for part in ('Head', 'Body', 'Tail'):
        w, h = size(os.path.join(d, part + '.png'))
        parts[part.lower()] = {'file': f'beam/{b}/{part}.png', 'w': w, 'h': h}
    out['Beam_' + b] = {'kind': 'beam', 'frames': frames, **parts}
json.dump(out, open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8'), indent=1)
for k, v in out.items():
    print(k, v.get('kind'), v.get('fw'), v.get('fh'), v.get('frames'), v.get('rows'), {p: (v[p]['w'], v[p]['h']) for p in ('head','body','tail')} if v.get('kind') == 'beam' else '')
