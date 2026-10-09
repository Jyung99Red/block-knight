// The main character (design.md 2.1): 16 bones, blocks as the
// unit, about 1.9 blocks tall. The model faces +z; its right side is -x.
// Mount points carry equipment and are not bones.
const playerModel = (() => {
    const bones = [
        { name: 'base', parent: null, at: [0, 0, 0] },
        { name: 'pelvis', parent: 'base', at: [0, 0.72, 0] },
        { name: 'chest', parent: 'pelvis', at: [0, 0.14, 0] },
        { name: 'head', parent: 'chest', at: [0, 0.52, 0] }
    ];
    const parts = [
        { bone: 'pelvis', size: [0.52, 0.22, 0.3], at: [0, 0.03, 0], color: 'pants' },
        { bone: 'pelvis', size: [0.56, 0.08, 0.33], at: [0, 0.11, 0], color: 'belt', kind: 'deco' },
        { bone: 'pelvis', size: [0.12, 0.09, 0.02], at: [0, 0.11, 0.17], color: 'gold', kind: 'deco' },
        { bone: 'chest', size: [0.56, 0.52, 0.32], at: [0, 0.26, 0], color: 'tunic' },
        { bone: 'chest', size: [0.2, 0.2, 0.02], at: [0, 0.28, 0.165], color: 'tunicTrim', kind: 'deco' },
        { bone: 'head', size: [0.5, 0.5, 0.5], at: [0, 0.25, 0], color: 'skin' },
        { bone: 'head', size: [0.54, 0.12, 0.54], at: [0, 0.47, 0], color: 'hair', kind: 'deco' },
        { bone: 'head', size: [0.54, 0.36, 0.08], at: [0, 0.31, -0.24], color: 'hair', kind: 'deco' },
        { bone: 'head', size: [0.5, 0.08, 0.06], at: [0, 0.43, 0.24], color: 'hair', kind: 'deco' },
        { bone: 'head', size: [0.08, 0.1, 0.02], at: [-0.11, 0.25, 0.255], color: 'eye', kind: 'deco' },
        { bone: 'head', size: [0.08, 0.1, 0.02], at: [0.11, 0.25, 0.255], color: 'eye', kind: 'deco' }
    ];
    // Arms and legs: the right side is built, the left mirrors it.
    for (const [side, sx] of [['R', -1], ['L', 1]]) {
        bones.push(
            { name: `upperArm${side}`, parent: 'chest', at: [0.39 * sx, 0.46, 0] },
            { name: `forearm${side}`, parent: `upperArm${side}`, at: [0, -0.28, 0] },
            { name: `hand${side}`, parent: `forearm${side}`, at: [0, -0.24, 0] }
        );
        parts.push(
            { bone: 'head', size: [0.06, 0.2, 0.44], at: [0.27 * sx, 0.36, -0.03], color: 'hair', kind: 'deco' },
            { bone: `upperArm${side}`, size: [0.22, 0.32, 0.22], at: [0, -0.12, 0], color: 'tunic' },
            { bone: `forearm${side}`, size: [0.2, 0.26, 0.2], at: [0, -0.12, 0], color: 'skin' },
            { bone: `forearm${side}`, size: [0.22, 0.1, 0.22], at: [0, -0.17, 0], color: 'leather', kind: 'deco' },
            { bone: `hand${side}`, size: [0.2, 0.16, 0.2], at: [0, -0.07, 0], color: 'skin' }
        );
    }
    for (const [side, sx] of [['R', -1], ['L', 1]]) {
        bones.push(
            { name: `thigh${side}`, parent: 'pelvis', at: [0.14 * sx, 0, 0] },
            { name: `shin${side}`, parent: `thigh${side}`, at: [0, -0.36, 0] },
            // The ankle, in the middle of the boot: a foot can stay flat,
            // or stand on its toe or heel, whatever the leg does.
            { name: `foot${side}`, parent: `shin${side}`, at: [0, -0.29, 0] }
        );
        parts.push(
            { bone: `thigh${side}`, size: [0.26, 0.38, 0.28], at: [0, -0.18, 0], color: 'pants' },
            { bone: `shin${side}`, size: [0.25, 0.24, 0.27], at: [0, -0.11, 0], color: 'pants' },
            { bone: `foot${side}`, size: [0.28, 0.14, 0.34], at: [0, 0, 0.03], color: 'boots', tag: 'foot' }
        );
    }
    return Object.freeze({
        bones, parts,
        mounts: {
            handR: { bone: 'handR', at: [0, -0.08, 0] },
            handL: { bone: 'handL', at: [0, -0.08, 0] },
            back: { bone: 'chest', at: [0, 0.3, -0.17] },
            waist: { bone: 'pelvis', at: [0.28, 0.06, 0] },
            head: { bone: 'head', at: [0, 0.5, 0] },
            // Armor plates (models/equipment.js).
            chest: { bone: 'chest', at: [0, 0.26, 0] },
            shoulderR: { bone: 'upperArmR', at: [0, 0, 0] },
            shoulderL: { bone: 'upperArmL', at: [0, 0, 0] }
        },
        // Colour swaps by role: in a duel each phone draws its own fighter
        // as usual and the other one as the rival.
        looks: { rival: { tunic: 'rivalTunic', tunicTrim: 'rivalTrim' } },
        // Animation layers (design.md 2.4): legs walk while
        // the upper body holds a shield or attacks.
        layers: {
            lower: ['base', 'pelvis', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL'],
            upper: ['chest', 'head', 'upperArmR', 'forearmR', 'handR', 'upperArmL', 'forearmL', 'handL']
        }
    });
})();
