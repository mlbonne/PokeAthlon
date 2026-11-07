# Balance pass 2 (2026-11-07)

This pass had three goals:
- close the normal-size vs large gap from pass 1;
- fix Hoopa;
- add Pikachu (OS Octavia model) without breaking the balance.

**Method:** same as pass 1 (`npm run balance`, 600 random-comp 3v3s, v2 bots at balance difficulty). Each role's win rate has about ±7 % of noise. Between runs with identical settings for a Pokémon, its number moved by up to 8 points (Bronzong forward 54.7 → 62.2), so read single numbers with care.

## What the size gap really was

Two 300-game diagnostic runs, made with the new `--set <mon>.size=<class>` tuning:

| Run | What changed | Result |
|---|---|---|
| A | Every Pokémon normal size | The large Pokémon barely moved (Bronzong 52 %, Hisuian Arcanine 56 %, Blastoise goalie 81 %). Zeraora 38 % and Hoopa 35 % stayed low. |
| B | Every Pokémon Stagger 1300 (+375 per level) | Hisuian Arcanine 56 → 47 %. Zeraora and Hoopa stayed low. |

**Conclusion:** body size isn't the problem: the Strike width and body radius barely matter. The gap came from two things:
- two weak normal-size kits, Zeraora and Hoopa;
- the large Pokémon's bigger Stagger pools and Stagger growth.

So this pass fixes those, not the size table.

## Changes

**Mechanics (generic, data-driven)**
- **Tracking target areas** (`area.track`): the area locks onto the enemy closest to the aim point and follows them. Evade dodges it.
  - The client draws a disc that follows the target and fills in as the hit nears.
  - Bots aim them straight at the target, and evade them like any other area about to land.
- **Per-hit slows** (`hit.slow: {pct, time}`). A LIGHT hit's default slow is now also tracked per player (`slowFrac`).
- **Piercing follow-up hit** (`projectile.pierceHit`): the hit used after the first player hit.
- **Buffs that refresh on any hit** (`buff.refreshOnHit`), with players and the ball counting and Strike included.
- **Buffs that hold their move's cooldown until they end** (`buff.cooldownAfter`).
- **Size tuning:** `npm run balance -- --set all.size=normal` (or any Pokémon / size class).

**Pokémon**
- **Hoopa:**
  - Future Sight now locks onto an enemy and follows them at 300/s (radius 200, 1 s). It went from 0.4 to about 4.7 hits a game.
  - Power 110 → 115.
  - Hyperspace Hole cooldown 9 → 8 s.
- **Zeraora:**
  - Power 105 → 110.
  - Discharge damage +25 % (its LIGHT bolts chipped but never set up KOs on the tanky Pokémon).
  - Wild Charge cooldown 24 → 18 s.
- **Bronzong:** Stagger 1400 → 1350, +400 per level (was +450).
- **Blastoise, Hisuian Arcanine, Machamp:** +375 Stagger per level (was +425).
- **Blastoise:** Aqua Ring cooldown 45 → 55 s; the KO rescue restores 50 % Stagger (was 75 %).
- **Pikachu (new, OS Octavia, Ramping Speedster):** Power 85, speed 470, Stagger 1150 (+200), normal size.
  - **Electroweb** (Sonic Boom): a piercing wave, 10 s, range 750.
    - The first enemy hit takes a NORMAL hit and a 35 % slow for 1 s.
    - Enemies after that take LIGHT 50 % hits and a 0.25 s slow.
  - **Charge** (Flow State): +25 % speed for 2.5 s.
    - Any hit resets it.
    - The 17 s cooldown starts when it ends.
  - **Thunder** (Bass Drop): after 1 s, 5 pulses 0.25 s apart around Pikachu, who keeps moving.
    - Only the first pulse hits the ball (OS: the Core takes its momentum once).
  - **Balancing Pikachu:** it came in at 67 % forward / 62 % goalie.
    - Charge was cut from OS's 33 % to 25 %.
    - Electroweb lost 15 % player knockback, its cooldown went 9 → 10 s and its range 900 → 750.
    - Thunder's pulses 2–5 no longer hit the ball.

## Result (final run, also the tier snapshot)

| Pokémon | Size | Forward | Goalie |
|---|---|---|---|
| Zeraora | normal | 41.8 % (pass 1: 42.6) | 39.3 % (39.6) |
| Greninja | normal | 42.7 % (48.3) | 33.0 % (40.0) |
| Hoopa | normal | **47.4 %** (33.7) | 49.5 % (43.1) |
| Lucario | normal | 48.8 % (60.6) | 42.7 % (54.4) |
| Pikachu | normal | 53.8 % (new) | 56.5 % (new) |
| Bronzong | large | 62.2 % (55.4) | 58.2 % (56.4) |
| Blastoise | large | 57.4 % (51.3) | 68.5 % (63.9) |
| Hisuian Arcanine | large | 48.9 % (56.3) | 50.0 % (57.0) |
| Machamp | large | 53.2 % (50.7) | 42.9 % (40.9) |

- **Hoopa is fixed:** 47 % forward / 50 % goalie, up from 34 % / 43 %.
- **Pikachu went in without breaking anything:** no other Pokémon moved more than run-to-run noise because of it.
- **Averages by size:**

  | Size | Forward | Goalie |
  |---|---|---|
  | Normal | 47 % | 44 % |
  | Large | 55 % | 55 % |

  The gap is still there, but most of it is now just two Pokémon, Bronzong and Blastoise. Hisuian Arcanine and Machamp sit near 50 %.

## Still open

- **Blastoise in goal (~70 % in all four runs).**
  - Neither the weaker rescue nor a longer cooldown moved it, so it isn't Aqua Ring.
  - It isn't Whirlpool either. After this pass, Whirlpool was rebuilt to match OS's Cosmic Expanse (data-mined `HV_Halo`): a ring that stays on the ground and bounces out what enters it.
    - The old version was a burst plus one delayed hit.
    - The rebuild left Blastoise at 49 % forward / 68.5 % goalie in a 600-game check.
  - Next suspect: Surf's long pierce (a goalie's clear through every attacker).
- **Bronzong:** 54–63 % forward across four runs (62–63 % in the last two). It needs one more small cut.
- **Greninja and Machamp in goal (33 % and 43 %):** forward-only kits with no defensive tool. Some of that is intended: OS has bad-goalie strikers too.
- **Zeraora (~41 %):** still the weakest forward.
  - Agility gives it nothing in bot play (0 hits, as expected for a haste).
  - Its strength depends on bots using speed, the same gap as Eject Pack.
- **Noise:** at 600 games, single numbers swing by up to 8 points. Decisions in the next pass should use 1200-game runs or the average of two runs.

The baseline for the next pass is `reports/balance-baseline.json`. The tier snapshot is in `packages/data/balance/tiers.json`.
