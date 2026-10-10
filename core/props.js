// Props (design.md 6): the world entities that are neither fighters
// nor monsters (core/entity.js).
// - building: a house of `H` blocks with a door; the interact key in front
//   of the door rests (the hot spring) or opens the building's panel.
// - portal: a `P` opening between two `#` pillars; the interact key travels
//   to the region it leads to, once the boss it may wait on is down.
// - chest: opened by holding the interact key, once the boss guarding it is
//   down; it throws out its loot. Opened stays opened (the save).
// - grave: where a boss is at home (user, 2026-10-07; design.md 5). It
//   shows only while the boss is down and gone: props.graveAfter seconds
//   after it falls (its body has sunk), or at once in a region whose boss
//   the save has down. Holding the interact key with the materials the
//   boss asks for (its `revive`) spends them; the grave glows and sinks
//   into the ground over props.graveCall seconds, then the boss rises out
//   of the ground there (core/monster.js phase `rise`), turned to its
//   caller (user, 2026-10-08). Called back is a reset (user, 2026-10-08):
//   the boss is in its region again (the save's `revived`) till it is
//   beaten again, at home and whole in a region built anew, even one left
//   while its grave still glowed. It stays down in the save all the same:
//   what waits on it stays open, its chest stays opened.
//   state: hidden | ready | calling; t: seconds in that state.
// - drop: loot on the ground. It pops out, settles, and is picked up by
//   walking near it: it flies to the one who came close.
// - brush: a dry thicket (a `B` block). The interact key, a torch carried,
//   lights the torch and sets the thicket alight; fire spreads to the
//   thickets next to it, and each burns away to bare ground. The terrain
//   change is an edit, so it stays burnt.
// - node: a resource (`O` iron ore, `X` crystal, `h` herb; design.md 6.5).
//   Holding the interact key gathers it: it throws out its loot and is gone
//   -- rubble where a boulder stood, bare ground for a herb -- until it grows
//   back: once gather.regrowSeconds of play (the progress `clock`) have
//   passed, the next visit to the region finds it again. Where and when it
//   was gathered is kept in the progress (`gathered`), not as an edit.
// - lamp: a torch that always burns (user, 2026-10-06), on a stand (`i`: a
//   post in the way, as a chest is) or on the wall beside its cell (`!`:
//   the wall to the north, else west, east, south). Its light is drawn
//   only; nothing is done with it.
// A map lists its buildings, portals and chests next to its rows; each entry
// must sit on the letters that draw it, so a map cannot disagree with itself.
// The world is shared (design.md 10): a chest opened, a resource gathered,
// a boss called back are the world's, whoever did it; what is picked up,
// drunk or spent goes to or from the bag of the one who did (`bagOf`). In a
// mirror (core/sim.js) nothing is picked up, used, burnt away or called
// back: the host's world does that and its snapshots bring it.
const propKit = (() => {
    const DIRS = Object.freeze({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] });
    // The sides a wall torch looks for its wall on, in order.
    const LAMP_SIDES = ['north', 'west', 'east', 'south'], LAMP_WALLS = ['stone', 'wood', 'portal'];
    const angleOf = side => Math.atan2(DIRS[side][1], DIRS[side][0]);
    const letter = (map, c, r) => map.rows[r]?.[c];
    const emit = (sim, type, data) => combatKit.emit(sim, type, data);
    const bossName = kind => gameConfig.monsters[kind]?.name || kind;
    const isBoss = kind => !!gameConfig.monsters[kind]?.boss;
    // Progress of the world (core/save.js): bosses down, chests opened, what
    // is carried. Duels and tests may have none.
    const progressOf = sim => sim.progress || (sim.progress = { bosses: {}, revived: {}, chests: {}, inventory: { gold: 0, items: {} }, clock: 0, gathered: {} });
    // What fighter `f` carries ({ inventory, loadout }): a guest's own bag,
    // else the world's progress.
    const bagOf = (sim, f) => sim.bags?.[f?.id] || progressOf(sim);
    const nodeKey = (region, c, r) => `${region}/${c},${r}`;
    // What a gathered resource leaves: rubble for a boulder, the map's floor for a plant.
    const spentOf = (terrain, kind) => terrainKit.isSolid(kind) ? terrainKit.KIND.gravel : terrain.floor;
    // Resources of `region` gathered too recently to be back: gone from the
    // terrain before anything is placed on it.
    function regrow(terrain, progress, region) {
        const clock = progress?.clock || 0, wait = gameConfig.gather.regrowSeconds;
        for (const [key, at] of Object.entries(progress?.gathered || {})) {
            const [where, cell] = key.split('/'), [c, r] = (cell || '').split(',').map(Number);
            if (where !== region || clock - at >= wait) continue;
            const [kind] = terrainKit.generated(terrain, c, r);
            if (terrainKit.isResource(kind)) terrainKit.set(terrain, c, r, spentOf(terrain, kind), 0);
        }
    }
    const downed = (sim, kind) => !!progressOf(sim).bosses[kind];

    // ---- placing what a map lists ----
    // The cell in front of a building's door, and the door's own cell.
    function doorOf({ at: [c, r, w, d], door = 'south' }) {
        const mid = { north: [c + (w >> 1), r], south: [c + (w >> 1), r + d - 1], west: [c, r + (d >> 1)], east: [c + w - 1, r + (d >> 1)] }[door];
        if (!mid) throw new Error(`Unknown door side ${door}`);
        return { door: mid, front: [mid[0] + DIRS[door][0], mid[1] + DIRS[door][1]] };
    }
    // Entities for map `map` (as keyed in gameConfig.maps: `region`) on its
    // terrain, given the progress so far. Throws if a list and the letters
    // disagree.
    function place(map, terrain, progress, region) {
        const out = [], centre = (c, r) => terrainKit.cellCentre(terrain, c, r);
        const covered = new Set();
        (map.buildings || []).forEach((b, i) => {
            const B = gameConfig.buildings[b.kind], [c0, r0, w, d] = b.at || [];
            if (!B) throw new Error(`Unknown building ${b.kind}`);
            for (let r = r0; r < r0 + d; r++) for (let c = c0; c < c0 + w; c++) {
                if (letter(map, c, r) !== 'H') throw new Error(`${map.name}: building ${b.kind} needs H at ${c},${r}`);
                covered.add(`${c},${r}`);
            }
            const { door, front } = doorOf(b), side = b.door || 'south';
            // Checked against the map as drawn, not against later edits to it.
            const ground = terrainKit.cellOf(letter(map, front[0], front[1]) ?? '1');
            if (!ground || !terrainKit.isOpen(ground[0])) throw new Error(`${map.name}: the door of ${b.kind} opens into a wall`);
            const at = centre(front[0], front[1]);
            out.push({
                id: `b${i}-${b.kind}`, type: 'building', kind: b.kind, name: B.name, x: at.x, y: at.y, h: 0, facing: angleOf(side), radius: 0, solid: false,
                footprint: { col: c0, row: r0, w, d }, door: side, doorCell: door
            });
        });
        map.rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'H' && !covered.has(`${c},${r}`)) throw new Error(`${map.name}: wall H at ${c},${r} belongs to no building`); }));
        const portals = new Set();
        for (const p of map.portals || []) {
            const [c, r] = p.at || [];
            if (letter(map, c, r) !== 'P') throw new Error(`${map.name}: portal to ${p.to} needs P at ${c},${r}`);
            if (!DIRS[p.facing]) throw new Error(`${map.name}: portal to ${p.to} faces ${p.facing}`);
            if (!gameConfig.maps[p.to]) throw new Error(`${map.name}: portal to unknown map ${p.to}`);
            if (p.requires && !isBoss(p.requires)) throw new Error(`${map.name}: portal waits on ${p.requires}, not a boss`);
            const [dx, dy] = DIRS[p.facing];
            if (letter(map, c - dy, r - dx) !== '#' || letter(map, c + dy, r + dx) !== '#') throw new Error(`${map.name}: portal to ${p.to} needs # pillars either side`);
            portals.add(`${c},${r}`);
            const at = centre(c, r);
            out.push({ id: `p-${p.to}`, type: 'portal', to: p.to, requires: p.requires || null, x: at.x, y: at.y, h: 0, facing: angleOf(p.facing), side: p.facing, radius: 0, solid: false });
        }
        for (const { col, row } of terrain.portals) if (!portals.has(`${col},${row}`)) throw new Error(`${map.name}: P at ${col},${row} is in no portal list`);
        const chests = new Set();
        for (const k of map.chests || []) {
            const [c, r] = k.at || [];
            if (letter(map, c, r) !== 'C') throw new Error(`${map.name}: chest needs C at ${c},${r}`);
            if (!gameConfig.loot[k.loot]) throw new Error(`${map.name}: chest with unknown loot ${k.loot}`);
            if (k.requires && !isBoss(k.requires)) throw new Error(`${map.name}: chest waits on ${k.requires}, not a boss`);
            chests.add(`${c},${r}`);
            const at = centre(c, r), id = `chest-${c}-${r}`, open = !!progress?.chests?.[`${region}/${id}`];
            out.push({
                id, type: 'chest', loot: k.loot, requires: k.requires || null, x: at.x, y: at.y, h: 0, facing: angleOf(k.facing || 'south'),
                radius: gameConfig.props.chestRadius, solid: true, open, t: open ? 99 : 0
            });
        }
        for (const { col, row } of terrain.chests) if (!chests.has(`${col},${row}`)) throw new Error(`${map.name}: C at ${col},${row} is in no chest list`);
        // A grave at each boss's home; already showing where the save has
        // the boss down and not called back.
        terrain.monsters.forEach(({ kind, col, row }, spawn) => {
            if (!isBoss(kind)) return;
            const at = centre(col, row), down = !!progress?.bosses?.[kind] && !progress?.revived?.[kind];
            out.push({
                id: `grave-${col}-${row}`, type: 'grave', boss: kind, spawn, x: at.x, y: at.y, h: 0, facing: angleOf('south'),
                radius: gameConfig.props.graveRadius, solid: down, state: down ? 'ready' : 'hidden', t: down ? 99 : 0, caller: null
            });
        });
        // A wall torch hangs on the first wall round its cell, as drawn: a
        // block at least two high.
        const holds = (c, r) => { const cell = terrainKit.cellOf(letter(map, c, r) ?? '.'); return !!cell && LAMP_WALLS.includes(terrainKit.NAMES[cell[0]]) && cell[1] >= 2; };
        for (const { kind, col, row } of terrain.lamps) {
            const at = centre(col, row), side = kind === 'wall' ? LAMP_SIDES.find(s => holds(col + DIRS[s][0], row + DIRS[s][1])) : null;
            if (kind === 'wall' && !side) throw new Error(`${map.name}: the wall torch at ${col},${row} has no wall beside it`);
            out.push({
                id: `lamp-${col}-${row}`, type: 'lamp', kind, col, row, side, x: at.x, y: at.y, h: 0, facing: side ? angleOf(side) + Math.PI : 0,
                radius: kind === 'stand' ? gameConfig.props.lampRadius : 0, solid: kind === 'stand'
            });
        }
        // Thickets still standing (saved edits may have burnt some), and
        // resources not gathered lately.
        for (let r = 0; r < terrain.height; r++) for (let c = 0; c < terrain.width; c++) {
            const kind = terrainKit.kindAt(terrain, c, r), at = centre(c, r);
            if (kind === terrainKit.KIND.brush) out.push({ id: `brush-${c}-${r}`, type: 'brush', col: c, row: r, x: at.x, y: at.y, h: 0, facing: 0, radius: 0, solid: false, burning: -1, spread: false });
            else if (terrainKit.isResource(kind)) out.push({ id: `node-${c}-${r}`, type: 'node', kind: terrainKit.NAMES[kind], col: c, row: r, x: at.x, y: at.y, h: 0, facing: 0, radius: 0, solid: false });
        }
        return out;
    }
    // Where someone arriving from region `from` stands: just inside the
    // portal that leads back there, facing into the region; null if none.
    function arrival(map, terrain, from) {
        const p = (map.portals || []).find(q => q.to === from);
        if (!p) return null;
        const at = terrainKit.cellCentre(terrain, p.at[0], p.at[1]), [dx, dy] = DIRS[p.facing], d = gameConfig.props.arriveDistance;
        return { x: at.x + dx * d, y: at.y + dy * d, facing: angleOf(p.facing) };
    }

    // ---- the interact key (core/interact.js) ----
    // What pressing the key on `e` would do for fighter `p`: { verb, name,
    // hold (seconds to hold the key; 0 is at once), ready, why (when not) }.
    // Nothing to do: null.
    function offer(sim, e, p) {
        let out = null;
        if (e.type === 'building') {
            const B = gameConfig.buildings[e.kind];
            out = { verb: B.verb, name: e.name, hold: 0, ready: true, why: '' };
        } else if (e.type === 'portal') {
            out = { verb: '前往', name: gameConfig.maps[e.to].name, hold: 0, ready: true, why: '' };
            if (e.requires && !downed(sim, e.requires)) Object.assign(out, { ready: false, why: `击败${bossName(e.requires)}后开启` });
        } else if (e.type === 'chest') {
            if (e.open) return null;
            out = { verb: '打开', name: '宝箱', hold: gameConfig.interact.chestHold, ready: true, why: '' };
            if (e.requires && !downed(sim, e.requires)) Object.assign(out, { ready: false, why: `${bossName(e.requires)}守着它` });
        } else if (e.type === 'grave') {
            if (e.state !== 'ready') return null;
            const short = missing(sim, e.boss, p);
            out = { verb: '复活', name: `${bossName(e.boss)}之墓`, hold: gameConfig.interact.graveHold, ready: !short, why: short ? `要${short}` : '' };
        } else if (e.type === 'brush') {
            if (e.burning >= 0) return null;
            // A torch carried does it: one press lights the torch and the thicket.
            const torch = inventoryKit.offhandOf(p.loadout) === 'torch';
            out = { verb: '点燃', name: '枯木丛', hold: 0, ready: torch, why: torch ? '' : '要用火把点燃' };
        } else if (e.type === 'node') {
            const G = gameConfig.gather[e.kind];
            out = { verb: G.verb, name: G.name, hold: G.hold, ready: true, why: '' };
        }
        return out;
    }
    function use(sim, e, p) {
        if (e.type === 'building') {
            if (gameConfig.buildings[e.kind].action === 'rest') {
                p.hp = p.maxHp;
                emit(sim, 'rest', { side: p.id, target: e.id });
            } else emit(sim, 'open', { side: p.id, target: e.id, what: e.kind });
        } else if (e.type === 'portal') {
            emit(sim, 'travel', { side: p.id, target: e.id, to: e.to, from: sim.region });
        } else if (e.type === 'chest') {
            e.open = true; e.t = 0;
            progressOf(sim).chests[`${sim.region}/${e.id}`] = true;
            const ahead = gameConfig.props.chestRadius + 6;
            drop(sim, e.loot, e.x + Math.cos(e.facing) * ahead, e.y + Math.sin(e.facing) * ahead);
            emit(sim, 'chest_open', { side: p.id, target: e.id, at: space.toBlocks(e.x, e.y, 24) });
        } else if (e.type === 'grave') call(sim, e, p);
        else if (e.type === 'brush') { fighterKit.light(sim, p, true); ignite(sim, e, p.id); }
        else if (e.type === 'node') gather(sim, e, p);
    }
    // ---- a boss's grave ----
    // Is boss `kind` in the world: standing, or fallen and not yet sunk?
    const bossHere = (sim, kind) => sim.entities.some(m => m.type === 'monster' && m.kind === kind && (monsterKit.living(m) || m.t < gameConfig.props.graveAfter));
    // What fighter `p` still wants to call boss `kind` back, as words
    // ('哥布林耳 ×6 (有 2)'), or '' when everything is carried.
    function missing(sim, kind, p) {
        const bag = bagOf(sim, p), short = [];
        for (const [id, n] of Object.entries(gameConfig.monsters[kind].revive || {})) {
            const have = inventoryKit.count(bag, id);
            if (have < n) short.push(`${inventoryKit.itemOf(id)?.name || id} ×${n}（有 ${have}）`);
        }
        return short.join('、');
    }
    // The materials are spent, the boss is back for good (`revived`, till it
    // is beaten again), and the grave starts to glow.
    function call(sim, e, p) {
        const bag = progressOf(sim);
        for (const [id, n] of Object.entries(gameConfig.monsters[e.boss].revive || {})) inventoryKit.give(bagOf(sim, p), id, -n);
        bag.revived = { ...bag.revived, [e.boss]: true };
        Object.assign(e, { state: 'calling', t: 0, caller: p.id });
        emit(sim, 'grave_call', { side: p.id, target: e.id, kind: e.boss, at: space.toBlocks(e.x, e.y, 20) });
    }
    // A grave shows while its boss is down and gone; called, it gives the
    // boss back once it has glowed and sunk.
    function tickGrave(sim, e, dt) {
        e.t = Math.min(99, e.t + dt);
        if (e.state === 'calling') {
            if (e.t < gameConfig.props.graveCall - 1e-9 || sim.mirror) return;
            const spawn = sim.terrain.monsters[e.spawn], caller = sim.fighters.find(f => f.id === e.caller) || sim.fighters[0];
            const m = entityKit.add(sim, Object.assign(monsterKit.create(sim.terrain, spawn, e.spawn), { id: entityKit.nextId(sim, 'boss'), phase: 'rise', t: 0 }));
            m.facing = Math.atan2(caller.y - m.y, caller.x - m.x);
            Object.assign(e, { state: 'hidden', t: 0, solid: false, caller: null });
            emit(sim, 'revive', { side: caller.id, target: m.id, kind: e.boss, name: bossName(e.boss), at: space.toBlocks(m.x, m.y, 20) });
            return;
        }
        const show = downed(sim, e.boss) && !bossHere(sim, e.boss);
        if (show !== (e.state === 'ready')) Object.assign(e, { state: show ? 'ready' : 'hidden', t: 0, solid: show });
    }
    // ---- gathering ----
    function gather(sim, e, p) {
        const bag = progressOf(sim), kind = terrainKit.KIND[e.kind];
        terrainKit.set(sim.terrain, e.col, e.row, spentOf(sim.terrain, kind), 0);
        entityKit.remove(sim, e);
        bag.gathered = { ...bag.gathered, [nodeKey(sim.region, e.col, e.row)]: bag.clock || 0 };
        drop(sim, gameConfig.gather[e.kind].loot, e.x, e.y);
        emit(sim, 'gather', { side: p.id, target: e.id, kind: e.kind, at: space.toBlocks(e.x, e.y, terrainKit.isSolid(kind) ? 24 : 8) });
    }
    // ---- fire ----
    function ignite(sim, e, by = null) {
        if (e.burning >= 0) return;
        e.burning = 0;
        emit(sim, 'burn', { side: by, target: e.id, at: space.toBlocks(e.x, e.y, 30) });
    }
    function tickBrush(sim, e, dt) {
        if (e.burning < 0) return;
        const B = gameConfig.props;
        e.burning += dt;
        if (!e.spread && e.burning >= B.burnSpread - 1e-9) {
            e.spread = true;
            for (const o of sim.entities) if (o.type === 'brush' && Math.abs(o.col - e.col) + Math.abs(o.row - e.row) === 1) ignite(sim, o, null);
        }
        if (e.burning < B.burnSeconds - 1e-9 || sim.mirror) return;
        terrainKit.set(sim.terrain, e.col, e.row, 'path', 0);
        entityKit.remove(sim, e);
        emit(sim, 'burned', { target: e.id, at: space.toBlocks(e.x, e.y, 20) });
    }

    // ---- loot ----
    // Roll loot table `table` and drop what comes up at (x, y): each entry
    // that hits pops out as one drop, in a direction of its own.
    function drop(sim, table, x, y) {
        const D = gameConfig.drops, out = [];
        for (const entry of gameConfig.loot[table] || []) {
            if (entityKit.random(sim) >= entry.chance) continue;
            const [lo, hi] = entry.amount, amount = lo + Math.floor(entityKit.random(sim) * (hi - lo + 1));
            const a = entityKit.random(sim) * Math.PI * 2, v = D.popSpeed[0] + entityKit.random(sim) * (D.popSpeed[1] - D.popSpeed[0]);
            out.push(entityKit.add(sim, {
                id: entityKit.nextId(sim, 'd'), type: 'drop', item: entry.item, amount, x, y, h: 0, facing: a,
                radius: D.radius, solid: false, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, pull: null
            }));
        }
        return out;
    }
    function collect(sim, e, f) {
        const bag = bagOf(sim, f).inventory;
        if (e.item === 'gold') bag.gold += e.amount;
        else bag.items[e.item] = (bag.items[e.item] || 0) + e.amount;
        emit(sim, 'pickup', { side: f.id, item: e.item, amount: e.amount, at: space.toBlocks(e.x, e.y, e.h) });
        entityKit.remove(sim, e);
    }
    function tickDrop(sim, e, dt) {
        const D = gameConfig.drops;
        e.t += dt;
        if (e.pull) {
            const f = sim.fighters.find(q => q.id === e.pull);
            if (!f || f.down) { e.pull = null; return; }
            const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy), go = Math.min(d, D.pullSpeed * dt);
            if (d > 1e-9) { e.x += dx / d * go; e.y += dy / d * go; }
            e.h = Math.min(D.pullHeight, e.h + D.pullHeight * dt * 8);
            if (d - go <= D.collectDistance && !sim.mirror) collect(sim, e, f);
            return;
        }
        if (e.t <= D.popSeconds + 1e-9) {
            terrainKit.moveCircle(sim.terrain, e, e.vx * dt, e.vy * dt);
            const u = Math.min(1, e.t / D.popSeconds);
            e.h = D.popHeight * 4 * u * (1 - u);
            return;
        }
        e.h = 0;
        if (e.t < D.restSeconds) return;
        let best = null, far = D.pickupRange;
        for (const f of sim.fighters) {
            const d = Math.hypot(f.x - e.x, f.y - e.y);
            if (!f.down && d <= far) { far = d; best = f; }
        }
        if (best) e.pull = best.id;
    }
    function tick(sim, dt) {
        for (const e of [...sim.entities]) {
            if (e.type === 'drop') tickDrop(sim, e, dt);
            else if (e.type === 'brush') tickBrush(sim, e, dt);
            else if (e.type === 'chest' && e.open && e.t < 99) e.t = Math.min(99, e.t + dt);
            else if (e.type === 'grave') tickGrave(sim, e, dt);
        }
    }
    return { DIRS, angleOf, place, regrow, arrival, offer, use, drop, tick, doorOf, progressOf, bagOf, nodeKey };
})();
