// The goblin (design.md 2.1): the simple monster skeleton
// (9 bones, limbs in one piece, like the training dummy), about 1.4 blocks
// tall, after the first 3D prototype. Faces +z; its right side is -x.
// Ears are only drawn, never hit (design.md 2.1).
const goblinModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'hips', parent: 'base', at: [0, 0.5, 0] },
        { name: 'spine', parent: 'hips', at: [0, 0, 0] },
        { name: 'head', parent: 'spine', at: [0, 0.46, 0] },
        { name: 'shoulderR', parent: 'spine', at: [-0.31, 0.4, 0] },
        { name: 'wristR', parent: 'shoulderR', at: [0, -0.42, 0] },
        { name: 'shoulderL', parent: 'spine', at: [0.31, 0.4, 0] },
        { name: 'legR', parent: 'base', at: [-0.12, 0.5, 0] },
        { name: 'legL', parent: 'base', at: [0.12, 0.5, 0] }
    ];
    const parts = [
        { bone: 'spine', size: [0.46, 0.46, 0.3], at: [0, 0.23, 0], color: 'goblin' },
        { bone: 'spine', size: [0.48, 0.24, 0.32], at: [0, 0.32, -0.005], color: 'rag', kind: 'deco' },
        { bone: 'spine', size: [0.5, 0.12, 0.34], at: [0, 0.04, 0], color: 'ragDark', kind: 'deco' },
        { bone: 'spine', size: [0.22, 0.2, 0.04], at: [0, -0.06, 0.15], color: 'ragLight', kind: 'deco' },
        { bone: 'head', size: [0.5, 0.42, 0.44], at: [0, 0.21, 0.02], color: 'goblinLight' },
        { bone: 'head', size: [0.1, 0.13, 0.1], at: [0, 0.15, 0.28], color: 'goblinDark', kind: 'deco' },
        { bone: 'head', size: [0.22, 0.04, 0.02], at: [0, 0.06, 0.245], color: 'mouth', kind: 'deco' },
        { bone: 'shoulderR', size: [0.16, 0.44, 0.16], at: [0, -0.2, 0], color: 'goblin' },
        { bone: 'shoulderL', size: [0.16, 0.44, 0.16], at: [0, -0.2, 0], color: 'goblin' }
    ];
    for (const sx of [-1, 1]) {
        parts.push(
            { bone: 'head', size: [0.26, 0.1, 0.06], at: [0.37 * sx, 0.27, 0], color: 'goblin', kind: 'deco' },
            { bone: 'head', size: [0.11, 0.07, 0.02], at: [0.12 * sx, 0.27, 0.245], color: 'goblinEye', kind: 'deco' },
            { bone: 'head', size: [0.04, 0.05, 0.02], at: [0.1 * sx, 0.268, 0.257], color: 'pupil', kind: 'deco' }
        );
    }
    for (const side of ['R', 'L']) {
        parts.push(
            { bone: `leg${side}`, size: [0.18, 0.42, 0.2], at: [0, -0.21, 0], color: 'goblin' },
            { bone: `leg${side}`, size: [0.2, 0.09, 0.27], at: [0, -0.455, 0.035], color: 'goblinFoot', kind: 'deco' }
        );
    }
    return Object.freeze({
        bones, parts,
        mounts: { handR: { bone: 'wristR', at: [0, 0, 0] }, head: { bone: 'head', at: [0, 0.42, 0.02] } },
        // Colour swaps by kind: the goblin chief (a boss).
        looks: {
            chief: {
                goblin: 'chiefSkin', goblinLight: 'chiefSkinLight', goblinDark: 'chiefSkinDark', goblinFoot: 'chiefRagDark',
                rag: 'chiefRag', ragDark: 'chiefRagDark', ragLight: 'chiefRagLight', club: 'chiefClub', clubGrip: 'chiefRagDark'
            }
        }
    });
})();

// The goblin's club and key poses. `walk` is a formula, not keys: each
// entry swings one channel of one bone by `amp` radians on a sine of the
// gait phase, offset by `phase`; `leg` is the leg length and stride swing
// the stride is measured from (core/monster.js). `alert` is added while it
// notices the player. Each move has `a` (end of windup) and `b` (end of
// swing), timed by game_config.js monsters.goblin.moves.
const goblinPoses = Object.freeze({
    club() {
        return {
            id: 'club', mount: 'handR', parts: [
                { size: [0.08, 0.08, 0.36], at: [0, 0, 0.1], color: 'clubGrip', kind: 'deco' },
                { size: [0.2, 0.2, 0.32], at: [0, 0, 0.42], color: 'club', kind: 'weapon' }
            ]
        };
    },
    // The chief's horned helmet: only drawn.
    helmet() {
        return {
            id: 'helmet', mount: 'head', parts: [
                { size: [0.54, 0.12, 0.48], at: [0, 0, 0], color: 'helmet', kind: 'deco' },
                { size: [0.36, 0.1, 0.32], at: [0, 0.1, 0], color: 'helmet', kind: 'deco' },
                { size: [0.08, 0.2, 0.08], at: [-0.3, 0.12, 0], color: 'horn', kind: 'deco' },
                { size: [0.08, 0.2, 0.08], at: [0.3, 0.12, 0], color: 'horn', kind: 'deco' },
                { size: [0.07, 0.12, 0.07], at: [-0.33, 0.27, 0], color: 'horn', kind: 'deco' },
                { size: [0.07, 0.12, 0.07], at: [0.33, 0.27, 0], color: 'horn', kind: 'deco' }
            ]
        };
    },
    idle: { spine: { rx: 0.1 }, shoulderR: { rx: -0.75, ry: 0.15, rz: -0.08 }, wristR: { rx: 1.15 }, shoulderL: { rx: -0.25, rz: 0.15 } },
    walk: {
        leg: { length: 0.5, amp: 0.55 },
        swing: [['legR', 'rx', 0.55, 0], ['legL', 'rx', 0.55, Math.PI], ['shoulderL', 'rx', 0.3, 0], ['shoulderR', 'rx', 0.12, Math.PI], ['spine', 'ry', 0.08, 0]]
    },
    alert: { spine: { rx: -0.12 }, head: { rx: -0.15 }, shoulderR: { rx: -0.55 }, shoulderL: { rx: -0.3, rz: 0.2 } },
    moves: {
        // A wild swing, right to left across the front at chest height.
        flail: {
            a: { spine: { rx: 0.05, ry: -0.5 }, shoulderR: { rx: -1.35, ry: -0.8 }, wristR: { rx: 1.25 }, shoulderL: { rx: -0.4, ry: 0.3, rz: 0.15 }, legR: { rx: -0.15 }, legL: { rx: 0.2 } },
            b: { spine: { rx: 0.1, ry: 0.55 }, shoulderR: { rx: -1.3, ry: 0.7 }, wristR: { rx: 1.25 }, shoulderL: { rx: -0.3, ry: -0.2, rz: 0.15 }, legR: { rx: 0.2 }, legL: { rx: -0.25 } }
        },
        // Both hands overhead, then down in front with the whole body (the chief).
        slam: {
            a: { hips: { py: -0.04 }, spine: { rx: -0.3 }, shoulderR: { rx: -2.9, ry: 0.15 }, wristR: { rx: 1.2 }, shoulderL: { rx: -2.7, ry: -0.35 }, legR: { rx: -0.2 }, legL: { rx: 0.25 } },
            b: { hips: { py: -0.08 }, spine: { rx: 0.5 }, shoulderR: { rx: -0.75, ry: 0.15 }, wristR: { rx: 1.0 }, shoulderL: { rx: -0.8, ry: -0.2 }, legR: { rx: -0.35 }, legL: { rx: 0.4 } }
        },
        // Leaps in with the club overhead and brings it down in front.
        pounce: {
            a: { hips: { py: -0.1 }, spine: { rx: -0.3 }, shoulderR: { rx: -2.75, ry: 0.1 }, wristR: { rx: 1.45 }, shoulderL: { rx: -2.3, ry: -0.2 }, legR: { rx: -0.35 }, legL: { rx: 0.45 } },
            b: { hips: { py: -0.05 }, spine: { rx: 0.55 }, shoulderR: { rx: -0.55, ry: 0.15 }, wristR: { rx: 0.5 }, shoulderL: { rx: -0.7, rz: 0.2 }, legR: { rx: -0.45 }, legL: { rx: 0.5 } }
        }
    },
    // Reeling from a full stagger (a sway is added); struck: a jolt back.
    reel: { spine: { rx: 0.3 }, head: { rx: 0.4 }, shoulderR: { rx: -0.1 }, wristR: { rx: 0.3 }, shoulderL: { rx: 0.1 } },
    flinch: { spine: { rx: -0.45 }, head: { rx: -0.35 } },
    // Fallen on its back, arms flung out.
    dead: { base: { rx: -1.45 }, spine: { rx: -0.1 }, head: { rx: -0.3 }, shoulderR: { rx: -0.4, rz: -1.0 }, wristR: { rx: 0.2 }, shoulderL: { rx: -0.3, rz: 1.0 }, legR: { rx: -0.2 }, legL: { rx: 0.15 } }
});
