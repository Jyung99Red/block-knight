// World entities (design.md 6.2): everything in the world that
// is not one of the fighters -- the training dummy, monsters, buildings,
// portals, chests, bosses' graves, things dropped, dry thickets, lamps and
// resources to gather (ore, crystal, herbs) -- is one plain record on
// sim.entities: { id, type, x, y, h, facing, radius, solid, ... }. What a
// record does comes from the kit of its type: core/dummy.js,
// core/monster.js, and core/props.js for buildings, portals, chests and
// drops. A kit may have tick, hurtboxes and struck (things that can be hit),
// offer and use (things the interact key works on: core/interact.js), and
// present (still in the world; a fallen monster is not).
//
// Also the world's dice: one seeded generator kept in the simulation
// (`sim.seed`), so loot rolls replay the same from the same start, and a
// counter for new ids (`sim.serial`).
const entityKit = (() => {
    const KITS = {
        dummy: () => dummyKit, monster: () => monsterKit,
        building: () => propKit, portal: () => propKit, chest: () => propKit, grave: () => propKit, drop: () => propKit, brush: () => propKit, node: () => propKit, lamp: () => propKit
    };
    function kitOf(e) {
        const kit = KITS[e?.type];
        if (!kit) throw new Error(`Unknown entity type ${e?.type}`);
        return kit();
    }
    const present = e => { const kit = kitOf(e); return kit.present ? kit.present(e) : true; };
    function byId(sim, id) { return sim.entities.find(e => e.id === id) || null; }
    function ofType(sim, type) { return sim.entities.filter(e => e.type === type); }
    // Bodies in the way of `self` moving: the fighters still standing and
    // every solid entity still there.
    function obstacles(sim, self) {
        const out = [];
        for (const f of sim.fighters) if (f !== self && !f.down) out.push(f);
        for (const e of sim.entities) if (e !== self && e.solid && present(e)) out.push(e);
        return out;
    }
    function add(sim, e) { sim.entities.push(e); return e; }
    function remove(sim, e) { const i = sim.entities.indexOf(e); if (i >= 0) sim.entities.splice(i, 1); }
    // A new id with a prefix, unique in this world.
    function nextId(sim, prefix) { sim.serial = (sim.serial || 0) + 1; return `${prefix}${sim.serial}`; }
    // One step of everything in the world, in a fixed order.
    function tick(sim, dt) {
        dummyKit.tick(sim, dt);
        monsterKit.tick(sim, dt);
        propKit.tick(sim, dt);
    }
    // A number in [0, 1) from the world's own generator (mulberry32).
    function random(sim) {
        const a = sim.seed = (sim.seed + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    return { kitOf, present, byId, ofType, obstacles, add, remove, nextId, tick, random };
})();
