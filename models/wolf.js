// The wolf (design.md 2.1): a quadruped of 8 bones, legs in
// one piece, after the first 3D prototype. Its back
// is about 0.8 blocks high and the top of its head about 1.0 (design.md 4.3), so a
// cut at the shoulder passes over it. Faces +z; its right side is -x. The
// muzzle is its weapon (the bite); the leap rams with the whole body.
const wolfModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'body', parent: 'base', at: [0, 0.62, 0] },
        { name: 'head', parent: 'body', at: [0, 0.12, 0.47] },
        { name: 'tail', parent: 'body', at: [0, 0.12, -0.47] }
    ];
    const parts = [
        { bone: 'body', size: [0.44, 0.42, 0.95], at: [0, 0, 0], color: 'wolf' },
        { bone: 'body', size: [0.5, 0.48, 0.38], at: [0, 0.03, 0.24], color: 'wolfLight', kind: 'deco' },
        { bone: 'head', size: [0.38, 0.36, 0.34], at: [0, 0.04, 0.12], color: 'wolfHead' },
        { bone: 'head', size: [0.22, 0.17, 0.26], at: [0, -0.04, 0.41], color: 'wolfMuzzle', kind: 'weapon' },
        { bone: 'head', size: [0.08, 0.06, 0.04], at: [0, 0.03, 0.55], color: 'wolfNose', kind: 'deco' },
        { bone: 'tail', size: [0.12, 0.12, 0.45], at: [0, 0.04, -0.2], color: 'wolfHead' }
    ];
    for (const sx of [-1, 1]) {
        parts.push(
            { bone: 'head', size: [0.1, 0.15, 0.07], at: [0.12 * sx, 0.29, 0.05], color: 'wolfDark', kind: 'deco' },
            { bone: 'head', size: [0.07, 0.05, 0.02], at: [0.1 * sx, 0.1, 0.3], color: 'wolfEye', kind: 'deco' },
            { bone: 'head', size: [0.03, 0.05, 0.03], at: [0.07 * sx, -0.14, 0.52], color: 'fang', kind: 'deco' }
        );
    }
    for (const [name, x, z] of [['legFR', -0.14, 0.33], ['legFL', 0.14, 0.33], ['legBR', -0.14, -0.33], ['legBL', 0.14, -0.33]]) {
        bones.push({ name, parent: 'body', at: [x, -0.18, z] });
        parts.push({ bone: name, size: [0.13, 0.46, 0.13], at: [0, -0.21, 0], color: 'wolfLeg' });
    }
    return Object.freeze({
        bones, parts,
        mounts: { neck: { bone: 'body', at: [0, 0.16, 0.36] } },
        // Colour swaps by kind: the wolf king (a boss).
        looks: {
            king: { wolf: 'kingFur', wolfLight: 'kingFurLight', wolfHead: 'kingHead', wolfMuzzle: 'kingMuzzle', wolfDark: 'kingDark', wolfLeg: 'kingLeg', wolfEye: 'kingEye' }
        }
    });
})();

// The wolf's key poses; see models/goblin.js for the layout. Diagonal legs
// step together. The leap adds `hop` blocks of height on a sine over its
// swing (a jump, not a pose). A move marked `either` is drawn left for
// right half the time (core/monster.js), so its keys mirror each other.
const wolfPoses = (() => {
    const legs = (front, back) => ({ legFR: { rx: front }, legFL: { rx: front }, legBR: { rx: back }, legBL: { rx: back } });
    return Object.freeze({
        // The king's mane: only drawn.
        mane() {
            return {
                id: 'mane', mount: 'neck', parts: [
                    { size: [0.56, 0.34, 0.3], at: [0, 0.02, 0], color: 'mane', kind: 'deco' },
                    { size: [0.44, 0.2, 0.26], at: [0, 0.2, -0.08], color: 'mane', kind: 'deco' }
                ]
            };
        },
        idle: { head: { rx: 0.05 }, tail: { rx: -0.45 } },
        walk: {
            leg: { length: 0.44, amp: 0.6 },
            swing: [['legFR', 'rx', 0.6, 0], ['legBL', 'rx', 0.6, 0], ['legFL', 'rx', 0.6, Math.PI], ['legBR', 'rx', 0.6, Math.PI], ['head', 'rx', 0.05, Math.PI / 2], ['tail', 'ry', 0.35, 0]]
        },
        alert: { body: { rx: -0.08 }, head: { rx: -0.3 }, tail: { rx: 0.5 } },
        moves: {
            // Draws back with the head up and turned to one side, then snaps
            // forward and down, sweeping across to the other: the warning is
            // a small fan, so a step aside does not clear it (user,
            // 2026-10-03). `either`: drawn mirrored at random, so which side
            // it sweeps from cannot be learnt.
            bite: {
                a: { body: { rx: -0.12, ry: 0.2, pz: -0.06 }, head: { rx: -0.35, ry: 0.55 }, ...legs(-0.25, 0.2), tail: { rx: -0.2, ry: -0.3 } },
                b: { body: { rx: 0.12, ry: -0.2, pz: 0.1 }, head: { rx: 0.35, ry: -0.55, pz: 0.06 }, ...legs(-0.45, 0.35), tail: { rx: -0.3, ry: 0.3 } },
                either: true
            },
            // Crouches, then flies at the target legs stretched.
            leap: {
                a: { body: { rx: -0.15 }, head: { rx: -0.1 }, ...legs(0.45, -0.5), tail: { rx: -0.2 } },
                b: { body: { rx: 0.12 }, head: { rx: 0.2 }, ...legs(-1.2, 1.1), tail: { rx: -0.6 } },
                hop: 0.3
            }
        },
        reel: { body: { py: -0.08 }, head: { rx: 0.45 }, ...legs(-0.15, 0.15), tail: { rx: -0.1 } },
        flinch: { body: { rx: -0.12 }, head: { rx: -0.45 } },
        // On its side, legs out.
        dead: { base: { rz: 1.5 }, head: { rx: 0.4 }, ...legs(-0.3, 0.3), tail: { rx: 0.2 } }
    });
})();
