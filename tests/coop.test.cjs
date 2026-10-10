// A shared adventure (design.md 10): two players in one world -- a guest
// joining and leaving it, its own bag, partners who do not hurt each
// other, monsters going for the nearer one, a partner down picked up by
// the other, a trip that ends only when everyone has fallen -- or in two
// (core/party.js: each going its own way, a fall waited out or given up),
// and the host/guest protocol of core/coop.js
// played end to end over an in-memory channel, the host's page played as
// ui/app.js plays it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, coopKit, partyKit, simLoop, saveKit, propKit, terrainKit, inventoryKit, interactKit, fighterKit, space, gameConfig } = load();
const GUEST = coopKit.GUEST, U = gameConfig.world.unitsPerBlock, PV = gameConfig.pvp;
// The M3 field, fixed for these tests (the game's regions change with content).
const FIELD = require('./fixtures/m3-field.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const who = sim => plain(sim.fighters.map(f => f.id));
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const regionWith = type => Object.keys(gameConfig.maps).find(id => !gameConfig.maps[id].duel && W.create({ region: id }).entities.some(type));
const bagOf = (gold = 0, items = {}) => { const s = saveKit.fresh(); s.inventory.gold = gold; Object.assign(s.inventory.items, items); return { inventory: s.inventory, loadout: s.loadout }; };

// ---- two players in one world ----
test('a guest joins beside the first player, in its own gear, and leaves again', () => {
    const sim = W.create({ map: FIELD }), p = sim.player, bag = bagOf(7);
    const g = W.join(sim, { id: GUEST, loadout: { ...gameConfig.gear.starter, main: 'assassin_dagger' }, bag });
    assert.deepEqual(who(sim), ['player', GUEST]);
    assert.equal(sim.player, p, 'the first fighter stays sim.player');
    assert.equal(g.loadout.main, 'assassin_dagger'); assert.equal(g.hp, g.maxHp);
    assert.ok(sim.rigs.fighters[GUEST] && sim.rigs.fighters[GUEST] !== sim.rigs.fighters.player, 'a skeleton of its own gear');
    assert.equal(sim.bags[GUEST], bag);
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    assert.ok(Math.abs(d - gameConfig.coop.beside) < 1e-6, `stands ${d} away`);
    assert.ok(terrainKit.openWay(sim.terrain, p.x, p.y, g.x, g.y, g.radius), 'on open ground it can walk from');
    assert.throws(() => W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter }));
    assert.equal(W.part(sim, GUEST), true);
    assert.deepEqual(who(sim), ['player']);
    assert.equal(sim.rigs.fighters[GUEST], undefined); assert.equal(sim.bags[GUEST], undefined);
    assert.equal(W.part(sim, 'player'), false, 'the last one never leaves');
});

test('a world of the guest\'s own; the host walks in first and out again, leaving it the guest\'s', () => {
    const bag = bagOf(3), sim = W.create({ map: FIELD, self: GUEST, loadout: gameConfig.gear.starter, bag, carry: { hp: 50 } });
    assert.deepEqual(who(sim), [GUEST]);
    assert.equal(sim.bags[GUEST], bag); assert.equal(sim.player.hp, 50);
    const h = W.join(sim, { id: 'player', loadout: gameConfig.gear.starter, first: true, spot: { x: 600, y: 300, facing: 0 } });
    assert.deepEqual(who(sim), ['player', GUEST]);
    assert.equal(sim.player, h);
    assert.equal(propKit.bagOf(sim, h), sim.progress, 'the host carries the progress');
    assert.equal(W.part(sim, 'player'), true);
    assert.deepEqual(who(sim), [GUEST]);
});

test('worlds sharing one progress keep one clock; a fall waited out while the partner stands elsewhere', () => {
    const a = W.create({ map: FIELD }), b = W.create({ map: FIELD, self: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() });
    b.progress = a.progress;
    const c0 = a.progress.clock;
    W.step(a, 0.5); W.step(b, 0.5, { clock: false });
    assert.ok(Math.abs(a.progress.clock - c0 - 0.5) < 1e-9);
    for (const m of a.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 } });
    a.help = true;
    a.player.hp = 0; fighterKit.fall(a, a.player);
    W.step(a, 0.05);
    assert.equal(a.result, null, 'the partner may still come');
    a.help = false;
    W.step(a, 0.02);
    assert.equal(a.result?.outcome, 'lose');
});

test('partners do not cut each other (user, 2026-10-10: unlike a duel)', () => {
    const sim = W.create({ map: FIELD }), p = sim.player, g = W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() });
    Object.assign(p, { x: 600, y: 300, facing: 0 }); Object.assign(g, { x: 650, y: 300, facing: Math.PI });
    for (const m of sim.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 } });
    W.command(sim, { type: 'press', button: 'attack' }); W.command(sim, { type: 'release', button: 'attack' });
    step(sim, 1);
    assert.equal(g.hp, g.maxHp);
    assert.ok(!W.drain(sim).some(e => e.type === 'hit'));
});

test('monsters notice either player they can see, and go for the nearer one still standing', () => {
    const sim = W.create({ map: FIELD }), p = sim.player, g = W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() });
    const m = sim.monsters.find(x => x.kind === 'goblin'), S = gameConfig.monsters.goblin;
    sim.monsters = [m];
    Object.assign(m, { x: 600, y: 300, home: { x: 600, y: 300 }, phase: 'patrol', rest: 9 });
    // The nearer one hidden by a ring: the other, in sight, is noticed.
    p.loadout.accessory = 'stealth_ring';
    Object.assign(p, { x: 600 + S.alertRange / 2, y: 300 }); Object.assign(g, { x: 600 - S.alertRange + 10, y: 300 });
    step(sim, 0.02);
    assert.equal(m.phase, 'alert');
    step(sim, S.alertSeconds + 0.1);
    assert.equal(m.phase, 'chase');
    // It turns on whichever is nearer (to close in, or to strike).
    p.loadout.accessory = null;
    const toward = who => { step(sim, 1); return Math.abs(space.wrapAngle(Math.atan2(who.y - m.y, who.x - m.x) - m.facing)) < 0.3; };
    Object.assign(m, { x: 600, y: 300, phase: 'chase', wait: 0 });
    Object.assign(p, { x: 600 - 5 * U, y: 300 }); Object.assign(g, { x: 600 + 3 * U, y: 300 });
    assert.ok(toward(g), 'the guest is nearer');
    Object.assign(m, { x: 600, y: 300, phase: 'chase', wait: 0 });
    Object.assign(g, { x: 600 + 6 * U, y: 300 }); Object.assign(p, { x: 600 - 3 * U, y: 300 });
    assert.ok(toward(p), 'now the first player is');
    // One down: it goes for the other.
    Object.assign(m, { x: 600, y: 300, phase: 'chase', wait: 0 });
    p.down = true;
    assert.ok(toward(g));
});

test('a trip ends when the last one standing falls, not before', () => {
    const sim = W.create({ map: FIELD }), g = W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() });
    for (const m of sim.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 } });
    sim.player.hp = 0; sim.player.down = true;
    step(sim, 0.05);
    assert.equal(sim.result, null);
    g.hp = 0; g.down = true;
    step(sim, 0.02);
    assert.equal(sim.result?.outcome, 'lose');
});

test('a partner down waits to be picked up: the interact key held over it coop.reviveHold seconds stands it up with coop.reviveHp of its HP', () => {
    const sim = W.create({ map: FIELD }), p = sim.player, g = W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() }), C = gameConfig.coop;
    for (const m of sim.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 } });
    Object.assign(p, { x: 600, y: 300, facing: 0 }); Object.assign(g, { x: 640, y: 300 });
    assert.equal(interactKit.target(sim, p), null, 'nothing to do for one standing');
    g.hp = 0; fighterKit.fall(sim, g);
    step(sim, 0.05);
    const t = interactKit.target(sim, p);
    assert.equal(t?.entity, g); assert.equal(t.offer.hold, C.reviveHold); assert.equal(t.offer.ready, true);
    // Let go too soon: still down.
    W.command(sim, { type: 'press', button: 'interact' });
    step(sim, C.reviveHold - 0.2);
    W.command(sim, { type: 'release', button: 'interact' });
    step(sim, 0.3);
    assert.equal(g.down, true);
    W.command(sim, { type: 'press', button: 'interact' });
    step(sim, C.reviveHold + 0.02);
    W.command(sim, { type: 'release', button: 'interact' });
    assert.equal(g.down, false);
    assert.equal(g.hp, Math.max(1, Math.round(g.maxHp * C.reviveHp)));
    assert.ok(W.drain(sim).some(e => e.type === 'rescued' && e.side === GUEST && e.by === 'player'));
    // It gets up first, standing still.
    const x0 = g.x;
    W.command(sim, { type: 'move', x: 1, y: 0 }, 1);
    step(sim, C.riseSeconds / 2);
    assert.ok(g.rising > 0 && g.x === x0);
    step(sim, C.riseSeconds / 2 + 0.3);
    assert.equal(g.rising, 0); assert.ok(g.x > x0);
    // Alone, or in a duel, there is nobody to pick up.
    const duel = W.create({ map: gameConfig.maps.arena, duel: true }), [h, r] = duel.fighters;
    Object.assign(h, { x: 400, y: 300, facing: 0 }); Object.assign(r, { x: 430, y: 300 });
    r.hp = 0; fighterKit.fall(duel, r);
    assert.equal(fighterKit.offer(duel, r, h), null);
});

test('what a guest picks up and drinks is its own bag\'s; a chest it opens is the world\'s', () => {
    const sim = W.create({ map: FIELD }), p = sim.player, bag = bagOf(0, { potion: 2 });
    const g = W.join(sim, { id: GUEST, loadout: { ...gameConfig.gear.starter, offhand: 'potion' }, bag });
    for (const m of sim.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 } });
    Object.assign(p, { x: 1200, y: 700 }); Object.assign(g, { x: 400, y: 300, facing: 0 });
    const before = plain(sim.progress.inventory);
    // A chest in front of the guest, held open.
    const chest = { id: 'chest-x', type: 'chest', loot: 'goblinChief', requires: null, x: 440, y: 300, h: 0, facing: Math.PI, radius: gameConfig.props.chestRadius, solid: true, open: false, t: 0 };
    sim.entities.push(chest);
    step(sim, 0.05);
    W.command(sim, { type: 'press', button: 'interact' }, 1);
    step(sim, gameConfig.interact.chestHold + 0.05);
    W.command(sim, { type: 'release', button: 'interact' }, 1);
    assert.equal(chest.open, true);
    assert.equal(sim.progress.chests[`${sim.region}/chest-x`], true, 'opened in the world');
    step(sim, 4);
    assert.ok(bag.inventory.gold > 0 && bag.inventory.items.chief_tusk === 1, 'the loot flew to the guest');
    assert.deepEqual(plain(sim.progress.inventory), before, 'nothing of it in the first player\'s');
    // A potion drunk comes out of the guest's own bag.
    g.hp = 10;
    W.command(sim, { type: 'press', button: 'offhand' }, 1);
    step(sim, gameConfig.combat.potion.seconds + 0.1);
    assert.equal(bag.inventory.items.potion, 1);
    assert.ok(g.hp > 10);
});

test('a mirror decides nothing: no blow lands, nothing is picked up, used or burnt away in it', () => {
    const sim = W.create({ map: FIELD }), g = W.join(sim, { id: GUEST, loadout: gameConfig.gear.starter, bag: bagOf() });
    sim.mirror = true;
    const m = sim.monsters.find(x => x.kind === 'goblin');
    sim.monsters = [m];
    Object.assign(g, { x: 400, y: 300, facing: 0 }); Object.assign(sim.player, { x: 1200, y: 700 });
    Object.assign(m, { x: 440, y: 300, home: { x: 440, y: 300 }, facing: Math.PI, phase: 'chase', wait: 0 });
    propKit.drop(sim, 'goblin', 400, 300);
    const rev = sim.terrain.rev;
    step(sim, 5);
    assert.equal(g.hp, g.maxHp, 'its blows pass through');
    assert.ok(sim.entities.some(e => e.type === 'drop'), 'the loot is still there');
    assert.equal(sim.bags[GUEST].inventory.gold, 0);
    assert.equal(sim.terrain.rev, rev);
    assert.equal(W.snapshot(sim).mirror, undefined, 'never in a snapshot');
    W.restore(sim, W.snapshot(sim));
    assert.equal(sim.mirror, true, 'and kept through a restore');
});

// ---- the protocol, both ends over an in-memory channel ----
// The host's page as ui/app.js plays it: its worlds step (core/party.js),
// the events of the guest's world are numbered for the guest, through a
// portal each goes its own way, and the guest hears of its world anew when
// that world or who is in it changes.
function party({ region = 'base', latency = 0.02, bag = bagOf(), hostOn = {} } = {}) {
    let clock = 100, lastDue = 0, save = saveKit.fresh(), told = null;
    const queue = [], log = { parts: [], joins: 0, ends: [], starts: 0, sent: { host: [], guest: [] }, shown: [] };
    const worlds = partyKit.create(W.create({ region, progress: save, seed: 5 }));
    const host = { get sim() { return worlds.sim; } };
    const loop = simLoop.create(dt => partyKit.step(worlds, dt));
    const persist = () => { save = saveKit.merge(save, worlds.sim); if (worlds.apart) save = saveKit.merge(save, worlds.apart); };
    const make = options => W.create({ progress: save, seed: 6, ...options });
    const sender = role => msg => {
        const copy = plain(msg);
        lastDue = Math.max(lastDue, clock + latency);
        log.sent[role].push(copy); queue.push({ to: role === 'host' ? 'guest' : 'host', at: lastDue, msg: copy });
    };
    function retell() {
        if (!hs.guestIn) { told = null; return; }
        const w = partyKit.guestWorld(worlds), key = w.fighters.map(f => f.id).join();
        if (told?.w === w && told.key === key) return;
        told = { w, key };
        hs.enter();
    }
    const hostTo = (id, options) => { persist(); partyKit.moveHost(worlds, id, { make, bag: hs.bag, ...options }); retell(); };
    const guestTo = (id, options) => { persist(); partyKit.moveGuest(worlds, id, { make, bag: hs.bag, ...options }); retell(); };
    const hs = coopKit.host({
        send: sender('host'), now: () => clock, world: () => partyKit.guestWorld(worlds) || worlds.sim, mate: () => worlds.apart ? { region: worlds.sim.region } : null,
        on: {
            join: ({ loadout, bag: carried }) => { log.joins++; partyKit.join(worlds, { loadout, bag: carried }); told = { w: worlds.sim, key: worlds.sim.fighters.map(f => f.id).join() }; },
            part: reason => { log.parts.push(reason); persist(); partyKit.part(worlds); told = null; },
            giveUp: () => { if (partyKit.mayGiveUp(worlds, GUEST)) guestTo('base'); },
            ...hostOn
        }
    });
    let gs = null;
    const connect = (carried = bag) => {
        gs = coopKit.guest({ send: sender('guest'), now: () => clock, bag: carried, on: { start: () => log.starts++, end: r => log.ends.push(r) } });
        hs.open(); gs.open(); deliver();
        return gs;
    };
    // A portal taken in world `from`: each goes its own way.
    function travel(e, from) {
        if (e.side === GUEST) guestTo(e.to, { arrival: e.from, hp: partyKit.guestOf(from).hp });
        else hostTo(e.to, { mode: 'alone', arrival: e.from, carry: { hp: worlds.sim.player.hp } });
    }
    function deliver() {
        while (queue.length && queue[0].at <= clock + 1e-9) {
            const { to, msg } = queue.shift();
            if (to === 'host') hs.receive(msg); else gs?.receive(msg);
        }
    }
    const frame = (seconds = 0.01) => {
        clock += seconds; deliver();
        loop.advance(seconds);
        const here = worlds.sim, there = worlds.apart, mine = W.drain(here), theirs = there ? W.drain(there) : null;
        hs.take(theirs || mine);
        const away = mine.find(e => e.type === 'travel'), gone = theirs?.find(e => e.type === 'travel');
        if (away) travel(away, here);
        if (gone && worlds.apart === there) travel(gone, there);
        hs.frame();
        if (gs) log.shown.push(...gs.frame(seconds));
        deliver();
    };
    const run = seconds => { for (let i = 0; i < Math.round(seconds / 0.01); i++) frame(); };
    connect();
    return { host, worlds, hs, get gs() { return gs; }, log, run, frame, connect, deliver, hostTo, get clock() { return clock; }, pass(s) { clock += s; } };
}
const mine = p => p.gs.sim.fighters.find(f => f.id === GUEST), theirs = p => partyKit.guestOf(partyKit.guestWorld(p.worlds));
// Stand fighter `f` at a portal of its world, facing it, and the monsters far off.
function atPortal(sim, f, test = e => !e.requires) {
    const portal = sim.entities.find(e => e.type === 'portal' && test(e));
    Object.assign(f, { x: portal.x + Math.cos(portal.facing) * 30, y: portal.y + Math.sin(portal.facing) * 30, facing: portal.facing + Math.PI });
    for (const m of sim.monsters) Object.assign(m, { x: 0, y: 0, home: { x: 0, y: 0 } });
    return portal;
}

test('let in: the guest builds the host\'s world as it is, both players in it, its bag along', () => {
    const region = regionWith(e => e.type === 'node'), bag = bagOf(42, { goblin_ear: 3 });
    const p = party({ region, bag, latency: 0.03 });
    // Something already changed in the host's world: a resource gathered.
    p.run(0.3); p.hs.close(); p.run(0.1);
    const node = p.host.sim.entities.find(e => e.type === 'node');
    propKit.use(p.host.sim, node, p.host.sim.player);
    p.host.sim.progress.chests['elsewhere/chest-1-1'] = true;
    p.connect(bag); p.run(0.3);
    assert.equal(p.log.joins, 2); assert.equal(p.log.starts, 2);
    const mirror = p.gs.sim;
    assert.equal(p.gs.phase, 'playing'); assert.equal(mirror.region, region); assert.equal(mirror.mirror, true);
    assert.deepEqual(who(mirror), ['player', GUEST]);
    assert.equal(terrainKit.kindAt(mirror.terrain, node.col, node.row), terrainKit.kindAt(p.host.sim.terrain, node.col, node.row));
    assert.ok(!mirror.entities.some(e => e.id === node.id), 'the gathered resource is gone there too');
    assert.equal(mirror.progress.chests['elsewhere/chest-1-1'], true);
    const ids = sim => plain(sim.entities.map(e => e.id).sort());
    assert.deepEqual(ids(mirror), ids(p.host.sim), 'the same things, those that never change too');
    assert.deepEqual(plain(p.gs.bag.inventory), plain(bag.inventory));
    assert.deepEqual(plain(p.hs.bag.inventory), plain(bag.inventory), 'the host carries the guest\'s bag for it');
});

test('the guest\'s controls move it on both phones, its own prediction ahead of the snapshots', () => {
    const p = party({ latency: 0.04 });
    for (const m of p.host.sim.monsters) Object.assign(m, { x: 100, y: 100, home: { x: 100, y: 100 }, phase: 'patrol', rest: 99 });
    p.run(0.5);
    const x0 = theirs(p).x;
    p.gs.command({ type: 'move', x: 0, y: 1 });
    p.run(0.02);
    assert.ok(mine(p).y > theirs(p).y, 'it walks on this phone before the host has heard');
    p.run(1);
    p.gs.command({ type: 'move', x: 0, y: 0 });
    p.run(0.5);
    assert.ok(theirs(p).y - p.host.sim.player.y > 40, 'and on the host');
    assert.ok(Math.abs(theirs(p).x - x0) < 1e-6);
    assert.ok(Math.hypot(mine(p).x - theirs(p).x, mine(p).y - theirs(p).y) < 1, 'both agree once it stands');
    // The host's own moves show on the guest's phone.
    p.host.sim.player.input.move = { x: 1, y: 0 };
    const hx = p.host.sim.player.x;
    p.run(1);
    const there = p.gs.sim.fighters[0];
    assert.ok(there.x > hx + 40 && Math.abs(there.x - p.host.sim.player.x) < 30, `${there.x} / ${p.host.sim.player.x}`);
});

test('the guest\'s pickups reach its phone; a resource it gathers changes the ground on both', () => {
    const region = regionWith(e => e.type === 'node'), p = party({ region });
    p.run(0.3);
    const sim = p.host.sim, g = theirs(p), node = sim.entities.find(e => e.type === 'node');
    for (const m of sim.monsters) Object.assign(m, { x: node.x + 2000, y: node.y, home: { x: node.x + 2000, y: node.y }, phase: 'patrol', rest: 99 });
    Object.assign(sim.player, { x: node.x + 9 * U, y: node.y });
    Object.assign(g, { x: node.x - 30, y: node.y, facing: 0 });
    p.run(0.3);
    const bag0 = plain(p.gs.bag.inventory), hold = gameConfig.gather[node.kind].hold;
    p.gs.command({ type: 'press', button: 'interact' });
    p.run(hold + 0.3);
    p.gs.command({ type: 'release', button: 'interact' });
    assert.ok(!sim.entities.some(e => e.id === node.id), 'gathered in the host\'s world');
    assert.ok(sim.progress.gathered[propKit.nodeKey(sim.region, node.col, node.row)] !== undefined, 'and the host\'s progress keeps when');
    p.run(4);
    assert.equal(terrainKit.kindAt(p.gs.sim.terrain, node.col, node.row), terrainKit.kindAt(sim.terrain, node.col, node.row));
    assert.notDeepEqual(plain(p.gs.bag.inventory), bag0, 'what came out is in the guest\'s bag');
    assert.deepEqual(plain(p.gs.bag.inventory), plain(p.hs.bag.inventory));
    assert.ok(p.log.shown.some(e => e.type === 'pickup' && e.side === GUEST), 'and it hears of it');
});

test('through a portal each goes its own way: the guest\'s own world runs on the host\'s phone, and the host walks into it', () => {
    const p = party({ region: 'base' });
    p.run(0.3);
    const portal = atPortal(p.host.sim, theirs(p)), from = p.host.sim.region;
    theirs(p).hp = 50;
    p.run(0.3);
    p.gs.command({ type: 'press', button: 'interact' });
    p.run(0.5);
    // The guest is there, the host here; one progress, one clock.
    assert.equal(p.host.sim.region, from); assert.deepEqual(who(p.host.sim), ['player']);
    assert.equal(p.worlds.apart.region, portal.to); assert.deepEqual(who(p.worlds.apart), [GUEST]);
    assert.equal(theirs(p).hp, 50, 'as hurt as it was');
    assert.equal(p.worlds.apart.progress, p.host.sim.progress);
    assert.equal(p.gs.sim.region, portal.to); assert.equal(p.gs.mate?.region, from, 'the guest knows where the host is');
    assert.equal(p.log.starts, 2);
    const c0 = p.host.sim.progress.clock, t0 = p.worlds.apart.time;
    p.run(1);
    assert.ok(Math.abs(p.host.sim.progress.clock - c0 - 1) < 0.02, 'the time played counted once');
    assert.ok(p.worlds.apart.time > t0 + 0.9, 'the guest\'s world runs on');
    // The host takes the same portal: it walks into the guest's world as it is, the guest there still.
    const there = p.worlds.apart, g = theirs(p), gx = g.x;
    atPortal(p.host.sim, p.host.sim.player, e => e.to === portal.to);
    p.run(0.3);
    W.command(p.host.sim, { type: 'press', button: 'interact' });
    p.run(0.5);
    assert.equal(p.host.sim, there); assert.equal(p.worlds.apart, null);
    assert.deepEqual(who(p.host.sim), ['player', GUEST]);
    assert.equal(theirs(p), g); assert.equal(g.x, gx);
    assert.equal(p.log.starts, 3); assert.equal(p.gs.mate, null);
    assert.deepEqual(who(p.gs.sim), ['player', GUEST]);
});

test('down alone with the partner standing elsewhere: waited out; given up, back to the base whole; all down, the trip ends', () => {
    const p = party({ region: 'base' });
    p.run(0.3);
    atPortal(p.host.sim, theirs(p));
    p.run(0.3);
    p.gs.command({ type: 'press', button: 'interact' });
    p.run(0.5);
    const there = p.worlds.apart, g = theirs(p);
    g.hp = 0; fighterKit.fall(there, g);
    p.run(0.5);
    assert.equal(there.result, null, 'the host still stands: the guest waits');
    assert.equal(partyKit.mayGiveUp(p.worlds, GUEST), true);
    p.gs.giveUp();
    p.run(0.3);
    assert.equal(p.worlds.apart, null);
    assert.deepEqual(who(p.host.sim), ['player', GUEST], 'back in the base, where the host is');
    assert.equal(theirs(p).down, false); assert.equal(theirs(p).hp, theirs(p).maxHp);
    // Apart again, both fall: no one to wait for, the trip ends on both sides.
    atPortal(p.host.sim, theirs(p));
    p.run(0.3);
    p.gs.command({ type: 'release', button: 'interact' }); p.gs.command({ type: 'press', button: 'interact' });
    p.run(0.5);
    const h = p.host.sim.player, far = p.worlds.apart;
    h.hp = 0; fighterKit.fall(p.host.sim, h);
    p.run(0.3);
    assert.equal(p.host.sim.result, null);
    theirs(p).hp = 0; fighterKit.fall(far, theirs(p));
    p.run(0.3);
    assert.equal(p.host.sim.result?.outcome, 'lose'); assert.equal(far.result?.outcome, 'lose');
    // Home: everyone, whole.
    p.hostTo('base', { mode: 'all' });
    p.run(0.3);
    assert.deepEqual(who(p.host.sim), ['player', GUEST]); assert.equal(p.worlds.apart, null);
    assert.ok(p.host.sim.fighters.every(f => !f.down && f.hp === f.maxHp));
});

test('the guest picks the host up: decided on the host, seen on both', () => {
    const p = party();
    p.run(0.3);
    const host = p.host.sim.player, g = theirs(p);
    Object.assign(g, { x: host.x - 40, y: host.y, facing: 0 });
    host.hp = 0; fighterKit.fall(p.host.sim, host);
    p.run(0.3);
    assert.equal(p.gs.sim.fighters[0].down, true);
    p.gs.command({ type: 'press', button: 'interact' });
    p.run(gameConfig.coop.reviveHold + 0.3);
    p.gs.command({ type: 'release', button: 'interact' });
    p.run(0.3);
    assert.equal(host.down, false);
    assert.equal(p.gs.sim.fighters[0].down, false);
    assert.ok(p.log.shown.some(e => e.type === 'rescued' && e.side === 'player' && e.by === GUEST));
});

test('the guest trades through the host, on its own bag', () => {
    const potion = inventoryKit.forSale().find(id => gameConfig.items[id].offhand === 'potion');
    const bag = bagOf(gameConfig.items[potion].price * 2), p = party({ bag });
    p.run(0.3);
    const hostGold = p.host.sim.progress.inventory.gold;
    // As the shop screen does: made on this phone's copy, then sent.
    assert.equal(inventoryKit.buy(p.gs.bag, potion), '');
    p.gs.trade('buy', potion);
    p.run(0.3);
    assert.equal(p.hs.bag.inventory.items[potion], 1);
    assert.equal(p.gs.bag.inventory.items[potion], 1);
    assert.equal(p.gs.bag.inventory.gold, gameConfig.items[potion].price);
    assert.equal(p.host.sim.progress.inventory.gold, hostGold);
});

test('the guest leaves: the host goes on alone, and the room lets the next one in', () => {
    const p = party();
    p.run(0.3);
    p.gs.leave(); p.run(0.1);
    assert.deepEqual(plain(p.log.parts), ['left']); assert.deepEqual(plain(p.log.ends), ['closed']);
    assert.equal(p.hs.guestIn, false);
    assert.deepEqual(who(p.host.sim), ['player']);
    const t = p.host.sim.time;
    p.run(0.5);
    assert.ok(p.host.sim.time > t);
    p.connect(); p.run(0.3);
    assert.equal(p.hs.guestIn, true); assert.equal(p.gs.phase, 'playing');
    // The host closes its room: the guest is told.
    p.hs.close(); p.run(0.1);
    assert.deepEqual(p.log.ends, ['closed', 'left']);
});

test('silence ends it: a guest unheard is let go, a phone in the background is waited for', () => {
    const p = party();
    p.run(0.3);
    p.gs.away(true);
    // (No frames run on a phone in the background, and nothing is said:
    // the guest's pulses are lost here.)
    for (let i = 0; i < 4 * PV.timeoutSeconds; i++) { p.pass(0.25); p.deliver(); p.hs.frame(); }
    assert.equal(p.hs.guestIn, true, 'away, it is waited for');
    p.gs.away(false); p.run(0.5);
    assert.equal(p.hs.guestIn, true);
    // The host's own page stood still a long while: the time is not held against the guest.
    p.pass(PV.timeoutSeconds + 1); p.hs.frame();
    assert.equal(p.hs.guestIn, true);
    // Nothing at all from it while the host plays on: gone.
    for (let i = 0; i < 4 * PV.timeoutSeconds + 4; i++) { p.pass(0.25); p.hs.frame(); }
    assert.equal(p.hs.guestIn, false);
    assert.deepEqual(plain(p.log.parts), ['timeout']);
});

test('another version of the game is not let in', () => {
    let parted = null;
    const host = coopKit.host({ send: () => {}, now: () => 0, world: () => null, on: { part: r => { parted = r; } } });
    host.receive({ t: 'hello', protocol: coopKit.PROTOCOL, rules: 'something else', bag: bagOf() });
    assert.equal(parted, 'incompatible'); assert.equal(host.guestIn, false);
    let ended = null;
    const guest = coopKit.guest({ send: () => {}, now: () => 0, bag: bagOf(), on: { end: r => { ended = r; } } });
    guest.receive({ t: 'hello', protocol: coopKit.PROTOCOL + 1, rules: coopKit.rules() });
    assert.equal(ended, 'incompatible');
});
