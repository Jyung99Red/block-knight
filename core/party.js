// The worlds of a shared adventure on the host's phone (design.md 10).
// Each player goes its own way through the portals (user, 2026-10-10), so
// the guest may be in another region than the host: a world of its own,
// run on the host's phone as well (`apart`) on the same progress (`share`:
// one world's progress, the time played counted once). They meet again in
// one world: whoever comes walks into the other's as it is. A fall in one
// world is waited out while someone stands in the other (`help`, core/sim.js):
// the fallen wait to be picked up, or give up and go back to the base.
// No DOM: the page (ui/app.js) saves before a world is built or left,
// draws the host's world, and tells the guest of its own (core/coop.js).
//
// party: { sim (the host's world), apart (the guest's, when it is in
// another region; else null) }. `make(options)`: a new world from
// worldSim.create options, the page adding the save and the dice.
const partyKit = (() => {
    const guestOf = w => w?.fighters.find(f => f.id === coopKit.GUEST) || null;
    const standing = w => w.fighters.some(f => !f.down);
    function create(sim) { return { sim, apart: null }; }
    // The guest's world (the host's, or its own), or null with no guest.
    const guestWorld = party => party.apart || (guestOf(party.sim) ? party.sim : null);
    const share = party => { if (party.apart) party.apart.progress = party.sim.progress; };
    // One step of every world.
    function step(party, dt) {
        const { sim, apart } = party;
        sim.help = !!apart && standing(apart);
        worldSim.step(sim, dt);
        if (apart) { apart.help = standing(sim); worldSim.step(apart, dt, { clock: false }); }
    }
    // The guest comes (beside the host), and goes.
    function join(party, { loadout, bag }) { return worldSim.join(party.sim, { id: coopKit.GUEST, loadout, bag }); }
    function part(party) {
        if (party.apart) { party.apart = null; return true; }
        return worldSim.part(party.sim, coopKit.GUEST);
    }
    // The host goes to region `id`. mode: 'alone' (a portal, or giving
    // up: a guest by it stays on in the world left, which becomes its
    // world apart; going where the guest is, it walks into the guest's
    // world as it is), 'keep' (the same place rebuilt: a guest by it stays
    // by it, where it stood with `spot`) or 'all' (home once all fell: the
    // guest comes too, wherever it was). `bag`: the guest's. A guest
    // brought along is as hurt as it was when carried (`carry`), else
    // whole. Returns the host's world.
    function moveHost(party, id, { mode = 'keep', arrival = null, carry = null, spot = null, make, bag = null }) {
        const old = party.sim, here = guestOf(old);
        let mate = null;
        if (mode === 'alone' && here) { worldSim.part(old, 'player'); party.apart = old; }
        else if (here) mate = here;
        else if (mode === 'all' && party.apart) { mate = guestOf(party.apart); party.apart = null; }
        if (mode === 'alone' && party.apart?.region === id) {
            party.sim = party.apart; party.apart = null;
            const at = arrival ? propKit.arrival(gameConfig.maps[id], party.sim.terrain, arrival) : null;
            worldSim.join(party.sim, { id: 'player', loadout: old.progress.loadout, first: true, hp: carry?.hp ?? null, spot: at });
        } else party.sim = make({ region: id, arrival, carry, spot });
        if (mate) worldSim.join(party.sim, { id: coopKit.GUEST, loadout: mate.loadout, bag, hp: carry ? mate.hp : null, spot: spot ? { x: mate.x, y: mate.y, facing: mate.facing } : null });
        share(party);
        return party.sim;
    }
    // The guest goes to region `to` (a portal, or giving up): into the
    // host's world if that is where it goes, else a world of its own.
    // `hp`: as hurt as it was, or whole (null). Whether it was anywhere.
    function moveGuest(party, to, { arrival = null, hp = null, make, bag = null }) {
        const from = guestWorld(party), g = guestOf(from);
        if (!g) return false;
        if (from === party.sim) worldSim.part(party.sim, coopKit.GUEST); else party.apart = null;
        if (to === party.sim.region) {
            const at = arrival ? propKit.arrival(gameConfig.maps[to], party.sim.terrain, arrival) : null;
            worldSim.join(party.sim, { id: coopKit.GUEST, loadout: g.loadout, bag, hp, spot: at });
        } else party.apart = make({ region: to, arrival, carry: hp === null ? null : { hp }, self: coopKit.GUEST, loadout: g.loadout, bag });
        share(party);
        return true;
    }
    // May fighter `id` give up (down, waiting for a partner who stands)?
    function mayGiveUp(party, id) {
        const w = id === 'player' ? party.sim : guestWorld(party), f = w?.fighters.find(x => x.id === id);
        return !!f && f.down && !w.result;
    }
    return { create, guestOf, guestWorld, step, join, part, moveHost, moveGuest, mayGiveUp };
})();
