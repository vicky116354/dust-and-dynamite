# Dust & Dynamite: Last Rodeo of Redwater Gulch

A desktop browser arena game with a third-person 3D camera behind your rider, 2–8 room slots, and optional AI opponents. Three.js/WebGL2 renders the scene; Node.js + Express + Socket.IO runs the authoritative server. All artwork and audio are procedural; no asset pack or API key is required. Play the hosted game at https://dust-and-dynamite.onrender.com.

## Install and run

Install Node.js 20 or later. Open a terminal in this folder:

```sh
npm install
npm start
```

Open **http://localhost:3000** in a desktop browser. Keep the terminal running. To stop, press Ctrl+C. If localhost does not resolve on your machine, use **http://127.0.0.1:3000**.

For another port, set `PORT` before starting. PowerShell:

```powershell
$env:PORT = '4000'
npm start
```

## Play with friends

For a public link that works over the Internet, see **[DEPLOY.md](DEPLOY.md)**. This project includes a `render.yaml` configuration for Render's free Node web service plan.

1. Choose your name, horse breed/color, threads and hat. Choose a mode, room size (2–8), and whether to fill empty slots with bots.
2. **Saddle Up** joins an open Quick Match lobby with the same mode, size and bot setting or creates one. **Create Private Room** creates a code-only lobby excluded from Quick Match.
3. Friends open the **same server**, enter the five-character code and choose **Join Room**. The room's mode overrides their local selection.
4. Every human presses **Ready to Ride**. With bot fill enabled, AI joins up to the chosen room size. With **No bots**, only the friends in the room join: at least two people are required. Posse mode needs an even number for equal teams. A 3–2–1 countdown starts when everyone is ready and those conditions are met.
5. Survive, watch the results, then choose **One More Rodeo**. This returns everyone to ready-up; each rider must ready up again.

The creator is the room host. The host can change the room size and bot setting on the poster wall between rounds; doing so resets everyone's ready status. A room cannot shrink below the number of friends already present. If the host leaves, the next human becomes host. Settings persist on rematch. For a friends-only duel, select **2 riders** and **No bots** before creating a private room.

For two players on one machine, open two browser tabs before readying. On a trusted LAN, friends use `http://YOUR_SERVER_LAN_IP:3000` (localhost refers to their own machine). Your OS must permit the server's inbound port. For Internet multiplayer, use the hosted address or run this Node process on a reachable host with WebSocket support. Static hosting alone cannot run the multiplayer server.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Ride relative to the camera; momentum and turning arc apply |
| Click the arena | Capture the mouse for free look |
| Mouse | Turn the third-person camera and center crosshair |
| Right mouse button, hold | Zoom over the shoulder and aim; right-drag also rotates without mouse capture |
| V | Toggle third-person / higher chase camera |
| C | Swap left/right shoulder |
| Escape | Release mouse capture and controls |
| Left mouse button, hold | Fire at weapon's allowed rate |
| R | Reload from reserve ammunition |
| Shift | Sprint while stamina lasts |
| Space | Jump low barricades, hay, barrels and wagons; buildings remain solid |
| Q | Throw dynamite toward cursor; 1.7 second fuse |
| E | Use collected lasso toward cursor; pull and stun a nearby enemy |
| Tab / ledger button | Toggle bounty ledger |
| Sound button | Toggle generated music and effects |

Sound begins only after interaction and is muted initially. The sound button is available throughout the game. Focus another application to release held controls.

## Rules and equipment

- **Free-for-All:** last living rider wins.
- **Posse vs Posse:** alternating slots make two balanced teams (Copper and Sage), up to four per team. Choose an even room size. Teammates cannot shoot, lasso or explode each other. Last surviving posse wins. Team names appear in the ledger and allies have sage name labels.
- **Bounty Hunt:** last living rider wins; the living player with the most kills (at least one) carries a visible bounty. Bots favor the bounty. Defeating them grants $300 instead of the usual $100. A survivor earns $500. Ties for the lead retain the earlier slot.
- Rounds last at most **180 seconds**. The storm shrinks during seconds 120–180 and damages riders beyond the ring. Multiple survivors at the time limit draw; no arbitrary winner is selected.
- Rider health and horse health are separate. Bullets have a 55% chance to hit the horse while mounted. When the horse reaches zero, the rider switches to a revolver and has **10 seconds on foot**, even if they heal.
- Crates are collected automatically by proximity: **R** repeater rifle, **S** shotgun, **✚** whiskey (+40 rider HP), **•••** ammo (+24 reserve and one dynamite), **◎** lasso, **∩** horseshoe (eight-second speed boost). Weapons replace the current weapon, with a full magazine; weapon crates cannot equip a rifle/shotgun on foot. Walk over crates to collect them; no interaction key is needed.
- Revolver: six rounds, rapid fire. Rifle: eight rounds, longer range, slower fire. Shotgun: two shells, six short-range pellets. Dynamite damages rider and horse within its blast radius, including the thrower.
- Two rolling barrels cross lanes continuously; jumping avoids barrel contact. A warned wild-horse stampede crosses the center every 60 seconds. Cover blocks movement and bullets; dynamic hazards remain independent of cover.
- Horse breeds vary speed and turning: Mustang is balanced, Appaloosa turns fastest, Black Stallion is fastest with a wide arc, Palomino sits between them. Hat and outfit are cosmetic.
- Eliminated humans spectate a surviving rider. Disconnection removes the player; reconnection returns to the title screen. Rejoin with a code once the room returns to lobby. Empty rooms are deleted.

## Folder structure

```text
dust-and-dynamite/
├── package.json
├── package-lock.json
├── server.js
├── README.md
├── .gitignore
├── client/
│   ├── index.html
│   ├── style.css
│   ├── game.js
│   ├── view3d.js
│   └── shared.js
└── test/
    └── game.test.js
```

`shared.js` is an extra required file: both Node and the browser use its movement and configuration. The delivered files contain the complete editable source. `node_modules` is generated by `npm install` and is not included in the source archive.

## Networking and performance

The server runs a fixed 30 Hz simulation and publishes 15 snapshots per second. Clients draw with `requestAnimationFrame` targeting 60 FPS (hardware dependent). The 3D view uses procedural low-poly meshes, instanced scenery, warm lighting, shadows, fog, soft dust particles, animated horses and a camera boom that shortens near walls. Its pixel ratio is capped at 1.5. Three.js is installed with npm and served locally under `/vendor/`; players do not download it from a third-party CDN. Browsers without WebGL2 retain the classic Canvas fallback.

`view3d.js` maps server X/Y coordinates to 3D X/Z. The camera's center ray determines the horizontal firing direction, and camera-relative movement uses a sanitized `moveAngle` shared between client prediction and server simulation. Combat remains on the original flat arena plane: this update adds a third-person presentation, not vertical combat, building interiors, climbing or headshots. The Wild West style is procedural and stylized rather than using assets from other games.

The local rider predicts movement using the shared fixed-step function. Each command has a sequence number; snapshots acknowledge the last consumed sequence. The client restores authoritative state and replays unacknowledged movement. Remote riders interpolate snapshots about 100 ms behind. This is a simple prediction/reconciliation implementation; correction snaps can be visible under heavy packet loss.

Server-side hitscan rewinds target positions up to 180 ms using recent server history and reported round-trip latency. Static cover always blocks shots. Client-provided positions, HP, ammunition, hit claims and elapsed time are never accepted. Shot rate, movement steps, reloads and inventory are server-controlled. Inputs are sanitized, sequence-checked and capped to five queued commands, with stale controls released after 250 ms. Packets are limited to 8 KB and in-memory rooms to 100. This is basic lag compensation; the client-reported latency is capped, not independently proven.

Rooms and scores live in process memory. The game is a runnable prototype, without accounts, durable storage, matchmaking across servers or production-grade abuse mitigation. A single process is the intended deployment. CPU overload slows simulation rather than accepting client time. Bot tactics are intentionally simple (seek, strafe, avoid cover, reload, seek safety).

## Add a weapon

1. Add an entry to `WEAPONS` in `client/shared.js`:

```js
carbine: {
  name: 'Carbine', mag: 5, interval: .5, reload: 1.8,
  damage: 30, range: 850, spread: .04, pellets: 1
}
```

2. Add its key to `types` in `spawnPickup()` in `server.js`. Weapon pickup, magazine, reload, damage, range and fire timing all use the shared table automatically.
3. Add its crate symbol in `pickup()` in `client/game.js`. Optionally customize `audio.shot()`.

These are hitscan weapons. Projectile weapons need a server-owned entity update, collision and lifetime (see dynamite in `updateHazards()`), snapshot data and client drawing. Keep damage and cooldowns on the server.

## Add or modify a map

`MAP` in `client/shared.js` contains obstacle rectangles in world coordinates. `W` and `H` define arena dimensions. Each obstacle has `x`, `y`, `w`, `h`, `type`, and `low` (jumpable). `buildObstacle()` in `client/view3d.js` constructs its 3D mesh and camera-collision volume. Update `scenery()` in `client/game.js` too for the Canvas fallback. Cactus and shrubs are decorative, without server collision.

To add another selectable map, introduce a map ID in the join form and room state; define a shared map table; use the selected map in movement collision, hitscan cover, crate spawning and rendering. Also update spawn positions, storm center/radius, stampede lanes, barrel paths and minimap scaling: these are intentionally authored for Redwater's 2200 × 1600 arena. Do not change only the background; server and client must agree on obstacles.

## Add a horse

1. Add a `HORSES` entry in `client/shared.js`, e.g. `Roan: { color: '#8e7963', speed: 232, turn: 3.9 }`.
2. Add `<option>Roan</option>` to the horse select in `client/index.html`.
3. `makeHorse()` in `view3d.js` uses the coat color. Add geometry/markings there, and update `drawRider()` for portraits and the fallback view. Bot breed rotation currently uses the first four breeds; change the `% 4` expressions if you want bots to use more breeds.

## Art, sound and optional replacement assets

Every horse, building, pickup, dust particle, muzzle flash and tumbleweed is generated in code. The main view is 3D; Canvas generates textures, poster portraits and the fallback view. The UI grain is an embedded SVG filter. Google Fonts (`Rye` and `Special Elite`) improve the poster look when online; Georgia and Courier fallbacks keep it usable offline. To remove external font requests, delete the CSS `@import`.

Web Audio supplies plucked-string and reed-like music, wind, hoof taps, gunshot/noise bursts, ricochet tones, a horse-like whinny and a victory bell. These are **synthesized placeholders**, not recorded acoustic instruments or realistic horse recordings.

Optional free sound searches (not required to run):

- Guitar: https://freesound.org/search/?q=acoustic+guitar
- Harmonica: https://freesound.org/search/?q=harmonica
- Hooves: https://freesound.org/search/?q=horse+gallop
- Revolver and ricochets: https://freesound.org/search/?q=revolver
- Horse neigh: https://freesound.org/search/?q=horse+neigh
- Wind: https://freesound.org/search/?q=desert+wind
- Saloon bell: https://freesound.org/search/?q=saloon+bell

Check the license on each selected recording; Freesound hosts several Creative Commons licenses. Use its CC0 filter for recordings without attribution requirements. License reference: https://freesound.org/help/faq/

Save chosen clips under `client/audio/` and replace the relevant `audio` methods in `game.js` with preloaded audio playback. Retain the user-gesture start and mute toggle. Serve local clips to avoid cross-origin and network dependencies.

## Verification

```sh
npm test
```

Integration tests start isolated servers on ephemeral ports with real Socket.IO clients. They check static delivery, room capacity and codes, Quick Match, ready-up, all modes, balanced bot fill, results/rematch, cover/jump/stamina physics, combat, reloads, pickups, horse dismount/foot death, storm damage, and malformed/flooded inputs. No test-only network endpoints are exposed.

Socket.IO reference: https://socket.io/docs/v4/server-options/

If clients cannot connect, verify the server is running and they use the same server URL. Room codes are only meaningful inside that process. If controls do nothing, click the arena and keep the browser focused. For audio, click **Sound On**. For deployment, ensure the reverse proxy supports WebSocket upgrades and long-polling.
