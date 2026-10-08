// Light baked into the terrain's drawing (render/terrain_mesh.js), worked
// out on the block grid; no three.js, so Node tests run it. Presentation
// only: nothing here is judged.
//
// Sky visibility: each face is as bright in the sky's light as the share
// of the sky it sees. Rays go out from the open cell in front of the face
// over the half of the sky it faces, and walk the block grid; those that
// get out (above every block, or `SKY.far` blocks off) are its sky. So a
// cave, the ground under a tree's crown, a narrow way between walls and
// the foot of a wall or a house are darker, the open field is not (user,
// 2026-10-06). Only the sky's light is dimmed: the sun's has its own
// shadows.
//
// Block light: what gives light (a torch, a burning thicket, the glow at a
// cave's doors) spreads it over the ground cell by cell, round corners,
// fading a step at a time; a wall at least two blocks high stops it, so
// behind a wall stays dark (user, 2026-10-06). The terrain's material
// reads it from a small texture, a texel a cell; near a torch its real
// light and shadows are on top, so this is the soft glow further off.
//
// Light probes: the colour of the ground and the walls given back onto
// what is near them -- green beside grass, warm beside earth and wood
// (user, 2026-10-06). A coarse grid of points over the map each looks all
// round along the block grid and keeps what it sees (each face's own
// colour, as lit as the sky it sees) in nine numbers a colour (spherical
// harmonics); three.js reads them for every lit material, characters too.
// The light of the hour is a factor laid on afterwards, so the hour
// moving on needs no new look round.
const terrainLight = (() => {
    // Rays per face, how far they go and what a face that sees no sky
    // keeps: game_config.js graphics.openSky.
    const SKY = gameConfig.graphics.openSky;
    // How far beyond the map the grid goes: tree crowns and roofs hang over
    // its edge.
    const MARGIN = 3;
    // The faces' outward directions, by name (as render/terrain_mesh.js).
    const NORMALS = { top: [0, 1, 0], south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] };
    const SIDE = Object.keys(NORMALS);
    const sideOf = n => n[1] > 0 ? 0 : n[2] > 0 ? 1 : n[2] < 0 ? 2 : n[0] > 0 ? 3 : 4;

    // The opaque blocks as a dense grid: the terrain's columns (but gates
    // and fences, which light passes) and `extra` ([x, y, z, name] each:
    // tree crowns, roofs, lintels, `name` their tile). Under the ground
    // (y < 0) is solid; beyond the grid's sides and above its top is open
    // air. `paint(c, y, r)` names what fills a cell: the terrain kind's
    // name, or the extra block's.
    function blocks(t, extra = []) {
        const K = terrainKit.KIND, x0 = -MARGIN, z0 = -MARGIN, w = t.width + 2 * MARGIN, d = t.height + 2 * MARGIN;
        let h = 1;
        const more = [...extra];
        for (const [, y] of more) h = Math.max(h, y + 1);
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) if (terrainKit.isSolid(terrainKit.kindAt(t, c, r))) h = Math.max(h, terrainKit.levelAt(t, c, r));
        const cells = new Uint8Array(w * d * h), index = (c, y, r) => (y * d + r - z0) * w + c - x0;
        // What fills each cell, by number into `paints` (0: nothing).
        const paints = [null], paintOf = new Map(), named = name => {
            if (!paintOf.has(name)) { paintOf.set(name, paints.length); paints.push(name); }
            return paintOf.get(name);
        };
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            const k = terrainKit.kindAt(t, c, r);
            if (!terrainKit.isSolid(k) || k === K.gate || k === K.fence) continue;
            for (let y = 0, top = terrainKit.levelAt(t, c, r), p = named(terrainKit.NAMES[k]); y < top; y++) cells[index(c, y, r)] = p;
        }
        for (const [x, y, z, name = 'block'] of more) if (x >= x0 && z >= z0 && x < x0 + w && z < z0 + d && y >= 0) cells[index(x, y, z)] = named(name);
        function solid(c, y, r) {
            if (y < 0) return true;
            if (y >= h || c < x0 || r < z0 || c >= x0 + w || r >= z0 + d) return false;
            return cells[index(c, y, r)] !== 0;
        }
        const paint = (c, y, r) => y < 0 || y >= h || c < x0 || r < z0 || c >= x0 + w || r >= z0 + d ? null : paints[cells[index(c, y, r)]];
        return { x0, z0, w, d, h, cells, index, solid, paint };
    }

    // Directions over the sky as a face looking along `n` sees it: spread
    // evenly by how much each counts to a face (more straight out than
    // aslant), and only those above the horizon.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    function directions(n) {
        const up = [0, 1, 0], out = [];
        // A frame round n: a, b across it.
        const a = n[1] ? [1, 0, 0] : up, b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
        const total = n[1] ? SKY.rays : SKY.rays * 2;
        for (let i = 0; i < total; i++) {
            const u = (i + 0.5) / total, s = Math.sqrt(u), along = Math.sqrt(1 - u), phi = i * GOLDEN;
            const x = s * Math.cos(phi), z = s * Math.sin(phi);
            const v = [0, 1, 2].map(k => n[k] * along + a[k] * x + b[k] * z);
            if (v[1] > 0.02) out.push(v);
        }
        return out;
    }
    // Per way a face looks, its rays as [x, y, z, x, y, z, ...].
    const RAYS = SIDE.map(name => Float64Array.from(directions(NORMALS[name]).flat()));

    // The sky a face sees, 0..1, by the open cell (c, y, r) it looks out
    // into and the way it looks (`n`): the share of its rays that get out
    // of the grid's blocks within SKY.far, walked cell by cell. Worked out
    // once per cell and way, until the grid changes.
    function sky(g) {
        const seen = new Float32Array(g.w * g.d * g.h * SIDE.length).fill(-1), { cells, x0, z0, w, d, h } = g, far = SKY.far;
        // Does the ray from the middle of (c, y, r) along (dx, dy, dz), dy > 0, get out?
        function free(c, y, r, dx, dy, dz) {
            const sc = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, ax = Math.abs(dx), az = Math.abs(dz);
            const ix = ax > 1e-9 ? 1 / ax : Infinity, iy = 1 / dy, iz = az > 1e-9 ? 1 / az : Infinity;
            let tx = ix / 2, ty = iy / 2, tz = iz / 2;
            for (;;) {
                if (tx < ty && tx < tz) { if (tx > far) return true; c += sc; tx += ix; }
                else if (ty < tz) { if (ty > far) return true; y++; ty += iy; if (y >= h) return true; }
                else { if (tz > far) return true; r += sz; tz += iz; }
                if (c >= x0 && r >= z0 && c < x0 + w && r < z0 + d && cells[(y * d + r - z0) * w + c - x0] !== 0) return false;
            }
        }
        return function at(c, y, r, n) {
            if (y >= h || c < x0 || r < z0 || c >= x0 + w || r >= z0 + d) return 1;
            if (y < 0) return 0;
            const s = sideOf(n), i = g.index(c, y, r) * SIDE.length + s;
            if (seen[i] >= 0) return seen[i];
            const rays = RAYS[s], count = rays.length / 3;
            let open = 0;
            for (let k = 0; k < rays.length; k += 3) if (free(c, y, r, rays[k], rays[k + 1], rays[k + 2])) open++;
            return seen[i] = open / count;
        };
    }
    // How much of the sky's light a face keeps where it sees `share` of the sky.
    const skyShade = share => SKY.floor + (1 - SKY.floor) * share;

    // The sky light at each corner (`points`) of the face of block (c, y, r)
    // that looks along `n`: the mean of the open cells, of the four the
    // corner touches in the layer the face looks into, so it shades
    // smoothly from one face to the next. `skyAt` as from `sky`.
    function corners(g, skyAt, points, n, c, y, r) {
        const axes = [0, 1, 2].filter(k => n[k] === 0), at = [c + n[0], y + n[1], r + n[2]], mid = [c + 0.5, y + 0.5, r + 0.5];
        return points.map(p => {
            let sum = 0, count = 0;
            for (let m = 0; m < 4; m++) {
                const q = [...at];
                for (const [i, k] of axes.entries()) if (m >> i & 1) q[k] += p[k] > mid[k] ? 1 : -1;
                if (m && g.solid(q[0], q[1], q[2])) continue;
                sum += skyAt(q[0], q[1], q[2], n); count++;
            }
            return skyShade(sum / count);
        });
    }

    // ---- block light ----
    // Does cell (c, r) stop light? Off the map, and blocks two high or
    // more (the portal's glowing opening lets it by).
    function shuts(t, c, r) {
        if (!terrainKit.inside(t, c, r)) return true;
        const k = terrainKit.kindAt(t, c, r);
        return terrainKit.isSolid(k) && k !== terrainKit.KIND.gate && terrainKit.levelAt(t, c, r) >= 2;
    }
    const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    // The light over the map from `sources` ({ c, r, reach, rgb: [r, g, b] }
    // each: the cell it is in, how many cells its light goes, its colour
    // 0..1): from each, the way round blocks to every cell (a step aslant
    // only where both cells beside it are open), its light falling off
    // in a straight line to nothing at `reach`; the sources' light adds
    // up. Written as RGBA bytes, a texel a cell, row by row from the north
    // (into `out` if given). Cells that stop light get none.
    function blockLight(t, sources, out = new Uint8Array(t.width * t.height * 4)) {
        const w = t.width, sum = new Float32Array(w * t.height * 3), far = new Float32Array(w * t.height).fill(Infinity), seen = [];
        out.fill(0);
        for (const { c, r, reach, rgb } of sources) {
            if (shuts(t, c, r) || reach <= 0) continue;
            far[r * w + c] = 0; seen.push(r * w + c);
            // Short ways first, near enough: the cells are few.
            for (let queue = [r * w + c]; queue.length;) {
                const at = queue.shift(), ac = at % w, ar = (at - ac) / w, d0 = far[at];
                for (const [dc, dr, cost] of STEPS) {
                    const nc = ac + dc, nr = ar + dr, d = d0 + cost;
                    if (d >= reach || shuts(t, nc, nr) || (dc && dr && (shuts(t, ac + dc, ar) || shuts(t, ac, ar + dr)))) continue;
                    const n = nr * w + nc;
                    if (d < far[n]) { if (far[n] === Infinity) seen.push(n); far[n] = d; queue.push(n); }
                }
            }
            for (const n of seen) {
                const k = 1 - far[n] / reach;
                for (let i = 0; i < 3; i++) sum[n * 3 + i] += rgb[i] * k;
                far[n] = Infinity;
            }
            seen.length = 0;
        }
        for (let n = 0; n < w * t.height; n++) {
            for (let i = 0; i < 3; i++) out[n * 4 + i] = Math.round(255 * Math.min(1, sum[n * 3 + i]));
            out[n * 4 + 3] = 255;
        }
        return out;
    }

    // ---- light probes ----
    // A probe every `spacing` blocks across the map, at `heights`; `rays`
    // looks round each, `far` blocks long.
    const PROBES = { spacing: 2, heights: [0.5, 1.5, 2.5], rays: 32, far: 6 };
    // Directions spread evenly over the whole sphere.
    const ROUND = Array.from({ length: PROBES.rays }, (_, i) => {
        const y = 1 - 2 * (i + 0.5) / PROBES.rays, s = Math.sqrt(1 - y * y), phi = i * GOLDEN;
        return [s * Math.cos(phi), y, s * Math.sin(phi)];
    });
    // The nine numbers of a direction (three.js's order and scale).
    const basis = ([x, y, z]) => [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
    // The first block a ray from (ox, oy, oz) along (dx, dy, dz) runs into
    // within `far`, written into `hit`: the cell [0..2], the open cell it
    // came from [3..5] (whose face it struck looks back along the ray's
    // last step: [6..8]). Returns false if none.
    function march(g, ox, oy, oz, dx, dy, dz, far, hit) {
        const { cells, x0, z0, w, d, h } = g;
        let c = Math.floor(ox), y = Math.floor(oy), r = Math.floor(oz);
        const sc = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        const ix = Math.abs(dx) > 1e-9 ? 1 / Math.abs(dx) : Infinity, iy = Math.abs(dy) > 1e-9 ? 1 / Math.abs(dy) : Infinity, iz = Math.abs(dz) > 1e-9 ? 1 / Math.abs(dz) : Infinity;
        let tx = ix * (dx > 0 ? c + 1 - ox : ox - c), ty = iy * (dy > 0 ? y + 1 - oy : oy - y), tz = iz * (dz > 0 ? r + 1 - oz : oz - r);
        for (;;) {
            let axis;
            if (tx < ty && tx < tz) { if (tx > far) return false; c += sc; tx += ix; axis = 0; }
            else if (ty < tz) { if (ty > far) return false; y += sy; ty += iy; axis = 1; if (y >= h) return false; }
            else { if (tz > far) return false; r += sz; tz += iz; axis = 2; }
            if (y < 0 || (c >= x0 && r >= z0 && c < x0 + w && r < z0 + d && cells[(y * d + r - z0) * w + c - x0] !== 0)) {
                hit[0] = c; hit[1] = y; hit[2] = r;
                hit[6] = axis === 0 ? -sc : 0; hit[7] = axis === 1 ? -sy : 0; hit[8] = axis === 2 ? -sz : 0;
                hit[3] = c + hit[6]; hit[4] = y + hit[7]; hit[5] = r + hit[8];
                return true;
            }
        }
    }
    // Look round from every probe. `colour(name)`: the colour ([r, g, b],
    // linear) of a block (`g.paint`'s names) or of the ground under open
    // cell (c, r) (`ground(c, r)`'s names; null where there is none, as
    // past a cliff); `skyAt` as from `sky`. Each face seen counts as its
    // colour times the sky light on it (skyShade; a face looking down sees
    // none). Returns where the
    // probes stand (`min`, `max`, blocks; `count` along x, y, z) and their
    // numbers, 27 a probe (nine per colour, colour by colour), x fastest,
    // then y, then z. A probe inside a block takes a neighbour's numbers.
    function probes(g, t, { colour, ground, skyAt }) {
        const { spacing, heights } = PROBES, nx = Math.ceil((t.width - 1) / spacing) + 1, nz = Math.ceil((t.height - 1) / spacing) + 1, ny = heights.length;
        const min = [0.5, heights[0], 0.5], max = [0.5 + (nx - 1) * spacing, heights[ny - 1], 0.5 + (nz - 1) * spacing];
        const sh = new Float32Array(nx * ny * nz * 27), inside = new Uint8Array(nx * ny * nz), weight = 4 * Math.PI / ROUND.length;
        const bases = ROUND.map(basis), hit = new Int32Array(9), n = [0, 0, 0], known = new Map();
        const colours = name => { if (!known.has(name)) known.set(name, colour(name)); return known.get(name); };
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const p = (k * ny + j) * nx + i, x = min[0] + i * spacing, y = heights[j], z = min[2] + k * spacing;
            if (g.solid(Math.floor(x), Math.floor(y), Math.floor(z))) { inside[p] = 1; continue; }
            for (let q = 0; q < ROUND.length; q++) {
                const [dx, dy, dz] = ROUND[q];
                if (!march(g, x, y, z, dx, dy, dz, PROBES.far, hit)) continue;
                const name = hit[1] < 0 ? ground(hit[0], hit[2]) : g.paint(hit[0], hit[1], hit[2]), rgb = name && colours(name);
                if (!rgb) continue;
                n[0] = hit[6]; n[1] = hit[7]; n[2] = hit[8];
                const lit = skyShade(n[1] < 0 ? 0 : skyAt(hit[3], hit[4], hit[5], n)) * weight, Y = bases[q], o = p * 27;
                for (let b = 0; b < 9; b++) { const v = lit * Y[b]; sh[o + b] += rgb[0] * v; sh[o + 9 + b] += rgb[1] * v; sh[o + 18 + b] += rgb[2] * v; }
            }
        }
        // Probes inside blocks: a neighbour's numbers, so a face beside the
        // block does not darken towards the inside.
        for (let pass = 0; pass < 2; pass++) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const p = (k * ny + j) * nx + i;
            if (inside[p] !== 1) continue;
            for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
                const a = i + di, b = j + dj, e = k + dk, q = (e * ny + b) * nx + a;
                if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz || inside[q] === 1) continue;
                sh.copyWithin(p * 27, q * 27, q * 27 + 27);
                inside[p] = 2;
                break;
            }
        }
        return { min, max, count: [nx, ny, nz], sh };
    }

    return { SKY, PROBES, blocks, sky, corners, skyShade, shuts, blockLight, probes };
})();
