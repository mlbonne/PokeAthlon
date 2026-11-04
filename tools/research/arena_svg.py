"""Render the Omega Strikers standard arena (from our data-mining notes) to scale as SVG,
with PokéAthlon's current pitch overlaid for comparison.

Axes: OS uses +Y as the goal-to-goal axis. This drawing uses our convention:
horizontal = goal-to-goal (OS Y), vertical = side-to-side (OS X). Units = OS world units.
All numbers below are documented in docs/research/os-arena-geometry.md.

usage: python -I arena_svg.py <out.svg>
"""
import sys

# --- OS standard frame (all competitive maps) ---
SIDE = 910          # Core rebound wall inner face (|X|)
MOUTH_X = 1360.5    # goal mouth line (|Y|)
MOUTH_HALF = 562    # goal channel inner half-width (|X|)
CORNER = [(1002, 910), (1343, 569)]   # corner diagonal (long, side), inner face
SCORE = (1510, 1610, 550)             # score volume long-range, half-width
GOAL_KO = (1535, 1635, 550)
BACK = 1674.5
GATE = (1375, 1500, 497.5)
SIDE_KO = (946, 1046, 1100)           # |X| range, |Y| extent
POST_R, POST_X, POST_Y = 25, 587, 1360.5
ARC_C, ARC_RLONG, ARC_RSIDE = 1250, 400, 460
CORE_R = 47.5
BODY = {'Normal': 46, 'Large': 60, 'Very Large': 65}
HURT = {'Normal': 55, 'Large': 70, 'Very Large': 75}
STRIKE_R = 125
# Night Market terrain
BARRIERS = [(1300, 370, 70, 335)]     # long, side, half-long, half-side (mirrored)
FORWARD = (1000, 250); GOALIE = 1100; CORE_SPAWN = 600; RESPAWN = (950, 700)
ORBS = [(0, 600), (1250, 250)]

# --- PokéAthlon current (packages/data/stages/viridian-pitch.json) ---
OURS = dict(half_long=1800, half_side=1000, cut=320, goal_half=250)

W, H = 4000, 2600
def X(l): return W / 2 + l
def Y(s): return H / 2 - s

out = []
def add(s): out.append(s)

add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Segoe UI, sans-serif">')
add(f'<rect width="{W}" height="{H}" fill="#14112a"/>')
add('<style>text{fill:#e8e6f5;font-size:34px} .s{font-size:26px;fill:#b9b4d6}</style>')

# Ours (dashed overlay, drawn first)
o = OURS
pts = [(-o['half_long'] + o['cut'], o['half_side']), (o['half_long'] - o['cut'], o['half_side']), (o['half_long'], o['half_side'] - o['cut']),
       (o['half_long'], -o['half_side'] + o['cut']), (o['half_long'] - o['cut'], -o['half_side']), (-o['half_long'] + o['cut'], -o['half_side']),
       (-o['half_long'], -o['half_side'] + o['cut']), (-o['half_long'], o['half_side'] - o['cut'])]
add('<polygon points="' + ' '.join(f'{X(a)},{Y(b)}' for a, b in pts) + '" fill="none" stroke="#7aa8ff" stroke-width="6" stroke-dasharray="30 18"/>')

# OS field (Core boundary) polygon, both halves
poly = []
for sgn in (1, -1):
    seq = [(-CORNER[0][0], SIDE), (CORNER[0][0], SIDE), (CORNER[1][0], CORNER[1][1]), (MOUTH_X, MOUTH_HALF),
           (BACK, MOUTH_HALF), (BACK, -MOUTH_HALF), (MOUTH_X, -MOUTH_HALF), (CORNER[1][0], -CORNER[1][1]),
           (CORNER[0][0], -SIDE), (-CORNER[0][0], -SIDE), (-CORNER[1][0], -CORNER[1][1]), (-MOUTH_X, -MOUTH_HALF),
           (-BACK, -MOUTH_HALF), (-BACK, MOUTH_HALF), (-MOUTH_X, MOUTH_HALF), (-CORNER[1][0], CORNER[1][1])]
    poly = seq
    break
add('<polygon points="' + ' '.join(f'{X(a)},{Y(b)}' for a, b in poly) + '" fill="#2f6b3c" stroke="#e8e6f5" stroke-width="6"/>')
add(f'<line x1="{X(0)}" y1="{Y(SIDE)}" x2="{X(0)}" y2="{Y(-SIDE)}" stroke="#e8e6f5" stroke-width="3" opacity="0.6"/>')

for sgn in (1, -1):
    # Goal arc (inside the field only)
    add(f'<clipPath id="c{sgn}"><rect x="{min(X(0), X(sgn * MOUTH_X))}" y="0" width="{MOUTH_X}" height="{H}"/></clipPath>')
    add(f'<ellipse cx="{X(sgn * ARC_C)}" cy="{Y(0)}" rx="{ARC_RLONG}" ry="{ARC_RSIDE}" fill="#ffd23f" fill-opacity="0.12" stroke="#ffd23f" stroke-width="4" clip-path="url(#c{sgn})"/>')
    # Score volume, goal KO, gates
    a, b, hw = SCORE
    add(f'<rect x="{min(X(sgn*a), X(sgn*b))}" y="{Y(hw)}" width="{b-a}" height="{2*hw}" fill="#3ddc84" fill-opacity="0.45"/>')
    a, b, hw = GOAL_KO
    add(f'<rect x="{min(X(sgn*a), X(sgn*b))}" y="{Y(hw)}" width="{b-a}" height="{2*hw}" fill="none" stroke="#ff4d5e" stroke-width="5" stroke-dasharray="14 10"/>')
    a, b, hw = GATE
    add(f'<rect x="{min(X(sgn*a), X(sgn*b))}" y="{Y(hw)}" width="{b-a}" height="{2*hw}" fill="#ff9a3a" fill-opacity="0.35" stroke="#ff9a3a" stroke-width="3"/>')
    for side in (1, -1):
        add(f'<circle cx="{X(sgn*POST_Y)}" cy="{Y(side*POST_X)}" r="{POST_R}" fill="#e8e6f5"/>')
        # Side KO strips
        a, b, ext = SIDE_KO
        add(f'<rect x="{X(-ext)}" y="{min(Y(side*a), Y(side*b))}" width="{2*ext}" height="{b-a}" fill="#ff4d5e" fill-opacity="0.45"/>')
        # Night Market barriers
        for l, s, hl, hs in BARRIERS:
            add(f'<rect x="{X(sgn*l)-hl}" y="{Y(side*s)-hs}" width="{2*hl}" height="{2*hs}" fill="#8fd3ff" fill-opacity="0.75"/>')
        # Starts
        add(f'<circle cx="{X(sgn*FORWARD[0])}" cy="{Y(side*FORWARD[1])}" r="{BODY["Normal"]}" fill="{"#3d7bff" if sgn<0 else "#ff4d5e"}"/>')
    add(f'<circle cx="{X(sgn*GOALIE)}" cy="{Y(0)}" r="{BODY["Very Large"]}" fill="{"#3d7bff" if sgn<0 else "#ff4d5e"}" stroke="#fff" stroke-width="4"/>')
    add(f'<circle cx="{X(sgn*RESPAWN[0])}" cy="{Y(-sgn*RESPAWN[1])}" r="30" fill="none" stroke="#e8e6f5" stroke-width="4" stroke-dasharray="8 6"/>')
    # Core spawns + orbs
    add(f'<circle cx="{X(0)}" cy="{Y(sgn*CORE_SPAWN)}" r="{CORE_R}" fill="#ffd23f"/>')
    for side in (1, -1):
        add(f'<circle cx="{X(sgn*ORBS[1][0])}" cy="{Y(side*ORBS[1][1])}" r="22" fill="#b06cff"/>')

# Strike reach example + scale bar
add(f'<circle cx="{X(-FORWARD[0])}" cy="{Y(FORWARD[1])}" r="{STRIKE_R}" fill="none" stroke="#fff" stroke-width="3" opacity="0.7"/>')
add(f'<line x1="{X(-1800)}" y1="{H-70}" x2="{X(-800)}" y2="{H-70}" stroke="#fff" stroke-width="6"/><text x="{X(-1800)}" y="{H-90}">1000 units</text>')

legend = [('#2f6b3c', 'OS field (Core walls)'), ('#ff4d5e', 'KO zones'), ('#3ddc84', 'Score volume'), ('#ff9a3a', 'Goal gates'),
          ('#8fd3ff', 'Barriers (Night Market)'), ('#ffd23f', 'Core spawns / Goal Arc'), ('#b06cff', 'Orb spawns'), ('#7aa8ff', 'PokéAthlon M1 pitch (dashed)')]
for i, (c, t) in enumerate(legend):
    add(f'<rect x="{80 + (i % 4) * 980}" y="{60 + (i // 4) * 60}" width="36" height="36" fill="{c}"/><text x="{130 + (i % 4) * 980}" y="{90 + (i // 4) * 60}">{t}</text>')
add(f'<text class="s" x="80" y="{H-30}">Omega Strikers standard arena, to scale (OS units). Starts: forwards ●, goalie ◉, respawn ◌. White ring = Strike reach (r 125).</text>')
add('</svg>')
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out))
print('wrote', sys.argv[1])
