// PVP (design.md 8): the duel rules in the simulation (two fighters,
// light hits trade, heavy hits break, the shield the same for both, same-step
// trades, no blows across walls), and the host/guest protocol of
// core/duel.js played end to end over an in-memory channel, carried over
// from the 2D version's tests (tag v1-2d, tests/pvp-spatial.test.cjs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, duelKit, terrainKit, combatKit, space, gameConfig, inventoryKit } = load();
const F = gameConfig.combat, M = gameConfig.combo.moves, PV = gameConfig.pvp, U = gameConfig.world.unitsPerBlock;
const plain = value => JSON.parse(JSON.stringify(value));

// ---- the rules ----
const duel = () => W.create({ map: gameConfig.maps.arena, duel: true });
// Host and guest `gap` apart on open ground, face to face.
function facing(sim, gap = 60) {
    const [h, g] = sim.fighters;
    Object.assign(h, { x: 500, y: 380, facing: 0 });
    Object.assign(g, { x: 500 + gap, y: 380, facing: Math.PI });
    return sim;
}
const step = (sim, seconds, opts) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01, opts); };
const tap = (sim, who, button = 'attack') => { W.command(sim, { type: 'press', button }, who); W.command(sim, { type: 'release', button }, who); };

test('a duel: two mortal fighters with the same stats, on the arena spawns, face to face, in sight', () => {
    const sim = duel(), [h, g] = sim.fighters, S = inventoryKit.statsOf(inventoryKit.starter());
    assert.deepEqual(plain(sim.fighters.map(f => f.id)), ['host', 'guest']);
    assert.equal(sim.player, h, 'sim.player is the first fighter');
    for (const f of sim.fighters) {
        assert.deepEqual([f.hp, f.maxHp, f.atk, f.def, f.endless], [S.maxHp, S.maxHp, S.atk, S.def, false]);
        assert.deepEqual(plain(f.loadout), plain(gameConfig.gear.starter), 'the starter gear: a fair fight');
        assert.deepEqual([S.maxHp, S.atk, S.def], [360, 30, 8]);
    }
    assert.ok(Math.abs(h.facing) < 1e-9 && Math.abs(Math.abs(g.facing) - Math.PI) < 1e-9);
    assert.ok(Math.hypot(g.x - h.x, g.y - h.y) >= 10 * U, 'they start well apart');
    assert.ok(terrainKit.lineClear(sim.terrain, h.x, h.y, g.x, g.y), 'and can see each other');
    assert.equal(sim.dummy, null); assert.equal(sim.monsters.length, 0);
    // The arena inside its wall looks the same from either spawn, and the
    // wall is closed and high enough to hide a fighter.
    const rows = gameConfig.maps.arena.rows, t = sim.terrain, wallRow = r => /[1-9]{4,}/.test(rows[r]);
    const y0 = rows.findIndex((_, r) => wallRow(r)), y1 = rows.length - 1 - [...rows].reverse().findIndex((_, r) => wallRow(rows.length - 1 - r));
    const x0 = rows[y0].search(/[1-9]/), x1 = rows[y0].length - 1 - [...rows[y0]].reverse().join('').search(/[1-9]/);
    for (let r = y0 + 1; r < y1; r++) for (let c = x0 + 1; c < x1; c++) assert.equal(rows[r][c], rows[y0 + y1 - r][x0 + x1 - c], `point symmetric at ${c},${r}`);
    for (let c = x0; c <= x1; c++) for (const r of [y0, y1]) assert.ok(terrainKit.levelAt(t, c, r) >= 2);
    for (let r = y0; r <= y1; r++) for (const c of [x0, x1]) assert.ok(terrainKit.levelAt(t, c, r) >= 2);
    for (let c = x0; c <= x1; c++) assert.ok(terrainKit.solidAt(t, c, y0) && terrainKit.solidAt(t, c, y1));
    for (let r = y0; r <= y1; r++) assert.ok(terrainKit.solidAt(t, x0, r) && terrainKit.solidAt(t, x1, r));
    assert.throws(() => W.create({ map: gameConfig.maps.clearing, duel: true }), /two spawns/);
});

test('a light (A) hit only hurts: no stun, no push, the struck fighter cuts back', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    tap(sim, 0); step(sim, 0.05); tap(sim, 1);
    step(sim, 0.16);
    assert.ok(g.hp < g.maxHp, 'the host landed first');
    assert.equal(g.stun, 0); assert.equal(g.push, null);
    assert.equal(g.act?.move, 'slash', 'the guest is still in its own move');
    step(sim, 0.2);
    assert.ok(h.hp < h.maxHp, 'and its cut lands too');
    assert.equal(h.stun, 0);
    assert.equal(g.stats.hurt, 1); assert.equal(h.stats.hits, 1); assert.equal(g.stats.hits, 1);
});

test('a heavy hit breaks the combo, stuns and pushes by the move', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    // A B: the attack key held till it is told, then let go (the least charge).
    const HOLD = gameConfig.combo.holdSeconds;
    W.command(sim, { type: 'press', button: 'attack' }, 0); step(sim, HOLD); W.command(sim, { type: 'release', button: 'attack' }, 0);
    step(sim, M.charged.windup - HOLD - 0.02); tap(sim, 1); const x0 = g.x;
    for (let i = 0; i < 40 && g.hp === g.maxHp; i++) W.step(sim, 0.01);
    assert.ok(g.hp < g.maxHp);
    assert.equal(g.act, null, 'its slash is cut off');
    assert.ok(g.stun > F.hitStun - 0.05);
    step(sim, F.impact.hitstop.hit + F.impact.knockbackSeconds + 0.02);
    assert.ok(Math.abs(g.x - x0 - M.charged.knockback) < 4, `pushed ${g.x - x0}`);
});

test('the shield blocks and parries the same for host and guest', () => {
    for (const defender of [0, 1]) for (const parry of [true, false]) {
        const sim = facing(duel()), d = sim.fighters[defender], a = sim.fighters[1 - defender];
        W.command(sim, { type: 'press', button: 'guard' }, defender);
        step(sim, parry ? F.guard.startup + 0.01 - M.slash.windup - 0.04 : 0.5);
        tap(sim, 1 - defender);
        step(sim, 0.25);
        const raw = a.atk * M.slash.ratio;
        if (parry) {
            assert.equal(d.stats.parries, 1, `defender ${defender}`);
            assert.equal(d.hp, d.maxHp);
            assert.ok(a.hp < a.maxHp && a.stun > 0 || a.stats.hurt === 1, 'the attacker eats the counter');
        } else {
            assert.equal(d.stats.blocks, 1);
            assert.equal(d.hp, d.maxHp - Math.round(Math.max(1, Math.round(raw * (1 - d.def / (d.def + F.damage.defenseConstant)))) * F.guard.shield.blockMultiplier));
            assert.equal(a.hp, a.maxHp);
        }
    }
});

test('a same-step trade lands both ways; both falling is a draw, once', () => {
    const sim = facing(duel()), [h, g] = sim.fighters;
    tap(sim, 0); tap(sim, 1);
    step(sim, 0.3);
    assert.equal(h.hp, g.hp, 'mirror cuts, mirror damage');
    const hits = W.drain(sim).filter(e => e.type === 'hit');
    assert.equal(hits.length, 2); assert.equal(hits[0].time, hits[1].time);
    const end = facing(duel());
    end.fighters.forEach(f => { f.hp = 1; });
    tap(end, 0); tap(end, 1); step(end, 0.4);
    assert.deepEqual(plain(end.result), { winner: null, at: end.result.at });
    assert.equal(W.outcome(end, 'host'), 'draw');
    assert.equal(W.drain(end).filter(e => e.type === 'result').length, 1);
    const win = facing(duel());
    win.fighters[1].hp = 1; tap(win, 0); step(win, 0.3);
    assert.equal(win.result.winner, 'host');
    assert.deepEqual([W.outcome(win, 'host'), W.outcome(win, 'guest')], ['win', 'lose']);
    assert.ok(win.fighters[1].down);
    const given = duel();
    assert.equal(W.concede(given, 'guest'), true); assert.equal(W.concede(given, 'host'), false);
    assert.equal(given.result.winner, 'host'); assert.equal(given.result.conceded, 'guest');
});

test('no blow lands across an arena wall', () => {
    const sim = duel(), [h, g] = sim.fighters, t = sim.terrain;
    // Either side of the north pillar (two blocks wide).
    const r = 6, c = [...gameConfig.maps.arena.rows[r]].findIndex((ch, i) => /[1-9]/.test(ch) && i > 11);
    assert.ok(terrainKit.solidAt(t, c, r) && terrainKit.solidAt(t, c + 1, r));
    Object.assign(h, { x: (c - 0.4) * U, y: (r + 0.5) * U, facing: 0 });
    Object.assign(g, { x: (c + 2.4) * U, y: (r + 0.5) * U, facing: Math.PI });
    for (let i = 0; i < 4; i++) { tap(sim, 0); tap(sim, 1); step(sim, 0.5); }
    assert.equal(h.hp, h.maxHp); assert.equal(g.hp, g.maxHp);
});

test('with judge off (the guest predicting) swings pass through and nothing is decided', () => {
    const judged = facing(duel()), guessed = facing(duel());
    for (const s of [judged, guessed]) { tap(s, 0); tap(s, 1); }
    step(guessed, 1, { judge: false });
    assert.ok(guessed.fighters.every(f => f.hp === f.maxHp && f.stun === 0 && f.freeze === 0));
    assert.ok(!W.drain(guessed).some(e => ['hit', 'miss', 'block', 'parry', 'result'].includes(e.type)));
    guessed.fighters.forEach(f => { f.hp = 1; });
    tap(guessed, 0); step(guessed, 1, { judge: false });
    assert.equal(guessed.result, null);
    // Up to the first contact, the predicted timeline is the judged one.
    step(judged, 0.1); const ahead = facing(duel()); tap(ahead, 0); tap(ahead, 1); step(ahead, 0.1, { judge: false });
    assert.equal(JSON.stringify(W.snapshot(ahead).fighters), JSON.stringify(W.snapshot(judged).fighters));
});

test('a duel snapshot restores into a fresh world and plays on the same', () => {
    const sim = facing(duel());
    W.command(sim, { type: 'press', button: 'attack' }, 0); tap(sim, 1); step(sim, 0.13); W.command(sim, { type: 'press', button: 'guard' }, 1);
    const copy = W.restore(duel(), plain(W.snapshot(sim)));
    assert.equal(duelKit.validSnapshot(copy, W.snapshot(sim)), true);
    for (const s of [sim, copy]) { step(s, 0.5); W.command(s, { type: 'release', button: 'attack' }, 0); step(s, 1); }
    assert.equal(JSON.stringify(W.snapshot(copy)), JSON.stringify(W.snapshot(sim)));
    assert.equal(copy.player, copy.fighters[0]);
});

test('snapshot checks turn away broken or foreign state', () => {
    const sim = facing(duel()); tap(sim, 0); step(sim, 0.15);
    const good = W.snapshot(sim);
    assert.equal(duelKit.validSnapshot(sim, good), true);
    const bad = [
        s => { s.fighters[0].x = NaN; }, s => { s.fighters[1].hp = 1e6; }, s => { s.fighters[0].act.move = 'teleport'; },
        s => { s.fighters[1].guard.bar = 1e6; }, s => { s.fighters[0].atk = 999; }, s => { s.fighters.pop(); },
        s => { s.fighters[1].input.buttons.skill = { held: true, presses: 1 }; }, s => { s.result = { winner: 'nobody', at: 1 }; },
        s => { s.fighters[0].id = 'guest'; }, s => { s.entities.push({}); }, s => { s.fighters[0].x = -500; },
        s => { s.fighters[0].focus = 'p-base'; }, s => { s.region = 'field'; }, s => { s.fighters[1].shoveOut = 2; }, s => { delete s.fighters[0].shoveFor; }
    ];
    for (const corrupt of bad) { const s = plain(good); corrupt(s); assert.equal(duelKit.validSnapshot(sim, s), false, String(corrupt)); }
});

// ---- the protocol, both ends over an in-memory channel ----
// `jitter()`: extra seconds a message takes, each its own (they still
// arrive in order). A phone in the background (`sleep`) runs no frames,
// only a pulse a second (ui/app.js).
function pair({ latency = 0, weapons = {}, jitter = null, day = null } = {}) {
    let clock = 100, lastDue = 0;
    const queue = [], log = {}, ends = {}, asleep = new Map();
    for (const role of ['host', 'guest']) {
        log[role] = { starts: 0, results: [], ends: [], rematch: 0, sent: [] };
        ends[role] = duelKit.create({
            role, now: () => clock, ...(weapons[role] ? { weapon: weapons[role] } : {}), ...(day ? { day: day[role] } : {}),
            send: msg => {
                const copy = plain(msg);
                lastDue = Math.max(lastDue, clock + latency + (jitter ? jitter() : 0));
                log[role].sent.push(copy); queue.push({ to: role === 'host' ? 'guest' : 'host', at: lastDue, msg: copy });
            },
            on: { start: () => log[role].starts++, result: o => log[role].results.push(o), end: r => log[role].ends.push(r), rematch: () => log[role].rematch++ }
        });
    }
    let connected = true;
    const deliver = () => { while (connected && queue.length && queue[0].at <= clock + 1e-9) { const { to, msg } = queue.shift(); ends[to].receive(msg); } };
    const shown = { host: [], guest: [] };
    const frame = (seconds = 0.01) => {
        clock += seconds; deliver();
        for (const role of ['host', 'guest']) {
            if (!asleep.has(role)) shown[role].push(...ends[role].frame(seconds));
            else if (clock - asleep.get(role) >= 1) { asleep.set(role, clock); ends[role].pulse(); }
        }
        deliver();
    };
    const run = seconds => { for (let i = 0; i < Math.round(seconds / 0.01); i++) frame(); };
    ends.host.open(); ends.guest.open(); deliver();
    return {
        host: ends.host, guest: ends.guest, log, shown, queue, frame, run, deliver,
        cut() { connected = false; }, get clock() { return clock; }, pass(seconds) { clock += seconds; },
        // The page of `role` goes to the background, or comes back.
        sleep(role) { asleep.set(role, clock); ends[role].away(true); },
        wake(role) { asleep.delete(role); ends[role].away(false); }
    };
}
const fightNow = p => { p.run(PV.countdown + 0.2); assert.equal(p.host.phase, 'fight'); assert.equal(p.guest.phase, 'fight'); };
// Put the fighters face to face on the host; the guest learns it from the next snapshot.
const closeIn = p => { facing(p.host.sim); p.run(0.1); };
const press = (end, button) => end.command({ type: 'press', button });
const release = (end, button) => end.command({ type: 'release', button });

test('two phones: hello, start, ready, a countdown, then the fight on both', () => {
    const p = pair();
    assert.equal(p.host.battle, p.guest.battle); assert.ok(p.host.battle);
    assert.deepEqual([p.log.host.starts, p.log.guest.starts], [1, 1]);
    p.run(0.1);
    assert.equal(p.host.phase, 'countdown'); assert.equal(p.guest.phase, 'countdown');
    assert.ok(Math.abs(p.guest.countdown - (PV.countdown - 0.1)) < 0.03);
    assert.equal(press(p.guest, 'attack'), false, 'no moves before the fight');
    assert.equal(p.guest.command({ type: 'move', x: 1, y: 0 }), true, 'the stick is taken');
    fightNow(p);
    assert.deepEqual([p.host.selfId, p.guest.selfId], ['host', 'guest']);
    assert.ok(p.host.sim.fighters[1].x > 820, 'the stick held through the countdown walks at once');
    const snaps = p.log.host.sent.filter(m => m.t === 'snap');
    assert.ok(snaps.length >= (PV.countdown + 0.2) / PV.snapshotSeconds - 2, `${snaps.length} snapshots`);
});

test('the duel is played at the host\'s time of day, and a rematch goes on from where the last ended', () => {
    const at = gameConfig.day.seconds * 0.6, p = pair({ day: { host: () => at, guest: () => 5 } });
    assert.deepEqual([p.host.sim.dayFrom, p.guest.sim.dayFrom], [at, at]);
    assert.equal(p.log.host.sent.find(m => m.t === 'start').day, at);
    fightNow(p);
    p.guest.surrender(); p.run(0.1);
    const ended = p.host.sim.dayFrom + p.host.sim.time;
    p.host.rematch(); p.run(0.05); p.guest.rematch(); p.run(0.1);
    assert.equal(p.log.host.starts, 2);
    assert.ok(Math.abs(p.host.sim.dayFrom - ended) < 0.2 && p.guest.sim.dayFrom === p.host.sim.dayFrom);
});

test('different rules on the other phone end it before it starts', () => {
    const p = pair();
    const h = duelKit.create({ role: 'host', now: () => p.clock, send() {}, on: { end: r => p.log.host.ends.push(r) } });
    h.receive({ t: 'hello', protocol: duelKit.PROTOCOL, rules: 'something-else', weapon: PV.weapons[0] });
    assert.equal(h.phase, 'ended'); assert.equal(h.endReason, 'incompatible');
    // So does a weapon that is not on the duel list.
    const odd = duelKit.create({ role: 'host', now: () => p.clock, send() {} });
    odd.receive({ t: 'hello', protocol: duelKit.PROTOCOL, rules: duelKit.rules(), weapon: 'iron_sword' });
    assert.equal(odd.endReason, 'incompatible');
    assert.throws(() => duelKit.create({ role: 'guest', now: () => 0, send() {}, weapon: 'iron_sword' }), /duel weapon/);
});

test('each side picks its weapon: a dagger against a sword, the same on both phones (user, 2026-10-02)', () => {
    assert.deepEqual(plain(PV.weapons.map(id => gameConfig.items[id].weapon)), ['sword', 'dagger'], 'one of each weapon type');
    const p = pair({ weapons: { host: 'wooden_sword', guest: 'assassin_dagger' } }); fightNow(p);
    for (const end of [p.host, p.guest]) {
        assert.deepEqual(plain(end.sim.fighters.map(f => f.loadout.main)), ['wooden_sword', 'assassin_dagger']);
        assert.deepEqual(plain(end.sim.fighters.map(f => f.loadout.offhand)), ['wooden_shield', 'wooden_shield'], 'the rest is the starter gear');
        assert.equal(end.sim.fighters[1].atk, inventoryKit.statsOf(duelKit.loadoutFor('assassin_dagger')).atk);
    }
    // Each plays its own tree.
    press(p.guest, 'attack'); release(p.guest, 'attack'); press(p.host, 'attack'); release(p.host, 'attack'); p.run(0.1);
    assert.deepEqual([p.host.sim.fighters[0].act?.move, p.host.sim.fighters[1].act?.move], ['slash', 'cut']);
    assert.equal(p.guest.sim.fighters[1].act?.move, 'cut');
    // A snapshot giving the dagger a sword move is refused.
    const snap = W.snapshot(p.host.sim);
    assert.equal(duelKit.validSnapshot(p.guest.sim, snap), true);
    snap.fighters[1].act.move = 'slash';
    assert.equal(duelKit.validSnapshot(p.guest.sim, snap), false);
    // Both may pick the same.
    const q = pair({ weapons: { host: 'assassin_dagger', guest: 'assassin_dagger' } });
    assert.ok(q.host.sim.fighters.every(f => f.loadout.main === 'assassin_dagger'));
});

test('the guest walks at once on its own phone; only the host moves the host copy', () => {
    const p = pair(); fightNow(p);
    const g = () => p.guest.sim.fighters[1], hg = () => p.host.sim.fighters[1], x = g().x;
    p.guest.command({ type: 'move', x: -1, y: 0 });
    p.guest.frame(0.06);
    assert.ok(g().x < x - 1.5, 'predicted before anything was delivered');
    assert.ok(Math.abs(hg().x - x) < 1e-9);
    p.run(0.5);
    p.guest.command({ type: 'move', x: 0, y: 0 }); p.run(0.3);
    assert.ok(hg().x < x - 50);
    assert.ok(Math.abs(hg().x - g().x) < 1, `host ${hg().x} guest ${g().x}`);
});

test('a guest combo reaches the same move on both phones, over latency', () => {
    const p = pair({ latency: 0.04 }); fightNow(p);
    press(p.guest, 'attack'); release(p.guest, 'attack');
    assert.equal(p.guest.sim.fighters[1].act.move, 'slash', 'predicted at once');
    p.run(0.2); press(p.guest, 'attack'); release(p.guest, 'attack'); p.run(M.slash.windup + M.slash.swing + M.slash.derive - 0.2 + 0.03);
    assert.equal(p.host.sim.fighters[1].act.move, 'backslash');
    assert.equal(p.guest.sim.fighters[1].act.move, 'backslash');
    p.run(1.2);
    assert.equal(p.host.sim.fighters[1].stats.attacks, 2);
    assert.equal(p.guest.sim.fighters[1].act, null);
    assert.equal(p.shown.guest.filter(e => e.type === 'attack' && e.side === 'guest').length, 2, 'each predicted once, never twice');
});

test('only the host changes HP; the guest sees it with the next snapshot', () => {
    const p = pair({ latency: 0.03 }); fightNow(p); closeIn(p);
    const hp = () => p.guest.sim.fighters.map(f => f.hp);
    press(p.guest, 'attack'); release(p.guest, 'attack');
    for (let i = 0; i < 25; i++) p.guest.frame(0.01);
    assert.deepEqual(plain(hp()), [360, 360], 'the guest\'s own cut decides nothing');
    p.run(0.4);
    assert.ok(p.host.sim.fighters[0].hp < 360);
    assert.deepEqual(plain(hp()), plain(p.host.sim.fighters.map(f => f.hp)));
    assert.equal(p.shown.guest.filter(e => e.type === 'hit').length, 1);
    assert.equal(p.shown.host.filter(e => e.type === 'hit').length, 1);
});

test('stale, foreign, duplicate and broken messages change nothing', () => {
    const p = pair(); fightNow(p);
    const battle = p.host.battle, hostGuest = p.host.sim.fighters[1];
    p.guest.command({ type: 'move', x: 0, y: 0.5 }); p.run(0.05);
    p.host.receive({ t: 'input', battle, seq: 1, cmd: { type: 'press', button: 'attack' } });
    assert.equal(hostGuest.act, null, 'seq 1 was already used by the stick');
    const seq = p.log.guest.sent.filter(m => m.t === 'input').length;
    p.host.receive({ t: 'input', battle, seq: seq + 1, cmd: { type: 'teleport', x: 0 } });
    p.host.receive({ t: 'input', battle: 'old', seq: seq + 2, cmd: { type: 'press', button: 'attack' } });
    assert.equal(hostGuest.act, null);
    const snap = p.log.host.sent.filter(m => m.t === 'snap').at(-1);
    p.run(0.1);
    const hp = p.guest.sim.fighters[1].hp;
    p.guest.receive({ ...plain(snap), serial: snap.serial + 1000, state: { ...plain(snap.state), fighters: [snap.state.fighters[0], { ...snap.state.fighters[1], hp: 1e5 }] } });
    p.guest.receive({ ...plain(snap) });
    assert.equal(p.guest.sim.fighters[1].hp, hp);
    assert.equal(p.guest.phase, 'fight');
});

test('a knock-out and a surrender each give one result on both phones', () => {
    const p = pair(); fightNow(p); closeIn(p);
    p.host.sim.fighters[1].hp = 1;
    press(p.host, 'attack'); release(p.host, 'attack'); p.run(0.5);
    assert.deepEqual(p.log.host.results, ['win']); assert.deepEqual(p.log.guest.results, ['lose']);
    assert.equal(p.guest.phase, 'over');
    assert.equal(press(p.host, 'attack'), false, 'nothing after the end');
    const q = pair(); fightNow(q);
    assert.equal(q.guest.surrender(), true); q.run(0.1);
    assert.deepEqual(q.log.host.results, ['win']); assert.deepEqual(q.log.guest.results, ['lose']);
    assert.equal(q.guest.sim.result.conceded, 'guest');
});

test('a rematch either way round starts a fresh match on both; the old one is gone', () => {
    for (const first of ['host', 'guest']) {
        const p = pair(); fightNow(p);
        const old = p.host.battle;
        p.guest.surrender(); p.run(0.1);
        const second = first === 'host' ? 'guest' : 'host';
        assert.equal(p[first].rematch(), true); p.run(0.05);
        assert.equal(p.log[second].rematch, 1);
        assert.equal(p[second].phase, 'over');
        p[second].rematch(); p.run(0.1);
        assert.notEqual(p.host.battle, old); assert.equal(p.host.battle, p.guest.battle);
        assert.equal(p.host.phase, 'countdown'); assert.equal(p.guest.phase, 'countdown');
        assert.ok(p.guest.sim.fighters.every(f => f.hp === f.maxHp && !f.down));
        p.host.receive({ t: 'surrender', battle: old });
        fightNow(p);
        assert.equal(p.host.sim.result, null);
    }
});

test('silence past the timeout, or a phone leaving, ends it on both with a reason', () => {
    const p = pair(); fightNow(p);
    p.cut();
    p.run(PV.timeoutSeconds + 0.2);
    assert.deepEqual(p.log.host.ends, ['timeout']); assert.deepEqual(p.log.guest.ends, ['timeout']);
    const q = pair(); fightNow(q);
    q.guest.abort(); q.run(0.05);
    assert.deepEqual(q.log.guest.ends, ['aborted']); assert.deepEqual(q.log.host.ends, ['aborted']);
    const r = pair();
    r.host.leave(); r.run(0.05);
    assert.deepEqual(r.log.host.ends, ['closed']); assert.deepEqual(r.log.guest.ends, ['left']);
    // While nothing happens both still hear each other.
    const s = pair(); s.run(PV.timeoutSeconds * 2);
    assert.deepEqual([s.log.host.ends, s.log.guest.ends], [[], []]);
});

// ---- the guest's time, and phones in the background (user, 2026-10-04) ----
// A channel that takes 30 ms and up to 20 more, differently for each message.
function uneven() {
    let seed = 12345;
    return pair({ latency: 0.03, jitter: () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 0.02; } });
}

test('the guest\'s time runs on evenly however unevenly the snapshots come', () => {
    const p = uneven(); fightNow(p); p.run(1);
    // What the guest draws: the last step and how far into the next.
    const g = p.guest, time = () => g.sim.time + g.alpha() * 0.01;
    let last = time(), worst = 0, back = 0;
    for (let i = 0; i < 300; i++) {
        p.frame();
        const now = time();
        worst = Math.max(worst, Math.abs(now - last - 0.01)); if (now < last) back++;
        last = now;
    }
    assert.equal(back, 0, 'never backwards');
    assert.ok(worst < 0.004, `each frame moves it on by a frame, give or take a little: ${worst}`);
    // And it leads the snapshots by about the way there and back.
    const ahead = time() - p.host.sim.time;
    assert.ok(ahead > 0.02 && ahead < 0.08, `ahead of the host by ${ahead}`);
});

test('a cut the guest begins goes on evenly when the host confirms it', () => {
    const p = uneven(); fightNow(p); p.run(1);
    const own = () => p.guest.sim.fighters[1], t = [];
    press(p.guest, 'attack'); release(p.guest, 'attack');
    assert.equal(own().act.move, 'slash');
    let frames = 0;
    while (own().act?.phase === 'windup' && frames < 100) { p.frame(); frames++; if (own().act?.phase === 'windup') t.push(own().act.t); }
    for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1] - 1e-9, `the windup never steps back: ${t[i - 1]} to ${t[i]}`);
    assert.ok(Math.abs(frames * 0.01 - M.slash.windup) <= 0.02, `the windup takes its own time on the guest's screen: ${frames * 0.01}`);
    assert.equal(p.log.guest.sent.filter(m => m.t === 'input').length, 2);
    p.run(0.5);
    assert.equal(p.host.sim.fighters[1].stats.attacks, 1);
});

test('what drawing blends from: each fighter before the last step, its move and how far into it', () => {
    const p = pair(); fightNow(p);
    press(p.host, 'attack'); release(p.host, 'attack'); p.run(0.05);
    const f = p.host.sim.fighters[0], b = p.host.before('host');
    assert.equal(b.act.move, f.act.move); assert.equal(b.act.phase, f.act.phase);
    assert.ok(Math.abs(f.act.t - b.act.t - 0.01) < 1e-9, 'one step earlier');
    assert.equal(typeof b.guardBlend, 'number'); assert.equal(b.shoveOut, 0);
});

test('a phone in the background: the fight stands still till it is back, then a countdown', () => {
    for (const role of ['host', 'guest']) {
        const p = pair({ latency: 0.02 }); fightNow(p);
        const other = role === 'host' ? 'guest' : 'host', walker = () => p.host.sim.fighters[1];
        p.guest.command({ type: 'move', x: -1, y: 0 }); p.run(0.3);
        p.sleep(role); p.run(0.2);
        assert.deepEqual([p.host.phase, p.guest.phase], ['hold', 'hold'], `${role} away`);
        assert.deepEqual([p[role].waiting, p[other].waiting], ['self', 'peer']);
        // Longer than the plain timeout: nothing moves, nobody gives up.
        const x = walker().x, time = p.host.sim.time, guestX = p.guest.sim.fighters[1].x;
        p.run(PV.timeoutSeconds + 2);
        assert.deepEqual([p.host.phase, p.guest.phase], ['hold', 'hold']);
        assert.deepEqual([walker().x, p.host.sim.time, p.guest.sim.fighters[1].x], [x, time, guestX]);
        assert.deepEqual([p.log.host.ends, p.log.guest.ends], [[], []]);
        assert.equal(press(p[other], 'attack'), false, 'no moves while it waits');
        // Back: both count down again, then the stick still held walks on.
        p.wake(role); p.run(0.1);
        assert.deepEqual([p.host.phase, p.guest.phase], ['countdown', 'countdown']);
        assert.equal(p[other].waiting, null);
        assert.ok(Math.abs(p.guest.countdown - (PV.countdown - 0.1)) < 0.06, `counting from the top: ${p.guest.countdown}`);
        assert.equal(walker().x, x);
        fightNow(p); p.run(0.3);
        assert.ok(walker().x < x - 20, 'the fight goes on');
        assert.ok(Math.abs(p.guest.sim.fighters[1].x - walker().x) < 12, 'the same on the guest');
        assert.deepEqual([p.log.host.starts, p.log.guest.starts], [1, 1], 'the same match');
    }
});

test('away and back at once, and both away: held until both are back', () => {
    // The guest is back before the host has even heard it left.
    const p = pair({ latency: 0.05 }); fightNow(p);
    p.guest.away(true); p.guest.away(false);
    assert.equal(p.guest.phase, 'hold', 'held until the host lets it go on');
    p.run(0.02); assert.equal(p.guest.phase, 'hold', 'snapshots sent before the host knew do not let it go');
    p.run(0.3);
    assert.deepEqual([p.host.phase, p.guest.phase], ['countdown', 'countdown']);
    fightNow(p);
    // Both away; the guest back first.
    p.sleep('guest'); p.run(0.2); p.sleep('host'); p.run(1);
    p.wake('guest'); p.run(0.5);
    assert.deepEqual([p.host.phase, p.guest.phase], ['hold', 'hold']);
    assert.equal(p.guest.waiting, 'peer');
    p.wake('host'); p.run(0.2);
    assert.deepEqual([p.host.phase, p.guest.phase], ['countdown', 'countdown']);
    // Away during the first countdown: it starts over.
    const q = pair(); q.run(1); q.sleep('host'); q.run(3); q.wake('host'); q.run(0.1);
    assert.deepEqual([q.host.phase, q.guest.phase], ['countdown', 'countdown']);
    assert.ok(q.host.countdown > PV.countdown - 0.2);
    fightNow(q);
});

test('a phone away too long: the one waiting gives up, and the other is told when it is back', () => {
    for (const role of ['host', 'guest']) {
        const p = pair(); fightNow(p);
        const other = role === 'host' ? 'guest' : 'host';
        p.sleep(role); p.run(PV.awaySeconds - 1);
        assert.deepEqual(p.log[other].ends, []);
        p.run(1.5);
        assert.deepEqual(p.log[other].ends, ['aborted']);
        p.wake(role); p.run(0.1);
        assert.deepEqual(p.log[role].ends, ['aborted']);
    }
    // A phone that went silent without a word still times out.
    const q = pair(); fightNow(q); q.cut(); q.run(PV.timeoutSeconds + 0.2);
    assert.deepEqual(q.log.host.ends, ['timeout']);
});

test('the edge of sight is exact: it ends at the blocks that hide, turns at their corners, and moves evenly as the fighter walks', () => {
    const sim = duel(), t = sim.terrain, far = 30 * U;
    const hides = (c, r) => terrainKit.solidAt(t, c, r) && (!terrainKit.inside(t, c, r) || terrainKit.levelAt(t, c, r) >= 2);
    // The lit ground: the fan's area, in square blocks.
    const area = fan => { let a = 0; for (let i = 0; i < fan.n; i++) { const j = (i + 1) % fan.n; a += fan.reach[i] * fan.reach[j] * Math.sin(fan.angle[j] - fan.angle[i]) / 2; } return a / (U * U); };
    const [x, y] = [7.5 * U, 9.5 * U], fan = terrainKit.sightFan(t, x, y, far);
    assert.ok(fan.n > 40);
    for (let i = 0; i < fan.n; i++) {
        const c = Math.cos(fan.angle[i]), s = Math.sin(fan.angle[i]), d = fan.reach[i];
        if (i) assert.ok(fan.angle[i] >= fan.angle[i - 1], 'in order round the fighter');
        assert.ok(d > 0 && d < far, 'the arena is walled in');
        assert.ok(hides(Math.floor((x + c * (d + 0.01)) / U), Math.floor((y + s * (d + 0.01)) / U)), `ray ${i} ends at a block that hides`);
        assert.ok(terrainKit.sightClear(t, x, y, x + c * (d - 6), y + s * (d - 6)), 'and what is short of it is in sight');
    }
    // Two rays pass the south-east corner of the pillar at (8, 7), where
    // its near face ends: one stops on it, the other goes on to the wall
    // behind.
    const corner = Math.atan2(8 * U - y, 9 * U - x), near = [];
    for (let i = 0; i < fan.n; i++) if (Math.abs(fan.angle[i] - corner) < 1e-3) near.push(fan.reach[i]);
    assert.ok(near.length >= 2, 'a ray either side of it');
    assert.ok(Math.abs(Math.min(...near) - Math.hypot(9 * U - x, 8 * U - y)) < 0.05, 'to the corner itself');
    assert.ok(Math.max(...near) > Math.min(...near) + U, 'and past it');
    // Walking a hundredth of a block at a time, the lit ground never jumps.
    const out = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) };
    let last = area(terrainKit.sightFan(t, 5 * U, 10.2 * U, far, { out })), worst = 0;
    for (let k = 1; k <= 1400; k++) {
        const now = area(terrainKit.sightFan(t, (5 + k * 0.01) * U, 10.2 * U, far, { out }));
        worst = Math.max(worst, Math.abs(now - last)); last = now;
    }
    assert.ok(worst < 0.6, `the lit ground changes by at most ${worst} square blocks a step`);
    // Off the map, or inside a block, nothing is seen.
    assert.equal(terrainKit.sightFan(t, -U, -U, far).n, 0);
    assert.ok(Array.from(terrainKit.sightFan(t, 3.5 * U, 9.5 * U, far).reach.subarray(0, 8)).every(d => d === 0));
});

// Sight is the same in the adventure and in a duel (core/combat.js `sees`,
// core/terrain.js `sightFan`); it is tried here on the arena.
test('a fighter sees the front 120 degrees by day and a small ring round itself, and not past a wall: a body behind it further off is not seen and the ground there is not lit (user, 2026-10-04)', () => {
    const SIGHT = gameConfig.player.sight.day.angle, NEAR = gameConfig.player.sight.day.near, PV = { sightAngle: SIGHT };
    assert.ok(Math.abs(SIGHT - 60 * Math.PI / 180) < 1e-12, '60 degrees either side (user, 2026-10-09; it was 75)');
    assert.equal(NEAR, 2.5 * U, 'the ring is small: two and a half blocks (user, 2026-10-06; it was two)');
    const sim = duel(), t = sim.terrain, [h, g] = sim.fighters, far = 30 * U;
    Object.assign(h, { x: 12 * U, y: 9.5 * U, facing: 0 });
    // The rival 2.9 blocks away, `deg` round from due east: past the ring
    // (its nearer edge too). Its nearer edge counts (its radius is 5.9
    // degrees wide from there).
    const at = (deg, body = g, d = 2.9 * U) => { const a = deg * Math.PI / 180; Object.assign(body, { x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d }); return combatKit.sees(t, h, body); };
    // Due south of the fighter, where no pillar stands in the way, and the
    // fighter turned so that the rival is `off` degrees off where it faces.
    const by = (off, body = g, d = 2.9 * U, sight) => { at(90, body, d); h.facing = (90 - off) * Math.PI / 180; return combatKit.sees(t, h, body, sight); };
    assert.deepEqual([0, 55, -55, 65, -65, 75, -75, 180].map(off => by(off)), [true, true, true, true, true, false, false, false]);
    h.facing = Math.PI;
    assert.equal(at(180), true, 'turned round, it sees the other way');
    assert.equal(at(0), false);
    // A bigger body shows sooner: a monster as wide as the wolf king (a little further off, so that it too is past the ring).
    h.facing = 0;
    const big = { x: 0, y: 0, radius: gameConfig.monsters.wolfKing.radius };
    assert.deepEqual([69, 77].map(off => [by(off, g, 3.1 * U), by(off, big, 3.1 * U)]), [[false, true], [false, false]]);
    h.facing = 0;
    // The ring: behind its back a body is seen once its nearer edge is within sightNear, whichever way the fighter faces.
    const behind = d => at(180, g, d);
    assert.deepEqual([NEAR + g.radius - 1, NEAR + g.radius + 1].map(behind), [true, false]);
    assert.equal(at(180, big, NEAR + big.radius - 1), true, 'a wide body from further off');
    assert.equal(at(105, g, NEAR), true);
    // Ahead, a wall still hides: either side of the north pillar. A step
    // out past its corner and an edge of the body shows before its middle.
    Object.assign(h, { x: 500, y: 260, facing: 0 }); Object.assign(g, { x: 620, y: 260 });
    assert.equal(combatKit.sees(t, h, g), false);
    Object.assign(h, { x: 500, y: 330 }); Object.assign(g, { x: 620, y: 316 });
    assert.equal(terrainKit.sightClear(t, h.x, h.y, g.x, g.y), false, 'its middle is behind the corner');
    assert.equal(combatKit.sees(t, h, g), true, 'its edge is not');
    // The lit ground: nothing outside the arc, the same as before inside it,
    // with a ray just either side of each edge.
    const facing = 0.4, [x, y] = [12.5 * U, 9.5 * U];
    const whole = terrainKit.sightFan(t, x, y, far), front = terrainKit.sightFan(t, x, y, far, { facing, half: PV.sightAngle });
    const reachAt = (fan, a) => { for (let i = 0; i < fan.n; i++) if (Math.abs(fan.angle[i] - a) < 1e-12) return fan.reach[i]; return null; };
    let lit = 0, dark = 0;
    for (let i = 0; i < front.n; i++) {
        const off = Math.abs(space.wrapAngle(front.angle[i] - facing)), same = reachAt(whole, front.angle[i]);
        if (off > PV.sightAngle) { assert.equal(front.reach[i], 0, 'behind: nothing'); dark++; } else { assert.ok(front.reach[i] > 0); lit++; if (same !== null) assert.equal(front.reach[i], same); }
    }
    assert.ok(lit > 10 && dark > 10);
    for (const side of [-1, 1]) {
        const edge = space.wrapAngle(facing + side * PV.sightAngle), near = [];
        for (let i = 0; i < front.n; i++) if (Math.abs(space.wrapAngle(front.angle[i] - edge)) < 1e-3) near.push(front.reach[i]);
        assert.ok(near.includes(0) && near.some(d => d > U), `the edge of the arc is sharp: ${near}`);
    }
    // With the ring the ground outside the arc is lit as far as sightNear
    // -- or the pillar, which stands nearer than that on one side -- and
    // inside it as before.
    const ringed = terrainKit.sightFan(t, x, y, far, { facing, half: PV.sightAngle, near: NEAR }), walls = terrainKit.sightFan(t, x, y, far, { facing, half: PV.sightAngle, near: far });
    assert.equal(ringed.n, front.n);
    const round = [];
    for (let i = 0; i < ringed.n; i++) {
        const off = Math.abs(space.wrapAngle(ringed.angle[i] - facing));
        assert.equal(ringed.reach[i], off > PV.sightAngle ? Math.min(NEAR, walls.reach[i]) : front.reach[i]);
        if (off > PV.sightAngle) round.push(ringed.reach[i]);
    }
    assert.ok(round.filter(d => d === NEAR).length > 10 && round.some(d => d < NEAR - 1), 'the ring, short where a wall stands in it');
    // A wall nearer than that ends it: just inside the west wall, looking east.
    const byWall = terrainKit.sightFan(t, 4.5 * U, 9.5 * U, far, { facing: 0, half: PV.sightAngle, near: NEAR });
    const west = Array.from({ length: byWall.n }, (_, i) => i).filter(i => Math.abs(space.wrapAngle(byWall.angle[i] - Math.PI)) < 0.2).map(i => byWall.reach[i]);
    assert.ok(west.length && west.every(d => d >= 0.5 * U - 1e-6 && d < 0.6 * U), `the ring stops at the wall: ${west}`);
    // Turning a hundredth of a radian at a time, the lit ground never jumps
    // (all the way round, through where the angle wraps).
    const area = fan => { let a = 0; for (let i = 0; i < fan.n; i++) { const j = (i + 1) % fan.n; a += fan.reach[i] * fan.reach[j] * Math.sin(fan.angle[j] - fan.angle[i]) / 2; } return a / (U * U); };
    const out = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) }, total = area(whole);
    let last = area(terrainKit.sightFan(t, x, y, far, { facing: -4, half: PV.sightAngle, out })), worst = 0;
    for (let k = 1; k <= 800; k++) {
        const now = area(terrainKit.sightFan(t, x, y, far, { facing: -4 + k * 0.01, half: PV.sightAngle, out }));
        assert.ok(now > 0 && now < total, 'part of the whole');
        worst = Math.max(worst, Math.abs(now - last)); last = now;
    }
    assert.ok(worst < 1.5, `the lit ground changes by at most ${worst} square blocks a step`);
});

test('at night a fighter sees only the front 90 degrees and a ring of a block and a half round itself (user, 2026-10-09)', () => {
    const { day, night } = gameConfig.player.sight, sim = duel(), t = sim.terrain, [h, g] = sim.fighters;
    assert.ok(Math.abs(night.angle - 45 * Math.PI / 180) < 1e-12, '45 degrees either side');
    assert.equal(night.near, 1.5 * U);
    Object.assign(h, { x: 12 * U, y: 9.5 * U, facing: 0 });
    // The rival due south (no pillar in the way), the fighter turned so that it is `off` degrees off where it faces.
    const south = (off, sight, d = 2.9 * U) => { Object.assign(g, { x: h.x, y: h.y + d }); h.facing = (90 - off) * Math.PI / 180; return combatKit.sees(t, h, g, sight); };
    // Its nearer edge counts (5.9 degrees wide from there).
    assert.deepEqual([0, 35, 45, 55].map(off => south(off, night)), [true, true, true, false]);
    assert.deepEqual([0, 35, 45, 55].map(off => south(off, day)), [true, true, true, true], 'by day, 55 degrees off is still seen');
    // The ring, behind its back: a body 2 blocks off is seen by day and not by night, one block off by both.
    const behind = (d, sight) => { Object.assign(g, { x: h.x - d, y: h.y }); h.facing = 0; return combatKit.sees(t, h, g, sight); };
    assert.deepEqual([behind(2 * U, day), behind(2 * U, night), behind(U, night)], [true, false, true]);
});
