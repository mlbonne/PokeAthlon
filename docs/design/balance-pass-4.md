# Balance pass 4 (2026-11-07): Hisuian Decidueye, Alolan Ninetales, roles

**Method:** `npm run balance`, 1,200 random-comp 3v3 games per run (v2 bots at balance difficulty, random items, boost drafts). There were six runs: one baseline, four with what-if changes, and one final run that writes the snapshot.

**Caution:** a run with `--seed N` plays seeds N … N+1199. The runs here (seeds 21–26) therefore share almost all of their matchups.
- That makes them a **controlled comparison**: each change was measured on nearly the same set of games.
- It does **not** average out noise. The next pass should use seeds 1200+ apart (for example 1, 1201, 2401) to get independent samples.

## Design calls (user, 2026-11-07)

Roster `bestRole` field, shown as a label in the lobby, Pokédex and pick screen:

| Pokémon | Role | What it means |
|---|---|---|
| Blastoise | `goalie` | "Strong goalie". Its ~65 % goalie win rate is intended |
| Greninja, Machamp | `forward` | "Brawler". CPU picks and balance runs never put them in goal, and they have no goalie tier |
| Everyone else | `flex` | Either role |

## New Pokémon

**Hisuian Decidueye** (Whip Fighter): the OS Rasmus model, from data-mined `GA_WhipSmack`, `GA_Whiplash`, `HV_Whiplash`, `GA_Lasso` and `Proj_Lasso`. Power 100, speed 455, Stagger 1300 (+300 per level), normal size.
- **Leaf Blade:** a 450-long line after a 0.4 s wind-up. The tip (the last 38 %) is a full hit; closer in is a LIGHT hit at 55 % on players and 77.5 % on the ball.
- **Trailblaze:** +35 % speed for 2.25 s. A recast within that time is a LIGHT spin (radius 250).
- **Spirit Shackle:**
  - an arrow at 1,700/s that pulls the first enemy at 70 % power and keeps flying (any later enemies take a weak LIGHT hit);
  - at 550 range it spins: 6 hits 0.25 s apart, ball 1,395 + 400 %.

**Alolan Ninetales** (Tempo Sniper): the OS Estelle model, from data-mined `GA_SniperShot`, `GA_BlinkShot`, `Proj_BlinkShot`, `GA_Volley` and `Proj_Volley`. Power 105, speed 450, Stagger 1150 (+200 per level), normal size.
- **Ice Beam:** a 1,000 × 120 line after a 0.4 s wind-up. It hits everyone in it.
- **Ice Shard:** blink 400, then a shard at 1,600/s that **homes** on the nearest enemy, or the ball, within 700.
- **Blizzard:** 7 LIGHT icicles in a 35° fan at 1,800/s, range 850. **Each enemy is hit at most once per volley.**

**New generic sim options:**
- `projectile.homing`: deterministic steering with the sim's `dsin`/`dcos`, never `Math` trig.
- `projectile.volleyOnce`.

## Changes from the runs

| Pokémon | Change | Why |
|---|---|---|
| Hisuian Decidueye | Spirit Shackle spin 8 → 6 hits, player knockback ×0.8 | 59.5 % as a forward; the spin got 2.4 KOs a game |
| Pikachu | Electroweb cooldown 10 → 11 s; Charge +25 → +20 % | 61 % / 57 % |
| Machamp | No Guard Strike knockback ×0.85 | 59–61 % as a pure forward |
| Bronzong | Power 100 → 95 | 58 % / 59 % in two runs |
| Greninja | Power 115 → 120 | 42 % as a pure forward |
| Hoopa | Power 115 → 120, Stagger 1250 → 1350, Hyperspace Hole cooldown 8 → 7 s | 39 % in both roles |
| Zeraora | Power 110 → 115, Wild Charge cooldown 18 → 16 s | 44 % / 37 % |
| (tried, reverted) Hoopa | Psychic 8 s, 350 grab radius, stronger auto-throw | Made no difference (36 %): the grab isn't Hoopa's problem |

## Final run (seed 26, also the tier snapshot)

| Pokémon | Role | Forward | Goalie |
|---|---|---|---|
| Alolan Ninetales | flex | 55.8 % | 51.7 % |
| Bronzong | flex | 56.6 % | 54.6 % |
| Lucario | flex | 55.4 % | 40.3 % |
| Hisuian Arcanine | flex | 52.6 % | 54.2 % |
| Pikachu | flex | 51.1 % | 60.2 % |
| Machamp | brawler | 50.6 % | – |
| Hisuian Decidueye | flex | 49.7 % | 47.6 % |
| Greninja | brawler | 46.0 % | – |
| Zeraora | flex | 45.7 % | 33.2 % |
| Blastoise | strong goalie | 45.5 % | **65.8 %** (intended) |
| Hoopa | flex | 43.3 % | 45.1 % |

Every forward number is between 43 % and 57 %.

**Held items:**
- Eject Pack rose to 46 % (it was 39–40 %), now that brawlers don't pull goalie numbers down.
- Shell Bell is the weakest forward item at 42.5 %.
- Rocky Helmet is the best goalie item at 55.7 %.

## Still open

- **Zeraora in goal (33 %):** a speedster kit. It could become a second "brawler" if you want; it's the same design call as Greninja and Machamp.
- **Lucario in goal (40 %)** and **Pikachu in goal (60 %):** these swing a lot between runs. Check them with independent seeds first.
- **Hoopa (43–47 %):** still the weakest flex. Future Sight lands about 5 times a game but never KOs. It would be the next lever.
- **Shell Bell (42.5 %):** the forward item to look at next.
