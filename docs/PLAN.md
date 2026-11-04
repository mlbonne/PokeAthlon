# PokéAthlon — Project Plan

> Working title. A free, non-commercial fan game: 3v3 Pokémon "strike-ball" — part soccer,
> part air hockey, part sumo — inspired by the *feel* of Omega Strikers.

Status: **Draft v0.1** · Lead programmer: Claude · Owner: CHIAKI

---

## 1. Vision & pillars

**One-line pitch:** Pick a Pokémon, pick a role, and with two teammates knock the ball through the
enemy's barrier and into their goal. Knock the other team off the arena while you're at it.

| Pillar | What it means in practice |
|---|---|
| **Readable chaos** | Top-down camera, big telegraphs, and clear hit-flash, knockback and stagger feedback. You should always know why you got knocked out. |
| **Every Pokémon has a job** | Each roster entry leans into one role: Striker, Passer, Goalie or Brawler. Kits are small (3 moves + special) and different from each other. |
| **Data-driven balance** | Every number (speed, knockback, cooldowns, stagger HP, ball mass) lives in JSON data files, not in code. Balance passes are edits to data, not code changes. |
| **Fair online from day 1** | The simulation is deterministic and runs at a fixed tick, separate from rendering, so online play can be added without a rewrite. |

## 2. Reference sources & how we use them

| Folder / source | Use | Do **not** |
|---|---|---|
| `OmegaStrikers/` (Unreal install, 5.4 GB `.pak`) | Play it to study role design, move archetypes, pacing, arena layouts and match rules. Write down the numbers we observe in `docs/research/`. | Extract or ship any of its assets, audio, code or names. |
| `SpriteCollab-master/` (PMD sprites, **CC BY-NC 4.0**) | Our character art: `AnimData.xml` and sprite sheets per animation, plus portraits. An import script copies only the roster we use into `assets/`. | Use it commercially. Credits are mandatory (generated from each `credits.txt`). |
| `Pokebonk Offline-win32-x64/` (Three.js web game) | Art direction for stages: 12 biomes (forest, coast, desert, volcano, glacier, frostlake, graveyard, ruins, sanctum, stormcape, tower), the look of billboarded PMD sprites in a 3D scene, and hazard ideas. | Copy its atlases, models or code. Its own legal page says it isn't distributed as a download. We make our own takes on the themes. |
| ranked.pokemonbattlegrounds.com | Reference for the feel of real-time Pokémon brawling (skillshots, knockback, PMD sprites). Gameplay is behind a sign-in, so we study it by playing. | — |

All three reference folders are **git-ignored**. They stay local reference material and never enter the repo.

## 3. Core game rules (v1 target, all values tunable)

**Format:** 3v3. Every player is a Pokémon. Each team has a goal at one end of the arena.

**The ball** (our "core"): a physics puck. Pokémon move it by hitting it with their basic **Strike** or with moves.
Each hit adds speed. Rally speed slowly decays, so long passing chains get faster and more dangerous.

**Goal barrier and target** (the twist we're keeping):
1. Each goal is closed off by a **barrier**.
2. In front of each goal there's a **target** (e.g. a glowing Poké-totem).
   When the ball hits the enemy target, their barrier **drops for N seconds** (start at 6s).
3. While the barrier is down, a ball that crosses the goal line scores. Otherwise the ball bounces off.
4. After a goal, both barriers reset and there's a kickoff from centre.

**Knockback, stagger and KO (the sumo part):**
- Each Pokémon has **Stagger HP**. Hits reduce it. At 0 the Pokémon is **Staggered**: it takes extra knockback and can't use moves for a short time.
- Arena edges are a mix of **walls** (the ball and players bounce) and **KO zones** (open edges).
  Getting knocked past a KO edge = **KO**: you respawn after a few seconds and your team plays a player short.
- KOs don't score points directly. They open space to score.

**Match:** first to **5 goals** wins a set, best of 3 sets. Short break between sets to swap held items. (Tunable.)

**Universal actions every Pokémon has:**
| Input | Action |
|---|---|
| Move | Analog movement |
| Strike (LMB / RT) | Short-range hit on the ball or on enemies, short cooldown |
| Dash / Evade (Space / A) | Short burst with brief i-frames, medium cooldown |
| Move 1 / Move 2 (Q, E) | Pokémon-specific abilities |
| Special (R) | Pokémon-specific ultimate, charges over time and through play |

## 4. Roles

| Role | Job | Typical tools |
|---|---|---|
| **Striker** (forward) | Hits the target and finishes goals | Ball redirects, speed boosts, long-range ball hits |
| **Passer** (midfield) | Sets up shots, controls tempo | Pulls, ball lobs, team buffs, zone control |
| **Goalie** | Protects the target and goal | Walls, wide hitboxes, high mass, self-shields |
| **Brawler** | Wins fights and gets KOs | High knockback, gap-closers, stagger damage |

Pokémon get a **primary role** and can be flexed through held items.

## 5. Starting roster (8). Sprite sets verified in SpriteCollab

All of these have Walk, Idle, Attack, Hurt, Charge and Swing animations, plus Shoot or Strike.

| # | Pokémon | Role | Kit sketch (Move 1 / Move 2 / Special) |
|---|---|---|---|
| 0025 | **Pikachu** | Striker | Quick Attack (dash that hits the ball) / Thunder Shock (skillshot, short stun) / Volt Tackle (long piercing charge) |
| 0658 | **Greninja** | Striker | Water Shuriken (3 small ball nudges) / Shadow Sneak (blink behind target) / Hydro Cannon |
| 0065 | **Alakazam** | Passer | Psychic (grab and redirect the ball) / Teleport (swap places with an ally) / Future Sight (delayed AoE) |
| 0468 | **Togekiss** | Passer | Air Slash (lob pass) / Follow Me (pulls enemies' aggro) / Wish (team shield) |
| 0143 | **Snorlax** | Goalie | Block (wall segment) / Body Slam (AoE knockback) / Rest (heals stagger, becomes immovable) |
| 0009 | **Blastoise** | Goalie | Withdraw (shell shield) / Rapid Spin (spin that deflects) / Hydro Pump (pushback beam) |
| 0448 | **Lucario** | Brawler | Aura Sphere (homing knockback) / Close Combat (combo) / Extreme Speed |
| 0068 | **Machamp** | Brawler | Cross Chop / Seismic Toss (grab and throw) / Dynamic Punch (big knockback, confuse) |

Backups with full sprite sets: Gengar, Garchomp, Dragonite, Gardevoir, Charizard, Blaziken, Gyarados, Politoed, Sylveon, Raichu.

**Held items (our "gear and awakenings"):** players pick 1 held item before the match and 1 more per set.
Examples: *Choice Scarf* (+speed, −stagger HP), *Muscle Band* (+knockback), *Focus Sash* (one stagger saved per round),
*Quick Claw* (−dash cooldown), *Expert Belt* (+ball hit power).

**Types (stretch):** a light type layer. Ally moves that combo (Water then Electric = "Soaked + Shocked")
apply short status effects. No full damage chart: keeps it readable.

## 6. Stages (themes inspired by Pokébonk's biomes, our own art)

| Stage | Layout idea | Hazard |
|---|---|---|
| **Viridian Pitch** (forest) | Standard, symmetric, walls on the long sides | None (training/ranked map) |
| **Magma Ring** (volcano) | KO zones on the long sides | Lava vents push players |
| **Frostlake Rink** (frostlake/glacier) | Low-friction ice | Players and ball slide further |
| **Stormcape Cliffs** (stormcape) | Narrow, side KO gaps | Periodic gusts push sideways |
| **Ruins Arena** (ruins/sanctum) | Pillars in midfield | Breakable pillars |

## 7. Technology

**Recommendation: a web stack**, the same family as Pokébonk and PB Ranked:

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) | Type safety, one language for client and server |
| Build | **Vite** | Fast dev server and builds |
| Rendering | **Three.js** | Tilted top-down 3D arena with billboarded PMD sprites, the look Pokébonk proves works |
| Simulation | **Custom 2D fixed-step physics** (circles and segments, 60 Hz, seeded RNG) | Small, deterministic, fully under our control. Gameplay is 2D even if the view is 3D |
| Netcode (M7) | **Authoritative Node server over WebSocket** with client prediction. Rollback considered later | The same sim code runs in browser and server |
| Tests | **Vitest** | Unit tests for physics, rules and data validation; golden replays for determinism |
| Data | JSON + **Zod** schemas | Pokémon, moves, items, stages; validated at load and in CI |
| Packaging (optional) | Browser first, desktop wrapper (Tauri/Electron) later | |

**Architecture (packages in one repo):**

```
/packages
  /sim        pure deterministic game logic: physics, rules, moves, AI. No DOM, no Three
  /client     Three.js renderer, input, UI, audio; reads sim state and interpolates
  /server     (M7) authoritative match server reusing /sim
  /data       pokemon/*.json, moves/*.json, items.json, stages/*.json and their schemas
/tools
  import-sprites.ts   copies the chosen roster from SpriteCollab into /assets, builds atlases and CREDITS
/assets       generated, committed: only the roster's sprites and portraits
/docs         plan, design notes, research, balance log
```

The key rule: **`/sim` never imports anything from `/client`.** The sim takes inputs per tick and
returns state. That's what makes bots, replays, tests and online play possible.

## 8. Milestones

Each milestone ends in something you can play, a git tag, and a short changelog.

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Foundation** | Repo, TS/Vite/Vitest/ESLint, CI, sprite import tool, credits generation. One Pikachu walking with the Walk/Idle animations |
| **M1** | **Sandbox** | Arena with walls, ball physics, Strike and Dash, camera, hit feedback. Hit the ball around solo |
| **M2** | **Rules** | Targets, barriers, goals, KO zones, stagger, respawn, score, sets. A full match is possible (1v1 local) |
| **M3** | **Kits** | Data-driven move system (hitboxes, projectiles, dashes, status, cooldowns). First 4 Pokémon (one per role) |
| **M4** | **Bots and 3v3** | Role-aware AI (striker chases, goalie guards). 3v3 against bots, gamepad support |
| **M5** | **Meta** | Draft/pick screen, held items, all 8 Pokémon, match results screen |
| **M6** | **Stages** | 3–5 arenas with hazards, biome art pass |
| **M7** | **Online** | Lobby, server-authoritative matches, prediction and interpolation, private rooms |
| **M8** | **Polish and balance** | Audio, VFX, tutorial, balance pass from match telemetry, release build |

Short term: **M0–M2 is the vertical slice**: proof that the core loop is fun before content gets built.

## 9. Git workflow

- `main` is always playable. Feature work happens on `feat/<topic>` branches and merges to `main` when a step works.
- **Conventional Commits**: `feat(sim): ball-wall restitution`, `fix(client): sprite flip`, `data(pikachu): lower QA cooldown`, `docs: …`.
  Balance changes use the `data` type so they're easy to find in the history.
- Small, frequent commits. Every commit builds and passes tests (enforced in CI once M0 lands).
- Tags per milestone: `v0.1.0-m0`, `v0.2.0-m1`, …
- Big binaries (generated atlases, audio) go through **Git LFS** once they show up. The reference folders are never committed.
- Remote: GitHub (private to start). Set up when you're ready.

## 10. Legal and attribution

- **Non-commercial**, no monetization of any kind. Required by the SpriteCollab CC BY-NC license and good practice for a fan game.
- Disclaimer in game and in the README: not affiliated with Nintendo, The Pokémon Company, Game Freak, Creatures, or Odyssey Interactive.
- `CREDITS.md` is generated from SpriteCollab `credits.txt` files for every sprite we ship.
- No assets from Omega Strikers or Pokébonk are used. We use them as references only.
- Use an original name and logo; avoid the Omega Strikers name and branding.

## 11. Open questions

1. Tech stack sign-off: the web/Three.js stack above, or an engine like Godot?
2. Single-player vs bots first, or local couch multiplayer too (shared screen, several gamepads)?
3. Art direction for arenas: low-poly 3D (Pokébonk-like) or a flat 2D pixel-art floor?
4. Final project name (PokéAthlon is also the name of a minigame series in HG/SS).
