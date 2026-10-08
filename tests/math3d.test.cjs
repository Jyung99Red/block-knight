const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { math3d: M } = load();

const close = (a, b, eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${a} vs ${b}`));
const rotX = a => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
const rotY = a => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const rotZ = a => [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('compose is translation times Ry * Rx * Rz (Euler YXZ, as three.js)', () => {
    const [rx, ry, rz] = [0.3, -1.1, 0.7];
    const expected = M.multiply(M.multiply(rotY(ry), rotX(rx)), rotZ(rz));
    expected[12] = 1; expected[13] = 2; expected[14] = 3;
    close(Array.from(M.compose(1, 2, 3, rx, ry, rz)), Array.from(expected));
});
test('points and directions transform; identity leaves them alone', () => {
    const m = M.compose(1, 0, 0, 0, Math.PI / 2, 0);
    close(M.transformPoint(m, [0, 0, 1]), [2, 0, 0]); // +z turns to +x
    close(M.transformDirection(m, [0, 0, 1]), [1, 0, 0]);
    close(M.transformPoint(M.identity(), [4, 5, 6]), [4, 5, 6]);
});

const box = (x, y, z, ry, half) => M.obb(M.compose(x, y, z, 0, ry, 0), half);
test('oriented boxes: separated, touching, overlapping', () => {
    const unit = [0.5, 0.5, 0.5];
    assert.equal(M.overlap(box(0, 0, 0, 0, unit), box(1.2, 0, 0, 0, unit)), false);
    assert.equal(M.overlap(box(0, 0, 0, 0, unit), box(1, 0, 0, 0, unit)), true);
    assert.equal(M.overlap(box(0, 0, 0, 0, unit), box(0.9, 0.3, -0.2, 0, unit)), true);
    assert.equal(M.overlap(box(0, 0, 0, 0, unit), box(0, 2, 0, 0, unit)), false, 'height counts: a box above does not touch');
});
test('rotation matters: a turned box reaches where an aligned one does not', () => {
    // A thin plank 2 long along z. Aligned it misses a cube at x = 1.2;
    // turned 90 degrees it lies along x and hits it.
    const plank = ry => box(0, 0, 0, ry, [0.05, 0.05, 1]), cube = box(1.2, 0, 0, 0, [0.3, 0.3, 0.3]);
    assert.equal(M.overlap(plank(0), cube), false);
    assert.equal(M.overlap(plank(Math.PI / 2), cube), true);
});
test('the fast overlap test agrees with projecting every corner on all 15 axes', () => {
    // Independent slow version: project both boxes' corners on each face
    // normal and each edge-pair cross product; apart on any axis = no hit.
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    function slow(A, B) {
        const axes = [...A.a, ...B.a];
        for (const u of A.a) for (const v of B.a) { const c = cross(u, v); if (M.length(c) > 1e-6) axes.push(c); }
        const ca = M.corners(A), cb = M.corners(B);
        return axes.every(ax => {
            const pa = ca.map(p => M.dot(p, ax)), pb = cb.map(p => M.dot(p, ax));
            return Math.max(...pa) >= Math.min(...pb) - 1e-9 && Math.max(...pb) >= Math.min(...pa) - 1e-9;
        });
    }
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const random = () => M.obb(M.compose(rnd() * 2, rnd() * 2, rnd() * 2, rnd() * 6, rnd() * 6, rnd() * 6), [0.05 + rnd(), 0.05 + rnd() * 0.3, 0.05 + rnd() * 0.6]);
    let hits = 0, misses = 0, edgeOnly = 0;
    for (let i = 0; i < 3000; i++) {
        const A = random(), B = random(), fast = M.overlap(A, B);
        assert.equal(fast, slow(A, B), `pair ${i}`);
        assert.equal(fast, M.overlap(B, A));
        if (fast) hits++; else misses++;
        // Count pairs separated only by an edge-pair axis.
        const faceOnly = [...A.a, ...B.a].every(ax => {
            const pa = M.corners(A).map(p => M.dot(p, ax)), pb = M.corners(B).map(p => M.dot(p, ax));
            return Math.max(...pa) >= Math.min(...pb) && Math.max(...pb) >= Math.min(...pa);
        });
        if (faceOnly && !fast) edgeOnly++;
    }
    assert.ok(hits > 300 && misses > 300 && edgeOnly > 0, `${hits} hits, ${misses} misses, ${edgeOnly} edge-only`);
});
test('corners of a box', () => {
    const cs = M.corners(box(1, 2, 3, 0, [0.5, 1, 1.5]));
    assert.equal(cs.length, 8);
    assert.deepEqual([Math.min(...cs.map(c => c[1])), Math.max(...cs.map(c => c[1]))], [1, 3]);
});
test('sub-steps keep each step under half the thinnest box', () => {
    assert.equal(M.substeps(0, 0.2), 1);
    assert.equal(M.substeps(0.1, 0.2), 1);
    assert.equal(M.substeps(0.27 * 40, 0.3 * 40), 2);
    // A fast sweep's blade tip: about 27 units a step against a 24-wide body.
    const n = M.substeps(27, 24);
    assert.ok(27 / n <= 12 + 1e-9 && n === 3);
    assert.throws(() => M.substeps(1, 0));
});
test('a fast blade swept with sub-steps cannot pass through a thin body', () => {
    // The blade moves 1.2 blocks in one step past a 0.3-thick body.
    const body = box(0, 1, 0, 0, [0.15, 0.6, 0.15]);
    const bladeAt = x => box(x, 1, 0, 0, [0.06, 0.03, 0.4]);
    assert.equal(M.overlap(bladeAt(-0.6), body) || M.overlap(bladeAt(0.6), body), false, 'the two step ends both miss');
    const n = M.substeps(1.2, 0.3);
    const hit = Array.from({ length: n + 1 }, (_, k) => -0.6 + 1.2 * k / n).some(x => M.overlap(bladeAt(x), body));
    assert.equal(hit, true);
});
