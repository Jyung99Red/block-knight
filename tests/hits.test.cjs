// Bone hit tests (design.md 4.3): only a weapon box in its
// swing hits, body boxes follow the model, weapon boxes grow by
// combat.weaponPad, and a fast swing is sampled finely enough to hit a thin
// target. Every move of every weapon type must land on a standard target at
// its type's standard distance, and keep the horizontal sweep it was
// designed with.
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
const degrees = r => r * 180 / Math.PI;
// Where the blade tip points, horizontally, relative to facing: + is the attacker's left.
function tipAngles(move) {
    const rig = rigOf(MOVES[move].weapon), blade = rig.parts.findIndex(p => p.kind === 'weapon'), half = rig.parts[blade].size[2] / 2, out = [];
    for (let k = 0; k <= 40; k++) {
        const s = R.solve(rig, playerAnim.pose(rig, { ...still, act: { move, phase: 'swing', t: k / 40 * MOVES[move].swing, from: null } }));
        const tip = M.transformPoint(s.parts[blade], [0, 0, half]);
        out.push({ angle: Math.atan2(tip[0], tip[2]), height: tip[1], ahead: tip[2] });
    }
    // Unwrap so a sweep through the back is one continuous range.
    for (let k = 1; k < out.length; k++) out[k].angle = out[k - 1].angle + space.wrapAngle(out[k].angle - out[k - 1].angle);
    return out;
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

test('the dagger\'s cuts keep their shapes: tight arcs, a half-turn whirl, a straight drop', () => {
    const designed = { cut: 98, recut: 111, stab: 28, whirl: 190, flick: 111, lunge: 19, retreat: 109 };
    for (const [move, arc] of Object.entries(designed)) {
        const a = tipAngles(move).map(x => x.angle), sweep = degrees(Math.max(...a) - Math.min(...a));
        assert.ok(Math.abs(sweep - arc) <= 15, `${move} sweeps ${sweep.toFixed(0)} degrees, designed ${arc}`);
    }
    // Cut goes high right to low left; flick low left to high right; the drop comes straight down.
    const cut = tipAngles('cut'), flick = tipAngles('flick'), drop = tipAngles('drop');
    assert.ok(cut[0].angle < 0 && cut[0].height > 1.4 && cut.at(-1).angle > 0 && cut.at(-1).height < 0.7, 'cut: high right to low left');
    assert.ok(flick[0].angle > 0 && flick[0].height < 0.8 && flick.at(-1).angle < 0 && flick.at(-1).height > 1.8, 'flick: low left to high right');
    assert.ok(drop[0].height > 2.2 && drop.at(-1).height < 0.3, 'drop: from overhead to the ground');
});

test('the sword\'s cuts keep their sweeps; the A A A on the diagonal, the charged cut low and wide (user, 2026-10-03)', () => {
    // Blade tip sweep, degrees. Slash, backslash, smite and follow as the
    // user set their keys in the move tuner (2026-10-04): the slash from
    // further back on the right, the backslash ending at the shoulder, not
    // over the head; the follow starting with the wrist turned, the blade
    // out to the left. The smite comes down in front, like the cleave (the
    // user's keys, 2026-10-09).
    const designed = { slash: 168, backslash: 143, smite: 147, follow: 127, charged: 222, thrust: 25 };
    for (const [move, arc] of Object.entries(designed)) {
        const a = tipAngles(move).map(x => x.angle), sweep = degrees(Math.max(...a) - Math.min(...a));
        assert.ok(Math.abs(sweep - arc) <= 15, `${move} sweeps ${sweep.toFixed(0)} degrees, designed ${arc}`);
    }
    // Slash, smite and charged go right to left; backslash and follow left to right.
    for (const move of ['slash', 'smite', 'charged']) { const a = tipAngles(move); assert.ok(a.at(-1).angle > a[0].angle, `${move} goes right to left`); }
    for (const move of ['backslash', 'follow']) { const a = tipAngles(move); assert.ok(a.at(-1).angle < a[0].angle, `${move} goes left to right`); }
    // The A A A: high right down to low left, back up to the right at shoulder height, then down in front from the blade raised back over the shoulder.
    const slash = tipAngles('slash'), back = tipAngles('backslash'), smite = tipAngles('smite'), charged = tipAngles('charged');
    assert.ok(slash[0].angle < 0 && slash[0].height > 1.8 && slash.at(-1).angle > 0 && slash.at(-1).height < 0.8, 'slash: high right to low left');
    assert.ok(back[0].angle > 0 && back[0].height < 0.8 && back.at(-1).angle < 0 && back.at(-1).height > 1.4, 'backslash: low left back up to the right');
    assert.ok(smite[0].height > 1.8 && smite[0].ahead < 0 && smite[0].angle < 0 && Math.abs(smite.at(-1).angle) < 0.3 && smite.at(-1).height < 0.8, 'smite: from the blade raised back over the right shoulder down to low in front');
    // The charged cut starts with the blade laid back and crosses the front low, like a scythe.
    assert.ok(charged[0].ahead < -1 && Math.abs(charged[0].angle) > 2, 'charged: the blade starts behind');
    const across = charged.filter(x => Math.abs(x.angle) < 0.3 && x.ahead > 0);
    assert.ok(across.length && across.every(x => x.height < 0.9), 'and sweeps across the front below the waist');
});

test('the smite, coming down from behind the shoulder, covers the front and the right (user, 2026-10-09); the charged cut from the left round to the right side', () => {
    const covered = move => { const out = []; for (let deg = -180; deg < 180; deg += 10) if (lands(move, target('post', STANDARD, deg * Math.PI / 180))) out.push(deg); return out; };
    const smite = covered('smite'), charged = covered('charged');
    // Posts at the standard distance, + on the right (simulation y).
    for (let deg = -10; deg <= 40; deg += 10) assert.ok(smite.includes(deg), `smite misses a post at ${deg}`);
    assert.ok(smite.includes(70) && !smite.some(d => d <= -40), `smite: the right side, not the left: ${smite}`);
    for (let deg = -60; deg <= 90; deg += 10) assert.ok(charged.includes(deg), `charged misses a post at ${deg}`);
});

test('the rising cut goes low-left to high-right, the cleave high-right to low-left', () => {
    const rising = tipAngles('rising'), cleave = tipAngles('cleave');
    assert.ok(rising[0].angle > 0 && rising[0].height < 0.6, 'rising starts low on the left');
    assert.ok(rising.at(-1).angle < 0 && rising.at(-1).height > 1.6, 'and ends high on the right');
    assert.ok(cleave[0].angle < 0 && cleave[0].height > 1.6, 'cleave starts high on the right');
    assert.ok(cleave.at(-1).angle > 0 && cleave.at(-1).height < 0.8, 'and ends low on the left');
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
