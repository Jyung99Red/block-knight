const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { rigKit: R, playerModel, playerAnim, equipmentModels, space, gameConfig } = g;

const equipment = equipmentModels.forLoadout(gameConfig.gear.starter);
const rig = R.build(playerModel, { equipment });
const find = (fn) => rig.parts.findIndex(fn);
// Objects made inside the vm have their own prototypes; compare as data.
const plain = value => JSON.parse(JSON.stringify(value));

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
