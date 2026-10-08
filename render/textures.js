// Procedural 16x16 pixel textures, drawn by code at start and sampled
// nearest-neighbour (design.md 2.1). Presentation only.
// Terrain blocks share one atlas (8 x 4 tiles), so a whole 16 x 16 chunk is
// one mesh and one draw (render/terrain_mesh.js); the grass beyond the map
// and the grain on character boxes are textures of their own.
const renderTextures = (() => {
    // Seeded so the world looks the same on every load.
    function rng(seed) {
        let a = seed | 0;
        return () => {
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    const rgbOf = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const shade = (c, k) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
    // Atlas tiles, in order; the atlas is ATLAS_COLS wide.
    const TILES = ['grassTop', 'dirt', 'path', 'stone', 'mossy', 'bark', 'barkTop', 'leaves', 'cobble', 'gravel', 'plank', 'roof', 'door', 'window', 'portalStone', 'white', 'brush', 'ore', 'crystalRock'];
    const ATLAS_COLS = 8, ATLAS_ROWS = 4, TILE = 16;

    // Drawing of every tile on a 16x16 context; `rnd` is the shared stream.
    function painters(rnd) {
        const P = palette;
        function speckle(g, hex, lo, hi, x0 = 0, y0 = 0, w = 16, h = 16) {
            const c = rgbOf(hex);
            for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { g.fillStyle = shade(c, lo + (hi - lo) * rnd()); g.fillRect(x, y, 1, 1); }
        }
        function dots(g, hex, k, n) {
            const c = rgbOf(hex);
            for (let i = 0; i < n; i++) { g.fillStyle = shade(c, k); g.fillRect(rnd() * 16 | 0, rnd() * 16 | 0, 1, 1); }
        }
        const fill = (g, hex, x, y, w, h, k = 1) => { g.fillStyle = shade(rgbOf(hex), k); g.fillRect(x, y, w, h); };
        const cracks = [[0, 5, 7, 1], [6, 0, 1, 5], [9, 8, 7, 1], [11, 9, 1, 7], [3, 11, 1, 5], [0, 11, 3, 1], [12, 2, 4, 1]];
        // Planks: four boards with dark seams and a nail or two.
        function planks(g) {
            for (let b = 0; b < 4; b++) {
                speckle(g, P.plank, 0.86 + (b % 2) * 0.06, 1.04, 0, b * 4, 16, 4);
                fill(g, P.plankDark, 0, b * 4 + 3, 16, 1);
                fill(g, P.plankDark, (b * 7 + 3) % 16, b * 4, 1, 3, 0.9);
            }
        }
        return {
            grassTop: g => { speckle(g, P.grass, 0.82, 1.08); dots(g, P.grass, 0.68, 14); dots(g, P.grassLight, 1, 8); },
            dirt: g => { speckle(g, P.dirt, 0.78, 1.06); dots(g, P.dirt, 0.6, 12); dots(g, '#a0a0a0', 0.9, 5); },
            path: g => { speckle(g, P.path, 0.82, 1.08); dots(g, P.pebble, 1, 10); dots(g, P.path, 0.7, 10); },
            stone: g => {
                speckle(g, P.stone, 0.8, 1.06);
                g.fillStyle = shade(rgbOf(P.stoneDark), 1);
                for (const [x, y, w, h] of cracks) g.fillRect(x, y, w, h);
                dots(g, P.stoneLight, 1, 8);
            },
            mossy: g => {
                speckle(g, P.stone, 0.8, 1.06);
                g.fillStyle = shade(rgbOf(P.stoneDark), 1);
                for (const [x, y, w, h] of cracks.slice(0, 4)) g.fillRect(x, y, w, h);
                for (let i = 0; i < 4; i++) speckle(g, P.moss, 0.8, 1.1, rnd() * 12 | 0, rnd() * 12 | 0, 3 + (rnd() * 3 | 0), 2 + (rnd() * 3 | 0));
            },
            bark: g => {
                const c = rgbOf(P.bark);
                for (let x = 0; x < 16; x++) {
                    const col = 0.8 + 0.25 * ((x * 7) % 5) / 4;
                    for (let y = 0; y < 16; y++) { g.fillStyle = shade(c, col * (0.9 + rnd() * 0.15)); g.fillRect(x, y, 1, 1); }
                }
            },
            barkTop: g => {
                speckle(g, P.plank, 0.85, 1.05);
                for (const r of [6, 4, 2]) { g.strokeStyle = shade(rgbOf(P.plankDark), 1); g.strokeRect(8 - r + 0.5, 8 - r + 0.5, 2 * r - 1, 2 * r - 1); }
                fill(g, P.bark, 0, 0, 16, 1); fill(g, P.bark, 0, 15, 16, 1); fill(g, P.bark, 0, 0, 1, 16); fill(g, P.bark, 15, 0, 1, 16);
            },
            leaves: g => { speckle(g, P.leaves, 0.7, 1.12); dots(g, P.leavesDark, 1, 22); dots(g, P.leavesLight, 1, 10); },
            // Rounded stones set in mortar.
            cobble: g => {
                speckle(g, P.cobbleDark, 0.85, 1.05);
                for (const [x, y, w, h] of [[1, 1, 6, 4], [8, 1, 7, 5], [1, 6, 4, 5], [6, 7, 5, 4], [12, 7, 3, 5], [1, 12, 6, 3], [8, 12, 7, 3]]) speckle(g, P.cobble, 0.85, 1.12, x, y, w, h);
            },
            gravel: g => { speckle(g, P.gravel, 0.75, 1.12); dots(g, P.stoneLight, 1, 14); dots(g, P.stoneDark, 1, 14); },
            plank: planks,
            // Roof shingles in grey: each building's colour tints them.
            roof: g => {
                speckle(g, '#d8d8d8', 0.82, 1.02);
                for (let row = 0; row < 4; row++) {
                    fill(g, '#9a9a9a', 0, row * 4 + 3, 16, 1);
                    for (let i = 0; i < 4; i++) fill(g, '#a8a8a8', (i * 4 + (row % 2) * 2) % 16, row * 4, 1, 3);
                }
            },
            door: g => {
                planks(g);
                fill(g, P.door, 2, 0, 12, 16);
                for (const x of [5, 10]) fill(g, P.door, x, 0, 1, 16, 0.75);
                fill(g, P.gold, 11, 8, 2, 2);
            },
            window: g => {
                planks(g);
                fill(g, P.plankDark, 3, 3, 10, 10);
                fill(g, P.window, 4, 4, 8, 8);
                fill(g, P.plankDark, 7, 4, 2, 8); fill(g, P.plankDark, 4, 7, 8, 2);
                fill(g, '#5d7088', 5, 5, 2, 1);
            },
            portalStone: g => {
                speckle(g, P.portalStone, 0.82, 1.1);
                dots(g, P.portalStoneLight, 1, 12);
                fill(g, P.portalStoneLight, 0, 0, 16, 1, 0.9); fill(g, P.portalStoneLight, 0, 0, 1, 16, 0.9);
            },
            white: g => { speckle(g, '#ffffff', 0.9, 1.0); },
            // A dry thicket: tangled twigs over shadow.
            brush: g => {
                speckle(g, P.brushDark, 0.6, 0.9);
                for (let i = 0; i < 9; i++) {
                    const x = rnd() * 16 | 0, y = rnd() * 16 | 0, dx = rnd() < 0.5 ? 1 : -1, len = 4 + (rnd() * 6 | 0);
                    for (let k = 0; k < len; k++) fill(g, P.brush, (x + k * dx + 16) % 16, (y + (k >> 1)) % 16, 1, 1, 0.85 + rnd() * 0.3);
                }
                dots(g, '#c9a66b', 1, 6);
            },
            // Iron ore: stone with rusty lumps.
            ore: g => {
                speckle(g, P.stone, 0.72, 0.98);
                for (const [x, y, w, h] of [[2, 2, 3, 2], [9, 1, 3, 3], [5, 7, 4, 3], [12, 8, 2, 3], [1, 11, 3, 3], [8, 12, 4, 2]]) {
                    speckle(g, P.ore, 0.8, 1.1, x, y, w, h);
                    fill(g, P.oreLight, x, y, 1, 1);
                }
                dots(g, P.stoneDark, 1, 10);
            },
            // Dark rock with veins of crystal.
            crystalRock: g => {
                speckle(g, P.stoneDark, 0.6, 0.85);
                for (const [x, y, len, dx] of [[2, 13, 6, 1], [10, 14, 5, -1], [6, 6, 5, 1], [13, 3, 4, -1]]) for (let k = 0; k < len; k++) fill(g, P.crystal, x + k * dx, y - k, 1, 1, 0.75 + rnd() * 0.35);
                dots(g, P.crystalDeep, 1, 8);
            },
            // Fine grain on character boxes, tinted by the box colour.
            grain: g => { speckle(g, '#ffffff', 0.84, 1.0); dots(g, '#ffffff', 0.74, 10); }
        };
    }
    function finish(T, canvas, repeat) {
        const t = new T.CanvasTexture(canvas);
        t.magFilter = T.NearestFilter;
        // The atlas is never mipmapped: neighbouring tiles would bleed.
        t.minFilter = repeat ? T.NearestMipmapLinearFilter : T.NearestFilter;
        t.generateMipmaps = repeat;
        t.wrapS = t.wrapT = repeat ? T.RepeatWrapping : T.ClampToEdgeWrapping;
        t.colorSpace = T.SRGBColorSpace;
        return t;
    }
    function create(T, seed = 20261001) {
        const draw = painters(rng(seed));
        const single = name => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = TILE;
            draw[name](canvas.getContext('2d'));
            return finish(T, canvas, true);
        };
        // The atlas: every tile in TILES order, left to right, top to bottom.
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_COLS * TILE; canvas.height = ATLAS_ROWS * TILE;
        const g = canvas.getContext('2d', { willReadFrequently: true }), rects = {};
        TILES.forEach((name, i) => {
            const x = (i % ATLAS_COLS) * TILE, y = Math.floor(i / ATLAS_COLS) * TILE;
            g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, TILE, TILE); g.clip();
            draw[name](g);
            g.restore();
            // UV rectangle [u0, v0 (bottom), u1, v1 (top)], pulled in a hair
            // so nearest sampling never picks the neighbouring tile.
            const e = 0.02;
            rects[name] = [(x + e) / canvas.width, 1 - (y + TILE - e) / canvas.height, (x + TILE - e) / canvas.width, 1 - (y + e) / canvas.height];
        });
        // Each tile's mean colour, linear [r, g, b] (the light the terrain
        // gives back: render/terrain_light.js).
        const means = {}, colour = new T.Color(), px = g.getImageData(0, 0, canvas.width, canvas.height).data;
        TILES.forEach((name, i) => {
            const x0 = (i % ATLAS_COLS) * TILE, y0 = Math.floor(i / ATLAS_COLS) * TILE, sum = [0, 0, 0];
            for (let y = y0; y < y0 + TILE; y++) for (let x = x0; x < x0 + TILE; x++) for (let ch = 0; ch < 3; ch++) sum[ch] += px[(y * canvas.width + x) * 4 + ch];
            means[name] = colour.setRGB(...sum.map(v => v / (255 * TILE * TILE)), T.SRGBColorSpace).toArray();
        });
        // `ground(name)`: one tile as a texture of its own that repeats (the
        // sheet of ground round the map).
        return { grassTop: single('grassTop'), grain: single('grain'), atlas: finish(T, canvas, false), tiles: rects, means, ground: single };
    }
    return { rng, create, TILES };
})();
