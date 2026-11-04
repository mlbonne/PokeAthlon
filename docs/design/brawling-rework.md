# Brawling rework: study and proposal (2026-11-04)

> Question: fighters seem to take too long to die, forwards crowd the ball and there is little passing.
> Would stronger brawling and faster deaths push play toward soccer: passes, open positions, strategy?

## 1. What combat does in Omega Strikers

Sources:
- our research ([omega-strikers.md](../research/omega-strikers.md) §4.3, §7);
- the OS wiki ([Stagger](https://omegastrikers.wiki.gg/wiki/Stagger), [Status Effect](https://omegastrikers.wiki.gg/wiki/Status_Effect));
- OS patch notes ([Sept 21 micropatch](https://omegastrikers.wiki.gg/wiki/Omega_Strikers_-_September_21st_Micropatch_-_Update_Notes), [Dec 8 update](https://omegastrikers.wiki.gg/wiki/Omega_Strikers_--_Dec._8th_Update_Patch_Notes)).

- **A KO is the only way combat matters, and it is a big deal.**
  - A KO'd Striker is out for **8 s**: patches moved it 8 → 7 → 8 s, with longer respawns in overtime.
  - Their team plays 2v3 meanwhile: the **power play**. Teams "fight in the round first, then convert the
    extra player into a goal".
- **Damage doesn't kill; edges do.**
  - Damage only empties Stagger.
  - Staggered = +254.5 % knockback, so one solid hit near an edge KOs.
  - Any knock past the arena edge is a KO, Staggered or not.
- **Fights were strong enough to shape the meta.**
  - The developers called KO-oriented comps "a little too strong" and shortened overtime respawns because of them.
  - Juliette (our Lucario's model) was nerfed for being too effective a KO tool, including against
    players who were *not* Staggered.
- **Space is the counter to brawling.**
  - Players stay away from edges and hunt enemies near them.
  - Goalies hold the Goal Arc for knockback resistance.
  - Forwards look for passing lanes, because standing in a crowd next to a brawler gets you KO'd.
  - The soccer-like spacing in OS is largely *fear of the KO*.
- No source publishes KO counts per match. The design target below is our estimate from that structure:
  rounds of about a minute, each normally decided by at least one fight. That means **about 1.5–2 KOs per live minute in a 3v3**.

## 2. What our game does now (measured)

`npm run playstyle`: 30 random-comp 3v3s per variant, v2 bots, the same seeds for every variant.

| Metric | Baseline | Respawn 8 s | Slower regen (2 %/s) | Damage ×1.5 | Knockback ×1.3 | All combined |
|---|---|---|---|---|---|---|
| KOs per live minute (6 players) | **0.6** | 0.5 | 0.6 | 0.7 | 1.1 | 1.2 |
| Staggers per live minute | 0.4 | 0.4 | 0.7 | 2.5 | 0.3 | 2.2 |
| Staggers converted to a KO (≤ 4 s) | **13 %** | 19 % | 15 % | 12 % | 12 % | 15 % |
| Time spent KO'd | 1 % | 1 % | 1 % | 1 % | 1 % | 2 % |
| Damage per player per minute | 1,501 | 1,517 | 1,525 | 2,426 | 1,495 | 2,236 |
| Players within 400 of the ball (of 6) | 2.00 | 2.01 | 2.00 | 1.99 | 1.98 | 1.99 |
| Crowded: 3+ of the 4 forwards near the ball | **30 %** | 30 % | 30 % | 30 % | 29 % | 29 % |
| Distance between a team's two forwards | 286 | 284 | 292 | 301 | 302 | 311 |
| Contested touches (enemy touched it < 0.5 s before) | **39 %** | 39 % | 39 % | 39 % | 39 % | 40 % |

**Reading it:**
1. **Your impression is right: fighters almost never die.**
   - 0.6 KOs per minute across six players means each player is KO'd about once every 10 minutes of play.
   - A whole match has about 3 KOs.
   - Two in five touches are scrums.
2. **Stagger regen out-heals the fights.**
   - About 25 damage per second per player against 4 %/s regen (about 50/s on a 1,300 bar) means
     Stagger only happens to burst damage.
   - More damage creates Staggers (×6) but almost no extra KOs.
3. **The bots don't finish.**
   - Only 13 % of Staggers become KOs.
   - Knockback goes in the attacker → target direction, and the bots aim *at* the target from wherever they stand.
     So they rarely push anyone toward an edge.
   - More knockback (×1.3) doubles KOs because it makes accidental edge pushes reach.
4. **Rules alone don't change the shape of play.**
   - Crowding, contested touches and passing are identical in every variant.
   - The bots don't feel the threat: nothing in their positioning reacts to knockback, Stagger or edges.
   - In OS, humans spread out because a crowd near a brawler is where you die. Our bots need that fear written in.

## 3. Proposal: the brawling rework

Two halves that only work together.

### 3a. Rules: make a KO likely and costly (data only)
| Change | From → to | Why |
|---|---|---|
| Respawn | 5 s → **8 s**, **11 s in overtime** | OS values (patch notes). A KO becomes a real power play |
| Player knockback on every move | ×1.0 → **×1.25** (tuned per kit after) | Doubles KOs in the test; edge pressure becomes real |
| Stagger regen delay | 2.375 s → **3.0 s** (regen 4 %/s kept) | Chip damage from a sustained fight sticks long enough to be finished |
| Goal Arc knockback resist | keep 125 | Goalies stay safe at home, so forwards are the fighters |

### 3b. Bots: fight like OS players
1. **Finishers.** When an enemy is Staggered, or within one hit of an edge, the best-placed bot moves to the
   field side of them and hits *toward the nearest edge*. It uses its biggest knockback move, or Energy Burst.
2. **Edge-aware hits.** Every hit on a player is aimed and positioned for the push direction, not just the
   target, the way the shot evaluator already does for the ball.
3. **Danger-aware positioning.**
   - A bot avoids standing between an enemy brawler (knockback move ready, in reach) and an edge.
   - It keeps its distance when low on Stagger.
   - This is what spreads players out.
4. **Spacing discipline.** Only the striker (and a finisher) enters the ball's 400-unit circle. The support
   holds a lane 450–700 away, and moves when it is blocked rather than joining the scrum.
5. **Pass value.**
   - Passes to an *open* teammate (no enemy within 300 of the lane's end) score higher than a contested dribble.
   - With an enemy about to contest, passing is preferred.
6. **Power-play awareness.**
   - With a numbers advantage, push forward and shoot.
   - At a disadvantage, the goalie stays home and the remaining forward plays safe until the respawn.

### 3c. Targets (measured with `npm run playstyle`)
| Metric | Now | Target |
|---|---|---|
| KOs per live minute | 0.6 | **1.5–2.0** |
| Staggers → KO | 13 % | **≥ 35 %** |
| Crowded (3+ forwards near ball) | 30 % | **≤ 15 %** |
| Contested touches | 39 % | **≤ 25 %** |
| Clean passes (teammate, ≥ 300 units, uncontested) | to measure | **up ≥ 50 %** |
| Goals per live minute | 2.3 | about the same (fights should create goals, not replace them) |

Then re-run `npm run balance`: tiers will move, since brawlers like Lucario should rise.

### Delivery
1. `feat/brawl-rules`: the rule changes and an overtime respawn rule; metric "clean passes".
2. `feat/brawl-bots`: finishers, edge-aware hits, danger-aware spacing, pass value, power play.
3. Measure against the targets; tune rules per kit; re-run the balance report; human playtest.
