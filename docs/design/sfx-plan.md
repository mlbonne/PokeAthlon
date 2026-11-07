# Sound effects: plan (stage 2 of 3)

Status: plan, 2026-11-07. Nothing has been downloaded or built yet.

**Stages:** stage 1 (move animations) is done, see [vfx-plan.md](vfx-plan.md). Stage 3 is music.

## 1. How Omega Strikers does sound

These findings come from its own files. OS uses **Wwise** (~21,000 audio assets), and its event names show the structure:

- **Each move has its own sounds, split by moment:** `cast`, `projectile`, `hit`, `loop` and `loop_end`. Atlas's Cosmic Expanse, for example, has:
  - `sfx_cha_atlas_expanse_cast`
  - `sfx_cha_atlas_expanse_hit`
  - `sfx_cha_atlas_expanse_loop`
  - `sfx_cha_atlas_expanse_loop_end`
  - Lingering things (zones, rings, burns) have a loop that stops with a matching end sound.
- **Each character has its own Strike sound** (`sfx_cha_<name>_strike`). Some have a stronger variant (`strikestrong`).
- **The Core (ball) has its own set:**
  - hit a character (`rock_hit_character`);
  - hit a wall (`rock_hit_wall`);
  - possession flips to your side or theirs (`rock_flip_ally` / `rock_flip_enemy`);
  - speed boost and "super speed" with the pitch rising as it speeds up.
- **Your side and theirs sound different.**
  - Goals: `goal_local` / `goal_remote`.
  - Saves: `save_local` / `save_remote`.
  - Some loops: `_local` / `_remote`.
- **Arena sounds:**
  - barrier boxes `breakout_box_hit` / `_break`;
  - the gate `gate_close` / `gate_open_loop`;
  - power-up orbs `powerup_spawn`, `_pickup`, `_active_loop`.
- **Voice reactions per character:**
  - small, medium and large attack efforts (`eff_att_a_small` / `b_med` / `c_large`);
  - KO (`eff_ko`), goal, respawn, MVP, character select and intro.
- **UI:** a sound for nearly every button, and a separate one for hover (play, ban, select, ready, back, close…).
- **Mix:** a slow-motion mix snapshot when a goal is scored (`mix_slomo_active`) and an end-of-play mix.

**What we copy:**
- cast / hit / loop / end per move;
- a Strike sound and ball sounds;
- your-side and their-side variants for goals;
- arena sounds;
- short Pokémon voice reactions (cries) on big moments;
- UI sounds;
- a muffled "goal" mix moment.

## 2. Sources

| Source | What it has | Use |
|---|---|---|
| **PMD: Origins sounds** ([audinowho/DumpAsset](https://github.com/audinowho/DumpAsset) `Content/Sound/`) | **759 battle sounds from Pokémon Mystery Dungeon**, most named after the move (`DUN_Aura_Sphere`, `DUN_Cross_Chop`, `DUN_Flamethrower`…), plus hit sounds, menu sounds and fanfares. All OGG, short, in the same Mystery Dungeon style as our sprites and effects | **Main source** |
| [PokeAPI/cries](https://github.com/PokeAPI/cries) | Every Pokémon's cry as OGG, named by PokéAPI id (Hisuian Arcanine = 10230) | Voice reactions |
| [hexparrot/pokemon-assets](https://github.com/hexparrot/pokemon-assets) `assets/audio/sfx` | Only 7 generic overworld sounds (collide, jump, select…) | Not needed (PMDO covers it). Its `music/` folder is for stage 3 |

**Licence:** the PMD: Origins software can be freely copied and redistributed with its credits kept. The sounds themselves are ripped from the Mystery Dungeon games, the same situation as our sprites and effects (non-commercial, credited). The cries in PokeAPI's repo come from Showdown, Veekun and The Sounds Resource, and the repo states no licence. Both get credited in Settings → Credits.

## 3. The sound engine (client only)

- **Web Audio API:**
  - every sound is decoded once into an `AudioBuffer`;
  - each play is a cheap source node through gain and stereo-pan nodes;
  - nothing plays until the first click or keypress (browser autoplay rule), then the audio context resumes.
- **Mixer channels**, each with a volume slider in Settings → Sound:
  - Master;
  - Effects (moves, hits, ball, arena);
  - Voices (cries);
  - Interface (menus).
  - A Mute toggle sits next to them, and the settings are saved in the profile.
- **Position:**
  - the sound pans left or right with the thing's place on screen;
  - it gets quieter with distance from the camera's focus;
  - your own moves are always full volume.
- **Anti-spam:**
  - the same sound restarting within 50 ms is skipped;
  - at most 4 copies of one sound and 24 sounds in total play at once;
  - each copy gets ±4 % random pitch, so repeats don't sound robotic.
- **Loops:**
  - Flamethrower's channel, the Whirlpool ring, the Aqua Ring zone and Hydro Cannon's charge loop while the thing exists;
  - they fade out over 0.15 s and play an end sound if one is set.
- **Data file `packages/data/fx/sounds.json`**, next to the animations file:
  - per move id: `cast`, `hit`, `loop`, `end`, each a sound name plus optional `volume` / `pitch`;
  - a `shared` section for every moment below;
  - a test checks that every move has sounds and every file exists. A swapped Pokémon only needs JSON.
- **Goal moment:**
  - effects drop to 40 % for 1.2 s;
  - the goal sound plays: cheering applause when your team scores, a lower sting when theirs does.

## 4. Every move and its sounds

File names are from `Content/Sound/Battle/` (`.ogg`).

| Pokémon | Move | Cast | Hit | Loop / end |
|---|---|---|---|---|
| Hisuian Arcanine | Rock Slide | `DUN_Rock_Slide` | `DUN_Rock_Smash` | the wall rising: `DUN_Stone_Edge` |
| | Flare Blitz | `DUN_Flare_Blitz` | `DUN_Flare_Blitz_2` | – |
| | Flamethrower | `DUN_Flamethrower` | – | loop `DUN_Flamethrower_2` while channelling |
| Blastoise | Surf | `DUN_Surf` | `DUN_Water_Gun` | – |
| | Whirlpool | `DUN_Whirlpool` | `DUN_Water_Gun_2` (bounces) | – |
| | Aqua Ring | `DUN_Aqua_Ring` | heal pulse `DUN_Heal` | rescue `DUN_Healing_Wish` |
| Bronzong | Gyro Ball | `DUN_Gyro_Ball` | `DUN_Hit_Neutral` | – |
| | Heavy Slam | – | landing `DUN_Head_Smash` plus `DUN_Stomp` | – |
| | Light Screen | `DUN_Light_Screen` | `DUN_Screen_Hit` | screens fade: `DUN_Light_Screen_2` |
| Greninja | Night Slash | `DUN_Slash` (light slash) | `DUN_Night_Slash` | – |
| | Shadow Sneak | `DUN_Shadow_Sneak` | `DUN_Snadow_Sneak_2` (the file name has the typo) | – |
| | Hydro Cannon | charge loop `DUN_Charge_Start` | `DUN_Hydro_Pump` on release, `DUN_Bubble` on hit | – |
| | Water Shuriken (passive) | `DUN_Swift` | `DUN_Bubble` | – |
| Hoopa | Psychic | grab `DUN_Kinesis` | throw `DUN_Psycho_Shift` | – |
| | Hyperspace Hole | `DUN_Psycho_Shift_2` | – | portal `DUN_Dark_Void`, exit `DUN_Warp` |
| | Future Sight | `DUN_Miracle_Eye` | eruption `DUN_Psycho_Boost` | – |
| Lucario | Aura Sphere | `DUN_Aura_Sphere` | `DUN_Aura_Sphere_2` | – |
| | Extreme Speed | `DUN_U-Turn` | `DUN_Tackle` | – |
| | Close Combat | `DUN_Close_Combat` | final kick `DUN_Superpower` | – |
| Machamp | Cross Chop | wind-up `DUN_Focus_Energy` | `DUN_Cross_Chop` | – |
| | Submission Rush | `DUN_Giga_Impact` | `DUN_Punch` | – |
| | No Guard | `DUN_Rage` | – | – |
| Pikachu | Electroweb | `DUN_String_Shot` | `DUN_Shock_Wave` | – |
| | Charge | `DUN_Charge` | – | – |
| | Thunder | `DUN_Thunder_Shock` (wind-up) | each pulse `DUN_Discharge_2` | – |
| Zeraora | Discharge | `DUN_Discharge` | `DUN_Paralyzed` (small zap) | – |
| | Agility | `DUN_Speed_Up` plus `DUN_Tailwind` | – | – |
| | Wild Charge | `DUN_Volt_Tackle` | `DUN_Spark` | – |

### Shared moments

| Moment | Sound |
|---|---|
| Strike (swing) | `DUN_Whiffer` (soft) |
| Ball hit by a Strike | `DUN_Hit_Neutral` |
| Ball hit, boosted / red-hot | `DUN_Hit_Super_Effective` |
| Ball hits a wall | `DUN_Bounced` |
| Player hit by a LIGHT hit | `DUN_Hit_NVE` |
| KO (blasted off) | `DUN_Explosion` plus the KO'd Pokémon's cry |
| Evade | `DUN_Miss` |
| Energy Burst | `DUN_Wind` |
| Level up | `Fanfare/LevelUp` (short) |
| Orb pickup | `DUN_Pick_Up` |
| Barrier hit / broken | `DUN_Hit_NVE` / `_UNK_DUN_Shatter` |
| Gate opens | `EVT_Door_Open` |
| Stunned | `DUN_Confused` |
| Slowed | `DUN_Speed_Down` |
| Buff gained | `DUN_Stat_Up` (when the move has no cast sound) |
| Kickoff countdown | `Menu/Select` per number, `DUN_Throw_Start` on GO |
| Goal for your team / for theirs | `EVT_Applause_Cheer` / `EVT_Applause` (quieter) plus the goal mix moment |
| Set won | `Fanfare/Promotion` |
| Match won / lost | `Fanfare/MissionClear` / `Fanfare/MissionFail` |
| Respawn | `DUN_In_Between` |
| Rescue (Aqua Ring) | `DUN_Healing_Wish` |
| Swap Pokémon in the lobby | `DUN_Leader_Change` plus the new main's cry |

### Voices (cries)

Like OS's attack efforts, the cry plays:
- **on a special cast** (big move);
- **on being KO'd**;
- **when you pick your main** in the lobby.

Cries are throttled to one per Pokémon every 4 s, so a busy match doesn't turn into a chorus.

### Interface

`Menu/Click` (buttons), `Menu/Confirm` (Play, Set as main), `Menu/Cancel` (Back, Esc), `Menu/Select` (tabs, role and mode), `Menu/Toggle` (settings toggles) and `Menu/Error` (disabled buttons).

## 5. Download list

- **87 sounds** from `audinowho/DumpAsset/Content/Sound/` (Battle, Menu, Fanfare), **about 1.4 MB**.
- **9 cries** from `PokeAPI/cries/cries/pokemon/latest/` (ids 807, 658, 720, 437, 9, 10230, 448, 25, 68), **about 130 KB**.
- Every name above was checked against both repos' file lists on 2026-11-07.

## 6. Build order (each step: build, try it in the browser, commit)

1. Engine: Web Audio mixer, loading, panning, anti-spam, loops, autoplay unlock, and Settings → Sound sliders.
2. `sounds.json`, its schema and test, and the hooks into the same events the animations use.
3. Shared moments and UI sounds.
4. Every move, one Pokémon at a time, with loudness balanced by ear (volume per sound in the JSON).
5. Credits (Settings and CREDITS.md), then commit and restart the host.
