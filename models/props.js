// Models of the world's props (design.md 6): the chest (a rig with a
// hinged lid), a boss's grave, the shapes of things lying on the ground, the roof colour of
// each building, and the colours of a portal's opening. Data only; the
// renderer builds them.
const propModels = Object.freeze({
    // About 0.8 x 0.75 blocks; faces +z. The lid hinges at the back.
    chest: {
        bones: [
            { name: 'base', parent: null, at: [0, 0, 0] },
            { name: 'lid', parent: 'base', at: [0, 0.5, -0.3] }
        ],
        parts: [
            { bone: 'base', size: [0.8, 0.5, 0.6], at: [0, 0.25, 0], color: 'chestWood' },
            { bone: 'base', size: [0.84, 0.08, 0.64], at: [0, 0.06, 0], color: 'chestDark', kind: 'deco' },
            { bone: 'base', size: [0.1, 0.52, 0.64], at: [-0.26, 0.26, 0], color: 'gold', kind: 'deco' },
            { bone: 'base', size: [0.1, 0.52, 0.64], at: [0.26, 0.26, 0], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.84, 0.22, 0.64], at: [0, 0.11, 0.3], color: 'chestWood' },
            { bone: 'lid', size: [0.1, 0.24, 0.66], at: [-0.26, 0.11, 0.3], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.1, 0.24, 0.66], at: [0.26, 0.11, 0.3], color: 'gold', kind: 'deco' },
            { bone: 'lid', size: [0.14, 0.14, 0.04], at: [0, 0.0, 0.63], color: 'gold', kind: 'deco' }
        ],
        mounts: {},
        // Fully open, the lid swings back this far.
        open: { lid: { rx: -1.9 } }
    },
    // A boss's grave: a mound of earth with a headstone at its back, a
    // glowing mark cut in the stone. Faces +z (the mound in front).
    grave: {
        bones: [{ name: 'base', parent: null, at: [0, 0, 0] }],
        parts: [
            { bone: 'base', size: [0.7, 0.16, 0.9], at: [0, 0.08, 0.05], color: 'dirt' },
            { bone: 'base', size: [0.5, 0.1, 0.66], at: [0, 0.21, 0.08], color: 'dirt' },
            { bone: 'base', size: [0.66, 0.14, 0.2], at: [0, 0.07, -0.36], color: 'stoneDark' },
            { bone: 'base', size: [0.54, 0.86, 0.14], at: [0, 0.57, -0.36], color: 'stone' },
            { bone: 'base', size: [0.38, 0.12, 0.14], at: [0, 1.06, -0.36], color: 'stone' },
            { bone: 'base', size: [0.08, 0.36, 0.02], at: [0, 0.66, -0.28], color: 'portalGlow', kind: 'deco' },
            { bone: 'base', size: [0.24, 0.08, 0.02], at: [0, 0.74, -0.28], color: 'portalGlow', kind: 'deco' }
        ],
        mounts: {}
    },
    // Loot on the ground: a small box per item, in blocks.
    drops: {
        gold: { size: [0.2, 0.14, 0.2], color: 'gold' },
        goblin_ear: { size: [0.22, 0.1, 0.14], color: 'earItem' },
        wolf_pelt: { size: [0.3, 0.06, 0.24], color: 'peltItem' },
        chief_tusk: { size: [0.1, 0.1, 0.3], color: 'tuskItem' },
        king_fang: { size: [0.08, 0.08, 0.26], color: 'fangItem' },
        iron_ore: { size: [0.2, 0.16, 0.18], color: 'ore' },
        crystal: { size: [0.1, 0.24, 0.1], color: 'crystal' },
        herb: { size: [0.22, 0.08, 0.16], color: 'herbLight' },
        spider_silk: { size: [0.2, 0.12, 0.2], color: 'silkItem' }
    },
    // Torches that stand in a map (core/props.js `lamp`), in blocks: boxes
    // ({ size, at, color }) and where the flame burns. `stand` from the
    // middle of its cell's ground; `wall` from the foot of the wall's face,
    // +z out of the wall.
    lamps: {
        stand: {
            parts: [
                { size: [0.34, 0.08, 0.34], at: [0, 0.04, 0], color: 'steelDark' },
                { size: [0.12, 1.14, 0.12], at: [0, 0.65, 0], color: 'woodDark' },
                { size: [0.3, 0.14, 0.3], at: [0, 1.29, 0], color: 'steelDark' },
                { size: [0.2, 0.08, 0.2], at: [0, 1.4, 0], color: 'torchWrap' }
            ],
            flame: [0, 1.52, 0]
        },
        wall: {
            parts: [
                { size: [0.12, 0.08, 0.26], at: [0, 1.3, 0.13], color: 'steelDark' },
                { size: [0.1, 0.46, 0.1], at: [0, 1.45, 0.24], color: 'woodDark' },
                { size: [0.16, 0.12, 0.16], at: [0, 1.72, 0.24], color: 'torchWrap' }
            ],
            flame: [0, 1.86, 0.24]
        }
    },
    // Roof colour by building kind (multiplies the roof tile).
    roofs: { hotSpring: 'roofSpring', smithy: 'roofSmithy', shop: 'roofShop', storage: 'roofStorage' },
    // A portal's opening: open, or waiting on a boss.
    portal: { open: 'portalGlow', locked: 'portalLocked' }
});
