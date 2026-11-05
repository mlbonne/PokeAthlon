# M5 — Meta

> Goal: a match feels like an OS match from menu to scoreboard. Pick screen, a full roster of 8, held items,
> drafted boosts, and an end-of-match results screen. 3v3 is the only mode.

Design sources: [GAME_BREAKDOWN.md](GAME_BREAKDOWN.md) §9–11 and §13 (kits, items, boosts),
[research/omega-strikers.md](../research/omega-strikers.md) §2, §5 and §7a (Striker Select, Gear, Awakenings, accolades, MVP).

## Starting point (end of M4 and the brawling rework)

- **Roster.** 4 playable kits: Pikachu, Togekiss, Snorlax and Lucario. The other 4 (Greninja, Alakazam, Blastoise, Machamp)
  already have roster stats and imported sprites, but no kits.
- **Move system.** 5 action types: `projectile`, `area` (circle, cone, line; self or target), `dash`, `buff`, `wall`.
  Missing the OS patterns the new kits need: charge-and-release, recast, sweet spots, delayed areas, channels,
  ball grab, teleport/swap, banish, Strike modifiers, side-of-field conditions.
- **Setup screen** (`client/src/setup.ts`): role, CPU skill and 6 Pokémon slots. No items, boosts, bans or CPU picks.
- **Match flow.** Rounds → sets (first to 3 goals) → match (first to 2 sets). `setOver` is just a 4 s pause.
- **Stats.** Telemetry already has everything an OS scoreboard shows: goals, assists, KOs, saves, damage, shots, redirects, orbs.
  It is only shown in the F3 meter and in tool reports.
- **Balance tools.** Analyzer, batch sim, tiers, impact and playstyle all work from data, so new kits get numbers on day one.
- **Balance state.** Snorlax T0, Togekiss A, Pikachu B, Lucario D. Tuning is still deferred until you ask for it.

## Design principles

1. **New mechanics are data, not per-Pokémon code.** Every new pattern becomes a generic action or modifier in the kit schema.
   The analyzer measures it and the bot `MoveModel` understands it. Same rule as M4's "one brain for every Pokémon".
2. **Every new mechanic ships with its bot support and analyzer support in the same step.** Otherwise the balance tools
   would lie about the new kits.
3. **Items and boosts are modifiers on existing numbers.** Hooks on events (ball Strike, hit, damage dealt, crossing midfield,
   barrier break, KO) plus stat multipliers. No item gets its own code path in the sim loop.
4. **Determinism stays.** Boost offers and CPU picks use the seeded RNG, so a match seed replays the whole match, picks and drafts included.
5. **Tools see everything.** `--set` what-ifs, the batch sim, tiers and the F3 meter learn about items and boosts, so their win rates can be measured like a kit's.

## Part A — Full roster

### 5.1 Move-system extensions

Everything the 4 new kits need, as generic schema features (each with sim tests, analyzer numbers and a bot `MoveModel`):

| Feature | What it does | Used by |
|---|---|---|
| **Charge** (hold-to-charge) | Hold the button to grow range/power from `min` to `max` over `chargeTime`. Release to fire. Slowed while charging | Greninja Hydro Cannon |
| **Recast** | A second press within a window does a follow-up action (throw, blink back, detonate) | Alakazam Psychic |
| **Sweet spot** | A sub-zone of an area (tip or centre) with its own, stronger hit | Greninja Night Slash, Machamp Cross Chop |
| **Delayed area** | An area that telegraphs, then hits after `delay` | Alakazam Future Sight |
| **Channel** | A beam or cone that ticks while active, with a steady push | Blastoise Hydro Pump |
| **Ball grab** | Hold the ball in front of the caster for a short time (the only "hold" in the game), then release or throw it | Alakazam Psychic |
| **Teleport / swap** | Blink to a point, or swap places with an ally | Alakazam Teleport, Greninja Shadow Sneak (delayed blink along a line) |
| **Banish** | New status: removed from play for a short time, untargetable, then returns where it left | Alakazam Future Sight |
| **Strike modifier** | Passive charges that upgrade Strike (for example "after 3 enemy hits, the next Strike also fires a projectile") | Greninja |
| **Transform buff** | A self buff that changes Strike (hits players heavily), size, and knockback taken | Machamp No Guard |
| **Guarded dash** | A dash with knockback resistance and less damage taken, ended early by Stagger damage | Blastoise Rapid Spin |
| **Side condition** | A field on any action: stronger/unbreakable on your own half | Blastoise Water Pulse wall |

Done when: every feature has a unit test, the analyzer reports it (charge = min/max columns, channel = DPS over its duration,
grab = ball control time), the debug overlay draws it, and a test kit using all of them passes schema validation.

**✅ What shipped (5.1)**
- **Kit schema** (`packages/data/src/kits.ts`):
  - **New action types:** `channel`, `blink` (`aim` / `ally` with `swap` / `mark`), `grab`, `throw`.
  - **On every action:** `telegraph`, plus `side: { own, enemy }` multipliers.
  - **On areas:** `sweetSpot { from, to, angleDeg?, hit }`.
  - **Dash guard:** `knockbackResist`, `damageReduction`, `breakOnDamage`.
  - **Transform buffs:** `sizePct`, `powerAdd`, `knockbackTakenPct`, `strikeHit`.
  - **On hits:** `banish`.
  - **On moves:** `charge { time, maxHold, min, slowPct, power, range }` and `recast { window, actions }`.
  - **On kits:** `passive { stacks, gainOn: moveHit | strikeBall, actions }`.
  - **Helpers:**
    - `scaleAction` / `scaleHit` / `chargeScale`;
    - `parseKit`;
    - `registerKit(id, json | null)`, which installs a kit at runtime for tests and kit drafts.
- **Sim** (`moves.ts`, `combat.ts`, `ball.ts`, `strike.ts`, `movement.ts`):
  - **Charging and channels:** charging (slowed, no Strike; the cooldown starts on release; interrupted = cooldown) and channels (pulses; a knock, stun or banish ends them).
  - **Recast window:** blink-back uses the cast position as the mark.
  - **Ball grab:**
    - the ball follows the holder and still breaks barriers and scores;
    - others can't Strike it;
    - any real hit on the holder drops it;
    - the hold times out into a throw or a drop.
  - **Blinks:**
    - clamped inside the arena;
    - hits along the path;
    - ally swap.
  - **Banish:** a new player state; untargetable, frozen, no ball collisions, back in place.
  - **Guarded dashes** break on damage.
  - **Transform buffs:** body size and power are recomputed from base stats plus buffs (`refreshBody`), and the transform Strike hits players.
  - **Strike-modifier passive.**
  - **Side conditions:** use the caster's half when the action fires.
  - **New events and hashing:** 11 new events (`telegraph`, `charge`, `recast`, `channel`, `blink`, `grab`, `release`, `banish`, `unbanish`, `guardBreak`, `passive`), and every new piece of state is hashed.
- **Analyzer:**
  - **New per-move fields:**
    - `chargeTime` / `chargeMin` (numbers at full charge; timing includes the charge);
    - `recastWindow` (recast actions count as part of the move);
    - `banish`, `ballControl`;
    - a `notes` summary (sweet spot, side, channel pulses, telegraph, swap…), shown in the Utility column of `npm run kits` and the F3 kit card.
  - **Best-case conventions:** channels count every pulse; transforms count a Strike per Strike cooldown; sweet spots and side conditions are taken at their best.
  - **Passive:** analyzed as a pseudo-move with an estimated trigger period (`passivePeriod`).
  - **Control:** banish and grab count toward the control budget.
- **Bots** (`MoveModel` + brain):
  - **Charges:** hold to full charge, re-aiming at the ball or the nearest enemy at release.
  - **Grabs:** grab to save a shot on goal or take a contested ball, then throw (recast) once there's a good shot.
  - **Ally swap:** rescues a teammate who is in danger.
  - **Aimed blinks:** chase the ball and hit along the path, like dashes.
  - **Transforms:** used when a fight is close.
  - **Channels:** aimed like a narrow self area.
  - **Banish:** adds value to a hit.
  - **Kill-line and finisher logic:** ignores buffs and grabs, so the M4 Normal-bot bug can't come back.
- **Client:**
  - telegraphs fade in on the ground;
  - blinks flash both ends;
  - an orange ring grows while charging (white at full);
  - a blue aura while channelling;
  - banished players are hidden;
  - sprites grow with transforms.
- **Tests:**
  - `packages/data/test/fixtures/m51-kits.json`: 4 test kits that together use every feature.
  - `data/test/m51.test.ts`: schema, scaling and analyzer.
  - `sim/test/mechanics.test.ts`: each mechanic, plus a deterministic bot 3v3 where Hard bots cast the charge, blink, channel, transform and guarded-dash moves.
  - **Result:** 145 tests pass.
- **Bot probe** (12 two-minute 3v3s on the test kits, not committed):
  - 77 of 79 grabs caught the ball, and 71 were thrown;
  - 8 banishes landed out of 35 casts;
  - swaps fired 14 times;
  - Normal bots never cast specials.

### 5.2 Forwards: Greninja and Machamp

Kits from GAME_BREAKDOWN §13:
- **Greninja** (Flashy Swordsman, Striker): Night Slash / Shadow Sneak / Hydro Cannon, plus a passive: after 3 enemy hits, the next Strike also throws a Water Shuriken.
- **Machamp** (Hulking Beast, Brawler): Cross Chop / Submission Rush / No Guard.

Numbers follow the §9 budget rules (M1 ~10–12 s, M2 ~18–20 s, Special ~25–40 s; ball knockback ≤ ~1.2× Strike) and start
near a power budget of 100 in the analyzer. Sprites: map each move to an existing SpriteCollab animation.

**✅ What shipped (5.2)**

Numbers come from the OS wiki (fetched 2026-11) for Zentaro and X, converted with the same rules as the M3 kits:
- player knockback = OS × 1.875 (the brawling rework's ×1.25 × 1.5);
- core knockback and damage are unchanged;
- "% Power" becomes `powerRatio`.

**Greninja** (`kits/greninja.json`, Zentaro model, Striker):

| Move | OS source | Our version |
|---|---|---|
| Passive: **Water Shuriken** | Slashing Strike (charge by hitting; 16 hits counting every light hit) | 6 move hits (our multi-hit moves count fewer hits). The next Strike lunges 180 and throws a piercing LIGHT shuriken: ball 1260+1.4, player 262+1.31, damage 140+0.7 |
| Primary: **Night Slash** (9 s) | Slice and Dice (7.5 → 9 s patch) | A LIGHT arc, then 0.45 s later a 140° slash. The **central 40° is a sweet spot** (ball 1300+1.6, player 300+1.5, damage 160+0.8); the sides are LIGHT, at 45 % of the centre |
| Secondary: **Shadow Sneak** (16 s) | Iai Rush | Telegraphed 0.5 s delay (can't be interrupted, as in OS), then a **blink** of 600 hitting the path: ball 1340+1.8, player 337+1.69, damage 180+0.9 |
| Special: **Hydro Cannon** (30 s) | — (GAME_BREAKDOWN §13; Zentaro's Oni's Blade wasn't used) | **Charge** 1 s (max hold 2 s, minimum 40 %, slowed 40 %), then a piercing beam 1100 long. At full charge: ball 1400+1.8, player 450+2.25, damage 240+1.2 |

**Machamp** (`kits/machamp.json`, X model, Brawler):

| Move | OS source | Our version |
|---|---|---|
| Primary: **Cross Chop** (11 s) | Bell Ringer | 0.6 s wind-up, then a 300-radius swing. The **outer 40 % is a sweet spot** (ball 1360+1.9, player 375+1.875, damage 200+1.0, radial); the inside is LIGHT at 33 % |
| Secondary: **Submission Rush** (14 s) | Bull Rush (85 % scaling patch) | 0.55 s wind-up, then a 600 rush. Other moves can be cast mid-rush. Ball 1360+1.9, player 300+1.59, damage 160+0.85 |
| Special: **No Guard** (40 s) | X Maximus! (45 s, +40 % size patch) | **Transform** for 3.5 s: +40 % size, Strikes hit players (player 281+1.41, damage 60+0.35), **+25 % knockback taken** (our drawback from §13; OS has none listed) |

**Theory budget** (`npm run kits`): Greninja **96 (B)**, Machamp **89 (C)**. Both are inside the 88–112 gate.

Not ported from OS:
- X's Strike cooldown resets when Maximus starts and ends;
- Zentaro's lunge on the passive is fixed at 180 (OS gives no number).

**Bot fix found by the measurement:**
- Transformed bots now brawl with Strike: they close in on the nearest enemy and swing toward that enemy's nearest edge (`·maul`).
- Before the fix, No Guard was cast but almost never landed, because bot Strikes only look for the ball:
  - No Guard hits per player-match: 6.3 → 17;
  - KOs per player-match: 0.07 → 3.1.

**Measured** (600 random-comp 3v3s, balance difficulty, after the fix; tier snapshot not updated until 5.4):

| Pokémon | Overall | Forward | Goalie |
|---|---|---|---|
| Machamp | **T0.5** | T0.5? 56 % | F? 39 % |
| Greninja | **D** | F? 40 % | D? 40 % |
| (Snorlax) | T0 | 68 % | 66 % |
| (Lucario) | A | 55 % | 57 % |

- Both are inside the 5.4 gate (D…T0.5 overall).
- Machamp is a forward and Greninja a striker, so weak goalie numbers are expected (OS X and Zentaro are forwards too).
- **Watch item for the balance pass:** Greninja is the weakest kit. Shadow Sneak lands on players in about 40 % of casts (the 0.5 s delay), and the centre sweet spot of Night Slash needs precise aim.
- Snorlax still pulls everyone else under 50 %.

### 5.3 Passer and wall: Alakazam and Blastoise

- **Alakazam** (Manipulating Mastermind, Passer): Psychic (grab, recast to throw) / Teleport (swap with an ally) / Future Sight (delayed banish).
- **Blastoise** (Shield User, Wall): Water Pulse (blast + wall, unbreakable on own half) / Rapid Spin (guarded dash) / Hydro Pump (channel).

These two add the passing and anti-brawl tools the rework doc anticipated, so they are the main test of whether
passing goes up (playstyle tool: clean passes, contested touches).

**✅ What shipped (5.3)**

Numbers come from the OS wiki (fetched 2026-11) for Rune and Asher, converted like the other kits (player knockback ×1.875).

**Alakazam** (`kits/alakazam.json`, Rune model + the §13 twist, Passer):

| Move | OS source | Our version |
|---|---|---|
| Primary: **Psychic** (10 s) | — (ours; Rune has no ball hold) | **Grab** the ball from up to 300 away and hold it 0.6 s (slowed 30 %; any hit drops it). **Recast** to throw: 1350+1.6, which is 1510 at Power 100, ≤ 1.2× Strike. If the hold runs out, it's tossed forward at 1000+1.0 |
| Secondary: **Teleport** (11 s) | Shadow Swap (11 s; an Unstable Anomaly where you left) | A psychic burst where you stand (radius 160; Anomaly numbers: ball 1290+1.85, player 469+2.34, damage 200+1.0, radial), then **swap** with the ally nearest your aim (≤ 900) |
| Special: **Future Sight** (40 s) | Banish (40 s, 1.75 s banish, 270+130 % damage) | Delivered as a **telegraphed** area: range 750, radius 190, erupts after 1 s, **banishes 1.75 s** and blasts the ball (1290+1.85) |

**Blastoise** (`kits/blastoise.json`, Asher model, Wall):

| Move | OS source | Our version |
|---|---|---|
| Primary: **Water Pulse** (10 s) | Barrier Beam (0.55 s wind-up; centre 175+87.5 %, LIGHT sides at 60 %; barrier stronger on own half) | 0.55 s wind-up, then a 650-long, 34° pulse. The **central 14° is a sweet spot** (ball 1330+1.75, player 328+1.64, damage 175+0.875); the edges are LIGHT at 60 %. A **wall** rises 260 in front (1.2 s; **side ×1.25 own half / ×0.4 enemy half**) |
| Secondary: **Rapid Spin** (14.5 s) | Breakthrough (stops on the first enemy, then 25 % damage reduction for 5 s; Primary castable mid-dash) | A 480 **guarded dash** (+150 knockback resist, −50 % damage, breaks after 15 % of max Stagger taken) that stops on the first enemy (ball 1260+1.4, player 262+1.31, damage 140+0.7), then −25 % damage for 5 s. Water Pulse can be cast mid-spin |
| Special: **Hydro Pump** (40 s) | — (§13; multi-hit like Pathsplitter's centre) | **Channel** for 1.5 s (slowed 60 %): a 700 × 170 jet pulsing 6 times. Each pulse: ball 900+0.8, player 94+0.47, damage 50+0.25 |

**Theory budget:** Alakazam **106 (B)**, Blastoise **90 (C)**. Both are inside 88–112.

**Bot changes:**
- An ally blink now decides how a move is used, even when the move also hits. Without this, Teleport was treated as a melee attack.
- Swaps also work as an escape: we're in danger and the ally is safe.
- Grabs are also used offensively: the ball is out of Strike range but in grab range, and a throw would be a good shot.

**Two bot findings from the measurements:**
1. **Imaginary threats.** The first run had Alakazam winning **86 % as forward**.
   - What-ifs showed it wasn't the kit:
     - with Psychic disabled: 85 %;
     - with Future Sight disabled: 87 %;
     - with Teleport's burst knockback set to 0: **28 %**.
   - Cause:
     - The bots' kill-line and finisher logic counted the burst as a knockback threat, so enemies backed away from Alakazam and handed it the ball.
     - Bots only cast Teleport to rescue or escape, so the threat was never real.
   - Fix: a shared `attacksPlayers(model)` predicate. Buffs, grabs and ally blinks are neither feared nor used to finish, so bots fear only what a bot of the same skill would actually throw at them.
2. **Telegraphs.** Bots now walk out of telegraphed enemy areas as soon as they appear (`telegraphEscape`, radially out of circles). Before, Future Sight landed 59 % of the time on bots that ignored the warning. Now it rarely lands on bots. Humans will decide whether it's too weak.

**Measured** (600 random-comp 3v3s with all 8, balance difficulty, after both fixes; tier snapshot is written at 5.4):

| Pokémon | Overall | Forward | Goalie |
|---|---|---|---|
| Snorlax | T0 | 69 % | 80 % |
| Blastoise | **T0.5** | A? 53 % | T0.5? 58 % |
| Machamp | T0.5 | 57 % | F? 37 % |
| Togekiss | A | 51 % | 57 % |
| Alakazam | **B** | F 32 % | B? 53 % |
| Lucario | B | 49 % | 48 % |
| Pikachu | C | 45 % | 39 % |
| Greninja | D | 41 % | F 36 % |

- Every new kit is inside D…T0.5 overall.
- Ladder: v2 beats v1 in **100 %** of the 8 rotating 3v3 mirrors (gate ≥ 80 %).
- **Watch items for the balance pass:**
  - Snorlax is still T0;
  - Alakazam is weak as a forward (Future Sight is easy to dodge, and the grab rarely turns into goals);
  - Greninja is the weakest overall.

Not ported from OS:
- Rune's shadow placed at round start (Teleport only swaps with allies);
- Asher's barrier breaking after one hit on the enemy half (approximated by the short ×0.4 duration);
- Breakthrough's −20 % Strike cooldown on your half.

### 5.4 Roster sanity gate (not a balance pass)

Run `kits`, `balance` and `playstyle` with all 8.
- **Gate:** every new kit lands between budget 88 and 112 in theory, and between D and T0.5 in measured win rate.
  Kits outside that get their numbers fixed before they ship.
- The existing 4 are not tuned here. The full balance pass stays your call; the report just shows where all 8 stand.
- The ladder still checks bot quality: v2 vs v1 ≥ 80 % on 3v3 mirrors that now rotate through 8 kits.
- Playstyle check: the brawling rework's numbers (crowding, KOs/min, clean passes) shouldn't get worse with the new kits.

**✅ Result (5.4): the gate passes.**
- **Theory budgets:** all new kits are between 88 and 112 (Greninja 97, Alakazam 106, Blastoise 90, Machamp 90).
- **Measured tiers:** all new kits are between D and T0.5 overall (table in 5.3).
- **Tier snapshot** (`balance/tiers.json`, F3 Tiers tab): rewritten from 600 random-comp 3v3s with all 8.
- **Ladder:** v2 beats v1 in 100 % of the 8 rotating mirrors.
- **Playstyle** (`npm run playstyle`, 40 random-comp 3v3s with all 8) against the rework's "after" numbers:

| Metric | After the rework (4 kits) | Now (8 kits) |
|---|---|---|
| KOs per live minute | 2.4 | 2.4 |
| Staggers → KO | 31 % | **38 %** (target ≥ 35 % now met) |
| Goals on a power play | 21 % | 22 % |
| Crowded (3+ of 4 forwards) | 16 % | 16 % |
| Forward spread | 472 | 481 |
| Clean passes per live minute | 10.2 | 10.6 |
| Contested touches | 36 % | 35 % (still the open item) |
| Goals per live minute | 2.0 | 1.9 |

- Nothing got worse.
- The passer and wall kits didn't raise passing on their own: bots pass the same way whatever the kit.
- Open balance items for when you ask for a balance pass:
  - Snorlax T0 (69 % / 80 %);
  - Greninja D and Alakazam forward F;
  - Easy bots possibly too strong (from M4).

## Part B — Loadout

### 5.5 Held items

The 9 items from GAME_BREAKDOWN §10: 5 Forward items (Choice Scarf, Muscle Band, Shell Bell, Quick Powder, Poison Barb)
and 4 Goalie items (Quick Claw, Eject Pack, Zoom Lens, Rocky Helmet).
- `packages/data/items/items.json` with a Zod schema: slot (`forward` | `goalie`), effects as hooks + stat changes.
- Sim: `PlayerSpawn.item`. Item hooks run from events. Goalie items stop working on the enemy half (OS rule).
- Telemetry and tools: per-item win rate and pick rate in `balance`, an item column in the tier report, and `--set` support
  (`item.choice-scarf.speed*=1.2`).
- Bots: an item choice per Pokémon and role, from data hints (a brawler takes Muscle Band) or from the balance snapshot
  when it exists.
- F3 meter: shows the active item and its live state (Quick Claw stacks, Poison Barb ticks).

### 5.6 Boosts and the between-set draft

A starter set of about **16 boosts** covering OS's families (movement, stats, ball, cooldowns, energy, sustain, edge, anti-KO,
synergy); examples are in GAME_BREAKDOWN §11.
- **Draft flow, as in OS:**
  1. At the pick screen, everyone sees the same 2 random boosts and each player takes one.
  2. After each set, there's a shared pool of 8, drafted one at a time, each taken only once. Pick order comes from XP that set:
     top XP on the winning team, then top XP on the losing team, alternating down.
- Sim: boosts are stackable modifiers on the player, stored in the world (hashed). A new `draft` phase replaces the `setOver` pause.
  The match waits for picks; headless runs pick instantly.
- Bot drafting: value per boost for its Pokémon and role, plus denial (taking what the enemy wants most) at Hard.
- Tools: per-boost win rate and pick rate, `--set` support, and a `--boosts off` flag so kit balance can still be measured without them.

## Part C — Screens

### 5.7 Pick screen (replaces the setup screen)

OS-style Striker Select for 6 players:
- **Flow:** choose role → Pokémon → held item (only your role's) → starting boost. Your two CPU teammates and the three
  CPU enemies pick at the same time, visibly.
- **Rules:** no duplicate Pokémon within a team; mirrors across teams are allowed (as in OS).
- **CPU picks:** a draft AI that fills 2 Forwards + 1 Goalie and uses the tier snapshot (per-role tiers, matchup matrix)
  to pick good comps. Easy picks at random; Hard counter-picks.
- **Bans (optional toggle, off by default):** each team bans one Pokémon before picks, like OS Competitive.
- **Panels:** each Pokémon's card shows archetype, stats, its 3 moves with the analyzer's numbers (reach, cooldown, knockback),
  and its per-role tier.
- **Keeps:** CPU skill, Watch CPU vs CPU, Practice, saved last picks.
- **Controls:** full gamepad navigation (D-pad/stick, A/B), as the setup screen has now.

### 5.8 Between-set draft screen

The 8 boosts as cards, the pick order down the side, a short timer per pick, and the CPUs' picks shown as they happen.
Shows the set score and each player's boosts so far.

### 5.9 Results screen

After the match (and a short version after each set):
- **Scoreboard:** Goals, Assists, KOs, Saves, Damage, Shots, Redirects and Orbs per player, from telemetry.
- **MVP per set, one for Forwards and one for Goalies** (OS rule): uses `mvpScore`, weighted by role, with saves highlighted for goalies.
- **Accolades:** OS-style call-outs ("3 KOs", "10+ Saves", "Top Damage", goal streaks), using our own names.
- **Buttons:** Rematch (same picks), Back to pick screen, and Watch replay (if the recorder can do it cheaply).
- **Tab / Back:** hold to see the scoreboard during the match.

### 5.10 Wrap-up

Docs, a "what shipped" section here, PLAN.md, a fresh `balance/tiers.json` with 8 Pokémon, items and boosts,
and the tag `v0.6.0-m5`.

## Order and risks

Order: **5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8 → 5.9 → 5.10.**
Kits come first because they are the biggest unknown and everything else (pick screen cards, item value, the draft AI) reads from them.

| Risk | Mitigation |
|---|---|
| New mechanics (grab, banish, swap) confuse the bots | Each mechanic ships with its `MoveModel` and an AI test. The ladder and playstyle numbers are checked after every kit step |
| Psychic's ball grab breaks the game (unblockable carries) | Short hold (0.6 s), slowed while holding, any hit on Alakazam drops the ball. Measured with possession and contested-touch stats |
| Items and boosts hide kit balance | `--boosts off` / `--items off` in the tools; tier reports show kit-only and full-loadout numbers side by side |
| Pick and draft screens bloat `main.ts` | A small screen manager (setup → pick → match → draft → results) in its own module |
| Determinism breaks with drafts | Draft picks are inputs (like movement), recorded with the seed. Golden replay test with boosts |

## Decisions for you (defaults in bold)

1. Boosts in M5 or later? **In M5** (it's the "meta" milestone). Alternative: ship items only and move boosts to M6.
2. Bans: **optional toggle, off by default.**
3. Match length: **keep first to 2 sets** (OS uses 3).
4. Kits follow **GAME_BREAKDOWN §13** (newer than PLAN §5's sketches). Machamp gets Submission Rush, not Seismic Toss.
5. New kits get a **sanity gate only** (5.4). The full balance pass stays deferred until you ask for it.
