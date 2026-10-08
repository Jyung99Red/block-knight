// Equipment models, hung on a model's mount points (design.md
// 7.2). Each part sits in the mount's frame; for a hand mount +z points along
// the held item. Gear is built by item id (game_config.js `items`); a
// weapon's blade length comes from there, since it decides the reach.
// Armor may add plates (drawn only: the body boxes under them are what is
// hit) and swap the tunic's colours (`lookOf`); accessories are not drawn.
const equipmentModels = (() => {
    const blade = id => gameConfig.items[id].blade;
    // A sword: grip, pommel, guard and blade (the blade is the weapon box).
    function sword(bladeLength = blade('wooden_sword'), { metal = 'wood', guard = 'woodDark', id = 'wooden_sword' } = {}) {
        return {
            id, mount: 'handR', parts: [
                { size: [0.07, 0.07, 0.26], at: [0, 0, 0], color: 'leather', kind: 'deco' },
                { size: [0.1, 0.1, 0.07], at: [0, 0, -0.16], color: guard, kind: 'deco' },
                { size: [0.36, 0.07, 0.08], at: [0, 0, 0.16], color: guard, kind: 'deco' },
                { size: [0.12, 0.05, bladeLength], at: [0, 0, 0.2 + bladeLength / 2], color: metal, kind: 'weapon' }
            ]
        };
    }
    // A short blade: a small guard and a narrow, short blade.
    function dagger(bladeLength = blade('assassin_dagger')) {
        return {
            id: 'assassin_dagger', mount: 'handR', parts: [
                { size: [0.06, 0.06, 0.22], at: [0, 0, 0.01], color: 'daggerGrip', kind: 'deco' },
                { size: [0.22, 0.06, 0.06], at: [0, 0, 0.14], color: 'steelDark', kind: 'deco' },
                { size: [0.09, 0.04, bladeLength], at: [0, 0, 0.17 + bladeLength / 2], color: 'steel', kind: 'weapon' }
            ]
        };
    }
    // Carried on the outside of the left forearm, face outwards; big enough
    // to hide behind (user, 2026-10-03: larger). Drawn only: guarding goes by
    // the front arc, not by the board (design.md 4.3).
    function shield({ face = 'wood', band = 'steelDark', boss = 'steel', id = 'wooden_shield' } = {}) {
        return {
            id, mount: 'handL', parts: [
                { size: [0.08, 0.78, 0.66], at: [0.16, 0.2, 0.02], color: face, kind: 'shield' },
                { size: [0.02, 0.78, 0.07], at: [0.21, 0.2, 0.02], color: band, kind: 'deco' },
                { size: [0.02, 0.07, 0.66], at: [0.21, 0.2, 0.02], color: band, kind: 'deco' },
                { size: [0.06, 0.17, 0.17], at: [0.225, 0.2, 0.02], color: boss, kind: 'deco' }
            ]
        };
    }
    // A torch in the left hand: a stick, a wrapped head, and a flame (tagged
    // `flame`: drawn only while lit).
    function torch() {
        return {
            id: 'torch', mount: 'handL', parts: [
                { size: [0.07, 0.07, 0.5], at: [0, 0, 0.12], color: 'woodDark', kind: 'deco' },
                { size: [0.12, 0.12, 0.14], at: [0, 0, 0.42], color: 'torchWrap', kind: 'deco' },
                { size: [0.1, 0.1, 0.16], at: [0, 0, 0.55], color: 'flame', kind: 'deco', tag: 'flame' },
                { size: [0.06, 0.06, 0.1], at: [0, 0, 0.66], color: 'flameTip', kind: 'deco', tag: 'flame' }
            ]
        };
    }
    // A potion flask in the left hand.
    function flask() {
        return {
            id: 'potion', mount: 'handL', parts: [
                { size: [0.14, 0.14, 0.16], at: [0, 0, 0.1], color: 'potionRed', kind: 'deco' },
                { size: [0.06, 0.06, 0.08], at: [0, 0, 0.22], color: 'glass', kind: 'deco' },
                { size: [0.07, 0.07, 0.03], at: [0, 0, 0.27], color: 'cork', kind: 'deco' }
            ]
        };
    }
    // Iron armor: a breastplate, a belt plate and shoulder plates.
    function ironArmor() {
        return [
            { id: 'iron_armor', mount: 'chest', parts: [
                { size: [0.6, 0.34, 0.36], at: [0, 0.08, 0], color: 'steel', kind: 'deco' },
                { size: [0.18, 0.12, 0.02], at: [0, 0.06, 0.185], color: 'steelDark', kind: 'deco' }
            ] },
            { id: 'iron_armor', mount: 'shoulderR', parts: [{ size: [0.3, 0.12, 0.3], at: [0, 0.03, 0], color: 'steelDark', kind: 'deco' }] },
            { id: 'iron_armor', mount: 'shoulderL', parts: [{ size: [0.3, 0.12, 0.3], at: [0, 0.03, 0], color: 'steelDark', kind: 'deco' }] }
        ];
    }
    const BUILDERS = {
        wooden_sword: () => sword(blade('wooden_sword')),
        iron_sword: () => sword(blade('iron_sword'), { metal: 'steel', guard: 'gold', id: 'iron_sword' }),
        assassin_dagger: () => dagger(),
        wooden_shield: () => shield(),
        iron_shield: () => shield({ face: 'steelDark', band: 'steel', boss: 'gold', id: 'iron_shield' }),
        torch: () => torch(),
        potion: () => flask(),
        cloth_armor: () => [],
        iron_armor: () => ironArmor(),
        chief_charm: () => [],
        fang_necklace: () => [],
        stealth_ring: () => []
    };
    // Colour swaps a piece of armor makes (the cloth armor is the model's own).
    const LOOKS = { iron_armor: { tunic: 'ironTunic', tunicTrim: 'steelDark' } };
    // Items a body carries and wears, from a loadout { main, offhand, armor,
    // accessory }.
    function forLoadout(loadout) {
        return ['main', 'offhand', 'armor', 'accessory'].map(slot => loadout[slot]).filter(Boolean).flatMap(id => {
            if (!BUILDERS[id]) throw new Error(`No model for ${id}`);
            return BUILDERS[id]();
        });
    }
    function lookOf(loadout) { return { ...(LOOKS[loadout?.armor] || {}) }; }
    return { sword, dagger, shield, torch, flask, forLoadout, lookOf };
})();
