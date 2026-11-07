# PokéAthlon — Project Plan

> Working title. A free, non-commercial fan game: 3v3 Pokémon "strike-ball" — part soccer,
> part air hockey, part sumo — inspired by the *feel* of Omega Strikers.

Status: **Draft v0.2** (rules revised after OS research) · Lead programmer: Claude · Owner: CHIAKI

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

> Revised after the Omega Strikers study. See [research/omega-strikers.md](research/omega-strikers.md) for the source numbers.

**Format:** 3v3. Every player is a Pokémon. Each team defends a goal on one short side of a rectangular arena with cut corners.

**The ball** (our "core"): a heavy physics puck. Pokémon move it with **Strike** or with moves.
Every hit has its own *ball knockback* value. The ball slows down through friction and bounces off every edge.

**Barriers → gate → goal:**
1. Each goal is protected by **1–3 barriers** (set per stage). **The barriers are the targets.**
   When the ball touches a barrier, the barrier breaks and stays broken for the rest of the round.
2. Shortly after a team's last barrier breaks (~1 s), their **Goal Gate opens**.
3. With the gate open, the ball crossing the goal line scores. A goal ends the **round**: barriers, Stagger and
   positions reset, then kickoff.

**Knockback, Stagger and KO (the sumo part):**
- Each Pokémon has **Stagger** (a health pool). Hits reduce it. At 0 the Pokémon is **Staggered**: +254.5 % knockback taken,
  −75 % damage taken. It ends when Stagger refills to 50 % (fast regen while Staggered). Passive regen 4 %/s after ~2.4 s without being hit.
- **Every arena edge is a KO edge for players** (the ball bounces). Knocked out = removed for ~5 s, then a respawn
  with brief immunity. KOs don't score. They create power plays.
- **Goal Arc:** standing in your own arc gives knockback resistance and shorter debuffs. It's the goalie's home.
- **Power Orbs:** 3 spawn points (midfield and each arc). First at 10 s, then every 20 s. They give Stagger, XP and Energy.

**Match flow:** round (one goal) → **set** (first to **3 goals**) → **match** (first to **2 sets**). Overtime after 60 s
in a round: ball knockback +20 %. Between sets: Boost draft (see §5). All tunable.

**In-match levels 1–10:** XP from ball hits, saves, orbs, KOs, goals and assists. Each level adds max Stagger. **The Special unlocks at level 2.**

**Stats per Pokémon:** Power (scales all hits), Speed (soft caps at 750/900), Stagger (+ growth per level),
Cooldown Rate (`cd × 100/(100+CDR)`), Size (hurtbox and melee reach).
Every hit has 3 values: `ballKB`, `playerKB`, `damage`, each `base + ratio × Power`.

**Actions every Pokémon has:**
| Input | Action |
|---|---|
| Move | Analog movement |
| Strike (LMB / RT) | Shared melee hit on the ball and enemies, **~0.9 s cooldown**. The main way to touch the ball |
| Move 1, Primary (Q) | Pokémon-specific, ~10–12 s cooldown |
| Move 2, Secondary (E) | Pokémon-specific, usually mobility, ~18–20 s cooldown |
| Special (R) | Pokémon-specific, ~25–40 s cooldown, unlocks at level 2 |
| Evade (Space / A) | Costs 1 Energy bar: 1.5 s untouchable. At 3 bars it becomes **Energy Burst**: push nearby enemies away, briefly control the ball, next ball hit +50 % |

**Energy:** 3 bars (75). Start each set and each respawn with 25. +1 per light hit (Strike), +3 per normal hit, +7.5 per orb.

## 4. Roles

**Team slots** (chosen at select, they decide which held items you can pick): **2 Forwards + 1 Goalie**.

Each Pokémon also has an **archetype** that describes how it plays. Any archetype can fill either slot, but some fit one better:
| Archetype | Job | Typical tools | Usual slot |
|---|---|---|---|
| **Striker** | Breaks barriers, finishes goals | Ball redirects, speed boosts, long-range ball hits | Forward |
| **Passer / Controller** | Sets up shots, controls space | Pulls, teleports, buffs, creations | Either |
| **Wall** | Protects barriers and goal | Walls, wide hitboxes, big size, shields | Goalie |
| **Brawler** | Wins fights, gets KOs | High knockback, gap-closers, Stagger damage | Forward |

## 5. Roster (9 now). Sprite sets verified in SpriteCollab

All of these have Walk, Idle, Attack, Hurt, Charge and Swing animations, plus Shoot or Strike.

| # | Pokémon | Archetype | Kit sketch (Move 1 / Move 2 / Special) |
|---|---|---|---|
| 0807 | **Zeraora** | Striker (OS Kai) | Discharge (4 light bolts) / Agility (haste) / Wild Charge (long piercing charge). Took over Pikachu's kit (2026-11-06) |
| 0658 | **Greninja** | Striker | Water Shuriken (3 small ball nudges) / Shadow Sneak (blink behind target) / Hydro Cannon |
| 0720 | **Hoopa** | Passer | Psychic (grab and redirect the ball) / Hyperspace Hole (portal shot; Hoopa comes out where it stops with a burst, evade to dodge it) / Future Sight (delayed AoE that locks onto an enemy and follows them; Evade dodges it). Replaced Alakazam (2026-11-06) |
| 0437 | **Bronzong** | Wall | Gyro Ball (slowing roll) / Heavy Slam (leap, AoE stun) / Light Screen (arc of walls). Took over Snorlax's kit (2026-11-06) |
| 0009 | **Blastoise** | Support (OS Atlas) | Surf (decelerating wave that passes through enemies) / Whirlpool (ring that bursts, then swirls in) / Aqua Ring (healing zone that pulls any ally about to be KO'd into it). Reworked 2026-11-06 |
| 0059/0001 | **Hisuian Arcanine** | Wall (OS Asher) | Rock Slide (blast + rock wall, stronger on your half) / Flare Blitz (guarded charge) / Flamethrower (channelled push). Blastoise's old kit, added 2026-11-06 |
| 0448 | **Lucario** | Brawler | Aura Sphere (homing knockback) / Close Combat (combo) / Extreme Speed |
| 0025 | **Pikachu** | Striker (OS Octavia) | Electroweb (piercing wave: full hit + 35 % slow on the first enemy, LIGHT hits on the rest) / Charge (+33 % speed, any hit resets it) / Thunder (1 s wind-up, then 5 pulses around Pikachu as it moves). Added 2026-11-07 |
| 0068 | **Machamp** | Brawler | Cross Chop / Seismic Toss (grab and throw) / Dynamic Punch (big knockback, confuse) |

Togekiss was removed on 2026-11-06 (its kit is in git history: `packages/data/kits/togekiss.json` before that date).

Snorlax is out for now. Hisuian Arcanine (Asher) and Blastoise (Atlas) shipped on 2026-11-06, Pikachu (Octavia) on 2026-11-07.

**Planned roster** (each modelled on one OS striker; see GAME_BREAKDOWN §5 for the OS kits). All have sprite sets in SpriteCollab; the regional and Mega forms are form folders (Alolan Ninetales `0038/0001`, Hisuian Decidueye `0724/0001`, Mega Mewtwo Y `0150/0002`), `import-sprites` supports them (roster `dex` like `0059/0001`).

| Pokémon | OS model | Notes |
|---|---|---|
| Alolan Ninetales | Estelle (Tempo Sniper) | |
| Inteleon | Drek'ar (Nimble Blaster) | |
| Goodra | Juno (Clever Summoner) | |
| Hisuian Decidueye | Rasmus (Whip Fighter) | |
| Porygon-Z | Ai.Mi (Magical Playmaker) | |
| Mega Mewtwo Y | Era (Empowering Enchanter) | |
| Dragapult | Luna (Chaotic Rocketeer) | |
| Meloetta | Finii (Gravity Mage) | |

Backups with full sprite sets: Gengar, Garchomp, Dragonite, Gardevoir, Charizard, Blaziken, Gyarados, Politoed, Sylveon, Raichu.

**Loadout, two layers:**
- **Held Item** (like OS Gear): pick 1 at select. **Locked to your slot.** Goalie items stop working on the enemy half.
  Forward ideas: *Choice Scarf* (speed after ball hits), *Muscle Band* (+knockback), *Shell Bell* (heal from damage dealt).
  Goalie ideas: *Rocky Helmet* (+size, damage reduction), *Eject Pack* (blink back after your secondary), *Quick Claw* (speed builds over time, lost when hit).
- **Boosts** (like OS Awakenings): 2 random ones shown to everyone at select, and each player takes one. After each set,
  there's a shared pool of 8 drafted one at a time, with pick order set by XP that set. Examples: *Bulk Up* (+Stagger),
  *Agility* (+dash range), *Sniper* (+hit power at long range), *Helping Hand* (passes to allies hit harder),
  *Sturdy* (the first KO each set is prevented).

**Types (stretch):** a light type layer. Ally moves that combo (Water then Electric = "Soaked + Shocked")
apply short status effects. No full damage chart: keeps it readable.

## 6. Stages (themes inspired by Pokébonk's biomes, our own art)

> Superseded by [design/M6-stages.md](design/M6-stages.md) (2026-11-05). The table below is the original idea.

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
| Netcode (M7) | **Rollback over a small Node WebSocket relay** (proposed in [M7-online.md](design/M7-online.md); originally server-authoritative) | The same deterministic sim runs on every player's machine; only inputs travel |
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
| **M0** ✅ | **Foundation** | Repo, TS/Vite/Vitest/ESLint, CI, sprite import tool, credits generation. One Pikachu walking with the Walk/Idle animations |
| **M1** ✅ | **Sandbox** | Arena walls, ball physics (friction, bounces, body blocking, hitstop), Strike with aim + cooldown, camera, hit feedback. Hit the ball around solo. (Evade moved to M2 with Energy, matching OS) |
| **M2** ✅ | **Rules** | **First: OS arena + sizes** ([research](research/os-arena-geometry.md)): stage JSON split into shared frame + per-map terrain; field ±1360.5 × ±910 with OS corner cuts, goal pocket (posts, gates, score line 150 behind the mouth, back wall), side KO strips + pocket KO, walls that block walking; Core r47.5, bodies 46/60/65, hurtboxes 55/70/75, Core spawns at (0, ±600), OS start positions; re-tune camera and sprite scale. **Then:** barriers, gates, goals, Goal Arc, Stagger, Energy (Evade/Burst), orbs, levels, rounds and sets. A full match is possible (1v1 local) |
| **M3** ✅ | **Kits** | Data-driven move system (hitboxes, projectiles, dashes, status, cooldowns). First 4 Pokémon (one per role) |
| **M4** ✅ | **The 3v3 Patch** ([plan](design/M4-3v3-patch.md)) | Smart kit-agnostic CPUs (prediction, team jobs, utility AI, difficulty), balance toolkit (telemetry, kit analyzer, F3 debug meter, headless batch sim, impact score), playable 3v3 with gamepad |
| **M5** ✅ | **Meta** ([plan](design/M5-meta.md)) | All 8 Pokémon (move-system extensions + 4 new kits), held items, drafted boosts, OS-style pick screen with CPU drafting, between-set draft, results screen with per-role MVP and accolades |
| **M6** | **Stages** | 5 arenas, each with one OS map gimmick (Speed Gate, gravity well, chasm, portals, speed strips) and a biome art pass based on Pokébonk v0.9.8's new areas. [Plan](design/M6-stages.md). **Status (2026-11-06):** stage 1 Pokémon Stadium ✅; the other stages are on hold by your call. **Planned: a stage editor** so you can build your own stages ([M6-stages.md](design/M6-stages.md#stage-editor-planned)) |
| **M7** | **Online** ([plan](design/M7-online.md)) | Private 3v3 rooms with codes, bots fill empty seats; rollback netcode over a small input-relay server (replaces the earlier server-authoritative idea, see the plan §2). **Status (2026-11-06):** 7.0–7.4 done (rooms, rollback, server, drop/rejoin); hosting (7.5) and a playtest with friends left |
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
