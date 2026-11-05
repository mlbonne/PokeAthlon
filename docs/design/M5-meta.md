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

### 5.2 Forwards: Greninja and Machamp

Kits from GAME_BREAKDOWN §13:
- **Greninja** (Flashy Swordsman, Striker): Night Slash / Shadow Sneak / Hydro Cannon, plus a passive: after 3 enemy hits, the next Strike also throws a Water Shuriken.
- **Machamp** (Hulking Beast, Brawler): Cross Chop / Submission Rush / No Guard.

Numbers follow the §9 budget rules (M1 ~10–12 s, M2 ~18–20 s, Special ~25–40 s; ball knockback ≤ ~1.2× Strike) and start
near a power budget of 100 in the analyzer. Sprites: map each move to an existing SpriteCollab animation.

### 5.3 Passer and wall: Alakazam and Blastoise

- **Alakazam** (Manipulating Mastermind, Passer): Psychic (grab, recast to throw) / Teleport (swap with an ally) / Future Sight (delayed banish).
- **Blastoise** (Shield User, Wall): Water Pulse (blast + wall, unbreakable on own half) / Rapid Spin (guarded dash) / Hydro Pump (channel).

These two add the passing and anti-brawl tools the rework doc anticipated, so they are the main test of whether
passing goes up (playstyle tool: clean passes, contested touches).

### 5.4 Roster sanity gate (not a balance pass)

Run `kits`, `balance` and `playstyle` with all 8.
- **Gate:** every new kit lands between budget 88 and 112 in theory, and between D and T0.5 in measured win rate.
  Kits outside that get their numbers fixed before they ship.
- The existing 4 are not tuned here. The full balance pass stays your call; the report just shows where all 8 stand.
- The ladder still checks bot quality: v2 vs v1 ≥ 80 % on 3v3 mirrors that now rotate through 8 kits.
- Playstyle check: the brawling rework's numbers (crowding, KOs/min, clean passes) shouldn't get worse with the new kits.

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
