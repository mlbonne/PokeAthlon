# Omega Strikers, taken apart and rebuilt as PokéAthlon

> The design bible. Part I explains how Omega Strikers (OS) works and *why it feels the way it does*.
> Part II turns each piece into Pokémon form. Numbers come from the community wiki and from our own reading
> of the game's text tables (see [research/omega-strikers.md](../research/omega-strikers.md) and
> [research/FMODEL.md](../research/FMODEL.md)). Values marked ⚠ still need checking.
>
> Golden rule: **we copy the feel, not the content.** No OS names, art, audio or code. Our moves come from Pokémon
> and our numbers are our own tuning, using OS values only as a starting point.

---

# PART I: HOW OMEGA STRIKERS WORKS

## 1. The core fantasy

OS is described in its own text as a **"3v3 knockout and scoring game"**. Two win conditions are always in tension:

1. **Scoring:** hit the Core (the puck) through the enemy barriers and into their goal.
2. **Knocking out:** drain an enemy's Stagger and launch them off the arena.

You never score from a KO, but **a KO is the best setup for a goal**, and a goal resets everything. Each round
swings between "fight for the numbers advantage" and "convert it before they respawn".

What makes it *feel* good:
| Feel ingredient | How OS delivers it |
|---|---|
| **Punchy contact** | Every hit has hitstop, a flash and a big knockback number. The Core visibly picks up speed. Staggered players fly |
| **Instant readability** | Top-down camera, size rings on the floor, telegraphed wind-ups, yellow edge lines |
| **Short loops** | A round lasts about 20–60 s, a set a few minutes. Something decisive happens every few seconds |
| **Comeback tension** | Barriers reset every round, Stagger refills every round, energy resets each set, and the losing team still drafts |
| **Few buttons, deep play** | Strike + 3 abilities + Evade. Depth comes from timing, angles and positioning, not from long combos |

## 2. Anatomy of a match

```
MATCH  (first to N sets)
 └─ SET  (first to N goals; awakening draft in between)
     └─ ROUND  (kickoff → … → one goal)
          · barriers, Stagger, positions reset
          · power orbs on a timer
          · overtime after 60 s
```

| Phase | What happens |
|---|---|
| **Striker Select** | Pick role (Forward or Goalie), striker, gear. Everyone sees the same 2 starting awakenings and picks 1. Competitive adds 1 ban per team |
| **Kickoff** | Players spawn in fixed positions on their own half. The Core starts in the centre |
| **Open play** | Fight for the Core, break barriers, fight for KOs, collect orbs |
| **Barriers down** | When a team's last barrier breaks, its gate opens about a second later. Panic defence starts |
| **Goal** | Celebration, then the round resets. Levels and XP carry over |
| **Overtime** | After 60 s: Core knockback +20 %. "Accelerated" overtime (custom option): a faster Core and **no respawns** |
| **Between sets** | Draft from a shared pool of 8 awakenings, one pick each, in order of XP earned that set. Surrender vote allowed when down ≥2 sets |

OS's custom lobby shows exactly which rules are tunable. That's a good template for **our own config file**:
*Goals To Win, Goals Per Set, Sets To Win Match, Win By (Goal / Goal + 2), Overtime Rules (Normal / Accelerated),
Ability Cooldowns (±50 %), Movement Speed, K.O. Timer, Energy Generation, Goal Barriers, Map Hazards,
Mirrored Strikers, Striker Bans, Draft Type (Alternating 1-2-1-2 / Snake 1-2-2-1), Starting Awakenings,
Draftable Awakenings, Draft Pick Order (by highest/lowest XP).*
⚠ Default goals per set and sets per match aren't stored as text. Check them in OS's Custom Game screen (pick "Normal" and read the defaults).

## 3. The arena

> Exact geometry, sizes and goal-line logic (data-mined from the game files) are in
> [research/os-arena-geometry.md](../research/os-arena-geometry.md), with a to-scale diagram.

```
 ┌─╲──────────────────────────────────────────╱─┐   ← every edge = KO line for players
 │  ╲                                        ╱  │     (Core bounces off it)
 │G  ▐▌ barrier          ◯ orb          barrier ▐▌  G│
 │O ( ▐▌ arc )            ●             ( arc ) ▐▌ O│
 │A  ▐▌                  core                   ▐▌ A│
 │L  ╱                                        ╲  │
 └─╱──────────────────────────────────────────╲─┘
         own half          │ midfield │         enemy half
```

- **Rectangle with cut corners.** The cut corners turn corner shots back into play.
- **Edges:** players crossing them = KO. The Core bounces. This one asymmetry is the whole "sumo" layer.
- **Goal + gate:** the gate partly covers the mouth until all barriers are gone.
- **Barriers:** 1 to N per side, set per map. The Core breaks one per touch. They stay broken for the round.
- **Goal Arc:** a half-circle in front of the goal. Defenders standing in it (while not Staggered) get **+125 knockback
  resistance** and **half-length negative status effects**. It's why goalies "live" there.
- **Midfield line:** some items and perks check for it (e.g. goalie gear stops working past it).
- **Power Orbs:** 3 spawn points (centre and each arc). First spawn at 10 s, then every 20 s. Each gives Stagger (7.5–30 %, more when hurt), 15 XP and 7.5 Energy.
  They pull players into contested spots on a timer.
- **Map gimmick:** each map adds exactly one system (gravity well, launch drums, speed gate, portals, speed strips, random
  lab modules, central KO hole...).

## 4. The striker toolkit

Every striker has the same 5 buttons:

| Slot | Key (PC) | Role in the kit | Typical cooldown |
|---|---|---|---|
| **Strike** | LMB / Q | **Hits only the Core** (a few kits upgrade it to hit players). Can hit the Core even when it's slightly behind you, in any direction | **0.9 s** |
| **Primary** | E | Main tool for both Core and players (projectile, line, arc) | ~10–12 s |
| **Secondary** | W | Usually mobility (dash, blink, haste) or utility | ~18–20 s |
| **Special** | R | High impact, unlocks at **level 2** | ~24–40 s |
| **Evade / Energy Burst** | Space | 1 bar: 1.5 s untouchable. 3 bars: Burst (push enemies away + Core control + next hit +50 %) | 3 s |

### 4.1 Hit model
Every hit has three separate outputs: **Core knockback / Player knockback / Damage**, each `base + ratio × Power`.
```
final = (base + ratio × Power) × (1 + Σ additive % bonuses) × target modifiers
```
Reference: Strike Core KB `1230 + 125 % P`. A typical primary Core KB is `~1300 + ~170 % P`, and a big special `~1400 + ~210 % P`.
So **abilities hit the Core only about 10–20 % harder than Strike**. Their value is range, area or awkward angles,
not raw power. Strike stays the main way to control the Core.

**Hit grades:**
- **LIGHT hit:** small slow and chip damage, **no knockback unless the target is Staggered**. +1 energy.
- **Normal hit:** full knockback and damage. +3 energy.
- **MELEE:** hitbox scales with the striker's size. **IMPACT:** area hit (some perks boost these).

### 4.2 Stats
| Stat | Effect | Roster range |
|---|---|---|
| Power | Scales every hit | 85 – 115 |
| Speed | Movement. Soft caps at 750 (50 %) and 900 (25 %) | 435 – 470 |
| Stagger | Health pool. +1/9 of "growth" per level, up to level 10 | 1100–1500 (+200–500) |
| Cooldown Rate | `cd × 100/(100+CDR)` | 0 base |
| Size | Hurtbox + melee reach + Strike width | Normal 250 / Large 265 / Very Large 270 |

### 4.3 Stagger
- Hits drain Stagger. At 0 → **Staggered**: **+254.5 % knockback taken**, −75 % damage taken, fast regen. It ends at 50 %.
- Passive regen 4 %/s after ~2.4 s without being hit. Full refill every round.
- Fights go in phases: **chip → break → launch**. Brawlers get to the break, and anyone can do the launch.

### 4.4 Energy
- Start 25 / max 75 (3 bars). Reset each set and on respawn.
- Gain: +1 light hit (including Strike on the Core), +3 normal hit, +7.5 orb.
- **Evade (25):** escape tool, 1.5 s untouchable, cancelled by casting anything.
- **Energy Burst (75), aka "Core Flip":** the finisher. A short window of exclusive Core control, then a +50 % shot.
  Players learn to track everyone's energy, because the player with a full bar is the threat.

### 4.5 Status vocabulary
Stunned (also freezes the Core), Knocked, Slowed, Banished (removed from play for a while, can't be targeted), Elusive (can't be targeted),
Immune (after respawn), Invisible, Haste, Buff/Debuff. Creations (walls, drones, turrets) are objects with their own hitboxes.

## 5. Archetypes: OS's internal design language

OS's files name each striker by an **archetype** before any character name. That's how they design kits, and we will too:

| Internal archetype | Striker | Kit in one line | Core idea |
|---|---|---|---|
| Speedy Skirmisher | Kai | 5-fireball barrage, haste, explosive fireball | Volume of Core touches from range |
| Stalwart Protector | Dubu | Rolling log, rolling stun dive, tofu walls | Creates terrain, body-blocks |
| Tempo Sniper | Estelle | Long piercing line, blink + homing thorn, thorn volley | Long-range pressure |
| Flexible Brawler | Juliette | Line punch, dash (cast other moves during it), jab flurry + kick | Combos mid-dash |
| Hulking Beast | X | Wide swing (stronger at max range), bull rush, "hulk out" (Strikes hit players) | Turns Strike into a weapon |
| Shield User | Asher | Barrier + blast, defensive charge (knockback resist), shield wall projectile | Barrier stronger on own half |
| Flashy Swordsman | Zentaro | 2-hit slash, delayed blink line, elusive multi-hit | Charges his Strike by hitting enemies |
| Whip Fighter | Rasmus | Overhead slam (sweet spot at tip), haste + spin, anchor pull | **Pulls** enemies and the Core |
| Chaotic Rocketeer | Luna | Rocket (light hit early, heavy late), boost launch (barely steerable), bomb | Commits fully, high risk |
| Gravity Mage | Finii | Boomerang projectile, damage-amp smoke, gravity well → explosion | Groups enemies, then pops |
| Clever Summoner | Juno | Blob projectile, hop + blob, blob rain | Summons that **try to score by themselves** |
| Manipulating Mastermind | Rune | Expanding anomaly, swap with shadow, banish wave | Removes enemies from play |
| Empowering Enchanter | Era | Beam (buff allies / shrink enemies), team haste, maelstrom | Team buffer |
| Magical Playmaker | Ai.Mi | Growing orb (detonate), blink + tail swipe, turret firewall | Long-range Core control |
| Angelic Support | Atlas | Arc barrier, ring of light, guardian that **saves allies from KO** | Anti-KO support |
| Nimble Blaster | Drek'ar | Cone blast (charges), invisibility + haste, sticky burn bomb | Stealth ambush |
| Ramping Speedster | Octavia | Slowing sonic wave, ramping haste that refreshes on hit, pulse ult | Gets faster the longer she keeps hitting |
| Healer | Nao | Sentry drone, heal drone (enemies can disarm it), blink-to-ally heal | Healing and zone control |
| Rock Oni | Vyce | Chaining lightning, thunderbolt stun → blink, hold-to-charge shockwave (100 % knockback resistance) | Charge-and-release |
| Drum Oni | (unreleased) | Hold-to-charge bat swing that launches a drum, drum-roll team buff, drum trap | "Beat" stacks empower Strike |
| Umbrella User | Kazan | Two stances (open/closed) swapping the whole kit | Stance switching |

**Recurring kit patterns** (our move library):
1. **Charge-and-release:** hold to grow (Vyce, Drum Oni, Era's maelstrom).
2. **Recast:** detonate, stop or blink back (Ai.Mi, Finii, Nao, Vyce).
3. **Sweet spot:** stronger at the tip or centre (X, Rasmus, Luna, Asher).
4. **Creations:** walls, turrets, drones, summons.
5. **Strike modifiers:** passive charges that upgrade Strike (Zentaro, Drum Oni, X).
6. **Pull vs push:** most moves push. Pulls (Rasmus, Kazan, Finii) are rare and very strong.
7. **Team buffs:** haste, size or power for allies. Anti-KO saves.
8. **Light-hit volleys** for Core control without knockback, vs **single heavy hits** for KOs.
9. **Side-of-field conditions:** stronger on your own half (Asher), which suits goalie kits.

## 6. Loadout layers

| Layer | When | Count | Design purpose |
|---|---|---|---|
| **Gear** | Striker Select | 1 | Role identity. **Locked to role.** Goalie gear stops working on the enemy half |
| **Starting awakenings** | Striker Select | 1 of the same 2 shown to everyone | Sets the theme of the match, influences picks and bans |
| **Drafted awakenings** | After each set | +1 each, from a shared pool of 8, picked one at a time and only once each | Snowball control and denial drafting |

Awakening families: movement/range, stats (size, Stagger, power, speed), Core/impact power, cooldowns/creations,
energy, sustain/edge play, and "**SPARK**" (stacking perks that reward taking several). Others hook into rules:
"destroy a barrier → lower cooldowns / grow bigger", "power orbs → speed / power / cooldowns", "near the arena edge → speed".

## 7. Tactics (what good play looks like)

**Positioning**
- Goalie lives in the Goal Arc, and Strikes to *redirect* the Core rather than shoot it.
- Forwards spread out: "Sometimes it's better to let [the Core] come to you" (OS loading tip).
- Avoid the edges. Pressure enemies who stand near them.

**Core play**
- **Time your Strikes.** Strike has a 0.9 s cooldown, so whoever wastes theirs loses the next contact.
- Bank shots off walls and the cut corners. The "dribble" angle up the goal line.
- **Close-range shots can barely be blocked**, so pass into the box and then finish.
- Pass to whoever has full energy and let the Energy Burst finish it.

**Fighting**
- Stagger → KO near the edge → 3v2 → score before they respawn.
- "OKI": sitting on the goalie to chip them or KO them.
- **Ability rotation:** teammates use their cooldowns in turn so pressure never stops. The goalie goes last.

**Energy**
- Watch every player's energy bar. Bait Evades with moves they'll dodge anyway.
- It resets each set, so use it or lose it.

**Draft**
- Pick strikers that fit the two starting awakenings. Ban whoever is strong on this map.
- Draft to deny opponents, not only to help yourself.
- Have both control and brawling on the forward line. Find the weak side and play through it.

---

# PART II: THE POKÉMON VERSION

## 8. Concept translation table

| OS concept | PokéAthlon | Notes |
|---|---|---|
| Core | **the Ball** (a hefty glowing Poké Ball-style puck) | Same physics role |
| Goal Barriers | **Protect Barriers** | Visual: the green shimmer of *Protect*. They break with a "Protect failed!" crack |
| Goal Gate | **Gate** | Opens after the last barrier breaks |
| Goal Arc | **Home Turf** | Defender bonus: knockback resistance + shorter status. Looks like a Gym-floor circle |
| Stagger | **Stagger** (HP bar look) | Keep the name: it describes the mechanic. Staggered = "Dizzy" star VFX |
| KO | **Fainted / Blasted off!** | "Team Rocket blasting off" twinkle when someone flies off the edge |
| Respawn | **Return to Poké Ball** → sent back out | Respawn = Poké Ball throw-in animation, brief immunity |
| Strike | **Strike** | Same for every species, sized by the Pokémon's size class |
| Primary / Secondary / Special | **Move 1 / Move 2 / Signature Move** | Named after real Pokémon moves |
| Energy, Evade, Energy Burst | **Spirit**: **Protect-dodge** (1 bar) / **Max Burst** (3 bars) | Burst: short Core control + a +50 % shot |
| Levels 1–10 | **Levels 1–10** | Signature move unlocks at Lv 2. XP from the same sources |
| Power Orbs | **Berries** (Oran = Stagger, Leppa = energy, Rare-candy XP) | Spawn on a timer at 3 points |
| Gear (role-locked) | **Held Items** | See §10 |
| Awakenings (drafted) | **Boosts** (TM-disc look) | See §11 |
| Overtime | **Sudden Death / "Weather turns harsh"** | +20 % ball knockback, optional no-respawn mode |
| Map gimmick | **Stage gimmick** | One per stage, Pokémon-themed (§12) |
| Archetype | **Archetype** | Keep the internal design language from §5 |

**Types (light layer, not a damage chart):** types affect *flavour and synergy*, not damage. Examples: Water moves
apply **Soaked** (−10 % speed), Electric moves on a Soaked target stun briefly, Ice on Soaked = Frozen (short root),
Fire removes Soaked. Two to three combos total, all visible in the HUD. This keeps the game readable (OS pillar #2)
while still feeling like Pokémon.

## 9. Kit design rules for Pokémon (so every kit feels OS-grade)

1. **4 actions + dodge, no more.** Strike / Move 1 / Move 2 / Signature + Protect-dodge.
2. **Every kit touches the ball.** Move 1 must be able to hit the ball (it's the Primary slot).
3. **Every kit has a clear archetype from §5** and at least one recurring pattern from §5.1–9.
4. **Moves must look like the Pokémon move.** Thunderbolt = a line, Surf = a wave that pushes, Protect = a barrier.
5. **The number budget follows OS:** M1 ~10–12 s, M2 ~18–20 s, Signature ~25–40 s. Ball KB on abilities at most ~1.2× Strike.
6. **Light vs heavy:** multi-hit moves (Water Shuriken, Bullet Seed) deal LIGHT hits. Single big moves (Close Combat) are heavy.
7. **Size class from the species:** Pikachu = Normal, Snorlax = Very Large. Size drives Strike width and hurtbox.
8. **Sprite check:** every move must map to a SpriteCollab animation (Attack, Shoot, Strike, Swing, Charge, Hop,
   Rotate, Double...). We don't invent animations we don't have.

## 10. Held Items (Gear equivalent, role-locked)

| Slot | Item | Effect (starting tune) | OS analogue |
|---|---|---|---|
| Forward | **Choice Scarf** | Ball-hitting Strikes: +30 % speed for 1.25 s | Slick Kicks |
| Forward | **Muscle Band** | +10 % player knockback. +30 % speed while your team has more players on the field | Pummelers |
| Forward | **Shell Bell** | Heal Stagger for 75 % of damage dealt | Vicious Vambrace |
| Forward | **Quick Powder** | Crossing midfield: +18 % speed for 1.65 s | Magnetized Soles |
| Forward | **Poison Barb** | Hits leave a 6 % max-Stagger poison over 2.4 s, and you heal 125 % of it | Siphoning Wand |
| Goalie | **Quick Claw** | Speed builds up to +16 % over 10 s. Reset when hit | Momentum Boots |
| Goalie | **Eject Pack** | +50 % dash range, −25 % M2 cooldown, recast to blink back | Eject Button |
| Goalie | **Zoom Lens** | +35 % projectile range. Every 11 s your Strike also fires a light projectile | Strike Shot |
| Goalie | **Rocky Helmet** | +30 % size, +20 power, −15 % damage taken | Powerhouse Pauldrons |

All goalie items stop working on the enemy half, like in OS.

## 11. Boosts (Awakening equivalent, drafted)

Start with ~20, grouped like OS's families. Examples:
| Family | Boost | Effect |
|---|---|---|
| Movement | **Agility** | +35 % dash/blink/haste |
| Movement | **Long Reach** | +55 % projectile range |
| Stats | **Bulk Up** | +300 max Stagger, +1.3 power per 100 Stagger |
| Stats | **Minimize / Growth** | −size +speed / +size +impact |
| Ball | **Helping Hand** | Strikes aimed at an ally hit 12.5 % harder, and the ally's next Strike +10 % |
| Ball | **Sniper** | Hits 25 % harder at 600+ range |
| Cooldowns | **Quick Feet** | Barrier break by you or an assist: −2 s on all cooldowns |
| Energy | **Spirit Aura** | Start rounds with +5 energy. Your Max Burst gives the team +50 % speed for 6 s |
| Sustain | **Leftovers** | Heal 7.5 % of max Stagger on any hit |
| Edge | **Cliffhanger** | +40 % speed near the edge, 0 power |
| Anti-KO | **Sturdy** | The first KO each set is prevented |
| Synergy | **Sparks: Swords Dance / Agility / Calm Mind** | Each gets stronger for every Spark you own |

Draft flow as in OS: 2 starting Boosts shown to everyone, then a shared pool of 8 after each set, pick order by XP.

## 12. Stages (one gimmick each, Pokébonk biomes as visual themes)

| Stage | Biome | Gimmick | OS pattern it follows |
|---|---|---|---|
| **Viridian Pitch** | Forest | None. 2 barriers per side. Ranked baseline | Standard map |
| **Magma Ring** | Volcano | Lava vents on a timer push players and the Ball outward | Launch drums |
| **Frostlake Rink** | Frostlake | Ice: lower friction for the Ball, a sliding stop for players | Speed strips |
| **Stormcape Cliffs** | Stormcape | Thunder gusts every 15 s push everything sideways (telegraphed by clouds) | Map-wide hazard |
| **Ruins of Alph** | Ruins | Unown portals that teleport players and the Ball | Portals |
| **Distortion Sanctum** | Sanctum | Central gravity well that pulls the Ball and slows players. Hit its core to explode it | Gravity well |
| **Lighthouse Coast** | Coast | Speed currents along the top and bottom edges (fast, but next to KO lines) | Speed strips |

## 13. Starting roster rebuilt with OS archetypes

Stats use OS units. P = Power, Spd = Speed, Stg = base Stagger (+growth), Size.

| Pokémon | Archetype (OS model) | P / Spd / Stg / Size | Strike | Move 1 (~11 s) | Move 2 (~18 s) | Signature (Lv2, ~30 s) |
|---|---|---|---|---|---|---|
| **Pikachu** | Speedy Skirmisher (Kai) | 95 / 465 / 1150 (+250) / Normal | Standard | **Thunder Shock**: 4 light bolts in a cone, each nudges the Ball | **Agility**: +30 % speed 5 s, castable mid-volley | **Volt Tackle**: long piercing charge. Heavy knockback, 10 % recoil to self |
| **Greninja** | Flashy Swordsman (Zentaro) | 105 / 460 / 1100 (+250) / Normal | Charges up: after 3 enemy hits its Strike also fires a **Water Shuriken** | **Night Slash**: 2-hit arc, centre hits harder | **Shadow Sneak**: delayed blink in a line, hitting along the path | **Hydro Cannon**: hold-to-charge beam, heavy Ball KB |
| **Alakazam** | Manipulating Mastermind (Rune) | 100 / 455 / 1150 (+300) / Normal | Standard | **Psychic**: grab the Ball for 0.6 s, recast to throw it (the only "hold" in the game) | **Teleport**: swap places with an ally, or blink to a marker placed at round start | **Future Sight**: mark an area. After 2 s it explodes and **banishes** for 1.5 s |
| **Togekiss** | Empowering Enchanter (Era) + Angelic Support (Atlas) | 90 / 465 / 1300 (+375) / Normal | Standard | **Air Slash**: a light-hit blade that **lobs** the Ball over players | **Tailwind**: team haste that decays over 3 s | **Wish**: after 1.5 s, heals allies in an area and **rescues** one ally from a KO in the next 4 s |
| **Snorlax** | Stalwart Protector (Dubu) | 100 / 435 / 1500 (+500) / Very Large | Wide Strike (270) | **Rollout**: rolling body that breaks on the first hit, decelerates | **Body Slam**: hop to a spot, area stun 0.5 s, can stun the Ball | **Block**: arc of impassable walls for 2.5 s |
| **Blastoise** | Shield User (Asher) | 110 / 440 / 1400 (+425) / Large | Standard | **Water Pulse**: blast + water wall. Unbreakable on your own half | **Rapid Spin**: defensive charge with +knockback resistance and −damage, ended by Stagger | **Hydro Pump**: 2 cannons in a narrowing cone, a steady push |
| **Lucario** | Flexible Brawler (Juliette) | 105 / 455 / 1300 (+375) / Normal | Standard | **Aura Sphere**: line punch-projectile, homes slightly | **Extreme Speed**: dash. Other moves can be cast mid-dash | **Close Combat**: flurry of light jabs, then a huge final kick |
| **Machamp** | Hulking Beast (X) | 115 / 445 / 1400 (+425) / Large | Standard | **Cross Chop**: wide swing, sweet spot at the tip | **Submission Rush**: wind-up bull rush | **No Guard**: 5 s, +size, Strikes hit players heavily, but takes +25 % knockback |

Backups by archetype: Gengar (Nimble Blaster: invisible), Garchomp (Chaotic Rocketeer), Gardevoir (Gravity Mage),
Dragonite (Whip Fighter: Dragon Tail pull), Charizard (Tempo Sniper), Sylveon (Healer), Politoed (Drum Oni-style rain dance).

## 14. What "Pokémon flavour" means at the feel level

- **Sounds:** each Pokémon's cry on its signature move. Classic hit SFX tiers: not very effective / normal / super effective, mapped to
  light / normal / Staggered hits.
- **Text pops:** "Critical hit!" on hits against Staggered targets, "It's super effective!" on type combos, "Blasted off!" on a KO.
- **Animations:** PMD sprites from SpriteCollab. Hurt anim on hit, Faint frame during the blast-off, Charge for wind-ups.
- **Portraits:** SpriteCollab emotion portraits in the HUD (Happy after a goal, Pain when Staggered, Determined at full energy).
- **Kickoff:** Poké Ball throw-in. **Goal:** confetti + a celebration emote using the scorer's portrait.

## 15. Open questions

1. Default goals per set and sets per match (check OS's Custom Game screen, "Normal" defaults). We start with 3 goals per set and 2 sets.
2. KO timer, respawn immunity, gate delay: currently guesses (~5 s, ~1 s, ~1 s).
3. Ball physics constants: to be tuned by feel in the M1 sandbox. OS gives the scale (Strike KB ~1300 u/s, player speed ~450 u/s).
