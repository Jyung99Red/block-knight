// The cave spider (design.md 2.1, 5): eight legs on a low body, after the
// wolf in size. The front of the body (the head end) is one bone and the
// abdomen another; each leg is one bone with two boxes, a thigh out to the
// side and a shank down to the ground. Its back is about 0.85 blocks high.
// Faces +z; its right side is -x, and a leg's name ends in its side so a
// pose mirrors (rigKit.mirror). The front pair's shanks are its weapon (the
// strike); the spring rams with the whole body.
const spiderModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'body', parent: 'base', at: [0, 0.42, 0.05] },
        { name: 'abdomen', parent: 'body', at: [0, 0.06, -0.14] }
    ];
    const parts = [
        { bone: 'body', size: [0.42, 0.28, 0.42], at: [0, 0, 0.08], color: 'spider' },
        { bone: 'body', size: [0.3, 0.06, 0.3], at: [0, 0.16, 0.06], color: 'spiderLight', kind: 'deco' },
        { bone: 'abdomen', size: [0.62, 0.5, 0.7], at: [0, 0.12, -0.36], color: 'spider' },
        { bone: 'abdomen', size: [0.5, 0.04, 0.52], at: [0, 0.39, -0.36], color: 'spiderLight', kind: 'deco' },
        { bone: 'abdomen', size: [0.16, 0.05, 0.3], at: [0, 0.42, -0.36], color: 'spiderMark', kind: 'deco' }
    ];
    for (const sx of [-1, 1]) {
        parts.push(
            { bone: 'body', size: [0.07, 0.07, 0.02], at: [0.1 * sx, 0.06, 0.3], color: 'spiderEye', kind: 'deco' },
            { bone: 'body', size: [0.05, 0.05, 0.02], at: [0.05 * sx, 0.1, 0.3], color: 'spiderEye', kind: 'deco' },
            { bone: 'body', size: [0.06, 0.13, 0.06], at: [0.06 * sx, -0.14, 0.27], color: 'spiderFang', kind: 'deco' }
        );
    }
    // Four legs a side, front to back; `z` where they leave the body.
    for (const [n, z] of [[1, 0.2], [2, 0.09], [3, -0.02], [4, -0.12]]) {
        for (const [side, sx] of [['R', -1], ['L', 1]]) {
            const name = `leg${n}${side}`;
            bones.push({ name, parent: 'body', at: [0.18 * sx, -0.02, z] });
            parts.push(
                { bone: name, size: [0.44, 0.08, 0.08], at: [0.22 * sx, 0.1, 0], color: 'spiderLeg' },
                { bone: name, size: [0.08, 0.56, 0.08], at: [0.44 * sx, -0.14, 0], color: 'spiderDark', kind: n === 1 ? 'weapon' : 'body' }
            );
        }
    }
    return Object.freeze({ bones, parts, mounts: {}, looks: {} });
})();

// The spider's key poses; see models/goblin.js for the layout. Its legs
// leave the body straight out to the side; `stance` fans them, the front
// pair forward and the back pair back, and every pose starts from it (a
// move's keys name each leg, or the leg would swing back to the side).
// A leg's `ry` turns it forward or back, its `rz` lifts or lowers it;
// poses are written for the right legs and mirrored for the left. Legs
// 1 and 3 of one side step with 2 and 4 of the other. The spring adds `hop`
// blocks of height on a sine over its swing.
const spiderPoses = (() => {
    const FAN = { 1: 0.65, 2: 0.22, 3: -0.22, 4: -0.6 };
    // Right legs as given (bone names without the side), left ones mirrored.
    const both = right => {
        const out = {};
        for (const [leg, p] of Object.entries(right)) {
            out[`${leg}R`] = { ...p };
            out[`${leg}L`] = Object.fromEntries(Object.entries(p).map(([c, v]) => [c, ['ry', 'rz', 'px'].includes(c) ? -v : v]));
        }
        return out;
    };
    // The stance with `legs` (by leg number: channels added) and other bones.
    const pose = (legs = {}, rest = {}) => ({
        ...both(Object.fromEntries([1, 2, 3, 4].map(n => [`leg${n}`, { ry: FAN[n] + (legs[n]?.ry || 0), ...(legs[n]?.rz ? { rz: legs[n].rz } : {}) }]))),
        ...rest
    });
    const swingOf = (n, side) => (n % 2 === 1) === (side === 'R') ? 0 : Math.PI;
    return Object.freeze({
        idle: pose({}, { abdomen: { rx: -0.05 } }),
        walk: {
            leg: { length: 0.44, amp: 0.32 },
            // Each leg swings forward and back; the right ones turn the
            // other way to the left ones, so a sign keeps them stepping
            // together.
            swing: [1, 2, 3, 4].flatMap(n => [['R', 1], ['L', -1]].map(([side, k]) => [`leg${n}${side}`, 'ry', 0.32 * k, swingOf(n, side)])).concat([['abdomen', 'ry', 0.06, 0]])
        },
        alert: { body: { rx: -0.18 }, abdomen: { rx: 0.15 }, ...both({ leg1: { rz: -0.5 } }) },
        moves: {
            // Rears up with the front legs raised high, then stabs them
            // down in front: narrow and close, a step aside clears it.
            strike: {
                a: pose({ 1: { ry: 0.85, rz: -1.35 }, 2: { rz: -0.15 }, 4: { rz: 0.1 } }, { body: { rx: -0.42, pz: -0.06 }, abdomen: { rx: 0.35 } }),
                b: pose({ 1: { ry: 0.85, rz: -0.25 }, 2: { ry: 0.15 }, 3: { ry: -0.1 }, 4: { ry: -0.2 } }, { body: { rx: 0.22, pz: 0.12 }, abdomen: { rx: -0.2 } })
            },
            // Crouches with its legs drawn in, then springs at the target,
            // legs flung forward.
            spring: {
                a: pose({ 1: { ry: 0.25, rz: 0.25 }, 2: { rz: 0.25 }, 3: { rz: 0.25 }, 4: { rz: 0.25 } }, { body: { py: -0.1, rx: 0.08 }, abdomen: { rx: 0.1 } }),
                b: pose({ 1: { ry: 0.6, rz: -0.55 }, 2: { ry: 0.35, rz: -0.3 }, 3: { ry: -0.2, rz: -0.15 }, 4: { ry: -0.3 } }, { body: { rx: -0.12 }, abdomen: { rx: 0.2 } }),
                hop: 0.55
            }
        },
        reel: pose({ 1: { rz: 0.2 }, 2: { rz: 0.3 }, 3: { rz: 0.3 }, 4: { rz: 0.2 } }, { body: { py: -0.06, rx: 0.15 }, abdomen: { rx: -0.25 } }),
        flinch: { body: { rx: -0.25 }, abdomen: { rx: 0.2 } },
        // On its back, legs curled up.
        dead: pose({ 1: { rz: 0.9 }, 2: { rz: 1.0 }, 3: { rz: 1.0 }, 4: { rz: 0.9 } }, { base: { rz: 3.0 }, abdomen: { rx: 0.2 } })
    });
})();
