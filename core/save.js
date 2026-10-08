// The save (design.md 6.6; the 2D version's saves are not read):
// { v, bosses: { kind: true }, revived: { kind: true }, chests: { 'region/chest id': true },
//   inventory: { gold, items: { id: count } }, loadout: { main, offhand,
//   armor, accessory }, edits: { region: [[col, row, kind, level]] },
//   clock, gathered: { 'region/col,row': clock when gathered } }.
// `edits` are the terrain's changes against the map it was generated from
// (core/terrain.js): a burnt thicket stays burnt. Gathered resources are not
// edits: `gathered` says when, against `clock` (seconds played), and they
// grow back (core/props.js). `revived`: a boss down that its grave has
// called back and that has not been beaten since: it is in its region
// again (core/props.js). Where the player stands and their HP are not saved: a
// game always starts in the base, whole. A version 1 save (M5, before
// gear) is read with the starter gear added.
// Pure data in and out; the storage (localStorage in the page, a stand-in
// in tests) is handed in.
const saveKit = (() => {
    const KEY = 'blocky-rpg-save', VERSION = 2;
    const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const whole = v => Number.isSafeInteger(v) && v >= 0;
    // A new game: the starter gear owned and worn.
    function fresh() {
        const loadout = inventoryKit.starter(), items = {};
        for (const id of Object.values(loadout)) if (id) items[id] = 1;
        return { v: VERSION, bosses: {}, revived: {}, chests: {}, inventory: { gold: 0, items }, loadout, edits: {}, clock: 0, gathered: {} };
    }
    // Whatever came out of storage, made safe: unknown bosses, items and
    // maps are dropped, counts must be whole, not negative and within an
    // item's `max`; gear worn must be owned and fit its slot (else the
    // starter piece, or nothing). Anything unreadable, or of an unknown
    // version, is a fresh save.
    function clean(data) {
        const out = fresh();
        if (!obj(data) || (data.v !== VERSION && data.v !== 1)) return out;
        if (obj(data.bosses)) for (const [kind, down] of Object.entries(data.bosses)) if (down === true && gameConfig.monsters[kind]?.boss) out.bosses[kind] = true;
        if (obj(data.revived)) for (const [kind, back] of Object.entries(data.revived)) if (back === true && out.bosses[kind]) out.revived[kind] = true;
        if (obj(data.chests)) for (const [key, open] of Object.entries(data.chests)) if (open === true && gameConfig.maps[key.split('/')[0]] && key.length < 80) out.chests[key] = true;
        const bag = data.inventory;
        if (obj(bag)) {
            if (whole(bag.gold)) out.inventory.gold = bag.gold;
            if (obj(bag.items)) {
                for (const [id, n] of Object.entries(bag.items)) {
                    const item = inventoryKit.itemOf(id);
                    if (item && item.kind !== 'gold' && whole(n) && n > 0) out.inventory.items[id] = Math.min(n, item.max || n);
                }
            }
        }
        // The starter gear is always owned (version 1 saves had none).
        for (const id of Object.values(inventoryKit.starter())) if (id) out.inventory.items[id] = 1;
        if (obj(data.loadout)) {
            for (const slot of inventoryKit.SLOTS) {
                const id = data.loadout[slot] ?? null;
                if (!inventoryKit.canEquip(out, slot, id)) out.loadout[slot] = id;
            }
        }
        if (Number.isFinite(data.clock) && data.clock >= 0) out.clock = data.clock;
        // Only resources still regrowing are worth keeping.
        if (obj(data.gathered)) {
            for (const [key, at] of Object.entries(data.gathered)) {
                const region = key.split('/')[0];
                if (gameConfig.maps[region] && !gameConfig.maps[region].duel && key.length < 40 && Number.isFinite(at) && at <= out.clock && out.clock - at < gameConfig.gather.regrowSeconds) out.gathered[key] = at;
            }
        }
        if (obj(data.edits)) {
            for (const [region, list] of Object.entries(data.edits)) {
                if (!gameConfig.maps[region] || gameConfig.maps[region].duel || !Array.isArray(list)) continue;
                const ok = list.filter(e => Array.isArray(e) && e.length === 4 && whole(e[0]) && whole(e[1]) && Object.hasOwn(terrainKit.KIND, e[2]) && whole(e[3]));
                if (ok.length) out.edits[region] = ok.map(e => [...e]);
            }
        }
        return out;
    }
    // The save after time in world `sim`: its progress, and its region's
    // terrain changes.
    function merge(save, sim) {
        const out = clean(save), p = sim.progress;
        if (p) {
            out.bosses = { ...out.bosses, ...p.bosses };
            // A boss called back is down again once beaten: the world's own word.
            if (p.revived) out.revived = { ...p.revived };
            out.chests = { ...out.chests, ...p.chests };
            out.inventory = { gold: p.inventory.gold, items: { ...p.inventory.items } };
            if (p.loadout) out.loadout = { ...p.loadout };
            if (Number.isFinite(p.clock)) out.clock = Math.max(out.clock, p.clock);
            if (p.gathered) out.gathered = { ...out.gathered, ...p.gathered };
        }
        if (sim.region && !sim.duel) {
            const list = terrainKit.edits(sim.terrain);
            if (list.length) out.edits[sim.region] = list; else delete out.edits[sim.region];
        }
        return clean(out);
    }
    function load(storage) {
        let raw = null;
        try { raw = storage?.getItem(KEY); } catch (_) { /* Storage may be unavailable. */ }
        if (!raw) return fresh();
        try { return clean(JSON.parse(raw)); } catch (_) { return fresh(); }
    }
    function write(storage, save) {
        try { storage.setItem(KEY, JSON.stringify(clean(save))); return true; } catch (_) { return false; }
    }
    function erase(storage) {
        try { storage.removeItem(KEY); } catch (_) { /* Nothing to erase. */ }
        return fresh();
    }
    // Whether a save was ever written here (the title screen's 继续冒险).
    function exists(storage) {
        try { return storage?.getItem(KEY) != null; } catch (_) { return false; }
    }
    return { KEY, VERSION, fresh, clean, merge, load, write, erase, exists };
})();
