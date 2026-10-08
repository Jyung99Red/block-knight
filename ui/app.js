// Starts the game once every script is loaded: simulation, 3D view, input
// and the frame loop, plus the landscape shell (fullscreen on Android's
// first touch, and again on the first back from the background), the
// title screen, the menu and the panels. The page opens
// on the title screen (ui/title.js) over the base, standing still; nothing
// is saved till the adventure is begun from it. The world (design.md 6):
// a game starts in the base; a portal's `travel` builds the next region in
// place (fullscreen survives it), bringing the HP along; the save
// (core/save.js, in localStorage) is written on every trip, when a boss
// falls or a chest opens, a moment after loot is picked up, and when the
// page goes to the background. Falling ends the trip: back to the base,
// whole, keeping what was picked up. ?map= starts in another region, with
// no title screen (testing). A duel (design.md 8) starts from the room
// screen (ui/room.js), opened on the title screen: its world belongs to the
// duel session (core/duel.js), which this loop feeds with time and
// controls; panels never pause it. A phone in the background does: the
// session holds the fight till it is back. Left, it is the title screen
// again, over the base.
// The menu (ui/menu.js) does not pause the adventure either (user,
// 2026-10-02); its pause button does, and so do the other panels and the
// shop and smithy.
// window.game is for tests and debugging: game.pause() stops the real-time
// clock, game.run(seconds) steps exactly, game.load(region) starts a
// region afresh, game.save is the save, game.duel the duel session (or
// null).
const app = (() => {
    const MAPS = Object.keys(gameConfig.maps).filter(id => !gameConfig.maps[id].duel);
    // Saving after loot is picked up waits this long, to write once for a handful.
    const SAVE_DELAY = 2;
    // How long the end of a fight plays on before the result is shown.
    const RESULT_DELAY = 1.4;
    // Why a duel ended, for the panel ('closed' is this phone leaving).
    const ENDED = {
        incompatible: '两台手机上的游戏版本不同。请两边都刷新页面，再重新连接。',
        timeout: '很久没收到对方的消息，连接中断了。',
        lost: '和对方的连接断开了。',
        aborted: '对局中断了：有一方离开太久，或关掉了页面。',
        left: '对方离开了房间。'
    };
    // Panel buttons and their usual labels.
    const LABELS = { resume: '继续', home: '回到曙光村', rematch: '再来一局', menu: '菜单', surrender: '认输', leave: '离开对战', erase: '清除并重新开始' };
    // The screen each building of the base opens (ui/screens.js); the
    // storage is the bag, which is the menu's.
    const BUILDING_SCREENS = { shop: 'shop', smithy: 'smithy' };
    function fallback(root, text) {
        const box = root.querySelector('[data-fallback]');
        box.textContent = text; box.hidden = false;
    }
    // Fullscreen needs a user gesture; for touch, pointerup is one and
    // pointerdown is not. Asked on the first touch, and again on the first
    // touch back from the background, which leaves fullscreen (user,
    // 2026-10-08); leaving it otherwise is respected till then. iPhone
    // Safari has no element fullscreen, so it is simply skipped.
    function fullscreenOnTouch() {
        const ask = e => {
            if (e.pointerType !== 'touch') return;
            window.removeEventListener('pointerup', ask, true);
            const el = document.documentElement;
            if (document.fullscreenElement || typeof el.requestFullscreen !== 'function') return;
            el.requestFullscreen({ navigationUI: 'hide' })
                .then(() => screen.orientation?.lock?.('landscape'))
                .catch(() => { /* Refused or unsupported: the rotate hint still covers portrait. */ });
        };
        const arm = () => window.addEventListener('pointerup', ask, true);
        arm();
        document.addEventListener('visibilitychange', () => { if (!document.hidden && !document.fullscreenElement) arm(); });
    }
    const mapFromAddress = () => {
        const id = new URLSearchParams(window.location.search).get('map');
        return MAPS.includes(id) ? id : 'base';
    };
    const titleFirst = () => !new URLSearchParams(window.location.search).has('map');
    const storage = () => { try { return window.localStorage; } catch (_) { return null; } };
    const seed = () => Math.floor(Math.random() * 0x100000000);
    const clockText = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

    function start() {
        const root = document.getElementById('game'), canvas = root.querySelector('canvas');
        let save = saveKit.load(storage()), saveAt = null;
        // The adventure begun (from the title screen): only then is it saved.
        let begun = !titleFirst();
        let mapId = mapFromAddress(), sim = worldSim.create({ region: mapId, progress: save, seed: seed() });
        let view = null, paused = false, panel = null, resultSeen = null;
        // The duel under way: { session, link, code, outcome, resultAt, shown, ended }.
        let duel = null;
        try { view = worldView.create(canvas, sim, { quality: gameSettings.quality() }); } catch (error) {
            console.error(error);
            fallback(root, '这台设备的浏览器没有开启 WebGL，3D 画面无法显示。');
        }
        // Drawing blends the state before the last step into the current one
        // (drawn only; every rule reads the simulation itself): where a
        // body is, its stride, its guard, and how far into its move it is
        // -- or a move would go on by one step in one frame and by two in
        // the next (user, 2026-10-04: attacks drew unevenly).
        const LERP = ['x', 'y', 'h', 'gait', 'moveBlend', 'runBlend', 'guardBlend', 'shoveOut'];
        const copy = p => ({ ...Object.fromEntries([...LERP, 'facing'].map(k => [k, p[k]])), act: p.act ? { move: p.act.move, phase: p.act.phase, t: p.act.t } : null });
        const snapshot = () => new Map([...sim.fighters, ...sim.monsters].map(b => [b.id, copy(b)]));
        let before = snapshot();
        const loop = simLoop.create(dt => { before = snapshot(); worldSim.step(sim, dt); });
        function blend(now, then, alpha) {
            const out = { ...now };
            for (const k of LERP) if (Number.isFinite(then[k])) out[k] = then[k] + (now[k] - then[k]) * alpha;
            out.facing = space.lerpAngle(then.facing, now.facing, alpha);
            // The same phase of the same move: part way through the step.
            if (now.act && then.act && then.act.move === now.act.move && then.act.phase === now.act.phase) out.act = { ...now.act, t: then.act.t + (now.act.t - then.act.t) * alpha };
            return out;
        }
        const shownBodies = alpha => new Map([...sim.fighters, ...sim.monsters].map(b => [b.id, before.has(b.id) ? blend(b, before.get(b.id), alpha) : b]));
        // A duel's fighters: blended between the session's last two live
        // steps, plus the guest's snapshot corrections easing out.
        function duelBodies(s) {
            const alpha = s.alpha(), out = new Map();
            for (const f of s.sim.fighters) {
                const then = s.before(f.id), o = s.offset(f.id), b = then ? blend(f, then, alpha) : { ...f };
                b.x += o.x; b.y += o.y; b.facing += o.facing;
                out.set(f.id, b);
            }
            return out;
        }
        const world = () => duel?.session.sim || sim;
        const selfId = () => duel ? duel.session.selfId : 'player';
        const live = () => !!duel && !duel.ended;

        const act = cmd => duel ? duel.session.command(cmd) : worldSim.command(sim, cmd);
        const input = inputLayer.attach(root, {
            move: (x, y) => blocked() ? false : act({ type: 'move', x, y }),
            press: button => blocked() ? false : act({ type: 'press', button }),
            release: button => act({ type: 'release', button })
        });
        // Temporary (user, 2026-10-08): the camera's angle down, its field
        // of view and its distance, set by hand on sliders over the picture
        // to find the ones to keep; not saved, and to be taken out with
        // their mark-up (partials/game.html) and style once camera.pitch,
        // fov and distance are settled.
        const lens = { pitch: gameConfig.camera.pitch, fov: gameConfig.camera.fov, distance: gameConfig.camera.distance };
        {
            const LABEL = { pitch: v => `俯角 ${Math.round(v * 180 / Math.PI)}° · ${v.toFixed(2)}`, fov: v => `视角 ${v}°`, distance: v => `距离 ${v.toFixed(1)}` };
            for (const range of root.querySelectorAll('[data-lens]')) {
                const key = range.dataset.lens, text = root.querySelector(`[data-lens-text="${key}"]`);
                const show = () => { text.textContent = LABEL[key](lens[key]); };
                range.value = String(lens[key]); show();
                range.addEventListener('input', () => { lens[key] = Number(range.value); show(); });
                // (Let go, it gives the keyboard back to the game's own keys.)
                range.addEventListener('change', () => range.blur());
            }
        }
        // The guard, offhand and interact keys are the HUD's (ui/hud.js):
        // they show what guards, what is carried and what the key would do.
        const display = hud.attach(root);
        display.reset(sim, 0);
        const room = roomScreen.attach(root, { connected: beginDuel, closed: () => title.open() });
        const screens = itemScreens.attach(root, { progress: () => sim.progress, changed: () => persist(), closed: () => loop.reset() });
        // Gear changes (in the base) take effect when the menu closes: the
        // base is rebuilt round the player, where they stood, as hurt as
        // they were.
        const menu = menuScreen.attach(root, {
            progress: () => sim.progress,
            player: () => sim.player,
            canChange: () => !duel && mapId === 'base',
            changed: () => persist(),
            act: name => {
                menu.close();
                if (name === 'pause') openPanel('pause');
                else if (name === 'title') { persist(); input.releaseAll(); title.open(); }
            },
            closed: ({ gearChanged }) => {
                if (!gearChanged || duel) return;
                const p = sim.player;
                load('base', { spot: { x: p.x, y: p.y, facing: p.facing }, carry: { hp: p.hp }, quiet: true });
            }
        });
        // The title screen: the adventure goes on from where it stood (or
        // the base, after a duel); a new one asks first when there is a save.
        const title = titleScreen.attach(root, {
            saved: () => begun || saveKit.exists(storage()),
            act: name => {
                if (name === 'continue') begin();
                else if (name === 'new') { if (begun || saveKit.exists(storage())) openPanel('reset'); else begin(); }
                else if (name === 'duel') room.open();
            }
        });
        function begin() {
            begun = true;
            title.close();
            display.reset(sim, clock);
            loop.reset();
        }
        if (!begun) title.open();
        // The world stands still under the title screen, a panel, the room,
        // the shop or the smithy; under the menu it goes on, but the
        // controls do not reach it. (game.pause() stops the clock only, not
        // the controls.)
        const covered = () => title.isOpen() || !!panel || room.isOpen() || screens.isOpen();
        function halted() { return paused || covered(); }
        function blocked() { return covered() || menu.isOpen(); }

        // ---- the menu and the result panels ----
        const panelEl = root.querySelector('[data-panel]'), $p = sel => panelEl.querySelector(sel);
        const actions = Object.fromEntries([...panelEl.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
        // Per panel: title, note, stats, and the buttons shown (the first is
        // the main one), each with its label if not the usual one.
        function content(kind) {
            const w = world(), me = w.fighters.find(f => f.id === selfId()) || sim.player, S = me.stats;
            if (kind === 'pause') return { title: '暂停', note: `${gameConfig.maps[mapId].name} · 游戏停住了`, stats: [], buttons: [['resume'], ['menu']] };
            if (kind === 'reset') {
                return { title: '开始新的冒险？', tone: 'lose', note: '存档会被清除：打倒的首领、开过的宝箱和带着的东西都没了。', stats: [], buttons: [['erase'], ['resume', '取消']] };
            }
            if (kind === 'lose') {
                return {
                    title: '倒下了', tone: kind, note: '回到曙光村休息。捡到的东西都还在。',
                    stats: [['用时', clockText(sim.result.at)], ['击倒', S.kills], ['命中', S.hits], ['格挡', S.blocks], ['弹反', S.parries], ['受伤', S.hurt]],
                    buttons: [['home']]
                };
            }
            const s = duel.session;
            if (kind === 'duelMenu') return { title: '对战中', note: `竞技场 · 房间 ${duel.code} · 对局不会暂停`, stats: [], buttons: [['resume'], ['surrender'], ['leave']] };
            if (kind === 'duelResult') {
                const o = duel.outcome, r = w.result;
                const why = r.conceded ? (r.conceded === me.id ? '你认输了。' : '对方认输了。') : o === 'draw' ? '双方同时倒下。' : '';
                const waiting = s.rematchSent ? '等待对方同意…' : s.rematchAsked ? '对方想再来一局。' : '';
                return {
                    title: o === 'win' ? '胜利' : o === 'lose' ? '失败' : '平局', tone: o, note: [why, waiting].filter(Boolean).join(' '),
                    stats: [['用时', clockText(r.at)], ['命中', S.hits], ['受伤', S.hurt], ['格挡', S.blocks], ['弹反', S.parries], ['剩余生命', me.hp]],
                    buttons: [['rematch', s.rematchSent ? '等待对方…' : null], ['leave', '离开']], disable: s.rematchSent ? ['rematch'] : []
                };
            }
            return { title: '联机结束', note: ENDED[duel.ended] || '', stats: [], buttons: [['leave', '回到主界面']] };
        }
        function openPanel(kind) {
            panel = kind;
            input.releaseAll();
            const c = content(kind), order = c.buttons.map(([id]) => id);
            panelEl.classList.toggle('win', c.tone === 'win');
            panelEl.classList.toggle('lose', c.tone === 'lose');
            $p('[data-panel-title]').textContent = c.title;
            $p('[data-panel-note]').textContent = c.note;
            $p('[data-panel-stats]').innerHTML = c.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
            for (const [id, button] of Object.entries(actions)) {
                const at = order.indexOf(id);
                button.hidden = at < 0;
                button.classList.toggle('primary', at === 0);
                button.disabled = !!c.disable?.includes(id);
                button.style.order = String(at);
                button.textContent = (at >= 0 && c.buttons[at][1]) || LABELS[id];
            }
            panelEl.hidden = false;
            actions[order[0]].focus({ preventScroll: true });
        }
        function closePanel() {
            panel = null; panelEl.hidden = true; loop.reset();
        }

        // ---- the save ----
        function persist() {
            if (!begun) return;
            if (!duel) save = saveKit.merge(save, sim);
            saveKit.write(storage(), save);
            saveAt = null;
        }
        // ---- regions: `arrival` the region left (to stand at the portal
        // back), `carry` the HP brought along ----
        // keep: false drops this world's progress instead of saving it (the
        // save was just erased). spot: where to stand; quiet: no region
        // banner (the same region rebuilt).
        function load(id = mapId, { arrival = null, carry = null, spot = null, keep = true, quiet = false } = {}) {
            if (!MAPS.includes(id)) throw new Error(`Unknown map ${id}`);
            if (!duel && keep) persist();
            leaveDuel();
            input.releaseAll();
            mapId = id; sim = worldSim.create({ region: id, progress: save, arrival, carry, spot, seed: seed() });
            before = snapshot(); resultSeen = null;
            view?.load(sim);
            display.reset(sim, clock, { announce: !quiet });
            closePanel();
        }
        // What the world asks of the page: travel, a building's panel, saving.
        function react(events) {
            for (const e of events) {
                if (e.side !== 'player' && e.type !== 'boss_defeated') continue;
                if (e.type === 'travel') { load(e.to, { arrival: e.from, carry: { hp: sim.player.hp } }); return; }
                if (e.type === 'open') { input.releaseAll(); if (BUILDING_SCREENS[e.what]) screens.open(BUILDING_SCREENS[e.what]); else menu.open(); }
                else if (e.type === 'boss_defeated' || e.type === 'chest_open' || e.type === 'grave_call') persist();
                else if (e.type === 'pickup' && saveAt === null) saveAt = clock + SAVE_DELAY;
            }
        }

        // ---- a duel ----
        let lastBeat = null;
        function beginDuel({ link, role, code, on, weapon }) {
            input.releaseAll();
            persist();
            title.close();
            const session = duelKit.create({
                role, weapon, now: () => performance.now() / 1000, send: msg => link.send(msg),
                // The adventure's time of day: a host's duel is played at it.
                day: () => dayKit.secondsAt(dayKit.hourOf(sim)),
                on: {
                    start: next => {
                        Object.assign(duel, { outcome: null, resultAt: null, shown: false });
                        view?.load(next, { selfId: session.selfId });
                        display.reset(); lastBeat = null;
                        if (panel) closePanel();
                    },
                    result: outcome => { duel.outcome = outcome; duel.resultAt = clock; },
                    rematch: () => { if (panel === 'duelResult') openPanel('duelResult'); },
                    end: reason => {
                        link.close();
                        if (!duel || duel.session !== session) return;
                        duel.ended = reason;
                        if (reason !== 'closed') openPanel('duelEnded');
                    }
                }
            });
            duel = { session, link, code, outcome: null, resultAt: null, shown: false, ended: null };
            on.message = msg => session.receive(msg);
            on.close = () => session.lost();
            session.open();
        }
        // Leave whatever duel there is, for good.
        function leaveDuel() {
            const d = duel;
            duel = null;
            if (d && !d.ended) d.session.leave();
            d?.link.close();
        }

        // Esc and the key top left: the menu, or in a duel its own panel;
        // again, back to the game (from the pause too).
        function menuKey() {
            if (title.isOpen() || room.isOpen() || screens.isOpen()) return;
            if (menu.isOpen()) menu.close();
            else if (!panel) { if (live()) openPanel('duelMenu'); else if (!duel && !sim.result) menu.open(); }
            else if (panel === 'pause' || panel === 'duelMenu') closePanel();
        }
        root.querySelector('[data-menu]').addEventListener('click', menuKey);
        window.addEventListener('keydown', e => { if (e.code === 'Escape' && !e.repeat) menuKey(); });
        actions.resume.addEventListener('click', closePanel);
        actions.home.addEventListener('click', () => load('base'));
        actions.erase.addEventListener('click', () => { save = saveKit.erase(storage()); load('base', { keep: false, quiet: true }); begin(); });
        actions.menu.addEventListener('click', () => { closePanel(); menu.open(); });
        actions.surrender.addEventListener('click', () => { duel?.session.surrender(); closePanel(); });
        // Out of a duel: the title screen, over the base.
        actions.leave.addEventListener('click', () => { load('base', { quiet: true }); title.open(); });
        // Asking first shows "waiting"; agreeing starts the match at once.
        actions.rematch.addEventListener('click', () => { if (duel?.session.rematch() && duel.session.phase === 'over') openPanel('duelResult'); });
        // A duel waits for a phone in the background (user, 2026-10-04): the
        // other phone is told and the fight stands still till it is back
        // (pvp.awaySeconds at most); closing the page leaves. No frames are
        // drawn in the background, so a slow timer keeps the channel alive.
        document.addEventListener('visibilitychange', () => { if (live()) duel.session.away(document.hidden); });
        window.addEventListener('pagehide', () => { if (live()) duel.session.leave(); });
        setInterval(() => { if (document.hidden && live()) duel.session.pulse(); }, 1000);
        // The save is written whenever the page may be going away.
        document.addEventListener('visibilitychange', () => { if (document.hidden && !duel) persist(); });
        window.addEventListener('pagehide', () => { if (!duel) persist(); });

        // Held controls survive a resize: going fullscreen on the first
        // touch must not drop a thumb that is still walking. A real rotation
        // cancels the touches by itself.
        function resize() {
            const r = root.getBoundingClientRect();
            view?.resize(r.width, r.height);
            input.place();
        }
        window.addEventListener('resize', resize);
        resize();
        fullscreenOnTouch();

        const perf = root.querySelector('[data-perf]'), portrait = window.matchMedia('(orientation: portrait)');
        // This phone's settings, from the menu.
        gameSettings.apply(v => {
            view?.settings({ zoom: gameConfig.camera.zoom[v.camera], quality: gameSettings.quality(v) });
            perf.hidden = !v.perf;
        });
        let clock = 0;
        let last = performance.now(), frames = 0, perfTime = 0;
        function frame(now) {
            const seconds = Math.max(0, (now - last) / 1000);
            last = now;
            clock += Math.min(seconds, simLoop.MAX_FRAME);
            let events, bodies;
            const s = duel?.session;
            if (s) {
                events = s.frame(seconds);
                bodies = s.sim ? duelBodies(s) : null;
                // The countdown beeps each second, and once more at the start.
                const beat = s.phase === 'countdown' ? Math.ceil(s.countdown - 1e-6) : s.phase === 'fight' ? 0 : null;
                if (beat !== null && beat !== lastBeat && (lastBeat !== null || beat > 0)) sfx.tick(beat === 0);
                lastBeat = beat;
            } else {
                if (!halted()) loop.advance(seconds);
                events = worldSim.drain(sim);
                react(events);
                bodies = shownBodies(halted() ? 1 : loop.alpha());
                if (saveAt !== null && clock >= saveAt) persist();
            }
            const w = world(), me = selfId();
            for (const e of events) sfx.play(e, me, worldSim.outcome(w, me));
            display.events(events, clock);
            display.update(w, view, clock, bodies, { self: me, duel: s ? { countdown: s.countdown, phase: s.phase, waiting: s.waiting } : null });
            // Portrait is covered by the rotate hint: skip drawing to save power.
            if (view && !portrait.matches) view.render(w, Math.min(seconds, simLoop.MAX_FRAME), { bodies, events, tour: title.isOpen(), yaw: input.yaw(), ...lens });
            if (title.isOpen()) title.dim(view?.tourFade || 0);
            // The fight is decided: let it play out a moment, then the result.
            if (duel) {
                if (duel.outcome && !duel.shown && !duel.ended && clock - duel.resultAt >= RESULT_DELAY) { duel.shown = true; openPanel('duelResult'); }
            } else if (sim.result && !panel) {
                if (resultSeen === null) resultSeen = clock;
                else if (clock - resultSeen >= RESULT_DELAY) { menu.close(); persist(); openPanel(sim.result.outcome); }
            }
            frames++; perfTime += seconds;
            if (perfTime >= 0.5) {
                const info = view ? view.info() : { calls: 0, triangles: 0 };
                perf.textContent = `${Math.round(frames / perfTime)} 帧/秒 · 绘制 ${info.calls} 次 · ${(info.triangles / 1000).toFixed(1)}k 三角形`;
                frames = 0; perfTime = 0;
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        window.game = {
            get sim() { return world(); }, get map() { return duel ? 'arena' : mapId; }, get panel() { return panel; },
            get duel() { return duel?.session || null; }, get save() { return save; }, room, screens, menu, title,
            view, input, load, persist,
            pause(flag = true) { paused = flag; loop.reset(); },
            run: seconds => loop.run(seconds)
        };
    }
    return { start };
})();
