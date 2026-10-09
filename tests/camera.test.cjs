// The camera's picture on the ground (core/space.js `sight`, `holdCamera`,
// `pictureReaches`) and the ground the fighter can come to
// (terrainKit.reachOf) that the camera keeps to (render/world_view.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { space, terrainKit: T, propKit, gameConfig } = load();
// (The map preview casts the same camera's screen onto the ground, with maths of its own.)
const { mapPlan: P } = load({ entry: 'map', include: file => file !== 'mapview/page.js' });
const CAM = gameConfig.camera, U = gameConfig.world.unitsPerBlock, EDGE = CAM.edge;
const ASPECT = P.PHONE.width / P.PHONE.height;
const lens = { pitch: CAM.pitch, fov: CAM.fov, aspect: ASPECT, distance: CAM.distance, lookHeight: CAM.lookHeight };
const view = space.sight(lens);
// (Arrays made in the game's own context are not this one's.)
const plain = value => JSON.parse(JSON.stringify(value));
const near = (a, b, text) => assert.ok(Math.abs(a - b) < 1e-9, `${text}: ${a} against ${b}`);
const terrainOf = map => T.fromRows(map.rows, U, map.floor || '.');
// The ground a body comes to: a box, 40 blocks by 30.
const BOX = [10, 20, 50, 50];
const hold = (at, yaw, options = {}) => space.holdCamera(at, yaw, view, { reach: BOX, edge: EDGE, ...options });
// Where the body stands in the picture whose middle is `look`: [to the right, away from the camera].
const placed = (at, look, yaw) => {
    const dx = at[0] - look[0], dz = at[1] - look[1];
    return [dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw)];
};

test('sight: how far the picture goes is what the map preview casts from the same camera', () => {
    const { corners } = P.screen(30, 30);
    // Looking north: the top corners lie `ahead` north of the fighter and `wide` to each side, the bottom ones `behind` south.
    near(corners[0][1], 30 - view.ahead, 'top edge');
    near(corners[3][1], 30 + view.behind, 'bottom edge');
    near(corners[1][0], 30 + view.wide, 'top right corner');
    near(corners[0][0], 30 - view.wide, 'top left corner');
    assert.ok(view.wide > view.right && view.ahead > view.behind, 'wider at the far edge, and reaching further forward than back');
    near(view.right, Math.tan(CAM.fov * Math.PI / 360) * ASPECT * CAM.distance, 'half the width where the camera looks');
});

test('holdCamera: well inside the ground the camera looks at the body', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 3, -2]) {
        const look = hold([30, 35], yaw);
        near(look[0], 30, 'x'); near(look[1], 35, 'z');
    }
});

test('holdCamera: near the edge the camera stops, and the body is `edge` short of the picture\'s edge', () => {
    // Camera due south: screen-right is east, screen-up is north.
    const west = hold([BOX[0], 35], 0);
    near(west[0] - view.right, BOX[0] - EDGE, 'the picture\'s west edge is `edge` blocks past the ground');
    near(west[0] - BOX[0], view.right - EDGE, 'the body stands this far from the picture\'s middle');
    const east = hold([BOX[2], 35], 0);
    near(east[0] + view.right, BOX[2] + EDGE, 'east edge');
    const north = hold([30, BOX[1]], 0);
    near(north[1] - view.ahead, BOX[1] - EDGE, 'north edge');
    const south = hold([30, BOX[3]], 0);
    near(south[1] + view.behind, BOX[3] + EDGE, 'south edge');
    // Before the body is that near the edge, the camera still follows it.
    const before = hold([BOX[0] + view.right - EDGE + 1, 35], 0);
    near(before[0], BOX[0] + view.right - EDGE + 1, 'still following');
    // Turned a quarter round (the camera due east, looking west), screen-right is north.
    const turned = hold([30, BOX[1]], Math.PI / 2);
    near(turned[1] - view.right, BOX[1] - EDGE, 'the north edge of the picture');
});

test('holdCamera: the picture never shows more than `edge` blocks past the ground, the camera turned square to the map', () => {
    for (let k = 0; k < 4; k++) for (const at of [[BOX[0], BOX[1]], [BOX[2], BOX[3]], [BOX[0], BOX[3]], [BOX[2], BOX[1]], [30, BOX[1]], [BOX[2], 35], [BOX[0], BOX[1] + 1]]) {
        const yaw = k * Math.PI / 2, look = hold(at, yaw);
        // The picture's four corners (at the body's own depth for the sides).
        for (const u of [-view.right, view.right]) for (const f of [-view.behind, view.ahead]) {
            const x = look[0] + u * Math.cos(yaw) - f * Math.sin(yaw), z = look[1] - u * Math.sin(yaw) - f * Math.cos(yaw);
            assert.ok(x >= BOX[0] - EDGE - 1e-9 && x <= BOX[2] + EDGE + 1e-9 && z >= BOX[1] - EDGE - 1e-9 && z <= BOX[3] + EDGE + 1e-9, `yaw ${yaw}, body ${at}: corner (${x}, ${z}) is out`);
        }
    }
});

// (Turned corner-wise to the map, the picture cannot both keep inside the ground and keep the body in it at the ground's corners: the body comes first.)
test('holdCamera: the body stays in the picture, never nearer its edge than `edge`, wherever it is and however the camera is turned', () => {
    for (const reach of [BOX, [10, 20, 24, 33], [10, 20, 16, 23]]) for (let k = 0; k < 36; k++) for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        const at = [reach[0] + (reach[2] - reach[0]) * i / 8, reach[1] + (reach[3] - reach[1]) * j / 8], yaw = k * Math.PI / 18;
        const look = space.holdCamera(at, yaw, view, { reach, edge: EDGE });
        const [across, along] = placed(at, look, yaw);
        assert.ok(Math.abs(across) <= view.right - EDGE + 1e-9, `to the side: ${across}`);
        assert.ok(along <= view.ahead - EDGE + 1e-9 && along >= -(view.behind - EDGE) - 1e-9, `up and down: ${along}`);
    }
});

test('holdCamera: ground too small for the picture is looked at from its middle; turning the camera moves it smoothly', () => {
    // 6 blocks across: the picture is wider than the ground and `edge` on both sides, whatever the camera.
    const narrow = [30, 20, 36, 50];
    const a = space.holdCamera([31, 30], 0, view, { reach: narrow, edge: EDGE }), b = space.holdCamera([35, 30], 0, view, { reach: narrow, edge: EDGE });
    near(a[0], 33, 'the middle of the ground'); near(b[0], 33, 'the same wherever the body is');
    // No jump as the camera turns, with the body by the edge.
    let last = hold([BOX[0], BOX[1]], 0);
    for (let k = 1; k <= 720; k++) {
        const next = hold([BOX[0], BOX[1]], k * Math.PI / 360);
        assert.ok(Math.hypot(next[0] - last[0], next[1] - last[1]) < 0.5, `a jump at ${k / 2} degrees`);
        last = next;
    }
    // `far` cuts a picture that would reach without end.
    const flat = space.sight({ ...lens, pitch: 0.5, fov: 60 });
    assert.ok(flat.ahead > 50, 'level with the horizon the ground has no end');
    const cut = space.holdCamera([30, 35], 0, flat, { reach: BOX, edge: EDGE, far: 18 });
    assert.ok(Number.isFinite(cut[0]) && Number.isFinite(cut[1]));
});

test('pictureReaches: light is wanted where it can fall on the picture and not further', () => {
    const look = [30, 30];
    // Looking north (yaw 0): `ahead` north, `behind` south, `wide` to each side.
    assert.ok(space.pictureReaches(look, 0, view, 30, 30, 1), 'at the middle');
    assert.ok(space.pictureReaches(look, 0, view, 30, 30 - view.ahead - 5.9, 6), 'its light reaches in from the north');
    assert.ok(!space.pictureReaches(look, 0, view, 30, 30 - view.ahead - 6.1, 6), 'but not from further');
    assert.ok(space.pictureReaches(look, 0, view, 30, 30 + view.behind + 5.9, 6), 'south');
    assert.ok(!space.pictureReaches(look, 0, view, 30, 30 + view.behind + 6.1, 6));
    assert.ok(space.pictureReaches(look, 0, view, 30 + view.wide + 5.9, 30, 6), 'east');
    assert.ok(!space.pictureReaches(look, 0, view, 30 - view.wide - 6.1, 30, 6), 'west');
    // Turned a quarter round (the camera due east, looking west), `ahead` is west.
    assert.ok(space.pictureReaches(look, Math.PI / 2, view, 30 - view.ahead - 5.9, 30, 6));
    assert.ok(!space.pictureReaches(look, Math.PI / 2, view, 30 + view.behind + 6.1, 30, 6));
    // The corner of the box: further than the radius along the diagonal.
    assert.ok(!space.pictureReaches(look, 0, view, 30 + view.wide + 5, 30 - view.ahead - 5, 6), 'diagonally 7.07 away');
    assert.ok(space.pictureReaches(look, 0, view, 30 + view.wide + 4, 30 - view.ahead - 4, 6), 'diagonally 5.66 away');
});

test('reachOf: the ground a fighter can come to, in every map, holds everything that is in the map to be come to', () => {
    for (const [id, map] of Object.entries(gameConfig.maps)) {
        const t = terrainOf(map), [x0, z0, x1, z1] = T.reachOf(t);
        const within = (col, row, what) => assert.ok(col + 0.5 > x0 && col + 0.5 < x1 && row + 0.5 > z0 && row + 0.5 < z1, `${id}: ${what} (${col}, ${row}) lies outside [${x0}, ${z0}, ${x1}, ${z1}]`);
        for (const s of t.spawns) within(s.col, s.row, 'a spawn');
        for (const m of t.monsters) within(m.col, m.row, `a ${m.kind}'s home`);
        for (const c of t.chests) within(c.col, c.row, 'a chest');
        for (const l of t.lamps) within(l.col, l.row, 'a torch');
        if (t.dummy) within(t.dummy.col, t.dummy.row, 'the dummy');
        // Where someone arriving through each portal stands, in the map it leads to.
        for (const p of map.portals || []) {
            const dest = gameConfig.maps[p.to], far = terrainOf(dest), box = T.reachOf(far);
            const at = propKit.arrival(dest, far, id) || T.cellCentre(far, far.spawn.col, far.spawn.row);
            assert.ok(at.x / U > box[0] && at.x / U < box[2] && at.y / U > box[1] && at.y / U < box[3], `${id} -> ${p.to}: the landing is outside ${box}`);
        }
        // The ground is a box inside the map, not the map.
        assert.ok(x0 >= 0 && z0 >= 0 && x1 <= t.width && z1 <= t.height && x1 > x0 && z1 > z0);
    }
});

test('reachOf: ground seen over a low wall but never walked to is left out; a thicket that can be burnt away is not', () => {
    // A yard walled in on the east by a low wall, with grass beyond it; a thicket shuts the little room in the south.
    const rows = ['33333333333', '3.@.....1..', '3.......1..', '3333BB33333', '3.....33333', '33333333333'];
    const yard = T.fromRows(rows, U, '.');
    assert.deepEqual(plain(T.reachOf(yard)), [1, 1, 8, 5], 'the yard and the room behind the thicket, not the grass past the wall');
    // Burnt away, nothing changes: the thicket's cells are inside already.
    T.set(yard, 4, 3, 'grass', 0);
    assert.deepEqual(plain(T.reachOf(yard)), [1, 1, 8, 5]);
    // Were it stone, the room would be shut off for good.
    assert.deepEqual(plain(T.reachOf(T.fromRows(rows.map(r => r.replace(/B/g, '3')), U, '.'))), [1, 1, 8, 3]);
});
