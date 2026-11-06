# M7 — Online

> Goal: play PokéAthlon with friends over the internet. 3v3 private rooms with a room code, any empty seat
> filled by a bot, then the full flow: pick screen, match, the between-set draft, results.
> The game must feel as responsive as it does offline.

## 1. What we have (measured 2026-11-06)

The sim was built for this from M0 on:

| Fact | Where | Why it matters |
|---|---|---|
| The sim is **deterministic**: same inputs give the same match, bit for bit | `sim/src/index.ts` rules, golden-replay tests | Every player can run the whole match locally; only inputs need to travel |
| **No engine-dependent maths** in the sim: only + − × ÷ and `sqrt` (exact in every browser); sine is our own (`vec.ts`) | `grep Math.sin/exp` finds only `impact.ts` (analysis, not the sim step) | Chrome, Firefox and Safari compute the same match |
| An **input is 6 small integers** (move, aim, buttons, aim distance, draft pick) | `sim/src/input.ts` | About 8 bytes per player per tick |
| Boost draft picks are **inputs** | `sim/src/draft.ts` | The between-set draft is already netcode-ready |
| Bots read only the world and their own seeded RNG | `world.ai.rng`, `ai/brain.ts` | Bots can run on every machine and agree |
| **One tick** costs 0.025 ms (0.29 ms with 6 bots) | benchmark, this PC | Re-simulating 8 ticks costs about 0.2 ms (2.3 ms with 6 bots) |
| **A full-state snapshot** (`structuredClone`) costs 0.57 ms; the state is 36 KB as JSON | benchmark | Saving state each tick is affordable; sending it every tick is not |
| `hashWorld()` exists | `sim/src/hash.ts` | Desync detection: clients compare hashes |

## 2. How to do the netcode

| | **A. Rollback with an input relay** (recommended) | B. Server-authoritative (the OS model) |
|---|---|---|
| How | Every player runs the sim. Your own inputs apply at once; other players' inputs are predicted (repeat their last one). When the real input arrives, the game rewinds to that tick and re-simulates. The server only relays inputs and compares hashes | The server runs the only real match and sends state. Each client predicts its own player and shows others slightly in the past |
| Feel | Your actions are instant. Hits land where you saw them. Others can "jump" a little when a guess was wrong | Your movement is instant, but hits and the ball are decided on the server, so they can feel late at high ping |
| What travels | Inputs only: about 8 bytes × 6 players × 60 per second | State snapshots: a few KB, 20–30 times a second, per player |
| Server | Tiny: no game logic, so it fits free hosting | Runs every match; it needs a real always-on machine |
| Cheating | Players can only send inputs, so changing scores or teleporting isn't possible. Bot-assisted aiming is still possible (true in B as well) | Strongest: the server owns the truth |
| Risk | A desync (two machines disagree) ends the match. Hash checks catch it and tell us which tick | More code: prediction, reconciliation, lag compensation for hits |
| Fits our code | Directly: this is what the deterministic sim was made for | Doesn't use determinism at all |

**Recommendation: A.** It suits our sim, it's cheap to host, and hits feel instant. It's what fighting games and
some platform fighters use. ⚠ OS itself uses its own dedicated servers (Unreal's server-authoritative model,
not verified in detail). We differ because our sim is deterministic and theirs isn't. To keep remote players from
jumping, we add a small fixed **input delay** of 2 ticks (33 ms), plus rollback up to 8 ticks (133 ms) on top.
Beyond that, the game waits briefly for the slow player (like fighting games).

## 3. Hosting

The server is one small program: rooms, input relay, hash checks, timing. Where it runs:

| Option | Cost | Limits |
|---|---|---|
| **Your PC** (`npm run server`) | Free | Friends connect through a free tunnel (for example Cloudflare Tunnel) or port forwarding. Only works while your PC is on |
| **Cloudflare Durable Objects, free plan** | Free | 100,000 requests a day; incoming WebSocket messages count 1/20. ⚠ Our estimate: 6 players × 60 inputs/s gives about **1.5 h of matches a day**, or about **3 h** if inputs are sent in pairs. Over the limit, rooms stop working until midnight UTC |
| Cloudflare paid plan, or a small server elsewhere | About US$5 a month | Enough for a group of friends playing every day |

**Recommendation:** build the server so it runs on your PC first (it's also how we test), and keep it small enough
to move to Cloudflare later without a rewrite. You choose the hosting when we reach step 7.6.

## 4. Steps

| Step | What | Done when |
|---|---|---|
| **7.0 Determinism check** | Run the same recorded match in Chrome, Firefox and Edge and compare the hash every tick. Fast snapshot and restore of the world (a ring of saved states), and an input history | Hashes match in every browser; restoring a snapshot and re-running gives the same hash |
| **7.1 Rollback core** | Input delay, prediction, rewind and re-simulate, in a `net` module the client uses. Visual events (hit effects, KO pop-ups, the GOAL flash) are de-duplicated when re-simulation produces them again, and cancelled if a guess was wrong. Remote sprites are smoothed when corrected. Test it in **two browser tabs with fake latency and packet loss** (debug panel) | A match in two tabs at 150 ms fake ping and 5 % loss feels fine; no desyncs in a long bot-vs-bot test run |
| **7.2 Server** | New `packages/server` (Node + WebSocket): rooms with a 4-letter code, seats, a tick clock, the input relay, hash comparison every second, and a lag report. Runs with `npm run server` | 6 tabs play one match through the server |
| **7.3 Lobby + online draft** | Create or join a room; choose a team and seat; the host fills empty seats with bots (difficulty); the OS pick screen played by everyone in the room; the between-set draft and results, in sync | Two people on different PCs play a full match: picks, sets, draft, results |
| **7.4 Network trouble** | A player drops out: a bot takes their seat at once, and they can rejoin it with the room code. The host leaving passes the host role on. A ping display, and a clear message on a desync | Pulling the network cable mid-match doesn't end the match for anyone |
| **7.5 Hosting** | Deploy where you choose (§3); the client gets a server address setting | Friends join from their own homes |
| **7.6 Wrap-up** | Playtest with friends, measure rollbacks and ping, write a changelog, tag `v0.8.0-m7` | You and friends play a full match online |

**Not in M7:** matchmaking with strangers, ranked, accounts, chat, spectators, replays shared online.
Each can come later on top of rooms.

## 5. Questions for you
1. **Netcode:** OK with rollback (A)?
2. **Scope:** private rooms with codes only (no matchmaking), with bots filling empty seats?
3. **Names:** just a nickname you type in, with no accounts?
4. **Hosting:** decide now, or when we reach 7.5? (My suggestion: your PC first, then Cloudflare.)

## ✅ What shipped (2026-11-06: steps 7.0–7.4)

Your answers: rollback, private rooms with bots in empty seats, a typed nickname, hosting decided later.

### How to play with friends
1. **On the host PC:**
   - start the room server with `npm run server`, which listens on port 8787;
   - start the game with `npm run dev:lan` (`npm run dev` only serves this PC).
   - Windows may ask to allow Node through the firewall: allow it on private networks.
2. **Everyone opens the game:**
   - on the host PC: `http://localhost:5173/?online=1`;
   - on other PCs on the same network: `http://<host PC address>:5173/?online=1` (the server window prints the address).

   The server field fills itself in.
3. **The room:**
   - one player clicks **Create a room**, and the others type its 4-letter code or open the share link;
   - each player takes a seat and picks a Pokémon and item;
   - the host (★) sets CPU skill and boosts, picks for the CPU seats, and clicks **Start match**.
4. **Friends outside your network** need a tunnel or port forwarding. That's step 7.5, not done yet.

### What's in it
- **7.0 Determinism:**
  - `snapshotWorld` / `restoreWorld` save and restore the game state (about 0.6 ms), and `hashWorldDeep` hashes the whole state;
  - the probe gives the same 18 checkpoint hashes in Node and Chromium (`npm run determinism`, `determinism.html`). ⚠ Firefox wasn't tested: it isn't installed here. Live hash checks would catch a difference.
  - **Bug found and fixed:** the bots kept their ball prediction outside the game state, so after a rollback they saw something slightly different and matches with bots drifted apart. The prediction now lives in `world.ai.ballPred`.
- **7.1 Rollback** (`packages/net`, `RollbackSession`):
  - 2-tick input delay, guessing other players' inputs, rewinding up to 8 ticks, then waiting;
  - bots computed on every machine;
  - a seat can switch between bot and human (drop-out and rejoin);
  - effects aren't shown twice after a rewind;
  - a state hash every 2 s.
  - **Tests** use a fake network with lag and jitter: 2 or 6 players stay in sync; the online result equals an offline replay; drop-out and rejoin.
- **7.2 Server** (`packages/server`, `npm run server`):
  - rooms with 4-letter codes, seats, host settings and picks;
  - passes inputs between players and keeps a full input log;
  - compares hashes and reports a desync;
  - sends pacing updates.
  - Uses `ws` 8.21.3.
- **7.3 Game:**
  - **Play online** on the pick screen (or `?online=1`, or a `&room=CODE` link);
  - a room screen;
  - the match runs through the rollback session, and the boost draft works online (picks are inputs).
  - **Esc** opens the room screen over the match, which doesn't pause online;
  - the results screen takes you back to the room (the host ends the match for everyone);
  - room, ping and rollback count show in a corner.
- **7.4 Network trouble:**
  - **Dropped connection:** a CPU plays your seat from the next tick. Reloading the page rejoins the same seat: the match so far is replayed, then the seat comes back 1.5 s ahead.
  - **Background tab:** browsers stop running a tab you switch away from. A player who sends nothing for 3 s while behind gets a CPU, and takes the seat back automatically on returning to the tab. Without this, everyone else would freeze.
  - **Host leaves:** the host role passes on.
  - **Desync:** an "out of sync" message.

### Checked
- **Tests:** 194 pass, including real WebSocket tests (room, match in sync, end match, drop and rejoin, background tab, desync detection).
- **In the browser:** two tabs (Ash on Blue, Misty on Red) created and joined a room and played about 30 s through the server: the same boost picks, the same positions, no desync.
- ⚠ **Not checked:**
  - real play at real ping on two PCs, since the test tabs were driven by a script;
  - Firefox and Safari;
  - how rollback corrections look on screen.

### Not done yet
- **7.5 Hosting:** play outside your home network. You choose: a tunnel from your PC, Cloudflare free, or a paid host.
- **7.6 Playtest** with friends.
- **Smoothing:** a remote player corrected by a rollback jumps to the right place instead of sliding there.

## 7.5 Hosting (2026-11-06)
- **`npm run host`:** builds the game, then serves the game **and** the rooms on one port (8787). One address, or one tunnel, is enough. The game uses the page's own address for the rooms (and `wss://` on https), so nobody has to type a server address.
  - **Your network:** `http://<your PC address>:8787/?online=1`.
  - **Elsewhere:** a tunnel to port 8787. For a Cloudflare quick tunnel, `cloudflared tunnel --url http://localhost:8787` prints a public `https://….trycloudflare.com` address that changes each run.
- `npm run server` + `npm run dev:lan` still work for development (game on 5173, rooms on 8787).
