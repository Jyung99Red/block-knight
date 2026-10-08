// Block terrain (design.md 6.1): a grid where every cell
// has a kind and a height in blocks, kept in 16 x 16 chunks so a change
// rebuilds one chunk's drawing, not the world. Bodies move continuously over
// it; collision and sight read the grid. Cell (col, row) covers world x in
// [col, col + 1) * unit and y likewise; in 3D the block column stands on
// x..x+1, z..z+1. The ground is flat (design.md 1: no height
// differences); solid kinds stand as columns `level` blocks high.
//
// The terrain can change at run time (`set`: thickets burnt away, ore and
// herbs gathered). Changes are kept as `edits` against the map they were
// generated from, so a save stores only what differs.
const terrainKit = (() => {
    const CHUNK = 16, MAX_LEVEL = 15;
    // `portal` is a portal's pillar; `gate` the glowing opening between two
    // pillars, which nobody walks through (the interact key travels).
    // `brush` is a dry thicket a lit torch burns away (core/props.js).
    // `ore`, `crystal` and `herb` are resources gathered with the interact
    // key (gameConfig.gather): the first two a boulder, the herb a plant
    // walked through. `water` is a pond: nothing stands in it, so it hides
    // nobody and a blow lands across it, but no body walks into it
    // (`closedAt`; user, 2026-10-04). `hedge` is a thick bush one block
    // high: it stops bodies and blows as a low stone does and is seen over,
    // a bush for the look of a place. `drop` is the air beyond a cliff's
    // edge: like a pond no body goes there and nothing is hidden by it;
    // the ground simply ends (the east edge of the field). `fence` is a
    // wooden fence one block high: it stops bodies and blows and is seen
    // over (user, 2026-10-04: the edges of a map are not all walls).
    const KIND = Object.freeze({ grass: 0, path: 1, stone: 2, tree: 3, wood: 4, cobble: 5, gravel: 6, portal: 7, gate: 8, brush: 9, ore: 10, crystal: 11, herb: 12, water: 13, hedge: 14, drop: 15, fence: 16 });
    const NAMES = Object.freeze(Object.fromEntries(Object.entries(KIND).map(([name, k]) => [k, name])));
    const SOLID = new Set([KIND.stone, KIND.tree, KIND.wood, KIND.portal, KIND.gate, KIND.brush, KIND.ore, KIND.crystal, KIND.hedge, KIND.fence]);
    // Ground no body stands on, though nothing stands there.
    const BARRED = new Set([KIND.water, KIND.drop]);
    const RESOURCE = new Set([KIND.ore, KIND.crystal, KIND.herb]);
    const TREE_HEIGHT = 4, HOUSE_HEIGHT = 3, PORTAL_HEIGHT = 3, BRUSH_HEIGHT = 2;
    // Map letters that put a monster's home on a grass block.
    const MONSTERS = Object.freeze({ g: 'goblin', w: 'wolf', s: 'spider', G: 'goblinChief', K: 'wolfKing' });
    // Map letters that put a lamp on a ground block (core/props.js): a
    // torch on a stand, and one on the wall beside the block.
    const LAMPS = Object.freeze({ i: 'stand', '!': 'wall' });
    // Letters that mark a spot on grass: the spawn, the training dummy, a chest, a lamp.
    const MARKS = new Set(['.', '@', 'D', 'C', ...Object.keys(MONSTERS), ...Object.keys(LAMPS)]);
    // How far, in cells, a change shows beyond its own cell when drawn (a
    // tree's crown, a neighbour's hidden face): chunks that near are redrawn.
    const REACH = 3;

    // One map letter as [kind, level]. Markers lie on `floor` (grass, or a
    // map's own floor: a cave's gravel).
    function cellOf(ch, floor = KIND.grass) {
        if (MARKS.has(ch)) return [ch === '.' ? KIND.grass : floor, 0];
        if (ch === ':') return [KIND.path, 0];
        if (ch === 'P') return [KIND.gate, PORTAL_HEIGHT];
        if (ch === '=') return [KIND.cobble, 0];
        if (ch === ';') return [KIND.gravel, 0];
        if (ch === '~') return [KIND.water, 0];
        if (ch === '_') return [KIND.drop, 0];
        if (ch === '+') return [KIND.fence, 1];
        if (ch === 'T') return [KIND.tree, TREE_HEIGHT];
        if (ch === 'H') return [KIND.wood, HOUSE_HEIGHT];
        if (ch === '#') return [KIND.portal, PORTAL_HEIGHT];
        if (ch === 'B') return [KIND.brush, BRUSH_HEIGHT];
        if (ch === '*') return [KIND.hedge, 1];
        if (ch === 'O') return [KIND.ore, 1];
        if (ch === 'X') return [KIND.crystal, 1];
        if (ch === 'h') return [KIND.herb, 0];
        if (ch >= '1' && ch <= '9') return [KIND.stone, Number(ch)];
        return null;
    }

    // Rows run north (screen top) to south, one letter per cell:
    // `.` grass, `:` path, `=` cobble, `;` gravel, `~` a pond, `_` the drop
    // beyond a cliff, `+` a fence, `1`-`9` stone wall of
    // that many blocks, `T` tree, `H` a building's wall, `#` a portal's
    // pillar, `P` a portal's opening, `B` a dry thicket, `*` a hedge, `O` iron ore, `X`
    // crystal, `h` a herb, `C` a chest, `@` a
    // spawn, `D` the training dummy, `i` a standing torch, `!` a torch on
    // the wall beside the cell, and the monster letters (MONSTERS).
    // A portal's opening is solid: it is used from in front, not walked into.
    // Markers are collected for the world to place what stands on them.
    // `floor`: the letter of the ground markers lie on ('.' grass by default).
    function fromRows(rows, unit = gameConfig.world.unitsPerBlock, floor = '.') {
        const height = rows.length, width = rows[0]?.length || 0;
        if (!height || rows.some(r => r.length !== width)) throw new Error('Map rows must be non-empty and equal in length');
        const ground = cellOf(floor);
        if (!ground || !isOpen(ground[0])) throw new Error(`A map's floor must be ground, not "${floor}"`);
        const cw = Math.ceil(width / CHUNK), ch = Math.ceil(height / CHUNK);
        const t = {
            width, height, unit, cw, ch, rows: [...rows], floor: ground[0], rev: 0, edits: {},
            chunks: Array.from({ length: cw * ch }, () => ({ kind: new Uint8Array(CHUNK * CHUNK), level: new Uint8Array(CHUNK * CHUNK), rev: 0 })),
            spawn: null, spawns: [], dummy: null, monsters: [], portals: [], chests: [], lamps: []
        };
        rows.forEach((row, r) => [...row].forEach((letter, c) => {
            const cell = cellOf(letter, t.floor);
            if (!cell) throw new Error(`Unknown map cell "${letter}" at ${c},${r}`);
            write(t, c, r, cell[0], cell[1]);
            if (letter === '@') t.spawns.push({ col: c, row: r });
            else if (letter === 'D') {
                if (t.dummy) throw new Error('A map has at most one training dummy');
                t.dummy = { col: c, row: r };
            } else if (letter === 'P') t.portals.push({ col: c, row: r });
            else if (letter === 'C') t.chests.push({ col: c, row: r });
            else if (LAMPS[letter]) t.lamps.push({ kind: LAMPS[letter], col: c, row: r });
            else if (MONSTERS[letter]) t.monsters.push({ kind: MONSTERS[letter], col: c, row: r });
        }));
        if (!t.spawns.length) throw new Error('A map needs a spawn (@)');
        // `spawn` is the first; a duel uses the first two, in reading order.
        t.spawn = t.spawns[0];
        return t;
    }

    const inside = (t, c, r) => c >= 0 && r >= 0 && c < t.width && r < t.height;
    const chunkAt = (t, c, r) => t.chunks[(r >> 4) * t.cw + (c >> 4)];
    const slot = (c, r) => ((r & 15) << 4) | (c & 15);
    function write(t, c, r, kind, level) { const k = chunkAt(t, c, r), i = slot(c, r); k.kind[i] = kind; k.level[i] = level; }
    function kindAt(t, c, r) { return inside(t, c, r) ? chunkAt(t, c, r).kind[slot(c, r)] : KIND.stone; }
    function levelAt(t, c, r) { return inside(t, c, r) ? chunkAt(t, c, r).level[slot(c, r)] : 0; }
    // Outside the map counts as wall.
    function solidAt(t, c, r) { return !inside(t, c, r) || SOLID.has(chunkAt(t, c, r).kind[slot(c, r)]); }
    const isSolid = kind => SOLID.has(kind);
    // Ground a body can stand on: not a block, a pond or the drop off a cliff.
    const isOpen = kind => !SOLID.has(kind) && !BARRED.has(kind);
    // Is cell (c, r) closed to bodies? A block, a pond, a drop, or off the map.
    function closedAt(t, c, r) { return !inside(t, c, r) || !isOpen(chunkAt(t, c, r).kind[slot(c, r)]); }
    const isResource = kind => RESOURCE.has(kind);
    // What the map drew at a cell, before any change: [kind, level].
    function generated(t, c, r) { return cellOf(t.rows[r]?.[c] ?? '1', t.floor) || [KIND.stone, 1]; }
    function cellCentre(t, c, r) { return { x: (c + 0.5) * t.unit, y: (r + 0.5) * t.unit }; }

    // ---- changes at run time ----
    // Chunk index of a cell, and the cells a chunk covers.
    function chunkIndex(t, c, r) { return (r >> 4) * t.cw + (c >> 4); }
    function chunkCells(t, i) {
        const c0 = (i % t.cw) * CHUNK, r0 = Math.floor(i / t.cw) * CHUNK;
        return { c0, r0, c1: Math.min(t.width, c0 + CHUNK), r1: Math.min(t.height, r0 + CHUNK) };
    }
    // Make cell (c, r) `kind` (a name or a KIND number), `level` blocks
    // high: solid kinds 1..MAX_LEVEL, ground kinds 0. Every chunk whose
    // drawing it can touch gets a new revision. Returns whether anything
    // changed.
    function set(t, c, r, kind, level = 0) {
        const k = typeof kind === 'string' ? KIND[kind] : kind;
        if (!inside(t, c, r) || NAMES[k] === undefined || !Number.isInteger(level)) return false;
        if (SOLID.has(k) ? level < 1 || level > MAX_LEVEL : level !== 0) return false;
        if (kindAt(t, c, r) === k && levelAt(t, c, r) === level) return false;
        write(t, c, r, k, level);
        const [k0, l0] = cellOf(t.rows[r][c], t.floor), key = `${c},${r}`;
        if (k0 === k && l0 === level) delete t.edits[key]; else t.edits[key] = [NAMES[k], level];
        const touched = new Set();
        for (let dr = -REACH; dr <= REACH; dr++) for (let dc = -REACH; dc <= REACH; dc++) {
            if (inside(t, c + dc, r + dr)) touched.add(chunkIndex(t, c + dc, r + dr));
        }
        for (const i of touched) t.chunks[i].rev++;
        t.rev++;
        return true;
    }
    // The changes as a list [[col, row, kind name, level]], for a save; and
    // back. Entries that do not fit the map are skipped. Gathered resources
    // are left out: they grow back (the save keeps them apart, core/props.js).
    function edits(t) {
        return Object.entries(t.edits).map(([key, [kind, level]]) => { const [c, r] = key.split(',').map(Number); return [c, r, kind, level]; })
            .filter(([c, r]) => !RESOURCE.has(generated(t, c, r)[0]));
    }
    function applyEdits(t, list) {
        let n = 0;
        for (const e of Array.isArray(list) ? list : []) if (Array.isArray(e) && set(t, e[0], e[1], e[2], e[3])) n++;
        return n;
    }

    // ---- bodies against the grid ----
    // Does a circle at (x, y) overlap any cell closed to bodies?
    function blocked(t, x, y, radius) {
        const u = t.unit;
        for (let r = Math.floor((y - radius) / u); r <= Math.floor((y + radius) / u); r++) {
            for (let c = Math.floor((x - radius) / u); c <= Math.floor((x + radius) / u); c++) {
                if (!closedAt(t, c, r)) continue;
                const nx = Math.max(c * u, Math.min(x, (c + 1) * u)), ny = Math.max(r * u, Math.min(y, (r + 1) * u));
                if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius - 1e-9) return true;
            }
        }
        return false;
    }
    // Push a circle out of every closed cell it overlaps, each time along the
    // line from the cell's nearest point: flat walls give a slide along them,
    // block corners a slide around them.
    function pushOut(t, body, obstacles = []) {
        const u = t.unit, radius = body.radius;
        for (let pass = 0; pass < 4; pass++) {
            let moved = false;
            // Other bodies are circles: step out along the line between centres.
            for (const o of obstacles) {
                const dx = body.x - o.x, dy = body.y - o.y, d = Math.hypot(dx, dy), gap = radius + o.radius;
                if (d >= gap) continue;
                if (d > 1e-9) { body.x += dx / d * (gap - d); body.y += dy / d * (gap - d); } else body.x += gap;
                moved = true;
            }
            for (let r = Math.floor((body.y - radius) / u); r <= Math.floor((body.y + radius) / u); r++) {
                for (let c = Math.floor((body.x - radius) / u); c <= Math.floor((body.x + radius) / u); c++) {
                    if (!closedAt(t, c, r)) continue;
                    const nx = Math.max(c * u, Math.min(body.x, (c + 1) * u)), ny = Math.max(r * u, Math.min(body.y, (r + 1) * u));
                    const d = Math.hypot(body.x - nx, body.y - ny);
                    if (d >= radius) continue;
                    if (d > 1e-9) {
                        body.x += (body.x - nx) / d * (radius - d); body.y += (body.y - ny) / d * (radius - d);
                    } else {
                        // Centre inside the block: leave by the nearest face.
                        const exits = [[c * u - radius - body.x, 0], [(c + 1) * u + radius - body.x, 0], [0, r * u - radius - body.y], [0, (r + 1) * u + radius - body.y]];
                        const [ex, ey] = exits.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
                        body.x += ex; body.y += ey;
                    }
                    moved = true;
                }
            }
            if (!moved) return;
        }
    }
    // Is the straight line between two ground points free of solid blocks?
    // Sampled every eighth of a block; heights are not considered (a blow
    // across any wall does not land: design.md 4.3). A pond is no block.
    function lineClear(t, x0, y0, x1, y1) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (t.unit / 8)));
        for (let i = 1; i < n; i++) {
            const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
            if (solidAt(t, Math.floor(x / t.unit), Math.floor(y / t.unit))) return false;
        }
        return true;
    }
    // Can a fighter standing at one point see one at the other? Only blocks
    // at least `eye` high (or trees) are in the way: a knee-high stone hides
    // nobody, though a blow across it still does not land (lineClear).
    function sightClear(t, x0, y0, x1, y1, eye = 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (t.unit / 8)));
        for (let i = 1; i < n; i++) {
            const c = Math.floor((x0 + (x1 - x0) * i / n) / t.unit), r = Math.floor((y0 + (y1 - y0) * i / n) / t.unit);
            if (solidAt(t, c, r) && (!inside(t, c, r) || levelAt(t, c, r) >= eye)) return false;
        }
        return true;
    }
    // The cells that hide (as sightClear: at least `eye` high, and
    // everything off the map) with one ring of cells round the map, and the
    // corners of their outline: every one where the edge of what is seen
    // can turn. Worked out again only when the terrain changes.
    const sightGrids = new WeakMap();
    function sightGrid(t, eye) {
        let g = sightGrids.get(t);
        if (g && g.rev === t.rev && g.eye === eye) return g;
        const w = t.width + 2, grid = new Uint8Array(w * (t.height + 2)), corners = [];
        for (let r = -1; r <= t.height; r++) for (let c = -1; c <= t.width; c++) {
            grid[(r + 1) * w + c + 1] = solidAt(t, c, r) && (!inside(t, c, r) || levelAt(t, c, r) >= eye) ? 1 : 0;
        }
        // The four cells round grid point (i, j): one or three hiding is a
        // corner, and so are two across the diagonal; two side by side
        // are a straight wall.
        for (let j = 0; j <= t.height; j++) for (let i = 0; i <= t.width; i++) {
            const a = grid[j * w + i], b = grid[j * w + i + 1], c = grid[(j + 1) * w + i], d = grid[(j + 1) * w + i + 1], n = a + b + c + d;
            if (n === 1 || n === 3 || (n === 2 && a === d)) corners.push(i, j);
        }
        g = { rev: t.rev, eye, w, grid, corners };
        sightGrids.set(t, g);
        return g;
    }
    // How far (cells) a ray from (x, z) along the unit vector (dx, dz) goes
    // before it enters a hiding cell, `far` at most: cell by cell, exact.
    function sightReach(g, x, z, dx, dz, far) {
        const { w, grid } = g;
        let c = Math.floor(x), r = Math.floor(z);
        if (grid[(r + 1) * w + c + 1]) return 0;
        const sc = dx > 0 ? 1 : -1, sr = dz > 0 ? 1 : -1, perC = dx ? Math.abs(1 / dx) : Infinity, perR = dz ? Math.abs(1 / dz) : Infinity;
        let nextC = dx ? (dx > 0 ? c + 1 - x : x - c) * perC : Infinity, nextR = dz ? (dz > 0 ? r + 1 - z : z - r) * perR : Infinity;
        for (;;) {
            let d;
            if (nextC < nextR) { d = nextC; c += sc; nextC += perC; } else { d = nextR; r += sr; nextR += perR; }
            if (d >= far) return far;
            if (grid[(r + 1) * w + c + 1]) return d;
        }
    }
    // What a fighter standing at (x, y) sees of the ground, as a fan of
    // rays round it: `out.angle` (radians, ascending) and `out.reach` (how
    // far each goes before a block that hides, `far` at most), `out.n` of
    // them. Besides an even spread, two rays pass just either side of
    // every corner in reach, so between two neighbours the edge of sight
    // is one straight line: it is exact, and slides evenly as the fighter
    // walks. With `half` under a half turn the fighter sees only within
    // `half` of `facing`: rays outside that reach nothing, and two more
    // pass just either side of each edge of it; `near` is how far it still
    // sees outside that (a small ring round the body: walls hide there
    // too). `out` is reused from call to call.
    const SIGHT_SPREAD = 32, SIGHT_SPLIT = 1e-4;
    // An angle a little outside (-pi, pi] brought back into it.
    const turned = a => a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a;
    function sightFan(t, x, y, far, { eye = 2, facing = 0, half = Math.PI, near = 0, out = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) } } = {}) {
        const g = sightGrid(t, eye), px = x / t.unit, pz = y / t.unit, reach = far / t.unit, most = g.corners.length + SIGHT_SPREAD + 4;
        const narrow = half < Math.PI - 1e-9, ahead = Math.atan2(Math.sin(facing), Math.cos(facing));
        if (out.angle.length < most) { out.angle = new Float64Array(most); out.reach = new Float64Array(most); }
        let n = 0;
        // Off the map nothing is seen.
        if (inside(t, Math.floor(px), Math.floor(pz))) {
            for (let k = 0; k < SIGHT_SPREAD; k++) out.angle[n++] = ((k + 0.5) / SIGHT_SPREAD * 2 - 1) * Math.PI;
            for (let k = 0; k < g.corners.length; k += 2) {
                const dx = g.corners[k] - px, dz = g.corners[k + 1] - pz;
                if (dx * dx + dz * dz > reach * reach) continue;
                const a = Math.atan2(dz, dx);
                out.angle[n++] = turned(a - SIGHT_SPLIT); out.angle[n++] = turned(a + SIGHT_SPLIT);
            }
            if (narrow) for (const side of [-1, 1]) {
                const edge = turned(ahead + side * half);
                out.angle[n++] = turned(edge - SIGHT_SPLIT); out.angle[n++] = turned(edge + SIGHT_SPLIT);
            }
            out.angle.subarray(0, n).sort();
            for (let i = 0; i < n; i++) {
                const a = out.angle[i];
                out.reach[i] = sightReach(g, px, pz, Math.cos(a), Math.sin(a), narrow && Math.abs(turned(a - ahead)) > half ? near / t.unit : reach) * t.unit;
            }
        }
        out.n = n;
        return out;
    }
    // Move a circle body by (dx, dy), sliding along walls and round corners
    // and around other bodies (`obstacles`: circles { x, y, radius }).
    // Sub-steps keep every step under half the radius, so thin corners
    // cannot be skipped.
    function moveCircle(t, body, dx, dy, obstacles = []) {
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (body.radius / 2)));
        for (let i = 0; i < steps; i++) {
            body.x += dx / steps; body.y += dy / steps;
            pushOut(t, body, obstacles);
        }
    }

    // ---- a way round walls ----
    // A body walks straight to where it is going while nothing stands in
    // the way (`openWay`); when something does, `wayTo` gives the next
    // point of a route round it. Routes run over points half a block apart
    // (block corners, the middles of their edges and their centres), so a
    // body wider than a block still finds the middle of a gap two blocks
    // wide. All of it follows from the terrain alone and is worked out
    // again when the terrain changes: none of it is in a save or a
    // snapshot.
    // WAY_SLACK: world units a body may brush a block by (it slides along);
    // WAY_AHEAD: points of a route looked ahead for the furthest one that
    // is still straight ahead; WAY_KEPT: routes remembered at a time.
    const WAY_SLACK = 0.5, WAY_AHEAD = 16, WAY_KEPT = 12, WAY_FAR = 1e9;
    // The eight points round one: [columns, rows, cost].
    const WAY_STEPS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [-1, 1, 14], [1, -1, 14], [-1, -1, 14]];
    const ways = new WeakMap();
    function waysOf(t) {
        let w = ways.get(t);
        if (!w || w.rev !== t.rev) { w = { rev: t.rev, open: new Map(), fields: new Map() }; ways.set(t, w); }
        return w;
    }
    // Is the straight way from (x0, y0) free for a circle of `radius`, as
    // far as `short` of (x1, y1)? (`short`: the two radii when it walks up
    // to another body, whose middle it never reaches.)
    function openWay(t, x0, y0, x1, y1, radius, short = 0) {
        const d = Math.hypot(x1 - x0, y1 - y0), far = d - short;
        if (far <= 0) return true;
        const n = Math.ceil(far / (t.unit / 4)), r = Math.max(0, radius - WAY_SLACK);
        for (let i = 1; i <= n; i++) {
            const k = far * i / n / d;
            if (blocked(t, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, r)) return false;
        }
        return true;
    }
    // The points a circle of `radius` can stand on: point (i, j) is at
    // (i, j) half blocks. The map's edge is closed.
    function openPoints(t, radius) {
        const w = waysOf(t);
        if (!w.open.has(radius)) {
            const nw = t.width * 2 + 1, nh = t.height * 2 + 1, h = t.unit / 2, r = Math.max(0, radius - WAY_SLACK), open = new Uint8Array(nw * nh);
            for (let j = 1; j < nh - 1; j++) for (let i = 1; i < nw - 1; i++) open[j * nw + i] = blocked(t, i * h, j * h, r) ? 0 : 1;
            w.open.set(radius, open);
        }
        return w.open.get(radius);
    }
    // A heap of numbers, the smallest on top.
    function heapPush(heap, value) {
        let i = heap.length;
        heap.push(value);
        while (i > 0) {
            const up = (i - 1) >> 1;
            if (heap[up] <= value) break;
            heap[i] = heap[up]; i = up;
        }
        heap[i] = value;
    }
    function heapPop(heap) {
        const top = heap[0], value = heap.pop(), n = heap.length;
        if (!n) return top;
        let i = 0;
        for (;;) {
            let down = 2 * i + 1;
            if (down >= n) break;
            if (down + 1 < n && heap[down + 1] < heap[down]) down++;
            if (heap[down] >= value) break;
            heap[i] = heap[down]; i = down;
        }
        heap[i] = value;
        return top;
    }
    // Can a route step from open point `n` by (dc, dr)? Across a corner
    // only where both points beside the step are open too, so no route
    // cuts a block's corner.
    const stepOpen = (open, nw, n, dc, dr) => open[n + dr * nw + dc] && (!dc || !dr || (open[n + dc] && open[n + dr * nw]));
    // How far every open point is from point `goal` for a circle of
    // `radius`: 10 a step along a row or column, 14 across, WAY_FAR where
    // there is no way (Dijkstra from the goal).
    function fieldTo(t, radius, goal) {
        const w = waysOf(t), key = `${radius}:${goal}`;
        let field = w.fields.get(key);
        w.fields.delete(key);
        if (!field) {
            const open = openPoints(t, radius), nw = t.width * 2 + 1, size = open.length;
            field = new Int32Array(size).fill(WAY_FAR);
            field[goal] = 0;
            // Each entry is cost * size + point.
            const heap = [goal];
            while (heap.length) {
                const top = heapPop(heap), cost = Math.floor(top / size), n = top - cost * size;
                if (cost > field[n]) continue;
                for (const [dc, dr, step] of WAY_STEPS) {
                    const to = n + dr * nw + dc;
                    if (cost + step >= field[to] || !stepOpen(open, nw, n, dc, dr)) continue;
                    field[to] = cost + step;
                    heapPush(heap, (cost + step) * size + to);
                }
            }
            if (w.fields.size >= WAY_KEPT) w.fields.delete(w.fields.keys().next().value);
        }
        // The one asked for last is dropped last.
        w.fields.set(key, field);
        return field;
    }
    // The open point nearest (x, y), or -1: among the four round it, else
    // one ring further out. With a `field`, the one the route is shortest
    // from, the walk to the point counted in.
    function pointNear(t, open, x, y, field = null) {
        const nw = t.width * 2 + 1, nh = t.height * 2 + 1, h = t.unit / 2, i0 = Math.floor(x / h), j0 = Math.floor(y / h);
        for (let ring = 0; ring < 2; ring++) {
            let best = -1, least = Infinity;
            for (let j = Math.max(0, j0 - ring); j <= Math.min(nh - 1, j0 + 1 + ring); j++) for (let i = Math.max(0, i0 - ring); i <= Math.min(nw - 1, i0 + 1 + ring); i++) {
                const n = j * nw + i;
                if (!open[n] || (field && field[n] >= WAY_FAR)) continue;
                const cost = Math.hypot(i * h - x, j * h - y) / h * 10 + (field ? field[n] : 0);
                if (cost < least) { least = cost; best = n; }
            }
            if (best >= 0) return best;
        }
        return -1;
    }
    // Where a circle of `radius` at (x, y) walks next to get to (tx, ty),
    // or to within `short` of it: (tx, ty) itself while the straight way
    // is open (`out.direct`), else the furthest point of the route round
    // that is still straight ahead. With no route at all it is (tx, ty)
    // again: the body walks at the wall, as it would without this. `out`
    // is reused from call to call.
    function wayTo(t, x, y, tx, ty, radius, short = 0, out = {}) {
        out.x = tx; out.y = ty; out.direct = openWay(t, x, y, tx, ty, radius, short);
        if (out.direct) return out;
        const open = openPoints(t, radius), goal = pointNear(t, open, tx, ty);
        if (goal < 0) return out;
        const field = fieldTo(t, radius, goal), nw = t.width * 2 + 1, h = t.unit / 2;
        let at = pointNear(t, open, x, y, field), best = -1;
        if (at < 0) return out;
        for (let k = 0; k <= WAY_AHEAD; k++) {
            const px = (at % nw) * h, py = Math.floor(at / nw) * h;
            // A point it already stands on is passed over; the first one
            // beyond is walked to whatever it brushes on the way.
            if (Math.hypot(px - x, py - y) >= h / 2) {
                if (best >= 0 && !openWay(t, x, y, px, py, radius)) break;
                best = at;
            }
            if (!field[at]) break;
            let next = at;
            for (const [dc, dr] of WAY_STEPS) {
                const to = at + dr * nw + dc;
                if (field[to] < field[next] && stepOpen(open, nw, at, dc, dr)) next = to;
            }
            at = next;
        }
        if (best >= 0) { out.x = (best % nw) * h; out.y = Math.floor(best / nw) * h; }
        return out;
    }
    return {
        CHUNK, MAX_LEVEL, KIND, NAMES, TREE_HEIGHT, HOUSE_HEIGHT, PORTAL_HEIGHT, BRUSH_HEIGHT, MONSTERS, LAMPS,
        cellOf, fromRows, inside, kindAt, levelAt, solidAt, closedAt, isSolid, isOpen, isResource, generated, cellCentre,
        chunkIndex, chunkCells, set, edits, applyEdits,
        blocked, lineClear, sightClear, sightFan, moveCircle, openWay, wayTo
    };
})();
