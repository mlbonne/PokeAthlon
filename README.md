# PokéAthlon (working title)

A free, non-commercial **3v3 Pokémon strike-ball** fan game. It's part soccer, part air hockey, part sumo.
Smash the ball through the enemy's barriers, score once their gate opens, and knock rivals off the arena.

- 📋 Plan & roadmap: [docs/PLAN.md](docs/PLAN.md)
- 🎮 Design bible (Omega Strikers breakdown → Pokémon version): [docs/design/GAME_BREAKDOWN.md](docs/design/GAME_BREAKDOWN.md)
- Status: **M1 Sandbox done**. Walk, aim and Strike the ball around a placeholder pitch with the 8-Pokémon roster. Next: M2 (rules: barriers, goals, KO, Stagger, Energy)

## Getting started

Requires Node.js 22+ (developed on v26 LTS). On the dev machine a portable Node lives in
`E:\agent-projects\tools\node`; add it to `PATH` for the session if `node` isn't found.

```bash
npm install
npm run dev          # http://localhost:5173  (WASD move, mouse aim + click/J Strike, R reset ball, 1–8 switch, F3 debug)
npm run check        # typecheck + lint + tests
npm run build        # production build → packages/client/dist
npm run import-sprites   # re-import roster sprites from ./SpriteCollab-master and regenerate CREDITS.md
```

### Layout

| Path | What |
|---|---|
| `packages/sim` | Deterministic fixed-step (60 Hz) simulation. No DOM, no Three.js, no wall clock or `Math.random` (lint-enforced) |
| `packages/client` | Vite + Three.js renderer, input, HUD. Interpolates sim state |
| `packages/data` | Roster and game data as JSON + Zod schemas |
| `tools/import-sprites.ts` | SpriteCollab → `assets/` importer + `CREDITS.md` generator |
| `tools/research/` | Python readers used for the Omega Strikers study (output never committed) |
| `assets/` | Generated, committed sprites and portraits for the roster only |
| `docs/` | Plan, design bible, research |

## Local reference folders (not in git)

These sit next to the repo on the dev machine and are git-ignored:

- `OmegaStrikers/`: design reference only (rules, roles, feel)
- `SpriteCollab-master/`: source of PMD sprites (CC BY-NC 4.0), imported selectively by `tools/import-sprites`
- `Pokebonk Offline-win32-x64/`: stage and art-direction inspiration only

## Disclaimer

Fan project, not affiliated with or endorsed by Nintendo, The Pokémon Company, Game Freak, Creatures Inc.,
or Odyssey Interactive. Pokémon and all related names are trademarks of their respective owners.
Sprites come from the [PMD Sprite Collab](https://sprites.pmdcollab.org/) under CC BY-NC 4.0; see `CREDITS.md` (generated).
No monetization of any kind.
