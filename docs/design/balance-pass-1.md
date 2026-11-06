# Balance pass 1 (2026-11-06)

The first balance pass, done together with the roster changes of the same day:
- Snorlax → Bronzong;
- Alakazam → Hoopa (Hyperspace Hole);
- Pikachu → Zeraora;
- Togekiss removed;
- Hisuian Arcanine added with the Asher kit;
- Blastoise reworked into Atlas.

**How every number was measured:** `npm run balance` plays 600 random-comp 3v3s with random items and bot boost drafts, with v2 bots at balance difficulty. Each role's win rate has about ±7 % of noise (95 % CI) at these sample sizes.

## Start → end

Start: the 8-Pokémon roster before the pass. End: the roster after the changes above, with the final numbers.

| Pokémon | Forward (start → end) | Goalie (start → end) |
|---|---|---|
| Bronzong (was Snorlax) | 61.9 % → 55.4 % | 64.8 % → 56.4 % |
| Machamp | 65.5 % → 50.7 % | 35.5 % → 40.9 % |
| Lucario | 60.1 % → 60.6 % | 53.3 % → 54.4 % |
| Hoopa (was Alakazam) | 31.1 % → 33.7 % | 44.1 % → 43.1 % |
| Zeraora (was Pikachu) | 39.2 % → 42.6 % | 41.8 % → 39.6 % |
| Greninja | 41.9 % → 48.3 % | 45.0 % → 40.0 % |
| Blastoise (Asher → Atlas) | 55.3 % → 51.3 % | 63.0 % → 63.9 % |
| Hisuian Arcanine (new, Asher kit) | – → 56.3 % | – → 57.0 % |

The spread narrowed:
- **Forward:** 31–66 % → 34–61 %.
- **Goalie:** 35–65 % → 40–64 %.

The new Blastoise (Atlas) came in at 68 % forward and 85 % goalie before tuning.

## Changes

**Pokémon**
- **Bronzong:**
  - size very-large → large;
  - Stagger 1500 → 1400 (+450 per level, was +500).
  - Its edge was the body (the biggest Strike and blocker), not its moves: Light Screen landed 0.9 times a game.
- **Machamp:**
  - No Guard's player knockback −20 %;
  - Power 115 → 110.
  - No Guard got 3.5 KOs a game.
- **Lucario:** Aura Sphere's player knockback −15 % (3.7 KOs a game).
- **Hoopa:**
  - Power 100 → 110, speed 455 → 465, Stagger 1150 → 1250 (+350 per level);
  - Hyperspace Hole cooldown 11 → 9 s;
  - Future Sight radius 190 → 240, delay 1.0 → 0.75 s.
- **Zeraora:** Power 95 → 105.
- **Greninja:** Power 105 → 115.
- **Blastoise (Atlas):**
  - Surf: cooldown 10 → 12 s, radius 85 → 65, ball ×0.8, player knockback ×0.85;
  - Whirlpool: one follow-up hit, not two;
  - Aqua Ring: cooldown 35 → 45 s, 4 % a pulse (OS's older value);
  - Stagger +425 per level, not +500.
- **Hisuian Arcanine:** Power 105. Blastoise's old Asher kit kept its Hydro Pump (now Flamethrower) −10 % player knockback from this pass.

**Items**
- Rocky Helmet: +20 → +10 Power, −15 → −10 % damage taken.
- Eject Pack: −25 → −35 % secondary cooldown.
- Shell Bell: heals 75 → 100 % of damage dealt.
- Choice Scarf: +30 → +25 % speed.

**Boosts**
- Speed Boost: up to 6 → 4 stacks.
- Light Clay: walls last +60 → +40 %.
- Quick Draw: −25 → −35 % primary cooldown.
- Tough Claws: +15 → +25 %.
- Poison Touch: 10 → 14 % burn.
- Run Away: +40 → +50 % speed.

## Still open

- **Normal-size Pokémon are weaker than large ones.** Lucario is the only normal-size Pokémon above 50 %.
  - Large bodies get a wider Strike (265 vs 250) and more blocking.
  - OS pays normal sizes back with speed, and our bots don't turn speed into much.
  - This is a structural question (Strike widths, or bots using speed). It shouldn't be solved by more stat tweaks.
- **Hoopa forward 34 %.**
  - Disabling Psychic made it worse (29 %), so the grab isn't the problem.
  - Future Sight still lands about 0.5 times a game: bots only cast delayed areas on slow targets.
- **Blastoise goalie 64 %.** Aqua Ring's rescue protects the goalie the most (77 % with the rescue off vs 86 % on, in a 300-game test).
- **Items:** Eject Pack 36 % is still mostly a bot gap (bots never blink back).
- **Boosts:** Speed Boost (64 %) and Poison Touch (33 %) swing a lot between runs. They're probably noisy at about 280 and 140 samples.

The baseline for the next pass is `reports/balance-baseline.json`. The tier snapshot is in `packages/data/balance/tiers.json`.
