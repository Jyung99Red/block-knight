// Skeletons, sparse poses and forward kinematics. A model (models/) is data:
// bones with joint positions, boxes hung on bones, and mount points for
// equipment. Poses are sparse: { bone: { rx, ry, rz, px, py, pz } }, and a
// bone a pose does not name stays at rest (design.md 2.4).
// Box kinds: `body` is hurtbox, `weapon` hits, `shield` blocks (later), and
// `deco` is only drawn.
const rigKit = (() => {
    const CHANNELS = ['rx', 'ry', 'rz', 'px', 'py', 'pz'];
    const KINDS = ['body', 'weapon', 'shield', 'deco'];
    const scaled = (v, k) => v.map(n => n * k);

    // Build a rig from a model plus equipment. `equipment` is a list of
    // { mount, parts } where each part is placed in the mount's frame.
    function build(model, { scale = 1, equipment = [] } = {}) {
        const bones = [], index = {};
        for (const b of model.bones) {
            if (index[b.name] !== undefined) throw new Error(`Duplicate bone ${b.name}`);
            const parent = b.parent == null ? -1 : index[b.parent];
            if (parent === undefined) throw new Error(`Bone ${b.name} comes before its parent ${b.parent}`);
            index[b.name] = bones.length;
            bones.push({ name: b.name, parent, at: scaled(b.at, scale) });
        }
        const parts = [];
        const addPart = (p, bone, offset, owner) => {
            if (!KINDS.includes(p.kind || 'body')) throw new Error(`Unknown box kind ${p.kind}`);
            parts.push({ bone, size: scaled(p.size, scale), at: scaled(p.at, scale).map((v, i) => v + offset[i]), color: p.color, kind: p.kind || 'body', owner, tag: p.tag || null });
        };
        for (const p of model.parts) {
            if (index[p.bone] === undefined) throw new Error(`Box on unknown bone ${p.bone}`);
            addPart(p, index[p.bone], [0, 0, 0], 'body');
        }
        for (const item of equipment) {
            const mount = model.mounts[item.mount];
            if (!mount) throw new Error(`Unknown mount ${item.mount}`);
            for (const p of item.parts) addPart(p, index[mount.bone], scaled(mount.at, scale), item.id || item.mount);
        }
        return { bones, index, parts, scale };
    }

    // Where each box hangs on its bone, as a matrix: it never changes, so
    // it is worked out once a rig.
    const hung = new WeakMap();
    function hungOf(rig) {
        let at = hung.get(rig);
        if (!at) hung.set(rig, at = rig.parts.map(part => math3d.compose(part.at[0], part.at[1], part.at[2], 0, 0, 0)));
        return at;
    }
    // World matrices of every bone and box for `pose`, with the model's base
    // at block position `root` = [x, y, z] turned by `yaw`. `into`: what an
    // earlier solve of this same rig returned, to be written over and
    // returned again -- for a caller that solves again and again and keeps
    // nothing of the time before.
    const local = new Float64Array(16), rootMatrix = new Float64Array(16);
    function solve(rig, pose, root = [0, 0, 0], yaw = 0, into = null) {
        const M = math3d, k = rig.scale, at = hungOf(rig);
        const bones = into ? into.bones : rig.bones.map(() => new Float64Array(16));
        const parts = into ? into.parts : rig.parts.map(() => new Float64Array(16));
        M.compose(root[0], root[1], root[2], 0, yaw, 0, rootMatrix);
        rig.bones.forEach((b, i) => {
            const p = pose[b.name] || {};
            M.compose(b.at[0] + (p.px || 0) * k, b.at[1] + (p.py || 0) * k, b.at[2] + (p.pz || 0) * k, p.rx || 0, p.ry || 0, p.rz || 0, local);
            M.multiply(b.parent < 0 ? rootMatrix : bones[b.parent], local, bones[i]);
        });
        rig.parts.forEach((part, i) => M.multiply(bones[part.bone], at[i], parts[i]));
        return into || { bones, parts };
    }
    // Oriented boxes of the given kind(s), for hit tests.
    function boxes(rig, solved, kinds = ['body']) {
        const out = [];
        rig.parts.forEach((part, i) => {
            if (kinds.includes(part.kind)) out.push({ part: i, box: math3d.obb(solved.parts[i], part.size.map(v => v / 2)) });
        });
        return out;
    }
    // Lowest corner height among boxes matching `filter`.
    function lowest(rig, solved, filter = part => part.kind === 'body') {
        let low = Infinity;
        rig.parts.forEach((part, i) => {
            if (!filter(part)) return;
            for (const c of math3d.corners(math3d.obb(solved.parts[i], part.size.map(v => v / 2)))) low = Math.min(low, c[1]);
        });
        return low;
    }

    // ---- sparse pose algebra ----
    // Linear blend; a channel missing on one side counts as 0.
    function mix(a, b, t) {
        const out = {};
        for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const pa = a[name] || {}, pb = b[name] || {}, o = {};
            for (const c of CHANNELS) {
                const va = pa[c] || 0, vb = pb[c] || 0;
                if (va || vb) o[c] = va + (vb - va) * t;
            }
            out[name] = o;
        }
        return out;
    }
    // Sum of poses (additive layers).
    function add(...poses) {
        const out = {};
        for (const pose of poses) for (const [name, p] of Object.entries(pose)) {
            const o = out[name] || (out[name] = {});
            for (const c of CHANNELS) if (p[c]) o[c] = (o[c] || 0) + p[c];
        }
        return out;
    }
    function scale(pose, k) { return mix({}, pose, k); }
    // Only the named bones (a layer mask).
    function pick(pose, names) {
        const out = {};
        for (const name of names) if (pose[name]) out[name] = { ...pose[name] };
        return out;
    }
    // Left-right mirror: swap R/L bone names and reflect across x = 0.
    function mirror(pose) {
        const swap = name => name.replace(/R$/, '\u0000').replace(/L$/, 'R').replace('\u0000', 'L');
        const out = {};
        for (const [name, p] of Object.entries(pose)) {
            const o = {};
            for (const c of CHANNELS) if (p[c]) o[c] = ['ry', 'rz', 'px'].includes(c) ? -p[c] : p[c];
            out[swap(name)] = o;
        }
        return out;
    }
    return { CHANNELS, KINDS, build, solve, boxes, lowest, mix, add, scale, pick, mirror };
})();
