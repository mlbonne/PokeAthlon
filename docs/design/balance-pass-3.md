# Balance pass 3 (2026-11-07) — in progress

**Goal:** cut Bronzong (forward 62–63 % in pass 2) and Blastoise (goalie ~68–70 % in every run so far), then collect firmer tier numbers.

**Method:** `npm run balance`, random-comp 3v3s with v2 bots at balance difficulty. A 600-game run gives each Pokémon only about 100 goalie games (±9 points), so the main check used 1200 games.

## Changes (in the kit files)

| Pokémon | Change |
|---|---|
| Bronzong | Gyro Ball stun 0.3 → 0.2 s; Heavy Slam cooldown 20 → 23 s |
| Blastoise | Stagger 1400 → 1350; Surf cooldown 12 → 14 s; Surf ball knockback ×0.85 (1064 + 1.4 → 904 + 1.19) |
| Pikachu | Power 85 → 80 (it climbed to 59 % / 63 % once the other two were cut) |

## 1200-game check (seed 3, all changes above)

| Pokémon | Forward | Goalie |
|---|---|---|
| Zeraora | 47.3 % | 47.9 % |
| Greninja | 41.0 % | **36.6 %** |
| Hoopa | 45.4 % | 46.2 % |
| Bronzong | 49.7 % | 59.4 % |
| Blastoise | 48.7 % | **66.7 %** |
| Hisuian Arcanine | 53.2 % | 55.4 % |
| Lucario | 54.4 % | 51.5 % |
| Pikachu | 55.7 % | 58.8 % |
| Machamp | 52.0 % | **32.0 %** |

- **Fixed:** Bronzong as a forward (62 → 50 %).
- **Fine:** Blastoise as a forward (49 %).
- **Still open:** Blastoise in goal (67 % with 201 goalie games), and in all runs so far.

## Which part of Blastoise makes it strong in goal (600 games each, seed 4)

| Test | Forward | Goalie |
|---|---|---|
| All changes above (1200 games) | 48.7 % | 66.7 % |
| Surf turned off | 35.5 % | 51.4 % |
| Whirlpool turned off | 31.7 % | 56.1 % |
| Aqua Ring turned off | stopped at 390/600 games, no result | – |
| Stagger 1200, +300 per level | not run yet | – |

Earlier tests that didn't help:
- every Pokémon at normal size;
- a weaker Aqua Ring rescue;
- a longer Aqua Ring cooldown;
- the real Whirlpool ring.

**Reading:** no single move makes it a strong goalie. Taking away a whole move costs 10–15 points in goal and 13–17 as a forward. A goalie-only fix should therefore hit something only goalies lean on: Surf's ball knockback (its clear) or Whirlpool around the goal. Another option is to accept a strong-goalie support, as Atlas is in OS.

## Other things to balance

- **Greninja (37 %) and Machamp (32 %) in goal.** Both are forward-only kits, and this happens in every run.
  - **Eject Pack** is the worst held item, at 38.8 %. It's the default goalie item for Greninja's and Lucario's archetypes, and bots never use its blink-back.
  - **Rocky Helmet** is the best goalie item, at 58.9 %.
- **Held items:**
  - Muscle Band (58.5 %) is the best forward item.
  - Poison Barb (44.4 %) and Shell Bell (45.8 %) are the weakest forward items.
- **Agility** is the best boost, at 63 %, again.
