// The world simulation: plain data advanced in fixed steps. It knows the
// five controls (move stick, A, B, offhand, interact) and nothing about the
// screen. Every value is serialisable except `terrain` and `rigs`, which are
// shared data derived from the map and the models. The fighters' rules are
// in core/fighter.js; everything else in the world is an entity
// (core/entity.js): the training dummy, monsters, buildings, portals,
// chests and drops. `events` is what happened, for sounds and effects to
// read and drain.
//
// `fighters` are the people playing: one in PVE ('player'), two in a duel
// ('host' and 'guest', design.md 8), and in a shared adventure the host's
// 'player' and a 'guest' who joined (design.md 10: `join`, `part`).
// sim.player, sim.input and sim.stats are the first fighter's own;
// sim.monsters and sim.dummy are the entities of those types (getters,
// left out of snapshots). `bags`: what a guest carries ({ inventory,
// loadout } by id, core/props.js bagOf); the host's is the progress. Two
// players may also be in two regions, one world each (design.md 10: the
// host's phone runs both, sharing one progress); a world may then hold
// the guest alone (`create` with `self`), and `help` says a player of the
// party still stands in the other one: everyone here down does not end the
// trip, the fallen wait to be picked up (or give up). `mirror` (set by core/coop.js, never in a snapshot): this
// world is a guest's copy of the host's, which decides everything -- no
// blow lands, nothing is picked up, used or changed in it.
// `region` is the map's key in gameConfig.maps; `progress` the world's
// progress carried between regions (core/save.js: bosses down, chests
// opened, what is carried), never part of a duel's snapshot.
// `result` is null until the fight is decided. PVE: { outcome: 'lose'
// (the player down), at }; a duel: { winner: 'host' | 'guest' | null (both
// fell in the same step), at, conceded? }.
const worldSim = (() => {
    const BUTTONS = fighterKit.BUTTONS;
    const DUEL_IDS = Object.freeze(['host', 'guest']);
    const FIRST = {
        player: { get: s => s.fighters[0] }, input: { get: s => s.fighters[0].input }, stats: { get: s => s.fighters[0].stats },
        dummy: { get: s => s.entities.find(e => e.type === 'dummy') || null },
        // Setting the list replaces every monster (tests keep only some).
        monsters: { get: s => s.entities.filter(e => e.type === 'monster'), set: (s, list) => { s.entities = [...s.entities.filter(e => e.type !== 'monster'), ...list]; } }
    };
    function aliases(sim) {
        for (const [key, { get, set }] of Object.entries(FIRST)) {
            Object.defineProperty(sim, key, { get() { return get(this); }, set: set ? function (v) { set(this, v); } : undefined, enumerable: false, configurable: true });
        }
        return sim;
    }
    const regionOf = map => Object.keys(gameConfig.maps).find(id => gameConfig.maps[id] === map) || '';

    // A world for map `region` (a key of gameConfig.maps; or `map` itself).
    // progress: the save (core/save.js) -- bosses down stay down, opened
    // chests stay open, saved terrain edits are put back. arrival: the region
    // just left, to stand at the portal back there (else the map's spawn).
    // carry: { hp } brought along. seed: the world's dice. spot: { x, y,
    // facing } to stand at instead (the base rebuilt after a change of gear).
    // loadout: the gear worn (else the save's, else the starter gear); the
    // fighter's stats are the base plus that gear (core/inventory.js).
    // A duel puts one fighter on each of the map's first two spawns, each
    // facing the other; `loadouts` are their gear, [host, guest] (each one
    // picked from duelKit's fair sets; the starter gear when left out),
    // and `dayFrom` the hour it is played at, as seconds into the day
    // (core/daytime.js). `self`, `bag`: the one fighter of an adventure
    // is someone other than the player -- a guest in a region of its own,
    // with its own bag (design.md 10).
    function create({ map = null, region = null, progress = null, arrival = null, carry = null, spot = null, seed = 1, loadout = null, duel = false, loadouts = null, dayFrom = 0, self = 'player', bag = null } = {}) {
        if (!map) map = gameConfig.maps[region || 'clearing'];
        if (!map) throw new Error(`Unknown map ${region}`);
        region = region || regionOf(map);
        const terrain = terrainKit.fromRows(map.rows, gameConfig.world.unitsPerBlock, map.floor || '.');
        if (duel && terrain.spawns.length < 2) throw new Error('A duel needs a map with two spawns');
        if (duel) progress = null;
        loadout = { ...(duel ? inventoryKit.starter() : loadout || progress?.loadout || inventoryKit.starter()) };
        if (progress?.edits?.[region]) terrainKit.applyEdits(terrain, progress.edits[region]);
        propKit.regrow(terrain, progress, region);
        const ids = duel ? DUEL_IDS : [self];
        const gear = ids.map((_, i) => ({ ...(duel ? loadouts?.[i] || inventoryKit.starter() : loadout) }));
        const spots = ids.map((_, i) => terrainKit.cellCentre(terrain, terrain.spawns[i].col, terrain.spawns[i].row));
        const entry = duel ? null : spot || (arrival ? propKit.arrival(map, terrain, arrival) : null);
        if (entry) spots[0] = entry;
        const fighters = ids.map((id, i) => {
            const at = spots[i], other = spots[1 - i];
            return fighter(id, gear[i], at, duel ? Math.atan2(other.y - at.y, other.x - at.x) : entry ? entry.facing : Math.PI / 2, !duel && !!map.training);
        });
        if (carry && Number.isFinite(carry.hp)) fighters[0].hp = Math.max(1, Math.min(fighters[0].maxHp, Math.round(carry.hp)));
        const saved = progress || {};
        // clock: seconds played (outside duels), which grows resources back.
        const world = {
            bosses: { ...saved.bosses }, revived: { ...saved.revived }, chests: { ...saved.chests },
            inventory: { gold: saved.inventory?.gold || 0, items: { ...saved.inventory?.items } }, loadout: { ...loadout },
            clock: saved.clock || 0, gathered: { ...saved.gathered }
        };
        const dummy = dummyKit.create(terrain, map.dummyFacing ?? Math.PI);
        // A boss once down stays down, till its grave calls it back.
        const monsters = terrain.monsters.map((spawn, i) => monsterKit.create(terrain, spawn, i)).filter(m => !(m.boss && world.bosses[m.kind] && !world.revived[m.kind]));
        const kinds = [...new Set(terrain.monsters.map(m => m.kind))];
        return aliases({
            time: 0, tick: 0, terrain, map: map.name || '', region, duel, seed: seed >>> 0, serial: 0, dayFrom: duel ? dayFrom : 0,
            rigs: { fighters: Object.fromEntries(ids.map((id, i) => [id, rigOf(gear[i])])), dummy: dummy ? dummyKit.rig() : null, monsters: Object.fromEntries(kinds.map(k => [k, monsterKit.rig(k)])) },
            fighters, entities: [...(dummy ? [dummy] : []), ...monsters, ...propKit.place(map, terrain, saved, region)],
            bags: bag ? { [self]: bag } : {}, help: false, progress: world, events: [], result: null
        });
    }
    // Each fighter's skeleton carries its own gear (the blade decides reach).
    const rigOf = gear => rigKit.build(playerModel, { scale: gameConfig.models.playerScale, equipment: equipmentModels.forLoadout(gear) });
    // A fighter `id` in `gear`, standing at `at` facing `facing`.
    function fighter(id, gear, at, facing, endless) {
        return fighterKit.init({
            x: at.x, y: at.y, h: space.groundHeight(at.x, at.y), facing, radius: gameConfig.player.radius,
            // gait: walk/run cycle phase, in cycles. pace: share of the
            // walking speed built up from a standstill. moveTime: seconds
            // of unbroken walking, which turns into a run.
            speed: 0, pace: 0, gait: 0, moveBlend: 0, runBlend: 0, moveTime: 0,
            loadout: { ...gear }
        }, { id, endless, stats: inventoryKit.statsOf(gear) });
    }

    // ---- a shared adventure (design.md 10): a second player comes and goes ----
    // Fighter `id` comes into the world in `loadout` with its own `bag` ({
    // inventory, loadout }: what it picks up and uses is its own, not the
    // world's progress; none for the host), standing at `spot` ({ x, y,
    // facing }; else beside the first fighter), with `hp` (else whole; at
    // least 1); `first`: put first (the host walking into its guest's
    // world: sim.player is the host again). Returns it.
    function join(sim, { id, loadout, bag = null, spot = null, hp = null, first = false }) {
        if (sim.duel || sim.fighters.some(f => f.id === id)) throw new Error(`Fighter ${id} cannot join`);
        const at = spot || beside(sim, sim.fighters[0]);
        const f = fighter(id, loadout, at, at.facing ?? sim.fighters[0].facing, !!gameConfig.maps[sim.region]?.training);
        if (Number.isFinite(hp)) f.hp = Math.max(1, Math.min(f.maxHp, Math.round(hp)));
        if (first) sim.fighters.unshift(f); else sim.fighters.push(f);
        sim.rigs.fighters[id] = rigOf(loadout);
        if (bag) sim.bags[id] = bag;
        return f;
    }
    // Fighter `id` leaves (never the last one). Whether it was there.
    function part(sim, id) {
        const i = sim.fighters.findIndex(f => f.id === id);
        if (i < 0 || sim.fighters.length < 2) return false;
        sim.fighters.splice(i, 1);
        delete sim.rigs.fighters[id];
        delete sim.bags[id];
        return true;
    }
    // Where someone joining fighter `f` stands: coop.beside from it to its
    // left, else its right, behind, ahead -- the first open spot there is
    // a straight way to; else just by it.
    function beside(sim, f) {
        const d = gameConfig.coop.beside, t = sim.terrain, others = entityKit.obstacles(sim, f);
        for (const turn of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
            const a = f.facing + turn, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
            if (!terrainKit.openWay(t, f.x, f.y, x, y, f.radius)) continue;
            if (others.some(o => Math.hypot(o.x - x, o.y - y) < o.radius + f.radius)) continue;
            return { x, y, facing: f.facing };
        }
        return { x: f.x + 1, y: f.y, facing: f.facing };
    }

    // Commands from the input layer or the network, for fighter `who`
    // (index, the first by default): { type: 'move', x, y } with
    // |(x, y)| <= 1 on the ground plane; { type: 'press' | 'release', button }.
    // Returns whether it was taken.
    function command(sim, cmd, who = 0) {
        const p = sim.fighters[who];
        if (!p || !cmd || typeof cmd !== 'object') return false;
        if (cmd.type === 'move') {
            if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return false;
            const len = Math.hypot(cmd.x, cmd.y), k = len > 1 ? 1 / len : 1;
            p.input.move = { x: cmd.x * k, y: cmd.y * k };
            return true;
        }
        if (cmd.type === 'press' || cmd.type === 'release') {
            const b = Object.hasOwn(p.input.buttons, cmd.button) ? p.input.buttons[cmd.button] : null;
            if (!b) return false;
            if (cmd.type === 'press') {
                if (b.held) return false;
                b.held = true; b.presses++;
                fighterKit.press(sim, p, cmd.button);
                return true;
            }
            if (!b.held) return false;
            b.held = false;
            fighterKit.release(sim, p, cmd.button);
            return true;
        }
        return false;
    }

    // The nearest fighter still standing (and passing `test`, if given), or null.
    function nearestFighter(sim, from, test = null) {
        let best = null, far = Infinity;
        for (const f of sim.fighters) {
            const d = Math.hypot(f.x - from.x, f.y - from.y);
            if (!f.down && d < far && (!test || test(f, d))) { far = d; best = f; }
        }
        return best;
    }

    // One step. `judge` false: swings pass through and nothing is decided
    // (a guest predicting between the host's snapshots; a mirror never judges).
    // `clock` false: the time played is kept by another world sharing this
    // one's progress.
    function step(sim, dt, { judge = !sim.mirror, clock = true } = {}) {
        sim.time += dt; sim.tick++;
        if (!sim.duel && sim.progress && clock) sim.progress.clock += dt;
        for (const f of sim.fighters) fighterKit.tick(sim, f, dt);
        fighterKit.settle(sim, judge);
        entityKit.tick(sim, dt);
        for (const f of sim.fighters) f.h = space.groundHeight(f.x, f.y);
        if (!sim.result && judge) decide(sim);
    }
    function decide(sim) {
        if (sim.duel) {
            const up = sim.fighters.filter(f => !f.down);
            if (up.length > 1) return;
            sim.result = { winner: up[0]?.id ?? null, at: sim.time };
            combatKit.emit(sim, 'result', { winner: sim.result.winner });
            return;
        }
        // A world has no end to win; falling is the one way a trip ends --
        // for everyone at once, once the last one standing falls (design.md
        // 10), here and in the partner's region (`help`).
        if (sim.fighters.every(f => f.down) && !sim.help) { sim.result = { outcome: 'lose', at: sim.time }; combatKit.emit(sim, 'result', { outcome: 'lose' }); }
    }
    // A duel given up by fighter `id`: the other one wins.
    function concede(sim, id) {
        if (!sim.duel || sim.result || !DUEL_IDS.includes(id)) return false;
        sim.result = { winner: DUEL_IDS.find(other => other !== id), at: sim.time, conceded: id };
        combatKit.emit(sim, 'result', { winner: sim.result.winner, conceded: id });
        return true;
    }
    // How the fight ended for fighter `id`: 'win' | 'lose' | 'draw', or null.
    function outcome(sim, id = 'player') {
        const r = sim.result;
        if (!r) return null;
        if (!sim.duel) return r.outcome;
        return r.winner === null ? 'draw' : r.winner === id ? 'win' : 'lose';
    }

    // The state as plain data (what a host sends), and back. A snapshot
    // has everything but the terrain, the rigs, the progress, the events
    // and the mirror mark; restoring keeps the world it is written into.
    const STATIC = new Set(['terrain', 'rigs', 'events', 'progress', 'mirror']);
    function snapshot(sim) {
        const out = {};
        for (const [key, value] of Object.entries(sim)) if (!STATIC.has(key)) out[key] = value;
        return JSON.parse(JSON.stringify(out));
    }
    function restore(sim, snap) {
        const copy = JSON.parse(JSON.stringify(snap));
        for (const key of Object.keys(sim)) if (!STATIC.has(key)) sim[key] = copy[key];
        return sim;
    }
    // Take the events since the last call.
    function drain(sim) { return sim.events.splice(0); }
    return { BUTTONS, DUEL_IDS, create, join, part, beside, command, nearestFighter, step, concede, outcome, snapshot, restore, drain };
})();
