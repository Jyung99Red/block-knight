// The map preview's plan (mapview/plan.js, the page is map.html): every
// map is built through the game's own loader, a cell is described and
// pointed at in words, a walk is measured round walls, and one screen of
// ground is cast from the game's camera.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
// The page's own scripts, all but the page itself: what its entry lists is
// enough for the plan.
const { mapPlan: P, terrainKit: T, propKit, gameConfig } = load({ entry: 'map', include: file => file !== 'mapview/page.js' });
const MAPS = gameConfig.maps, MON = gameConfig.monsters, U = gameConfig.world.unitsPerBlock;
const plain = value => JSON.parse(JSON.stringify(value));
const terrainOf = map => T.fromRows(map.rows, U, map.floor || '.');
const near = (a, b, text) => assert.ok(Math.abs(a - b) < 1e-9, `${text}: ${a} against ${b}`);

// A map of the test's own, so the words below do not hang on how the
// game's maps are drawn: a walled yard with a wolf, a boss, a chest it
// keeps, a shop, a gate in the north wall and a locked one in the south.
const YARD = {
    name: '测试场',
    rows: [
        '333#P#333333',
        '3..........3',
        '3.w..1..2..3',
        '3....T.O.h.3',
        '3.@...C..G.3',
        '3..HHH..B..3',
        '3..HHH.....3',
        '3..........3',
        '333333#P#333'
    ],
    buildings: [{ kind: 'shop', at: [3, 5, 3, 2] }],
    portals: [{ at: [4, 0], to: 'base', facing: 'south' }, { at: [7, 8], to: 'field', facing: 'north', requires: 'goblinChief' }],
    chests: [{ at: [6, 4], loot: Object.keys(gameConfig.loot)[0], requires: 'goblinChief' }]
};

test('every map builds a plan whose cells are the loader\'s own: kind, height, letter, what stands in the way and what hides', () => {
    assert.deepEqual(plain(P.maps()), Object.keys(MAPS).map(id => ({ id, name: MAPS[id].name })));
    for (const id of Object.keys(MAPS)) {
        const map = MAPS[id], plan = P.build(id), t = terrainOf(map);
        assert.deepEqual([plan.id, plan.name, plan.width, plan.height, plan.cells.length, plan.unit], [id, map.name, t.width, t.height, t.width * t.height, U]);
        assert.deepEqual([plan.safe, plan.training, plan.duel, plan.dark, plan.floor], [!!map.safe, !!map.training, !!map.duel, !!map.dark, T.NAMES[t.floor]]);
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            const cell = P.cellAt(plan, c, r), at = T.cellCentre(t, c, r), where = `${id} ${c},${r}`;
            assert.deepEqual([cell.kind, cell.level, cell.letter], [T.NAMES[T.kindAt(t, c, r)], T.levelAt(t, c, r), map.rows[r][c]], where);
            assert.equal(cell.solid, T.blocked(t, at.x, at.y, gameConfig.player.radius), where);
            // Sight along a line the other way across the cell says the same.
            assert.equal(cell.hides, !T.sightClear(t, at.x, at.y - U * 0.4, at.x, at.y + U * 0.4), where);
        }
        assert.equal(P.cellAt(plan, -1, 0), null);
        assert.equal(P.cellAt(plan, t.width, 0), null);
        assert.equal(P.cellAt(id, 0, t.height), null);
        assert.equal(P.planOf(id), P.planOf(id), 'a plan asked for by its id is built once');
    }
    assert.throws(() => P.build('nowhere'), /Unknown map/);
});

test('which blocks hide and which are only low: walls two high and trees hide, a one-high stone, ore and crystal do not', () => {
    const plan = P.build('looks', { name: '样子', rows: ['@.:=;h123TBOX'] });
    const look = letter => { const cell = plan.cells.find(c => c.letter === letter); return [cell.solid, cell.hides]; };
    for (const ground of ['@', '.', ':', '=', ';', 'h']) assert.deepEqual(look(ground), [false, false], ground);
    for (const low of ['1', 'O', 'X']) assert.deepEqual(look(low), [true, false], low);
    for (const high of ['2', '3', 'T', 'B']) assert.deepEqual(look(high), [true, true], high);
});

test('what stands on a map: monsters with their ranges in blocks, chests, portals with both arrival spots, buildings with their doors', () => {
    for (const id of Object.keys(MAPS)) {
        const map = MAPS[id], plan = P.build(id), t = terrainOf(map);
        assert.deepEqual(plain(plan.monsters.map(m => [m.kind, m.col, m.row, m.x, m.y, m.name, m.boss, m.alert, m.leash])),
            plain(t.monsters.map(m => [m.kind, m.col, m.row, m.col + 0.5, m.row + 0.5, MON[m.kind].name, !!MON[m.kind].boss, MON[m.kind].alertRange / U, MON[m.kind].leash / U])));
        for (const m of plan.monsters) assert.equal(T.MONSTERS[m.letter], m.kind);
        assert.deepEqual(plain(plan.spawns), plain(t.spawns.map((s, index) => ({ ...s, index }))));
        assert.deepEqual(plan.dummy && [plan.dummy.col, plan.dummy.row, plan.dummy.name], t.dummy && [t.dummy.col, t.dummy.row, gameConfig.dummy.name]);
        const listed = list => plain(list).map(k => JSON.stringify(k)).sort();
        assert.deepEqual(listed(plan.chests.map(k => [k.col, k.row, k.loot, k.requires])), listed((map.chests || []).map(k => [...k.at, k.loot, k.requires || null])));
        assert.equal(plan.portals.length, (map.portals || []).length);
        for (const p of map.portals || []) {
            const shown = plan.portals.find(q => q.col === p.at[0] && q.row === p.at[1]), dest = MAPS[p.to], far = terrainOf(dest);
            assert.deepEqual([shown.to, shown.toName, shown.facing, shown.requires, shown.requiresName], [p.to, dest.name, p.facing, p.requires || null, p.requires ? MON[p.requires].name : null]);
            // Coming in: in front of this portal. Going through: in front of
            // the one that leads back (the far map's spawn if it has none).
            const here = propKit.arrival(map, t, p.to), there = propKit.arrival(dest, far, id) || T.cellCentre(far, far.spawn.col, far.spawn.row);
            near(shown.arrival.x * U, here.x, `${id}: arriving from ${p.to}`); near(shown.arrival.y * U, here.y, `${id}: arriving from ${p.to}`);
            near(shown.lands.x * U, there.x, `${id}: landing in ${p.to}`); near(shown.lands.y * U, there.y, `${id}: landing in ${p.to}`);
            assert.equal(P.cellAt(p.to, shown.lands.col, shown.lands.row).solid, false, `${id} -> ${p.to} lands on open ground`);
        }
        assert.deepEqual(plain(plan.buildings.map(b => [b.kind, b.name, b.col, b.row, b.w, b.d, b.door, b.front])),
            plain((map.buildings || []).map(b => [b.kind, gameConfig.buildings[b.kind].name, ...b.at, propKit.doorOf(b).door, propKit.doorOf(b).front])));
    }
});

test('a map the game would refuse is still shown, with what is wrong; rows the loader cannot read throw', () => {
    assert.deepEqual(plain(P.build('yard', YARD).problems), []);
    const stray = P.build('yard', { ...YARD, chests: [] });
    assert.equal(stray.problems.length, 1);
    assert.match(stray.problems[0], /C at 6,4/);
    assert.deepEqual(plain(stray.chests), [{ col: 6, row: 4, loot: null, requires: null, requiresName: null }]);
    // A gate nobody listed: drawn, and said to lead nowhere.
    const lost = P.build('yard', { ...YARD, portals: YARD.portals.slice(0, 1) });
    assert.equal(lost.problems.length, 1);
    assert.equal(P.describe(lost, 7, 8), 'yard (7, 8) 传送门（没有登记去向） P');
    assert.throws(() => P.build('yard', { ...YARD, rows: ['@.', '.'] }), /equal in length/);
    assert.throws(() => P.build('yard', { ...YARD, rows: ['@?'] }), /Unknown map cell/);
});

test('describe says what a cell holds: a monster by name, a wall with its height, a portal with where it leads', () => {
    const plan = P.build('yard', YARD), say = (col, row) => P.describe(plan, col, row);
    assert.equal(say(2, 2), `yard (2, 2) ${MON.wolf.name} w`);
    assert.equal(say(9, 4), `yard (9, 4) ${MON.goblinChief.name}（首领） G`);
    assert.equal(say(0, 0), 'yard (0, 0) 石墙 高3（挡视线） 3');
    assert.equal(say(8, 2), 'yard (8, 2) 石墙 高2（挡视线） 2');
    assert.equal(say(5, 2), 'yard (5, 2) 石墙 高1（矮，不挡视线） 1');
    assert.equal(say(5, 3), `yard (5, 3) 树 高${T.TREE_HEIGHT}（挡视线） T`);
    assert.equal(say(8, 5), `yard (8, 5) 枯木丛 高${T.BRUSH_HEIGHT}（挡视线） B`);
    assert.equal(say(7, 3), `yard (7, 3) ${gameConfig.gather.ore.name} 高1（矮，不挡视线） O`);
    assert.equal(say(9, 3), `yard (9, 3) ${gameConfig.gather.herb.name} h`);
    assert.equal(say(1, 1), 'yard (1, 1) 草地 .');
    assert.equal(say(3, 0), `yard (3, 0) 传送门柱 高${T.PORTAL_HEIGHT}（挡视线） #`);
    assert.equal(say(4, 0), `yard (4, 0) 传送门 → ${MAPS.base.name} base P`);
    assert.equal(say(7, 8), `yard (7, 8) 传送门 → ${MAPS.field.name} field（击败${MON.goblinChief.name}后开启） P`);
    // Arriving through the north gate: arriveDistance south of it.
    const from = plan.portals.find(p => p.to === 'base').arrival;
    assert.deepEqual([from.col, from.row], [4, Math.floor(0.5 + gameConfig.props.arriveDistance / U)]);
    assert.equal(say(from.col, from.row), `yard (${from.col}, ${from.row}) 草地 · 从${MAPS.base.name}过来站这里 .`);
    assert.equal(say(6, 4), `yard (6, 4) 宝箱（${MON.goblinChief.name}守着） C`);
    assert.equal(say(2, 4), 'yard (2, 4) 出生点 @');
    const shop = gameConfig.buildings.shop.name;
    assert.equal(say(3, 5), `yard (3, 5) ${shop} · 建筑墙 高${T.HOUSE_HEIGHT}（挡视线） H`);
    assert.equal(say(4, 6), `yard (4, 6) ${shop}的门 · 建筑墙 高${T.HOUSE_HEIGHT}（挡视线） H`);
    assert.equal(say(4, 7), `yard (4, 7) 草地 · ${shop}门口 .`);
    assert.equal(say(12, 0), 'yard (12, 0) 地图外');
    assert.equal(say(0, -1), 'yard (0, -1) 地图外');
    // A duel's two spawns are told apart; the dummy goes by its name.
    assert.equal(P.describe(P.build('ring', { rows: ['@.D.@'] }), 4, 0), 'ring (4, 0) 出生点 2 @');
    assert.equal(P.describe(P.build('ring', { rows: ['@.D.@'] }), 2, 0), `ring (2, 0) ${gameConfig.dummy.name} D`);
    // The game's own maps, by id: every monster, portal and wall is named.
    for (const id of Object.keys(MAPS)) {
        const map = MAPS[id], plan = P.planOf(id);
        for (const m of plan.monsters) assert.equal(P.describe(id, m.col, m.row), `${id} (${m.col}, ${m.row}) ${MON[m.kind].name}${MON[m.kind].boss ? '（首领）' : ''} ${map.rows[m.row][m.col]}`);
        for (const p of map.portals || []) assert.ok(P.describe(id, ...p.at).startsWith(`${id} (${p.at[0]}, ${p.at[1]}) 传送门 → ${MAPS[p.to].name} ${p.to}`), `${id} ${p.at}`);
        const wall = plan.cells.findIndex(c => c.kind === 'stone');
        if (wall >= 0) assert.ok(P.describe(id, wall % plan.width, Math.floor(wall / plan.width)).includes(`石墙 高${plan.cells[wall].level}`), `${id}: a wall`);
    }
});

test('refOf points at one cell, or at a rectangle from its north-west corner whichever corners are given', () => {
    assert.equal(P.refOf('field', { col: 23, row: 5 }), 'field (23, 5)');
    assert.equal(P.refOf('field', { col: 23, row: 5 }, { col: 23, row: 5 }), 'field (23, 5)');
    assert.equal(P.refOf('field', { col: 20, row: 10 }, { col: 30, row: 15 }), 'field (20,10)-(30,15)');
    assert.equal(P.refOf('field', { col: 30, row: 15 }, { col: 20, row: 10 }), 'field (20,10)-(30,15)');
    assert.equal(P.refOf('field', { col: 20, row: 15 }, { col: 30, row: 10 }), 'field (20,10)-(30,15)');
    assert.equal(P.refOf('cave', [30, 10], [20, 15]), 'cave (20,10)-(30,15)');
    assert.equal(P.refOf('cave', [0, 3], [0, 7]), 'cave (0,3)-(0,7)');
});

test('the measure walks round a wall without cutting its corner, and finds no way into a walled-in cell', () => {
    const plan = P.build('walls', {
        rows: [
            '@...3....',
            '....3.333',
            '....3.3.3',
            '......333'
        ]
    });
    const P0 = gameConfig.player;
    // Open ground: straight across, the diagonal counted as such.
    const open = P.measure(plan, { col: 0, row: 0 }, { col: 3, row: 3 });
    near(open.straight, Math.hypot(3, 3), 'straight'); near(open.steps, 3 * Math.SQRT2, 'walk');
    near(open.walkSeconds, open.steps * U / P0.speed, 'on foot'); near(open.runSeconds, open.steps * U / P0.runSpeed, 'at a run');
    // Past the wall: down its west side, under its end and up the east
    // side. Slipping diagonally past the end's corners would be shorter.
    const round = P.measure(plan, [3, 0], [5, 0]);
    assert.equal(round.straight, 2);
    near(round.steps, 8, 'round the wall');
    assert.deepEqual(plain(round.path), [[3, 0], [3, 1], [3, 2], [3, 3], [4, 3], [5, 3], [5, 2], [5, 1], [5, 0]].map(([col, row]) => ({ col, row })));
    for (const p of round.path) assert.equal(P.cellAt(plan, p.col, p.row).solid, false);
    // The same either way; no distance to itself.
    near(P.measure(plan, [5, 0], [3, 0]).steps, 8, 'and back');
    assert.deepEqual(plain(P.measure(plan, [2, 2], [2, 2])), { straight: 0, steps: 0, path: [{ col: 2, row: 2 }], walkSeconds: 0, runSeconds: 0 });
    // Walled in, standing in a wall, off the map: no way, the straight line still measured.
    const shut = P.measure(plan, [0, 0], [7, 2]);
    assert.equal(P.cellAt(plan, 7, 2).solid, false);
    assert.deepEqual([shut.steps, shut.path, shut.walkSeconds, shut.runSeconds], [null, null, null, null]);
    near(shut.straight, Math.hypot(7, 2), 'straight to the walled-in cell');
    assert.equal(P.measure(plan, [0, 0], [4, 1]).steps, null);
    assert.equal(P.measure(plan, [0, 0], [9, 0]).steps, null);
    // On the game's maps: from the spawn to where each portal lets one in.
    for (const id of Object.keys(MAPS)) {
        const plan = P.planOf(id);
        for (const p of plan.portals) {
            const m = P.measure(id, plan.spawns[0], p.arrival);
            assert.ok(m.steps !== null && m.steps >= m.straight - 1e-9, `${id}: the spawn to the gate to ${p.to}`);
        }
    }
});

test('one screen: the ground a landscape phone shows reaches further north of the fighter than south, and is wider there', () => {
    const cam = gameConfig.camera, x = 20.5, y = 10.5, { corners, aspect, zoom } = P.screen(x, y);
    assert.deepEqual([aspect, zoom], [P.PHONE.width / P.PHONE.height, 'mid']);
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;
    const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], reach = p => Math.hypot(p[0] - x, p[1] - y);
    const far = reach(middle(topLeft, topRight)), close = reach(middle(bottomLeft, bottomRight));
    // The camera as render/world_view.js places it, worked out along the
    // screen's middle line: `distance` out at `pitch` over the point
    // lookHeight above the fighter, the vertical fov split either side.
    const d = cam.distance * cam.zoom.mid, height = cam.lookHeight + Math.sin(cam.pitch) * d, back = Math.cos(cam.pitch) * d, half = cam.fov * Math.PI / 360;
    near(far, height / Math.tan(cam.pitch - half) - back, 'the top of the screen');
    near(close, back - height / Math.tan(cam.pitch + half), 'the bottom of the screen');
    assert.ok(far > close && close > 0, `${far} blocks ahead, ${close} behind`);
    if (cam.yaw === 0) {
        // Looking north: screen-up is north, the fighter left to right in the middle.
        assert.ok(y - topLeft[1] > bottomLeft[1] - y && topLeft[1] < y && bottomLeft[1] > y);
        near(topLeft[1], topRight[1], 'level top'); near(bottomLeft[1], bottomRight[1], 'level bottom');
        near((topLeft[0] + topRight[0]) / 2, x, 'centred'); near((bottomLeft[0] + bottomRight[0]) / 2, x, 'centred');
    }
    const width = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.ok(width(topLeft, topRight) > width(bottomLeft, bottomRight), 'a trapezoid, wider at the far edge');
    // The patch moves with the fighter, and the camera settings pull it in and out.
    const moved = P.screen(x + 3, y - 2).corners;
    moved.forEach((p, i) => { near(p[0], corners[i][0] + 3, 'east'); near(p[1], corners[i][1] - 2, 'north'); });
    const spanOf = zoomed => { const c = P.screen(x, y, { zoom: zoomed }).corners; return width(c[0], c[1]); };
    assert.ok(spanOf('near') < spanOf('mid') && spanOf('mid') < spanOf('far'));
    // A screen taller than wide stands the camera further off (the game's own fit).
    assert.ok(reach(middle(...P.screen(x, y, { aspect: 390 / 844 }).corners.slice(0, 2))) > far);
});

// ---- all the maps on one sheet ----
test('the overview puts every map on one sheet, none on another, and ties their portals in pairs', () => {
    const w = P.world(), ids = Object.keys(MAPS);
    assert.deepEqual(plain(w.maps.map(m => m.id)), ids);
    for (const a of w.maps) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= w.width && a.y + a.height <= w.height, `${a.id} off the sheet`);
        assert.deepEqual([a.width, a.height], [MAPS[a.id].rows[0].length, MAPS[a.id].rows.length]);
        for (const b of w.maps) if (a !== b) assert.ok(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height, `${a.id} lies on ${b.id}`);
    }
    // Every portal of every map is one end of exactly one link, and the ends are the portals' own cells.
    const ends = w.links.flatMap(l => [l.a, l.b].filter(Boolean)), at = id => w.maps.find(m => m.id === id);
    for (const id of ids) for (const p of MAPS[id].portals || []) {
        const mine = ends.filter(e => e.id === id && e.col === p.at[0] && e.row === p.at[1]);
        assert.equal(mine.length, 1, `${id} portal to ${p.to}`);
        assert.equal(P.cellAt(id, mine[0].col, mine[0].row).kind, 'gate');
        near(mine[0].x, at(id).x + p.at[0] + 0.5, 'its place on the sheet'); near(mine[0].y, at(id).y + p.at[1] + 0.5, 'its place on the sheet');
    }
    for (const l of w.links) assert.ok(l.b && MAPS[l.a.id].portals.some(p => p.to === l.b.id) && MAPS[l.b.id].portals.some(p => p.to === l.a.id), 'the game\'s portals come in pairs');
    // A point of the sheet is a cell of the map lying there.
    const f = at('field');
    assert.deepEqual(plain(P.worldAt(w, f.x + 23.5, f.y + 5.5)), { id: 'field', col: 23, row: 5 });
    assert.equal(P.worldAt(w, -1, -1), null);
});

test('the overview lays a map on the side its portal goes out by, in line with the portal back, and says when the two ends disagree', () => {
    // A home with a gate in its north wall and one in its east wall; `up`
    // has its gate back in its south wall, as it should; `side` has its
    // gate back in its south wall too, though home's gate went out east;
    // `lone` has none.
    const maps = {
        up: { name: '北边', rows: ['33333', '3.@.3', '3...3', '3#P#3'], portals: [{ at: [2, 3], to: 'home', facing: 'north' }] },
        home: {
            name: '家', safe: true, rows: ['33#P#33', '3.....3', '3..@..#', '3.....P', '3.....#', '3333333'],
            portals: [{ at: [3, 0], to: 'up', facing: 'south', requires: 'goblinChief' }, { at: [6, 3], to: 'side', facing: 'west' }]
        },
        side: { name: '东边', rows: ['33333', '3.@.3', '3#P#3'], portals: [{ at: [2, 2], to: 'home', facing: 'north' }] },
        lone: { name: '孤岛', rows: ['333', '3@3', '333'] }
    };
    const w = P.world(maps), at = id => w.maps.find(m => m.id === id), home = at('home'), up = at('up'), side = at('side'), lone = at('lone');
    // The safe map first, the others round it.
    assert.ok(up.y + up.height <= home.y && up.x + 2 === home.x + 3, 'north of home, gate over gate');
    assert.ok(side.x >= home.x + home.width && side.y + 2 === home.y + 3, 'east of home, gate beside gate');
    assert.ok(lone.y >= Math.max(home.y + home.height, side.y + side.height), 'what no portal leads to goes underneath');
    assert.equal(Math.min(...w.maps.map(m => m.x)), 0); assert.equal(Math.min(...w.maps.map(m => m.y)), 0);
    const link = (a, b) => w.links.find(l => [l.a.id, l.b?.id].sort().join() === [a, b].sort().join());
    assert.equal(w.links.length, 2);
    assert.deepEqual([link('home', 'up').straight, link('home', 'up').requires, link('home', 'up').requiresName], [true, 'goblinChief', MON.goblinChief.name]);
    const crooked = link('home', 'side'), ends = Object.fromEntries([crooked.a, crooked.b].map(e => [e.id, e.out]));
    assert.deepEqual([crooked.straight, crooked.requires, ends], [false, null, { home: 'east', side: 'south' }]);
    // A portal with none back is a link with one end.
    const oneWay = P.world({ ...maps, side: { ...maps.side, portals: [], rows: ['33333', '3.@.3', '33333'] } });
    assert.deepEqual(plain(oneWay.links.filter(l => !l.b).map(l => [l.a.id, l.a.out, l.straight])), [['home', 'east', false]]);
});
