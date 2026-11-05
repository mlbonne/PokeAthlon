# M6 stage 1 — Pokémon Stadium

> Goal: our first real stage. Same rules and layout as today's Viridian Pitch, but it looks like a night match
> in Smash's Pokémon Stadium 2. That means a green field with a Poké Ball emblem on a floating stone platform,
> stands full of a cheering crowd, a big screen, a city skyline and searchlights.
> We build it the way Omega Strikers builds an arena, with the 3D techniques Pokébonk uses.

References: the user's two screenshots (OS Ahten City from the match camera; Smash Pokémon Stadium 2),
[research/os-arena-geometry.md](../research/os-arena-geometry.md) §7 (how OS builds its arena visuals),
the Pokébonk notes below. This replaces stage 1 ("Viridian Pitch") of [M6-stages.md](M6-stages.md).

## 1. What we learned

### Omega Strikers (data-mined from Ahten City)
- **An arena is about 8 meshes,** plus quality levels LOD0/1/2:
  - **Detail:** floor, decals (markings), sides (rim), corner engines + spinning blades, screens, foliage;
  - **Background:** a tiny background (a few flat painted cards);
  - **Goal pieces:** goal barriers, gates and pocket "energy walls".
- **Where the detail goes:** the rim and the 4 corners hold most of it (about 1.2 MB each). The far background is only 9.5 KB.
  That's because the match camera frames the field tightly: you only ever see a band of rim, the corners, and a strip of background at the top.
- **How it's shaded:** a shared pattern sheet and baked ambient occlusion, with unlit lightmapped variants. Mostly painted, little real-time lighting.
- **Your goal is always on your side.** The visuals rotate per team.
- **The arena is a flying platform** (jet engines in the corners). That's the same idea as Smash's floating stage.

### Pokébonk (read from the v0.8.86 build; techniques only, no files)
| Technique | How |
|---|---|
| Cel shading | Every model gets a toon material with a 3-step light ramp (`[120, 190, 255]`, nearest filter) |
| Outlines | Each mesh also draws an inside-out copy pushed out along its normals by 0.045, in dark purple `#1d1530` |
| Pixel crispness | Textures use nearest filtering; optional pixelated low-resolution rendering; particle alpha is stepped (`floor(a*24)/24`) |
| Light | No tone mapping; hemisphere sky/ground light 1.6 and one warm sun 2.2 |
| Depth | Linear fog, a gradient sky dome and 2 panorama rings |
| Volume | Repeated props are instanced; a per-instance hash varies rotation; a vertex shader adds wind sway and fades props near the player |
| Team tint | Materials recoloured on the fly (emissive + tint) |
| Quality | Dynamic resolution, optional bloom |

### Our camera
- **Framing:** pitch 55°, field of view 30°, fitted to the field with a 5 % margin. Like OS, a player sees:
  - the rim all around;
  - the 4 corners;
  - a strip beyond the far side at the top of the screen;
  - a sliver below the near side.
- **What that means:** the stands and skyline show **only in that top strip**, so they can be cheap and painted.
  The rim, corners and goal ends must look great up close.
- **Option:** widen the framing slightly (OS shows more margin) or add a pre-match fly-over to show the whole stadium (step S7).

## 2. The stadium, piece by piece

| OS piece | Pokémon Stadium version | Built how |
|---|---|---|
| Floor | Grass field with mowing stripes, slightly darker near the goals | Generated texture (pixel noise and stripes), toon material |
| Decals | White lines; centre circle with a big **red and white Poké Ball emblem**; Goal Arcs in team colours | A separate overlay layer of flat shapes, so gameplay markings always draw on top |
| Sides | A **grey stone and metal rim** with bevelled blocks, a white trim line and team-coloured light strips toward each goal. Under it, the **dark platform body with support legs**, floating over a deep pit | Built in code from extruded outlines plus instanced blocks, all derived from the stage outline. Works on any frame |
| Engines (corners) | **Floodlight towers / Poké Ball pylons** at the 4 cut corners, lamps aimed at the field | Low-poly in code, light-cone sprites, glow |
| Energy walls | Team-tinted glass pocket walls around each goal, with a goal light that flashes on a score | Transparent material, emissive flash |
| Screens | **A giant screen** above the far stands. It shows a Poké Ball when idle, then the score, the timer, "GOAL!" with the scorer's portrait, and KO pops. LED ribbon boards along the far rim | Canvas texture redrawn on match events, no render-to-texture needed |
| Foliage | Flower boxes and small trees by the goal ends | Billboards from our own generated pixel art, or skipped |
| Background | **Stands** (tiered seats with aisles and stairs), a **Pokémon crowd**, a night city skyline with lit windows, sweeping **searchlight beams**, roof light rigs, stars | Stands: downloaded low-poly seats or tiers built in code. Crowd: our PMD sprites, instanced. Skyline: boxes with generated window textures, or a painted card |
| Atmosphere | Night lighting, floodlight pools on the field, camera flashes in the crowd, confetti on goals, crowd cheer bounce | Lighting rig, particles, event hooks |

**Gameplay stays the same.** Same frame, spawns, barriers and orbs as the current stage. Like Smash's Pokémon Stadium
and OS Ahten City, it's the neutral map with no hazard. The `stage.json` gets a `theme` block that the renderer reads,
and nothing in the sim changes.

**Readability rules:** the KO edge is the rim's inner lip, and it stays highlighted. Goal Arcs, barriers, team colours,
the ball and its shadow always contrast with the grass. The crowd and background never move enough to pull your eye.

## 3. Assets

**Built in code (no download):** field, markings, Poké Ball emblem, rim, platform body, pylons, goal glass, screens,
skyline, searchlights, particles. We already have the crowd: PMD sprites from SpriteCollab (CC BY-NC, already credited).
A crowd of Pokémon in the stands, cheering with their "Happy" or "Pose" animations, fits better than human spectators.

**Candidate downloads** (each needs your OK; free, credit required, fine for a non-commercial fan game):

| Model | Author | License | Use |
|---|---|---|---|
| [Stadium](https://poly.pizza/m/FNOmnIZJLs) | Zsky | CC BY 3.0 | Reference or base for the stands' shape |
| [Stadium Seats](https://poly.pizza/m/KAHX68dbXO) | Zsky | CC BY 3.0 | Seat rows to instance |
| [Low Poly Sports Stands](https://poly.pizza/m/26j2bQ3zuUL) | Cole Brenner | CC BY 3.0 | Simpler stand section |
| [Kenney kits](https://www.kenney.nl/assets) (city, racing) | Kenney | CC0 | Skyline buildings or light posts, if building them in code looks worse ⚠ contents not checked yet |

Downloaded models would be restyled with our toon material and outline, so they match the rest of the scene.

**Not used:** ripped Smash models (Nintendo's files), OS meshes or textures, Pokébonk files.

## 4. Steps

| Step | What | Done when |
|---|---|---|
| **S1 Render foundation** | Read a `theme` block from `stage.json`. Add a toon material helper with an outline pass, quality levels (low/med/high, like OS LOD0–2), a night light rig, a sky dome and fog per theme | The current arena renders through it unchanged; the frame rate is the same on low |
| **S2 The platform** | Grass field, overlay markings + Poké Ball emblem, stone rim, platform body with supports over a pit, goal pocket glass. All of it built from the stage outline | Screenshot from the match camera looks like the Smash platform; KO edge, Goal Arcs and barriers are as readable as now |
| **S3 Corners** | 4 floodlight pylons; light cones and floodlight pools on the field; team light strips on the rim | Corners read like OS's engines, but Pokémon Stadium-themed |
| **S4 Stands + crowd** | Stand sections around the field (code-built, or downloaded after your OK), an instanced PMD crowd that reacts to goals and KOs | The top strip shows full stands; the crowd costs ≤ 1 draw call per species sheet |
| **S5 Screens** | Big screen (idle Poké Ball, score, timer, GOAL + scorer portrait) and LED ribbons, redrawn on match events | Screen matches the HUD score at all times |
| **S6 Skyline + sky** | City skyline with lit windows, searchlight beams, stars, a light haze | Top strip looks like the Smash night city |
| **S7 Show** | Confetti and camera flashes on goals, crowd cheers; a pre-match fly-over of the whole stadium (skippable), then it settles into the match camera | Fly-over plays during kickoff without delaying it |
| **S8 Polish + check** | Visual rotation so your goal is on your side (OS rule); frame time on low; colour-blind check of team colours; credits for any downloaded models | All tests pass; you playtest it |

**Later idea:** Smash's Pokémon Stadium transforms into Fire, Water, Grass and Rock (Stadium 2: Electric, Ground, Ice,
Flying). The other M6 stages (Cinnabar, Crystal Hollow, Ilex, Ecruteak) could be "transformations" of this stadium,
reusing the rim, stands and screen with a different field and gimmick.

## 5. Questions for you
1. **Name:** "Pokémon Stadium", or our own (for example "Indigo Stadium")?
2. **Downloads:** OK to fetch the 3 CC BY seat/stand models above, or build the stands in code only?
3. **Time of day:** night like Smash's Stadium 2, or day like Stadium 1?
4. **Camera:** keep today's tight framing (gameplay first), or show a little more stadium around the field?
