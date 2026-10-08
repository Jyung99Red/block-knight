// Items, gear and trade (design.md 7), as pure rules on the world's
// progress ({ inventory: { gold, items }, loadout }, core/save.js): what
// the gear worn adds to the base stats, putting gear on and off, the shop
// (buying supplies and the ring of stealth, selling materials) and the
// smithy (making gear from materials and gold). There is one bag: what is
// owned is what is carried (the base's storage shows it). Gear is never
// lost; potions are used up.
// Every change returns '' when done, or why not (a line for the screen).
const inventoryKit = (() => {
    const SLOTS = Object.freeze(['main', 'offhand', 'armor', 'accessory']);
    const STATS = Object.freeze(['maxHp', 'atk', 'def']);
    const I = () => gameConfig.items;
    const itemOf = id => (id && Object.hasOwn(gameConfig.items, id) ? gameConfig.items[id] : null);
    const count = (progress, id) => (id === 'gold' ? progress.inventory.gold : progress.inventory.items[id] || 0);
    function give(progress, id, n) {
        if (id === 'gold') { progress.inventory.gold += n; return; }
        const left = (progress.inventory.items[id] || 0) + n;
        if (left > 0) progress.inventory.items[id] = left; else delete progress.inventory.items[id];
    }
    // A fresh copy of the starter loadout.
    function starter() { return { ...gameConfig.gear.starter }; }
    // Base stats plus what every item worn adds.
    function statsOf(loadout) {
        const out = { ...gameConfig.combat.fighters.base };
        for (const slot of SLOTS) {
            const item = itemOf(loadout?.[slot]);
            if (item?.stats) for (const k of STATS) out[k] += item.stats[k] || 0;
        }
        return out;
    }
    // What the offhand key does with what is worn there, or null.
    function offhandOf(loadout) { return itemOf(loadout?.offhand)?.offhand || null; }
    // What a ring of stealth worn does ({ cooldown }), or null without one.
    function stealthOf(loadout) { return itemOf(loadout?.accessory)?.stealth || null; }
    // The weapon type of the main hand (combo.weapons), which decides the
    // move tree; the starter sword's type when nothing fits.
    function weaponOf(loadout) {
        const type = itemOf(loadout?.main)?.weapon;
        return type && Object.hasOwn(gameConfig.combo.weapons, type) ? type : itemOf(gameConfig.gear.starter.main).weapon;
    }

    // ---- gear ----
    // Can `id` go in `slot` now? null takes the slot off (not the main hand).
    function canEquip(progress, slot, id) {
        if (!SLOTS.includes(slot)) return '没有这个装备栏';
        if (id === null) return slot === 'main' ? '主手不能空着' : '';
        const item = itemOf(id);
        if (!item || item.slot !== slot) return '放不进这一栏';
        // Supplies (potions) may sit there with none left: the key greys out.
        if (item.kind !== 'supply' && count(progress, id) < 1) return '还没有';
        return '';
    }
    function equip(progress, slot, id) {
        const why = canEquip(progress, slot, id);
        if (!why) progress.loadout[slot] = id;
        return why;
    }

    // ---- the shop ----
    function canBuy(progress, id) {
        const item = itemOf(id);
        if (!item || !item.price) return '不卖这个';
        if (item.max && count(progress, id) >= item.max) return item.max === 1 ? '已经有了' : `最多带 ${item.max} 个`;
        if (progress.inventory.gold < item.price) return '金币不够';
        return '';
    }
    function buy(progress, id) {
        const why = canBuy(progress, id);
        if (!why) { give(progress, 'gold', -itemOf(id).price); give(progress, id, 1); }
        return why;
    }
    // Sell `n` of a material (all of them when n is Infinity).
    function canSell(progress, id, n = 1) {
        const item = itemOf(id);
        if (!item || !item.sell) return '不收这个';
        if (count(progress, id) < Math.min(n, 1) || !(n >= 1)) return '没有可卖的';
        return '';
    }
    function sell(progress, id, n = 1) {
        const why = canSell(progress, id, n), k = Math.min(n, count(progress, id));
        if (!why) { give(progress, id, -k); give(progress, 'gold', itemOf(id).sell * k); }
        return why;
    }

    // ---- the smithy ----
    // What making `id` still lacks: [{ id, need, have }] for gold and each
    // material.
    function needs(progress, id) {
        const r = itemOf(id)?.recipe;
        if (!r) return [];
        return [['gold', r.gold || 0], ...Object.entries(r.materials || {})].filter(([, n]) => n > 0).map(([m, need]) => ({ id: m, need, have: count(progress, m) }));
    }
    function canCraft(progress, id) {
        const item = itemOf(id);
        if (!item?.recipe) return '打造不了这个';
        if (item.max && count(progress, id) >= item.max) return '已经有了';
        if (needs(progress, id).some(n => n.have < n.need)) return '材料不够';
        return '';
    }
    function craft(progress, id) {
        const why = canCraft(progress, id);
        if (!why) { for (const n of needs(progress, id)) give(progress, n.id, -n.need); give(progress, id, 1); }
        return why;
    }
    // Ids by kind, in catalogue order: what the shop sells, what it buys,
    // what the smithy makes, the gear for a slot.
    const list = test => Object.keys(I()).filter(id => test(I()[id], id));
    const forSale = () => list(item => !!item.price);
    const wanted = () => list(item => !!item.sell);
    const recipes = () => list(item => !!item.recipe);
    const gearFor = slot => list(item => item.slot === slot);
    return { SLOTS, STATS, itemOf, count, give, starter, statsOf, offhandOf, stealthOf, weaponOf, canEquip, equip, canBuy, buy, canSell, sell, needs, canCraft, craft, forSale, wanted, recipes, gearFor };
})();
