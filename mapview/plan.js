// The map preview's plan (map.html, a tool page; the game is index.html):
// one map of gameConfig.maps as plain data, to draw from above and to point
// at by column and row. No DOM, so the Node tests run it
// (tests/mapview.test.cjs). It only reads: the rows in game_config.js are
// changed by hand, from what is pointed at here.
// - A plan is built through the game's own loader (terrainKit.fromRows, the
//   lists next to the rows, propKit.arrival), so what is shown is what the
//   game loads. What the game would refuse (propKit.place throws) is listed
//   in `problems` and the rest is still shown.
// - Cells are (col, row) in blocks: col 0 is the west edge, row 0 the
//   north. Positions (x, y) are blocks too, a cell's centre at +0.5.
// - describe / refOf: what a cell holds, and the words to point at it by.
// - measure: straight distance and the walk between two cells.
// - screen: the ground a landscape phone shows round a fighter.
// - world: every map on one sheet, set out by where its portals lead.
const mapPlan = (() => {
    const U = () => gameConfig.world.unitsPerBlock;
    // Kinds by their terrainKit.KIND name. One not listed here (a kind added
    // later) goes by its own name.
    const KIND_NAMES = Object.freeze({
        grass: '草地', path: '土路', cobble: '石板地', gravel: '碎石地', stone: '石墙', tree: '树', wood: '建筑墙',
        portal: '传送门柱', gate: '传送门', brush: '枯木丛', ore: '铁矿', crystal: '晶石', herb: '草药', water: '水潭', hedge: '灌木', drop: '断崖外', fence: '木栅栏'
    });
    const SIDE_NAMES = Object.freeze({ north: '北', south: '南', east: '东', west: '西' });
    const kindName = kind => gameConfig.gather[kind]?.name || KIND_NAMES[kind] || String(kind);
    const bossName = kind => gameConfig.monsters[kind]?.name || kind;
    const letters = Object.fromEntries(Object.entries(terrainKit.MONSTERS).map(([letter, kind]) => [kind, letter]));
    // A cell given as { col, row } or [col, row].
    const cellOf = p => Array.isArray(p) ? { col: p[0], row: p[1] } : p;
    // A point in world units on terrain `t`, as blocks and as the cell it lies in.
    const spot = (t, at) => ({ x: at.x / t.unit, y: at.y / t.unit, col: Math.floor(at.x / t.unit), row: Math.floor(at.y / t.unit) });
    const terrainOf = map => terrainKit.fromRows(map.rows, U(), map.floor || '.');

    const maps = () => Object.entries(gameConfig.maps).map(([id, map]) => ({ id, name: map.name || id }));

    // Where someone who goes through portal `p` of map `id` stands on the
    // far side: in front of the portal that leads back, or at that map's
    // spawn when it has none (core/sim.js). Null if that map does not load.
    function landing(id, p) {
        try {
            const dest = gameConfig.maps[p.to], t = terrainOf(dest);
            return spot(t, propKit.arrival(dest, t, id) || terrainKit.cellCentre(t, t.spawn.col, t.spawn.row));
        } catch (_) { return null; }
    }

    // The plan of map `id` (`map`: the map itself, when it is not the one in
    // gameConfig.maps). Throws what the loader throws for rows it cannot read.
    function build(id, map = gameConfig.maps[id]) {
        if (!map) throw new Error(`Unknown map ${id}`);
        const T = terrainKit, t = terrainOf(map), u = t.unit, cells = [];
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            const at = T.cellCentre(t, c, r), kind = T.kindAt(t, c, r);
            cells.push({
                kind: T.NAMES[kind] ?? String(kind), level: T.levelAt(t, c, r), letter: map.rows[r][c],
                // Stands in a walker's way; hides what is behind it (a line
                // through the cell, judged as the game judges sight).
                solid: T.blocked(t, at.x, at.y, gameConfig.player.radius),
                hides: !T.sightClear(t, at.x - u * 0.4, at.y, at.x + u * 0.4, at.y)
            });
        }
        const centre = (col, row) => spot(t, T.cellCentre(t, col, row));
        const monsters = t.monsters.map(({ kind, col, row }) => {
            const S = gameConfig.monsters[kind] || {};
            return {
                kind, name: S.name || kind, boss: !!S.boss, letter: letters[kind], ...centre(col, row),
                alert: (S.alertRange || 0) / u, leash: (S.leash || 0) / u, patrol: (S.patrolRadius || 0) / u
            };
        });
        const chests = t.chests.map(({ col, row }) => {
            const k = (map.chests || []).find(q => q.at?.[0] === col && q.at?.[1] === row);
            return { col, row, loot: k?.loot || null, requires: k?.requires || null, requiresName: k?.requires ? bossName(k.requires) : null };
        });
        // Torches that stand in the map: on a stand, or on the wall on `side` of the cell.
        const lamps = t.lamps.map(({ kind, col, row }) => ({ kind, col, row, side: null }));
        const portals = t.portals.map(({ col, row }) => {
            const p = (map.portals || []).find(q => q.at?.[0] === col && q.at?.[1] === row);
            if (!p) return { col, row, to: null, toName: null, facing: null, requires: null, requiresName: null, arrival: null, lands: null };
            // `arrival`: where someone coming into this map through it stands.
            let arrival = null;
            try { const at = propKit.arrival(map, t, p.to); arrival = at && { ...spot(t, at), facing: at.facing }; } catch (_) { /* listed in problems */ }
            return {
                col, row, to: p.to, toName: gameConfig.maps[p.to]?.name || p.to, facing: p.facing,
                requires: p.requires || null, requiresName: p.requires ? bossName(p.requires) : null, arrival, lands: landing(id, p)
            };
        });
        const buildings = (map.buildings || []).map(b => {
            const [col, row, w, d] = b.at || [];
            let door = null, front = null;
            try { ({ door, front } = propKit.doorOf(b)); } catch (_) { /* listed in problems */ }
            return { kind: b.kind, name: gameConfig.buildings[b.kind]?.name || b.kind, col, row, w, d, side: b.door || 'south', door, front };
        });
        const problems = [];
        try {
            for (const e of propKit.place(map, t, null, id)) if (e.type === 'lamp') lamps.find(l => l.col === e.col && l.row === e.row).side = e.side;
        } catch (error) { problems.push(error.message); }
        return {
            id, name: map.name || id, width: t.width, height: t.height, unit: u, floor: T.NAMES[t.floor],
            safe: !!map.safe, training: !!map.training, duel: !!map.duel, dark: !!map.dark,
            cells, spawns: t.spawns.map(({ col, row }, index) => ({ col, row, index })),
            dummy: t.dummy ? { ...t.dummy, name: gameConfig.dummy.name, facing: map.dummyFacing ?? Math.PI } : null,
            monsters, chests, lamps, portals, buildings, problems
        };
    }
    // Plans by map id, built once: the page never changes a map.
    const plans = new Map();
    function planOf(map) {
        if (typeof map !== 'string') return map;
        if (!plans.has(map)) plans.set(map, build(map));
        return plans.get(map);
    }
    const inside = (plan, col, row) => Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < plan.width && row < plan.height;
    function cellAt(map, col, row) { const plan = planOf(map); return inside(plan, col, row) ? plan.cells[row * plan.width + col] : null; }

    // ---- words ----
    // The block or ground of a cell: its kind, and for a block how high it
    // stands and whether it hides.
    function ground(cell) {
        const name = kindName(cell.kind);
        if (!cell.solid) return name;
        if (!cell.level) return `${name}（过不去）`;
        return `${name} 高${cell.level}（${cell.hides ? '挡视线' : '矮，不挡视线'}）`;
    }
    // What is at a cell: what stands on it first, else the block or ground.
    function what(plan, col, row) {
        const here = m => m.col === col && m.row === row, cell = cellAt(plan, col, row);
        const monster = plan.monsters.find(here);
        if (monster) return monster.boss ? `${monster.name}（首领）` : monster.name;
        const spawn = plan.spawns.find(here);
        if (spawn) return plan.spawns.length > 1 ? `出生点 ${spawn.index + 1}` : '出生点';
        if (plan.dummy && here(plan.dummy)) return plan.dummy.name;
        const chest = plan.chests.find(here);
        if (chest) return `宝箱${chest.requires ? `（${chest.requiresName}守着）` : ''}`;
        const lamp = plan.lamps.find(here);
        if (lamp) return lamp.kind === 'wall' ? `墙上的火把${SIDE_NAMES[lamp.side] ? `（${SIDE_NAMES[lamp.side]}边的墙）` : ''}` : '立着的火炬';
        const portal = plan.portals.find(here);
        if (portal) return portal.to ? `传送门 → ${portal.toName} ${portal.to}${portal.requires ? `（击败${portal.requiresName}后开启）` : ''}` : '传送门（没有登记去向）';
        let text = ground(cell);
        const building = plan.buildings.find(b => col >= b.col && col < b.col + b.w && row >= b.row && row < b.row + b.d);
        if (building) text = `${building.name}${building.door?.[0] === col && building.door?.[1] === row ? '的门' : ''} · ${text}`;
        const door = plan.buildings.find(b => b.front?.[0] === col && b.front?.[1] === row);
        if (door) text += ` · ${door.name}门口`;
        const arrive = plan.portals.find(p => p.arrival?.col === col && p.arrival?.row === row);
        if (arrive) text += ` · 从${arrive.toName}过来站这里`;
        return text;
    }
    // `field (23, 5) 野狼 w`: the map, the cell, what is there, its letter in the rows.
    function describe(map, col, row) {
        const plan = planOf(map), cell = cellAt(plan, col, row);
        if (!cell) return `${plan.id} (${col}, ${row}) 地图外`;
        return `${plan.id} (${col}, ${row}) ${what(plan, col, row)} ${cell.letter}`;
    }
    // The words to point at a cell by, `field (23, 5)`, or at a rectangle,
    // `field (20,10)-(30,15)`: its north-west corner first, whichever two
    // corners were given.
    function refOf(mapId, a, b = a) {
        const p = cellOf(a), q = cellOf(b);
        const c0 = Math.min(p.col, q.col), c1 = Math.max(p.col, q.col), r0 = Math.min(p.row, q.row), r1 = Math.max(p.row, q.row);
        return c0 === c1 && r0 === r1 ? `${mapId} (${c0}, ${r0})` : `${mapId} (${c0},${r0})-(${c1},${r1})`;
    }

    // ---- distances ----
    // The shortest way from cell `a` to cell `b` over cells that can be
    // walked on, a step to any of the eight neighbours, never diagonally
    // past a block's corner: { steps (blocks), path (cells, both ends in) },
    // or null when there is none. Bodies in the way (a chest, the dummy) are
    // not counted, and a walker is not held to cell centres, so the real
    // walk is a little shorter on open ground.
    function walk(plan, a, b) {
        const W = plan.width, open = (c, r) => inside(plan, c, r) && !plan.cells[r * W + c].solid;
        if (!open(a.col, a.row) || !open(b.col, b.row)) return null;
        const start = a.row * W + a.col, goal = b.row * W + b.col;
        const far = new Float64Array(plan.cells.length).fill(Infinity), from = new Int32Array(plan.cells.length).fill(-1);
        // A binary heap of [distance, cell], the nearest on top.
        const heap = [];
        const push = item => {
            let i = heap.push(item) - 1;
            while (i > 0) {
                const up = (i - 1) >> 1;
                if (heap[up][0] <= heap[i][0]) break;
                [heap[up], heap[i]] = [heap[i], heap[up]]; i = up;
            }
        };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (!heap.length) return top;
            heap[0] = last;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let least = i;
                if (l < heap.length && heap[l][0] < heap[least][0]) least = l;
                if (r < heap.length && heap[r][0] < heap[least][0]) least = r;
                if (least === i) return top;
                [heap[least], heap[i]] = [heap[i], heap[least]]; i = least;
            }
        };
        far[start] = 0; push([0, start]);
        while (heap.length) {
            const [d, i] = pop();
            if (d > far[i]) continue;
            if (i === goal) break;
            const c = i % W, r = (i - c) / W;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                if ((!dc && !dr) || !open(c + dc, r + dr)) continue;
                if (dc && dr && !(open(c + dc, r) && open(c, r + dr))) continue;
                const j = (r + dr) * W + c + dc, next = d + (dc && dr ? Math.SQRT2 : 1);
                if (next < far[j] - 1e-12) { far[j] = next; from[j] = i; push([next, j]); }
            }
        }
        if (!Number.isFinite(far[goal])) return null;
        const path = [];
        for (let i = goal; i >= 0; i = from[i]) path.unshift({ col: i % W, row: Math.floor(i / W) });
        return { steps: far[goal], path };
    }
    // Between two cells: `straight` (blocks, centre to centre), the walk
    // (`steps`, `path`; null when there is no way) and how long it takes on
    // foot and at a run (seconds, at gameConfig.player's speed and runSpeed).
    function measure(map, a, b) {
        const plan = planOf(map), p = cellOf(a), q = cellOf(b), way = walk(plan, p, q), P = gameConfig.player;
        return {
            straight: Math.hypot(q.col - p.col, q.row - p.row),
            steps: way ? way.steps : null, path: way ? way.path : null,
            walkSeconds: way ? way.steps * plan.unit / P.speed : null, runSeconds: way ? way.steps * plan.unit / P.runSpeed : null
        };
    }

    // ---- one screen ----
    // The ground a landscape phone shows with its fighter standing at
    // (x, y) (blocks): the camera where render/world_view.js puts it
    // (placeCamera: `distance` away times the zoom, `pitch` above the
    // horizon, looking at the point lookHeight over the fighter; due
    // south of it, where it stands until the player turns it), and the
    // four corners of the screen cast onto the ground. `corners`: [x, y] in
    // blocks, the screen's top left, top right, bottom right, bottom left.
    // PHONE: the screen the game is laid out for; FAR: that camera's far
    // plane (blocks), where a ray that never meets the ground is cut off.
    const PHONE = Object.freeze({ width: 844, height: 390 }), FAR = 120;
    function screen(x, y, { aspect = PHONE.width / PHONE.height, zoom = 'mid' } = {}) {
        const cam = gameConfig.camera, fit = Math.max(1, 1.05 / aspect), d = cam.distance * (cam.zoom[zoom] ?? 1) * fit;
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
        // In 3D (core/space.js): x east, the second axis up, z south.
        const eye = [x + sy * cp * d, cam.lookHeight + sp * d, y + cy * cp * d];
        const ahead = [-sy * cp, -sp, -cy * cp], right = [cy, 0, -sy], up = [-sy * sp, cp, -cy * sp];
        const half = Math.tan(cam.fov * Math.PI / 360);
        const corner = (sx, sv) => {
            const ray = ahead.map((v, i) => v + right[i] * half * aspect * sx + up[i] * half * sv), length = Math.hypot(...ray);
            const t = ray[1] < -1e-9 ? Math.min(eye[1] / -ray[1], FAR / length) : FAR / length;
            return [eye[0] + ray[0] * t, eye[2] + ray[2] * t];
        };
        return { aspect, zoom, corners: [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)] };
    }

    // ---- all the maps on one sheet ----
    // Every map laid out by where its portals lead (the game has no such
    // sheet: a map is a world of its own, and a portal loads another). The
    // safe map (else the first) goes down first; then each map a portal
    // leads to, on the side that portal goes out by -- a portal's `facing`
    // is the side that leads into its own map, so the way through it leaves
    // by the other -- with its portal back in line, `gap` blocks off, and
    // slid on that way until it is clear of every map already down. Maps no
    // portal leads to (the arena) stand in a row underneath.
    // `maps`: [{ id, name, x, y, width, height, ... }], (x, y) its
    // north-west corner on the sheet in blocks. `links`: one for each pair
    // of portals, [{ a, b, requires, requiresName, straight }], an end being
    // { id, col, row, x, y (the cell's centre on the sheet), out (the side
    // the way through it leaves its map by) } and `b` null where no portal
    // leads back; `straight` is whether the two ends go out by opposite
    // sides (out by the east and in from the west) -- false where the way
    // there and the way back do not agree about where the two maps lie.
    // `maps`: other maps than gameConfig.maps (for tests).
    const WORLD = Object.freeze({ gap: 4, margin: 2 });
    const OPPOSITE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });
    function world(maps = null) {
        const all = maps || gameConfig.maps, known = new Map(), at = new Map(), D = propKit.DIRS;
        // A map the loader cannot read is left off the sheet.
        for (const id of Object.keys(all)) { try { known.set(id, maps ? build(id, all[id]) : planOf(id)); } catch (_) { /* not shown */ } }
        const ids = [...known.keys()], backOf = (from, to) => known.get(to).portals.find(q => q.to === from) || null;
        const clear = (id, x, y) => [...at].every(([other, o]) => {
            const p = known.get(id), q = known.get(other), m = WORLD.margin;
            return x >= o.x + q.width + m || o.x >= x + p.width + m || y >= o.y + q.height + m || o.y >= y + p.height + m;
        });
        const first = ids.find(id => known.get(id).safe) || ids[0], queue = [];
        if (first) { at.set(first, { x: 0, y: 0 }); queue.push(first); }
        while (queue.length) {
            const a = queue.shift(), A = at.get(a);
            for (const p of known.get(a).portals) {
                if (!known.has(p.to) || at.has(p.to) || !OPPOSITE[p.facing]) continue;
                const B = known.get(p.to), q = backOf(a, p.to), [dx, dy] = D[OPPOSITE[p.facing]];
                let x = A.x + p.col + dx * WORLD.gap - (q ? q.col : Math.floor(B.width / 2)), y = A.y + p.row + dy * WORLD.gap - (q ? q.row : Math.floor(B.height / 2));
                while (!clear(p.to, x, y)) { x += dx; y += dy; }
                at.set(p.to, { x, y }); queue.push(p.to);
            }
        }
        const edge = pick => [...at].map(([id, o]) => pick(o, known.get(id)));
        let along = at.size ? Math.min(...edge(o => o.x)) : 0;
        const under = at.size ? Math.max(...edge((o, p) => o.y + p.height)) + 3 * WORLD.margin : 0;
        for (const id of ids) if (!at.has(id)) { at.set(id, { x: along, y: under }); along += known.get(id).width + 2 * WORLD.margin; }
        const x0 = Math.min(0, ...edge(o => o.x)), y0 = Math.min(0, ...edge(o => o.y));
        for (const o of at.values()) { o.x -= x0; o.y -= y0; }
        const end = (id, p) => ({ id, col: p.col, row: p.row, x: at.get(id).x + p.col + 0.5, y: at.get(id).y + p.row + 0.5, out: OPPOSITE[p.facing] || null });
        const links = [], seen = new Set();
        for (const id of ids) for (const p of known.get(id).portals) {
            if (!known.has(p.to)) continue;
            const q = backOf(id, p.to), key = [`${id}:${p.col},${p.row}`, q ? `${p.to}:${q.col},${q.row}` : ''].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const requires = p.requires || q?.requires || null;
            links.push({ a: end(id, p), b: q ? end(p.to, q) : null, requires, requiresName: requires ? bossName(requires) : null, straight: !!q && OPPOSITE[p.facing] === q.facing });
        }
        return {
            width: at.size ? Math.max(...edge((o, p) => o.x + p.width)) : 0, height: at.size ? Math.max(...edge((o, p) => o.y + p.height)) : 0,
            maps: ids.map(id => { const p = known.get(id); return { id, name: p.name, ...at.get(id), width: p.width, height: p.height, safe: p.safe, training: p.training, duel: p.duel, dark: p.dark }; }),
            links
        };
    }
    // The map and the cell of it under point (x, y) of a world's sheet, or null.
    function worldAt(sheet, x, y) {
        const m = sheet.maps.find(m => x >= m.x && y >= m.y && x < m.x + m.width && y < m.y + m.height);
        return m ? { id: m.id, col: Math.floor(x - m.x), row: Math.floor(y - m.y) } : null;
    }

    return { KIND_NAMES, PHONE, maps, build, planOf, cellAt, kindName, describe, refOf, measure, screen, world, worldAt };
})();
