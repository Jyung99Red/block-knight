// Picture fingerprints (roadmap.md 4.0): the real page in headless
// Chromium, a set of fixed scenes, each drawn and read back as one hash of
// the whole picture. Run it before and after a change to the drawing code
// that should change nothing, and compare: the same code gives the same
// prints run after run on one machine (another machine or browser may
// differ). Not a test: `node tests/pixels.cjs [file]` prints the prints
// and, with a file, writes them there as JSON or, if the file is there
// already, compares with it and exits 1 on any difference. PIXELS_SHOTS=<dir>
// saves each scene's picture there too.
//
// Nothing runs on real time: requestAnimationFrame does nothing (the game's
// own loop never runs, and the page is waited for by the clock), Math.random
// is fixed, the simulation is stepped with game.run and every frame drawn
// with game.view.render.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.join(__dirname, '..');

function findPlaywright() {
    for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
        try { return require(id); } catch (_) { /* try the next one */ }
    }
    return null;
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
    const server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        const target = file.endsWith(path.sep) ? path.join(file, 'index.html') : file;
        if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream' });
        fs.createReadStream(target).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Before any page script: no frames of its own, one fixed random sequence.
function fix() {
    window.requestAnimationFrame = () => 0;
    let a = 12345;
    Math.random = () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// In the page: draw `frames` frames `dt` seconds apart, then hash the picture.
// With `shot`, the picture as a PNG data URL too.
function print({ frames = 3, dt = 1 / 60, shot = false } = {}) {
    const g = window.game;
    for (let i = 0; i < frames; i++) g.view.render(g.sim, i ? dt : 0);
    const gl = g.view.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let hash = 0x811c9dc5, lit = 0;
    for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 0x01000193);
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    const out = `${(hash >>> 0).toString(16).padStart(8, '0')} ${w}x${h} lit ${(lit / (w * h)).toFixed(3)}`;
    return shot ? [out, g.view.renderer.domElement.toDataURL('image/png')] : [out];
}

// Scene set-ups, run in the page before `print`.
const setups = {
    // Wear `items` ({ slot: id }) and build the region again with them.
    wear: function (items) {
        const g = window.game, p = g.sim.progress;
        for (const [slot, id] of Object.entries(items)) { p.inventory.items[id] = 1; p.loadout[slot] = id; }
        g.load(g.map, { quiet: true });
    },
    torch: function () { window.game.sim.player.lit = true; },
    // The nearest monster a block and a half in front of the player, in its first move's windup.
    windup: function () {
        const g = window.game, me = g.sim.player, U = gameConfig.world.unitsPerBlock;
        const m = g.sim.monsters.slice().sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
        if (!m) return;
        m.x = me.x + Math.cos(me.facing) * 1.5 * U; m.y = me.y + Math.sin(me.facing) * 1.5 * U;
        m.facing = me.facing + Math.PI;
        m.phase = 'windup'; m.move = Object.keys(gameConfig.monsters[m.kind].moves)[0]; m.t = 0.3;
    },
    // Loot of every kind round the player.
    drops: function () {
        const g = window.game, me = g.sim.player, U = gameConfig.world.unitsPerBlock;
        ['gold', ...Object.keys(propModels.drops).filter(k => k !== 'gold')].forEach((item, i) => {
            const a = i * 0.9;
            entityKit.add(g.sim, { id: entityKit.nextId(g.sim, 'd'), type: 'drop', item, amount: 1, x: me.x + Math.cos(a) * 1.2 * U, y: me.y + Math.sin(a) * 1.2 * U, h: 0, facing: a, radius: gameConfig.drops.radius, solid: false, vx: 0, vy: 0, t: 0, pull: null });
        });
    },
    // The nearest thickets burning.
    fire: function () {
        const g = window.game, me = g.sim.player;
        const brush = g.sim.entities.filter(e => e.type === 'brush').sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y)).slice(0, 3);
        brush.forEach((e, i) => { e.burning = 0.4 + i; });
        // Stand south of them, facing north.
        const U = gameConfig.world.unitsPerBlock;
        if (brush[0]) { me.x = brush[0].x + U; me.y = brush[0].y + 2 * U; me.facing = -Math.PI / 2; }
    },
    quality: function (level) { window.game.view.settings({ zoom: 1, quality: level }); },
    walk: function (seconds) { window.game.run(seconds); }
};

// Each page: an address and its scenes, one after another on the same page.
const PAGES = [
    ['?map=clearing', [['clearing'], ['clearing walked', ['walk', 1.5]]]],
    ['?map=clearing&boxes', [['clearing boxes']]],
    ['?map=base&hour=12', [['base noon'], ['base drops', ['drops']]]],
    ['?map=field&hour=12', [
        ['field noon'], ['field windup', ['windup']],
        ['field saver', ['quality', 'saver']], ['field ultra', ['quality', 'ultra']],
        ['field no bounce', ['quality', { pixelRatio: 1, sunShadow: 1024, torchShadow: 256, torchTaps: 6, bounce: false }]]
    ]],
    ['?map=field&hour=7.5', [['field dawn']]],
    ['?map=field&hour=18.6', [['field dusk']]],
    ['?map=field&hour=23', [['field night'], ['field night torch', ['wear', { offhand: 'torch' }], ['torch']]]],
    ['?map=valley&hour=10', [['valley'], ['valley windup', ['windup']]]],
    ['?map=cave', [
        ['cave dark'], ['cave torch', ['wear', { offhand: 'torch' }], ['torch']], ['cave torch walked', ['walk', 1]], ['cave fire', ['fire']],
        ['cave ghost', ['wear', { offhand: 'torch', accessory: 'stealth_ring' }], ['torch']], ['cave ghost windup', ['windup']]
    ]]
];

async function main() {
    const pw = findPlaywright();
    if (!pw) { console.error('Playwright is not installed'); process.exit(2); }
    const browser = await pw.chromium.launch({
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const server = await serve(), base = `http://127.0.0.1:${server.address().port}/`;
    const prints = {};
    try {
        for (const [query, scenes] of PAGES) {
            const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
            await context.addInitScript(fix);
            const page = await context.newPage(), errors = [];
            page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(base + query, { waitUntil: 'load' });
            await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000, polling: 100 });
            await page.evaluate(() => window.game.pause(true));
            for (const [name, ...steps] of scenes) {
                for (const [step, arg] of steps) await page.evaluate(`(${setups[step]})(${JSON.stringify(arg)})`);
                const shots = process.env.PIXELS_SHOTS, [out, png] = await page.evaluate(print, { shot: !!shots });
                prints[name] = out;
                if (shots) {
                    fs.mkdirSync(shots, { recursive: true });
                    fs.writeFileSync(path.join(shots, `${name.replace(/ /g, '-')}.png`), Buffer.from(png.split(',')[1], 'base64'));
                }
                console.log(`${name.padEnd(20)} ${prints[name]}`);
            }
            if (errors.length) throw new Error(`${query}: ${errors.join('; ')}`);
            await context.close();
        }
    } finally {
        await browser.close();
        server.close();
    }
    const file = process.argv[2];
    if (!file) return;
    if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(prints, null, 1)); console.log(`written to ${file}`); return; }
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const changed = Object.keys({ ...before, ...prints }).filter(k => before[k] !== prints[k]);
    if (!changed.length) { console.log(`all ${Object.keys(prints).length} the same as ${file}`); return; }
    for (const k of changed) console.log(`changed: ${k}: ${before[k] ?? '-'} -> ${prints[k] ?? '-'}`);
    process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exit(2); });
