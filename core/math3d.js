// 4x4 matrices and oriented boxes for the rig and the hit tests. Plain JS,
// no three.js: Node tests and the PVP host run this same code. A matrix is
// 16 numbers in column-major order (three.js Matrix4.elements order), so the
// renderer copies it straight in. Rotations use Euler order YXZ like the
// prototype: R = Ry * Rx * Rz.
const math3d = (() => {
    function identity(out = new Float64Array(16)) {
        out.fill(0); out[0] = out[5] = out[10] = out[15] = 1;
        return out;
    }
    // out = a * b. `out` may alias neither input.
    function multiply(a, b, out = new Float64Array(16)) {
        for (let c = 0; c < 4; c++) {
            const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
            for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
        }
        return out;
    }
    // Translation (tx, ty, tz) then rotation Ry(ry) * Rx(rx) * Rz(rz).
    function compose(tx, ty, tz, rx, ry, rz, out = new Float64Array(16)) {
        const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
        const ce = c * e, cf = c * f, de = d * e, df = d * f;
        out[0] = ce + df * b; out[4] = de * b - cf; out[8] = a * d;  out[12] = tx;
        out[1] = a * f;       out[5] = a * e;       out[9] = -b;     out[13] = ty;
        out[2] = cf * b - de; out[6] = df + ce * b; out[10] = a * c; out[14] = tz;
        out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
        return out;
    }
    function transformPoint(m, p) {
        const [x, y, z] = p;
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    }
    function transformDirection(m, v) {
        const [x, y, z] = v;
        return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
    }
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const length = v => Math.hypot(v[0], v[1], v[2]);
    const normalize = v => { const l = length(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];

    // An oriented box: centre `c`, unit axes `a[0..2]`, half extents `h`.
    // `m` is the box's frame (rigid: no scale); `half` its half size.
    function obb(m, half) {
        return {
            c: [m[12], m[13], m[14]],
            a: [normalize([m[0], m[1], m[2]]), normalize([m[4], m[5], m[6]]), normalize([m[8], m[9], m[10]])],
            h: [half[0], half[1], half[2]]
        };
    }
    function corners(box) {
        const out = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            const p = box.c.slice();
            for (let k = 0; k < 3; k++) p[k] += box.a[0][k] * box.h[0] * sx + box.a[1][k] * box.h[1] * sy + box.a[2][k] * box.h[2] * sz;
            out.push(p);
        }
        return out;
    }
    // Separating-axis test over the 15 candidate axes. Touching counts.
    function overlap(A, B) {
        const R = [[], [], []], AR = [[], [], []];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            R[i][j] = dot(A.a[i], B.a[j]); AR[i][j] = Math.abs(R[i][j]) + 1e-9;
        }
        const d = sub(B.c, A.c), t = [dot(d, A.a[0]), dot(d, A.a[1]), dot(d, A.a[2])];
        for (let i = 0; i < 3; i++) {
            if (Math.abs(t[i]) > A.h[i] + B.h[0] * AR[i][0] + B.h[1] * AR[i][1] + B.h[2] * AR[i][2]) return false;
        }
        for (let j = 0; j < 3; j++) {
            if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > A.h[0] * AR[0][j] + A.h[1] * AR[1][j] + A.h[2] * AR[2][j] + B.h[j]) return false;
        }
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
            const ra = A.h[i1] * AR[i2][j] + A.h[i2] * AR[i1][j], rb = B.h[j1] * AR[i][j2] + B.h[j2] * AR[i][j1];
            if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb) return false;
        }
        return true;
    }
    // How many sub-steps a moving box needs so that no sub-step carries it
    // further than half the thinnest box it could pass through
    // (design.md 4.3). `travel` and `thinnest` in one unit.
    function substeps(travel, thinnest) {
        if (!(thinnest > 0)) throw new Error('substeps needs a positive thickness');
        return Math.max(1, Math.ceil(travel / (thinnest / 2) - 1e-9));
    }
    return { identity, multiply, compose, transformPoint, transformDirection, dot, length, normalize, sub, obb, corners, overlap, substeps };
})();
