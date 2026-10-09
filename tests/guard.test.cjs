// The guard key -- with the shield, or the weapon without one -- and the
// guard bar (design.md 4.5), carried over from the 2D version
// and played against the training dummy's real attacks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load(), { worldSim: W, gameConfig, inventoryKit } = g;
const G = gameConfig.combat.guardBar, GU = gameConfig.combat.guard, D = gameConfig.dummy, F = gameConfig.combat;
// The player's stats: the base plus the starter gear (core/inventory.js).
const S = inventoryKit.statsOf(inventoryKit.starter());

// Player 60 units in front of the dummy, facing it; the dummy swipes at once.
// `turned`: how far (radians) the player faces away from it.
function setup({ facingAway = false, turned = 0, loadout } = {}) {
    const sim = W.create(loadout ? { loadout } : {}), d = sim.dummy;
    sim.player.x = d.x - 60; sim.player.y = d.y; sim.player.facing = facingAway ? Math.PI : turned;
    d.wait = 0;
    return sim;
}
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
// The attack key: a tap is an A.
const tap = sim => { press(sim, 'attack'); release(sim, 'attack'); };
// When the dummy's first swipe lands on an unguarded player.
const impactTime = (() => {
    const sim = setup();
    for (let i = 0; i < 400; i++) { W.step(sim, 0.01); if (sim.stats.hurt) return sim.time; }
    throw new Error('the dummy never reached the player');
})();
const swipeRaw = D.atk * D.moves[0].ratio, cost = (parry, by = GU.shield) => swipeRaw / S.maxHp * by.blockCostScale * G.max * (parry ? G.parryCostRatio : 1);
// Run to `t`, raise the shield then, and run through the impact.
function guardAt(sim, t) {
    step(sim, t - sim.time); press(sim, 'guard');
    step(sim, impactTime + 0.05 - sim.time);
    return sim;
}

test('the dummy attacks in reach, its swipe lands during its swing, and an unguarded hit stuns', () => {
    // setup() has the dummy start at once, so the hit falls inside its first swing.
    assert.ok(impactTime > D.moves[0].windup && impactTime <= D.moves[0].windup + D.moves[0].swing + 0.011, `hit at ${impactTime}`);
    const sim = setup();
    while (sim.time < impactTime - 0.015) W.step(sim, 0.01);
    const hp = sim.player.hp;
    step(sim, 0.02);
    assert.equal(sim.player.hp, hp - Math.max(1, Math.round(swipeRaw * (1 - S.def / (S.def + F.damage.defenseConstant)))));
    assert.ok(sim.player.stun > 0 && sim.player.act === null && sim.player.chain === null, 'a hit stuns and ends the combo');
    // An A pressed during the stun runs once it is over.
    tap(sim); assert.equal(sim.player.act, null);
    step(sim, F.hitStun + 0.05); assert.equal(sim.player.act?.move, 'slash');
    // Out of reach, the dummy does not even start.
    const far = setup(); far.player.x -= D.engageRange; step(far, 2);
    assert.equal(far.dummy.phase, 'idle');
});

test('raising costs a little, holding drains, a block costs more than a parry of the same hit', () => {
    const sim = setup(); sim.dummy.wait = 1e9; press(sim, 'guard');
    assert.equal(sim.player.guard.bar, G.max - G.raiseCost);
    step(sim, 0.5); assert.ok(Math.abs(sim.player.guard.bar - (G.max - G.raiseCost - G.holdDrain * 0.5)) < 1e-6);
    // Raised long before: a block.
    const block = guardAt(setup(), impactTime - 0.8);
    assert.equal(block.stats.blocks, 1); assert.equal(block.stats.parries, 0);
    assert.ok(Math.abs(G.max - block.player.guard.bar - G.raiseCost - G.holdDrain * (block.time - (impactTime - 0.8)) - cost(false)) < 0.2);
    // Up just before the hit: a perfect parry, which costs half and hits back.
    const parry = guardAt(setup(), impactTime - GU.startup - 0.05);
    assert.equal(parry.stats.parries, 1);
    assert.ok(Math.abs(G.max - parry.player.guard.bar - G.raiseCost - G.holdDrain * (parry.time - (impactTime - GU.startup - 0.05)) - cost(true)) < 0.2);
    assert.ok(parry.dummy.hp < parry.dummy.maxHp, 'the parry hits back');
    assert.equal(parry.dummy.stagger, F.stagger.parry);
    // The bar refills only with the shield down.
    release(parry, 'guard'); const low = parry.player.guard.bar; step(parry, 0.3);
    assert.ok(Math.abs(parry.player.guard.bar - low - G.max / G.refillSeconds * 0.3) < 1e-6);
});

test('a blocked hit does a share of the damage and no stun; from behind the shield does nothing', () => {
    const block = guardAt(setup(), impactTime - 0.8);
    assert.ok(block.player.hp < block.player.maxHp && block.player.maxHp - block.player.hp <= Math.ceil(swipeRaw * GU.shield.blockMultiplier));
    assert.equal(block.player.stun, 0);
    const behind = guardAt(setup({ facingAway: true }), impactTime - 0.8);
    assert.equal(behind.stats.blocks, 0); assert.equal(behind.stats.hurt, 1);
    assert.ok(behind.player.stun > 0);
});

test('the guard covers an arc in front of the body: a blow from inside it is blocked, from outside it hurts', () => {
    const edge = GU.frontAngle * 180 / Math.PI;
    for (const [deg, blocks] of [[0, 1], [edge - 5, 1], [5 - edge, 1], [edge + 5, 0], [-edge - 5, 0], [180, 0]]) {
        const sim = guardAt(setup({ turned: deg * Math.PI / 180 }), impactTime - 0.8);
        assert.deepEqual([sim.stats.blocks, sim.stats.hurt], [blocks, 1 - blocks], `the blow comes from ${deg} degrees off the front`);
    }
});

test('an empty bar drops the shield and locks it until the bar is back to the unlock ratio', () => {
    const sim = setup(); sim.dummy.wait = 1e9; sim.player.guard.bar = 15; press(sim, 'guard');
    for (let i = 0; i < 100 && !sim.player.guard.locked; i++) W.step(sim, 0.01);
    assert.ok(Math.abs(sim.time - (15 - G.raiseCost) / G.holdDrain) < 0.011, 'the hold drains the last 5 points in 0.5 s');
    assert.equal(sim.player.guard.state, 'down');
    assert.ok(W.drain(sim).some(e => e.type === 'guard_broken'));
    release(sim, 'guard'); press(sim, 'guard');
    assert.equal(sim.player.guard.state, 'down', 'locked: no shield, so no parry either');
    release(sim, 'guard');
    step(sim, G.refillSeconds * G.unlockRatio - 0.05); assert.equal(sim.player.guard.locked, true);
    step(sim, 0.06); assert.equal(sim.player.guard.locked, false);
    press(sim, 'guard'); assert.equal(sim.player.guard.state, 'raising');
    // The block that empties the bar still counts as a block.
    const last = setup(); step(last, impactTime - 0.8); press(last, 'guard'); step(last, 0.6); last.player.guard.bar = 5;
    step(last, impactTime + 0.05 - last.time);
    assert.equal(last.stats.blocks, 1); assert.equal(last.player.guard.locked, true); assert.equal(last.player.stun, 0);
});

test('a move plays out whole before the shield goes up; a charge is dropped at once', () => {
    // User, 2026-10-01: the shield no longer cuts a recovery. The dummy is
    // moved off so no hitstop shifts the times.
    const quiet = () => { const s = setup(); s.dummy.wait = 1e9; s.dummy.x += 400; return s; };
    const M = gameConfig.combo.moves;
    for (const at of [0.05, 0.15, 0.25]) { // windup, swing, recovery
        const sim = quiet(); tap(sim); step(sim, at);
        press(sim, 'guard'); assert.equal(sim.player.guard.queued, true); assert.notEqual(sim.player.act, null);
        let upAt = null;
        for (let i = 0; i < 100 && upAt == null; i++) { W.step(sim, 0.01); if (sim.player.guard.state !== 'down') upAt = sim.time; }
        assert.ok(Math.abs(upAt - (M.slash.windup + M.slash.swing + M.slash.recovery)) < 0.011, `pressed at ${at}: up at ${upAt}, when the recovery ends`);
        assert.equal(sim.player.act, null); assert.equal(sim.player.chain, null); assert.equal(sim.stats.attacks, 1);
    }
    // A or B pressed while the shield waits do nothing, so the move cannot chain on.
    const waiting = quiet(); tap(waiting); step(waiting, 0.15);
    press(waiting, 'guard'); tap(waiting); step(waiting, 0.6);
    assert.equal(waiting.stats.attacks, 1); assert.notEqual(waiting.player.guard.state, 'down');
    // Let go before the move ends: nothing goes up.
    const changed = quiet(); tap(changed); step(changed, 0.15);
    press(changed, 'guard'); step(changed, 0.1); release(changed, 'guard'); step(changed, 0.5);
    assert.equal(changed.player.guard.state, 'down'); assert.equal(changed.player.guard.bar, G.max);
    // Pressed in the charged windup with B still held, it drops the charge when the windup ends.
    const told = gameConfig.combo.holdSeconds + 0.05;
    const held = quiet(); press(held, 'attack'); step(held, told); press(held, 'guard');
    assert.equal(held.player.act?.move, 'charged');
    step(held, gameConfig.combo.moves.charged.windup - told + 0.02);
    assert.equal(held.player.act, null); assert.equal(held.player.guard.state, 'raising');
    release(held, 'attack'); step(held, 0.5); assert.equal(held.stats.attacks, 1, 'the charge never cut');
    const charge = quiet(); press(charge, 'attack'); step(charge, 0.6); assert.equal(charge.player.act.phase, 'charge');
    press(charge, 'guard'); release(charge, 'attack'); step(charge, 1);
    assert.equal(charge.player.act, null); assert.equal(charge.stats.attacks, 1, 'the charge is dropped, not fired');
});

test('with the guard up A and B do nothing', () => {
    const sim = setup(); sim.dummy.wait = 1e9; press(sim, 'guard'); step(sim, 0.3);
    tap(sim); press(sim, 'attack'); step(sim, 0.5); release(sim, 'attack');
    assert.equal(sim.stats.attacks, 0);
    release(sim, 'guard'); tap(sim); assert.equal(sim.player.act.move, 'slash');
});

test('without a shield the weapon guards, weaker: more damage and guard bar per block, a shorter parry window (user, 2026-10-03)', () => {
    assert.ok(GU.weapon.blockMultiplier > GU.shield.blockMultiplier && GU.weapon.blockCostScale > GU.shield.blockCostScale && GU.weapon.parryWindow < GU.shield.parryWindow);
    for (const offhand of [null, 'torch', 'potion']) {
        const loadout = { ...gameConfig.gear.starter, offhand }, sim = setup({ loadout }), p = sim.player;
        assert.equal(g.combatKit.guardOf(p), 'weapon', String(offhand));
        const raisedAt = impactTime - 0.8;
        guardAt(sim, raisedAt);
        assert.equal(sim.stats.blocks, 1, `${offhand}: the blade blocks`); assert.equal(p.stun, 0);
        const statsOf = inventoryKit.statsOf(loadout);
        const taken = Math.round(Math.max(1, Math.round(swipeRaw * (1 - statsOf.def / (statsOf.def + F.damage.defenseConstant)))) * GU.weapon.blockMultiplier);
        assert.equal(p.maxHp - p.hp, taken);
        const spent = G.max - p.guard.bar - G.raiseCost - G.holdDrain * (sim.time - raisedAt), want = swipeRaw / p.maxHp * GU.weapon.blockCostScale * G.max;
        assert.ok(Math.abs(spent - want) < 0.2, `${spent} vs ${want}`);
    }
    // A hit midway between the two windows after the guard is up: the
    // shield parries it, the blade only blocks it.
    const mid = (GU.weapon.parryWindow + GU.shield.parryWindow) / 2;
    const shield = guardAt(setup(), impactTime - GU.startup - mid), blade = guardAt(setup({ loadout: { ...gameConfig.gear.starter, offhand: null } }), impactTime - GU.startup - mid);
    assert.equal(shield.stats.parries, 1);
    assert.equal(blade.stats.parries, 0); assert.equal(blade.stats.blocks, 1);
});

test('a perfect parry shoves the guarding arm forward once the hitstop is over, and back again; a block does not; nothing waits for it (user, 2026-10-05)', () => {
    const V = GU.shove, near = (a, b) => Math.abs(a - b) < 1e-6;
    // Quick out, slow back (user): three tenths of the time going out, seven coming back; no holding
    // out there and no going past the pose (user, 2026-10-06).
    assert.ok(Math.abs(V.out / (V.out + V.back) - 0.3) < 0.01 && V.stay === undefined && V.over === undefined);
    const parried = () => {
        const sim = setup(); step(sim, impactTime - GU.startup - 0.05 - sim.time); press(sim, 'guard');
        for (let i = 0; i < 200 && !sim.stats.parries; i++) W.step(sim, 0.01);
        assert.equal(sim.stats.parries, 1);
        return sim;
    };
    const sim = parried(), p = sim.player;
    // Inside the hitstop the guard gives, driven back by the blow (user, 2026-10-05), and does not go out;
    // then out, kept there, and back, the guard up all the while.
    assert.ok(p.freeze > 0 && p.shoveOut === 0 && near(p.shoveFor, V.in + V.out));
    assert.ok(V.in > 0 && V.in <= F.impact.hitstop.parry && V.give > 0 && V.give <= 0.5);
    step(sim, V.in / 2); assert.ok(p.freeze > 0 && near(p.shoveFor, V.in / 2 + V.out), 'giving');
    step(sim, F.impact.hitstop.parry - V.in / 2); assert.ok(p.shoveOut === 0 && near(p.shoveFor, V.out), 'given, not out yet');
    step(sim, 0.02); assert.ok(near(p.shoveOut, 0.02 / V.out), `on its way out: ${p.shoveOut}`);
    step(sim, V.out - 0.02); assert.ok(near(p.shoveOut, 1));
    step(sim, 0.1); assert.ok(near(p.shoveOut, 1 - 0.1 / V.back), `straight on its way back: ${p.shoveOut}`);
    step(sim, V.back - 0.1); assert.ok(near(p.shoveOut, 0));
    assert.equal(p.guard.state, 'up');
    // A block is no parry: no shove.
    const block = guardAt(setup(), impactTime - 0.8);
    assert.equal(block.stats.blocks, 1); assert.deepEqual([block.player.shoveOut, block.player.shoveFor], [0, 0]);
    // With the arm right out, the guard is let go and an A pressed: the cut starts at once and the arm is on its way back.
    const cut = parried(), q = cut.player;
    step(cut, F.impact.hitstop.parry + V.out); assert.ok(near(q.shoveOut, 1));
    release(cut, 'guard'); tap(cut);
    assert.equal(q.act?.move, 'slash');
    step(cut, 0.01); assert.ok(q.shoveFor === 0 && q.shoveOut < 1);
    // (The cut lands on the dummy meanwhile, and its hitstop holds the arm too.)
    step(cut, V.back + F.impact.hitstop.hit); assert.ok(near(q.shoveOut, 0));
    assert.equal(q.act.move, 'slash'); assert.equal(cut.stats.hits, 1);
});

test('training is deathless: a fall refills the player', () => {
    const sim = setup(); sim.player.hp = 1;
    step(sim, impactTime + 0.05);
    assert.equal(sim.player.hp, sim.player.maxHp);
    assert.ok(W.drain(sim).some(e => e.type === 'refilled' && e.side === 'player'));
});

test('an A pressed during the hitstop of a block runs once the hitstop is over', () => {
    const sim = setup(); step(sim, impactTime - 0.8); press(sim, 'guard');
    for (let i = 0; i < 200 && !sim.stats.blocks; i++) W.step(sim, 0.01);
    assert.ok(sim.player.freeze > 0, 'held by the block');
    release(sim, 'guard'); tap(sim);
    step(sim, 0.1);
    assert.equal(sim.stats.attacks, 1); assert.equal(sim.player.act?.move, 'slash');
});
