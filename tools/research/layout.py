"""Group a level's exports by actor and print candidate transforms/extents per component.

usage: python -I layout.py <GameMapX.umap> [ACTOR_CLASS_SUBSTR ...]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exports import read_package, vectors, double_run

path = sys.argv[1]
want = [w.lower() for w in sys.argv[2:]]
names, imports, exports = read_package(path)
actors = [e for e in exports if e['outerName'] == 'PersistentLevel']
by_outer = {}
for e in exports:
    by_outer.setdefault(e['outerName'], []).append(e)

for a in actors:
    if want and not any(w in a['class'].lower() for w in want):
        continue
    print(f"{a['name']}  <{a['class']}>")
    for c in by_outer.get(a['name'], []):
        off, run = double_run(c['data'])
        if len(run) >= 3:
            print(f"    {c['name']:<28} {c['class']:<18} @{off} [{', '.join(f'{v:g}' for v in run[:12])}]")
