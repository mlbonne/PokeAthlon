# M4 — The 3v3 Patch

> Goal: real 3v3 matches against **smart CPUs** that are good enough to stress-test kits, plus a
> **balance toolkit** (live debug meter, static kit analyzer, headless batch simulator, impact score)
> so balance decisions come from numbers instead of single recordings.

Character tuning itself is **out of scope**: M4 builds the tools, and balance passes come later (M8, or earlier once the tools exist).

## Starting point (end of M3)

- **Sim.**
  - Deterministic 60 Hz with no RNG at all, so every match between the same bots is identical.
  - 3v3 spawns and `forward`/`goalie` roles already exist.
- **Bots** (`packages/sim/src/bot.ts`, 126 lines):
  - One rule-based brain: get behind the ball and strike toward the nearest barrier or the goal.
  - Cut the ball off when it heads for our goal.
  - Moves are fired from a hand-written `bot` hint per move (`ballShot`, `engage`, `chase`, `defend`, `support`).
  - No teamwork, no prediction, no positioning, no awareness of stagger or KO.
- **Stats.**
  - The sim only counts goals, assists, KOs, deaths and barriers.
  - The recorder's `summary()` adds casts, hits, damage, touches and orbs from events on the client side.
- **Gamepad.** The first pad is read in `client/src/input.ts`, but it has had little testing.

Why the current bots can't judge balance:
- Their skill depends on how well each kit's `bot` hint fits that kit, not on the kit's real power.
- One deterministic game gives a sample size of one.

## Design principles

1. **One brain for every Pokémon.**
   - Kit knowledge comes only from the move data, through the analyzer (Part B), never from per-Pokémon code.
   - A kit then wins because its numbers are better, not because its bot script is.
2. **Bots read the world, not the future.**
   - Bots see the same world a player sees: positions, velocities, cooldowns that are visible, and Energy.
   - They predict the ball by running the same ball physics forward, which is fair because a player can do that too.
   - They never read enemy inputs.
3. **Determinism stays.**
   - Bot variety comes from a per-bot seeded RNG (`mulberry32`, integer-only) stored in the world, so it is hashed and replayable.
   - Same seed means the same match. A new seed means a new match.
4. **Skill is a dial.**
   - Reaction time, aim error, decision interval and look-ahead are parameters.
   - `balance` difficulty is maximum skill with symmetric settings on both teams.
   - `easy`/`normal`/`hard` exist for play.
5. **Measure the bots too.** A bot ladder makes sure each brain version actually beats the one before it.

---

## Part A — Smart CPUs (`packages/sim/src/ai/`)

```
ai/
  rng.ts          seeded integer RNG, state lives in world.ai
  perceive.ts     per-tick snapshot: ball prediction, threats, lanes, open space
  predict.ts      ball trajectory (reuses ball.ts physics, walls + friction), time-to-intercept per player
  team.ts         team coordinator: assigns jobs every 0.25 s
  actions.ts      utility-scored actions per job
  moves.ts        when/where to cast, from the analyzer's move model (Part B)
  brain.ts        botInput v2: perceive → team job → best action → steering + aim + buttons
  difficulty.ts   reaction delay, aim noise, decision rate per level
```

### A1. Perception and prediction
- **Ball path.**
  - Run the ball forward 0–2 s on a cheap copy that uses the real `ball.ts` substep code.
  - Include walls, friction and gates.
  - Cache the result once per tick and share it between all bots.
- **Intercept time.** For each player: the earliest tick at which they can reach the predicted ball within Strike reach, given their speed and any mobility move off cooldown.
- **Threats.**
  - Incoming projectiles and areas from enemy casts already in progress, with their telegraph shape and time to hit.
  - Enemies whose moves are off cooldown and in range.
- **Danger.** For each player, how close a hit would take them to a KO: current stagger, plus a knockback estimate set against their distance to the nearest edge.

### A2. Team coordinator (3v3 brain)
Every 0.25 s, each team gives each bot one **job**:

| Job | Who gets it | What it does |
|---|---|---|
| **Striker** | Fastest intercept time to the ball | Contest the ball and shoot at barriers or the goal |
| **Support** | Second forward | Take the pass or rebound position, peel enemies off the striker, fight the enemy striker |
| **Goalie** | Fixed goalie role, unless pulled out | Guard the goal mouth on the predicted shot line, clear, step up when the ball is deep in the enemy half |

- **Hysteresis.** A job only changes when the time advantage is more than 0.2 s, so bots don't flip jobs every tick.
- **1v1.** The single bot switches between Striker and Goalie by ball position.

### A3. Utility actions
Each job scores a short list of candidate actions, and the best one wins. Candidates:
- **Shoot.**
  - Strike the ball along the best line: the open goal-mouth gap, a barrier, or a bank shot off a wall.
  - Lines are scored by whether the predicted path reaches the target and whether enemies can intercept it.
- **Pass.** Strike toward a teammate's run when that teammate has a much better shooting line.
- **Clear.** Hit the ball away from our goal toward the side the enemy isn't covering.
- **Intercept.** Move to the predicted interception point, not to the ball's current position.
- **Block lane.** Stand between the ball and our goal on the predicted shot line.
- **Fight.** Use knockback toward the nearest edge, especially on targets with high Danger. Edge KO setups.
- **Dodge.**
  - Evade an incoming telegraph that would hit.
  - Burst when full and either two enemies are close or the ball can be stolen.
- **Collect orb.** Grab an orb when it is cheap to do so: close by, and no ball duty right now.
- **Retreat or reset.** Back off toward the middle when Danger is high.

### A4. Move usage from data
- The hand-written `bot` hints are replaced. Each move gets a **move model** from the analyzer:
  - reach and area shape
  - travel time and lead
  - effects: ball impulse, knockback, damage, mobility, heal or shield
- **Each tick,** each move off cooldown is scored for the current action. Examples:
  - a projectile that can hit the ball onto a shot line
  - a dash that closes an intercept the bot would otherwise lose
  - a cone that catches 2 enemies near an edge
- **Aim.** Projectiles lead their target. Dashes check where they will end up, so a bot never dashes off an edge.
- **Fallback.** The old `bot` field becomes an optional tiebreak hint only.

### A5. Difficulty

| Param | easy | normal | hard | balance |
|---|---|---|---|---|
| Reaction delay | 300 ms | 180 ms | 100 ms | 100 ms |
| Aim error (σ) | 12° | 6° | 2° | 2° |
| Decision interval | 0.4 s | 0.25 s | 0.15 s | 0.15 s |
| Ball look-ahead | 0.6 s | 1.2 s | 2 s | 2 s |
| Uses moves | basic | most | all | all |

- `balance` keeps a small amount of noise on purpose. Without it, every seed plays the same game.
- The noise is the same on both teams.

### A6. Bot ladder (quality gate)
`npm run ladder -- --a v2 --b v1 --games 200`:
- Mirror matches with the same Pokémon on both sides, swapping sides.
- Brain v2 must beat v1 **≥ 80 %**.
- Each later brain change must not lose to the previous version (gate: ≥ 50 % with a 95 % CI).

---

## Part B — Balance toolkit

### B1. Telemetry in the sim (`packages/sim/src/telemetry.ts`)
- An event-driven collector inside `World`, deterministic and cheap. It replaces the client-side tally in `summary()`.
- **Per player:**
  - damage dealt and taken
  - knockback dealt and taken
  - stagger breaks, KOs, deaths
  - ball touches, and ball time-of-control (last toucher)
  - ball progress: change in distance to the enemy goal after each of our touches, the xG-like part
  - barrier damage, goals, assists
  - orbs, Energy spent, distance travelled
  - time alive and time KO'd
- **Per move:** casts, hits (players and ball), hit rate, damage, knockback, KOs caused within 2 s of the hit, ball speed given, goals within 3 s.
- **Strike** is tracked the same way, as move zero.

### B2. Static kit analyzer (`packages/data/src/analyze.ts`, `npm run kits`)
Pure function, `kit + stats + rules → numbers`, at level 1 and at max level:

| Metric | Definition |
|---|---|
| **Cooldown** | Seconds (with cooldown-reduction items later) |
| **Duration** | Windup → active → recovery, in seconds; plus how long the caster is locked |
| **Reach** | Furthest distance from the caster's start at which the move can hit (projectile range + radius; dash distance + hitbox; area offset + radius) |
| **Area** | Area covered in world units², for one hit or for the whole sweep (dash path, projectile corridor) |
| **Burst damage** | Total damage from one cast (repeats included) |
| **DPS** | Burst ÷ cooldown, and kit DPS = Σ moves + Strike (damage ÷ 0.9 s) |
| **Knockback** | Player impulse; **KO range** = the stagger % at which this hit sends a target from mid-field over an edge |
| **Ball power** | Speed given to the ball; can it break a barrier from the centre circle? |
| **Mobility** | Dash distance ÷ cooldown, plus base speed |
| **Survivability** | Stagger HP × size factor ÷ kit-wide enemy average DPS |

Output: a markdown/CSV table per Pokémon, plus a **power-budget** score with weights from B4, so outliers show before any match is played.

### B3. Debug menu (client overlay, toggled with **F3**)
Modelled on OS's own tooling: Practice mode, Core Stats, scoreboard and end-of-game stats, ability tooltips. See [omega-strikers.md §7a](../research/omega-strikers.md). Four tabs:

**Meter tab (live)**
- **Per-player panel:**
  - rolling 5 s and match DPS
  - damage dealt and taken
  - hit rate per move, and casts per minute
  - cooldown uptime: how much of the time each move sat unused while ready
  - ball touches, control %, ball progress
  - KOs, deaths, current Danger
- **OS scoreboard columns:** Goals, Assists, KOs, **Saves**, Damage, **Shots**, **Redirects**, Orbs.
- **Core Stats readout** (OS `WBP_CoreStats`):
  - average, max and final (goal) ball speed
  - high and extreme colour thresholds at 1,300 and 1,750 (our Red Core threshold)
- **World view:** hitbox shapes while active, reach rings for every move, predicted ball path, and the AI's current job and action label over each bot.

**Practice tab** (OS Practice-mode controls):
- spawn or remove the ball
- spawn an enemy dummy and pick its Pokémon; destroy all; reset all
- clear cooldowns; always clear cooldowns
- Energy: zero, half, max
- Stagger self or enemy; damage self or enemy; knock back self or enemy
- restore or disable barriers
- start or end overtime

All of it runs through sim functions, so it stays deterministic and also works from scripts.

**Kit tab:**
- The B2 static numbers for the selected Pokémon, so static and live values sit side by side.
- Laid out like OS's ability tooltips: hit type, ability type, damage, player and ball knockback, durations and speeds.

**Tiers tab:** the B6 tier list.

Works with live play, spectate (`?cpu=`) and recordings. The recorder can bake it into video with `&meter=1`.

**Telemetry additions** (B1), so the meter can show OS's stats:
- **Shot:** a touch after which the ball is on target. Its straight path crosses the enemy goal mouth between the posts, and its friction stopping distance reaches it.
- **Save:** touching an enemy shot that is on target.
- **Redirect:** the `ballHit.redirect` flag.
- **Ball speed:** average, max and final (goal) speed.
- **Per-role set MVP:**
  - Forward: goals ×3, assists ×2, KOs ×1.5, shots ×0.5, damage ÷ 1,000.
  - Goalie: saves ×2, plus the same terms at half weight.
  - The weights are provisional.

### B4. Headless batch simulator (`npm run balance`)
- Runs the pure sim in Node with no browser, at roughly 100× real time or more, across worker threads.
- **Modes:**
  - `--duel`: every 1v1 pairing, both sides, N seeds each → win-rate matrix
  - `--3v3`: random or rotating comps → per-Pokémon win rate in comps, with pairs and synergy later
  - `--set lucario.aura-sphere.cooldown=11`: what-if overrides without editing JSON; diff report against the baseline
- **Output:** `reports/balance-<date>.json` plus an HTML report:
  - win-rate matrix with 95 % confidence intervals
  - per-move telemetry
  - impact scores
  - outlier flags (win rate outside 45–55 % once the confidence interval is tight enough)

### B5. Impact score (per fighter)
A single "how much does this Pokémon swing games" number, built from parts that can be inspected:

```
impact = w1·goal share + w2·assist share + w3·ball progress share
       + w4·KO share − w5·death share + w6·barrier share
```

- Shares are relative to the team (a 3v3 average of 33 %).
- The weights are fitted by logistic regression of these features on match outcome across the batch runs, so the score tracks what wins games here rather than a guess.
- Reported next to the plain win rate. Impact explains *why*; win rate says *how much*.

### B6. Tier list (T0, T0.5, A, B, C, D, F)
Like OS community lists, Pokémon are ranked **per role**: a **Forward** tier and a **Goalie** tier. **Overall** is the better of the two. A Pokémon whose roles are 2 or more tiers apart is flagged "role-specialist".

The difference from OS lists: tiers come from **measured numbers**, not opinion. There are two sources:

1. **Sim tier** (the real ranking, from the B4 batch runs at `balance` difficulty).
   - **Score** = role win rate, shrunk toward 50 % so small samples don't swing it: `(wins + 50) / (games + 100)`.
     This counts 100 phantom games at 50 %: a handful of games stays near B, while thousands barely move (600 wins of 1,000 → 59 %).
   - **Role win rate** comes from rotating 3v3 comps, where every Pokémon plays both Forward and Goalie slots against every other.
   - **Bands**, in points from 50 %:

   | Tier | Win rate | Meaning |
   |---|---|---|
   | **T0** | ≥ 56 % | Warps the game; must be nerfed |
   | **T0.5** | 54–56 % | Clearly best; watch it |
   | **A** | 52–54 % | Strong |
   | **B** | 48–52 % | Healthy band (the target for everyone) |
   | **C** | 46–48 % | Weak |
   | **D** | 44–46 % | Clearly worst; buff |
   | **F** | < 44 % | Unplayable; must be buffed |

   - **Confidence:** if the 95 % interval covers more than one neighbouring tier, the tier shows a "?" and the menu says how many more games would settle it.
   - **Snapshot:** `npm run balance` writes the snapshot to `packages/data/balance/tiers.json`, committed, so the in-game menu can read it.

2. **Theory tier** (available at once, from the B2 power budget, 100 = roster average).
   - **Bands:**

   | Tier | Budget |
   |---|---|
   | T0 | ≥ 118 |
   | T0.5 | 112–118 |
   | A | 106–112 |
   | B | 94–106 |
   | C | 88–94 |
   | D | 82–88 |
   | F | < 82 |

   - Shown next to the sim tier. A big gap between the two means either the kit's numbers mislead (for example, utility that the budget can't value) or the bots misuse the kit.

The **Tiers tab** lists every Pokémon with:
- Forward, Goalie and Overall tier, and the theory tier;
- win rate ± CI, games played and impact score (B5);
- a "why" line: the impact parts and budget parts furthest from average, e.g. *"KO threat 132 %, ball 107 %"*.

Before 4.6 has produced a snapshot, only theory tiers show.

---

## Part C — 3v3 playable

- **Match setup screen:** pick your Pokémon, both teams' bots, and difficulty. URL params stay for tooling.
- **Gamepad.** Finish and test it: aim stick, triggers, hot-plugging, and on-screen button prompts.
- **HUD for 6:** portraits, stagger, Energy and level per player, plus the team-score layout.
- **Camera.** Framing that keeps the ball and you in view in a crowded 3v3.

---

## Delivery order (one branch and merge per step)

| Step | Branch | Delivers | Done when |
|---|---|---|---|
| **4.1** ✅ | `feat/telemetry-headless` | B1 telemetry, seeded AI RNG, Node headless runner (`npm run sim`) | 1000 bot-vs-bot matches run headless; same seed gives the same hash |
| **4.2** ✅ | `feat/kit-analyzer` | B2 analyzer + `npm run kits` table | Every kit's metrics are printed; tests check reach, area and DPS for known shapes |
| **4.3** ✅ | `feat/debug-meter` | B3 F3 debug menu (Meter, Practice, Kit, Tiers tabs), hitbox/reach drawing, shots/saves/redirects/ball-speed telemetry, theory tiers | Meter matches the telemetry totals at the end of a match; every Practice control works |
| **4.4** | `feat/ai-v2` | Part A (perception, coordinator, utility, move model, difficulty) + bot ladder | v2 beats v1 ≥ 80 % in mirrors; 3v3 bots rotate jobs, pass, guard and dodge |
| **4.5** | `feat/3v3-playable` | Part C | A full 3v3 is playable with keyboard or gamepad against `normal` bots |
| **4.6** | `feat/balance-report` | B4 batch sim + B5 impact score + B6 sim tiers (per role) + HTML report | `npm run balance` makes the win-rate matrix and the per-role T0–F tier snapshot for the 4 kits, with confidence intervals |

- 4.1–4.3 come first because they are the yardstick for the AI work in 4.4.
- Recordings (`npm run record`) keep working throughout and pick up the meter overlay after 4.3.

## Risks
- **Bot speed.** Ball prediction for 6 bots every tick could slow headless runs. Mitigation: predict once per tick, share it, and cap look-ahead by difficulty.
- **Brain bias.** A brain can still suit some kits better, for example by aiming projectiles better than it times dashes. Mitigations:
  - per-move hit rates in the telemetry show this
  - the ladder includes kit-swapped mirrors
- **False confidence.** Bot balance ≠ human balance. Reports state this, and human playtest notes remain the final say.
