# Omega Strikers — Research Summary

> Purpose: understand the rules, systems, numbers and tactics of Omega Strikers (OS) well enough to design
> our own Pokémon take on the genre. This is a design study. We don't copy assets, names or code.
>
> Sources: the community wiki (omegastrikers.wiki.gg) and community guides, read 2026-11-04 (links at the end).
> Pass 2 (FModel data mining, see [FMODEL.md](FMODEL.md)) will confirm the items marked **⚠ unverified**.

---

## 1. The game in one paragraph

3v3, top-down arena. Each team defends a goal on one short side of a rectangular arena with cut corners. There's
one **Core** (a heavy puck). Hitting the Core into the enemy's **Goal Barriers** destroys them. Once a team's last
barrier is gone, its **Goal Gates** open after a short delay, and only then can the Core be scored. Each player
also has a health-like **Stagger** bar. Emptying it makes them **Staggered** (they take far more knockback), and anyone
knocked past the arena's edge is **KO'd** for a few seconds. The team that's up a player has a big advantage. So
the game is half "air hockey with breakable shields" and half "sumo".

## 2. Match structure

| Element | Rule |
|---|---|
| Teams | 3v3. Usual lineup: **2 Forwards + 1 Goalie**. Role is chosen at Striker Select and decides which Gear you can pick |
| Round | One round = play until a goal. A goal ends the round, everything resets and there's a new kickoff |
| Set | First team to N goals wins the set. **⚠ unverified:** sources say 3 or 5 goals per set (Quick Play = a single first-to-5) |
| Match | Normal/Competitive: **first to 3 sets** wins (several sources). Awakening draft between sets |
| Bans | Competitive: each team bans a striker before the match |
| Surrender | Allowed during the between-set draft if your team has lost ≥2 sets or has an inactive player |
| Overtime | After **60 s** in a round: Core knockback **+20 %** until someone scores |
| Levels | Lvl 1 to 10 within a match. XP comes passively and from Core hits, saves, orbs, takedowns, goals and assists. Levels raise max Stagger. **Special unlocks at Lvl 2** |
| Assist | Touching the Core within 3 s of an ally's goal |
| Respawn | KO'd players sit out a few seconds (**⚠ ~5 s per guides**) and respawn briefly **Immune** |

## 3. Arena rules

- **Shape:** rectangle with diagonal corners. Being knocked over **any edge** (top, bottom, sides) = KO. The Core
  bounces off the edges. Players don't.
- **Goal Barriers:** how many depends on the map (1 large barrier up to several). The Core breaks one per hit. They **stay
  broken for the rest of the round** and reset each round.
- **Goal Gates:** partly block the goal mouth. They open shortly after the last barrier falls.
- **Goal Arc:** a zone in front of your own goal. Standing in it gives **+125 knockback resistance** and **halves
  negative status durations** (not while Staggered). It's the goalie's home turf.
- **Power Orbs:** 3 spawn points (midfield and each goal arc). First spawn at **10 s**, then every **20 s**.
  Picking one up gives **7.5–30 % Stagger** (more when you're hurt), **15 XP** and **7.5 Energy**.
- **Map hazards** (a big part of each map's identity):
  | Map | Gimmick |
  |---|---|
  | Atlas's Lab | Central gravity well: slows players 10 % and pulls the Core. Hitting its centre makes it explode (600 dmg / 700 knockback), then it respawns after 20 s |
  | Clarion Test Chamber | One of 5 random variants each round: corner bumpers, a central knockback field, a destructible 1500 HP sphere that gives a buff, damage auras, invisibility vents |
  | Gates of Obscura | Paired portals that teleport strikers and the Core |
  | Night Market | Two centre walls with a Speed Gate between them (+100 % speed for 1.25 s, respawns after 4 s) |
  | Oni Village | Speed strips along the top and bottom edges (+30 % for 1.25 s). Fast, but next to KO edges |
  | Taiko Temple | One big centre drum and 8 wall drums that launch strikers and the Core |
  | Ai.Mi's App (retired) | Central hole = KO zone that bounces the Core. 1 barrier |
  | Demon Dais (retired) | 1 barrier that takes 2 hits. Centre speakers push everything outward |
  | Inky's Splash Zone (retired) | Breaking the barrier turns the corner behind it into a KO zone and arms a central cannon |
  | Event maps | Bigger arenas with global buffs (+speed, +power, +size, shorter respawn, earlier overtime) |

## 4. Core systems & numbers

### 4.1 Stats
| Stat | What it does | Range seen |
|---|---|---|
| **Power** | Scales all damage and knockback | 85 – 115 (fixed, doesn't grow with level) |
| **Speed** | Move speed. **Soft caps:** total speed from 750 to 900 counts 50 %, above 900 counts 25 %. %-bonuses add together. Slows multiply | 435 – 470 |
| **Stagger** | Health pool. Grows each level by 1/9 of "Stagger Growth" | Base 1100 – 1500. Growth +200 to +500 |
| **Cooldown Rate** | `CD_final = CD_base × 100 / (100 + CDR)` (100 CDR = half cooldowns) | 0 base |
| **Size** | Hurtbox and melee hitbox size. Sets Strike width | Normal 250, Large 265, Very Large 270 |

The archetype shows in the stats. Big strikers (Dubu, Atlas, Asher, X, Mako) are slow (435–445) with 1400–1500
Stagger. Small skirmishers (Kai, Era, Finii, Octavia) are fast (465–470) with ~1150 Stagger. Power is spread
across the roster with no clear pattern (85–115).

### 4.2 Damage / knockback formula
Every ability has **three separate values**: Core Knockback, Player Knockback and Player Damage, each `Base + X % Power`.

```
final = (base + powerRatio × Power) × (1 + Σ additive % bonuses) × target modifiers
```
Target modifiers: **Staggered = +254.5 % knockback** (and −75 % damage taken), damage-reduction effects, etc.
The Core only takes knockback.

**Strike only hits the Core.** The game's tutorial says "Remember, Strike can only hit the Core." Its player values only apply when a
kit upgrades it (e.g. X's ultimate). Ability slots in the game files: Q = Strike, E = Primary, W = Secondary, R = Special.

**Reference values** (Strike is the same for every striker):
| Ability | Core KB | Player KB | Damage | Cooldown |
|---|---|---|---|---|
| Strike (melee, "light") | 1230 + 125 % P | 150 + 75 % P | 75 + 37 % P | **0.9 s** |
| Energy Burst | — (next Core hit +50 %) | 200 + 100 % P | 150 + 100 % P | 3 s |
| Dubu Rollout (primary projectile) | 1320 + 170 % P | 170 + 78 % P | 170 + 78 % P | 10 s |
| Dubu Somerassault (secondary dash) | — | 200 + 100 % P | 200 + 100 % P | 20 s |
| Dubu Tofu Fortress (special, walls 2.5 s) | 1340 + 179 % P | 180 + 89 % P | 180 + 89 % P | 40 s |
| Kai Barrage (5 light fireballs, range 780) | 700 + 32 % P | 60 + 25 % P | 60 + 25 % P | 11.5 s |
| Kai Blazing Pace (+30 % speed 5 s) | — | — | — | 18 s |
| Kai Giga Blast (AoE fireball) | 1400 + 210 % P | 240 + 120 % P | 240 + 120 % P | 24 s |

Pattern: **primary ≈ 10–12 s, secondary ≈ 18–20 s, special ≈ 24–40 s**. Strike sits at <1 s and is the main
way you touch the Core. Abilities hit the Core only a bit harder than Strike, but they can do it from range or in an area.

### 4.2b Core physics (wiki "Core" page, "fun Core facts")
| Rule | Value | Our implementation |
|---|---|---|
| Hit sets speed | Core knockback is **capped at 2000** (Energy Burst: knockback and cap ×1.5) | `hitBall()` sets speed = min(knockback, cap) |
| Redirect | Within a **~90° cone** of its path: keeps current speed **+ ~2.5 %** of the hit | dot ≥ cos 45° and the Core is faster than the hit |
| Friction | Loses **~50 % of its speed per second** | half-life 1.0 s, plus a dead stop below 25 |
| Walls | Each rebound changes speed by **~100**: gains if slow, loses if fast | ±100 around a pivot of **1000 ⚠** (undocumented) |
| Red Core | Hit > **1750** → ignores friction below **2000** for **1 s** | `redTicks` |
| Visual | Yellow trail and brighter glow above **700** speed | glow/trail threshold 700 |
| Stun | A stunned Core takes no knockback and ignores gravity wells | M3 (abilities) |
| Body blocking | Not documented. Believed: strikers don't block the Core | `bodyBlocking: false` (switch in data) |

### 4.3 Stagger
- At 0 Stagger you're **Staggered**: you take +254.5 % knockback and −75 % damage. It ends once the bar refills to **50 %**.
  The bar regenerates fast while Staggered, but new damage delays that.
- **Passive regen:** 4 %/s of max Stagger after **2.375 s** without a normal hit (1.625 s after light hits).
- Full refill at the start of every round.
- Takeaway: a Staggered player near an edge is a guaranteed KO. That's how fights turn into openings to score.

### 4.4 Energy
- Start with **25**, max **75** (3 bars). Reset to 25 each set and on respawn.
- Gained from **light hits +1** (Strikes count as light), **normal hits +3** and **orbs +7.5**.
- **Evade:** costs 25, 3 s cooldown, **Elusive 1.5 s** (immune to damage and knockback). Using any ability ends it.
- **Energy Burst** (replaces Evade at 75 energy): spends everything. Knocks back and stuns enemies around you, you're
  Elusive, you get **exclusive control of the Core** for a moment, and your next Core hit gets **+50 % knockback**.
  Players call this a "Core Flip". It's the main finishing tool.

### 4.5 Status keywords
Stunned (also freezes the Core when applied to it), Knocked (pushed and stunned, no damage), Banished (removed from play
for a while, can't be targeted), Elusive and Immune (can't be targeted), Light hit (small slow and chip damage, no knockback unless the target is Staggered),
Impact (area hit), Creation (spawned walls and objects), Projectile, Dash/Blink/Haste (movement).

## 5. Loadout: Gear + Awakenings

**Gear** (pick 1 at Striker Select, **locked to your role**). Goalie gear stops working on the enemy's half.
| Forward gear | Effect |
|---|---|
| Slick Kicks | Core-hitting Strikes give +30 % speed for 1.25 s |
| Pummelers | +10 % knockback on players. +30 % speed while your team has more players on the field |
| Vicious Vambrace | Heal Stagger for 75 % of damage dealt |
| Magnetized Soles | Crossing midfield gives +18 % speed for 1.65 s |
| Siphoning Wand | Hits apply a damage-over-time (6 % of enemy max Stagger) and heal you for 125 % of it |

| Goalie gear | Effect |
|---|---|
| Momentum Boots | Speed builds up to +16 % over 10 s. Getting hit resets it |
| Eject Button | +50 % dash range, −25 % secondary cooldown. Recast to blink back to where you started |
| Strike Shot | +35 % projectile range. Every 11 s your Strike also fires a projectile |
| Powerhouse Pauldrons | +30 % size, +20 power, −15 % damage taken |

**Awakenings**: 34 passive perks in rotation, in groups (movement/range, stats, Core/impact damage,
cooldowns/creations, energy, speed/sustain, "Spark" synergies). Examples: *Bulk Up* (+300 Stagger), *Rapid Fire* (−25 %
primary cooldown), *Deadeye* (+25 % at 600+ range), *Team Player* (passes to allies hit harder), *Recovery Drone* (first KO
each set is prevented), *Knife's Edge* (+40 % speed near an edge, 0 power).

**Draft flow (Normal/Competitive):**
1. Striker Select: all 6 players see the **same 2 random awakenings** and each takes one.
2. After each set, there's a **shared pool of 8**, picked **one at a time and only once each**. Pick order comes from XP in that
   set (top XP on the winning team, then top XP on the losing team, and so on down).
3. So the match gets stronger and more varied as it goes on. Picking an awakening just to keep it from an opponent is a real tactic.

## 6. Roster & archetypes

21 strikers. The wiki groups them by price tier, not by class. Their stats and kits fall into these archetypes:
| Archetype | Examples | Identity |
|---|---|---|
| **Goalie / Wall** | Dubu, Atlas, Asher | Big size, high Stagger, slow. Walls, shields, area denial |
| **Skirmisher / Striker** | Kai, Era, Finii, Octavia | Fast, low Stagger, projectiles and speed buffs, good at scoring |
| **Bruiser / Brawler** | X, Mako, Juliette, Drek'ar | High power, gap-closers, combos that cause KOs |
| **Controller / Utility** | Ai.Mi, Juno, Luna, Rune, Zentaro, Nao, Vyce | Pulls, teleports, creations, buffs and heals, Core manipulation |

Every striker has the same frame: **Strike (shared) + Primary + Secondary + Special + Evade/Energy Burst**.

## 7. Tactics & meta knowledge

**Roles in practice**
- **Goalie** stays on their own half, standing in the Goal Arc for the knockback resistance. They read shots, protect the
  barriers, and use cooldowns on whatever threatens the goal. Going far forward leaves the goal open.
- **Forwards** pressure, look for passing lanes and disrupt the enemy forwards. They drop back when the Core comes to their side,
  and stay out of the goalie's space unless they've agreed to swap.

**Core play**
- **Don't Strike every time the Core is near.** Strike has a ~1 s cooldown, and wasting it just before a key moment loses
  duels. Timing your Strikes is one of the biggest skills in the game.
- **Ping-pong / strike wars:** trading Strikes at close range in front of a goal favours the attacker.
- **Bank shots:** bounce the Core off walls when no teammate is open. Unexpected angles beat goalies.
  "Soren angle": hitting it up the goal line so it bounces back like a dribble.
- **Short-range Core hits are almost impossible to block**, so pass in close before shooting.
- **Pass to whoever has full Energy** late in a set. Their Core Flip is the finisher.

**Fights / KOs**
- Stay away from the edges. Hunt enemies who are near them.
- Stagger first, then knock the target out: one big hit on a Staggered target near an edge = KO = a 3v2 power play.
  Teams fight in the round first, then convert the extra player into a goal.
- **OKI:** camp an enemy (usually the goalie) to chip their Stagger or KO them.
- **Ability rotation:** the team spends cooldowns one player at a time (9 abilities across 3 players) so pressure never
  stops. The goalie goes last because they're nearest the goal.

**Energy**
- Watch everyone's Energy. The player who can Core Flip is the threat.
- It resets every set, so use it or lose it. Evading to stay alive is a good use.
- Throwing abilities you expect them to dodge can drain their Energy (situational).

**Drafting & loadout**
- Have both control and brawl on the forward line.
- Choose your striker around the 2 starting awakenings. Ban strikers who are strong on this map or with these awakenings.
- Goalies want cooldown reduction or more charges. Brawlers want size and damage. Controllers want more creation size and longer buff durations.
- Find the enemy's weak side (fragile striker or weaker player) and play through it.

## 8. What this changes in our plan (PokéAthlon)

| Topic | Our draft v0.1 said | Research says → new design |
|---|---|---|
| Barrier | Hit a separate *target* to drop the barrier for 6 s | **The barriers are the targets.** The ball breaks a barrier on contact. Barriers stay down for the round. When the last one falls, the gate opens shortly after. Barrier count is set per stage (1–3) |
| Roles | 4 roles as team slots | **Team slots: 2 Forwards + 1 Goalie.** Striker/Passer/Brawler/Wall become each Pokémon's *archetype*. Held items are locked to the slot (Forward vs Goalie) |
| Match | First to 5 goals, best of 3 | Rounds → sets → match. **Start with first to 3 goals per set, first to 2 sets** (shorter for a fan game), tunable. Overtime after 60 s: +20 % ball knockback |
| Stats | "Stagger HP, knockback" | Use the full model: Power / Speed / Stagger (+ growth per level) / Cooldown Rate / Size. Knockback as `base + ratio × Power` with separate ball, player and damage values |
| Stagger | Generic | Staggered = +254.5 % knockback, −75 % damage. Ends at 50 %. Regen 4 %/s after ~2.4 s without being hit |
| Energy | Not in plan | **Add:** Evade (1 bar) + Energy Burst / "Core Flip" (3 bars). Energy from hits and orbs |
| Progression | Not in plan | **Add in-match levels 1–10.** Special unlocks at level 2, levels raise max Stagger |
| Items | Pick 1 held item + 1 per set | **Two layers:** Held Items (= Gear: role-locked, picked at select) + drafted **Boosts** (= Awakenings: 2 shown at start, then a shared pool of 8 drafted after each set) |
| Arena | Walls and some KO zones | **Every edge is a KO edge for players.** The ball bounces off all of them. Add the **Goal Arc** (defender's knockback-resistance zone) and **Power Orbs** (3 spawn points, 10 s then every 20 s) |
| Stage gimmicks | Hazards | Each stage needs one clear gimmick (like a gravity well, launch drums, portals or a speed gate). Pokébonk biomes give the theme |
| Units | — | Use OS-like units for easy comparison: speed ~450 u/s, Strike width ~250 u, Strike ball knockback ~1300 |

## 9. Open questions for the FModel pass

1. Goals per set and sets per match in each mode. Round timers.
2. KO respawn timer, Immune duration after respawn, Goal Gate open delay.
3. Core physics: mass, friction/deceleration, speed cap, how knockback adds onto existing velocity, the hit-stun on the Core.
4. Arena dimensions, barrier positions and sizes, goal width, Goal Arc radius.
5. XP values and the XP-per-level curve.
6. Full kits for all 21 strikers, to build a library of move archetypes.

---
Sources:
[OS Playbook (wiki)](https://omegastrikers.wiki.gg/wiki/Omega_Strikers_Playbook) ·
[Stats](https://omegastrikers.wiki.gg/wiki/Stats) ·
[Damage and Knockback](https://omegastrikers.wiki.gg/wiki/Damage_and_Knockback) ·
[Energy](https://omegastrikers.wiki.gg/wiki/Energy) ·
[Gear](https://omegastrikers.wiki.gg/wiki/Gear) ·
[Awakenings](https://omegastrikers.wiki.gg/wiki/Awakenings) ·
[Arenas](https://omegastrikers.wiki.gg/wiki/Arenas) ·
[Strikers](https://omegastrikers.wiki.gg/wiki/Strikers) ·
[Dubu](https://omegastrikers.wiki.gg/wiki/Dubu) ·
[Kai](https://omegastrikers.wiki.gg/wiki/Kai) ·
[148Apps advanced tips](https://www.148apps.com/news/omega-strikers-advanced-tips/) ·
[ItemLevel goalkeeper rotation](https://itemlevel.net/omega-strikers-goalkeeper-rotation-strategy/) ·
[HighGround beginner guide](https://www.highgroundgaming.com/omega-strikers-beginner-guide-how-to-play-tips-tricks/) ·
[TheGamer beginner tips](https://www.thegamer.com/omega-strikers-beginner-tips-guide/)
