// The minotaur (design.md 5): a boss of its own skeleton, not a bigger
// small monster. A broad body on two legs (10 bones, limbs in one piece
// like the goblin's), a bull's head with horns, an axe in the right hand
// and a shield on the left arm, held before it all the time: blows from in
// front do half the damage (gameConfig.monsters.minotaur.shield; the shield
// box itself is only drawn, the rule goes by the angle). About 1.75 blocks
// tall before its scale. Faces +z; its right side is -x. Horns, snout and
// hooves are only drawn (design.md 2.1).
const minotaurModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'hips', parent: 'base', at: [0, 0.62, 0] },
        { name: 'spine', parent: 'hips', at: [0, 0, 0] },
        { name: 'head', parent: 'spine', at: [0, 0.62, 0.06] },
        { name: 'shoulderR', parent: 'spine', at: [-0.42, 0.54, 0] },
        { name: 'wristR', parent: 'shoulderR', at: [0, -0.5, 0] },
        { name: 'shoulderL', parent: 'spine', at: [0.42, 0.54, 0] },
        { name: 'wristL', parent: 'shoulderL', at: [0, -0.44, 0] },
        { name: 'legR', parent: 'base', at: [-0.16, 0.62, 0] },
        { name: 'legL', parent: 'base', at: [0.16, 0.62, 0] }
    ];
    const parts = [
        { bone: 'spine', size: [0.68, 0.62, 0.42], at: [0, 0.31, 0], color: 'minoFur' },
        { bone: 'spine', size: [0.5, 0.3, 0.06], at: [0, 0.4, 0.2], color: 'minoFurLight', kind: 'deco' },
        { bone: 'spine', size: [0.72, 0.14, 0.46], at: [0, 0.03, 0], color: 'minoBelt', kind: 'deco' },
        { bone: 'spine', size: [0.3, 0.28, 0.04], at: [0, -0.12, 0.22], color: 'minoCloth', kind: 'deco' },
        { bone: 'head', size: [0.46, 0.44, 0.44], at: [0, 0.2, 0.02], color: 'minoHead' },
        { bone: 'head', size: [0.34, 0.22, 0.16], at: [0, 0.09, 0.3], color: 'minoMuzzle', kind: 'deco' },
        { bone: 'head', size: [0.16, 0.06, 0.03], at: [0, 0.0, 0.39], color: 'gold', kind: 'deco' },
        { bone: 'shoulderR', size: [0.24, 0.54, 0.24], at: [0, -0.25, 0], color: 'minoFur' },
        { bone: 'shoulderL', size: [0.24, 0.48, 0.24], at: [0, -0.22, 0], color: 'minoFur' }
    ];
    for (const sx of [-1, 1]) {
        parts.push(
            { bone: 'head', size: [0.24, 0.1, 0.1], at: [0.33 * sx, 0.36, 0.02], color: 'horn', kind: 'deco' },
            { bone: 'head', size: [0.09, 0.2, 0.09], at: [0.42 * sx, 0.49, 0.06], color: 'horn', kind: 'deco' },
            { bone: 'head', size: [0.14, 0.07, 0.08], at: [0.28 * sx, 0.24, -0.04], color: 'minoFurDark', kind: 'deco' },
            { bone: 'head', size: [0.08, 0.06, 0.02], at: [0.13 * sx, 0.27, 0.245], color: 'minoEye', kind: 'deco' },
            { bone: 'spine', size: [0.3, 0.14, 0.34], at: [0.38 * sx, 0.6, 0], color: 'minoFurDark', kind: 'deco' }
        );
    }
    for (const side of ['R', 'L']) {
        parts.push(
            { bone: `leg${side}`, size: [0.26, 0.56, 0.28], at: [0, -0.28, 0], color: 'minoFur' },
            { bone: `leg${side}`, size: [0.28, 0.1, 0.32], at: [0, -0.57, 0.02], color: 'hoof', kind: 'deco' }
        );
    }
    return Object.freeze({
        bones, parts,
        mounts: { handR: { bone: 'wristR', at: [0, 0, 0] }, armL: { bone: 'wristL', at: [0, 0, 0] } },
        looks: {}
    });
})();

// The minotaur's axe, shield and key poses; see models/goblin.js for the
// layout. Every pose holds the shield before the body (SHIELD), so none
// lets it drop. Each move has `a` (end of windup) and `b` (end of swing),
// timed by game_config.js monsters.minotaur.moves.
const minotaurPoses = (() => {
    // The shield arm: the upper arm forward and in, the forearm (the
    // wrist's frame) turned upright again, so the shield stands before the
    // chest facing ahead.
    const SHIELD = { shoulderL: { rx: -1.15, rz: -0.35 }, wristL: { rx: 1.15, rz: 0.35 } };
    const held = pose => ({ ...SHIELD, ...pose });
    return Object.freeze({
        axe() {
            return {
                id: 'axe', mount: 'handR', parts: [
                    { size: [0.08, 0.08, 0.78], at: [0, 0, 0.24], color: 'woodDark', kind: 'deco' },
                    { size: [0.1, 0.42, 0.3], at: [0, 0.1, 0.52], color: 'steelDark', kind: 'weapon' },
                    { size: [0.11, 0.44, 0.06], at: [0, 0.1, 0.69], color: 'steel', kind: 'deco' }
                ]
            };
        },
        // Planks bound in iron; only drawn (a `shield` box: the rule is the
        // angle, as a fighter's guard).
        shield() {
            return {
                id: 'shield', mount: 'armL', parts: [
                    { size: [0.72, 0.84, 0.1], at: [-0.16, 0.04, 0.16], color: 'minoShield', kind: 'shield' },
                    { size: [0.76, 0.08, 0.13], at: [-0.16, 0.44, 0.16], color: 'steelDark', kind: 'deco' },
                    { size: [0.76, 0.08, 0.13], at: [-0.16, -0.36, 0.16], color: 'steelDark', kind: 'deco' },
                    { size: [0.2, 0.2, 0.06], at: [-0.16, 0.04, 0.23], color: 'steel', kind: 'deco' }
                ]
            };
        },
        idle: held({ spine: { rx: 0.08 }, shoulderR: { rx: -0.55, rz: 0.1 }, wristR: { rx: 1.25 } }),
        walk: {
            leg: { length: 0.62, amp: 0.45 },
            swing: [['legR', 'rx', 0.45, 0], ['legL', 'rx', 0.45, Math.PI], ['shoulderR', 'rx', 0.12, Math.PI], ['spine', 'ry', 0.06, 0]]
        },
        alert: { spine: { rx: -0.1 }, head: { rx: 0.2 }, shoulderR: { rx: -0.3 } },
        moves: {
            // The axe raised over the head and brought straight down in
            // front: narrow, a step aside clears it.
            chop: {
                a: held({ hips: { py: -0.03 }, spine: { rx: -0.25, ry: 0.15 }, shoulderR: { rx: -2.85, rz: 0.35 }, wristR: { rx: 1.0 }, legR: { rx: 0.2 }, legL: { rx: -0.25 } }),
                b: held({ hips: { py: -0.1 }, spine: { rx: 0.4, ry: 0.15 }, head: { rx: 0.2 }, shoulderR: { rx: -0.55, rz: 0.4 }, wristR: { rx: 1.0 }, legR: { rx: -0.4 }, legL: { rx: 0.35 } })
            },
            // The axe swung right to left across the front at chest height:
            // wide and close, a step back clears it.
            sweep: {
                a: held({ spine: { rx: 0.05, ry: -0.6 }, shoulderR: { rx: -1.4, ry: -0.9 }, wristR: { rx: 1.3 }, legR: { rx: -0.15 }, legL: { rx: 0.2 } }),
                b: held({ spine: { rx: 0.12, ry: 0.55 }, shoulderR: { rx: -1.35, ry: 0.75 }, wristR: { rx: 1.3 }, legR: { rx: 0.2 }, legL: { rx: -0.25 } })
            },
            // Head down, horns and shield first, it charges a long way:
            // the whole body rams (a step aside clears it).
            charge: {
                a: held({ hips: { py: -0.1 }, spine: { rx: 0.45 }, head: { rx: 0.35 }, shoulderR: { rx: -0.2, rz: -0.15 }, wristR: { rx: 1.2 }, legR: { rx: 0.45 }, legL: { rx: -0.35 } }),
                b: held({ hips: { py: -0.05 }, spine: { rx: 0.55 }, head: { rx: 0.45 }, shoulderR: { rx: 0.25, rz: -0.15 }, wristR: { rx: 1.1 }, legR: { rx: -0.5 }, legL: { rx: 0.45 } })
            }
        },
        // Reeling from a full stagger (a sway is added): the shield sags;
        // struck: a jolt back.
        reel: { spine: { rx: 0.3 }, head: { rx: 0.4 }, shoulderR: { rx: -0.1 }, wristR: { rx: 0.4 }, shoulderL: { rx: -0.6, rz: -0.2 }, wristL: { rx: 0.6, rz: 0.2 } },
        flinch: { spine: { rx: -0.3 }, head: { rx: -0.3 } },
        // Fallen on its back, arms flung out.
        dead: { base: { rx: -1.45 }, spine: { rx: -0.1 }, head: { rx: -0.3 }, shoulderR: { rx: -0.4, rz: -1.0 }, wristR: { rx: 0.2 }, shoulderL: { rx: -0.3, rz: 1.0 }, legR: { rx: -0.2 }, legL: { rx: 0.15 } }
    });
})();
