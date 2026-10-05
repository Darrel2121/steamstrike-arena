# Original User Request

## Initial Request — 2026-10-04T06:10:09Z

A real-time multiplayer top-down tactical shooter with a Steampunk Fantasy aesthetic inspired by Bullet Echo, distinguished by a built-in battle map editor, directional lantern field-of-view, fog of war, and visual sound wave mechanics.

Working directory: d:/!Annet_game
Integrity mode: development

Reference: https://youtu.be/K2SZS--RItg

## Requirements

### R1. Built-in Battle Map Editor (Key Differentiator)
The product must feature an integrated, interactive battle map editor allowing players to design custom arenas. Users must be able to paint/place walls, obstacles, cover, and spawn points, with functionality to save, load, and export map definitions (e.g. JSON format). Matches in multiplayer or solo mode must be launchable directly on custom-created maps.

### R2. Steampunk Fantasy Aesthetic & Theme
The visual and audio design must embody a Steampunk Fantasy world: brass, copper, gears, iron grates, and alchemical lanterns. The field-of-view must feel like a warm directional steam-lantern cutting through dense dark fog/mist, with sound waves represented as mechanical/acoustic pulses (e.g., heavy boots on metal/cobblestones, steam-venting gunshots).

### R3. Real-Time Multiplayer Networking
The game must provide client-server networking (e.g., Node.js with WebSockets) managing match lobbies and real-time state synchronization (player positions, aim directions, health, weapon fire, and elimination) across multiple connected browser clients, allowing them to battle on default or custom editor-built maps.

### R4. Tactical Vision & Sound Mechanics (Lantern FOV & Sound Waves)
The game must enforce tactical line-of-sight: players only see within their directional lantern cone and cannot see through solid walls or obstacles. Areas outside vision are covered by fog of war. High-speed running and gunfire must transmit visual sound waves across the network, visible to other players even in fog to reveal activity.

### R5. Combat Mechanics, Bot Fill & Automated Verification
The combat system must support projectile firing, hit detection, reload mechanics, and health management. AI bots must be able to join matches to fill empty slots or support solo training. The project must include automated headless test scripts verifying map serialization/deserialization, multiplayer socket state sync, and FOV raycasting calculations.

## Acceptance Criteria

### Battle Map Editor
- [ ] Users can enter an editor mode, place walls/obstacles/spawns on a grid, and save/load custom maps.
- [ ] A multiplayer or training match can be started using a user-created custom map.

### Steampunk Fantasy Styling & Vision
- [ ] The visual presentation reflects a steampunk fantasy aesthetic (brass/copper palette, steam-lantern lighting, themed arena obstacles).
- [ ] Directional lantern FOV blocks sight behind solid walls; enemies outside line-of-sight remain hidden in fog.
- [ ] Sound waves (footsteps and gunfire) appear as visual pulses broadcasted across the network and visible in darkness.

### Multiplayer Synchronization & Combat
- [ ] At least two browser clients can connect to the same match, moving and shooting with smooth real-time synchronization.
- [ ] Weapon hits deal damage, update health pools across all clients, and handle elimination when health reaches zero.
- [ ] Bots can populate matches and navigate maps using line-of-sight and sound awareness.

### Automated Testing
- [ ] Headless automated tests execute and pass 100%, validating map JSON export/import, socket message handling, and line-of-sight raycasting.


## Follow-up — 2026-10-04T06:38:11Z

USER REQUIREMENT UPDATE:
The user has added two major features to the project scope:
1. **Player Accounts & Authentication**:
   - Guest Mode: Instant one-click play without mandatory registration, auto-generated nickname, saving local progress.
   - Google Sign-In & Account Linking: Integration with Google Identity / OAuth token verification to authenticate, link guest progress to a Google Account, and persist profile data across devices and sessions.
2. **Character & Weapon Progression System**:
   - Character Progression: Earning XP from matches, leveling up, upgrading character attributes (e.g. movement speed, max health, lantern/battery range).
   - Weapon Upgrades: Upgrading weapon stats (fire rate, reload speed, magazine capacity, damage, spread/accuracy) using in-game currency/parts/XP.
   - Profile & Progression Persistence: Safe storage and retrieval of player progression on both client (for guests) and server (for linked accounts).

Please incorporate these requirements into the project roadmap ([PROJECT.md](file:///d:/!Annet_game/.agents/teamwork/PROJECT.md)), expand the architecture/database/server endpoints, and update the test plan accordingly.


## Follow-up — 2026-10-05T07:49:25Z

A comprehensive game design, gameplay feel, and product audit of Steamstrike: Tactical Arena, benchmarking its combat dynamics against top-tier tactical top-down shooters (Bullet Echo), evaluating sensory bot AI, progression balance, and player UX, concluding with a prioritized strategic roadmap of actionable improvements with engineering specifications.

Working directory: d:/!Annet_game
Integrity mode: development

## Requirements

### R1. Gameplay Mechanics & Bullet Echo Dynamics Audit
Conduct an empirical audit of the battle arena experience:
1. Combat pacing, time-to-kill (TTK), projectile speeds, weapon handling (Cylinder Revolver, Steam Carbine, Blunderbuss, Needle Rifle), and spread/recoil characteristics.
2. Tactical visibility & acoustics: directional steam-lantern cone, 360° close proximity bubble, darkness punch-out, and acoustic sound wave propagation (footsteps, gunfire, reloads).
3. Movement feel, sprint kinematics, steam PSI manometer stamina drain and vent recovery, collision responsiveness around cover.
4. Camera zoom and tracking: evaluation of the 1.45x tactical zoom, mouse wheel adjustment, and on-screen aiming precision.

### R2. Sensory Bot AI & Tactical Behavior Evaluation
Analyze the 4-state autonomous sensory bot architecture (server/BotController.js):
1. State transitions (Patrol, Investigate, Engage, Retreat) and decision frequency.
2. Sensory perception: acoustic sound detection versus visual line-of-sight raycasting.
3. Pathfinding efficiency (BFS navigation on grid), cover utilization, flanking behavior, and fairness vs human players.
4. Identification of behavioral exploits, edge cases (getting stuck, aim snapping), and difficulty scaling.

### R3. Progression Economy, Workshop & Player UX Audit
Evaluate meta-game loops and player onboarding:
1. Progression math: XP curves, scrap/core economy, match reward formulas, and stat scaling per upgrade tier (HP, speed, lantern range, weapon damage/clip).
2. Player onboarding: Guest instant play vs Google OAuth account linking, session persistence, and data loss prevention.
3. UI/UX ergonomics: HUD legibility in combat, Workshop upgrade clarity, MapEditor accessibility, and responsive layout across desktop and mobile viewports.

### R4. Prioritized Enhancement Roadmap & Engineering Specifications
Synthesize all audit findings into a structured, executive-ready report:
1. Categorized backlog (Critical, High Impact, Polish & Quality-of-Life, New Feature Horizons).
2. Concrete mathematical rebalancing proposals (weapon stats table, bot behavior state machine additions).
3. Actionable code snippets and architectural blueprints for immediate implementation.

## Acceptance Criteria

### Combat & Dynamics Diagnostic
- [ ] Detailed quantitative comparison of weapon arsenal (DPS, effective range, reload penalty, ammo economy) with identified balance outliers.
- [ ] Analysis of lantern vision and sound wave penetration mechanics with usability feedback.

### Bot AI & Netcode Evaluation
- [ ] Evaluation of bot perception, BFS pathfinding, and combat reaction times with concrete edge-case analysis.
- [ ] Verification that all 230 automated tests (node tests/runner.js) execute cleanly and match current architectural assertions.

### Meta-Progression & UX Assessment
- [ ] Mathematical evaluation of upgrade tiers (1-5) and economic sustainability of match rewards.
- [ ] Review of UI clarity (gauges, notifications, mobile touch friendliness) with actionable UX improvements.

### Actionable Enhancement Roadmap
- [ ] Prioritized list of at least 8-12 concrete improvement initiatives ordered by impact vs implementation effort.
- [ ] Specific design specifications and code snippets for top recommended enhancements.


## Follow-up — 2026-10-05T07:57:12Z

CRITICAL USER PRODUCT DIRECTIVE:
The user has specified that the game will be 100% Free-to-Play / globally accessible, monetized via voluntary donations and microtransactions/support packs. The core product mandate is to MAXIMIZE LONG-TERM PLAYER RETENTION (D1, D7, D30 retention loops) and session engagement.

Audit Team Mandate:
Integrate deep player retention and ethical monetization architectures directly into the audit report and enhancement roadmap:
1. Long-term Retention Loops: Daily contracts/bounties, season leagues/arenas, daily steam supply crate streaks, weapon/character mastery tracks.
2. Fair Non-P2W Monetization: Cosmetic customization (lantern flame colors, steam trail vents, weapon engravings, clockwork skins, founder badges), battle pass / expedition track, convenience boosters without breaking competitive combat integrity.
3. Social & Clan Hooks: Squad matchmaking retention, clan foundry tasks, viral share links, and community leaderboards.

Ensure Requirement R4 and the final strategic roadmap include an extensive dedicated section for 'Long-Term Player Retention & Fair Monetization Architecture'.
