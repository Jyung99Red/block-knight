// Monsters (design.md 5): the goblin, wolf and spider models, the player's
// cuts landing on a short monster (design.md 4.3), their own
// blows as bone hits with reach and warning swept from the key poses
// (4.3, 4.4), and the AI: patrol, alert, the distance-band tables
// (design.md 5.2), every blow blocked and the bite's fan (5.1), enrage,
// leash; then a whole fight to a result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const g = load();
const { worldSim: W, rigKit: R, math3d: M, playerAnim, combatKit, monsterKit, terrainKit, space, gameConfig, playerModel, equipmentModels } = g;
const MOVES = gameConfig.combo.moves, MON = gameConfig.monsters, U = gameConfig.world.unitsPerBlock, F = gameConfig.combat;
const STANDARD = 60;
// The M3 field, fixed for these tests (the game's regions change with content).
const FIELD = require('./fixtures/m3-field.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

const player = R.build(playerModel, { equipment: equipmentModels.forLoadout(gameConfig.gear.starter) });
const still = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0 };
const standing = kind => ({ kind, phase: 'patrol', t: 0, move: null, flinch: 0, gait: 0, moveBlend: 0 });
const KINDS = ['goblin', 'wolf', 'spider', 'goblinChief', 'wolfKing'];
const rigs = Object.fromEntries(KINDS.map(k => [k, monsterKit.rig(k)]));
// Moves drawn either way round, mirrored at random (models/: `either`).
const either = (kind, name) => !!{ goblin: g.goblinPoses, wolf: g.wolfPoses, spider: g.spiderPoses }[monsterKit.modelOf(kind)].moves[MON[kind].moves[name].pose || name].either;
const extent = (rig, solved, kinds) => {
    let top = -Infinity, low = Infinity;
    rig.parts.forEach((p, i) => {
        if (kinds && !kinds.includes(p.kind)) return;
        for (const c of M.corners(M.obb(solved.parts[i], p.size.map(v => v / 2)))) { top = Math.max(top, c[1]); low = Math.min(low, c[1]); }
    });
    return { top, low };
};

// ---- models ----
test('the goblin is a 1.4-block humanoid on the simple 9-bone monster skeleton', () => {
    const rig = rigs.goblin, s = R.solve(rig, monsterKit.pose(rig, standing('goblin')));
    assert.deepEqual(plain(rig.bones.map(b => b.name)), plain(g.dummyModel.bones.map(b => b.name)), 'the same skeleton as the training dummy');
    const all = extent(rig, s);
    assert.ok(Math.abs(all.top - 1.4) < 0.08, `about 1.4 blocks tall (12.1): ${all.top.toFixed(2)}`);
    assert.ok(Math.abs(all.low) < 1e-6, 'standing on the ground');
    // Ears, eyes and rags are drawn only; the club strikes; the body is hit.
    const kinds = name => rig.parts.filter(p => p.kind === name).length;
    assert.equal(kinds('weapon'), 1);
    assert.ok(kinds('deco') >= 8 && kinds('body') === 6);
});

test('the wolf is a quadruped with its back about 0.8 and head about 1.0 blocks up', () => {
    const rig = rigs.wolf, s = R.solve(rig, monsterKit.pose(rig, standing('wolf')));
    const names = rig.bones.map(b => b.name);
    for (const leg of ['legFR', 'legFL', 'legBR', 'legBL']) assert.ok(names.includes(leg));
    const body = rig.parts.findIndex(p => p.bone === rig.index.body && p.kind === 'body');
    const back = Math.max(...M.corners(M.obb(s.parts[body], rig.parts[body].size.map(v => v / 2))).map(c => c[1]));
    assert.ok(Math.abs(back - 0.8) < 0.08, `back at ${back.toFixed(2)}`);
    const hurt = extent(rig, s, ['body']);
    assert.ok(Math.abs(hurt.top - 1.0) < 0.08, `head top at ${hurt.top.toFixed(2)}`);
    assert.ok(Math.abs(extent(rig, s).low) < 1e-6, 'standing on the ground');
    assert.equal(rig.parts.filter(p => p.kind === 'weapon').length, 1, 'the muzzle bites');
});

test('the cave spider is low on eight legs, its back about 0.85 blocks up; its front pair strike', () => {
    const rig = rigs.spider, s = R.solve(rig, monsterKit.pose(rig, standing('spider')));
    const legs = rig.bones.filter(b => /^leg[1-4][RL]$/.test(b.name));
    assert.equal(legs.length, 8);
    const hurt = extent(rig, s, ['body']);
    assert.ok(Math.abs(hurt.top - 0.85) < 0.08, `back at ${hurt.top.toFixed(2)}`);
    assert.ok(Math.abs(extent(rig, s).low) < 1e-6, 'standing on the ground');
    const weapons = rig.parts.filter(p => p.kind === 'weapon').map(p => rig.bones[p.bone].name).sort();
    assert.deepEqual(plain(weapons), ['leg1L', 'leg1R']);
    // Walking turns its legs forward and back, on the ground all the way.
    let moved = false;
    for (let k = 0; k < 8; k++) {
        const pose = monsterKit.pose(rig, { ...standing('spider'), gait: k / 8, moveBlend: 1 }), rest = monsterKit.pose(rig, standing('spider'));
        assert.ok(Math.abs(extent(rig, R.solve(rig, pose)).low) < 1e-6, `grounded at phase ${k / 8}`);
        if (Math.abs((pose.leg1R.ry || 0) - (rest.leg1R.ry || 0)) > 0.2) moved = true;
    }
    assert.ok(moved, 'legs swing');
    const leg = g.spiderPoses.walk.leg;
    assert.ok(Math.abs(monsterKit.cycleLength('spider') - 4 * leg.length * Math.sin(leg.amp) * U) < 1e-9);
});

test('walking swings the legs and keeps the feet on the ground; the stride follows the legs', () => {
    for (const kind of ['goblin', 'wolf']) {
        const rig = rigs[kind];
        let moved = false;
        for (let k = 0; k < 8; k++) {
            const pose = monsterKit.pose(rig, { ...standing(kind), gait: k / 8, moveBlend: 1 });
            assert.ok(Math.abs(extent(rig, R.solve(rig, pose)).low) < 1e-6, `${kind} grounded at phase ${k / 8}`);
            if (Object.keys(pose).some(b => /^leg/.test(b) && Math.abs(pose[b].rx || 0) > 0.3)) moved = true;
        }
        assert.ok(moved, `${kind} legs swing`);
        const leg = (kind === 'goblin' ? g.goblinPoses : g.wolfPoses).walk.leg;
        assert.ok(Math.abs(monsterKit.cycleLength(kind) - 4 * leg.length * Math.sin(leg.amp) * U) < 1e-9);
    }
});

// ---- the player's cuts on monsters (design.md 4.3) ----
// Each move swung with a weapon of its type.
const daggerRig = R.build(playerModel, { equipment: equipmentModels.forLoadout({ ...gameConfig.gear.starter, main: 'assassin_dagger' }) });
const rigFor = move => MOVES[move].weapon === 'dagger' ? daggerRig : player;
const swingAt = (move, u) => R.solve(rigFor(move), playerAnim.pose(rigFor(move), { ...still, act: { move, phase: 'swing', t: u * MOVES[move].swing, from: null } }), [0, 0, 0], space.yawOf(0));
// A monster `dist` ahead of the player, turned `turn` from facing it.
function monsterAt(kind, dist, turn = 0) {
    const rig = rigs[kind];
    return combatKit.hurtboxes(rig, R.solve(rig, monsterKit.pose(rig, standing(kind)), space.toBlocks(dist, 0, 0), space.yawOf(Math.PI + turn)));
}
function lands(move, boxes) {
    const n = Math.ceil(MOVES[move].swing / 0.01);
    for (let i = 0; i < n; i++) if (combatKit.sweep(rigFor(move), u => swingAt(move, u), i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
    return false;
}
test('at its weapon\'s standard distance every move lands on the goblin and on the low wolf (and the bosses), whichever way they face', () => {
    for (const kind of KINDS) {
        for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
            for (const move of Object.keys(MOVES)) {
                const at = gameConfig.combo.weapons[MOVES[move].weapon].standard;
                assert.ok(lands(move, monsterAt(kind, at, turn)), `${move} misses a ${kind} turned ${turn.toFixed(2)} at ${at}`);
            }
        }
        assert.ok(!lands('slash', monsterAt(kind, 150)), `the slash does not reach a ${kind} far off`);
    }
});

// ---- monster blows ----
function playerAt(dist, angle) {
    const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist;
    return combatKit.hurtboxes(player, R.solve(player, playerAnim.pose(player, still), space.toBlocks(x, y, 0), space.yawOf(Math.atan2(-y, -x))));
}
// The monster at the origin facing +x; returns the first contact with a
// player standing `dist` away at `angle`, lunge included, or null. `flip`:
// the move drawn mirrored.
function blow(kind, name, dist, angle = 0, flip = false) {
    const rig = rigs[kind], mv = MON[kind].moves[name], lunge = u => mv.step * (1 - (1 - u) * (1 - u));
    const at = u => R.solve(rig, monsterKit.pose(rig, { ...standing(kind), phase: 'swing', t: u * mv.swing, move: name, flip }), [lunge(u) / U, 0, 0], space.yawOf(0));
    const opts = mv.ram ? { kinds: ['body', 'weapon'], pad: 0 } : undefined, n = Math.ceil(mv.swing / 0.01), boxes = playerAt(dist, angle);
    for (let k = 0; k < n; k++) { const hit = combatKit.sweep(rig, at, k / n, (k + 1) / n, [{ id: 'p', boxes }], opts); if (hit) return hit; }
    return null;
}
// Is the ground point (x, z) inside a counter-clockwise convex hull?
const inside = (hull, x, z) => hull.every((a, i) => { const b = hull[(i + 1) % hull.length]; return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-9; });

test('each monster move reaches as far as its key poses carry it, in front only, and the warning covers where it lands', () => {
    for (const kind of KINDS) for (const [i, mv] of Object.entries(MON[kind].moves)) {
        const r = monsterKit.reach(kind, i);
        assert.ok(r.forward > 40 && r.forward < 260, `${kind} ${i} reach ${r.forward}`);
        // Where the AI attacks from, and closer, the blow lands on a player in
        // front, either way round for a move drawn both ways.
        for (const d of [30, MON[kind].standOff * r.forward, r.forward]) for (const flip of either(kind, i) ? [false, true] : [false]) {
            const hit = blow(kind, i, d, 0, flip);
            assert.ok(hit, `${kind} ${i} misses at ${d.toFixed(0)}`);
            // The warning, in the monster's frame (+z ahead): the contact is inside it.
            assert.ok(inside(r.hull, -hit.point[2], hit.point[0]), `${kind} ${i} lands outside its warning`);
        }
        assert.ok(!blow(kind, i, r.forward + 30), `${kind} ${i} reaches past its reach`);
        // Behind, out of touch with the body (a boss's body is bigger).
        assert.ok(!blow(kind, i, 40 + 60 * ((MON[kind].scale || 1) - 1), Math.PI), `${kind} ${i} reaches behind`);
    }
    // The leap flies far and straight; the bite starts close and lunges a block.
    const leap = monsterKit.reach('wolf', 'leap'), bite = monsterKit.reach('wolf', 'bite');
    assert.ok(leap.forward > 4 * U && bite.stand < 2 * U && bite.forward < leap.forward / 1.5);
    assert.ok(Math.abs(bite.forward - bite.stand - MON.wolf.moves.bite.step) < 2, 'the lunge adds its step');
    assert.ok(!blow('wolf', 'leap', 120, Math.PI / 3), 'the leap does not reach far to the side');
    // A move drawn with another's key poses reaches as that one does.
    assert.equal(monsterKit.reach('wolfKing', 'quickBite').forward, monsterKit.reach('wolfKing', 'bite').forward);
});

// ---- the AI on the field ----
// The field with only the first monster of each kind named left in it.
function field(...kinds) {
    const sim = W.create({ map: FIELD });
    sim.monsters = kinds.map(kind => sim.monsters.find(m => m.kind === kind));
    return sim;
}
const step = (sim, seconds) => { for (let i = 0; i < Math.round(seconds / 0.01); i++) W.step(sim, 0.01); };
const press = (sim, b) => W.command(sim, { type: 'press', button: b });
const release = (sim, b) => W.command(sim, { type: 'release', button: b });
// The attack key: a tap is an A; held combo.holdSeconds it is a B (that time passes).
const tap = (sim, input = 'a') => { press(sim, 'attack'); if (input === 'b') step(sim, gameConfig.combo.holdSeconds); release(sim, 'attack'); };
const events = (sim, type) => W.drain(sim).filter(e => e.type === type);
const put = (body, x, y, facing) => { body.x = x; body.y = y; if (facing !== undefined) body.facing = facing; };
// A monster moved to fight at (x, y): its home goes with it, or it would be
// past its leash and walk back (user, 2026-10-06).
const stand = (m, x, y, facing) => { put(m, x, y, facing); m.home = { x, y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('the field: closed, the player spawns out of every alert range, monsters stand on open grass', () => {
    const sim = W.create({ map: FIELD }), t = sim.terrain;
    assert.deepEqual(plain(sim.monsters.map(m => m.kind).sort()), ['goblin', 'goblin', 'wolf', 'wolf']);
    assert.equal(sim.dummy, null);
    assert.equal(sim.player.endless, false, 'outside training the player can fall');
    for (const m of sim.monsters) {
        assert.ok(!terrainKit.blocked(t, m.x, m.y, m.radius), `${m.id} placed clear`);
        assert.ok(dist(m, sim.player) > MON[m.kind].alertRange + 100, `${m.id} would notice the player at once`);
    }
    const seen = new Set([`${t.spawn.col},${t.spawn.row}`]), todo = [[t.spawn.col, t.spawn.row]];
    while (todo.length) {
        const [c, r] = todo.pop();
        assert.ok(c > 0 && r > 0 && c < t.width - 1 && r < t.height - 1, `open path to the edge at ${c},${r}`);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${c + dc},${r + dr}`;
            if (!seen.has(key) && !terrainKit.solidAt(t, c + dc, r + dr)) { seen.add(key); todo.push([c + dc, r + dr]); }
        }
    }
    for (const m of sim.monsters) assert.ok(seen.has(`${Math.floor(m.x / U)},${Math.floor(m.y / U)}`), `${m.id} can be reached`);
    assert.throws(() => terrainKit.fromRows(['@x']));
});

test('a patrol walks from waypoint to waypoint near home and rests between them', () => {
    const sim = field('goblin', 'wolf');
    let far = 0, rests = 0, wasResting = false;
    for (let i = 0; i < 2000; i++) {
        W.step(sim, 0.01);
        for (const m of sim.monsters) far = Math.max(far, dist(m, m.home) - MON[m.kind].patrolRadius);
        const m = sim.monsters[0];
        if (m.rest > 0 && !wasResting) rests++;
        wasResting = m.rest > 0;
    }
    assert.ok(sim.monsters.every(m => m.phase === 'patrol'));
    assert.ok(far < 4, `strays ${far.toFixed(1)} past its patrol radius`);
    assert.ok(rests >= 2, `rested ${rests} times in 20 s`);
    assert.ok(sim.monsters.every(m => m.gait > 1), 'legs walk the patrol');
});

test('notice, stand alert, chase, and attack once the player is within the move\'s reach', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    put(p, m.x - S.alertRange + 10, m.y, 0);
    step(sim, 0.02);
    assert.equal(m.phase, 'alert');
    assert.equal(events(sim, 'alert').length, 1);
    const x0 = m.x;
    step(sim, S.alertSeconds - 0.05);
    assert.equal(m.phase, 'alert'); assert.ok(Math.abs(m.x - x0) < 1e-9, 'an alert monster stands');
    step(sim, 0.1);
    assert.equal(m.phase, 'chase');
    // It closes in and attacks with a move that reaches the player.
    for (let i = 0; i < 600 && m.phase !== 'windup'; i++) W.step(sim, 0.01);
    assert.equal(m.phase, 'windup');
    const reach = monsterKit.reach('goblin', m.move).forward;
    assert.ok(dist(m, p) <= reach + 1e-6, `attacks from ${dist(m, p).toFixed(1)}`);
    assert.ok(m.speed === 0 || m.moveBlend < 1, 'stops to attack');
    // Standing still, the player takes the blow.
    const hp = p.hp, mv = S.moves[m.move];
    step(sim, mv.windup + mv.swing + 0.05);
    assert.ok(p.hp < hp && sim.stats.hurt === 1, 'the blow lands');
    assert.ok(W.drain(sim).some(e => e.type === 'hit' && e.target === 'player' && e.side === 'monster' && e.source === m.id));
});

test('the windup turns to follow the player until `lock` before the swing, then holds', () => {
    const sim = field('wolf'), m = sim.monsters[0], p = sim.player, S = MON.wolf, mv = S.moves.bite;
    stand(m, 600, 400, 0); put(p, 650, 400, 0);
    m.phase = 'chase'; m.wait = 0;
    W.step(sim, 0.01);
    assert.equal(m.phase, 'windup');
    // Sidestep while it winds up: it turns after the player.
    put(p, 640, 430);
    step(sim, mv.windup - mv.lock - 0.05);
    const toward = Math.atan2(p.y - m.y, p.x - m.x);
    assert.ok(Math.abs(space.wrapAngle(m.facing - toward)) < 0.1, 'tracked the sidestep');
    // Inside the lock it no longer turns.
    step(sim, 0.06);
    const locked = m.facing;
    put(p, m.x, m.y - 50);
    step(sim, mv.lock - 0.03);
    assert.equal(m.facing, locked);
});

// ---- choosing what to do (design.md 5.2) ----
// An open walled square with one monster of `kind` at home in its middle.
const LETTER = { goblin: 'g', wolf: 'w', spider: 's', goblinChief: 'G', wolfKing: 'K' }, HOME = { x: 820, y: 620 };
function open(kind, seed = 1, loadout = null) {
    const rows = Array.from({ length: 30 }, (_, r) => r === 0 || r === 29 ? '1'.repeat(40) : '1' + '.'.repeat(38) + '1');
    const mark = (r, c, ch) => { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); };
    mark(2, 2, '@'); mark(15, 20, LETTER[kind]);
    return W.create({ map: { name: '空地', rows }, seed, loadout });
}
// The monster at home, free to decide and facing +x; the player `d` away,
// `angle` off its facing, looking at it.
function ready(sim, d, angle = 0) {
    const m = sim.monsters[0];
    Object.assign(m, { phase: 'chase', t: 0, wait: 0, x: HOME.x, y: HOME.y, facing: 0, cooldowns: {} });
    put(sim.player, HOME.x + Math.cos(angle) * d, HOME.y + Math.sin(angle) * d, angle + Math.PI);
    return m;
}
// What a free monster starts at distance d: a move's name, 'approach', or
// 'chase' (it walks in); counted over many rolls.
function picks(sim, d, cooling = {}, rolls = 120) {
    const seen = {};
    for (let i = 0; i < rolls; i++) {
        const m = ready(sim, d);
        Object.assign(m.cooldowns, cooling);
        W.step(sim, 0.01);
        const what = m.phase === 'windup' ? m.move : m.phase;
        seen[what] = (seen[what] || 0) + 1;
    }
    return seen;
}
const sum = table => Object.values(table).reduce((a, b) => a + b, 0);

test('free again, it rolls the table of the player\'s band: near moves near, a lunge or walking in at mid, nothing far', () => {
    for (const kind of KINDS) {
        const S = MON[kind], edge = monsterKit.bands(kind), sim = open(kind);
        assert.ok(edge.near > 40 && edge.mid > edge.near + 10, `${kind} bands ${JSON.stringify(edge)}`);
        const near = picks(sim, edge.near * 0.7), mid = picks(sim, (edge.near + edge.mid) / 2);
        for (const [band, seen] of [['near', near], ['mid', mid]]) {
            assert.deepEqual(Object.keys(seen).sort(), Object.keys(S[band]).sort(), `${kind} ${band}: ${JSON.stringify(seen)}`);
            for (const [what, weight] of Object.entries(S[band])) {
                assert.ok(Math.abs(seen[what] / 120 - weight / sum(S[band])) < 0.15, `${kind} ${band} ${what}: ${seen[what]} of 120`);
            }
        }
        assert.deepEqual(picks(sim, edge.mid + 10), { chase: 120 }, `${kind}: far, it only walks in`);
        // A move cooling down is left out; so is one that does not reach.
        const lunges = Object.keys(S.mid).filter(name => S.moves[name]);
        assert.deepEqual(picks(sim, (edge.near + edge.mid) / 2, Object.fromEntries(lunges.map(name => [name, 1]))), { approach: 120 }, kind);
        for (const name of Object.keys(S.near)) {
            const short = monsterKit.reach(kind, name).forward;
            if (short < edge.near - 2) assert.ok(!picks(sim, (short + edge.near) / 2)[name], `${kind} ${name} from beyond its reach`);
        }
    }
    // Starting a move starts its cooldown, which runs on the monster's own clock.
    for (const enraged of [false, true]) {
        const sim = open('goblinChief'), S = MON.goblinChief, m = ready(sim, 60);
        m.enraged = enraged;
        for (let i = 0; i < 50 && m.move !== 'slam'; i++) { ready(sim, 60); W.step(sim, 0.01); }
        assert.equal(m.move, 'slam');
        assert.ok(Math.abs(m.cooldowns.slam - S.moves.slam.cooldown) < 0.03);
        step(sim, 1);
        const tempo = enraged ? S.enrage.tempo : 1;
        assert.ok(Math.abs(m.cooldowns.slam - (S.moves.slam.cooldown - tempo)) < 0.03, `${m.cooldowns.slam} left`);
    }
});

test('the same opening gives the same choices: the dice are the world\'s own', () => {
    const fight = seed => {
        const sim = open('goblinChief', seed), m = ready(sim, 100), chosen = [];
        sim.player.endless = true;
        for (let i = 0; i < 3000; i++) {
            const was = m.phase;
            W.step(sim, 0.01);
            if (m.phase !== was && (m.phase === 'windup' || m.phase === 'approach')) chosen.push(m.phase === 'windup' ? m.move : 'approach');
        }
        return chosen;
    };
    const a = fight(1);
    assert.deepEqual(fight(1), a);
    assert.ok(a.length >= 6 && new Set(a).size >= 3, a.join(' '));
    assert.notDeepEqual(fight(7), a);
});

test('a player off to the side or behind is turned to on the spot before it decides', () => {
    const sim = open('goblin'), S = MON.goblin, m = ready(sim, 40, 2.2), p = sim.player;
    for (let i = 0; i < 200 && m.phase === 'chase'; i++) {
        W.step(sim, 0.01);
        assert.ok(m.x === HOME.x && m.y === HOME.y, 'turning on the spot');
    }
    assert.equal(m.phase, 'windup');
    const off = Math.abs(space.wrapAngle(Math.atan2(p.y - m.y, p.x - m.x) - m.facing));
    assert.ok(off <= MON.turnFirst + 1e-9, `starts ${off.toFixed(2)} off`);
    assert.ok(Math.abs(sim.time - (2.2 - MON.turnFirst) / S.turnRate) < 0.03, `turned for ${sim.time.toFixed(2)} s`);
});

test('walking in lasts at most approachSeconds, ends once the player is near, and then it decides again', () => {
    const S = MON.wolf, edge = monsterKit.bands('wolf');
    const walk = d => {
        const sim = open('wolf'), m = ready(sim, d);
        m.phase = 'approach';
        for (let i = 0; i < 300 && m.phase === 'approach'; i++) W.step(sim, 0.01);
        return { sim, m, walked: m.x - HOME.x };
    };
    const long = walk(edge.mid - 5);
    assert.ok(Math.abs(long.sim.time - MON.approachSeconds) < 0.02, `walked in for ${long.sim.time.toFixed(2)} s`);
    assert.ok(Math.abs(long.walked - S.speed * MON.approachSeconds) < 3, `walked ${long.walked.toFixed(1)}`);
    const short = walk(edge.near + 10);
    assert.ok(dist(short.m, short.sim.player) <= edge.near + 1e-6 && short.sim.time < 0.3);
    W.step(short.sim, 0.01);
    assert.equal(short.m.phase, 'windup');
    assert.ok(Object.hasOwn(S.near, short.m.move));
});

test('in the gap after a move it faces the player and creeps to its near band at patrol pace', () => {
    const S = MON.wolf, edge = monsterKit.bands('wolf'), sim = open('wolf');
    const m = ready(sim, edge.mid - 10, 0.3);
    m.wait = S.delay;
    step(sim, S.delay - 0.05);
    assert.equal(m.phase, 'chase');
    assert.ok(Math.abs(dist(m, HOME) - S.patrolSpeed * (S.delay - 0.05)) < 1, `crept ${dist(m, HOME).toFixed(1)}`);
    assert.ok(Math.abs(space.wrapAngle(m.facing - Math.atan2(sim.player.y - m.y, sim.player.x - m.x))) < 0.05, 'faces the player');
    // At the near band's edge it stands.
    ready(sim, edge.near * S.standOff - 2).wait = S.delay;
    step(sim, S.delay - 0.05);
    assert.ok(dist(m, HOME) < 1e-9);
});

// A blow under way at a player `d` in front and `off` its facing, looking
// at it: the move `name` starts its windup, drawn mirrored with `flip`;
// `act(sim, i)` runs before each step i. The player's stats after the
// swing, when the blow first got through (or null), and when it first met
// the guard (or null).
function face(kind, name, d, off, { enraged = false, flip = false, loadout = null, act = () => {} } = {}) {
    const sim = open(kind, 1, loadout), m = ready(sim, d, off), mv = MON[kind].moves[name];
    const tempo = enraged ? MON[kind].enrage.tempo : 1;
    Object.assign(m, { phase: 'windup', move: name, t: 0, enraged, flip });
    let hurtAt = null, metAt = null;
    for (let i = 0; i < Math.round((mv.windup + mv.swing) / tempo / 0.01) + 5; i++) {
        act(sim, i);
        W.step(sim, 0.01);
        if (hurtAt === null && sim.stats.hurt) hurtAt = i + 1;
        if (metAt === null && sim.stats.blocks + sim.stats.parries) metAt = i + 1;
    }
    return { ...sim.stats, hurtAt, metAt };
}
const REACT = Math.round(MON.reactSeconds / 0.01);
const at = (step, command) => (sim, i) => { if (i === step) W.command(sim, command); };
const guardAt = step => at(step, { type: 'press', button: 'guard' });
// Starting to walk `way` from straight away reactSeconds after the warning shows.
const walk = (off, way) => at(REACT, { type: 'move', x: Math.cos(off + way), y: Math.sin(off + way) });
const TORCH = { ...gameConfig.gear.starter, offhand: 'torch' };

test('every blow can be blocked, with the shield or with the weapon, raised reactSeconds after its warning shows, enraged too; and parried (no dodge: user, 2026-10-03)', () => {
    for (const kind of KINDS) {
        const S = MON[kind], edge = monsterKit.bands(kind), close = S.radius + gameConfig.player.radius + 4;
        for (const band of ['near', 'mid']) for (const name of Object.keys(S[band]).filter(n => S.moves[n])) {
            // Where the AI starts it from: a near move within its reach without the lunge.
            const r = monsterKit.reach(kind, name), lo = band === 'near' ? close : edge.near + 1, hi = band === 'near' ? r.stand : r.forward;
            const flip = either(kind, name);
            for (const d of [lo, hi]) {
                const where = `${kind} ${name} from ${(d / U).toFixed(2)} blocks`;
                for (const off of [0, MON.turnFirst]) for (const enraged of [false, true]) {
                    // A quick blow met by a guard just up is parried, which is fine too. A
                    // move drawn either way round comes the other way when enraged.
                    const s = face(kind, name, d, off, { enraged, flip: flip && enraged, act: guardAt(REACT) });
                    assert.ok(s.hurt === 0 && s.blocks + s.parries === 1, `${where}, ${off.toFixed(2)} off${enraged ? ', enraged' : ''}: ${JSON.stringify(s)}`);
                }
                // A torch in the offhand: the weapon guards (weaker, a shorter parry window).
                const w = face(kind, name, d, MON.turnFirst, { enraged: true, loadout: TORCH, act: guardAt(REACT) });
                assert.ok(w.hurt === 0 && w.blocks + w.parries === 1, `${where} with the weapon: ${JSON.stringify(w)}`);
            }
            // Raised just in time for the parry window, it parries -- the weapon's narrower one too.
            // The blow is timed against a guard held all along: guarding, the body bends
            // forward (user, 2026-10-05), and a blow at the end of its reach meets it sooner
            // than it would a player standing straight.
            assert.ok(face(kind, name, hi, 0).hurtAt, `${kind} ${name} lands on a player standing still`);
            const contact = face(kind, name, hi, 0, { loadout: TORCH, act: guardAt(0) }).metAt, G = F.guard.weapon;
            assert.ok(contact, `${kind} ${name} meets a guard held all along`);
            const parry = face(kind, name, hi, 0, { loadout: TORCH, act: guardAt(contact - Math.round((F.guard.startup + G.parryWindow / 2) / 0.01)) });
            assert.ok(parry.parries === 1 && parry.hurt === 0, `${kind} ${name} not parried: ${JSON.stringify(parry)}`);
        }
    }
});

test('the bite sweeps its head across a small fan, from either side at random: neither a step back nor a step aside clears it (user, 2026-10-03)', () => {
    for (const [kind, name] of [['wolf', 'bite'], ['wolfKing', 'bite'], ['wolfKing', 'quickBite']]) {
        const r = monsterKit.reach(kind, name), close = MON[kind].radius + gameConfig.player.radius + 4;
        assert.ok(either(kind, name), `${kind} ${name} sweeps either way`);
        assert.ok(r.forward - r.stand > 0.8 * U, `${kind} ${name} lunges ${((r.forward - r.stand) / U).toFixed(2)} blocks`);
        // The warning: a fan either side of straight ahead, the same both ways round.
        const side = Math.max(...r.hull.map(p => p[0]));
        assert.ok(side > 0.6 && Math.abs(side + Math.min(...r.hull.map(p => p[0]))) < 1e-6, `${kind} ${name} sweeps ${side.toFixed(2)} blocks to the side`);
        // The wolf's lunge is 35 (user, 2026-10-04: the bite a little shorter
        // ahead, knowing what it costs): a prompt step back from the very
        // edge of its reach now clears it, so its step back is tried from
        // where it creeps to between blows (standOff) instead.
        const back = kind === 'wolf' ? MON.wolf.standOff * r.stand : r.stand;
        for (const [d, way, label] of [[close, 0, 'back'], [back, 0, 'back'], ...[close, r.stand].flatMap(d => [[d, Math.PI / 2, 'aside'], [d, -Math.PI / 2, 'aside']])]) {
            // Not knowing which way round it comes, a walk is caught one way or the other.
            assert.ok([false, true].some(flip => face(kind, name, d, 0, { flip, act: walk(0, way) }).hurt), `${kind} ${name}: ${label} from ${(d / U).toFixed(2)} blocks clears it`);
        }
    }
    assert.ok([false, true].every(flip => !face('wolf', 'bite', monsterKit.reach('wolf', 'bite').stand, 0, { flip, act: walk(0, 0) }).hurt), 'the wolf\'s bite from the edge of its reach is cleared by a prompt step back');
    // A monster starting a move drawn either way round rolls which way: both come up.
    const sim = open('wolf'), seen = new Set();
    for (let i = 0; i < 20; i++) { ready(sim, 40); W.step(sim, 0.01); seen.add(sim.monsters[0].flip); }
    assert.deepEqual([...seen].sort(), [false, true]);
    // Standing still is no way out.
    assert.equal(face('goblin', 'flail', 40, 0).hurt, 1);
});

test('the spider\'s strike stabs its front legs straight ahead: a step aside clears it, a step back does not', () => {
    const r = monsterKit.reach('spider', 'strike'), close = MON.spider.radius + gameConfig.player.radius + 4;
    const side = Math.max(...r.hull.map(p => p[0]));
    assert.ok(side < 0.6, `about a block wide: ${side.toFixed(2)} blocks to each side`);
    for (const d of [close, r.stand]) {
        assert.equal(face('spider', 'strike', d, 0).hurt, 1, `standing still at ${(d / U).toFixed(2)} blocks`);
        for (const way of [Math.PI / 2, -Math.PI / 2]) assert.equal(face('spider', 'strike', d, 0, { act: walk(0, way) }).hurt, 0, `a step aside at ${(d / U).toFixed(2)} blocks`);
    }
    assert.equal(face('spider', 'strike', close, 0, { act: walk(0, 0) }).hurt, 1, 'a step back from close by');
});

// Seconds a sword combo keeps the player from walking: every move up to its
// derive point, the last one to the end of its recovery.
function locked(...chain) {
    const C = gameConfig.combo.moves;
    return chain.reduce((sum, id, i) => sum + C[id].windup + C[id].swing + (i < chain.length - 1 ? C[id].derive : C[id].recovery), 0);
}
test('the gap after a blow holds a combo: a sword A A and a walk back in after any blow, the whole A A A after a lunge (user, 2026-10-03)', () => {
    const AA = locked('slash', 'backslash'), AAA = locked('slash', 'backslash', 'smite'), WALK_IN = 0.4;
    // The smite as the user tuned it (2026-10-04: the recovery 0.59 to 0.55;
    // 2026-10-09: the windup 0.22 to 0.25, the swing 0.23 to 0.16).
    assert.ok(Math.abs(AA - 1.00) < 1e-9 && Math.abs(AAA - 1.74) < 1e-9, `${AA} ${AAA}`);
    for (const kind of KINDS) {
        const S = MON[kind];
        for (const name of Object.keys(S.near).filter(n => S.moves[n])) assert.ok(S.moves[name].recovery + S.delay >= AA + WALK_IN - 1e-9, `${kind} ${name}`);
        for (const name of Object.keys(S.mid).filter(n => S.moves[n])) assert.ok(S.moves[name].recovery + S.delay >= AAA - 1e-9, `${kind} ${name}`);
    }
});

test('walking away ends a fight: it cannot keep up, gives up past its leash and goes home whole (user, 2026-10-02)', () => {
    for (const kind of ['goblin', 'wolf']) {
        const sim = open(kind), m = ready(sim, monsterKit.bands(kind).near - 5);
        m.hp = m.maxHp - 20;
        W.command(sim, { type: 'move', x: 1, y: 0 });
        for (let i = 0; i < 1500 && m.phase !== 'return'; i++) W.step(sim, 0.01);
        assert.equal(m.phase, 'return', `${kind} still after the player`);
        assert.equal(sim.stats.hurt, 0, `${kind} landed a blow`);
        for (let i = 0; i < 2000 && m.phase !== 'patrol'; i++) W.step(sim, 0.01);
        assert.equal(m.phase, 'patrol');
        assert.equal(m.hp, m.maxHp);
    }
});

test('lured past its leash it gives up and walks home, then patrols again', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    m.phase = 'chase'; m.wait = 99;
    put(m, m.home.x - S.leash - 10, m.home.y);
    put(p, m.x - S.alertRange - 40, m.y);
    W.step(sim, 0.01);
    assert.equal(m.phase, 'return');
    step(sim, 12);
    assert.equal(m.phase, 'patrol');
    assert.ok(dist(m, m.home) < S.patrolRadius + 4);
});

test('past its leash it goes home though the player stands by it, mending as it walks, and a blow on the way does not turn it round (user, 2026-10-06)', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    m.phase = 'chase'; m.wait = 0;
    put(m, m.home.x - S.leash - 10, m.home.y, 0);
    put(p, m.x - 50, m.y, 0);
    W.step(sim, 0.01);
    assert.equal(m.phase, 'return', 'the player within its reach, and still it goes');
    // Cut in the back as it walks: hurt, and walking on.
    tap(sim);
    for (let i = 0; i < 40 && sim.stats.hits === 0; i++) W.step(sim, 0.01);
    assert.equal(sim.stats.hits, 1);
    assert.ok(m.hp < m.maxHp && m.phase === 'return');
    // It mends three tenths of its HP a second on the way (once the blow's hitstop is over), and no further than whole.
    assert.equal(MON.returnHeal, 0.3);
    step(sim, 0.1);
    m.hp = 10; step(sim, 1);
    assert.ok(Math.abs(m.hp - 10 - MON.returnHeal * m.maxHp) < 0.5 && m.phase === 'return', `mended to ${m.hp}`);
    m.hp = m.maxHp - 1; step(sim, 0.2);
    assert.equal(m.hp, m.maxHp);
    m.hp = 40;
    // A blow that would have made it reel does not.
    monsterKit.struck(sim, m, { amount: 1, stagger: F.stagger.threshold });
    assert.deepEqual([m.phase, m.stagger], ['return', 0]);
    // Inside the leash again it keeps on home; there it is whole.
    put(p, 300, 500);
    for (let i = 0; i < 2000 && m.phase !== 'patrol'; i++) { W.step(sim, 0.01); assert.ok(['return', 'patrol'].includes(m.phase)); }
    assert.equal(m.phase, 'patrol');
    assert.equal(m.hp, m.maxHp);
    // Just inside the leash it fights on.
    const near = field('goblin'), n = near.monsters[0];
    n.phase = 'chase'; n.wait = 99;
    put(n, n.home.x - S.leash + 10, n.home.y, 0); put(near.player, n.x - 50, n.y, 0);
    W.step(near, 0.01);
    assert.equal(n.phase, 'chase');
});

test('a player standing on its home does not keep it walking there for good: up against them it is home, whole, and fights again', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player, S = MON.goblin;
    m.phase = 'chase'; m.wait = 0;
    put(m, m.home.x - S.leash - 10, m.home.y, 0);
    put(p, m.home.x, m.home.y, Math.PI);
    W.step(sim, 0.01);
    assert.equal(m.phase, 'return');
    m.hp = 10;
    for (let i = 0; i < 1500 && m.phase === 'return'; i++) W.step(sim, 0.01);
    assert.notEqual(m.phase, 'return', 'still walking home, the player in the way');
    assert.ok(dist(m, p) < m.radius + p.radius + 3, `${dist(m, p)} from the player`);
    assert.equal(m.hp, m.maxHp);
    const hp = p.hp;
    for (let i = 0; i < 1000 && p.hp === hp; i++) W.step(sim, 0.01);
    assert.ok(p.hp < hp, 'it fights the player on its home');
});

// ---- walls (design.md 5: it notices what it sees, and walks round) ----
// The open square with blocks put into it: `walls` is a list of [letter,
// column, first row, last row].
function walled(kind, walls) {
    const sim = open(kind), t = sim.terrain;
    for (const [letter, col, from, to] of walls) for (let r = from; r <= to; r++) terrainKit.set(t, col, r, ...terrainKit.cellOf(letter));
    return sim;
}
test('it notices only a player it can see: a wall two blocks high hides one, a low stone does not', () => {
    for (const kind of KINDS) {
        const near = MON[kind].alertRange - 20;
        const watch = (letter, x, y) => {
            const sim = walled(kind, [[letter, 18, 14, 16]]), m = sim.monsters[0];
            m.rest = 99;
            put(sim.player, x, y, 0);
            step(sim, 1);
            return { phase: m.phase, alerts: events(sim, 'alert').length };
        };
        // Due west of home, the wall between them.
        assert.deepEqual(watch('2', HOME.x - near, HOME.y), { phase: 'patrol', alerts: 0 }, `${kind} notices through a wall`);
        assert.equal(watch('1', HOME.x - near, HOME.y).alerts, 1, `${kind} does not see over a low stone`);
        // As near, but past the end of the wall.
        assert.equal(watch('2', HOME.x - near * 0.6, HOME.y - near * 0.8).alerts, 1, `${kind} does not see past the end of the wall`);
    }
    // Struck from where it cannot see, it still fights back at once.
    const sim = walled('goblin', [['2', 18, 14, 16]]), m = sim.monsters[0];
    monsterKit.struck(sim, m, { amount: 5 });
    assert.equal(m.phase, 'chase');
});

test('a wall in the way is walked round, looking where it goes, to fight on the other side; home again the same way', () => {
    for (const kind of KINDS) {
        // A wall seven blocks long, west of home; the player beyond its middle.
        const sim = walled(kind, [['3', 18, 12, 18]]), m = sim.monsters[0], p = sim.player, t = sim.terrain;
        Object.assign(m, { phase: 'chase', wait: 0, facing: Math.PI });
        put(p, HOME.x - 200, HOME.y, 0);
        assert.equal(terrainKit.lineClear(t, m.x, m.y, p.x, p.y), false);
        let aside = 0, backwards = 0, seconds = 0;
        for (; seconds < 20 && m.phase !== 'windup'; seconds += 0.01) {
            const x0 = m.x, y0 = m.y;
            W.step(sim, 0.01);
            aside = Math.max(aside, Math.abs(m.y - HOME.y));
            // While the wall is between them it faces the way it walks.
            const dx = m.x - x0, dy = m.y - y0;
            if (Math.hypot(dx, dy) > 1e-6 && !terrainKit.lineClear(t, m.x, m.y, p.x, p.y) && Math.abs(space.wrapAngle(Math.atan2(dy, dx) - m.facing)) > Math.PI / 2) backwards++;
        }
        assert.equal(m.phase, 'windup', `${kind} never got round the wall`);
        assert.ok(aside > 3 * U, `${kind} went ${aside.toFixed(0)} aside`);
        assert.ok(terrainKit.lineClear(t, m.x, m.y, p.x, p.y), `${kind} attacks across the wall`);
        assert.ok(backwards < 30, `${kind} walked backwards for ${backwards} steps`);
        assert.ok(seconds < 600 / MON[kind].speed, `${kind} took ${seconds.toFixed(1)} s`);
        // The player gone and the wall between it and home: round it again, and whole.
        Object.assign(m, { phase: 'return', hp: 1, enraged: true });
        put(m, HOME.x - 200, HOME.y); put(p, 100, 100);
        step(sim, 600 / MON[kind].speed);
        assert.equal(m.phase, 'patrol', `${kind} never got home`);
        assert.ok(dist(m, HOME) <= MON[kind].patrolRadius + 4 && m.hp === m.maxHp && !m.enraged);
    }
});

test('a player in a gap too narrow for it is fought from outside, not walked away from', () => {
    // A dead end one block wide and two deep, open to the east; the wolf king is wider than a block.
    const sim = walled('wolfKing', [['3', 13, 14, 16], ['3', 14, 14, 14], ['3', 15, 14, 14], ['3', 14, 16, 16], ['3', 15, 16, 16]]), m = sim.monsters[0], p = sim.player, t = sim.terrain;
    Object.assign(m, { phase: 'chase', wait: 0, facing: Math.PI });
    put(p, 14.5 * U, 15.5 * U, 0);
    assert.ok(m.radius * 2 > U && terrainKit.lineClear(t, m.x, m.y, p.x, p.y));
    for (let i = 0; i < 1500 && sim.stats.hurt === 0; i++) W.step(sim, 0.01);
    assert.ok(m.x > 16 * U, 'it does not fit in');
    assert.equal(terrainKit.wayTo(t, m.x, m.y, p.x, p.y, m.radius, m.radius + p.radius).direct, false);
    assert.equal(sim.stats.hurt, 1, 'and still lands a blow');
});

test('a pond between them hides nobody: it sees across, walks round, and a blow lands across the water (user, 2026-10-04)', () => {
    // Water five blocks long, west of home; the player beyond its middle, in the goblin's alert range.
    const sim = walled('goblin', [['~', 18, 13, 17]]), m = sim.monsters[0], p = sim.player, t = sim.terrain;
    m.rest = 99;
    put(p, HOME.x - 130, HOME.y, 0);
    step(sim, 1);
    assert.equal(events(sim, 'alert').length, 1, 'seen across the water');
    for (let i = 0; i < 1500 && m.phase !== 'windup'; i++) W.step(sim, 0.01);
    assert.equal(m.phase, 'windup', 'it never came round');
    assert.ok(m.x < 18 * U && !terrainKit.blocked(t, m.x, m.y, m.radius), `it attacks from ${(m.x / U).toFixed(1)}, ${(m.y / U).toFixed(1)}`);
    // Either side of one block of water, as near as the banks let them: the club reaches across.
    const across = walled('goblin', [['~', 18, 15, 15]]), g = across.monsters[0];
    put(across.player, 18 * U - 12, HOME.y, 0);
    Object.assign(g, { phase: 'windup', move: 'pounce', t: MON.goblin.moves.pounce.windup - 0.01, x: 19 * U + 12, y: HOME.y, facing: Math.PI });
    step(across, 0.8);
    assert.equal(across.stats.hurt, 1, 'the pounce lands across the pond');
    assert.ok(g.x >= 19 * U + 12 - 1e-6, 'without the goblin getting its feet wet');
});

test('a pack of wolves: only two are in a move at once, the others wait their turn outside the near band (user, 2026-10-03)', () => {
    assert.equal(MON.wolf.pack, 2);
    // `n` wolves round a player who stands and takes it (kept whole, to last the fight).
    const fight = n => {
        const rows = Array.from({ length: 30 }, (_, r) => r === 0 || r === 29 ? '1'.repeat(40) : '1' + '.'.repeat(38) + '1');
        const mark = (r, c, ch) => { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); };
        mark(2, 2, '@');
        for (let i = 0; i < n; i++) mark(10 + i * 4, 30, 'w');
        const sim = W.create({ map: { name: '狼群', rows } }), p = sim.player, near = monsterKit.bands('wolf').near;
        put(p, HOME.x, HOME.y, 0);
        sim.monsters.forEach((m, i) => { const a = i * 2 * Math.PI / n; Object.assign(m, { phase: 'chase', t: 0, wait: 0, x: p.x + Math.cos(a) * 50, y: p.y + Math.sin(a) * 50, facing: a + Math.PI, home: { x: p.x, y: p.y } }); });
        const moving = () => sim.monsters.filter(m => ['windup', 'swing', 'recover'].includes(m.phase));
        let most = 0, waited = 0, crowded = 0;
        const began = new Map();
        for (let i = 0; i < 2000; i++) {
            W.step(sim, 0.01);
            p.hp = p.maxHp;
            const busy = moving();
            most = Math.max(most, busy.length);
            for (const e of W.drain(sim)) if (e.type === 'windup') began.set(e.id, (began.get(e.id) || 0) + 1);
            // One that is free while two others are at it: it is waiting.
            for (const m of sim.monsters) if (!busy.includes(m) && busy.length === 2 && m.phase === 'chase' && m.wait === 0) waited++;
        }
        return { most, waited, began: sim.monsters.map(m => began.get(m.id) || 0) };
    };
    const three = fight(3);
    assert.equal(three.most, 2, 'never three at once');
    assert.ok(three.waited > 50, `the third waited ${three.waited} steps`);
    assert.ok(three.began.every(n => n >= 2), `each takes its turn: ${three.began}`);
    // Two wolves are not held back: both are at it together some of the time.
    assert.equal(fight(2).most, 2);
    // The limit is the wolves' own: goblins have none.
    assert.equal(MON.goblin.pack, undefined);
});

test('a patrol passes over waypoints in a wall instead of walking at it', () => {
    // Home against a wall to the east: the first waypoint (due east) is inside it.
    const sim = walled('goblin', [['3', 21, 12, 18]]), m = sim.monsters[0], S = MON.goblin;
    assert.ok(terrainKit.blocked(sim.terrain, m.home.x + Math.cos(m.patrolAt) * S.patrolRadius, m.home.y + Math.sin(m.patrolAt) * S.patrolRadius, m.radius));
    let rests = 0, wasResting = false, far = 0, pressed = 0;
    for (let i = 0; i < 3000; i++) {
        const x0 = m.x, y0 = m.y;
        W.step(sim, 0.01);
        if (m.rest > 0 && !wasResting) rests++;
        wasResting = m.rest > 0;
        far = Math.max(far, dist(m, m.home) - S.patrolRadius);
        // Walking (legs moving) without getting anywhere.
        if (m.rest === 0 && m.x === x0 && m.y === y0) pressed++;
    }
    assert.equal(m.phase, 'patrol');
    assert.ok(rests >= 3, `rested ${rests} times in 30 s`);
    assert.ok(far < 4 && pressed < 30, `strayed ${far.toFixed(1)}, stood pressing for ${pressed} steps`);
});

test('enraged below its threshold: harder blows and a faster clock, for good', () => {
    const S = MON.wolf, mv = S.moves.bite;
    const timeToHit = enraged => {
        const sim = field('wolf'), m = sim.monsters[0], p = sim.player;
        stand(m, 600, 400, 0); put(p, 650, 400, Math.PI);
        m.phase = 'chase'; m.wait = 0;
        if (enraged) { m.hp = Math.floor(m.maxHp * S.enrage.threshold); m.enraged = true; }
        const hp = p.hp;
        for (let i = 0; i < 300 && p.hp === hp; i++) W.step(sim, 0.01);
        return { time: sim.time, damage: hp - p.hp };
    };
    const calm = timeToHit(false), wild = timeToHit(true);
    assert.ok(Math.abs(wild.time * S.enrage.tempo - calm.time) < 0.05, `windup ${calm.time} then ${wild.time}`);
    const def = g.inventoryKit.statsOf(gameConfig.gear.starter).def, hit = raw => Math.max(1, Math.round(raw * (1 - def / (def + F.damage.defenseConstant))));
    assert.equal(calm.damage, hit(S.atk * mv.ratio));
    assert.equal(wild.damage, hit(S.atk * mv.ratio * S.enrage.atk));
    // The player's hits set it off at the threshold.
    const sim = field('goblin'), m = sim.monsters[0];
    put(sim.player, m.x - STANDARD, m.y, 0); m.wait = 99;
    m.hp = Math.ceil(m.maxHp * MON.goblin.enrage.threshold) + 2;
    tap(sim); step(sim, 0.3);
    assert.ok(m.enraged && events(sim, 'enrage').length === 1);
});

test('struck while still on patrol or alert it fights back at once; B moves push it and stagger it into a reel', () => {
    const sim = field('goblin'), m = sim.monsters[0], p = sim.player;
    put(p, m.x - STANDARD, m.y, 0);
    m.rest = 99; m.phase = 'patrol';
    // Hit before its alert has run out: it skips the rest and fights.
    tap(sim); step(sim, 0.25);
    assert.equal(sim.stats.hits, 1);
    assert.ok(['chase', 'windup'].includes(m.phase) && sim.time < MON.goblin.alertSeconds);
    // A B (rising): pushed back and 2 stagger; a second A B reels it.
    const x0 = m.x;
    step(sim, 0.2); tap(sim, 'b'); step(sim, 0.75);
    assert.ok(m.x - x0 > 5, `pushed ${(m.x - x0).toFixed(1)}`);
    assert.equal(m.stagger, MOVES.rising.stagger);
    m.hp = m.maxHp; m.phase = 'chase'; m.wait = 99;
    put(p, m.x - STANDARD, m.y, 0);
    step(sim, 0.5); tap(sim); step(sim, 0.25); tap(sim, 'b'); step(sim, 0.75);
    assert.equal(m.phase, 'reel');
    step(sim, F.stagger.duration + 0.05);
    assert.equal(m.phase, 'chase');
});

test('bosses take ten stagger points to reel, other monsters three (user, 2026-10-02)', () => {
    for (const kind of KINDS) assert.equal(monsterKit.threshold(kind), MON[kind].boss ? 10 : F.stagger.threshold, kind);
    const sim = W.create({ region: 'valley' }), boss = sim.monsters.find(m => m.kind === 'wolfKing');
    boss.phase = 'chase';
    monsterKit.stagger(sim, boss, 9);
    assert.equal(boss.phase, 'chase', 'nine points: still fighting');
    monsterKit.stagger(sim, boss, 1);
    assert.equal(boss.phase, 'reel');
    assert.equal(boss.stagger, 0);
});

test('a block and a perfect parry work against a monster as against the dummy', () => {
    const S = MON.goblin, mv = S.moves.flail;
    const fight = raiseBefore => {
        const sim = field('goblin'), m = sim.monsters[0], p = sim.player;
        stand(m, 600, 400, Math.PI); put(p, 560, 400, 0);
        m.phase = 'chase'; m.wait = 0;
        W.step(sim, 0.01);
        step(sim, mv.windup - raiseBefore);
        press(sim, 'guard');
        step(sim, raiseBefore + mv.swing + 0.1);
        return sim;
    };
    const block = fight(0.8);
    assert.equal(block.stats.blocks, 1); assert.equal(block.stats.hurt, 0);
    const parry = fight(F.guard.startup + 0.04);
    assert.equal(parry.stats.parries, 1);
    const m = parry.monsters[0];
    assert.ok(m.hp < m.maxHp && m.stagger === F.stagger.parry, 'the parry hits back and staggers');
});

test('the wolf\'s leap rams with its body along the path, sub-stepped, and stops where it meets the player', () => {
    const S = MON.wolf, mv = S.moves.leap;
    const leap = (playerDist, guard = false) => {
        const sim = field('wolf'), m = sim.monsters[0], p = sim.player;
        if (guard) { press(sim, 'guard'); step(sim, 0.4); }
        put(m, 400, 400, 0); put(p, 400 + playerDist, 400, Math.PI);
        m.phase = 'windup'; m.move = 'leap'; m.t = mv.windup - 0.005;
        const x0 = m.x;
        step(sim, mv.swing + 0.05);
        return { sim, m, p, travelled: m.x - x0 };
    };
    const open = leap(1000);
    assert.ok(Math.abs(open.travelled - mv.step) < 1, `leapt ${open.travelled.toFixed(1)} in the open`);
    const mid = leap(110);
    assert.equal(mid.sim.stats.hurt, 1, 'a player in the path is hit');
    assert.ok(mid.travelled < 110, `stopped after ${mid.travelled.toFixed(1)}`);
    assert.ok(W.drain(mid.sim).some(e => e.type === 'hit' && e.move === 'leap'));
    const guarded = leap(110, true);
    assert.equal(guarded.sim.stats.blocks, 1, 'and it can be blocked');
});

test('no blow lands across a wall, either way (design.md 4.3)', () => {
    // A one-block stone at cell (15, 15) of the field; the two stand either side of it.
    const across = (stone, goblinSwings) => {
        const sim = field('goblin'), m = sim.monsters[0], p = sim.player, t = sim.terrain;
        assert.ok(terrainKit.solidAt(t, 15, 15));
        const y = 15.5 * U, x = stone ? 15 * U - 14 : 13 * U;
        put(p, x, y, 0); stand(m, x + 68, y, Math.PI);
        assert.equal(terrainKit.lineClear(t, p.x, p.y, m.x, m.y), !stone);
        if (goblinSwings) { m.phase = 'windup'; m.move = 'pounce'; m.t = MON.goblin.moves.pounce.windup - 0.01; } else { m.phase = 'chase'; m.wait = 99; tap(sim, 'b'); }
        step(sim, 0.8);
        return goblinSwings ? sim.stats.hurt : sim.stats.hits;
    };
    assert.equal(across(false, true), 1, 'the pounce lands in the open');
    assert.equal(across(false, false), 1, 'and so does the charged cut');
    assert.equal(across(true, true), 0, 'across the stone the pounce does not');
    assert.equal(across(true, false), 0, 'nor the charged cut');
});

test('a whole fight: every monster down drops its loot and the world goes on; a fallen player is a loss and the monsters go home', () => {
    // Cut every monster down with A combos, standing at each in turn.
    const sim = W.create({ map: FIELD }), p = sim.player;
    for (const m of sim.monsters) { m.atk = 0; m.wait = 999; }
    for (let guard = 0; guard < 400 && sim.monsters.some(monsterKit.living); guard++) {
        const m = sim.monsters.find(monsterKit.living);
        put(p, m.x - 50, m.y, 0); p.push = null;
        tap(sim); step(sim, 0.3);
    }
    assert.equal(sim.result, null, 'a world has no win: it goes on (design.md 6)');
    assert.equal(sim.stats.kills, 4);
    assert.ok(sim.monsters.every(m => m.phase === 'dead' && m.hp === 0));
    const ev = W.drain(sim);
    assert.equal(ev.filter(e => e.type === 'defeated').length, 4);
    assert.ok(sim.entities.filter(e => e.type === 'drop' && e.item === 'gold').length + ev.filter(e => e.type === 'pickup' && e.item === 'gold').length === 4, 'each one dropped gold');
    // The fallen block nothing and take no more hits.
    assert.deepEqual(plain(fighterFoes(sim)), []);
    // Loss: the player's HP runs out.
    const lose = field('goblin', 'wolf'), q = lose.player;
    q.hp = 5;
    for (const m of lose.monsters) { stand(m, q.x + 45, q.y + (m.kind === 'wolf' ? 40 : -40), Math.PI); m.phase = 'chase'; m.wait = 0; }
    for (let i = 0; i < 400 && !lose.result; i++) W.step(lose, 0.01);
    assert.equal(lose.result?.outcome, 'lose');
    assert.ok(q.down && q.hp === 0);
    assert.equal(W.command(lose, { type: 'press', button: 'attack' }), true);
    assert.equal(q.act, null, 'a fallen player does nothing');
    // Once the blows under way are done (recoveries run up to 2 s).
    step(lose, 3);
    assert.ok(lose.monsters.every(m => ['return', 'patrol'].includes(m.phase)), 'the monsters lose interest');
    // Training never ends: the HP bar refills.
    const training = W.create();
    assert.equal(training.player.endless, true);
});
const fighterFoes = sim => g.fighterKit.foes(sim, sim.player).map(f => f.id);

test('the same inputs give the same field fight, and it survives a JSON round trip (PVP snapshots)', () => {
    const script = { 0: ['move', 1, 0.2], 150: ['press', 'attack'], 152: ['release', 'attack'], 300: ['press', 'attack'], 340: ['release', 'attack'] };
    const play = () => {
        const sim = W.create({ map: FIELD });
        const m = sim.monsters[0]; put(sim.player, m.x - 230, m.y);
        for (let t = 0; t < 900; t++) {
            const s = script[t];
            if (s) W.command(sim, s[0] === 'move' ? { type: 'move', x: s[1], y: s[2] } : { type: s[0], button: s[1] });
            if (t === 200) W.command(sim, { type: 'move', x: 0, y: 0 });
            W.step(sim, 0.01);
        }
        return sim;
    };
    const strip = sim => JSON.stringify(W.snapshot(sim));
    const a = play();
    assert.equal(strip(a), strip(play()));
    assert.ok(a.monsters[0].phase !== 'patrol', 'the goblin joined in');
    const copy = W.restore(W.create({ map: FIELD }), JSON.parse(strip(a)));
    for (const s of [a, copy]) { tap(s); step(s, 3); }
    assert.equal(strip(copy), strip(a));
});
