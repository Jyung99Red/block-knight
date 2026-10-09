// Bone hit tests (design.md 4.3): only a weapon box in its
// swing hits, body boxes follow the model, weapon boxes grow by
// combat.weaponPad, and a fast swing is sampled finely enough to hit a thin
// target. Every move of every weapon type must land on a standard target at
// its type's standard distance. A move's shape is the user's to tune and
// judge (AGENTS.md): no test holds it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { rigKit: R, math3d: M, playerAnim, combatKit, space, gameConfig, playerModel, equipmentModels, dummyKit, worldSim: W } = g;
const MOVES = gameConfig.combo.moves, WEAPONS = gameConfig.combo.weapons, U = gameConfig.world.unitsPerBlock;
// Centre to centre, about a block and a half: the distance a sword fight is held at.
const STANDARD = WEAPONS.sword.standard;
const movesOf = type => Object.keys(MOVES).filter(id => MOVES[id].weapon === type);

const player = R.build(playerModel, { equipment: equipmentModels.forLoadout(gameConfig.gear.starter) });
const daggerRig = R.build(playerModel, { equipment: equipmentModels.forLoadout({ ...gameConfig.gear.starter, main: 'assassin_dagger' }) });
const rigOf = type => type === 'dagger' ? daggerRig : player;
const dummy = dummyKit.rig();
const still = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0 };
// The attacker at the origin facing +x (simulation facing 0), at swing
// progress u, holding its move's weapon.
const swingAt = (move, u) => { const rig = rigOf(MOVES[move].weapon); return R.solve(rig, playerAnim.pose(rig, { ...still, act: { move, phase: 'swing', t: u * MOVES[move].swing, from: null } }), [0, 0, 0], space.yawOf(0)); };
// A target standing `dist` away at `angle` from the attacker's facing, facing back.
function target(kind, dist, angle = 0) {
    const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist, yaw = space.yawOf(Math.atan2(-y, -x)), at = space.toBlocks(x, y, 0);
    if (kind === 'dummy') return combatKit.hurtboxes(dummy, R.solve(dummy, dummyKit.pose({ phase: 'idle', t: 0, move: 0, flinch: 0 }), at, yaw));
    if (kind === 'player') return combatKit.hurtboxes(player, R.solve(player, playerAnim.pose(player, still), at, yaw));
    // A thin post two blocks tall: measures where the blade goes, not how wide the target is.
    return [M.obb(M.compose(at[0], 1, at[2], 0, 0, 0), [0.05, 1, 0.05])];
}
// Swing in simulation-sized steps; true if the target is touched.
function lands(move, boxes, stepSeconds = 0.01) {
    const n = Math.ceil(MOVES[move].swing / stepSeconds);
    for (let i = 0; i < n; i++) if (combatKit.sweep(rigOf(MOVES[move].weapon), u => swingAt(move, u), i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
    return false;
}
test('every move lands on a standard target at its weapon\'s standard distance, the dummy and a person alike', () => {
    for (const [type, w] of Object.entries(WEAPONS)) {
        assert.ok(movesOf(type).length >= 8, `${type} has a move tree of its own`);
        for (const move of movesOf(type)) {
            for (const kind of ['dummy', 'player']) assert.ok(lands(move, target(kind, w.standard)), `${move} misses a ${kind} at ${w.standard}`);
            assert.ok(!lands(move, target('dummy', 140)), `${move} reaches far beyond its range`);
        }
    }
});

test('only the swing hits: a blade resting on the target through the windup does not', () => {
    // In a real fight, find where to stand so that the slash's windup pose
    // already has the blade in the dummy as it stands there.
    const sim = W.create(), dm = sim.dummy, p = sim.player, pad = gameConfig.combat.weaponPad / U;
    dm.wait = 1e9; p.facing = 0;
    const dummyBoxes = combatKit.hurtboxes(sim.rigs.dummy, dummyKit.solve(sim));
    const windupEnd = (x, y) => combatKit.weaponBoxes(player, R.solve(player, playerAnim.pose(player, { ...still, act: { move: 'slash', phase: 'windup', t: MOVES.slash.windup, from: null } }), space.toBlocks(x, y, 0), space.yawOf(0)), pad);
    let spot = null;
    for (let dx = -80; dx <= 0 && !spot; dx += 4) for (let dy = -80; dy <= 80 && !spot; dy += 4) {
        const x = dm.x + dx, y = dm.y + dy;
        if (Math.hypot(dx, dy) > dm.radius + p.radius && windupEnd(x, y).some(w => dummyBoxes.some(b => M.overlap(w, b)))) spot = { x, y };
    }
    assert.ok(spot, 'some spot has the windup blade in the dummy');
    p.x = spot.x; p.y = spot.y;
    W.command(sim, { type: 'press', button: 'attack' }); W.command(sim, { type: 'release', button: 'attack' });
    for (let i = 0; i < Math.round(MOVES.slash.windup / 0.01); i++) W.step(sim, 0.01);
    assert.equal(sim.stats.hits, 0, 'nothing during the windup, though the blade is in the dummy');
    assert.equal(sim.player.act.phase, 'swing');
    W.step(sim, 0.01);
    assert.equal(sim.stats.hits, 1, 'and the first swing step lands');
});

test('weapon boxes grow by weaponPad for hits; body boxes are exactly what is drawn', () => {
    const s = swingAt('slash', 0.5), pad = gameConfig.combat.weaponPad / U;
    const drawn = R.boxes(player, s, ['weapon'])[0].box, grown = combatKit.weaponBoxes(player, s, pad)[0];
    drawn.h.forEach((h, i) => assert.ok(Math.abs(grown.h[i] - h - pad) < 1e-12));
    assert.ok(Math.abs(pad - 0.2) < 1e-9, 'about 0.2 blocks (design.md 4.3)');
    const body = combatKit.hurtboxes(player, s);
    const parts = player.parts.filter(p => p.kind === 'body');
    body.forEach((b, i) => b.h.forEach((h, k) => assert.ok(Math.abs(h - parts[i].size[k] / 2) < 1e-12)));
});

test('a fast swing sampled in one coarse step still cannot pass a thin post', () => {
    // The charged cut's whole swing in a single call, against a post
    // straight ahead: the blade starts behind and ends on the left.
    const post = target('post', STANDARD, 0);
    assert.ok(combatKit.sweep(player, u => swingAt('charged', u), 0, 1, [{ id: 't', boxes: post }]), 'sub-steps catch it');
});

test('the dummy reaches the player at the standard distance, and only in front', () => {
    const D = gameConfig.dummy;
    const hitsPlayer = (i, dist, angle) => {
        const mv = D.moves[i], boxes = target('player', dist, angle);
        const at = u => R.solve(dummy, dummyKit.pose({ phase: 'swing', t: u * mv.swing, move: i, flinch: 0 }), [0, 0, 0], space.yawOf(0));
        return !!combatKit.sweep(dummy, at, 0, 1, [{ id: 'p', boxes }]);
    };
    D.moves.forEach((mv, i) => {
        assert.ok(hitsPlayer(i, STANDARD, 0), `${mv.id} reaches a player in front`);
        assert.ok(!hitsPlayer(i, STANDARD, Math.PI), `${mv.id} does not reach behind`);
    });
});
