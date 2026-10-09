# AGENTS.md

Block Knight (方块骑士): a browser 3D action RPG in blocky style, landscape
only, played on phones; the defence is guarding, there is no dodge.
No bundler: plain global-scope `<script>` tags loaded in manifest order by
`core/client_boot.js`; views are fetch-loaded HTML partials. Serve over http
(`file://` breaks `fetch` and `import()`): `python -m http.server 8422` or
`Run-Game.bat`.

The one exception to "no modules": three.js. `client-assets.json` lists it
under `modules`; the boot loader `import()`s it first and exposes it as the
global `THREE`. It is vendored in `vendor/three/` (0.186.1, bundled and
minified into one file with esbuild, MIT licence alongside). Only `render/`
(and the move tuner's view, `tune/view.js`) uses `THREE`. PeerJS (1.5.5,
its own `dist/peerjs.min.js`, MIT) is an ordinary script in
`vendor/peerjs/` giving the global `Peer`; only `net/` uses it.

- `core/` simulation and maths with no DOM and no three.js: coordinates,
  matrices and box tests, rig and forward kinematics, terrain (16 x 16
  chunks, editable), the fixed-step loop, fight rules and hit tests, the
  fighters, world entities (training dummy, monsters and their AI,
  buildings, portals, chests, drops, thickets, resources that grow
  back), the interact key, items,
  gear and trade, the save format (storage injected), input maths, and
  the PVP duel protocol (host
  authority, guest prediction) over an injected `send`. Node tests run it;
  in a duel the host's copy decides. Also the boot loader.
- `models/` model data: skeletons, boxes, equipment, key poses, palette.
- `render/` three.js drawing only (terrain as one mesh per chunk); reads the
  simulation, never writes it. The menu's figure and the item icons are
  drawn by a second, small renderer (`figure_view.js`).
- `ui/` DOM: input layer, app start-up, HUD, procedural sound, room screen,
  the menu (figure, gear and bag, settings), item screens (shop, smithy).
- `net/` the channel between two phones: PeerJS rooms, or `?link=local`
  (BroadcastChannel between two tabs, for tests). No game rules.
- `tune/` the move tuner, a second page (`tune.html`, desktop, entry
  `tune` in `client-assets.json`): `lab.js` edits key poses and move timing
  live, previews moves and combos through the real simulation, makes the
  hit tests' checks and writes the edits out as source text (no DOM, no
  three.js; Node tests run it); `view.js` draws with three.js; `panel.js`
  is the page. `tune.html` loads `game_config.js` unfrozen
  (`window.unfrozenConfig`); the game never loads `tune/`.
- `mapview/` the map preview, a third page (`map.html`, entry `map` in
  `client-assets.json`; read-only, no three.js): `plan.js` turns a map of
  `gameConfig.maps` into plain data through the game's own loader, names
  a cell (`field (23, 5)`), measures a walk and casts one screen of
  ground from the camera (no DOM; Node tests run it); `page.js` draws it
  on a 2D canvas with numbered columns and rows. The game never loads
  `mapview/`.
- `vendor/` third-party files, unmodified apart from bundling.
- `index.html`, `tune.html`, `map.html`, `style.css`, `partials/` stay at root (fetch paths are document-relative)

The code, `game_config.js` and the tests are the description of current
behaviour. `docs/parameters.md` (Chinese) is every number in
`game_config.js`, readable. `docs/tasks/` (Chinese) holds three documents
and no more: `design.md` (what the game is and the rules decided, marked
where the user decided them), `roadmap.md` (what was done, what is next,
how to test in this container) and `ideas.md` (directions talked over and
not yet decided). New decisions go into
the matching section of `design.md`; an idea decided moves out of
`ideas.md` into it. History starts anew on 2026-10-08; everything before
is the archived repository `Jyung99Red/pvp-game`, where the 2D version is
tag `v1-2d` (commit `2a313c4`).
This file only changes when project setup changes.

## Rules

- Tunable numbers live only in `game_config.js`. When they change, update
  `docs/parameters.md` to match. Model shapes and key
  poses are data in `models/`, not tunables.
- What is drawn is what is judged: poses that change a body's volume are a
  pure function of simulation state (`core/player_anim.js`); `render/` adds
  only drawn-only motion (breathing, leaning).
- Done = committed and pushed straight to `main` (user, 2026-10-08): no
  pull request, no asking first. A session given a branch of its own pushes
  that branch as well.
- Tests (user, 2026-10-08): a matter of judgement. Only logic a change
  could break needs its tests run (`node --test tests/<file>.test.cjs`);
  the picture and tuned numbers are the user's to judge, on the phone.
  A test checks logic: only that is worth writing, never a tuned number
  or a map's layout (user, 2026-10-09).
  `tests/browser-smoke.test.cjs` needs Playwright: on Windows, install
  `playwright-core` anywhere and set `PLAYWRIGHT_MODULE` to it and
  `PLAYWRIGHT_CHANNEL=chrome`.
- New script or partial: register it in `client-assets.json` under its
  page's entry; a partial also needs `#mount-<id>` in that page
  (`index.html`, `tune.html` or `map.html`).
- Code comments and `AGENTS.md` in English; `README.md`, UI text and
  `docs/` in Chinese.
- Ask the user before adding a feature they did not ask for, or changing
  a rule already decided (user, 2026-10-05). Keep `design.md` short: what
  the game is and the rules decided, not how they are built or tested;
  its section numbers stay, code comments cite them.
