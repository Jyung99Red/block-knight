const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { worldSim: W, simLoop, terrainKit, space, gameConfig, playerAnim } = load();
const plain = value => JSON.parse(JSON.stringify(value));
const SPEED = gameConfig.player.speed, U = gameConfig.world.unitsPerBlock;

function running() {
    const sim = W.create();
    const loop = simLoop.create(dt => W.step(sim, dt));
    return { sim, loop, p: sim.player };
}

test('a new world puts the player on the spawn block, on the ground, nothing held', () => {
    const { sim, p } = running(), t = sim.terrain;
    assert.deepEqual(plain({ x: p.x, y: p.y }), plain(terrainKit.cellCentre(t, t.spawn.col, t.spawn.row)));
    assert.equal(p.h, 0);
    assert.ok(Object.values(sim.input.buttons).every(b => !b.held && b.presses === 0));
    assert.deepEqual(plain(Object.keys(sim.input.buttons)), ['attack', 'guard', 'offhand', 'interact']);
});

test('the fixed-step clock: whole steps, carried remainders, long frames capped', () => {
    let steps = 0;
    const loop = simLoop.create(() => steps++);
    assert.equal(loop.advance(0.016), 1);
    assert.equal(loop.advance(0.016), 2, "0.006 s carried over plus 0.016 s");
    steps = 0; loop.reset();
    assert.equal(loop.advance(5), Math.round(simLoop.MAX_FRAME / simLoop.STEP), 'a 5 s stall runs only 0.1 s');
    assert.equal(loop.run(1), 100);
    assert.equal(simLoop.STEP, 0.01);
});

test('full stick walks at player.speed once under way; a half-pushed stick at half speed', () => {
    const { sim, loop, p } = running(), x0 = p.x, P = gameConfig.player;
    p.facing = 0;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    loop.run(1);
    // The first startSeconds build up to speed: half of that time is lost.
    assert.ok(Math.abs(p.x - x0 - SPEED * (1 - (P.startSeconds - 0.01) / 2)) < 1e-6, `moved ${p.x - x0}`);
    assert.ok(Math.abs(p.speed - SPEED) < 1e-6);
    assert.ok(Math.abs(p.gait - (p.x - x0) / playerAnim.cycleLength(sim.rigs.fighters.player, 0)) < 1e-6, 'the gait advances by distance over the stride');
    W.command(sim, { type: 'move', x: 0, y: -0.5 });
    loop.run(0.3); // turned by now
    const y0 = p.y;
    loop.run(0.5);
    assert.ok(Math.abs(y0 - p.y - SPEED * 0.25) < 1e-6);
    assert.equal(p.h, 0, 'height comes from the ground query, flat for now');
});

test('the body turns towards the stick at turnRate', () => {
    const { sim, loop, p } = running();
    p.facing = 0;
    W.command(sim, { type: 'move', x: -1, y: 0.0001 }); // straight behind
    loop.run(0.1);
    assert.ok(Math.abs(Math.abs(p.facing) - gameConfig.player.turnRate * 0.1) < 1e-6);
    loop.run(0.4);
    assert.ok(Math.abs(Math.abs(space.wrapAngle(p.facing)) - Math.PI) < 1e-3, 'faces the stick within about 0.4 s');
});

test('commands are validated; a long vector is clipped to full speed', () => {
    const { sim } = running();
    for (const bad of [null, 5, { type: 'move', x: NaN, y: 0 }, { type: 'jump' }, { type: 'press', button: 'skill' }]) assert.equal(W.command(sim, bad), false);
    assert.equal(W.command(sim, { type: 'move', x: 30, y: 40 }), true);
    assert.deepEqual(plain(sim.input.move), { x: 0.6, y: 0.8 });
    assert.equal(W.command(sim, { type: 'release', button: 'attack' }), false, 'nothing to release');
    assert.equal(W.command(sim, { type: 'press', button: 'attack' }), true);
    assert.equal(W.command(sim, { type: 'press', button: 'attack' }), false, 'already held');
    assert.equal(W.command(sim, { type: 'release', button: 'attack' }), true);
    assert.equal(sim.input.buttons.attack.presses, 1);
});

test('two thumbs: walking with the shield up, interact on top; A stands the walker still for the move', () => {
    const { sim, loop, p } = running(), G = gameConfig.combat.guard, x0 = p.x, P = gameConfig.player;
    p.facing = 0;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    W.command(sim, { type: 'press', button: 'guard' });
    W.command(sim, { type: 'press', button: 'interact' });
    loop.run(0.5);
    assert.ok(sim.input.buttons.guard.held && sim.input.buttons.interact.held);
    assert.ok(Math.abs(p.x - x0 - SPEED * G.moveMultiplier * (0.5 - (P.startSeconds - 0.01) / 2)) < 1, `walked ${p.x - x0} with the shield up`);
    W.command(sim, { type: 'release', button: 'guard' });
    W.command(sim, { type: 'press', button: 'attack' }); W.command(sim, { type: 'release', button: 'attack' });
    const x1 = p.x;
    loop.run(gameConfig.combo.moves.slash.windup);
    assert.ok(p.x - x1 < 1e-9, 'the windup stands still');
    assert.equal(sim.stats.attacks, 1);
});

test('walls stop the body and it slides along them', () => {
    const { sim, loop, p } = running(), t = sim.terrain, r = p.radius;
    W.command(sim, { type: 'move', x: 0, y: -1 }); // north, into the north wall
    loop.run(10);
    const northWallBottom = 4 * U; // row 3 is wall
    assert.ok(Math.abs(p.y - (northWallBottom + r)) < 1e-6, `stopped at ${p.y}`);
    assert.ok(p.speed < 1e-6 && p.moveBlend === 0, 'pressing into a wall is standing still');
    // Pushing diagonally into the wall still walks along it.
    const x0 = p.x;
    W.command(sim, { type: 'move', x: 0.7071, y: -0.7071 });
    loop.run(0.5);
    assert.ok(p.x - x0 > SPEED * 0.5 * 0.6, `slid ${p.x - x0}`);
    assert.ok(!terrainKit.blocked(t, p.x, p.y, r));
});

test('a block corner is walked round, not snagged on', () => {
    // A lone 1x1 stone at cell (2, 2) in an open field, approached due south
    // with the body's centre just beside the stone's west face: the body
    // must slide round the corner and keep going (keyboard walking is
    // always exactly along an axis).
    const t = terrainKit.fromRows(['.......', '.......', '..1....', '.......', '...@...', '.......', '.......']);
    for (const offset of [2, 6, 11]) {
        const body = { x: 2 * U - offset, y: 0.5 * U, radius: 12 };
        for (let i = 0; i < 200; i++) terrainKit.moveCircle(t, body, 0, 1.15);
        assert.ok(body.y > 4 * U, `offset ${offset}: stuck at y = ${body.y.toFixed(1)}`);
        assert.ok(!terrainKit.blocked(t, body.x, body.y, body.radius));
    }
    // Head-on into the middle of a face still stops dead.
    const body = { x: 2.5 * U, y: 0.5 * U, radius: 12 };
    for (let i = 0; i < 200; i++) terrainKit.moveCircle(t, body, 0, 1.15);
    assert.ok(Math.abs(body.y - (2 * U - 12)) < 1e-6 && Math.abs(body.x - 2.5 * U) < 1e-9);
});

test('from a standstill the walk builds up; heading away from the facing is slower until the body has turned (user, 2026-10-02)', () => {
    const P = gameConfig.player;
    const walker = facing => { const { sim, loop, p } = running(); p.y += 3 * U; p.facing = facing; W.command(sim, { type: 'move', x: 1, y: 0 }); return { loop, p }; };
    const a = walker(0); a.loop.run(P.startSeconds / 2);
    assert.ok(a.p.speed > 0.3 * P.speed && a.p.speed < 0.7 * P.speed, `half way to speed: ${a.p.speed}`);
    a.loop.run(P.startSeconds);
    assert.ok(Math.abs(a.p.speed - P.speed) < 1e-6, 'then full speed');
    // Facing the other way: the first steps are at (1 - turnSlow) of the pace.
    const b = walker(Math.PI); b.loop.run(0.01);
    const ahead = walker(0); ahead.loop.run(0.01);
    assert.ok(Math.abs(b.p.speed / ahead.p.speed - (1 - P.turnSlow)) < 0.06, `turning round: ${(b.p.speed / ahead.p.speed).toFixed(2)}`);
    b.loop.run(0.6);
    assert.ok(Math.abs(b.p.speed - P.speed) < 1e-6, 'turned: full speed');
    // The walk the user settled on (122, 2026-10-02), and the steps no
    // hastier: under 4 a second. The run has a speed of its own (252).
    assert.ok(P.speed === 122 && 2 * P.speed / playerAnim.cycleLength(W.create().rigs.fighters.player, 0) < 4);
    assert.equal(P.runSpeed, 252);
});

test('two seconds of unbroken walking turn into a run at runSpeed', () => {
    const P = gameConfig.player, { sim, loop, p } = running();
    p.y += 3 * U; p.facing = 0; // room to run east and west along row 11
    W.command(sim, { type: 'move', x: 1, y: 0 });
    loop.run(P.runAfter - 0.05);
    assert.ok(p.runBlend === 0 && Math.abs(p.speed - P.speed) < 1e-6, 'still walking just before runAfter');
    loop.run(0.05 + P.runRampSeconds / 2);
    assert.ok(p.runBlend > 0.3 && p.runBlend < 0.7 && p.speed > P.speed * 1.2 && p.speed < P.runSpeed, `easing up: ${p.speed}`);
    loop.run(P.runRampSeconds);
    assert.equal(p.runBlend, 1);
    assert.ok(Math.abs(p.speed - P.runSpeed) < 1e-6, `running at ${p.speed}`);
    // Easing the stick off below runStick breaks the run: back down to a walk.
    W.command(sim, { type: 'move', x: -0.6, y: 0 });
    loop.run(P.runRampSeconds + 0.2); // and turned round
    assert.ok(p.runBlend === 0 && p.moveTime === 0 && Math.abs(p.speed - P.speed * 0.6) < 1e-6);
});

test('a gentle push never runs; a stop or a wall starts the count again', () => {
    const P = gameConfig.player;
    {
        const { sim, loop, p } = running();
        p.y += 3 * U;
        W.command(sim, { type: 'move', x: 0.85, y: 0 });
        loop.run(P.runAfter + 1);
        assert.equal(p.runBlend, 0);
    }
    {
        const { sim, loop, p } = running();
        p.y += 3 * U;
        W.command(sim, { type: 'move', x: 1, y: 0 });
        loop.run(P.runAfter - 0.5);
        W.command(sim, { type: 'move', x: 0, y: 0 });
        loop.run(0.01);
        W.command(sim, { type: 'move', x: -1, y: 0 });
        loop.run(P.runAfter - 0.1);
        assert.equal(p.runBlend, 0, 'letting go for one step resets the count');
    }
    {
        const { sim, loop, p } = running();
        W.command(sim, { type: 'move', x: 0, y: -1 }); // into the north wall
        loop.run(P.runAfter + 2);
        assert.equal(p.runBlend, 0, 'pushing into a wall is not walking');
        assert.equal(p.moveTime, 0);
    }
});

test('walk blend eases in and out over animation.blendSeconds', () => {
    const { sim, loop, p } = running(), b = gameConfig.animation.blendSeconds;
    W.command(sim, { type: 'move', x: 1, y: 0 });
    loop.run(b / 2);
    assert.ok(p.moveBlend > 0.3 && p.moveBlend < 0.7);
    loop.run(b);
    assert.equal(p.moveBlend, 1);
    W.command(sim, { type: 'move', x: 0, y: 0 });
    loop.run(b + 0.01);
    assert.equal(p.moveBlend, 0);
    assert.equal(p.speed, 0);
});

test('the same commands give the same world', () => {
    const script = [[0, { type: 'move', x: 0.3, y: -1 }], [37, { type: 'press', button: 'attack' }], [80, { type: 'move', x: -1, y: 0.2 }], [140, { type: 'release', button: 'attack' }]];
    const play = () => {
        const sim = W.create();
        for (let tick = 0; tick < 300; tick++) {
            for (const [at, cmd] of script) if (at === tick) W.command(sim, cmd);
            W.step(sim, simLoop.STEP);
        }
        const { terrain, rigs, ...rest } = sim;
        return JSON.stringify(rest);
    };
    assert.equal(play(), play());
});

test('the clearing map is well formed and closed', () => {
    const rows = gameConfig.maps.clearing.rows, t = terrainKit.fromRows(rows);
    assert.equal(rows.filter(r => r.includes('@')).length, 1);
    assert.ok(!terrainKit.solidAt(t, t.spawn.col, t.spawn.row));
    // Flood fill from the spawn never reaches the map edge.
    const seen = new Set([`${t.spawn.col},${t.spawn.row}`]), todo = [[t.spawn.col, t.spawn.row]];
    while (todo.length) {
        const [c, r] = todo.pop();
        assert.ok(c > 0 && r > 0 && c < t.width - 1 && r < t.height - 1, `open path to the edge at ${c},${r}`);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${c + dc},${r + dr}`;
            if (!seen.has(key) && !terrainKit.closedAt(t, c + dc, r + dr)) { seen.add(key); todo.push([c + dc, r + dr]); }
        }
    }
    assert.ok(seen.size > 150, `${seen.size} open blocks to walk on`);
    assert.throws(() => terrainKit.fromRows(['..', '.']));
    assert.throws(() => terrainKit.fromRows(['..x@']));
    assert.throws(() => terrainKit.fromRows(['...']));
});
