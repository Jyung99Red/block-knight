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
// A shared adventure (design.md 10; core/coop.js), from the same room
// screen: a host opens a room in its own adventure and goes on in it, its
// code on screen; a guest who comes joins this world, which then runs on
// under every panel. A phone that joins another's plays in that world
// (the session's copy) instead of its own, which stands still meanwhile;
// what it carries there is kept in its own adventure and save as it
// changes. Leaving, it is the title screen over its own base.
// The menu (ui/menu.js) does not pause the adventure either (user,
// 2026-10-02); its pause button does, and so do the other panels and the
// shop and smithy.
// window.game is for tests and debugging: game.pause() stops the real-time
// clock, game.run(seconds) steps exactly, game.load(region) starts a
// region afresh, game.save is the save, game.duel the duel session (or
// null), game.coop the shared adventure's (or null).
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
    // Why a stay in another's world ended ('closed' is this phone leaving).
    const COOP_ENDED = {
        incompatible: '两台手机上的游戏版本不同。请两边都刷新页面，再重新连接。',
        timeout: '很久没收到房主的消息，连接中断了。',
        lost: '和房主的连接断开了。',
        away: '房主离开太久了。',
        left: '房主关闭了房间。'
    };
    // Why a guest left this phone's world, for a line on screen.
    const COOP_PARTED = { left: '同伴离开了', timeout: '同伴断线了', lost: '同伴断线了', away: '同伴离开太久了', incompatible: '同伴的游戏版本不同，没能加入' };
    // Panel buttons and their usual labels.
    const LABELS = { resume: '继续', home: '回到曙光村', rematch: '再来一局', menu: '菜单', surrender: '认输', leave: '离开对战', erase: '清除并重新开始' };
    const GUEST = coopKit.GUEST;
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
        // The shared adventure (design.md 10): { role: 'host' | 'guest',
        // session, link, code, ended, kept } -- this phone's room, open in
        // its own world (a guest in it or not), or this phone in another's.
        let coop = null;
        const hosting = () => coop?.role === 'host', visiting = () => coop?.role === 'guest';
        // Someone else is in this phone's world: it runs on under any panel.
        const shared = () => hosting() && coop.session.guestIn;
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
        // A duel's fighters, or the fighters and monsters of another's
        // world: blended between the session's last two live steps, plus
        // the guest's snapshot corrections easing out.
        function sessionBodies(s, list) {
            const alpha = s.alpha(), out = new Map();
            for (const f of list) {
                const then = s.before(f.id), o = s.offset(f.id), b = then ? blend(f, then, alpha) : { ...f };
                b.x += o.x; b.y += o.y; b.facing += o.facing;
                out.set(f.id, b);
            }
            return out;
        }
        const world = () => duel?.session.sim || (visiting() && coop.session.sim) || sim;
        const selfId = () => duel ? duel.session.selfId : visiting() ? GUEST : 'player';
        const live = () => !!duel && !duel.ended;
        // This phone's fighter, and what it carries (a guest's own bag in another's world).
        const me = () => world().fighters.find(f => f.id === selfId()) || sim.player;
        const carried = () => (visiting() && coop.session.bag) || sim.progress;

        const act = cmd => duel ? duel.session.command(cmd) : visiting() ? coop.session.command(cmd) : worldSim.command(sim, cmd);
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
        const room = roomScreen.attach(root, {
            connected: c => c.mode === 'coop' ? (c.role === 'host' ? hostCoop(c) : visitCoop(c)) : beginDuel(c),
            closed: () => title.open()
        });
        // A guest's deal is made on its copy of its bag at once, and by the host on the bag itself.
        const screens = itemScreens.attach(root, {
            progress: carried,
            changed: (kind, deal) => { if (!visiting()) persist(); else if (deal) coop.session.trade(deal.op, deal.id, deal.n); },
            closed: () => loop.reset()
        });
        // Gear changes (in the base) take effect when the menu closes: the
        // base is rebuilt round the player, where they stood, as hurt as
        // they were.
        const menu = menuScreen.attach(root, {
            progress: carried,
            player: me,
            gearLock: () => visiting() ? '联机时不能换装备' : !duel && mapId === 'base' ? '' : '只能在曙光村里换装备',
            canPause: () => !coop,
            changed: () => persist(),
            act: name => {
                menu.close();
                if (name === 'pause') openPanel('pause');
                else if (name === 'title') toTitle();
            },
            closed: ({ gearChanged }) => {
                if (!gearChanged || duel || visiting()) return;
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
                else if (name === 'duel') room.open('duel');
                else if (name === 'coop') room.open('coop');
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
        // the shop or the smithy -- unless a guest is in it; under the
        // menu it goes on, but the controls do not reach it. (game.pause()
        // stops the clock only, not the controls.)
        const covered = () => title.isOpen() || !!panel || room.isOpen() || screens.isOpen();
        function halted() { return paused || (covered() && !shared()); }
        function blocked() { return covered() || menu.isOpen() || (visiting() && !coop.session.sim); }

        // ---- the menu and the result panels ----
        const panelEl = root.querySelector('[data-panel]'), $p = sel => panelEl.querySelector(sel);
        const actions = Object.fromEntries([...panelEl.querySelectorAll('[data-action]')].map(b => [b.dataset.action, b]));
        // Per panel: title, note, stats, and the buttons shown (the first is
        // the main one), each with its label if not the usual one.
        function content(kind) {
            const w = world(), self = me(), S = self.stats;
            if (kind === 'pause') return { title: '暂停', note: `${gameConfig.maps[mapId].name} · 游戏停住了`, stats: [], buttons: [['resume'], ['menu']] };
            if (kind === 'reset') {
                return { title: '开始新的冒险？', tone: 'lose', note: '存档会被清除：打倒的首领、开过的宝箱和带着的东西都没了。', stats: [], buttons: [['erase'], ['resume', '取消']] };
            }
            if (kind === 'lose') {
                const both = w.fighters.length > 1;
                return {
                    title: both ? '都倒下了' : '倒下了', tone: kind,
                    note: visiting() ? '等房主回到曙光村。捡到的东西都还在。' : `${both ? '两个人一起' : ''}回到曙光村休息。捡到的东西都还在。`,
                    stats: [['用时', clockText(w.result.at)], ['击倒', S.kills], ['命中', S.hits], ['格挡', S.blocks], ['弹反', S.parries], ['受伤', S.hurt]],
                    buttons: visiting() ? [['leave', '离开联机']] : [['home']]
                };
            }
            if (kind === 'coopEnded') return { title: '联机结束', note: COOP_ENDED[coop?.ended] || '', stats: [], buttons: [['leave', '回到主界面']] };
            const s = duel.session;
            if (kind === 'duelMenu') return { title: '对战中', note: `竞技场 · 房间 ${duel.code} · 对局不会暂停`, stats: [], buttons: [['resume'], ['surrender'], ['leave']] };
            if (kind === 'duelResult') {
                const o = duel.outcome, r = w.result;
                const why = r.conceded ? (r.conceded === me.id ? '你认输了。' : '对方认输了。') : o === 'draw' ? '双方同时倒下。' : '';
                const waiting = s.rematchSent ? '等待对方同意…' : s.rematchAsked ? '对方想再来一局。' : '';
                return {
                    title: o === 'win' ? '胜利' : o === 'lose' ? '失败' : '平局', tone: o, note: [why, waiting].filter(Boolean).join(' '),
                    stats: [['用时', clockText(r.at)], ['命中', S.hits], ['受伤', S.hurt], ['格挡', S.blocks], ['弹反', S.parries], ['剩余生命', self.hp]],
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
        // A guest in the world comes along: beside this phone's fighter,
        // or where it stood in the same place rebuilt (`spot`), as hurt as
        // it was when it travels (`carry`), else whole.
        function load(id = mapId, { arrival = null, carry = null, spot = null, keep = true, quiet = false } = {}) {
            if (!MAPS.includes(id)) throw new Error(`Unknown map ${id}`);
            if (!duel && keep) persist();
            leaveDuel();
            input.releaseAll();
            const mate = shared() ? sim.fighters.find(f => f.id === GUEST) : null;
            mapId = id; sim = worldSim.create({ region: id, progress: save, arrival, carry, spot, seed: seed() });
            if (mate) worldSim.join(sim, { id: GUEST, loadout: mate.loadout, bag: coop.session.bag, hp: carry ? mate.hp : null, spot: spot ? { x: mate.x, y: mate.y, facing: mate.facing } : null });
            before = snapshot(); resultSeen = null;
            view?.load(sim);
            display.reset(sim, clock, { announce: !quiet });
            closePanel();
            if (hosting()) coop.session.enter();
        }
        // What the world asks of the page: travel, a building's panel,
        // saving. A guest goes through a portal, everyone goes; its
        // buildings' panels open on its own phone.
        function react(events) {
            for (const e of events) {
                const mate = shared() && e.side === GUEST;
                if (e.side !== 'player' && e.type !== 'boss_defeated' && !mate) continue;
                if (e.type === 'travel') { load(e.to, { arrival: e.from, carry: { hp: sim.player.hp } }); return; }
                if (mate) { if (e.type === 'chest_open' || e.type === 'grave_call') persist(); continue; }
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

        // ---- a shared adventure (design.md 10) ----
        // Hosting: the room is open from now on, in this phone's own
        // adventure (begun, if it was not); whoever comes joins it.
        function hostCoop({ link, code, on }) {
            input.releaseAll();
            const session = coopKit.host({
                send: msg => link.send(msg), now: () => performance.now() / 1000, world: () => sim,
                on: {
                    join: ({ loadout, bag }) => {
                        worldSim.join(sim, { id: GUEST, loadout, bag });
                        before = snapshot();
                        view?.load(sim);
                        display.notice('同伴加入了', `房间 ${code}`, 2, clock);
                    },
                    part: reason => {
                        // (Still connected, it is let go: the room waits for the next one.)
                        if (reason !== 'closed') link.drop();
                        if (worldSim.part(sim, GUEST)) { before = snapshot(); view?.load(sim); }
                        if (COOP_PARTED[reason]) display.notice(COOP_PARTED[reason], `房间 ${code} 还开着`, 2.5, clock);
                    }
                }
            });
            coop = { role: 'host', session, link, code, ended: null, kept: '' };
            on.open = () => session.open();
            on.message = msg => session.receive(msg);
            on.close = () => session.lost();
            begin();
        }
        // Visiting: this phone plays in the host's world, its own standing
        // still; it brings its gear and what it carries.
        function visitCoop({ link, code, on }) {
            input.releaseAll();
            persist();
            title.close();
            begun = true;
            const mine = sim.progress;
            const session = coopKit.guest({
                send: msg => link.send(msg), now: () => performance.now() / 1000,
                bag: { inventory: JSON.parse(JSON.stringify(mine.inventory)), loadout: { ...mine.loadout } },
                on: {
                    start: next => {
                        input.releaseAll();
                        view?.load(next, { selfId: GUEST });
                        display.reset(next, clock);
                        resultSeen = null;
                        if (panel) closePanel();
                    },
                    end: reason => {
                        link.close();
                        if (!coop || coop.session !== session) return;
                        keepBag();
                        coop.ended = reason;
                        if (reason !== 'closed') { menu.close(); screens.close(); openPanel('coopEnded'); }
                    }
                }
            });
            coop = { role: 'guest', session, link, code, ended: null, kept: '' };
            on.message = msg => session.receive(msg);
            on.close = () => session.lost();
            session.open();
            display.reset();
        }
        // What a guest carries in the host's world is its own (user,
        // 2026-10-10): kept in this phone's adventure, and saved, as it changes.
        function keepBag() {
            const bag = visiting() && coop.session.bag;
            if (!bag) return;
            const text = JSON.stringify(bag.inventory);
            if (text === coop.kept) return;
            coop.kept = text;
            sim.progress.inventory = JSON.parse(text);
            if (saveAt === null) saveAt = clock + SAVE_DELAY;
        }
        // The shared adventure is over for this phone: a host's room
        // closes (its guest is told), a guest goes back to its own base.
        function endCoop() {
            const c = coop;
            if (!c) return;
            if (c.role === 'guest') keepBag();
            coop = null;
            // (A host's guest is taken out of its world as it is told: `part`.)
            if (c.role === 'host') c.session.close();
            else if (!c.ended) c.session.leave();
            c.link.close();
            if (c.role === 'guest') load('base', { quiet: true });
        }
        // The menu's 回到主界面: saved, and out of any shared adventure.
        function toTitle() {
            input.releaseAll();
            endCoop();
            persist();
            title.open();
        }
        // What the world of another asks of this phone: its buildings' panels.
        function reactVisit(events) {
            for (const e of events) {
                if (e.side !== GUEST || e.type !== 'open') continue;
                input.releaseAll();
                if (BUILDING_SCREENS[e.what]) screens.open(BUILDING_SCREENS[e.what]); else menu.open();
            }
        }

        // Esc and the key top left: the menu, or in a duel its own panel;
        // again, back to the game (from the pause too).
        function menuKey() {
            if (title.isOpen() || room.isOpen() || screens.isOpen()) return;
            if (menu.isOpen()) menu.close();
            else if (!panel) { if (live()) openPanel('duelMenu'); else if (!duel && !world().result) menu.open(); }
            else if (panel === 'pause' || panel === 'duelMenu') closePanel();
        }
        root.querySelector('[data-menu]').addEventListener('click', menuKey);
        window.addEventListener('keydown', e => { if (e.code === 'Escape' && !e.repeat) menuKey(); });
        actions.resume.addEventListener('click', closePanel);
        actions.home.addEventListener('click', () => load('base'));
        actions.erase.addEventListener('click', () => { save = saveKit.erase(storage()); load('base', { keep: false, quiet: true }); begin(); });
        actions.menu.addEventListener('click', () => { closePanel(); menu.open(); });
        actions.surrender.addEventListener('click', () => { duel?.session.surrender(); closePanel(); });
        // Out of a duel, or another's world: the title screen, over the base.
        actions.leave.addEventListener('click', () => { if (visiting()) endCoop(); else load('base', { quiet: true }); title.open(); });
        // Asking first shows "waiting"; agreeing starts the match at once.
        actions.rematch.addEventListener('click', () => { if (duel?.session.rematch() && duel.session.phase === 'over') openPanel('duelResult'); });
        // A duel waits for a phone in the background (user, 2026-10-04): the
        // other phone is told and the fight stands still till it is back
        // (pvp.awaySeconds at most); closing the page leaves. No frames are
        // drawn in the background, so a slow timer keeps the channel alive.
        // A shared adventure goes on without a phone in the background:
        // the other is told (a host's world stands still meanwhile, as no
        // frames run). Closing the page leaves.
        document.addEventListener('visibilitychange', () => { if (live()) duel.session.away(document.hidden); coop?.session.away(document.hidden); });
        window.addEventListener('pagehide', () => {
            if (live()) duel.session.leave();
            if (hosting()) coop.session.close();
            else if (visiting()) { keepBag(); coop.session.leave(); }
        });
        setInterval(() => { if (document.hidden && live()) duel.session.pulse(); if (document.hidden) coop?.session.pulse(); }, 1000);
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
                bodies = s.sim ? sessionBodies(s, s.sim.fighters) : null;
                // The countdown beeps each second, and once more at the start.
                const beat = s.phase === 'countdown' ? Math.ceil(s.countdown - 1e-6) : s.phase === 'fight' ? 0 : null;
                if (beat !== null && beat !== lastBeat && (lastBeat !== null || beat > 0)) sfx.tick(beat === 0);
                lastBeat = beat;
            } else if (visiting()) {
                const v = coop.session;
                events = v.frame(seconds);
                bodies = v.sim ? sessionBodies(v, [...v.sim.fighters, ...v.sim.monsters]) : null;
                reactVisit(events);
                keepBag();
                if (saveAt !== null && clock >= saveAt) persist();
            } else {
                if (!halted()) loop.advance(seconds);
                events = worldSim.drain(sim);
                if (hosting()) coop.session.take(events);
                react(events);
                if (hosting()) coop.session.frame();
                bodies = shownBodies(halted() ? 1 : loop.alpha());
                if (saveAt !== null && clock >= saveAt) persist();
            }
            const w = world(), self = selfId();
            for (const e of events) sfx.play(e, self, worldSim.outcome(w, self));
            display.events(events, clock);
            const together = coop && { role: coop.role, code: coop.code, partner: w.fighters.length > 1, waiting: coop.session.waiting, entering: visiting() && !coop.session.sim && !coop.ended };
            display.update(w, view, clock, bodies, { self, duel: s ? { countdown: s.countdown, phase: s.phase, waiting: s.waiting } : null, coop: together });
            // Portrait is covered by the rotate hint: skip drawing to save power.
            if (view && !portrait.matches) view.render(w, Math.min(seconds, simLoop.MAX_FRAME), { bodies, events, tour: title.isOpen(), yaw: input.yaw(), ...lens });
            if (title.isOpen()) title.dim(view?.tourFade || 0);
            // The fight is decided: let it play out a moment, then the result.
            if (duel) {
                if (duel.outcome && !duel.shown && !duel.ended && clock - duel.resultAt >= RESULT_DELAY) { duel.shown = true; openPanel('duelResult'); }
            } else if (w.result && !panel && !coop?.ended) {
                if (resultSeen === null) resultSeen = clock;
                else if (clock - resultSeen >= RESULT_DELAY) { menu.close(); screens.close(); persist(); openPanel(w.result.outcome); }
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
            get sim() { return world(); }, get map() { return duel ? 'arena' : visiting() ? coop.session.sim?.region ?? mapId : mapId; }, get panel() { return panel; },
            get duel() { return duel?.session || null; }, get coop() { return coop?.session || null; }, get save() { return save; }, room, screens, menu, title,
            view, input, load, persist,
            pause(flag = true) { paused = flag; loop.reset(); },
            run: seconds => loop.run(seconds)
        };
    }
    return { start };
})();
