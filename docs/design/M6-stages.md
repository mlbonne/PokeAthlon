# M6 — Stages

> Goal: 5 arenas that each play differently, the way OS maps do, with a biome look based on the new Pokébonk v0.9.8 areas.
> Each stage is the shared frame plus a terrain with **one clear gimmick** taken from a real OS map.
> All art is ours: Pokébonk is a reference for mood and palette only.

Design sources: [research/omega-strikers.md](../research/omega-strikers.md) §3 (map gimmicks),
[research/os-arena-geometry.md](../research/os-arena-geometry.md) (frame + terrain, spawns and barriers per map),
PLAN.md §6. Art reference: `Pokebonk-0.9.8-assets/` (git-ignored, fetched 2026-11-05 from pokebonk.com).

## Reference: what's new in Pokébonk v0.9.8

The official app 1.4.0 (`Pokebonk-1.4.0-portable/`) is only a launcher for pokebonk.com and holds no game files.
So the new areas were fetched straight from the site: 66 files, 10.4 MB (atlas, ground, path, cliff, 2 panorama
layers per area, wilds terrain tiles, 25 new props). The old offline build (`Pokebonk Offline-win32-x64/`) is v0.8.86.

| Area (their id) | Mood | Panorama | Props (atlas + 3D) | Gameplay in Pokébonk |
|---|---|---|---|---|
| **wilds** | Open countryside that blends tiles: meadow, highland, alpine, snow, cliff, shore | Snowy blue mountain range | ~80 sprites: oaks, pines, cherry, willow, birch, flowers, mossy arches, campfire, tent, signpost, snowy pines, ice crystals | Big blended open world |
| **canela** | Volcanic tropical island | Island chain on the sea, two volcanoes | Palms, lava-veined rocks, basalt, sulfur vents, red flowers, shells. 3D: `canela_spring`, `canela_vent`, `canela_basalt`, `canela_lavarock` | Hot springs and vents; a scheduled **eruption** event |
| **cave** | Crystal cavern, blue and violet glow | Stalactites, glowing crystal clusters | Crystal spires, stalagmites, glowing mushrooms, bones. 3D: `cave_lightcrystal`, `cave_crystal`, `cave_stalagmite`, `cave_column`, `cave_boulder` | Light crystals in the dark |
| **encina** | Ancient misty forest (Ilex-like) | Giant trunks, hanging vines, fog | Mossy oaks, willows, stone lantern, mushrooms, ferns. 3D: `encina_trunk`, `encina_log`, `encina_shrine`, `encina_kiln`, `ilex_gate`, `ilex_pillar`, `ilex_lamp`, `ilex_clock` | Shrine, time-themed clock and gate |
| **iris** | Autumn temple town (Ecruteak-like) | Purple mountains, pagodas, red and orange forest | Maples, ginkgo, bamboo, bonsai pine, stone lanterns, red spider lilies. 3D: `iris_shrine`, `iris_lantern`, `iris_bridge`, `iris_burned` | Shrine, lantern path, bridge, burned tower |

Also new: `exp_beacon`, `exp_vault`, `exp_crate`, `exp_crate_gold` (their expedition mode). Not relevant to us.

## Design principles

1. **A stage is data.** Frame (shared, from M2) + terrain JSON: spawns, barriers, obstacles, hazards, theme.
   Every hazard is a generic type with numbers. No stage gets its own code path, same as kits and items.
2. **One gimmick per stage, taken from a real OS map,** with numbers data-mined from the OS files (marked ⚠ until verified).
3. **Hazards ship with bot support and tool support in the same step.** Bots must avoid a KO hole, use speed pads
   and portals, and know a pull. The batch sim reports win rates and playstyle per stage.
4. **Our own art.** Ground, cliff and path textures are generated in code (pixel-art noise and palettes);
   props are our own low-poly models or billboards; panoramas are layered silhouettes drawn at runtime.
   We take mood, palette and composition from Pokébonk, never its files.
5. **Scenery never touches gameplay.** Props stand outside the KO edge or are pure decoration. Only terrain
   obstacles and hazards (from JSON) collide.
6. **Determinism.** Hazard timers and random variants come from the match seed.

## The 5 stages

> **Update (2026-11-05):** stage 1 is now **Pokémon Stadium** (Smash-style, no hazard), planned in [M6-stadium.md](M6-stadium.md). We build it first; the rest wait.

| # | Stage | Theme | OS model | Gimmick | Barriers |
|---|---|---|---|---|---|
| 1 | **Viridian Pitch** (exists) | wilds: meadow, shore edges | Night Market | Two centre walls with a **Speed Gate** between them (+100 % speed for 1.25 s, respawns after 4 s) | 2 per side (current) |
| 2 | **Cinnabar Caldera** | canela | Atlas's Lab | A central **vent (gravity well)**: slows players 10 %, pulls the Core. A ball hit on its centre makes it **erupt** (600 damage, 700 knockback), then it returns after 20 s | 2 spheres per side |
| 3 | **Crystal Hollow** | cave | Ai.Mi's App | A central **chasm**: a KO zone for players, the Core bounces off its rim. Crystal columns frame it | 1 big barrier per side |
| 4 | **Ilex Grove** | encina | Gates of Obscura | Paired **shrine gates (portals)** that teleport players and the Core | 2 per side |
| 5 | **Ecruteak Steps** | iris | Oni Village | **Lantern paths (speed strips)** along the top and bottom edges (+30 % for 1.25 s), right next to the KO edges. Wider Goal Arc | 2 angled per side |

Snow and alpine tiles from wilds can be a cosmetic variant of Viridian Pitch. The old "Frostlake Rink" (ice)
idea is dropped: no OS map has low friction, and it would change every kit's numbers.
Taiko Temple's drums and Clarion's random variants are left for later.

## Steps

### 6.0 Research: OS hazards and terrains
Data-mine with FModel from `Terrain_*` blueprints and the `CompetitiveTerrains/Map*.umap` files.
For Night Market, Atlas's Lab, Ai.Mi's App, Gates of Obscura and Oni Village, get the numbers below.
- **Hazards:** Speed Gate (boost, duration, respawn, size), gravity well (radius, pull strength on the Core,
  player slow, explode trigger, damage and knockback, respawn), central hole (shape and size, Core bounce),
  portals (positions, size, exit speed, cooldown, whether the Core keeps its velocity), speed strips (rects, boost, duration).
- **Per map:** spawns, Core spawns, orbs and barriers.
- **Where it goes:** add everything to `research/os-arena-geometry.md` with ⚠ on anything unconfirmed.

**Done when:** every number in the stage table has a source or a ⚠.

### 6.1 Terrain schema and stage loading
- **Schema:** extend the terrain schema (Zod) with:
  - `obstacles`: walls, columns and spheres, which block both players and the Core;
  - `hazards`: a typed list;
  - `theme`: biome id, palette, ground tiles, props, panorama layers, fog, light;
  - `goalArc` scale.
- **Hazard types:** `speedPad` (rect or circle, speed %, duration, respawn), `gravityWell` (radius, pull, slow, `erupt` hit),
  `koZone` (polygon, ball bounces off it), `portalPair` (a, b, radius, cooldown), `speedStrip`.
- **Collision:** the sim builds obstacle and hazard colliders from the JSON; `koZone` joins the KO check.
- **Done when:** all 5 terrain files validate, the frame and terrain load per stage id, and the hash covers hazard state.

### 6.2 Hazards in the sim
- **One generic step per hazard type,** with events for each (`speedPad`, `erupt`, `teleport`).
- **Tests:** a unit test per type.
- **Analyzer:** the existing analyzer is unaffected; the batch sim gets `--stage <id>` and a per-stage report.

### 6.3 Bots understand stages
Bots learn each hazard through the shared brain, not per stage:
- **koZone:** joins the KO-danger model (knock enemies into it, avoid it when hurt).
- **speedPad and speedStrip:** used when chasing or rotating.
- **gravityWell:** shooting through the pull; erupting it when enemies stand near.
- **portalPair:** as a path option for the Core and for rotations.

**Measure:** playstyle per stage (KOs, contested touches, goal time) against Viridian Pitch.

### 6.4 Biome renderer (our art)
Replace the flat green floor with a themed scene built from `theme`:
- **Floor:** generated pixel-art ground tiles with a path band and cliff-edge sides on the slab.
- **Scenery:** a scenery ring of props outside the KO edge (billboards plus simple low-poly props).
- **Background:** 2 parallax panorama layers drawn as silhouettes.
- **Atmosphere:** fog colour, light, and ambient particles (pollen, embers, crystal motes, falling leaves, mist).

Keep readability first: field markings, the KO edge, Goal Arcs and team colours stay on top.
Check the frame time on a low-end setting.

### 6.5–6.8 One stage per step
Each step makes one stage: terrain JSON, theme, its hazard's visuals and telegraphs, sounds as placeholders, bot check, and a balance run.
- **6.5** Cinnabar Caldera
- **6.6** Crystal Hollow
- **6.7** Ilex Grove
- **6.8** Ecruteak Steps

Viridian Pitch gets its Speed Gate and the wilds theme in 6.5's first half.

### 6.9 Stage select and per-stage balance
- **Pick screen:** a stage selector (fixed or random), the stage shown on the draft and results screens, and the stage in the replay seed.
- **Balance:** the batch sim and tiers learn per-stage win rates, so "strong on this map" shows on the pick screen, like OS.

### 6.10 Wrap-up
Final measurements per stage, a docs update, and a tag `v0.7.0-m6`.

## Open questions for you
1. Are these 5 pairings (area → OS gimmick) the ones you want? Swapping a gimmick is cheap until 6.5.
2. Stage names: keep Pokémon place names (Cinnabar, Ecruteak, Ilex) or make up our own?
3. Art: billboard pixel props (Pokébonk look) everywhere, or low-poly 3D for the bigger pieces?
