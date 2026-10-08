// The training dummy (design.md 5): a straw-and-sack figure
// on the simple monster skeleton (9 bones, limbs in one piece), with a
// wooden club. About 1.75 blocks tall; faces +z, its right side is -x.
const dummyModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'hips', parent: 'base', at: [0, 0.7, 0] },
        { name: 'spine', parent: 'hips', at: [0, 0, 0] },
        { name: 'head', parent: 'spine', at: [0, 0.62, 0] },
        { name: 'shoulderR', parent: 'spine', at: [-0.36, 0.56, 0] },
        { name: 'wristR', parent: 'shoulderR', at: [0, -0.52, 0] },
        { name: 'shoulderL', parent: 'spine', at: [0.36, 0.56, 0] },
        { name: 'legR', parent: 'base', at: [-0.13, 0.7, 0] },
        { name: 'legL', parent: 'base', at: [0.13, 0.7, 0] }
    ];
    const parts = [
        { bone: 'spine', size: [0.54, 0.62, 0.34], at: [0, 0.31, 0], color: 'sack' },
        { bone: 'spine', size: [0.56, 0.08, 0.36], at: [0, 0.1, 0], color: 'rope', kind: 'deco' },
        { bone: 'spine', size: [0.56, 0.08, 0.36], at: [0, 0.5, 0], color: 'rope', kind: 'deco' },
        { bone: 'spine', size: [0.22, 0.22, 0.02], at: [0, 0.3, 0.18], color: 'target', kind: 'deco' },
        { bone: 'head', size: [0.46, 0.46, 0.44], at: [0, 0.23, 0], color: 'sack' },
        { bone: 'head', size: [0.08, 0.08, 0.02], at: [-0.1, 0.26, 0.225], color: 'eye', kind: 'deco' },
        { bone: 'head', size: [0.08, 0.08, 0.02], at: [0.1, 0.26, 0.225], color: 'eye', kind: 'deco' },
        { bone: 'head', size: [0.24, 0.04, 0.02], at: [0, 0.12, 0.225], color: 'rope', kind: 'deco' },
        { bone: 'head', size: [0.5, 0.06, 0.48], at: [0, 0.47, 0], color: 'straw', kind: 'deco' },
        { bone: 'shoulderR', size: [0.18, 0.5, 0.18], at: [0, -0.22, 0], color: 'sack' },
        { bone: 'shoulderL', size: [0.18, 0.5, 0.18], at: [0, -0.22, 0], color: 'sack' },
        { bone: 'legR', size: [0.2, 0.7, 0.22], at: [0, -0.35, 0], color: 'wood' },
        { bone: 'legL', size: [0.2, 0.7, 0.22], at: [0, -0.35, 0], color: 'wood' }
    ];
    return Object.freeze({
        bones, parts,
        mounts: { handR: { bone: 'wristR', at: [0, 0, 0] } }
    });
})();

// The dummy's club, and its key poses: idle, and `a` (end of windup) / `b`
// (end of swing) for each move in game_config.js dummy.moves.
const dummyPoses = Object.freeze({
    club(length = gameConfig.dummy.clubLength) {
        return {
            id: 'club', mount: 'handR', parts: [
                { size: [0.09, 0.09, 0.3], at: [0, 0, 0.02], color: 'woodDark', kind: 'deco' },
                { size: [0.16, 0.16, length - 0.18], at: [0, 0, 0.17 + (length - 0.18) / 2], color: 'woodDark', kind: 'weapon' }
            ]
        };
    },
    idle: { shoulderR: { rx: -0.7, ry: 0.15 }, wristR: { rx: 1.1 }, shoulderL: { rx: -0.25, rz: -0.18 }, spine: { rx: 0.08 } },
    moves: {
        // Right to left across the front, at waist height.
        swipe: {
            a: { spine: { ry: -0.35 }, shoulderR: { rx: -1.2, ry: -0.55 }, wristR: { rx: 1.2 }, shoulderL: { rx: -0.3, ry: 0.4 } },
            b: { spine: { ry: 0.35 }, shoulderR: { rx: -1.2, ry: 0.5 }, wristR: { rx: 1.2 }, shoulderL: { rx: -0.3, ry: 0.2 } }
        },
        // Overhead and down in front.
        smash: {
            a: { spine: { rx: -0.25 }, shoulderR: { rx: -3.0, ry: 0.15 }, wristR: { rx: 1.0 }, shoulderL: { rx: -2.6, ry: -0.3 } },
            b: { hips: { py: -0.06 }, spine: { rx: 0.4 }, shoulderR: { rx: -0.55, ry: 0.2 }, wristR: { rx: 1.4 }, shoulderL: { rx: -0.6, ry: -0.1 } }
        }
    },
    // Reeling from a full stagger: a sway; struck: a jolt back.
    reel: { spine: { rx: 0.25 }, head: { rx: 0.4 }, shoulderR: { rx: -0.1 }, wristR: { rx: 0.3 }, shoulderL: { rx: 0.1 } },
    flinch: { spine: { rx: -0.45 }, head: { rx: -0.35 } }
});
