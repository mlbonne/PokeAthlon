# Move animations and effects: plan (stage 1 of 3)

Status: built, 2026-11-07 (engine, shared effects, every move). **Change from this plan, at the user's request: no bloom, no glow and no additive flashes. Effects are plain PMD sprites drawn small (`FX_SCALE` 0.6) with normal blending.**

**Stages:** 1 = visual effects (this document), 2 = sound effects, 3 = music.

## 1. How Omega Strikers shows its moves

These findings come from the game's own files (`base-game-assets.pak`, read with `tools/research/pak.py`).

### Bloom: yes, but only on higher settings

- `DefaultEngine.ini` has `r.DefaultFeature.Bloom=False`. Bloom is off unless a post-process volume or the quality level turns it on.
- `DefaultScalability.ini` ties bloom to the post-processing quality:

  | Post-processing quality | Bloom |
  |---|---|
  | Low | off |
  | Medium | off |
  | High | `r.BloomQuality=1` |
  | Epic | `r.BloomQuality=4` |

- Motion blur, ambient occlusion, lens flares and auto-exposure are off at every level.
- The look is flat, bright and readable. The glow mostly comes from bright, glowing materials ("Glow" appears in about 216 effect asset names); bloom is a bonus on strong PCs.

### Particles: yes, everywhere

- There are about 1,900 Niagara (Unreal's particle system) assets.
- Every striker has its own set of particle systems for each move, split into stages. Dubu (our Bronzong's model), for example:
  - `NS_VFX_StalwartProtector_Flay_Cast`
  - `NS_VFX_StalwartProtector_Flay`
  - `NS_VFX_StalwartProtector_HitFlay`
  - `NS_VFX_StalwartProtector_WallProjectile`
  - `NS_VFX_StalwartProtector_WallGroundSmash`
  - `NS_VFX_StalwartProtector_CrackBlossom`
- So the pattern is **cast → body or travel → hit → ground mark**.
- How often each building block appears in effect asset names:

  | Building block | Assets |
  |---|---|
  | Rings | ~560 |
  | Trails | ~300 |
  | Glows | ~216 |
  | Ground decals (cracks, craters) | ~85 |
  | Smoke | ~75 |
  | Sparks | ~37 |
  | Ribbons | ~24 |
  | Lightning | ~12 |

- Shared **status effects** (`NS_GC_*`) sit on top of any striker: Stun, Slow, Burn, Heal, Drain, PowerBuff, SpeedBuffGreen, TeamHaste, SizeBuffBlue, MaxStaggerBuffBlue, Spawn_Invulnerable and others. Ours need the same layer.

### What we copy

1. Every move gets a **cast**, a **body** (projectile, dash trail or lingering zone), a **hit** and, where it fits, a **ground mark**.
2. One shared set of status effects (stun, slow, speed up, power up, size up, heal, guard, invulnerable, KO) that any move can trigger.
3. A bloom pass that is **off on Low and on on High**, as in OS. It only makes effects glow; the pixel-art Pokémon and the pitch must not bloom.
4. No motion blur or ambient occlusion, as in OS.

## 2. Asset sources

| Source | What it has | Use |
|---|---|---|
| [hexparrot/pokemon-assets](https://github.com/hexparrot/pokemon-assets) (MIT code; Pokémon art is Nintendo's) | Menu icons, item icons, fonts, **game sound effects and event music**, data JSON. **No move animations.** | Stage 2 (sound effects) and stage 3 (music) |
| [PokeAPI/pokeapi](https://github.com/PokeAPI/pokeapi) (BSD-3) | Data only. It links to [PokeAPI/sprites](https://github.com/PokeAPI/sprites) and [PokeAPI/cries](https://github.com/PokeAPI/cries). **No move animations.** | Stage 2: each Pokémon's cry |
| **[PMDCollab/RawAsset](https://github.com/PMDCollab/RawAsset) → `Particle/`, `Beam/`, `BG/`** | **667 move-effect sprite sheets from Pokémon Mystery Dungeon** (Explorers, plus Gen 3 "RSE" and Ranger sets), many named after the exact move. Same 16-bit style as the PMD Sprite Collab sprites we already use. | **Stage 1: the main source** |
| [smogon/pokemon-showdown-client `fx/`](https://github.com/smogon/pokemon-showdown-client/tree/master/play.pokemonshowdown.com/fx) | Single still effect images (fireball, electroball, lightning, leaf…) that are moved and faded in code | Fallback only |
| Pokémon Essentials animation packs ([Gen 3 pack](https://eeveeexpo.com/resources/1669)) | Battle animations in RPG Maker format | Not needed. They're hard to reuse and in a different style |

**PMDCollab** is the same group behind the sprites we use. Its effects are what PMD: Origins uses.
- The PMD: Origins software licence allows copying and redistribution, with credits to keep.
- The effect art itself is ripped from the Mystery Dungeon games, the same status as our Pokémon sprites. That means non-commercial use, credited in CREDITS.md, and asking before the repo goes public, as with Pokébonk.

**Sheet format** (from RogueEssence `DirSheet.Import`): the file name ends in the layout.

| Suffix | Layout |
|---|---|
| `.None` | One row of square frames; frame size = image height |
| `.Dir8` / `.Dir5` / `.Dir2` | 8, 5 or 2 rows, one per facing direction (5 and 2 mirror the rest) |
| `.Dir1` | One row that the game rotates to any angle |
| `.Flip` | One row, mirrored for facing left |
| `.79` (any number) | A single row of exactly that many frames |

The `Beam/*` folders hold beam pieces (Head, Body, Tail) plus a small `BeamData.xml`.

## 3. How we draw them (client only; the simulation is unchanged)

- **`FxSprite`**
  - Loads a sheet, works out its layout from the file name, and plays it at a set speed (in game ticks per frame).
  - Can stand up facing the camera or lie flat on the ground, and can be turned to the aim direction.
  - Uses normal or additive blending, an optional tint, and pixelated scaling (one sprite pixel = the same `PIXEL` size as the Pokémon).
  - Plays once or loops.
  - Pooled, with a cap of about 200 live effects.
- **Data file `packages/data/fx/moves.json`**, keyed by move id: one list of layers per phase.
  - Phases: `cast`, `body`, `hit`, `ground`, `end`.
  - Each layer has the fields `{ sprite, anchor: caster|projectile|area|target|ball, plane: billboard|ground, scale, tint, blend, frameTicks, loop, rotate: aim|none, offset }`.
  - Moves are data, so a new or swapped Pokémon only needs JSON (the roster may change).
- **Hooks into existing sim events:**
  - `cast`, `area`, `telegraph`, `dash`, `buff`, `wall`, `ring`, `guardian`, `blink`, `grab`, `release`, `channel`, `charge`, `hit` (with `source`), `ballHit`, `ko`, `rescue`, `banish`;
  - live projectiles, rings, walls and guardians are read from the world state each frame;
  - status effects are read from player state (stun, slow, buffs, staggered, immune).
- **Small particle emitter** (additive points) for sparks, embers, droplets, dust and rock bits, plus **trails** for projectiles and dashes.
- **Ground decals**: cracks and craters for slams and big hits, fading over about 1.5 s.
- **Bloom**: the three.js `UnrealBloomPass` with a high threshold, so only effects glow. Settings → Graphics: Low (off) / High (on), like OS.
- **Telegraphs**: keep the ground shapes, but tinted by side (yours white/blue, enemy red) as OS does.

## 4. Every move and its animation

Each name below is a file in `RawAsset/Particle/` unless marked `Beam/…`. "Tint" means recoloured in code. Every move has its own main animation: no sheet is the main effect of two moves. Small hit flashes and status overlays are shared, as in OS.

### Hisuian Arcanine (Asher model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Rock Slide** (cone + wall) | `Rock_Pieces` thrown along the cone | – | `Rock_Smash` on each enemy | `Rock_Slide_Back.79` + `Rock_Slide_Front.62`: rocks tumble down where the wall rises; the wall's body shows `Stone_Edge.38` pillars |
| **Flare Blitz** (guarded charge) | – | `Flare_Blitz_Charge_Back` / `_Front` wrapped around Arcanine for the whole dash, plus an ember trail | `Flare_Blitz_Hit_Back` / `_Front` | Scorch decal |
| **Flamethrower** (channel) | – | `Flamethrower` looping along the cone, `Flamethrower_2` at the tip, embers | Small `Flamethrower_2` puff on enemies pushed | – |

### Blastoise (Atlas model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Surf** (slowing piercing wave) | – | `Aqua_Tail_Wave` rolling along, turned to the aim, with a droplet trail | `Brine_Splashes` | – |
| **Whirlpool** (lingering ring) | `Wave_Circle_Blue` burst at full size | Once it latches: `Fire_Spin_Back` / `_Front` tinted water-blue, swirling on the ring and shrinking with it, plus `Bubbles_Blue` on the rim | `Water_Spout_Splash` when something bounces off | – |
| **Aqua Ring** (healing zone + rescue) | – | `Aqua_Ring` around the zone, `Stat_Green_Ring` pulse on each heal | – | Rescue: `Healing_Wish_Hit` on the saved ally |

### Bronzong (Dubu model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Gyro Ball** (slowing steel top) | Spin-up sparks during the wind-up | `Gyro_Ball` spinning | `Gyro_Ball_Hit` | – |
| **Heavy Slam** (leap + stun) | – | Dust trail on the leap | `Hammer_Arm_Smoke` dust ring on landing, stun stars on the enemies | Crater and crack decal (OS `CrackBlossom`) |
| **Light Screen** (3 screens) | `Screen_Sparkle_RSE` | `Screen_RSE_Yellow` panels on each wall segment | `Hit_Neutral` tinted yellow | Panels shatter into sparkles when they end |

### Greninja (Zentaro model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Night Slash** (light slash + wide slash) | `Slash_RSE` for the first quick slash | `Night_Slash.Dir1` arc, turned to the aim, for the wide slash | `Night_Slash_Hit` | – |
| **Shadow Sneak** (blink through) | `Shadow_Sneak_Shadow` pooled at the start | Dark afterimage trail along the path | `Shadow_Sneak_Hit` on everyone it passes | – |
| **Hydro Cannon** (charged beam) | `Water_Spout_Up` while charging, growing with the charge | `Hydro_Cannon` at the muzzle, beam drawn from `Beam/Beam` tinted blue | Big `Brine_Splashes` | – |
| **Water Shuriken** (passive) | Charges show as small orbiting `Bubbles_Blue` pips | Lunge: `Swift_Star` tinted cyan, spinning | `Bubble_Pop_Blue` | – |

### Hoopa (Rune model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Psychic** (grab + throw) | `Psycho_Shift_Charge` on the ball while held | Pink `Light_Ball_Pink` glow on the ball | Throw: `Psycho_Shift_Hit` | – |
| **Hyperspace Hole** (portal + exit) | – | `Psycho_Cut_Hole` portal travelling | Chip: small `Hit_Neutral` tinted purple | `Dark_Void_Back` / `_Front` where it stops; Hoopa exits with `Psycho_Boost_Back` / `_Front` |
| **Future Sight** (tracking eruption) | – | `Miracle_Eye_Eye` mark following the target while the ground circle fills | Eruption: `Psycho_Boost` tinted gold | Banish: enemies vanish into `Dark_Void` |

### Lucario (Juliette model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Aura Sphere** | `Aura_Sphere_Shoot.Dir8` | `Aura_Sphere_Shot.Dir8` flying, turned to its direction | `Aura_Sphere` burst | – |
| **Extreme Speed** (dash) | Speed lines | `U_Turn_Travel` streak along the dash, with a white afterimage trail | `Hit_Neutral` on each enemy | – |
| **Close Combat** (jabs + final kick) | – | `Close_Combat` flurry on the cone during the jabs | Final kick: `Superpower` plus the strong-hit flash | Small crack decal |

### Machamp (X model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Cross Chop** (spin, sweet spot at the edge) | `Focus_Energy` glow during the wind-up | Swing-arc ring around Machamp | Sweet spot: `Cross_Chop`; inner LIGHT hits: `Hit_Neutral` | – |
| **Submission Rush** (rush) | – | `Giga_Impact_Back` / `_Front` around Machamp while rushing | `Arm_Thrust` | Dust trail |
| **No Guard** (40 % bigger, Strikes hit players) | `Rage` burst | `Stat_Red_Line` rising for the whole buff, red rim glow | Strikes that hit players: `Hit_Super_Effective` | – |

### Pikachu (Octavia model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Electroweb** (piercing, slows) | – | `String_Shot_Web` tinted yellow, travelling | First hit: `Shock_Wave`; LIGHT follow-ups: a smaller `Shock_Wave` | Slowed enemies crackle (shared slow effect, electric tint) |
| **Charge** (speed, resets on hits) | `Charge_Up` | `Circle_Tiny_Yellow` sparks orbiting Pikachu while active, flaring when it refreshes | – | – |
| **Thunder** (5 pulses) | `Charge_Beam_Charge` above Pikachu during the 1 s wait | – | Each pulse: a bolt from `Beam/Lightning` plus `Discharge_Hit` on the ground | Scorch decal at each pulse |

### Zeraora (Kai model)

| Move | Cast | Body | Hit | Ground or linger |
|---|---|---|---|---|
| **Discharge** (4 light bolts) | `Discharge` around Zeraora | `Charge_Beam_Shot.Dir8` bolts | `Discharge_Hit` | – |
| **Agility** (+30 % speed) | `Tailwind.Dir1` streaks | `Stat_Blue_Line` rising while active | – | – |
| **Wild Charge** (charge) | – | Electric aura around Zeraora (`Spark` loop) plus lightning trail | `Thunder_Fang_Fang` jaws snapping on the hit | – |

### Shared effects (every Pokémon)

| Moment | Effect |
|---|---|
| Strike swing / ball hit | `Hit_Neutral`; a boosted hit uses `Hit_Super_Effective` |
| Ball stunned | Small stun stars on the ball |
| KO (blasted off) | `Explosion` at the exit point |
| Respawn / spawn protection | `Materialize`, then a soft shimmer while invulnerable |
| Evade | `Puff_White` |
| Energy Burst | `Wave_Circle_White.Dir5` plus `Circle_White_Out` |
| Level up | `Stat_Yellow_Ring` plus `Event_Gather_Sparkle` |
| Stagger (Stagger bar empty) | Red flashing rim plus stars |
| Stunned | Stun stars |
| Slowed | `Sticky_Brown_Front` at the feet (electric-tinted for Electroweb) |
| Speed buff (any source) | `Stat_Blue_Line`, small, at the feet. Agility uses its own bigger version as its main effect |
| Power or size buff | `Stat_Red_Line` |
| Healed | `Stat_Green_Ring` |
| Orb pickup | `Light_Ball_Yellow` |
| Barrier break | `Wall_Break` |
| Gate opens | `Vault_Open` |
| Goal | `Explosion` plus a team-coloured burst (a bigger custom version comes later) |

**Download list:** 85 files from `Particle/` (about 440 KB) plus `Beam/Lightning` and `Beam/Beam` (about 6 KB). Every name above was checked against the repo's file list on 2026-11-07. The `.79`, `.62` and `.38` sheets are frame-count layouts.

## 5. Build order (each step: build, check in the browser, screenshot, commit)

1. **Engine:**
   - `FxSprite` (sheet parser, billboard and ground modes, tint, additive, pool);
   - `fx/moves.json` with its Zod schema;
   - event hooks, trails, decals;
   - bloom with a Graphics setting (Low/High).
2. **Shared effects:** hits, KO, respawn, evade, Burst, level up, statuses, orbs, barrier, gate.
3. **Moves, one Pokémon at a time:** Pikachu, Lucario, Zeraora, Greninja, Hoopa, Bronzong, Blastoise, Hisuian Arcanine, Machamp. Each one is checked in a match with frame timing tuned.
4. **Polish:**
   - frame speeds;
   - team-tinted telegraphs;
   - a performance check (a full 3v3 at 60 fps on Low and High);
   - CREDITS.md for PMDCollab, PMD: Origins and the Mystery Dungeon games.

**Not in stage 1:** sound (stage 2: game sound effects from hexparrot/pokemon-assets and each Pokémon's cry from PokeAPI/cries on special moves and KOs) and music (stage 3).
