const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { math3d: M, rigKit: R, playerModel, playerAnim, equipmentModels, space, gameConfig, worldSim: W } = g;

const equipment = equipmentModels.forLoadout(gameConfig.gear.starter);
const rig = R.build(playerModel, { equipment });
const half = part => part.size.map(v => v / 2);
const cornersOf = (solved, i) => M.corners(M.obb(solved.parts[i], half(rig.parts[i])));
const find = (fn) => rig.parts.findIndex(fn);
const top = solved => Math.max(...rig.parts.map((_, i) => Math.max(...cornersOf(solved, i).map(c => c[1]))));
const lowestBody = solved => R.lowest(rig, solved);
// Objects made inside the vm have their own prototypes; compare as data.
const plain = value => JSON.parse(JSON.stringify(value));

test('the main character has the 14 bones of design.md 2.1', () => {
    const names = rig.bones.map(b => b.name);
    assert.deepEqual(plain(names.sort()), ['base', 'chest', 'forearmL', 'forearmR', 'handL', 'handR', 'head', 'pelvis', 'shinL', 'shinR', 'thighL', 'thighR', 'upperArmL', 'upperArmR'].sort());
    const parent = name => { const b = rig.bones[rig.index[name]]; return b.parent < 0 ? null : rig.bones[b.parent].name; };
    assert.equal(parent('base'), null);
    assert.equal(parent('pelvis'), 'base');
    assert.equal(parent('chest'), 'pelvis');
    assert.equal(parent('head'), 'chest');
    for (const s of ['R', 'L']) {
        assert.equal(parent(`upperArm${s}`), 'chest');
        assert.equal(parent(`forearm${s}`), `upperArm${s}`);
        assert.equal(parent(`hand${s}`), `forearm${s}`);
        assert.equal(parent(`thigh${s}`), 'pelvis');
        assert.equal(parent(`shin${s}`), `thigh${s}`);
    }
    // Mount points are points on bones, not bones.
    for (const mount of ['handR', 'handL', 'back', 'waist', 'head']) assert.ok(playerModel.mounts[mount]);
    // The animation layers split the skeleton cleanly.
    const layered = [...playerModel.layers.lower, ...playerModel.layers.upper];
    assert.deepEqual([...layered].sort(), [...rig.bones.map(b => b.name)].sort());
    assert.equal(new Set(layered).size, layered.length);
});

test('scale follows the prototype: about 1.9 blocks tall, standing on the ground', () => {
    const solved = R.solve(rig, playerAnim.pose(rig, { gait: 0, moveBlend: 0 }));
    const head = find(p => p.kind === 'body' && rig.bones[p.bone].name === 'head');
    const headTop = Math.max(...cornersOf(solved, head).map(c => c[1]));
    assert.ok(headTop > 1.8 && headTop < 1.95, `head top ${headTop}`);
    assert.ok(top(solved) < 2.05, `overall ${top(solved)}`);
    assert.ok(Math.abs(lowestBody(solved)) < 1e-9);
    const big = R.build(playerModel, { scale: 2, equipment });
    const bigSolved = R.solve(big, playerAnim.pose(big, { gait: 0, moveBlend: 0 }));
    const bigTop = Math.max(...big.parts.map((p, i) => Math.max(...M.corners(M.obb(bigSolved.parts[i], p.size.map(v => v / 2))).map(c => c[1]))));
    assert.ok(Math.abs(bigTop - 2 * top(solved)) < 1e-6, 'scale multiplies every size');
});

test('the model faces +z with its right hand on -x; facing maps to yaw in one place', () => {
    const pose = playerAnim.pose(rig, { gait: 0, moveBlend: 0 });
    const eye = find(p => p.color === 'eye'), handR = rig.index.handR, handL = rig.index.handL;
    const rest = R.solve(rig, pose);
    assert.ok(rest.parts[eye][14] > 0.2, 'eyes on the +z face');
    assert.ok(rest.bones[handR][12] < 0 && rest.bones[handL][12] > 0);
    // Facing east (theta = 0, +x on screen): the face points along +x.
    for (const [facing, axis, sign] of [[0, 12, 1], [Math.PI / 2, 14, 1], [Math.PI, 12, -1], [-Math.PI / 2, 14, -1]]) {
        const s = R.solve(rig, pose, [10, 0, 5], space.yawOf(facing)), origin = axis === 12 ? 10 : 5;
        assert.ok(sign * (s.parts[eye][axis] - origin) > 0.2, `facing ${facing}`);
    }
    const [x, h, z] = space.toBlocks(400, 120, 40);
    assert.deepEqual([x, h, z], [10, 1, 3]);
});

test('hurtboxes are the body only: not deco, not the sword, not the shield', () => {
    const solved = R.solve(rig, playerAnim.pose(rig, { gait: 0, moveBlend: 0 }));
    const hurt = R.boxes(rig, solved, ['body']).map(b => rig.parts[b.part]);
    assert.ok(hurt.length >= 15);
    assert.ok(hurt.every(p => p.kind === 'body' && p.owner === 'body'));
    const bones = new Set(hurt.map(p => rig.bones[p.bone].name));
    for (const b of ['head', 'chest', 'upperArmR', 'forearmL', 'handR', 'thighL', 'shinR']) assert.ok(bones.has(b), `${b} can be hit`);
    const weapons = R.boxes(rig, solved, ['weapon']);
    assert.equal(weapons.length, 1);
    assert.equal(rig.parts[weapons[0].part].size[2], gameConfig.items.wooden_sword.blade);
    assert.equal(R.boxes(rig, solved, ['shield']).length, 1);
});

test('sparse poses: unnamed bones stay at rest; mirror, mix and add', () => {
    const rest = R.solve(rig, {}), nudged = R.solve(rig, { thighR: { rx: 0.5 } });
    for (const name of ['head', 'handR', 'thighL', 'shinL']) assert.deepEqual(Array.from(nudged.bones[rig.index[name]]), Array.from(rest.bones[rig.index[name]]));
    assert.notDeepEqual(Array.from(nudged.bones[rig.index.shinR]), Array.from(rest.bones[rig.index.shinR]));
    assert.deepEqual(plain(R.mirror({ thighR: { rx: 0.3, ry: 0.2, pz: 1 }, chest: { rz: 0.1, px: 0.5 } })), { thighL: { rx: 0.3, ry: -0.2, pz: 1 }, chest: { rz: -0.1, px: -0.5 } });
    assert.deepEqual(plain(R.mix({ a: { rx: 1 } }, { a: { rx: 3 }, b: { ry: 2 } }, 0.5)), { a: { rx: 2 }, b: { ry: 1 } });
    assert.deepEqual(plain(R.add({ a: { rx: 1 } }, { a: { rx: 2, py: 1 } })), { a: { rx: 3, py: 1 } });
    // A mirrored pose solves to the mirror image.
    const pose = { upperArmR: { rx: -0.8, rz: -0.3 }, thighL: { rx: 0.4, ry: 0.2 } };
    const a = R.solve(rig, pose), b = R.solve(rig, R.mirror(pose));
    for (const [l, r] of [['handR', 'handL'], ['shinL', 'shinR']]) {
        const pa = a.bones[rig.index[l]], pb = b.bones[rig.index[r]];
        assert.ok(Math.abs(pa[12] + pb[12]) < 1e-9 && Math.abs(pa[13] - pb[13]) < 1e-9 && Math.abs(pa[14] - pb[14]) < 1e-9);
    }
});

test('walking and running are pure functions of gait phase and blends, feet on the ground (off it in a running stride)', () => {
    const at = (gait, moveBlend = 1, runBlend = 0) => R.solve(rig, playerAnim.pose(rig, { gait, moveBlend, runBlend }));
    // Same state, separately built rig: the same pose. Nothing hidden in
    // the rig or in earlier calls feeds the result.
    const other = R.build(playerModel, { equipment: equipmentModels.forLoadout(gameConfig.gear.starter) });
    at(3 / 7, 1, 1);
    const body = { gait: 0.32, moveBlend: 0.4, runBlend: 0.7 };
    assert.equal(JSON.stringify(playerAnim.pose(other, body)), JSON.stringify(playerAnim.pose(rig, body)));
    assert.notDeepEqual(Array.from(at(0).bones[rig.index.thighR]), Array.from(at(0.25).bones[rig.index.thighR]));
    assert.notDeepEqual(Array.from(at(0.1, 1, 0).bones[rig.index.thighR]), Array.from(at(0.1, 1, 1).bones[rig.index.thighR]));
    // Running is a jog with both feet off the ground between strides (user,
    // 2026-10-02): from the toe-off to the other foot's touchdown the body
    // is up; on the ground otherwise.
    const stance = playerAnim.gaitOf(rig).run.stance;
    for (let i = 0; i <= 40; i++) {
        for (const moveBlend of [0, 0.5, 1]) for (const runBlend of [0, 0.5, 1]) {
            const low = lowestBody(at(i / 40, moveBlend, runBlend)), half = (i / 40) % 0.5;
            const aloft = moveBlend > 0 && runBlend > 0 && half > stance + 1e-9 && half < 0.5 - 1e-9;
            if (aloft) assert.ok(low > -1e-9 && low < 0.15, `phase ${i / 40} blends ${moveBlend}/${runBlend}: off the ground by ${low}`);
            else assert.ok(Math.abs(low) < 1e-9, `phase ${i / 40} blends ${moveBlend}/${runBlend}: lowest body point ${low}`);
        }
    }
    // Mid-flight in a full run, both feet are clear of the ground.
    for (const f of [0.4, 0.9]) assert.ok(lowestBody(at(f, 1, 1)) > 0.03, `phase ${f}: both feet up`);
    // A full cycle returns to the same pose.
    for (const run of [0, 1]) assert.ok(Array.from(at(0, 1, run).parts[3]).every((v, k) => Math.abs(v - at(1, 1, run).parts[3][k]) < 1e-9));
});

test('the stride matches the leg swing: the planted foot stays put, walking or running', () => {
    const P = gameConfig.player, unit = gameConfig.world.unitsPerBlock;
    const foot = find(p => p.tag === 'foot' && rig.bones[p.bone].name === 'shinR');
    // The legs are timed so the planted foot keeps pace while the body goes
    // on evenly; walking takes unhurried steps, running is a jog with fewer
    // steps than before, a hop between strides (user, 2026-10-02). Running,
    // the foot is down only up to the toe-off.
    for (const [runBlend, speed, maxSlide, cadence] of [[0, P.speed, 0.02, [3, 4]], [1, P.runSpeed, 0.02, [4.8, 5.8]]]) {
        const cycle = playerAnim.cycleLength(rig, runBlend), zs = [], stance = playerAnim.gaitOf(rig)[runBlend ? 'run' : 'walk'].stance;
        for (let f = 0; f <= Math.min(0.4, stance) + 1e-9; f += 0.025) {
            const s = R.solve(rig, playerAnim.pose(rig, { gait: f, moveBlend: 1, runBlend }));
            zs.push(s.parts[foot][14] + f * cycle / unit); // body moves forward along +z
        }
        const slide = Math.max(...zs) - Math.min(...zs);
        assert.ok(slide < maxSlide, `run ${runBlend}: planted foot slides ${slide.toFixed(3)} blocks`);
        const stepsPerSecond = 2 * speed / cycle;
        assert.ok(stepsPerSecond > cadence[0] && stepsPerSecond < cadence[1], `run ${runBlend}: ${stepsPerSecond.toFixed(2)} steps a second at full speed`);
    }
    assert.ok(playerAnim.cycleLength(rig, 1) > playerAnim.cycleLength(rig, 0), 'running strides are longer');
});

test('in a move the feet do not slide: each stands where it is or is lifted and stepped; the smite, which takes no step, keeps both where the backslash left them (user, 2026-10-09)', () => {
    // A combo through the simulation (each next key pressed during the
    // swing before), the feet where they are drawn in the world.
    function trace(main, inputs) {
        const sim = W.create({ loadout: { ...gameConfig.gear.starter, main } }), p = sim.player, body = sim.rigs.fighters[p.id];
        sim.dummy.wait = 1e9; sim.dummy.x += 400;
        const feet = ['R', 'L'].map(s => body.parts.findIndex(q => q.tag === 'foot' && body.bones[q.bone].name === `shin${s}`));
        const out = [], left = [...inputs];
        const press = input => {
            W.command(sim, { type: 'press', button: 'attack' });
            if (input === 'b') for (let i = 0; i < 20; i++) W.step(sim, 0.01);
            W.command(sim, { type: 'release', button: 'attack' });
        };
        press(left.shift());
        for (let i = 0; i < 500 && (p.act || left.length); i++) {
            if (left.length && p.act?.phase === 'swing' && !p.buffer) press(left.shift());
            W.step(sim, 0.01);
            const s = R.solve(body, playerAnim.pose(body, p), space.toBlocks(p.x, p.y, p.h), space.yawOf(p.facing));
            out.push({ key: p.act ? `${p.act.phase}:${p.act.move}` : 'idle', feet: feet.map(i => ({ x: s.parts[i][12], z: s.parts[i][14], low: Math.min(...M.corners(M.obb(s.parts[i], half(body.parts[i]))).map(c => c[1])) })) });
        }
        return out;
    }
    const routes = { wooden_sword: ['aaa', 'aab', 'ab', 'ba'], assassin_dagger: ['aaaaa', 'aba', 'ab', 'ba'] };
    for (const [main, list] of Object.entries(routes)) for (const inputs of list) {
        const frames = trace(main, inputs.split('')), slid = {};
        for (let i = 1; i < frames.length; i++) {
            const a = frames[i - 1], b = frames[i];
            // A move started past its windup (a held B) begins as its swing does.
            if (a.key !== b.key) continue;
            [0, 1].forEach(k => {
                if (a.feet[k].low > 0.003 || b.feet[k].low > 0.003) return;
                slid[`${b.key} ${'RL'[k]}`] = (slid[`${b.key} ${'RL'[k]}`] || 0) + Math.hypot(b.feet[k].x - a.feet[k].x, b.feet[k].z - a.feet[k].z);
            });
        }
        // A foot on the ground may trail a swing's short step a little.
        for (const [where, d] of Object.entries(slid)) assert.ok(d < 0.05, `${main} ${inputs}: ${where} slides ${d.toFixed(3)} blocks on the ground`);
        if (main !== 'wooden_sword' || inputs !== 'aaa') continue;
        const smite = frames.filter(f => f.key === 'windup:smite' || f.key === 'swing:smite');
        for (const k of [0, 1]) {
            const xs = smite.map(f => f.feet[k].x), zs = smite.map(f => f.feet[k].z);
            assert.ok(Math.max(...xs) - Math.min(...xs) < 0.005 && Math.max(...zs) - Math.min(...zs) < 0.005, `the smite moves the ${'RL'[k]} foot`);
        }
    }
});

test('walking while charging moves the legs under the held charge', () => {
    const act = { move: 'charged', phase: 'charge', t: 0.3, from: null };
    const at = (gait, moveBlend) => R.solve(rig, playerAnim.pose(rig, { gait, moveBlend, runBlend: 0, act, guardBlend: 0, stun: 0 }));
    const thigh = s => Array.from(s.bones[rig.index.thighR]);
    assert.deepEqual(thigh(at(0, 0)), thigh(at(0.25, 0)), 'standing still, the charge pose holds');
    assert.notDeepEqual(thigh(at(0, 1)), thigh(at(0.25, 1)), 'walking, the legs step');
    // The upper body keeps the charge exactly; only the legs (and hips) walk.
    const upper = (gait, moveBlend) => JSON.stringify(R.pick(playerAnim.pose(rig, { gait, moveBlend, runBlend: 0, act, guardBlend: 0, stun: 0 }), playerModel.layers.upper), (k, v) => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
    for (const g of [0, 0.1, 0.4, 0.7]) assert.equal(upper(g, 1), upper(0, 0), `gait ${g}: arms and chest hold the charge`);
    for (const g of [0, 0.2, 0.5, 0.8]) assert.ok(Math.abs(lowestBody(at(g, 1))) < 1e-9, 'feet on the ground');
});

test('under a guard the knees bend (user, 2026-10-05: a squat, the feet side by side; it was the left foot ahead): standing, both feet down and a little apart, a little lower; walking, still bent, the planted foot still put', () => {
    const unit = gameConfig.world.unitsPerBlock, feet = ['R', 'L'].map(s => find(p => p.tag === 'foot' && rig.bones[p.bone].name === `shin${s}`));
    const pelvisAt = s => s.bones[rig.index.pelvis][13], low = (s, i) => Math.min(...cornersOf(s, i).map(c => c[1]));
    for (const offhand of [gameConfig.gear.starter.offhand, null]) {
        const loadout = { ...gameConfig.gear.starter, offhand }, body = guardBlend => ({ gait: 0, moveBlend: 0, runBlend: 0, guardBlend, stun: 0, loadout });
        const up = R.solve(rig, playerAnim.pose(rig, body(1))), free = R.solve(rig, playerAnim.pose(rig, body(0)));
        // Down to within 0.02 blocks, which is not seen: the legs are the
        // user's numbers from the move tuner (2026-10-05), and the right
        // foot is 0.008 up.
        for (const i of feet) assert.ok(Math.abs(low(up, i)) < 0.02, `${offhand}: both feet on the ground (${low(up, i).toFixed(3)} blocks up)`);
        // The model faces +z, its left is +x: the feet side by side, ahead
        // of the hips, and further apart than standing.
        const [footR, footL] = feet.map(i => up.parts[i]), squat = playerAnim.pose(rig, body(1));
        assert.ok(Math.abs(footL[14] - footR[14]) < 0.05, `${offhand}: the feet side by side`);
        assert.ok(Math.min(footL[14], footR[14]) - up.bones[rig.index.pelvis][14] > 0.1, `${offhand}: the knees forward, the hips back`);
        assert.ok(footL[12] - footR[12] > free.parts[feet[1]][12] - free.parts[feet[0]][12] + 0.02, `${offhand}: the feet a little apart`);
        assert.ok(squat.shinR.rx > 0.3 && squat.shinL.rx > 0.3, `${offhand}: both knees bent`);
        const drop = pelvisAt(free) - pelvisAt(up);
        assert.ok(drop > 0.03 && drop < 0.12, `${offhand}: a little lower (${drop.toFixed(3)} blocks)`);
        // Walking under it: the knees stay bent and the planted foot keeps pace, as walking does.
        const cycle = playerAnim.cycleLength(rig, 0), stance = playerAnim.gaitOf(rig).walk.stance, zs = [];
        for (let f = 0; f <= Math.min(0.4, stance) + 1e-9; f += 0.025) {
            const pose = playerAnim.pose(rig, { ...body(1), gait: f, moveBlend: 1 }), s = R.solve(rig, pose);
            zs.push(s.parts[feet[0]][14] + f * cycle / unit);
            assert.ok(pose.shinR.rx > 0.3 && pose.shinL.rx > 0.3, 'knees bent while walking');
            assert.ok(Math.abs(lowestBody(s)) < 1e-9, 'on the ground');
        }
        assert.ok(Math.max(...zs) - Math.min(...zs) < 0.02, `${offhand}: the planted foot slides ${(Math.max(...zs) - Math.min(...zs)).toFixed(3)} blocks`);
    }
});

test('guarding, the body bends forward at the waist with the head kept up; a parry\'s shove pushes the board, or the blade, forward, upright as it was (user, 2026-10-05)', () => {
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], axis = (m, k) => [m[k * 4], m[k * 4 + 1], m[k * 4 + 2]], at = m => [m[12], m[13], m[14]];
    for (const offhand of [gameConfig.gear.starter.offhand, null]) {
        const loadout = { ...gameConfig.gear.starter, offhand }, body = (guardBlend, shoveOut = 0) => ({ gait: 0, moveBlend: 0, runBlend: 0, guardBlend, shoveOut, stun: 0, loadout });
        const solved = (...state) => R.solve(rig, playerAnim.pose(rig, body(...state)));
        const free = solved(0), up = solved(1), out = solved(1, 1), mid = solved(1, 0.5);
        // The model faces +z: the chest's own up leans that way, the head's less, and the head is further forward than it was.
        const lean = s => axis(s.bones[rig.index.chest], 1)[2], nod = s => axis(s.bones[rig.index.head], 1)[2];
        assert.ok(lean(free) < 0.1 && lean(up) > 0.15 && lean(up) < 0.35, `${offhand}: the chest leans ${lean(up).toFixed(2)}`);
        assert.ok(Math.abs(nod(up)) < lean(up) / 2, `${offhand}: the head is kept up (${nod(up).toFixed(2)})`);
        assert.ok(at(up.bones[rig.index.head])[2] - at(free.bones[rig.index.head])[2] > 0.07);
        // What guards: the shield's board, else the blade.
        const guards = find(p => p.kind === (offhand ? 'shield' : 'weapon')), z = s => at(s.parts[guards])[2];
        assert.ok(z(out) - z(up) > 0.1 && z(out) - z(up) < 0.3, `${offhand}: pushed ${(z(out) - z(up)).toFixed(2)} blocks forward`);
        assert.ok(z(mid) > z(up) && z(mid) < z(out));
        assert.ok(Math.abs(at(out.parts[guards])[1] - at(up.parts[guards])[1]) < 0.03, 'forward, not up or down');
        // The board stays upright (its third axis), and turns square to
        // the front as it goes (the user's numbers, move tuner); the blade
        // keeps its line.
        if (offhand) assert.ok(dot(axis(out.parts[guards], 2), axis(up.parts[guards], 2)) > 0.99, 'the board upright as it was');
        for (const k of [0, 1, 2]) assert.ok(dot(axis(out.parts[guards], k), axis(up.parts[guards], k)) > (offhand ? 0.94 : 0.99), `${offhand}: turned little (axis ${k})`);
        assert.ok(lean(out) > lean(up), 'the body leans in behind it');
        // First it gives (user, 2026-10-05): driven back as the blow is
        // taken; then out from there, fastest at the start, to the pose
        // and no further (user, 2026-10-06).
        const V = gameConfig.combat.guard.shove, going = (level, held) => R.solve(rig, playerAnim.pose(rig, { ...body(1, level), shoveFor: held }));
        const given = z(up) - z(going(0, V.out)), giving = z(up) - z(going(0, V.out + V.in / 2));
        assert.ok(given > 0.03 && given < 0.15, `${offhand}: driven ${given.toFixed(3)} blocks back`);
        assert.ok(giving > 0 && giving < given && Math.abs(z(going(0, V.out + V.in)) - z(up)) < 1e-9);
        assert.ok(z(going(0.5, V.out / 2)) > z(mid) + 0.02, `${offhand}: it snaps out`);
        assert.ok(Math.abs(z(going(1, 1e-12)) - z(out)) < 1e-6, `${offhand}: to the pose and no further`);
        // Part of the guard: with the guard down there is no shove to show.
        assert.deepEqual(plain(playerAnim.pose(rig, body(0, 1))), plain(playerAnim.pose(rig, body(0, 0))));
    }
});

test('interacting puts the left hand a little forward; not in the middle of a move', () => {
    const body = handOut => ({ gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0, handOut, loadout: gameConfig.gear.starter });
    const hand = find(p => p.bone === rig.index.handL), handZ = handOut => R.solve(rig, playerAnim.pose(rig, body(handOut))).parts[hand][14];
    assert.ok(handZ(1) - handZ(0) > 0.1, 'the left hand forward');
    assert.ok(handZ(0.5) > handZ(0) && handZ(0.5) < handZ(1));
    const act = { move: 'slash', phase: 'swing', t: 0.05, from: null };
    assert.deepEqual(plain(playerAnim.pose(rig, { ...body(1), act })), plain(playerAnim.pose(rig, { ...body(0), act })));
});

test('carrying a torch, a move comes out of the carry and goes back to it: the left arm eases back up, it does not jump as the move ends', () => {
    const MOVES = gameConfig.combo.moves;
    for (const main of ['wooden_sword', 'assassin_dagger']) {
        const loadout = { ...gameConfig.gear.starter, main, offhand: 'torch' }, torchRig = R.build(playerModel, { equipment: equipmentModels.forLoadout(loadout) });
        const flame = torchRig.parts.findIndex(p => p.tag === 'flame'), elbow = torchRig.index.forearmL;
        const at = act => { const s = R.solve(torchRig, playerAnim.pose(torchRig, { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0, loadout, act })); return [s.parts[flame], s.bones[elbow]].map(m => [m[12], m[13], m[14]]); };
        const gap = (a, b) => Math.max(...a.map((v, i) => Math.hypot(...v.map((x, k) => x - b[i][k]))));
        const carried = at(null), type = main === 'wooden_sword' ? 'sword' : 'dagger';
        for (const move of Object.keys(MOVES).filter(id => MOVES[id].weapon === type)) {
            const m = MOVES[move], recovering = k => at({ move, phase: 'recover', t: k / 40 * m.recovery, from: null });
            // The recovery's last moment is the carry; the windup's first is too.
            assert.ok(gap(recovering(40), carried) < 1e-9, `${main} ${move}: the recovery ends in the carry`);
            assert.ok(gap(at({ move, phase: 'windup', t: 0, from: null }), carried) < 1e-9, `${main} ${move}: the windup starts from the carry`);
            // On the way back, no step of a fortieth of the recovery is a jump.
            for (let k = 0; k < 40; k++) assert.ok(gap(recovering(k + 1), recovering(k)) < 0.06, `${main} ${move}: the torch arm jumps in the recovery at ${k}/40`);
            // Combined: the next move's windup picks up where the recovery had got to.
            const half = { move, t: m.recovery / 2 };
            assert.ok(gap(at({ move: type === 'sword' ? 'slash' : 'cut', phase: 'windup', t: 0, from: half }), recovering(20)) < 1e-9, `${main} ${move}: a combo goes on from the recovery`);
        }
    }
});

test('drawn-only additions never change the judged pose', () => {
    const body = { gait: 0.3, moveBlend: 0 }, judged = playerAnim.pose(rig, body);
    const before = JSON.stringify(judged);
    const shown = playerAnim.present(judged, body, { time: 1.3, lean: 0.1 });
    assert.equal(JSON.stringify(judged), before);
    assert.notDeepEqual(plain(shown), plain(judged));
});

test('rigs reject bad data', () => {
    assert.throws(() => R.build({ bones: [{ name: 'a', parent: 'b', at: [0, 0, 0] }], parts: [], mounts: {} }));
    assert.throws(() => R.build({ bones: [{ name: 'a', parent: null, at: [0, 0, 0] }], parts: [{ bone: 'x', size: [1, 1, 1], at: [0, 0, 0] }], mounts: {} }));
    assert.throws(() => R.build(playerModel, { equipment: [{ mount: 'tail', parts: [] }] }));
    assert.throws(() => equipmentModels.forLoadout({ main: 'bow' }));
});
