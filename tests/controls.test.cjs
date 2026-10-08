const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { controlsKit: K, space, gameConfig } = load();
const I = gameConfig.input, L = gameConfig.controlsLayout;

test('stick: nothing in the dead zone, full speed one ramp further out', () => {
    assert.equal(K.stickVector(I.deadZone, 0).mag, 0);
    assert.equal(K.stickVector(0, -I.deadZone * 0.9).mag, 0);
    const half = K.stickVector(I.deadZone + I.ramp / 2, 0);
    assert.ok(Math.abs(half.mag - 0.5) < 1e-9 && half.y === 0);
    assert.equal(K.stickVector(0, I.deadZone + I.ramp).mag, 1);
    const far = K.stickVector(-300, 400);
    assert.equal(far.mag, 1);
    assert.ok(Math.abs(far.x + 0.6) < 1e-9 && Math.abs(far.y - 0.8) < 1e-9, 'direction is kept');
});

test('keyboard: WASD and arrows make a unit vector; opposite keys cancel', () => {
    const v = codes => { const r = K.keyVector(new Set(codes)); return [r.x, r.y].map(n => Math.round(n * 1e6) / 1e6 + 0); };
    assert.deepEqual(v(['KeyW']), [0, -1]);
    assert.deepEqual(v(['ArrowDown']), [0, 1]);
    assert.deepEqual(v(['KeyW', 'KeyD']), [0.707107, -0.707107]);
    assert.deepEqual(v(['KeyA', 'KeyD']), [0, 0]);
    assert.deepEqual(v([]), [0, 0]);
    const keys = I.keys;
    assert.deepEqual([keys.attack[0], keys.offhand[0], keys.guard[0], keys.interact[0]], ['KeyJ', 'KeyK', 'KeyL', 'KeyE']);
});

test('screen directions map to the ground wherever the camera has been turned to', () => {
    const g = (sx, sy, yaw) => { const r = space.screenToGround(sx, sy, yaw); return [r.x, r.y].map(n => Math.round(n * 1e9) / 1e9 + 0); };
    assert.deepEqual(g(0, -1, 0), [0, -1], 'screen up is north (-y, 3D -z)');
    assert.deepEqual(g(1, 0, 0), [1, 0]);
    // A camera turned a quarter round still maps screen-up to "away from the camera".
    assert.deepEqual(g(0, -1, Math.PI / 2), [-1, 0]);
    assert.equal(gameConfig.camera.yaw, 0, 'the camera stands due south at first');
});

test('a drag across the picture turns the camera: to the right looks to the right, and all the way round', () => {
    assert.equal(K.turned(0, 0), 0);
    // Looking to the right: the camera goes round to the west of the
    // fighter, so screen-up, north at first, turns towards the east.
    const right = K.turned(0, 100);
    assert.ok(Math.abs(right + 100 * I.turn) < 1e-12);
    const up = space.screenToGround(0, -1, right);
    assert.ok(up.x > 0 && up.y < 0, `screen-up after a drag to the right: ${JSON.stringify(up)}`);
    assert.ok(Math.abs(K.turned(right, -100)) < 1e-12, 'and back');
    // Round and round: the angle stays within a turn.
    let yaw = 0;
    for (let i = 0; i < 40; i++) { yaw = K.turned(yaw, 60); assert.ok(yaw > -Math.PI - 1e-9 && yaw <= Math.PI + 1e-9); }
    assert.ok(Math.abs(space.wrapAngle(yaw + 40 * 60 * I.turn)) < 1e-9);
});

// Landscape phones: width x height in CSS px, with notch insets.
const PHONES = [
    ['iPhone 13 / 14', 844, 390, { left: 47, right: 47, bottom: 21 }],
    ['iPhone SE', 667, 375, {}],
    ['iPhone Pro Max', 932, 430, { left: 59, right: 59, bottom: 21 }],
    ['small Android', 640, 360, {}],
    ['Android 20:9', 800, 360, { left: 32 }],
    ['Android tall', 915, 412, {}]
];

test('controls fit every common landscape phone without overlapping', () => {
    for (const [name, w, h, insets] of PHONES) {
        assert.deepEqual(K.check(w, h, insets).length, 0, `${name}: ${K.check(w, h, insets).join('; ')}`);
        const { buttons: b, stickRest, stickZone } = K.layout(w, h, insets);
        // Right cluster: the attack key biggest and lowest-right, the offhand key above it, guard to its left.
        assert.ok(b.attack.size > b.offhand.size && b.attack.size > b.guard.size, name);
        assert.ok(b.offhand.y < b.attack.y && b.guard.x < b.attack.x, name);
        const cluster = ['attack', 'offhand', 'guard'].map(id => b[id]);
        const height = Math.max(...cluster.map(c => c.y + c.r)) - Math.min(...cluster.map(c => c.y - c.r));
        assert.ok(height <= 200, `${name}: right cluster ${height}px tall`);
        // The stick zone is a small bottom-left patch around where the stick rests.
        for (const c of cluster) assert.ok(c.x - c.r > stickZone.x1, `${name}: right buttons stay off the stick zone`);
        assert.ok(stickZone.x0 === 0 && stickZone.y1 === h, `${name}: the zone reaches the screen's corner`);
        assert.ok(stickZone.x1 <= w * 0.45 && stickZone.y1 - stickZone.y0 <= h * 0.6, `${name}: zone ${JSON.stringify(stickZone)} is small`);
        assert.ok(stickRest.x <= stickZone.x1 - 40 && stickRest.y >= stickZone.y0 + 40, `${name}: the resting stick sits inside the zone`);
        assert.ok(b.interact.x < stickZone.x1 && b.interact.y + b.interact.r < stickRest.y - I.stickRadius, name);
        assert.ok(stickRest.x - I.stickRadius > (insets.left || 0), `${name}: resting stick inside the safe area`);
    }
});

test('the checker does flag a bad layout', () => {
    const bad = { ...L, buttons: { ...L.buttons, offhand: { side: 'right', x: 78, y: 120, size: 72 } } };
    assert.ok(K.check(844, 390, {}, bad).some(p => /attack and offhand/.test(p)));
    const off = { ...L, buttons: { ...L.buttons, attack: { side: 'right', x: 20, y: 72, size: 84 } } };
    assert.ok(K.check(844, 390, {}, off).some(p => /safe area/.test(p)));
});
