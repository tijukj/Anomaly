ANOMALY: Build Guide for Antigravity
A phase-by-phase blueprint. You paste prompts, run one command, check a short "you should see" list, save a checkpoint, and move on. You never need to write code.

0. How this works
The architecture (decided for you)

Laptop (server + big screen)                 Phones (controllers)
┌─────────────────────────────┐              ┌──────────────────┐
│ Node.js + Socket.IO server  │◄── Wi-Fi ───►│ Web page:        │
│  (owns ALL game logic)      │  WebSocket   │ joystick + button│
│                             │              │ rank/score/mission│
│ Host page (Phaser 3) on the │              └──────────────────┘
│ projector: map, leaderboard │
└─────────────────────────────┘
Server-authoritative: phones only send "I'm pushing the joystick this way" and "I pressed Action". The server decides everything. This stops glitches and cheating and makes 20 players easy.
No build tools: plain Node + Phaser + plain HTML/JS. Fewer things to break for a non-coder.
Socket.IO is used for WebSockets (same tech, but handles reconnecting phones automatically).
Whole map always visible on the big screen (better for spectators). The "Fog" anomaly reduces visibility.
Bots are built early so you can test with 15 to 20 players without 20 phones.
Decisions I made where your GDD was open (change any you dislike)

GDD gap	My MVP decision
"Dynamic missions adapt to behavior"	Weighted random from mission templates, biased away from what a player already did
Merchant "Trade" undefined	Risk-free gamble: +5 to +25 points, 20 second personal cooldown
Portal	Paired portals that teleport to the linked one, short cooldown
Secret passages	Walls with a hidden gap that only opens when someone activates a switch
Anomaly stacking	One anomaly at a time; each lasts 15 to 30 seconds
Ties	Higher Legendary/Epic count, then earliest time reaching final score
1. One-time setup (30 minutes)
Install Node.js (LTS) from nodejs.org. Accept all defaults.
Install Antigravity and sign in with your Google account. (Menu names below may differ slightly by version; the ideas are the same.)
Make a folder called anomaly on your Desktop.
In Antigravity: File → Open Folder → anomaly.
Inside it create a folder docs, then a file docs/GDD.md. Paste your entire Game Design Document into it and save. This is the agent's source of truth.
Open the Agent panel (the chat side panel). Choose:
Mode: Planning (the agent shows a plan first; you approve it)
Model: the strongest available one
Terminal command approval: "Request review" so it asks before running commands. Approve normal npm and node commands.
Create the rules file. Find Antigravity's Rules setting (workspace rules, or Customizations → Rules) and paste the block below. If you can't find it, save it as docs/RULES.md and start every prompt with "First read docs/RULES.md and docs/GDD.md."
Paste this as the project Rules
You are a senior multiplayer game developer with 15 years of experience building real-time party games. I am a complete non-coder. Follow these rules in every task.

PROJECT: ANOMALY, a 10-minute multiplayer treasure race for 10-20 players. Phones are controllers. A laptop hosts the server and shows the shared big screen. Full design is in docs/GDD.md. Read it before every task.

TECH (do not change without asking me):
- Node.js + Express + Socket.IO server. Plain JavaScript (ES modules). No TypeScript, no bundler, no frontend framework.
- Phaser 3 for the host big screen, loaded from node_modules via a static route.
- Phone controller is plain HTML/CSS/JS with a custom touch joystick.
- Server-authoritative: phones only send input (joystick vector, action pressed). Server runs game logic at 20 ticks per second and broadcasts state.
- The server binds to 0.0.0.0 and prints the LAN URL (e.g. http://192.168.x.x:3000) on start. Everything runs on one laptop over local Wi-Fi.

STRUCTURE:
server/index.js (bootstrap), server/config.js (ALL tunable numbers: speeds, scores, timings, counts), server/game/*.js (one file per system: match, map, treasures, missions, clues, anomalies, scoring, bots), public/host/ (big screen), public/play/ (phone), public/shared/ (shared constants).

WORKING STYLE:
1. Before coding, show a short plan and list files you'll touch. Keep files under ~400 lines; split if larger.
2. Never rewrite unrelated files. Never add features I didn't ask for.
3. Put every tunable number in server/config.js, never hardcode.
4. After finishing, tell me in plain English: (a) the exact command to run, (b) exactly what I should see on the laptop and on my phone, (c) what to do if it doesn't work.
5. Add clear console logs for key events so errors are easy to copy to you.
6. At the end of each phase, run git add and git commit with a clear message (initialize git if needed).
7. Prefer the simplest thing that works. Minimal neon graphics drawn with Phaser shapes only, no image assets.
Golden rules for the whole build
One phase per conversation. Start a new agent conversation for each phase and begin with: "Continue the ANOMALY project. Read docs/GDD.md and the current code, then do the following."
Approve the plan, then let it run. If the plan adds anything you didn't ask for, reply "Remove X, keep to the phase scope."
Test before moving on. Never start phase N+1 until phase N's "You should see" list is true.
Errors: copy the red text from the terminal or browser and paste it into the agent with the Fix prompt at the bottom of this guide. Screenshots also work.
2. Phase-by-phase
Phase 1: Server, lobby, QR join
Goal: laptop shows a QR code; phones scan and appear in a lobby list.

PHASE 1: Foundation and lobby.

Set up the project: package.json with scripts "start" (node server/index.js), "dev" (node --watch server/index.js). Install express, socket.io, qrcode, phaser.

Build:
1. Server that serves /host (big screen) and /play (phone), serves Phaser from node_modules, binds 0.0.0.0, and prints the LAN URL on start.
2. /host page (Phaser canvas, full window, dark neon style). In lobby state it shows: title ANOMALY, a large QR code that points to http://<LAN-IP>:3000/play, the URL in text, and a live list of joined players (colored circle + name). A big "START MATCH" button (also Space key), disabled until at least 1 player has joined.
3. /play page (mobile-first): asks for a name (max 12 chars), assigns each player a unique color, then shows "You're in! Waiting for host..." plus their color. Store a playerId in localStorage so a refresh or dropped connection reconnects the same player with the same name/color.
4. Prevent phone zoom/scroll/pull-to-refresh, lock to portrait, and request a screen wake lock so phones don't sleep.
5. Server-side match state machine skeleton with states: LOBBY, RUNNING, ENDED. Only LOBBY to RUNNING is needed now; RUNNING can just show a placeholder "MATCH RUNNING" on host and phone.
6. Add a README.md with plain-English steps to start the server and join.

Follow the Rules. Commit at the end.
Run: in Antigravity's terminal type npm start. Open http://localhost:3000/host on the laptop.

You should see: a QR code and URL; when you scan with your phone (same Wi-Fi), your name appears on the big screen; Start switches both screens.

If the phone can't connect: (1) Windows may ask to allow Node through the firewall, so click Allow on Private networks. (2) Many college Wi-Fi networks block device-to-device traffic ("client isolation"). Fix: turn on your phone's hotspot and connect the laptop and all players' phones to it, or use the laptop's own hotspot. Test this before game day.

Phase 2: Joystick, movement, and bots
Goal: everyone moves as colored circles; bots let you test alone.

PHASE 2: Movement and test bots.

1. Phone: floating analog joystick (appears where the thumb touches on the left/lower part of the screen, outputs a normalized vector), plus a large ACTION button on the right. Send input to the server at ~20Hz as {x, y, action}. Only send when changed plus a heartbeat every 250ms. Add a small vibration on button press.
2. Server: 20 ticks/sec game loop. Each tick moves every player by input vector * speed (from config.js), clamped to world bounds. Broadcast compact state snapshots (id, x, y) to the host at 20Hz.
3. Host: render every player as a glowing colored circle with name above. Smooth movement by interpolating between snapshots. The world is one fixed-size map (config: 1600x1000) always fully visible, scaled to fit the screen.
4. Movement skill matters: speed, acceleration and friction values live in config.js.
5. Bots: create server/game/bots.js and an npm script "bots" (npm run bots -- 15) that spawns N fake players which join like real players and wander randomly with occasional pauses. They must appear identical to real players in state. Bots should also press ACTION randomly.
6. Show a small debug overlay on host (toggle with D): player count, server tick time, snapshot size.

Follow the Rules. Commit at the end.
Run: npm start, join with your phone, then open a second terminal and run npm run bots -- 15.

You should see: your circle follows your thumb smoothly; 15 bot circles wander; nothing lags.

Phase 3: Map, regions, collisions, seeded layout
Goal: the five regions exist and object placement changes every match.

PHASE 3: Map, regions and collisions.

Build the neon tactical map on a 1600x1000 world, top-down, dark background, glowing outlines, drawn with Phaser shapes only:
- Regions: Forest (large, west), Ruins (center-north), River (a winding band across the middle with 2 to 3 bridges/shortcuts; entering water slows players by a config value), Cave (southeast, small, narrow entrances), Castle (northeast, walled, 1 to 2 entrances). Each region has a distinct neon color and a floating label.
- Walls and obstacles as rectangles. Server-side circle-vs-rectangle collision so players slide along walls and can body-block each other (players collide with each other with soft push, never damage).
- Fixed structure every match, but a seeded random generator (seed printed in logs and shown small on host) decides per match: treasure spawn points, vault positions, clue points, mission zones, secret passage (a wall gap opened by a hidden switch), portals pairs, merchant locations. Define spawn-point pools per region in a data file.
- Discovery zones: each region is an area. Server tracks which player first enters each region for the "Discovery Bonus" later (just track and log it now).
- Players spawn spread around a central start plaza at match start.

Do not add scoring, treasures or clues yet. Only the map and the seeded slots (draw small debug markers for slots, toggle with M).

Follow the Rules. Commit at the end.
You should see: five recognizable regions, walls block you, water slows you, bots don't get stuck permanently, and restarting the server produces different marker positions.

Phase 4: Treasures, smart action button, scoring, leaderboard
Goal: the core loop works: find, collect, score.

PHASE 4: Interactables, Smart Action Button, scoring.

Implement an interactable system on the server. Each interactable has type, position, radius, state, and a handler. Types now: treasure (common +5, rare +15, epic +30), chest (opens with a short 1s hold, gives random treasure tier), vault (needs a key item: keys are found as pickups and shown as a tiny key icon above the player), portal (paired, teleports with 3s cooldown), merchant (risk-free gamble +5 to +25 points, 20s personal cooldown), switch (opens the secret passage).

Smart Action Button:
- Server finds the nearest interactable in range for each player and tells that phone its label ("COLLECT", "OPEN", "UNLOCK", "TRADE", "ENTER", "ACTIVATE") or "none". Phone button changes text and color and pulses when active, greyed out when nothing is near.
- First valid press wins. Two players pressing at the same tick resolved by server order.

Scoring: use values from config.js. Include Discovery Bonus +10 for first entry into each region. Use a central scoring.js that all point awards go through and that emits events (used later by live feed).

Leaderboard: host shows Top 5 on the right side, animating rank changes. Phone shows only current rank, score and current mission slot (placeholder text for now).

Spawn logic: treasures spawn using seeded slots from Phase 3, respawn rules in config. Show a floating "+15" popup on host at the collect location and a short glow burst.

Bots must be able to collect stuff by wandering toward nearest interactable and pressing action.

Follow the Rules. Commit at the end.
You should see: button text changes near objects; points pop up; leaderboard reorders; bots climb the board.

Phase 5: Match flow, timer, and the four phases
Goal: a real 10-minute match with escalating phases.

PHASE 5: Match lifecycle and phase timeline.

1. State machine: LOBBY -> COUNTDOWN (5s big numbers on host, phones vibrate) -> RUNNING (config duration 600s) -> ENDED. Host key R resets to LOBBY keeping players connected. Add a config.DEBUG_SHORT_MATCH (e.g. 120s) that scales all phase timings proportionally so I can test quickly.
2. Four phases by time fraction: Discovery 0-2min, Competition 2-6, Hunt 6-8, Chaos Finale 8-10. Each phase has its own spawn table in config.js (e.g., more rare/epic and vaults later; only common and few rare at the start). Show current phase name and a large timer on host, and phase-change banner announcements.
3. Late joiners during RUNNING may join as players from the current point. Disconnects keep the score and let the player reconnect.
4. Phone shows: rank, score, timer, and current mission placeholder, all large text.
5. At ENDED, freeze movement and show a simple placeholder result screen (full end sequence comes later).

Follow the Rules. Commit at the end.
You should see: countdown, timer, phase banners, spawn intensity increasing, end screen. Use the short-match debug config for fast testing.

Phase 6: Missions
PHASE 6: Dynamic missions.

Each player has exactly one active mission shown on their phone (one goal at a time). Templates from the GDD: Explorer (visit two named regions, +25), Collector (open 3 chests, +35), Runner (reach the Castle before 5:00, +40), Opportunist (collect a treasure during an anomaly, +50). Add 4 more simple templates (e.g., "Collect 5 common treasures", "Use a portal twice", "Cross the river using a bridge", "Trade with the merchant"). Rewards between +20 and +50 from config.

Selection: weighted random per player, lowering the weight of templates similar to what they've recently done, and never giving Opportunist unless an anomaly is possible. When completed: phone flashes, vibrates, points awarded through scoring.js, then a new mission is assigned after 3 seconds. Runner-type missions that expire silently get replaced.

Host shows small mission-complete pops in the live event stream (a plain event list for now; the styled live feed comes later). Bots should complete some missions incidentally.

Follow the Rules. Commit at the end.
You should see: each phone shows a different mission; completing it awards points and issues a new one.

Phase 7: Public clue chains and the Legendary Treasure
Goal: the centerpiece.

PHASE 7: Clue chains and the Legendary Treasure.

1. Exactly one Legendary Treasure per match, located in a Castle vault chosen by the seed. A clue chain of 3 clues leads to it: Clue 1 -> Clue 2 -> Clue 3 -> final location. Clue points are placed by the seeded generator in different regions; clue 2 only becomes findable once clue 1 has been discovered, etc.
2. All clues are PUBLIC: when anyone reads a clue, the text is broadcast to all phones and shown large on the big screen for 6 seconds and stored in a "Known Clues" panel on the host. Clue text is written from templates that hint at real places (e.g., "The king watches from the north." = Castle north tower). Provide at least 8 clue-chain templates in a data file, each mapping text to real map coordinates, so the clues are truthful and solvable.
3. Timing: non-legendary side clue chains (for bonus treasures) can appear from the start. The Legendary chain begins to reveal at 6:00 (Hunt phase). The final location becomes fully visible at the 8:00 Final Revelation.
4. The first player to reach the final location and press ACTION unlocks it: +150 points, a full-screen announcement "LEGENDARY TREASURE FOUND: <NAME> DISCOVERED THE ANCIENT VAULT" with confetti-style neon particles, sound placeholder. It is NOT an automatic win.
5. If nobody finds it, the Final Revelation should make it obvious. Bots should follow public clues in later phases, with some randomness so they don't all arrive at once.

Follow the Rules. Commit at the end.
You should see: clues appear on everyone's screen, the crowd converges around 6 to 8 minutes, the first arrival gets the announcement.

Phase 8: Anomaly events
PHASE 8: Anomaly events.

Every 60 seconds (config), activate one random anomaly, never repeating the previous one. One at a time, 15 to 30s each, with a big banner and a countdown bar on host and a short text on phones. Implement:
- Treasure Rain: burst of extra treasures spawn across the map.
- Speed Surge: movement multiplier for all.
- Teleport Storm: all players teleported to random valid positions.
- Fog: host map visibility reduced to a soft radius around each player; phones unaffected.
- Double Points: all rewards x2 (scoring.js multiplier).
- Vault Activation: a rare vault becomes accessible for the duration.
- Reverse Controls: server inverts input vectors for a short duration (5 to 8s), with a warning flash on phones.
- Golden Crown: a crown object spawns; the holder gets points over time; touching it while carried by someone steals it (no combat, just contact with a 3s protection after stealing). Crown holder shown with a crown icon above.

Anomaly pool by phase: Phase 1 gets only mild ones (Treasure Rain, Speed Surge); Phase 2+ everything; Finale allows two overlapping anomalies per config.

Track "anomaly triggered by" stats for later awards. Follow the Rules. Commit at the end.
You should see: a banner every minute and each effect actually working. Test each one alone by adding a debug key (ask the agent: "Add debug keys 1 to 8 on the host to trigger each anomaly").

Phase 9: Big-screen UI, live feed, juice
PHASE 9: Big screen layout, live feed, and feel.

1. Host layout: Map center, Top-5 leaderboard on the right, live feed (last 6 events, sports-commentary tone, newest on top with icons) on the left or bottom, anomaly banner at top, timer at top center, phase name beneath timer. Readable from across a room: large fonts, high contrast.
2. Live feed events from scoring.js and other systems: clue discovered, vault opened, someone entering Top 3, Legendary clue revealed, anomaly started, mission streaks, crown stolen.
3. Juice: sound effects generated with the Web Audio API (no audio files): collect, rare/epic collect, clue, mission complete, anomaly start, legendary fanfare, countdown ticks. Add a host mute toggle (key S) and a "Click to enable sound" overlay because browsers require a click.
4. Player names tinted by rank on the map, top 3 get a subtle glow. Trails when Speed Surge is active.
5. Phone: the four large elements only (rank, score, mission, action button). No menus. Keep the current one-goal-at-a-time principle.

Follow the Rules. Commit at the end.
Phase 10: End sequence, highlight reel, awards
PHASE 10: End of match.

At 10:00: final 10-second countdown on host (large numbers), phones vibrate on each tick. Then ENDED.
1. Highlight reel: 4 to 6 stat cards shown one at a time, ~3s each, built from a stats tracker (per-player: chests opened, treasures by tier, vaults, clues found, distance moved, time holding Crown, anomalies triggered, portals used, regions discovered first). Example cards: "Tiju found the Legendary Treasure", "Rahul opened 15 chests", "Priya held the Crown longest".
2. Final results podium for top 3 with names, scores, then full ranking list.
3. Special awards computed automatically: Explorer (most first-discoveries), Chaos Agent (most anomaly-related actions/steals), Treasure Hunter (most treasures), Speed Demon (most distance moved), Vault Master (most vaults).
4. Tie-break rule: more Epic/Legendary, then who reached the final score first.
5. Phones show the player's own final rank and their awards.
6. Host keys: R = new match in the same lobby, keeping players connected.

Follow the Rules. Commit at the end.
Phase 11: Hardening and 20-player test
PHASE 11: Reliability pass.

1. Reconnect: a phone that loses Wi-Fi for up to 60s rejoins seamlessly with score intact; show a "Reconnecting..." state on phone.
2. Performance: with 20 bots, server tick under 10ms and snapshots under a reasonable size. Report measurements. If needed, optimize (delta snapshots, spatial hashing for interactables).
3. Input abuse: server ignores impossible speeds, spam of action button, malformed messages.
4. Laptop sleeping/host tab refresh: server keeps match state; refreshed host page re-renders the current state.
5. Add a /admin page (localhost only) with buttons: start, end, reset, kick player, set bot count, trigger anomaly.
6. Run a full automated 10-minute simulation with 20 bots and report any errors, stuck bots, or balance issues (score spread, whether the Legendary was found, anomalies seen).

Give me a final "GAME DAY CHECKLIST" in README.md. Follow the Rules. Commit at the end.
Phase 12: Balance pass (do after real playtest)
Play once with 5+ real people plus bots, then paste your observations:

BALANCE PASS. Here is what I observed in playtest: [write things like "Legendary was found too easily", "Fog felt boring", "Leaderboard runaway leader by minute 4", "the joystick felt sluggish"]. Adjust only config.js values first. Then explain each change in plain English. Only touch game logic if config changes can't fix it. Keep a CHANGELOG.md of balance changes.
3. Game day checklist
Connectivity first. Connect the laptop and phones to the same network. If the classroom Wi-Fi isolates devices, use a phone or laptop hotspot. Test a join 30 minutes early.
Plug in the laptop, disable sleep, close other heavy apps.
Run npm start. Open /host on the projector in full screen (F11) and click once to enable sound.
Have everyone scan the QR. Ask them to turn on Do Not Disturb and set screen timeout to long.
Explain the game in one sentence: "Move, tap the big button when it lights up, chase the leaderboard, watch for the Anomaly banner."
Play a 2-minute practice match with the debug short mode, then reset.
Start the real match. Keep /admin on your phone or a second window for emergencies.
4. Reusable prompts
Fix prompt (paste with the error)
Something broke. Here is the exact error / screenshot / what I saw: [paste]. What I did before it: [steps]. Do not guess. First find the root cause by reading the relevant code and logs, explain it in one or two plain sentences, then fix it with the smallest possible change and tell me how to verify it. Do not change unrelated files.
Add-a-feature prompt
I want to add: [feature]. Check docs/GDD.md for conflicts. Give me a short plan with the files you'll change and what could break. Wait for my OK before coding. Put all numbers in config.js.
"I'm lost" prompt
Summarize the current state of the project in plain English: what works, what is unfinished, which phase we're in, and the exact command to run and test. Then suggest the single next step.
Rollback
Undo everything since the last git commit and confirm the project runs again.
5. Common failure points
Symptom	Likely cause	Fix
Phone page won't load	Different network, firewall, or Wi-Fi isolation	Use a hotspot; allow Node in firewall
QR points to localhost	Server didn't detect the LAN IP	Ask the agent to detect it and allow a manual override in config
Joystick scrolls the page	Missing touch-action rules	Ask: "Disable scrolling, zoom and pull-to-refresh on /play"
Phone sleeps mid-game	No wake lock	Ask to add the Screen Wake Lock API and a visible warning if unsupported
Sound doesn't play	Browser needs a click	Use the "Click to enable sound" overlay
Laggy with many players	Sending full state too often	Run Phase 11 optimization prompt
Agent changes too much	Vague prompt	Reply "Revert unrelated changes. Only touch [files]."
Build order recap: 1 Lobby → 2 Movement + Bots → 3 Map → 4 Treasure + Score → 5 Match flow → 6 Missions → 7 Clues + Legendary → 8 Anomalies → 9 UI + Juice → 10 End sequence → 11 Hardening → 12 Balance.