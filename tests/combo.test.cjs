// The move tree on A and B, carried over from the 2D version's tests
// (tag v1-2d, tests/spatial-engine.test.cjs), played on the one attack key
// (user, 2026-10-03): a tap is an A, a hold of combo.holdSeconds a B.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, gameConfig } = load();
const K = gameConfig.combo, M = K.moves;

// A sim with the dummy out of the way: far off and with nothing to do.
// `main`: the weapon held (its type decides the move tree).
function setup({ near = false, main = null } = {}) {
    const sim = W.create(main ? { loadout: { ...gameConfig.gear.starter, main } } : {}), d = sim.dummy;
    d.wait = 1e9; // never attacks
    if (near) { sim.player.x = d.x - 60; sim.player.y = d.y; sim.player.facing = 0; }
    else { d.x += 400; }
    return sim;
}
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, button) => W.command(sim, { type: 'press', button });
const release = (sim, button) => W.command(sim, { type: 'release', button });
const HOLD = K.holdSeconds;
// The attack key: a tap is an A at once; held HOLD it is a B (that time
// passes here). holdB keeps it held: a charge.
const tap = (sim, input = 'a') => { press(sim, 'attack'); if (input === 'b') step(sim, HOLD); release(sim, 'attack'); };
const holdB = sim => { press(sim, 'attack'); step(sim, HOLD); };
const phase = sim => sim.player.act ? `${sim.player.act.phase}:${sim.player.act.move}` : 'idle';
// Step until `done` (or a limit), logging each phase change with its time.
function run(sim, done, limit = 3) {
    const log = [{ key: phase(sim), time: sim.time }];
    for (let i = 0; i < limit / 0.01 && !done(); i++) {
        W.step(sim, 0.01);
        if (log.at(-1).key !== phase(sim)) log.push({ key: phase(sim), time: sim.time });
    }
    return log;
}
const until = (sim, key, limit) => run(sim, () => phase(sim) === key, limit);
const moves = sim => [...W.drain(sim).filter(e => e.type === 'attack').map(e => e.move)];

test('A walks the A chain; a buffered A starts the next move at the derive point', () => {
    const sim = setup({ near: true });
    tap(sim); const log = until(sim, 'recover:slash');
    tap(sim); log.push(...until(sim, 'recover:backslash'));
    tap(sim); log.push(...run(sim, () => phase(sim) === 'idle'));
    assert.deepEqual(log.map(x => x.key).filter(k => k.startsWith('windup')), ['windup:slash', 'windup:backslash', 'windup:smite']);
    const swingEnd = log.find(x => x.key === 'recover:backslash').time, next = log.find(x => x.key === 'windup:smite').time;
    assert.ok(Math.abs(next - swingEnd - M.backslash.derive) < 0.011, 'the recovery is cut at the derive point');
    // A finisher has no derive point: its recovery always plays out in full.
    const lastEnd = log.find(x => x.key === 'recover:smite').time, idle = log.at(-1).time;
    assert.ok(Math.abs(idle - lastEnd - M.smite.recovery) < 0.011);
    assert.deepEqual([...W.drain(sim).filter(e => e.type === 'hit').map(e => e.move)], ['slash', 'backslash', 'smite']);
});

test('pressing A starts the windup at once; without a next input the recovery plays out and the window closes', () => {
    const sim = setup();
    tap(sim); assert.equal(phase(sim), 'windup:slash', 'a tap is an A at once');
    const log = run(sim, () => phase(sim) === 'idle');
    const swingEnd = log.find(x => x.key === 'recover:slash').time;
    assert.ok(Math.abs(log.at(-1).time - swingEnd - M.slash.recovery) < 0.011);
    tap(sim); assert.equal(sim.player.act.move, 'backslash', 'inside the window an A continues the chain');
    const late = setup(); tap(late); step(late, M.slash.windup + M.slash.swing + M.slash.recovery + K.windowAfterRecovery + 0.05);
    assert.equal(late.player.chain, null); tap(late); assert.equal(late.player.act.move, 'slash', 'after the window an A starts over');
    const walked = setup(); tap(walked); step(walked, M.slash.windup + M.slash.swing + M.slash.recovery + 0.02);
    W.command(walked, { type: 'move', x: 1, y: 0 }); step(walked, 0.05); W.command(walked, { type: 'move', x: 0, y: 0 });
    assert.equal(walked.player.chain, null, 'walking off ends the combo'); tap(walked); assert.equal(walked.player.act.move, 'slash');
});

test('one attack key (user, 2026-10-03): a tap is an A, a hold a B, and telling them apart costs no time', () => {
    assert.ok(HOLD > 0 && HOLD <= 0.25, `hold ${HOLD}`);
    // A tap that took 0.08 s: the slash starts 0.08 s into its windup and swings when a press would have.
    const sim = setup(); press(sim, 'attack'); step(sim, 0.08);
    assert.equal(sim.player.act, null, 'not told yet');
    release(sim, 'attack');
    assert.equal(phase(sim), 'windup:slash'); assert.ok(Math.abs(sim.player.act.t - 0.08) < 1e-9);
    const log = until(sim, 'swing:slash');
    assert.ok(Math.abs(log.at(-1).time - M.slash.windup) < 0.011, `swings at ${log.at(-1).time}`);
    // Held: a B once HOLD has passed, already HOLD into its windup.
    const held = setup(); press(held, 'attack'); step(held, HOLD - 0.02);
    assert.equal(held.player.act, null);
    step(held, 0.02); assert.equal(phase(held), 'windup:charged'); assert.ok(Math.abs(held.player.act.t - HOLD) < 0.011);
    // A dagger lunge's windup is shorter than that: it swings the moment it is told.
    const dagger = setup({ main: 'assassin_dagger' }); press(dagger, 'attack');
    const dl = until(dagger, 'swing:lunge'); release(dagger, 'attack');
    assert.ok(M.lunge.windup < HOLD && Math.abs(dl.at(-1).time - HOLD) < 0.021, `lunges at ${dl.at(-1).time}`);
    // While it tells, the body stands as in a windup: no walking, a slow turn.
    const still = setup(), P = gameConfig.player; still.player.facing = -Math.PI / 2;
    const x0 = still.player.x, y0 = still.player.y;
    W.command(still, { type: 'move', x: 1, y: 0 }); press(still, 'attack'); step(still, 0.1);
    assert.ok(Math.hypot(still.player.x - x0, still.player.y - y0) < 1e-9, 'no walking while it tells');
    assert.ok(Math.abs(still.player.facing + Math.PI / 2 - P.turnRate * K.windupTurnMultiplier * 0.1) < 0.03);
    release(still, 'attack'); W.command(still, { type: 'move', x: 0, y: 0 });
    // The pause line counts from the press: pressed before it, let go after, it is the ordinary A.
    const twoA = () => { const s = setup(); tap(s); until(s, 'recover:slash'); tap(s); until(s, 'idle'); return s; };
    const pause = K.weapons.sword.pauseAfterRecovery, early = twoA();
    step(early, pause - 0.06); press(early, 'attack'); step(early, 0.1); release(early, 'attack');
    assert.equal(early.player.act.move, 'smite');
    const late = twoA(); step(late, pause + 0.02); tap(late);
    assert.equal(late.player.act.move, 'thrust');
});

test('pre-input: a press during the windup is kept and still runs only at the derive point', () => {
    const sim = setup(); tap(sim); step(sim, 0.05);
    tap(sim); assert.equal(sim.player.buffer.input, 'a', 'kept, not dropped');
    const log = until(sim, 'windup:backslash');
    const swingEnd = log.find(x => x.key === 'recover:slash').time;
    assert.ok(Math.abs(log.at(-1).time - swingEnd - M.slash.derive) < 0.011, 'pressing early is never faster');
    // Mashing buffers one input, never a backlog.
    const mash = setup(); tap(mash); for (let i = 0; i < 5; i++) { step(mash, 0.02); tap(mash); }
    step(mash, 1.5); assert.equal(mash.stats.attacks, 2);
    // B pressed during the windup becomes the node's B move at the derive point.
    const b = setup(); tap(b); step(b, 0.05); tap(b, 'b'); until(b, 'windup:rising');
    assert.equal(b.player.act.move, 'rising');
});

test('the latest press wins, and a stale press expires', () => {
    const sim = setup(); tap(sim); step(sim, 0.03); tap(sim, 'b'); tap(sim);
    assert.equal(sim.player.buffer.input, 'a', 'the later A replaced the B');
    until(sim, 'windup:backslash');
    // Pressed early in the finisher, the A is stale by the time its recovery ends.
    const third = setup(); tap(third); until(third, 'recover:slash'); tap(third); until(third, 'recover:backslash'); tap(third); until(third, 'swing:smite');
    tap(third); step(third, 1.5);
    assert.deepEqual(moves(third), ['slash', 'backslash', 'smite'], 'no extra slash after the finisher');
    // Pressed near the end of that recovery, it starts the next combo.
    const late = setup(); tap(late); until(late, 'recover:slash'); tap(late); until(late, 'recover:backslash'); tap(late); until(late, 'recover:smite');
    run(late, () => late.player.act.t > M.smite.recovery - 0.2);
    tap(late); step(late, 0.3); assert.equal(late.player.act.move, 'slash');
    // Mashing straight through walks the whole A chain.
    const m = setup(); for (let i = 0; i < 40; i++) { tap(m); step(m, 0.05); }
    assert.deepEqual(moves(m).slice(0, 3), ['slash', 'backslash', 'smite']);
});

test('a pause past the recovery takes the pause move; only A is changed by it', () => {
    const twoA = () => { const s = setup(); tap(s); until(s, 'recover:slash'); tap(s); until(s, 'idle'); return s; };
    const sim = twoA(), pause = K.weapons.sword.pauseAfterRecovery; assert.equal(sim.player.chain.move, 'backslash');
    // The sword's pause line comes a little sooner than the first 0.2 s (user, 2026-10-02).
    assert.ok(pause > 0.1 && pause < 0.2, `sword pause line ${pause}`);
    step(sim, pause + 0.02);
    assert.ok(W.drain(sim).some(e => e.type === 'pause_ready' && e.move === 'thrust'), 'crossing the pause line is cued');
    tap(sim); assert.equal(sim.player.act.move, 'thrust');
    assert.deepEqual([...sim.player.combo], ['a', 'a', '-', 'a']);
    const onTime = twoA(); step(onTime, 0.05); tap(onTime); assert.equal(onTime.player.act.move, 'smite');
    // A node without a pause move treats the late A as its ordinary A.
    const late = setup(); tap(late); until(late, 'idle'); step(late, pause + 0.05);
    tap(late); assert.equal(late.player.act.move, 'backslash');
    // B is the node's B, pause or not.
    const b = twoA(); step(b, pause + 0.05); tap(b, 'b'); assert.equal(b.player.act.move, 'cleave');
});

test('opening B: windup at once, charges while held, cuts on release; A then follows up', () => {
    const C = gameConfig.combat.charge;
    const sim = setup(); holdB(sim);
    assert.equal(phase(sim), 'windup:charged');
    until(sim, 'charge:charged');
    assert.ok(Math.abs(sim.time - M.charged.windup) < 0.011, 'held past the windup, it charges');
    step(sim, 1); assert.equal(phase(sim), 'charge:charged', 'a charge never fires by itself');
    release(sim, 'attack'); assert.equal(phase(sim), 'swing:charged');
    const share = (1 + M.charged.windup - C.threshold) / (C.full - C.threshold);
    assert.ok(Math.abs(sim.player.act.share - share) < 0.02, `charge share ${sim.player.act.share}`);
    until(sim, 'recover:charged'); tap(sim); until(sim, 'windup:follow');
    // Let go before the windup ends (a B already): it cuts as soon as the windup is over, uncharged.
    const quick = setup(); holdB(quick); step(quick, 0.1); release(quick, 'attack');
    until(quick, 'swing:charged');
    assert.ok(Math.abs(quick.time - M.charged.windup) < 0.011);
    assert.equal(quick.player.act.share, 0);
    // A charge lunges further than a quick cut.
    const lunge = held => { const s = setup(); const x0 = s.player.x; s.player.facing = 0; press(s, 'attack'); step(s, held); release(s, 'attack'); until(s, 'recover:charged'); return s.player.x - x0; };
    assert.ok(Math.abs(lunge(HOLD + 0.1) - M.charged.step) < 0.5 && Math.abs(lunge(C.full + 0.1) - M.charged.step - M.charged.chargeStep) < 0.5);
});

test('a charge turns slower, and the cut goes where the charge turned to', () => {
    const P = gameConfig.player, C = gameConfig.combat.charge;
    // Facing away from the dummy, charge, turn round to it, let go: it lands.
    const sim = setup({ near: true }); sim.player.facing = Math.PI;
    press(sim, 'attack'); until(sim, 'charge:charged');
    W.command(sim, { type: 'move', x: 1, y: 0.0001 }); step(sim, 0.1);
    assert.ok(Math.abs(Math.PI - Math.abs(sim.player.facing) - P.turnRate * C.turnMultiplier * 0.1) < 0.02, `turned ${Math.PI - Math.abs(sim.player.facing)}`);
    step(sim, 0.6); W.command(sim, { type: 'move', x: 0, y: 0 });
    assert.ok(Math.abs(sim.player.facing) < 0.01, 'faces the dummy now');
    const x0 = sim.player.x; release(sim, 'attack'); until(sim, 'recover:charged');
    assert.equal(sim.stats.hits, 1, 'the cut lands where the body turned');
    assert.ok(sim.player.x > x0, 'and lunges that way');
    // Let go before the windup is over: the minimum charge, nothing added.
    const early = setup(); press(early, 'attack'); step(early, M.charged.windup - 0.02); release(early, 'attack');
    until(early, 'swing:charged'); assert.equal(early.player.act.share, 0);
});

test('a held B waits its turn as an opening charge; an A after a landed charged cut still follows up', () => {
    const sim = setup(); tap(sim); until(sim, 'recover:slash'); tap(sim); until(sim, 'recover:backslash'); tap(sim); until(sim, 'swing:smite');
    press(sim, 'attack'); step(sim, M.smite.swing + M.smite.recovery + M.charged.windup + 0.05);
    assert.equal(phase(sim), 'charge:charged', 'held through the finisher, B starts charging when it is over');
    release(sim, 'attack');
    // The hitstop of a landed cut does not eat the buffered A's time.
    const hit = setup({ near: true }); press(hit, 'attack'); step(hit, 0.6); release(hit, 'attack'); step(hit, 0.02); tap(hit);
    until(hit, 'windup:follow'); assert.equal(hit.player.act.move, 'follow');
    assert.equal(hit.stats.hits, 1);
});

test('while charging the body walks slower; it cannot walk during any other move', () => {
    const P = gameConfig.player, C = gameConfig.combat.charge;
    const sim = setup(); sim.player.facing = 0; press(sim, 'attack'); until(sim, 'charge:charged');
    const x0 = sim.player.x; W.command(sim, { type: 'move', x: 1, y: 0 }); step(sim, 0.5);
    assert.ok(Math.abs(sim.player.x - x0 - P.speed * C.moveMultiplier * (0.5 - (P.startSeconds - 0.01) / 2)) < 0.5);
    release(sim, 'attack');
    const moving = setup(); W.command(moving, { type: 'move', x: 1, y: 0 }); step(moving, 0.3);
    tap(moving); const x1 = moving.player.x; step(moving, 0.15);
    assert.ok(moving.player.x - x1 <= M.slash.step + 1e-6, 'the windup and swing stand still but for the lunge');
});

test('inside a move the stick never walks; it turns the body only in a windup, slower, and the swing locks it (user, 2026-10-02); still pushed when the recovery ends, the body walks off', () => {
    const sim = setup(); sim.player.facing = -Math.PI / 2; tap(sim); until(sim, 'recover:slash');
    const { x, y } = sim.player; W.command(sim, { type: 'move', x: 1, y: 0 }); step(sim, 0.1);
    assert.equal(phase(sim), 'recover:slash');
    assert.ok(Math.abs(sim.player.x - x) < 1e-9 && Math.abs(sim.player.y - y) < 1e-9, 'no walking in the recovery');
    assert.equal(sim.player.facing, -Math.PI / 2, 'and no turning');
    step(sim, 0.3); assert.equal(phase(sim), 'idle'); assert.ok(sim.player.x > x); assert.equal(sim.player.chain, null);
    // The stick held from the press: the windup turns at the slower rate, the swing goes that way and stays.
    const c = setup(), P = gameConfig.player; c.player.facing = -Math.PI / 2;
    const cx = c.player.x, cy = c.player.y;
    W.command(c, { type: 'move', x: 1, y: 0 }); tap(c); step(c, 0.05);
    assert.equal(phase(c), 'windup:slash');
    assert.ok(Math.hypot(c.player.x - cx, c.player.y - cy) < 1e-9, 'no walking in the windup');
    const turned = c.player.facing - -Math.PI / 2;
    assert.ok(Math.abs(turned - P.turnRate * K.windupTurnMultiplier * 0.05) < 0.03, `windup turned ${turned.toFixed(3)}`);
    until(c, 'swing:slash');
    const locked = c.player.facing;
    assert.equal(c.player.act.facing, locked, 'the swing goes where the windup turned to');
    step(c, 0.03); assert.equal(c.player.facing, locked, 'and does not turn on');
    // The stick let go through a recovery, then A: the next move starts the same way as the last.
    const d = setup(); d.player.facing = -Math.PI / 2; tap(d); until(d, 'recover:slash');
    W.command(d, { type: 'move', x: 1, y: 0 }); step(d, 0.1); W.command(d, { type: 'move', x: 0, y: 0 });
    tap(d); until(d, 'windup:backslash');
    assert.equal(d.player.act.facing, -Math.PI / 2);
});

test('attacking or raising the shield ends a run (user, 2026-10-01)', () => {
    const P = gameConfig.player;
    for (const button of ['attack', 'guard']) {
        const sim = setup(); sim.player.y += 3 * gameConfig.world.unitsPerBlock; sim.player.facing = 0;
        W.command(sim, { type: 'move', x: 1, y: 0 }); step(sim, P.runAfter + P.runRampSeconds + P.startSeconds + 0.05);
        assert.equal(sim.player.runBlend, 1);
        press(sim, button); step(sim, 0.02);
        assert.equal(sim.player.runBlend, 0, `${button}: the run is over at once`);
        if (button === 'attack') release(sim, button);
        if (button === 'guard') {
            const x0 = sim.player.x; step(sim, 0.5);
            const speed = (sim.player.x - x0) / 0.5, G = gameConfig.combat.guard;
            assert.ok(Math.abs(speed - P.speed * G.moveMultiplier) < 1, `shield up walks slowly: ${speed}`);
            release(sim, button); step(sim, P.runAfter - 0.2);
            assert.equal(sim.player.runBlend, 0, 'and the two seconds start again');
        } else {
            step(sim, M.slash.windup + M.slash.swing + M.slash.recovery + 0.1); assert.ok(sim.player.speed > 0 && sim.player.runBlend === 0, 'after the move the body walks, it does not run on');
        }
    }
});

test('a landed hit holds both fighters for the hitstop; only moves with knockback push', () => {
    const I = gameConfig.combat.impact;
    const swingEnd = near => { const s = setup({ near }); tap(s); return until(s, 'recover:slash').at(-1).time; };
    assert.ok(Math.abs(swingEnd(true) - swingEnd(false) - I.hitstop.hit) < 0.011, 'the swing waits out the hitstop');
    const sim = setup({ near: true }); const d = sim.dummy; d.anchored = false;
    const x0 = d.x; tap(sim); step(sim, 0.5);
    assert.equal(sim.stats.hits, 1); assert.equal(d.x, x0, 'an A move does not push');
    const heavy = setup({ near: true }); const hd = heavy.dummy; hd.anchored = false;
    const hx = hd.x; tap(heavy); until(heavy, 'recover:slash'); tap(heavy, 'b'); until(heavy, 'recover:rising'); step(heavy, 0.2);
    assert.equal(heavy.stats.hits, 2);
    assert.ok(Math.abs(hd.x - hx - M.rising.knockback) < 0.5, `B pushed ${hd.x - hx}`);
    // The training dummy is anchored: never pushed.
    const anchored = setup({ near: true }); const ax = anchored.dummy.x;
    tap(anchored); until(anchored, 'recover:slash'); tap(anchored, 'b'); until(anchored, 'idle');
    assert.equal(anchored.dummy.x, ax);
});

test('stagger comes from B moves only, in whole points; three and the dummy reels, then recovers', () => {
    const S = gameConfig.combat.stagger;
    const sim = setup({ near: true });
    tap(sim); until(sim, 'recover:slash'); tap(sim); until(sim, 'recover:backslash'); tap(sim);
    run(sim, () => phase(sim) === 'idle');
    assert.equal(sim.stats.hits, 3); assert.equal(sim.dummy.stagger, 0, 'A A A: no stagger');
    for (const m of Object.values(M)) assert.ok(Number.isInteger(m.stagger) && m.stagger >= 0, `${m.name}: whole stagger points (user, 2026-10-02)`);
    tap(sim, 'b'); until(sim, 'recover:charged'); assert.equal(sim.dummy.stagger, M.charged.stagger);
    run(sim, () => phase(sim) === 'idle'); step(sim, K.windowAfterRecovery + 0.05); // else A would be the follow-up
    // A B: the rising cut's 2 tips it over 3.
    assert.ok(M.charged.stagger < S.threshold && M.charged.stagger + M.rising.stagger >= S.threshold);
    tap(sim); until(sim, 'recover:slash'); tap(sim, 'b'); until(sim, 'recover:rising');
    assert.equal(sim.dummy.phase, 'reel'); assert.equal(sim.dummy.stagger, 0, 'and its points start over');
    assert.ok(W.drain(sim).some(e => e.type === 'stagger' && e.side === 'dummy'));
    step(sim, S.duration + 0.05); assert.equal(sim.dummy.phase, 'idle');
});

// ---- weapon types (design.md 4.2) ----
test('each weapon type has its own tree: roots and derived moves stay in the type, stagger in whole points', () => {
    for (const [type, w] of Object.entries(K.weapons)) {
        for (const input of ['a', 'b']) assert.equal(M[w.root[input]]?.weapon, type, `${type} ${input} root`);
        for (const [id, m] of Object.entries(M).filter(([, m]) => m.weapon === type)) {
            for (const next of Object.values(m.next || {})) assert.equal(M[next]?.weapon, type, `${id} -> ${next}`);
            assert.equal(m.derive != null, !!m.next, `${id}: a derive point exactly when something derives`);
        }
    }
    // Every weapon names a type with a tree.
    for (const [id, item] of Object.entries(gameConfig.items)) if (item.slot === 'main') assert.ok(K.weapons[item.weapon], id);
    // The sword is the slower one: every sword move is longer than the dagger's at the same place in the tree.
    const length = id => M[id].windup + M[id].swing + M[id].recovery;
    for (const [s, d] of [['slash', 'cut'], ['backslash', 'recut'], ['smite', 'whirl'], ['thrust', 'stab']]) assert.ok(length(s) > length(d), `${s} is slower than ${d}`);
});

// Walk a combo: each input pressed once the move before has swung.
function combo(sim, inputs) {
    const done = [];
    for (const input of inputs) {
        const prev = done.at(-1) ?? sim.player.act?.move;
        tap(sim, input);
        run(sim, () => sim.player.act?.phase === 'recover' && sim.player.act.move !== prev);
        done.push(sim.player.act?.move);
    }
    return done;
}

test('the dagger chains five As: cut, recut, stab, whirl, drop', () => {
    const sim = setup({ main: 'assassin_dagger' });
    assert.deepEqual(combo(sim, ['a', 'a', 'a', 'a', 'a']), ['cut', 'recut', 'stab', 'whirl', 'drop']);
    assert.deepEqual([...sim.player.combo], ['a', 'a', 'a', 'a', 'a']);
    // The drop is the finisher: an A late in its recovery starts over once it is over.
    run(sim, () => sim.player.act.t > M.drop.recovery - 0.2);
    tap(sim); assert.equal(sim.player.act.move, 'drop');
    run(sim, () => sim.player.act?.move === 'cut');
    assert.equal(sim.player.act?.move, 'cut');
});

test('inside a dagger combo B flicks and goes on: A A A B A A is six moves', () => {
    const sim = setup({ main: 'assassin_dagger' });
    assert.deepEqual(combo(sim, ['a', 'a', 'a', 'b', 'a', 'a']), ['cut', 'recut', 'stab', 'flick', 'whirl', 'drop']);
    assert.deepEqual([...sim.player.combo], ['a', 'a', 'a', 'b', 'a', 'a']);
    const early = setup({ main: 'assassin_dagger' });
    assert.deepEqual(combo(early, ['a', 'b', 'a', 'a']), ['cut', 'flick', 'whirl', 'drop']);
});

test('the dagger opens B with a lunge forward and goes on into the chain; a pause after A A jumps back', () => {
    const sim = setup({ main: 'assassin_dagger' }), x0 = sim.player.x;
    sim.player.facing = 0;
    tap(sim, 'b'); assert.equal(sim.player.act.move, 'lunge', 'no charge: B is the lunge at once');
    until(sim, 'recover:lunge');
    assert.ok(sim.player.x - x0 > M.lunge.step - 1, `lunged ${(sim.player.x - x0).toFixed(1)}`);
    assert.deepEqual(combo(sim, ['a', 'a']), ['recut', 'stab']);
    const back = setup({ main: 'assassin_dagger' });
    back.player.facing = 0;
    tap(back); until(back, 'recover:cut'); tap(back); run(back, () => phase(back) === 'idle');
    step(back, K.weapons.dagger.pauseAfterRecovery + 0.02);
    const x1 = back.player.x; tap(back);
    assert.equal(back.player.act.move, 'retreat');
    until(back, 'recover:retreat');
    assert.ok(x1 - back.player.x > -M.retreat.step - 1, `jumped back ${(x1 - back.player.x).toFixed(1)}`);
});

test('an input the move does not derive waits for the recovery: no endless loops through the root', () => {
    // B in the whirl (it derives only A): the lunge starts after the whirl's whole recovery.
    const sim = setup({ main: 'assassin_dagger' });
    combo(sim, ['a', 'a', 'a', 'a']);
    assert.equal(sim.player.act.move, 'whirl');
    const swingEnd = sim.time - sim.player.act.t;
    tap(sim, 'b');
    const log = until(sim, 'windup:lunge');
    assert.ok(log.at(-1).time - swingEnd >= M.whirl.recovery - 0.011, 'not cut short at the derive point');
    assert.deepEqual([...sim.player.combo], ['b'], 'and it is a new combo');
    // A derived input still cuts the recovery short.
    const d = setup({ main: 'assassin_dagger' }); combo(d, ['a', 'a', 'a']); tap(d);
    const l2 = until(d, 'windup:whirl'), end2 = l2.find(x => x.key === 'recover:stab')?.time;
    assert.ok(end2 === undefined || l2.at(-1).time - end2 < M.stab.recovery);
});

test('the same inputs give the same fight', () => {
    const play = () => {
        const sim = setup({ near: true }); sim.dummy.wait = 0.3;
        const script = { 0: ['press', 'attack'], 5: ['release', 'attack'], 20: ['press', 'attack'], 45: ['release', 'attack'], 90: ['press', 'guard'], 200: ['release', 'guard'], 230: ['press', 'attack'], 330: ['release', 'attack'] };
        for (let t = 0; t < 600; t++) {
            if (script[t]) W.command(sim, { type: script[t][0], button: script[t][1] });
            W.step(sim, 0.01);
        }
        const { terrain, rigs, events, ...rest } = sim;
        return JSON.stringify(rest);
    };
    assert.equal(play(), play());
});

test('a fight survives a JSON round trip mid-swing and plays on the same (PVP snapshots)', () => {
    const sim = setup({ near: true }); sim.dummy.wait = 0.2;
    tap(sim); step(sim, 0.13); press(sim, 'attack');
    const copy = W.restore(W.create(), JSON.parse(JSON.stringify(W.snapshot(sim))));
    for (const s of [sim, copy]) { step(s, 0.6); release(s, 'attack'); step(s, 1.5); }
    assert.equal(JSON.stringify(W.snapshot(copy)), JSON.stringify(W.snapshot(sim)));
    assert.ok(sim.stats.hits >= 2);
});
