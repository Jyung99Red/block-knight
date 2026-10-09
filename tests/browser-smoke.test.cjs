// Browser smoke test (roadmap.md 4): the real page in headless Chromium
// as a landscape phone. Boots without console errors, draws the world, lays
// out the controls, covers portrait with the rotate hint, two real touch
// points (stick + A) drive the simulation together; the world (M5): from
// the base through a portal by touch, a fight, falling and home, walls in
// front cut open, a monster behind the player's back not drawn, the save
// across a reload. Two pages of one browser play
// a whole duel over ?link=local (design.md 8), one of them going to the
// background and back on the way.
//
// Skipped when Playwright is not available. It is looked up as
// PLAYWRIGHT_MODULE (a path), then `playwright`, `playwright-core`, then the
// cloud container's global install. PLAYWRIGHT_CHANNEL=chrome (or msedge)
// uses an installed browser instead of Playwright's own. SMOKE_SHOTS=<dir>
// saves screenshots there.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
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

let browser = null, server = null, base = '', skip = '';
before(async () => {
    const pw = findPlaywright();
    if (!pw) { skip = 'Playwright is not installed'; return; }
    try {
        browser = await pw.chromium.launch({
            channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        });
    } catch (error) { skip = `no browser to launch (${error.message.split('\n')[0]})`; return; }
    server = await serve();
    base = `http://127.0.0.1:${server.address().port}/`;
});
after(async () => { await browser?.close(); server?.close(); });

async function openPage(context, query) {
    const page = await context.newPage(), errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + query, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000 });
    return { page, errors };
}
async function openPhone(width, height, query = '?map=clearing') {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const { page, errors } = await openPage(context, query);
    // Freeze real time: the test steps the simulation itself.
    await page.evaluate(() => window.game.pause(true));
    return { context, page, errors };
}
async function shot(page, name) {
    if (!process.env.SMOKE_SHOTS) return;
    fs.mkdirSync(process.env.SMOKE_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SMOKE_SHOTS, `${name}.png`) });
}

test('landscape phone: boots clean, draws the world, controls laid out', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const info = await page.evaluate(() => {
            const g = window.game, rect = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, w: r.width, h: r.height }; };
            const buttons = {};
            document.querySelectorAll('[data-button]').forEach(el => { buttons[el.dataset.button] = rect(el); });
            // Sample the frame right after drawing it, before it is presented.
            g.view.render(g.sim, 0);
            const gl = g.view.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4), samples = [];
            for (const [fx, fy] of [[0.5, 0.15], [0.3, 0.3], [0.7, 0.3], [0.25, 0.75], [0.75, 0.75]]) {
                gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                samples.push(Array.from(px));
            }
            return {
                buttons, samples, drawing: [w, h],
                rotateHint: getComputedStyle(document.querySelector('.rotate-hint')).display,
                interactIdle: document.querySelector('[data-button="interact"]').classList.contains('idle'),
                guardKind: document.querySelector('[data-button="guard"]').dataset.kind,
                offhandGrey: document.querySelector('[data-button="offhand"]').classList.contains('disabled'),
                // The clock (user, 2026-10-06): its rim's arcs, and the sun for a new game's morning.
                clock: [document.querySelectorAll('[data-hud="clock-ring"] path').length, document.querySelector('[data-hud="clock"]').dataset.body],
                calls: g.view.info().calls, threeRevision: THREE.REVISION
            };
        });
        await shot(page, 'landscape');
        assert.deepEqual(errors, []);
        assert.equal(info.rotateHint, 'none');
        const list = Object.entries(info.buttons);
        assert.equal(list.length, 4);
        for (const [id, b] of list) assert.ok(b.x - b.r >= 0 && b.x + b.r <= 844 && b.y - b.r >= 0 && b.y + b.r <= 390, `${id} on screen`);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const [ia, a] = list[i], [ib, b] = list[j];
            assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 10 - 0.5, `${ia} and ${ib} overlap`);
        }
        assert.ok(info.interactIdle);
        assert.equal(info.guardKind, 'shield');
        assert.equal(info.offhandGrey, true, 'with the shield the offhand key is grey');
        // What the fighter does not see goes dark, the blocks with the
        // ground they stand on (user, 2026-10-05): a stone five blocks west
        // of the player, looked at and then with the player's back to it.
        const shade = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player, t = s.terrain, gl = g.view.renderer.getContext(), N = 6, px = new Uint8Array(N * N * 4), facing = p.facing;
            const c = Math.floor(p.x / 40) - 5, r = Math.floor(p.y / 40), was = [terrainKit.kindAt(t, c, r), terrainKit.levelAt(t, c, r)];
            terrainKit.set(t, c, r, 'stone', 1);
            const bright = at => {
                const q = g.view.project(at), k = gl.drawingBufferWidth / innerWidth;
                gl.readPixels(Math.round(q.x * k) - N / 2, Math.round(gl.drawingBufferHeight - q.y * k) - N / 2, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
                let sum = 0;
                for (let i = 0; i < N * N; i++) sum += px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
                return sum / (N * N * 3);
            };
            // The stone's top, and the grass just south of it.
            const look = to => { p.facing = to; g.view.render(s, 0); return { top: bright([c + 0.5, 1, r + 0.5]), ground: bright([c + 0.5, 0, r + 1.6]) }; };
            const seen = look(Math.PI), unseen = look(0);
            terrainKit.set(t, c, r, ...was); p.facing = facing; g.view.render(s, 0);
            return { seen, unseen };
        });
        // Fullscreen is asked on the first touch, and again on the first
        // touch back from the background (user, 2026-10-08), not on others.
        const asked = await page.evaluate(() => {
            let n = 0;
            const el = document.documentElement, counts = [], touch = type => { window.dispatchEvent(new PointerEvent('pointerup', { pointerType: type })); counts.push(n); };
            el.requestFullscreen = () => { n++; return Promise.reject(new Error('not in this test')); };
            touch('mouse'); touch('touch'); touch('touch');
            document.dispatchEvent(new Event('visibilitychange'));
            touch('touch'); touch('touch');
            delete el.requestFullscreen;
            return counts;
        });
        assert.deepEqual(asked, [0, 1, 1, 2, 2]);
        // A real-time fight: the frame loop runs, J is A, the dummy swings back.
        await page.evaluate(() => { const g = window.game, d = g.sim.dummy; g.sim.player.x = d.x - 60; g.sim.player.y = d.y; g.sim.player.facing = 0; g.pause(false); });
        for (let i = 0; i < 3; i++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
        // Software rendering can leave most of a second between frames, and
        // a frame runs at most MAX_FRAME of simulation: wait for the hit.
        await page.waitForFunction(() => window.game.sim.stats.hits >= 1, null, { timeout: 15000 }).catch(() => {});
        const fight = await page.evaluate(() => { window.game.pause(true); return { ...window.game.sim.stats, hp: window.game.sim.dummy.hp }; });
        assert.ok(fight.attacks >= 1 && fight.hits >= 1, `fight ${JSON.stringify(fight)}`);
        await shot(page, 'fight');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('two thumbs through real touch points: stick with the shield, then stick with A', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const at = await page.evaluate(() => {
            window.game.sim.dummy.wait = 1e9; // keep the dummy out of it
            const c = el => { const r = document.querySelector(el).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
            return { a: c('[data-button="attack"]'), shield: c('[data-button="guard"]'), x0: window.game.sim.player.x };
        });
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const stick = { x: 160, y: 300, id: 1 }, shield = { x: at.shield.x, y: at.shield.y, id: 2 }, a = { x: at.a.x, y: at.a.y, id: 3 };
        await touch('touchStart', [stick]);
        await touch('touchStart', [stick, shield]);
        await touch('touchMove', [{ ...stick, x: 220 }, shield]);
        // Moves are delivered with the next frame, which is slow here.
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        const during = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.ok(during.move.x > 0.99 && Math.abs(during.move.y) < 1e-9, JSON.stringify(during));
        assert.notEqual(during.shield, 'down');
        assert.deepEqual([...during.pointers].sort(), ['guard', 'stick']);
        // A third finger is ignored: two thumbs is the limit.
        await touch('touchStart', [{ ...stick, x: 220 }, shield, { ...a, id: 4 }]);
        await frame();
        assert.equal(await page.evaluate(() => window.game.sim.input.buttons.attack.held), false);
        const walked = await page.evaluate(() => { window.game.run(1); return window.game.sim.player.x; });
        // Slowly with the shield up (a little less while it turns and gets going).
        const slow = await page.evaluate(() => gameConfig.player.speed * gameConfig.combat.guard.moveMultiplier);
        assert.ok(walked - at.x0 > 0.6 * slow && walked - at.x0 < slow + 1, `walked ${walked - at.x0} with the shield up`);
        await shot(page, 'two-thumbs');
        // A resize (going fullscreen does one) keeps the held stick alive.
        await page.setViewportSize({ width: 844, height: 380 });
        await page.waitForFunction(() => innerHeight === 380);
        await touch('touchMove', [{ ...stick, x: 160, y: 240 }, shield]);
        await page.waitForFunction(() => window.game.sim.input.move.y < -0.99, null, { timeout: 10000 }).catch(() => {});
        const afterResize = await page.evaluate(() => ({ move: window.game.sim.input.move, pointers: window.game.input.state().pointers }));
        assert.ok(afterResize.move.y < -0.99, `stick after resize: ${JSON.stringify(afterResize)}`);
        // Real time: unpaused, the frame loop walks the body on its own.
        // Frames can be most of a second apart here, so after the clock has
        // run, wait for two more frames: the game's own frame comes first.
        const real = await page.evaluate(async () => {
            const g = window.game, y0 = g.sim.player.y, t0 = performance.now(), speed = gameConfig.player.speed;
            const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false);
            await new Promise(resolve => setTimeout(resolve, 600));
            await frame(); await frame();
            g.pause(true);
            return { walked: y0 - g.sim.player.y, seconds: (performance.now() - t0) / 1000, speed };
        });
        assert.ok(real.walked > 1 && real.walked <= real.speed * 0.3 * real.seconds + 1, `real-time walk ${JSON.stringify(real)} ${errors.join(' / ')}`);
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        const released = await page.evaluate(() => ({ move: window.game.sim.input.move, shield: window.game.sim.player.guard.state, pointers: window.game.input.state().pointers }));
        assert.deepEqual(released.move, { x: 0, y: 0 });
        assert.equal(released.shield, 'down');
        assert.deepEqual(released.pointers, []);
        // Stick and a tap of the attack key: an A, and the body stands for it.
        await touch('touchStart', [stick]);
        await touch('touchMove', [{ ...stick, x: 220 }]);
        await page.waitForFunction(() => window.game.sim.input.move.x > 0.99, null, { timeout: 10000 });
        await touch('touchStart', [{ ...stick, x: 220 }, a]);
        await page.waitForFunction(() => window.game.sim.input.buttons.attack.held, null, { timeout: 10000 });
        await touch('touchEnd', [a]);
        await page.waitForFunction(() => window.game.sim.player.act !== null, null, { timeout: 10000 });
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1, 'the stick is still held');
        assert.equal(await page.evaluate(() => window.game.sim.player.act.move), 'slash');
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        await page.evaluate(() => window.game.run(1));
        // Desktop keys: D walks east, J is the attack key.
        await page.keyboard.down('KeyD');
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 1);
        await page.keyboard.up('KeyD');
        await page.keyboard.press('KeyJ');
        assert.deepEqual(await page.evaluate(() => [window.game.sim.input.move.x, window.game.sim.input.buttons.attack.presses, window.game.sim.stats.attacks]), [0, 2, 2]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('a drag across the picture turns the camera round the fighter (design.md 3.2): the stick goes by the screen as it now stands, and a control pressed takes the turning thumb\'s place', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390);
    try {
        const at = await page.evaluate(() => {
            window.game.sim.dummy.wait = 1e9; // keep the dummy out of it
            const r = document.querySelector('[data-button="attack"]').getBoundingClientRect();
            return { a: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, turn: gameConfig.input.turn };
        });
        const cdp = await context.newCDPSession(page);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
        const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // Which way the camera stands from the fighter, as a yaw, and how far along the ground (blocks).
        const eye = () => page.evaluate(() => {
            const p = window.game.sim.player, me = space.toBlocks(p.x, p.y), c = window.game.view.camera.position;
            return { yaw: Math.atan2(c.x - me[0], c.z - me[2]), far: Math.hypot(c.x - me[0], c.z - me[2]), up: c.y };
        });
        const near = (a, b, slack = 1e-6) => Math.abs(a - b) < slack;
        await frame();
        const first = await eye();
        // A thumb goes 200 px to the right across the picture: looking to
        // the right, the camera goes round to the fighter's west.
        const look = { x: 400, y: 150, id: 1 }, stick = { x: 160, y: 300, id: 2 }, a = { x: at.a.x, y: at.a.y, id: 3 };
        await touch('touchStart', [look]);
        await touch('touchMove', [{ ...look, x: 600 }]);
        await page.waitForFunction(() => window.game.input.state().yaw !== 0, null, { timeout: 10000 });
        const turned = await page.evaluate(() => window.game.input.state());
        assert.deepEqual(turned.pointers, ['look']);
        assert.ok(near(turned.yaw, -200 * at.turn), `yaw ${turned.yaw}`);
        await frame();
        const second = await eye();
        assert.ok(near(second.yaw, turned.yaw) && near(second.far, first.far) && near(second.up, first.up), `the camera after the drag: ${JSON.stringify(second)}`);
        assert.equal(await page.evaluate(() => window.game.sim.input.move.x), 0, 'turning the camera moves nobody');
        await shot(page, 'camera-turned');
        // The other thumb pushes the stick up: away from the camera as it now stands.
        await touch('touchStart', [{ ...look, x: 600 }, stick]);
        await touch('touchMove', [{ ...look, x: 600 }, { ...stick, y: 240 }]);
        await page.waitForFunction(() => Math.hypot(window.game.sim.input.move.x, window.game.sim.input.move.y) > 0.99, null, { timeout: 10000 });
        const pushed = await page.evaluate(() => ({ move: window.game.sim.input.move, pointers: window.game.input.state().pointers }));
        assert.ok(near(pushed.move.x, -Math.sin(turned.yaw)) && near(pushed.move.y, -Math.cos(turned.yaw)), JSON.stringify(pushed));
        assert.deepEqual([...pushed.pointers].sort(), ['look', 'stick']);
        // The camera turned back under a stick held still: the fighter's way turns with it.
        await touch('touchMove', [look, { ...stick, y: 240 }]);
        await page.waitForFunction(() => window.game.sim.input.move.y < -0.999, null, { timeout: 10000 }).catch(() => {});
        const back = await page.evaluate(() => ({ move: window.game.sim.input.move, yaw: window.game.input.state().yaw }));
        assert.ok(near(back.yaw, 0) && near(back.move.x, 0) && near(back.move.y, -1), JSON.stringify(back));
        // Two touches are down. A control pressed now is not refused: the
        // thumb turning the camera gives way to it, and turns nothing more.
        await touch('touchStart', [look, { ...stick, y: 240 }, a]);
        await page.waitForFunction(() => window.game.sim.input.buttons.attack.held, null, { timeout: 10000 });
        await touch('touchMove', [{ ...look, x: 500 }, { ...stick, y: 240 }, a]);
        await frame();
        const taken = await page.evaluate(() => window.game.input.state());
        assert.deepEqual([...taken.pointers].sort(), ['attack', 'stick']);
        assert.ok(near(taken.yaw, 0), `yaw ${taken.yaw}`);
        await touch('touchEnd', []);
        await page.waitForFunction(() => window.game.input.state().pointers.length === 0, null, { timeout: 10000 }).catch(() => {});
        assert.deepEqual(await page.evaluate(() => window.game.input.state().pointers), []);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('the world: the title screen, the base, through the north gate by touch, a fight, falling and home again; walls in front go see-through; back to the title and on; the save keeps it', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390, '');
    try {
        // The page opens on the title screen (user, 2026-10-08): no save yet,
        // so no 继续冒险; the base behind it stands still and the HUD is away;
        // nothing is saved till the adventure begins. Its settings unfold
        // beside the keys and work as the menu's.
        const titleKeys = () => page.evaluate(() => [...document.querySelectorAll('[data-title-act]')].filter(b => !b.hidden).map(b => b.textContent));
        assert.deepEqual(await titleKeys(), ['开始冒险', '联机对战', '设置']);
        const newKey = () => page.evaluate(() => [...document.querySelector('[data-title-act="new"]').classList].filter(c => ['primary', 'danger'].includes(c)));
        assert.deepEqual(await newKey(), ['primary'], 'no save: 开始冒险 is the main key');
        const still = await page.evaluate(async () => {
            const g = window.game, t0 = g.sim.time, frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false); await frame(); await frame(); await frame(); g.pause(true);
            return [g.title.isOpen(), g.sim.time - t0, getComputedStyle(document.querySelector('[data-menu]')).visibility, localStorage.getItem('block-knight-save')];
        });
        assert.deepEqual(still, [true, 0, 'hidden', null]);
        // Behind it the camera is not the fighter's (user, 2026-10-08): shot
        // after shot it goes round something of the base's picked at random
        // (a building, a portal, the chest, a standing torch), never the
        // last one again, which stands right of the middle; the view is
        // wider; dark at a cut. Drawn for the game again, the camera is the
        // game's; neither is stretched. (Stepped here by hand, from a tour begun afresh.)
        const tour = await page.evaluate(() => {
            const g = window.game, v = g.view, me = g.sim.player, at = space.toBlocks(me.x, me.y, me.h), S = gameConfig.camera.title;
            const step = (dt, tour = true) => {
                v.render(g.sim, dt, { tour });
                const focus = v.tourFocus, p = v.project(tour ? focus.look : [at[0], at[1] + 1, at[2]]);
                const canvas = v.renderer.domElement, stretch = v.camera.aspect / (canvas.clientWidth / canvas.clientHeight);
                return { focus: focus?.id, eye: v.camera.position.toArray(), x: p.x / window.innerWidth, fov: v.camera.fov, fade: v.tourFade, stretch };
            };
            step(0, false); step(0);
            const a = step(S.seconds / 2), b = step(1), cut = step(S.seconds / 2 - 1), next = step(S.seconds / 2), game = step(0, false);
            const things = g.sim.entities.filter(e => ['building', 'portal', 'chest'].includes(e.type) || (e.type === 'lamp' && e.kind === 'stand')).map(e => e.id);
            return { a, b, cut, next, game, things, shift: S.shift, fov: [S.fov, gameConfig.camera.fov] };
        });
        const apart = (p, q) => Math.hypot(...p.eye.map((v, i) => v - q.eye[i]));
        assert.ok(tour.things.includes(tour.a.focus) && tour.things.includes(tour.next.focus), `${tour.a.focus}, ${tour.next.focus}: things of the base`);
        assert.ok(tour.a.focus === tour.b.focus && apart(tour.a, tour.b) > 0.1, `one shot glides round one thing: ${JSON.stringify(tour)}`);
        assert.ok(tour.next.focus !== tour.b.focus && apart(tour.b, tour.next) > 1, `the next shot is of another: ${JSON.stringify(tour)}`);
        assert.ok(tour.a.fade === 0 && tour.cut.fade > 0.99, `clear in a shot, dark at the cut: ${tour.a.fade}, ${tour.cut.fade}`);
        assert.ok(Math.abs(tour.game.x - 0.5) < 0.02 && tour.game.fov === tour.fov[1] && tour.game.fade === 0, JSON.stringify(tour.game));
        for (const one of [tour.a, tour.next, tour.game]) assert.ok(Math.abs(one.stretch - 1) < 1e-6, `the camera's aspect is the canvas's: ${JSON.stringify(one)}`);
        // The page's next frames go round again from the start: the title screen dims the picture as the tour begins.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-title-cut]')).opacity)) > 0.5);
        await page.click('[data-title-act="settings"]');
        await page.click('[data-title-settings] [data-setting="perf"][data-pick="1"]');
        assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-perf]').hidden, JSON.parse(localStorage.getItem('block-knight-settings')).perf]), [true, false]);
        await page.click('[data-title-settings] [data-setting="perf"][data-pick="0"]');
        await shot(page, 'title');
        await page.click('[data-title-act="new"]');
        assert.deepEqual(await page.evaluate(() => [window.game.title.isOpen(), getComputedStyle(document.querySelector('[data-menu]')).visibility]), [false, 'visible']);
        const start = await page.evaluate(() => {
            const g = window.game;
            g.view.render(g.sim, 0);
            return {
                map: g.map, monsters: g.sim.monsters.length, buildings: g.sim.entities.filter(e => e.type === 'building').map(e => e.kind).sort(),
                calls: g.view.info().calls, goal: document.querySelector('[data-hud="goal"]').textContent, banner: document.querySelector('[data-hud="region-title"]').textContent,
                key: document.querySelector('[data-hud="interact"]').textContent, idle: document.querySelector('[data-button="interact"]').classList.contains('idle')
            };
        });
        assert.deepEqual({ ...start, calls: undefined }, {
            map: 'base', monsters: 0, buildings: ['hotSpring', 'shop', 'smithy', 'storage'], calls: undefined, goal: '曙光村 · 🪙 0', banner: '曙光村', key: '交互', idle: true
        });
        // (A standing torch's shadows drawn anew are some fifty more, now and then.)
        assert.ok(start.calls > 0 && start.calls < 150, `${start.calls} draw calls: terrain is a mesh per chunk`);
        await shot(page, 'base');
        // The storage: the key names it, a tap opens the menu with the bag (one bag: the storage is it).
        const key = await page.evaluate(() => {
            const g = window.game, p = g.sim.player, s = g.sim.entities.find(e => e.kind === 'storage');
            Object.assign(p, { x: s.x, y: s.y + 30, facing: -Math.PI / 2 }); g.run(0.05);
            const r = document.querySelector('[data-button="interact"]').getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.waitForFunction(() => document.querySelector('[data-hud="interact"]').textContent === '进入' && document.querySelector('[data-hud="tag-name"]').textContent === '仓库', null, { timeout: 10000 });
        await page.touchscreen.tap(key.x, key.y);
        await page.waitForFunction(() => window.game.menu.isOpen(), null, { timeout: 10000 });
        // Worn: the three starter pieces, drawn from their models; the bag is otherwise empty.
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-menu-slots] [data-item]')].map(e => [e.dataset.item, e.querySelector('img.item-icon')?.src.startsWith('data:image/png') || false])),
            [['wooden_sword', true], ['wooden_shield', true], ['cloth_armor', true]]);
        assert.equal(await page.evaluate(() => document.querySelectorAll('[data-menu-bag] [data-item]').length), 0);
        await shot(page, 'storage');
        await page.click('[data-menu-act="close"]');
        // The north gate, by touch: off to the field, standing at the gate back.
        await page.evaluate(() => {
            const g = window.game, p = g.sim.player, gate = g.sim.entities.find(e => e.id === 'p-field');
            Object.assign(p, { x: gate.x, y: gate.y + 40, facing: -Math.PI / 2 }); g.run(0.05);
        });
        await page.waitForFunction(() => document.querySelector('[data-hud="interact"]').textContent === '前往', null, { timeout: 10000 });
        await page.touchscreen.tap(key.x, key.y);
        await page.waitForFunction(() => window.game.map === 'field', null, { timeout: 10000 });
        const field = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player, gate = s.entities.find(e => e.id === 'p-base');
            g.view.render(s, 0);
            return { kinds: [...new Set(s.monsters.map(m => m.kind))].sort(), near: Math.hypot(p.x - gate.x, p.y - gate.y), calls: g.view.info().calls, banner: document.querySelector('[data-hud="region-title"]').textContent };
        });
        assert.deepEqual(field.kinds, ['goblin', 'goblinChief', 'wolf']);
        assert.ok(field.near < 80, `arrived ${field.near} from the gate back`);
        assert.equal(field.banner, '晨雾原野');
        assert.ok(field.calls > 0 && field.calls < 100, `${field.calls} draw calls`);
        // Walk up to a goblin: it notices and a "!" shows over it; its windup shows its warning.
        const alert = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.kind === 'goblin'), p = s.player;
            p.x = m.x - 120; p.y = m.y; p.facing = 0;
            g.run(0.05);
            return m.phase;
        });
        assert.equal(alert, 'alert');
        await page.waitForFunction(() => document.querySelectorAll('.mob:not([hidden]) .mob-alert:not([hidden])').length === 1, null, { timeout: 10000 });
        const fight = await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters.find(x => x.phase === 'alert');
            for (let i = 0; i < 300 && m.phase !== 'windup'; i++) g.run(0.01);
            g.run(0.5);
            g.view.render(s, 0.016);
            // The goblin's own warning (a wolf near by may be showing one too).
            const shown = () => g.view.scene.children.find(o => o.isMesh && o.visible && o.material?.color?.getHexString?.() === 'ff2a1a' && Math.hypot(o.position.x - m.x / 40, o.position.z - m.y / 40) < 0.5);
            const warning = shown(), p = s.player, seen = g.view.seen(m.id);
            // Sight (user, 2026-10-04): with the player's back to it, the
            // goblin and its warning are not drawn; facing it again they are.
            // (From past the ring round the player, where it sees whichever
            // way it faces: player.sight.day.near.)
            p.x = m.x - gameConfig.player.sight.day.near - 40; p.y = m.y;
            p.facing = Math.PI; g.view.render(s, 0.016);
            const behind = { seen: g.view.seen(m.id), warning: !!shown() };
            p.facing = 0; g.view.render(s, 0.016);
            return { phase: m.phase, opacity: warning ? warning.material.opacity : 0, seen, behind, again: g.view.seen(m.id), key: document.querySelector('[data-button="interact"]').className };
        });
        assert.equal(fight.phase, 'windup');
        assert.ok(fight.opacity > 0.1, `the warning shows through the windup: ${JSON.stringify(fight)}`);
        assert.deepEqual([fight.seen, fight.behind, fight.again], [true, { seen: false, warning: false }, true], 'a monster behind the player is not drawn');
        await page.waitForFunction(() => document.querySelector('[data-hud="target-name"]').textContent === '哥布林', null, { timeout: 10000 });
        await shot(page, 'field-windup');
        // A wall in front of the player is cut open round them (how the
        // picture then looks is for the eye, on the phone).
        const cut = await page.evaluate(() => {
            const g = window.game, s = g.sim, p = s.player;
            s.monsters = s.monsters.filter(m => m.boss);
            // (Just north of the chief's yard's south wall, three blocks
            // high. The cut eases open while the wall hides the player.)
            Object.assign(p, { x: 43.5 * 40, y: 13.4 * 40, facing: -Math.PI / 2, act: null, stun: 0, push: null });
            g.view.render(s, 1); g.view.render(s, 1);
            return { open: g.view.ground.cut.open.value };
        });
        await shot(page, 'cutaway');
        assert.equal(cut.open, 1, 'the wall hides the player: the cut is open');
        // Falling: the trip ends; home to the base, whole.
        await page.evaluate(() => {
            const g = window.game, s = g.sim, m = s.monsters[0], p = s.player;
            p.hp = 1; p.x = m.x - 60; p.y = m.y; p.facing = Math.PI; m.phase = 'chase'; m.wait = 0;
            for (let i = 0; i < 500 && !s.result; i++) g.run(0.01);
        });
        await page.waitForFunction(() => window.game.panel === 'lose', null, { timeout: 30000 });
        assert.equal(await page.evaluate(() => document.querySelector('[data-panel-title]').textContent), '倒下了');
        await shot(page, 'fallen');
        await page.click('[data-action="home"]');
        assert.deepEqual(await page.evaluate(() => [window.game.map, window.game.panel, window.game.sim.player.hp, window.game.sim.result]), ['base', null, 360, null]);
        // The menu: no way home from it (user, 2026-10-02). It opens on the
        // character page; the settings page takes its place, a key picks a
        // choice; opened again it is the character page (user, 2026-10-08).
        await page.click('[data-menu]');
        const pages = () => page.evaluate(() => [[...document.querySelectorAll('[data-menu-page][aria-selected="true"]')].map(b => b.textContent),
            ...['role', 'settings'].map(name => document.querySelector(`[data-menu-page-body="${name}"]`).hidden)]);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.menu-side [data-menu-page], .menu-side [data-menu-act]')].map(b => b.textContent)), ['角色', '设置', '暂停', '回到主界面']);
        assert.deepEqual(await pages(), [['角色'], false, true]);
        await page.click('[data-menu-page="settings"]');
        assert.deepEqual(await pages(), [['设置'], true, false]);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-menu-settings] .setting-name')].map(e => e.textContent)), ['音效', '帧率', '镜头', '画质']);
        await page.click('[data-menu-settings] [data-setting="camera"][data-pick="2"]');
        assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-menu-settings] [data-setting="camera"][aria-checked="true"]').textContent, JSON.parse(localStorage.getItem('block-knight-settings')).camera]), ['远', 'far']);
        await page.click('[data-menu-settings] [data-setting="camera"][data-pick="1"]');
        await page.click('[data-menu-act="close"]'); await page.click('[data-menu]');
        assert.deepEqual(await pages(), [['角色'], false, true]);
        // 回到主界面: saved, and the world stands still behind it; 继续冒险
        // goes on where the player stood, as hurt as they were. A new
        // adventure asks first now there is a save.
        const where = () => page.evaluate(() => { const g = window.game, p = g.sim.player; return [g.map, Math.round(p.x), Math.round(p.y), p.hp]; });
        await page.evaluate(() => { const g = window.game, p = g.sim.player; Object.assign(p, { x: p.x + 40, hp: 200 }); });
        const stood = await where();
        await page.click('[data-menu-act="title"]');
        assert.deepEqual([await page.evaluate(() => [window.game.title.isOpen(), window.game.menu.isOpen(), localStorage.getItem('block-knight-save') !== null]), await titleKeys()],
            [[true, false, true], ['继续冒险', '新的冒险', '联机对战', '设置']]);
        assert.deepEqual(await newKey(), ['danger'], 'a save to erase: 新的冒险 is red (user, 2026-10-08)');
        await page.click('[data-title-act="new"]');
        assert.deepEqual(await page.evaluate(() => [window.game.panel, document.querySelector('[data-panel-title]').textContent]), ['reset', '开始新的冒险？']);
        await page.click('[data-action="resume"]');
        assert.deepEqual(await page.evaluate(() => [window.game.panel, window.game.title.isOpen()]), [null, true]);
        await page.click('[data-title-act="continue"]');
        assert.deepEqual([await page.evaluate(() => window.game.title.isOpen()), await where()], [false, stood]);
        // Loot picked up is in the save and survives a reload.
        await page.evaluate(() => {
            const g = window.game;
            g.sim.progress.inventory.gold = 42; g.sim.progress.inventory.items.wolf_pelt = 2;
            g.persist();
        });
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.game, null, { timeout: 120000 });
        assert.deepEqual(await page.evaluate(() => [window.game.map, window.game.sim.progress.inventory.gold, window.game.save.inventory.items.wolf_pelt]), ['base', 42, 2]);
        assert.deepEqual(await titleKeys(), ['继续冒险', '新的冒险', '联机对战', '设置']);
        // A new adventure, agreed to: the save is erased, the base is begun afresh.
        await page.click('[data-title-act="new"]'); await page.click('[data-action="erase"]');
        assert.deepEqual(await page.evaluate(() => [window.game.title.isOpen(), window.game.panel, window.game.map, window.game.sim.progress.inventory.gold, localStorage.getItem('block-knight-save')]), [false, null, 'base', 0, null]);
        // Rebuilding a world frees the last one: GPU memory does not grow.
        const memory = await page.evaluate(() => {
            const g = window.game, out = [];
            g.pause(true);
            for (const id of ['clearing', 'field', 'clearing', 'field']) { g.load(id); g.view.render(g.sim, 0.016); out.push({ ...g.view.renderer.info.memory }); }
            return out;
        });
        assert.deepEqual(memory[2], memory[0]);
        assert.deepEqual(memory[3], memory[1]);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('items: the smithy makes iron armor, the bag puts it on (the model changes), the shop sells a potion that heals', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(844, 390, '');
    try {
        await page.click('[data-title-act="new"]');
        const door = kind => page.evaluate(k => {
            const g = window.game, p = g.sim.player, s = g.sim.entities.find(e => e.kind === k);
            Object.assign(p, { x: s.x, y: s.y + 30, facing: -Math.PI / 2 }); g.run(0.05);
        }, kind);
        await page.evaluate(() => { const g = window.game; g.sim.progress.inventory.gold = 300; Object.assign(g.sim.progress.inventory.items, { goblin_ear: 4, wolf_pelt: 4, iron_ore: 6 }); });
        // The smithy, through its door.
        await door('smithy');
        await page.keyboard.press('KeyE'); await page.evaluate(() => window.game.run(0.02));
        await page.waitForFunction(() => window.game.screens.kind === 'smithy', null, { timeout: 10000 });
        await page.click('[data-row="iron_armor"]');
        await shot(page, 'smithy');
        await page.click('[data-act="craft"]');
        assert.equal(await page.evaluate(() => window.game.sim.progress.inventory.items.iron_armor), 1);
        await page.click('[data-screen-close]');
        // The shop: two potions.
        await door('shop');
        await page.keyboard.press('KeyE'); await page.evaluate(() => window.game.run(0.02));
        await page.waitForFunction(() => window.game.screens.kind === 'shop', null, { timeout: 10000 });
        await page.click('[data-row="potion"]'); await page.click('[data-act="buy"]'); await page.click('[data-act="buy"]');
        await page.click('[data-row="torch"]'); await page.click('[data-act="buy"]');
        await page.click('[data-screen-close]');
        // The bag in the menu: iron armor and a potion on (the figure shows
        // them at once); the base is rebuilt round the player in them when it closes.
        const before = await page.evaluate(() => ({ parts: window.game.sim.rigs.fighters.player.parts.length, x: window.game.sim.player.x }));
        await page.click('[data-menu]');
        await page.click('[data-menu-bag] [data-item="iron_armor"]'); await page.click('[data-act="equip"]');
        await page.click('[data-menu-bag] [data-item="potion"]'); await page.click('[data-act="equip"]');
        assert.match(await page.evaluate(() => document.querySelector('[data-menu-detail] .detail-note').textContent), /换上了药水/);
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-menu-slots] [data-item]')].map(e => e.dataset.item)), ['wooden_sword', 'potion', 'iron_armor']);
        await shot(page, 'bag');
        await page.click('[data-menu-act="close"]');
        const worn = await page.evaluate(() => { const g = window.game, p = g.sim.player; return { map: g.map, parts: g.sim.rigs.fighters.player.parts.length, x: p.x, maxHp: p.maxHp, def: p.def, offhand: p.loadout.offhand, saved: g.save.loadout.armor }; });
        assert.deepEqual({ ...worn, parts: undefined }, { map: 'base', parts: undefined, x: before.x, maxHp: 380, def: 11, offhand: 'potion', saved: 'iron_armor' });
        assert.ok(worn.parts > before.parts, 'the iron armor adds plates to the model');
        // No shield now: the guard key shows the blade; the offhand key the
        // potion and how many are left.
        await page.waitForFunction(() => document.querySelector('[data-button="guard"]').dataset.kind === 'weapon' && document.querySelector('[data-button="offhand"]').dataset.kind === 'potion' && !document.querySelector('[data-button="offhand"]').classList.contains('disabled') && document.querySelector('[data-hud="offhand-count"]').textContent === '2', null, { timeout: 10000 });
        // A drink with the offhand key (K) heals 30% of max HP.
        await page.evaluate(() => { window.game.sim.player.hp = 100; });
        await page.keyboard.press('KeyK');
        await page.evaluate(() => window.game.run(0.9));
        assert.deepEqual(await page.evaluate(() => [window.game.sim.player.hp, window.game.sim.progress.inventory.items.potion]), [214, 1]);
        // Outside the base the bag only shows: no changing gear. The menu
        // does not pause the world (user, 2026-10-02); its pause button does.
        await page.evaluate(() => window.game.load('field'));
        await page.click('[data-menu]');
        await page.click('[data-menu-bag] [data-item="wooden_shield"]');
        assert.deepEqual(await page.evaluate(() => [document.querySelector('[data-act="equip"]').disabled, document.querySelector('[data-menu-detail] .detail-note').textContent]), [true, '只能在曙光村里换装备']);
        // Real time for a few frames, then frozen again for the test.
        const ticks = () => page.evaluate(async () => {
            const g = window.game, t0 = g.sim.time, frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            g.pause(false); await frame(); await frame(); await frame(); g.pause(true);
            return g.sim.time - t0;
        });
        const ticking = await ticks();
        assert.ok(ticking > 0, `the world goes on under the menu: ${ticking}`);
        await page.click('[data-menu-act="pause"]');
        assert.deepEqual(await page.evaluate(() => [window.game.menu.isOpen(), window.game.panel, document.querySelector('[data-panel-title]').textContent]), [false, 'pause', '暂停']);
        assert.equal(await ticks(), 0, 'paused, it stands still');
        await page.click('[data-action="resume"]');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

test('two phones in one browser (?link=local): a room code, a duel to a result, a rematch, then one leaves', { timeout: 300000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    try {
        const A = await openPage(context, '?link=local&map=clearing'), B = await openPage(context, '?link=local&map=clearing');
        const text = (page, sel) => page.evaluate(s => document.querySelector(s).textContent, sel);
        // A creates a room; B types its code on the keypad and joins. The
        // room is the title screen's: the menu goes back to it.
        const room = page => page.click('[data-menu]').then(() => page.click('[data-menu-act="title"]')).then(() => page.click('[data-title-act="duel"]'));
        await room(A.page);
        assert.equal(await text(A.page, '[data-room-title]'), '联机对战');
        await A.page.click('[data-room-action="host"]');
        await A.page.waitForFunction(() => document.querySelector('[data-room-status]').textContent.includes('等待'), null, { timeout: 20000 });
        const code = await A.page.evaluate(() => [...document.querySelectorAll('[data-room-code] i')].map(i => i.textContent).join(''));
        assert.match(code, /^\d{4}$/);
        await shot(A.page, 'room-host');
        // B picks the dagger first (each side picks its own weapon; the pick is remembered).
        await room(B.page);
        assert.equal(await B.page.evaluate(() => document.querySelector('[data-room-weapons]').hidden), false);
        await B.page.click('[data-weapon="assassin_dagger"]');
        await shot(B.page, 'room-weapons');
        assert.equal(await B.page.evaluate(() => [window.game.room.weapon, localStorage.getItem('block-knight-weapon')].join()), 'assassin_dagger,assassin_dagger');
        await B.page.click('[data-room-action="join"]');
        assert.match(await text(B.page, '[data-room-note]'), /你用：短刃/);
        assert.equal(await B.page.evaluate(() => document.querySelector('[data-room-action="connect"]').disabled), true);
        for (const d of code) await B.page.click(`[data-key="${d}"]`);
        await shot(B.page, 'room-join');
        await B.page.click('[data-room-action="connect"]');
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel?.phase === 'countdown' || window.game.duel?.phase === 'fight', null, { timeout: 30000 });
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.room.isOpen()]), ['arena', 'host', false]);
        assert.deepEqual(await B.page.evaluate(() => [window.game.map, window.game.duel.selfId, window.game.duel.battle]), ['arena', 'guest', await A.page.evaluate(() => window.game.duel.battle)]);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'fight', null, { timeout: 30000 });
        for (const { page } of [A, B]) assert.deepEqual(await page.evaluate(() => window.game.sim.fighters.map(f => f.loadout.main)), ['wooden_sword', 'assassin_dagger']);
        // The rival behind the north pillar is not drawn, and has no bar or
        // arrow; in sight it is -- ahead of the fighter, not behind its back
        // (the front 150 degrees; user, 2026-10-04).
        const seen = await A.page.evaluate(() => {
            const g = window.game, [h, r] = g.sim.fighters, look = () => { g.view.render(g.sim, 0.016); return g.view.seen('guest'); };
            Object.assign(h, { x: 500, y: 260, facing: 0 }); Object.assign(r, { x: 620, y: 260 });
            const hidden = look();
            Object.assign(r, { x: 500, y: 380 }); h.facing = Math.PI / 2;
            const shown = look();
            h.facing = -Math.PI / 2;
            return { hidden, shown, behind: look() };
        });
        assert.deepEqual(seen, { hidden: false, shown: true, behind: false });
        // The cut opens only for blocks that do hide the fighter: leaning
        // on the west wall sideways it stays shut; behind the south wall
        // it opens (user, 2026-10-04).
        const open = await A.page.evaluate(() => {
            const g = window.game, [h] = g.sim.fighters;
            const at = (x, y) => { Object.assign(h, { x: x * 40, y: y * 40 }); g.view.render(g.sim, 1); return g.view.ground.cut.open.value; };
            return { beside: at(4.31, 9.5), behind: at(12, 14.69) };
        });
        assert.deepEqual(open, { beside: 0, behind: 1 });
        // B's page goes to the background: the fight is held on both, and A
        // is told who it waits for; back, a countdown and the fight goes on.
        const hide = (page, hidden) => page.evaluate(flag => {
            Object.defineProperty(document, 'hidden', { value: flag, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await hide(B.page, true);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'hold', null, { timeout: 30000 });
        await A.page.waitForFunction(() => document.querySelector('[data-hud="banner"]').textContent.includes('对方暂时离开'), null, { timeout: 10000 });
        await shot(A.page, 'duel-hold');
        await hide(B.page, false);
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'countdown', null, { timeout: 30000 });
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.duel.phase === 'fight', null, { timeout: 30000 });
        assert.deepEqual(await A.page.evaluate(() => [window.game.panel, window.game.duel.endReason]), [null, null]);
        // A knock-out: the host cuts the guest down; one result on each phone.
        await A.page.evaluate(() => {
            const [h, r] = window.game.sim.fighters;
            Object.assign(h, { x: 500, y: 380, facing: 0 }); Object.assign(r, { x: 560, y: 380, facing: Math.PI, hp: 1 });
        });
        await A.page.keyboard.press('KeyJ');
        await A.page.waitForFunction(() => window.game.panel === 'duelResult', null, { timeout: 60000 });
        await B.page.waitForFunction(() => window.game.panel === 'duelResult', null, { timeout: 60000 });
        assert.equal(await text(A.page, '[data-panel-title]'), '胜利');
        assert.equal(await text(B.page, '[data-panel-title]'), '失败');
        await shot(A.page, 'duel-win'); await shot(B.page, 'duel-lose');
        // A rematch: B asks, A sees it and agrees; both count down again.
        await B.page.click('[data-action="rematch"]');
        await A.page.waitForFunction(() => document.querySelector('[data-panel-note]').textContent.includes('对方想再来一局'), null, { timeout: 30000 });
        await A.page.click('[data-action="rematch"]');
        for (const { page } of [A, B]) await page.waitForFunction(() => window.game.panel === null && ['countdown', 'fight'].includes(window.game.duel?.phase) && window.game.sim.fighters.every(f => f.hp === f.maxHp), null, { timeout: 30000 });
        // A leaves from the menu: the title screen, over the base; B is told,
        // and goes back to it too.
        await A.page.click('[data-menu]');
        assert.equal(await text(A.page, '[data-panel-title]'), '对战中');
        await A.page.click('[data-action="leave"]');
        assert.deepEqual(await A.page.evaluate(() => [window.game.map, window.game.panel, window.game.duel, window.game.title.isOpen()]), ['base', null, null, true]);
        await B.page.waitForFunction(() => window.game.panel === 'duelEnded', null, { timeout: 30000 });
        assert.match(await text(B.page, '[data-panel-note]'), /对方离开了房间/);
        await shot(B.page, 'duel-ended');
        assert.equal(await text(B.page, '[data-action="leave"]'), '回到主界面');
        await B.page.click('[data-action="leave"]');
        assert.deepEqual(await B.page.evaluate(() => [window.game.map, window.game.panel, window.game.duel, window.game.title.isOpen()]), ['base', null, null, true]);
        assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
    } finally { await context.close(); }
});

test('portrait shows only the rotate hint', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const { context, page, errors } = await openPhone(390, 844);
    try {
        const hint = await page.evaluate(() => {
            const el = document.querySelector('.rotate-hint'), r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return { display: s.display, w: r.width, h: r.height, text: el.textContent };
        });
        await shot(page, 'portrait');
        assert.equal(hint.display, 'grid');
        assert.deepEqual([hint.w, hint.h], [390, 844]);
        assert.match(hint.text, /横/);
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

// The move tuner (tune.html): a desktop page of its own, on the same boot.
test('the move tuner: boots clean, a typed number changes the key the game reads, kept as a draft, written out; a combo plays the tree', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage(), errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(e.message));
        const open = async () => {
            await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.tune, null, { timeout: 120000 });
            await page.evaluate(() => window.tune.pause());
        };
        await page.goto(base + 'tune.html', { waitUntil: 'load' });
        await open();
        const info = await page.evaluate(() => ({ frozen: Object.isFrozen(gameConfig.combo.moves.slash), width: document.querySelector('[data-canvas]').width, move: window.tune.state.move, drawn: window.tune.view.renderer.info.render.triangles }));
        assert.deepEqual([info.frozen, info.move], [false, 'slash'], 'the config is unfrozen on this page only');
        assert.ok(info.width > 300 && info.drawn > 0, 'the view draws');

        // The file's own number, whatever the key has been tuned to.
        const was = await page.evaluate(() => window.tune.lab.original('slash.a').handR.rx);
        await page.click('[data-bone="handR"] .bone-head');
        const box = page.locator('[data-bone="handR"] [data-ch="rx"] [data-number]');
        await box.fill('1.5'); await box.press('Enter');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.5);
        assert.match(await page.locator('[data-export]').inputValue(), /slash: \{\n {12}a: key\(\{ .*handR: \{ rx: 1\.5, ry: -1\.2[,} ]/);
        // The draft survives a reload; "还原这一项" puts the file's value back.
        await page.waitForTimeout(500);
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.5);
        await page.click('[data-revert="this"]');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), was);
        assert.equal(await page.locator('[data-export]').inputValue(), '（还没有改动）');
        // One number put back by the button beside it: shown only while it differs from the file.
        const back = page.locator('[data-bone="handR"] [data-ch="rx"] [data-was]');
        assert.equal(await back.isVisible(), false);
        await box.fill('1.5'); await box.press('Enter');
        assert.match(await back.textContent(), new RegExp(`^原 ${String(was).replace('.', '\\.')} `));
        await back.click();
        assert.deepEqual(await page.evaluate(() => [playerMoves.moves.slash.a.handR.rx, window.tune.lab.changed('slash.a')]), [was, false]);
        assert.equal(await back.isVisible(), false);
        // The picked bone's own axes are drawn; the dashed line, the axis a
        // slider turns about, only while the pointer is on a slider.
        const lines = () => page.evaluate(() => {
            const all = window.tune.view.scene.children, own = all.find(c => c.isLineSegments && c.geometry.attributes.position.count === 6), p = own.geometry.attributes.position;
            return [window.tune.state.bone, own.visible, Math.hypot(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), p.getZ(1) - p.getZ(0)) > 0.3, all.find(c => c.material?.isLineDashedMaterial).visible];
        });
        await page.hover('[data-canvas]');
        await page.waitForTimeout(100);
        assert.deepEqual(await lines(), ['handR', true, true, false]);
        await page.hover('[data-bone="handR"] [data-ch="ry"] [data-slider]');
        await page.waitForTimeout(100);
        assert.deepEqual(await lines(), ['handR', true, true, true]);
        // Dragged on its Y, the wrist turns about its own y: all three numbers follow; Ctrl+Z takes the drag back.
        const handle = page.locator('[data-bone="handR"] [data-turn="y"]');
        await handle.scrollIntoViewIfNeeded();
        const at = await handle.boundingBox(), hx = at.x + at.width / 2, hy = at.y + at.height / 2;
        await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx + 40, hy, { steps: 4 }); await page.mouse.up();
        const hand = () => page.evaluate(() => ['rx', 'ry', 'rz'].map(c => playerMoves.moves.slash.a.handR[c] || 0));
        const before = await page.evaluate(() => ['rx', 'ry', 'rz'].map(c => window.tune.lab.original('slash.a').handR[c] || 0)), turned = await hand();
        assert.ok(turned.every((v, i) => Math.abs(v - before[i]) > 0.01), `${turned} from ${before}`);
        await page.keyboard.press('Control+z');
        assert.deepEqual(await hand(), before);
        // A draft made on older files (as if the code changed since): the
        // files win and the notice says so, until the old draft is asked for.
        // (First let the page's own save of its draft go by.)
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const pose = JSON.parse(JSON.stringify(playerMoves.moves.slash.a)), base = JSON.parse(JSON.stringify(pose));
            pose.handR.rx = 1.7; base.handR.rx += 0.3;
            localStorage.setItem('blockKnight.tune.draft', JSON.stringify({ version: 2, poses: { 'slash.a': { pose, base } }, timing: {} }));
        });
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), was);
        assert.match(await page.locator('[data-notice-text]').textContent(), /斜斩 a/);
        await page.click('[data-notice="restore"]');
        assert.equal(await page.evaluate(() => playerMoves.moves.slash.a.handR.rx), 1.7);
        await page.waitForTimeout(500);
        await page.reload({ waitUntil: 'load' });
        await open();
        assert.deepEqual(await page.evaluate(() => [playerMoves.moves.slash.a.handR.rx, document.querySelector('[data-notice]').hidden]), [1.7, true]);
        await page.click('[data-revert="this"]');

        await page.click('[data-mode="combo"]');
        await page.click('[data-inputs="aab"]');
        assert.deepEqual(await page.evaluate(() => window.tune.rec.occs.map(o => o.move)), ['slash', 'backslash', 'cleave']);
        await page.evaluate(() => { window.tune.time = window.tune.rec.keys['cleave.a']; });
        await page.waitForTimeout(200);
        await shot(page, 'tuner');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});

// The map preview (map.html): a third page on the same boot, drawn in 2D.
test('the map preview: boots clean without three.js, names the cell under the pointer; a click and a drag give the words to point by', { timeout: 240000 }, async t => {
    if (skip) { t.skip(skip); return; }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
        const page = await context.newPage(), errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(base + 'map.html?map=field', { waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.clientState === 'ready' && window.mapPreview, null, { timeout: 120000 });
        const info = await page.evaluate(() => {
            const M = window.mapPreview, canvas = document.querySelector('[data-canvas]');
            M.setCell(20);
            return {
                map: M.state.map, three: typeof THREE, size: [M.plan.width, M.plan.height], drawn: [canvas.clientWidth, canvas.clientHeight],
                options: document.querySelectorAll('[data-map] option').length, maps: Object.keys(gameConfig.maps).length, monster: M.plan.monsters[0]
            };
        });
        // (Every map, and the overview of them all before them.)
        assert.deepEqual([info.map, info.three, info.options], ['field', 'undefined', info.maps + 1]);
        assert.deepEqual(info.drawn, [info.size[0] * 20, info.size[1] * 20], 'a cell is 20 pixels');
        // The middle of a cell, on the page.
        const at = (col, row) => page.evaluate(([c, r]) => {
            const box = document.querySelector('[data-canvas]').getBoundingClientRect(), s = window.mapPreview.state.cell;
            return { x: box.left + (c + 0.5) * s, y: box.top + (r + 0.5) * s };
        }, [col, row]);
        // The pointer on a monster's home names it; a click puts the cell in the box.
        const m = info.monster, home = await at(m.col, m.row);
        await page.mouse.move(home.x, home.y);
        assert.equal(await page.locator('[data-readout]').textContent(), `field (${m.col}, ${m.row}) ${m.name} ${m.letter}`);
        await page.mouse.click(home.x, home.y);
        assert.equal(await page.locator('[data-ref]').inputValue(), `field (${m.col}, ${m.row})`);
        // A drag gives a rectangle, its north-west corner first whichever way it was dragged.
        const from = await at(12, 9), to = await at(6, 5);
        await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
        assert.equal(await page.locator('[data-ref]').inputValue(), 'field (6,5)-(12,9)');
        await shot(page, 'map');
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
});
