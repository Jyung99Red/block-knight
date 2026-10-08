// The map preview's page (map.html, a tool page; the game is index.html):
// one of the game's maps from above, its columns and rows numbered, to be
// pointed at in words: `field (23, 5)`, `field (20,10)-(30,15)`. Nothing is
// edited here. Pick a map (or open ?map=field); the pointer names the cell
// under it; a click picks a cell and a drag a rectangle, put in the text
// box and on the clipboard; the measure tool gives the walk between two
// cells. The overview shows every map on one sheet, set out by where its
// portals lead; a click on one opens it. mapview/plan.js works everything
// out; this file draws it on 2D
// canvases (the map, a layer over it for what follows the pointer, and the
// two rulers) and listens.
const mapApp = (() => {
    const STORE = 'blockKnight.map.prefs';
    const storage = () => { try { return window.localStorage; } catch (_) { return null; } };
    const readJSON = key => { try { return JSON.parse(storage()?.getItem(key) || 'null'); } catch (_) { return null; } };
    const writeJSON = (key, value) => { try { storage()?.setItem(key, JSON.stringify(value)); } catch (_) { /* nowhere to keep it */ } };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const fixed = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n);
    const escape = text => String(text).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    const same = (a, b) => !!a && !!b && a.col === b.col && a.row === b.row;

    // ---- how things look: the page's own data, not the game's ----
    // Ground and blocks by terrainKit.KIND name. A kind not listed (one
    // added later) is drawn in UNKNOWN.
    const COLOURS = Object.freeze({
        grass: '#5f9b4c', path: '#b99c68', cobble: '#9ba1a8', gravel: '#8d8779', herb: '#eef08a',
        tree: '#1f5c2c', wood: '#8a5a30', portal: '#4c3a78', gate: '#b477ff', brush: '#9a6a22',
        ore: '#c8763a', crystal: '#63d2e6', water: '#3f86d6', hedge: '#2f8a45', drop: '#d7e6f2', fence: '#a8743c'
    });
    const UNKNOWN = '#d24bc0', TREE_CROWN = '#3a8a48';
    // Stone by its height in blocks: a low stone light, a wall darker the higher.
    const STONE = Object.freeze(['#b9bec6', '#b9bec6', '#7a8089', '#5c626b', '#454a52']);
    const MARK = Object.freeze({
        building: '#ffd27a', door: '#fff3c4', chest: '#f2b544', spawn: '#4fe3ff', dummy: '#c58b4a', portal: '#ecd9ff', lamp: '#ff9a2e',
        select: '#f2b544', walk: '#ff6fb7', ink: '#20252b', plate: 'rgba(16, 20, 24, 0.82)'
    });
    // Monsters by the model they are built on; bosses apart.
    const MONSTER = Object.freeze({ goblin: '#ffb02e', wolf: '#8fd6ff', spider: '#d59cff', boss: '#ff4d4d', other: '#ffffff' });
    const RULER = Object.freeze({ top: 22, left: 34, bg: '#181d23', tick: '#56626e', text: '#cfd8de' });
    // Pixels to a cell: the slider's ends, and the range a first visit starts in.
    const CELL = Object.freeze({ min: 6, max: 48, first: [14, 30], fallback: 20 });
    // Most pixels a canvas is given (a phone refuses much more).
    const MAX_PIXELS = 12e6;
    const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif', MONO = 'ui-monospace, Consolas, monospace';
    const TOOLS = Object.freeze({
        select: '点一格出坐标，按住拖出一块区域；坐标进上面的框，并自动复制。手机上要挪地图，先切到"拖动地图"。',
        measure: '点起点，再点终点（或按住拖过去）：直线几格、走路几格、要走几秒。',
        pan: '按住拖动来移动地图（手机上用手指划）；轻点一格照样选中。'
    });
    const SHOWN = Object.freeze({ monsters: true, portals: true, marks: true, screen: false, grid: true });
    // The overview: its entry in the list of maps, pixels to a block (it
    // always fits the window), its words and the colour of its links.
    const WORLD = Object.freeze({ id: 'world', name: '总览（所有地图）', min: 2, max: 14, hint: '指到一块区域上，显示那张地图里的坐标；点一下打开那张地图', link: '#f3e8ff' });
    const SIDES = Object.freeze({ north: '北', south: '南', east: '东', west: '西' });

    const colourOf = cell => cell.kind === 'stone' ? STONE[Math.min(cell.level, STONE.length - 1)] : COLOURS[cell.kind] || UNKNOWN;
    // One cell, `s` pixels a side, at (x, y). Ground is flat colour. A block
    // that hides fills its cell, dark, inside a frame; a low one (it stops
    // walking and blows, not sight) is a small block on the map's floor.
    // A stone shows how many blocks high it stands.
    function drawCell(ctx, x, y, s, cell, floor) {
        const colour = colourOf(cell);
        if (cell.kind === 'herb') {
            ctx.fillStyle = floor; ctx.fillRect(x, y, s, s);
            ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.22, 0, Math.PI * 2); ctx.fill();
        } else if (!cell.solid || !cell.level) {
            ctx.fillStyle = colour; ctx.fillRect(x, y, s, s);
        } else if (cell.hides) {
            ctx.fillStyle = colour; ctx.fillRect(x, y, s, s);
            if (cell.kind === 'tree') { ctx.fillStyle = TREE_CROWN; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.34, 0, Math.PI * 2); ctx.fill(); }
            const edge = Math.max(1, s / 10);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'; ctx.lineWidth = edge; ctx.strokeRect(x + edge / 2, y + edge / 2, s - edge, s - edge);
        } else {
            const inset = s * 0.17;
            ctx.fillStyle = floor; ctx.fillRect(x, y, s, s);
            ctx.fillStyle = colour; ctx.fillRect(x + inset, y + inset, s - 2 * inset, s - 2 * inset);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x + inset + 0.5, y + inset + 0.5, s - 2 * inset - 1, s - 2 * inset - 1);
        }
        if (cell.kind === 'stone' && s >= 10) {
            ctx.font = `bold ${Math.round(s * (cell.hides ? 0.62 : 0.5))}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = cell.hides ? 'rgba(255, 255, 255, 0.92)' : MARK.ink;
            ctx.fillText(String(cell.level), x + s / 2, y + s / 2 + 0.5);
        }
    }

    function start() {
        const root = document.getElementById('map'), $ = sel => root.querySelector(sel), $$ = sel => [...root.querySelectorAll(sel)];
        const lab = mapPlan, list = lab.maps();
        const stage = $('[data-stage]'), sheet = $('[data-sheet]'), board = $('[data-board]'), base = $('[data-canvas]'), over = $('[data-over]');
        const rulers = { top: $('[data-ruler="top"]'), left: $('[data-ruler="left"]') };
        const readout = $('[data-readout]'), refBox = $('[data-ref]'), copied = $('[data-copied]'), errorBox = $('[data-error]');
        const picker = $('[data-map]'), zoom = $('[data-zoom]'), info = $('[data-info]'), legend = $('[data-legend]');
        const worldBox = $('[data-world]'), worldCanvas = $('[data-world-canvas]');

        // ---- state: what is shown, kept between visits ----
        // hover: the cell under the pointer; point: the last one pointed at
        // (the one-screen patch stays round it); select: { a, b } corners;
        // measure: { a, b, fixed, result }, `b` following the pointer until fixed.
        const saved = readJSON(STORE) || {}, known = id => id === WORLD.id || list.some(m => m.id === id);
        const asked = new URLSearchParams(location.search).get('map');
        const state = {
            map: known(asked) ? asked : known(saved.map) ? saved.map : list[0].id,
            cell: Number.isFinite(saved.cell) ? clamp(Math.round(saved.cell), CELL.min, CELL.max) : null,
            tool: Object.hasOwn(TOOLS, saved.tool) ? saved.tool : 'select',
            show: Object.fromEntries(Object.entries(SHOWN).map(([k, on]) => [k, typeof saved.show?.[k] === 'boolean' ? saved.show[k] : on])),
            hover: null, point: null, select: null, measure: null
        };
        const savePrefs = () => writeJSON(STORE, { map: state.map, cell: state.cell, tool: state.tool, show: state.show });
        // plan: the map on the sheet; world: the overview instead (worldCell
        // pixels to a block, worldOver the map the pointer is over).
        let plan = null, ratio = 1, drag = null, world = null, worldCell = WORLD.min, worldOver = null;

        // ---- drawing ----
        // A canvas of w x h CSS pixels, each drawn `ratio` device pixels wide, wiped.
        function prepare(canvas, w, h) {
            const pw = Math.max(1, Math.round(w * ratio)), ph = Math.max(1, Math.round(h * ratio));
            if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
            canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
            return ctx;
        }
        const disc = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
        function drawGrid(ctx, s) {
            // A line a cell, a darker one every five: the cell to its right or under it is the numbered one.
            for (const [every, style] of [[1, 'rgba(0, 0, 0, 0.16)'], [5, 'rgba(0, 0, 0, 0.5)']]) {
                ctx.beginPath();
                for (let c = 0; c <= plan.width; c += every) { ctx.moveTo(c * s + 0.5, 0); ctx.lineTo(c * s + 0.5, plan.height * s); }
                for (let r = 0; r <= plan.height; r += every) { ctx.moveTo(0, r * s + 0.5); ctx.lineTo(plan.width * s, r * s + 0.5); }
                ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.stroke();
            }
        }
        function drawMarks(ctx, s, tag) {
            for (const b of plan.buildings) {
                if (![b.col, b.row, b.w, b.d].every(Number.isFinite)) continue;
                ctx.strokeStyle = MARK.building; ctx.lineWidth = 2;
                ctx.strokeRect(b.col * s + 1, b.row * s + 1, b.w * s - 2, b.d * s - 2);
                if (b.door && b.front) {
                    // The door: a bright bar on the edge between its block and the ground in front.
                    const x = (b.door[0] + b.front[0]) / 2 + 0.5, y = (b.door[1] + b.front[1]) / 2 + 0.5;
                    const dx = b.door[1] !== b.front[1] ? 0.4 : 0, dy = dx ? 0 : 0.4;
                    ctx.strokeStyle = MARK.door; ctx.lineWidth = Math.max(3, s / 5);
                    ctx.beginPath(); ctx.moveTo((x - dx) * s, (y - dy) * s); ctx.lineTo((x + dx) * s, (y + dy) * s); ctx.stroke();
                }
                tag(b.name, (b.col + b.w / 2) * s, (b.row + b.d / 2) * s, 'centre');
            }
            for (const k of plan.chests) {
                const x = (k.col + 0.5) * s, y = (k.row + 0.5) * s, w = s * 0.62, h = s * 0.46;
                ctx.fillStyle = MARK.chest; ctx.fillRect(x - w / 2, y - h / 2, w, h);
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2, y - h / 2, w, h);
                tag('宝箱', x, y, 'above', s / 2);
            }
            // A torch: a flame-coloured dot, a wall's against the wall it hangs on.
            for (const l of plan.lamps) {
                const [dx, dy] = l.side ? propKit.DIRS[l.side] : [0, 0], x = (l.col + 0.5 + dx * 0.3) * s, y = (l.row + 0.5 + dy * 0.3) * s;
                ctx.fillStyle = MARK.lamp; disc(ctx, x, y, s * 0.2); ctx.fill();
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1.5; ctx.stroke();
            }
            for (const p of plan.spawns) {
                const x = (p.col + 0.5) * s, y = (p.row + 0.5) * s;
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 4; disc(ctx, x, y, s * 0.34); ctx.stroke();
                ctx.strokeStyle = MARK.spawn; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = MARK.spawn; disc(ctx, x, y, Math.max(1.5, s * 0.1)); ctx.fill();
                tag(plan.spawns.length > 1 ? `出生点 ${p.index + 1}` : '出生点', x, y, 'above', s / 2);
            }
            if (plan.dummy) {
                const x = (plan.dummy.col + 0.5) * s, y = (plan.dummy.row + 0.5) * s;
                ctx.fillStyle = MARK.dummy; disc(ctx, x, y, s * 0.34); ctx.fill();
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1.5; ctx.stroke();
                tag('木桩', x, y, 'above', s / 2);
            }
        }
        function drawPortals(ctx, s, tag) {
            for (const p of plan.portals) {
                const x = (p.col + 0.5) * s, y = (p.row + 0.5) * s;
                if (p.arrival) {
                    // Where someone coming through stands: a ring, tied to its gate.
                    const ax = p.arrival.x * s, ay = p.arrival.y * s;
                    ctx.strokeStyle = MARK.portal; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ax, ay); ctx.stroke();
                    ctx.setLineDash([]); ctx.lineWidth = 2; disc(ctx, ax, ay, Math.max(3, s * 0.28)); ctx.stroke();
                }
                // The name goes on the side away from where it leads into the map.
                tag(p.to ? `→ ${p.toName}${p.requires ? '（锁）' : ''}` : '→ ？', x, y, p.facing === 'north' ? 'below' : 'above', s / 2);
            }
        }
        function drawMonsters(ctx, s, tag) {
            const colour = m => m.boss ? MONSTER.boss : MONSTER[gameConfig.monsters[m.kind]?.model || m.kind] || MONSTER.other;
            // Circles first, so no home is hidden under a neighbour's.
            for (const m of plan.monsters) {
                const x = m.x * s, y = m.y * s;
                ctx.strokeStyle = ctx.fillStyle = colour(m);
                ctx.globalAlpha = 0.6; ctx.lineWidth = 1.25; ctx.setLineDash([6, 5]); disc(ctx, x, y, m.leash * s); ctx.stroke();
                ctx.setLineDash([]); disc(ctx, x, y, m.alert * s);
                ctx.globalAlpha = 0.1; ctx.fill();
                ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.stroke();
            }
            for (const m of plan.monsters) {
                const x = m.x * s, y = m.y * s, r = Math.max(4, s * 0.4);
                ctx.fillStyle = m.boss ? MONSTER.boss : '#fbfaf3'; disc(ctx, x, y, r); ctx.fill();
                ctx.strokeStyle = m.boss ? '#ffffff' : MARK.ink; ctx.lineWidth = 1.5; ctx.stroke();
                if (s >= 10 && m.letter) {
                    ctx.font = `bold ${Math.round(r * 1.35)}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = m.boss ? '#ffffff' : MARK.ink; ctx.fillText(m.letter, x, y + 0.5);
                }
                if (m.boss) tag(m.name, x, y, 'above', r);
            }
        }
        // Names on plates, over everything else: above or below their mark
        // (`gap` from its centre), or centred on it; kept inside the map.
        function drawTags(ctx, tags, W, H) {
            ctx.font = `11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (const t of tags) {
                const w = ctx.measureText(t.text).width + 8, h = 15, off = t.gap + h / 2 + 2;
                let y = t.side === 'centre' ? t.y : t.side === 'below' ? t.y + off : t.y - off;
                if (y < h / 2) y = t.y + off; else if (y > H - h / 2) y = t.y - off;
                const x = clamp(t.x, w / 2, Math.max(w / 2, W - w / 2));
                ctx.fillStyle = MARK.plate; ctx.fillRect(x - w / 2, y - h / 2, w, h);
                ctx.fillStyle = '#ffffff'; ctx.fillText(t.text, x, y + 0.5);
            }
        }
        function drawBase() {
            const s = state.cell, W = plan.width * s, H = plan.height * s;
            ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (W * H)));
            const ctx = prepare(base, W, H), floor = COLOURS[plan.floor] || UNKNOWN, tags = [];
            const tag = (text, x, y, side = 'above', gap = 0) => tags.push({ text, x, y, side, gap });
            plan.cells.forEach((cell, i) => drawCell(ctx, (i % plan.width) * s, Math.floor(i / plan.width) * s, s, cell, floor));
            if (state.show.grid) drawGrid(ctx, s);
            if (state.show.marks) drawMarks(ctx, s, tag);
            if (state.show.portals) drawPortals(ctx, s, tag);
            if (state.show.monsters) drawMonsters(ctx, s, tag);
            drawTags(ctx, tags, W, H);
        }
        // The corners of a selection, north-west first.
        const boxOf = sel => ({ c0: Math.min(sel.a.col, sel.b.col), c1: Math.max(sel.a.col, sel.b.col), r0: Math.min(sel.a.row, sel.b.row), r1: Math.max(sel.a.row, sel.b.row) });
        // The rulers: a tick a cell, a number every five (over the cell it
        // counts), the selection as a band and the pointer's own number.
        function drawRulers() {
            const s = state.cell, W = plan.width * s, H = plan.height * s, box = state.select && boxOf(state.select), at = state.hover;
            const paint = (canvas, w, h, count, across) => {
                const ctx = prepare(canvas, w, h), long = across ? h : w;
                ctx.fillStyle = RULER.bg; ctx.fillRect(0, 0, w, h);
                const band = (from, to, style) => { ctx.fillStyle = style; if (across) ctx.fillRect(from, 0, to - from, h); else ctx.fillRect(0, from, w, to - from); };
                if (box) band((across ? box.c0 : box.r0) * s, ((across ? box.c1 : box.r1) + 1) * s, 'rgba(242, 181, 68, 0.3)');
                ctx.beginPath();
                for (let i = 0; i <= count; i++) {
                    const p = i * s + 0.5, from = long - (i % 5 ? 4 : 9);
                    if (across) { ctx.moveTo(p, from); ctx.lineTo(p, long); } else { ctx.moveTo(from, p); ctx.lineTo(long, p); }
                }
                ctx.strokeStyle = RULER.tick; ctx.lineWidth = 1; ctx.stroke();
                ctx.font = `10px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = across ? 'center' : 'right';
                const number = (i, style) => { ctx.fillStyle = style; if (across) ctx.fillText(String(i), (i + 0.5) * s, 8); else ctx.fillText(String(i), w - 11, (i + 0.5) * s + 0.5); };
                for (let i = 0; i < count; i += 5) number(i, RULER.text);
                if (at) {
                    const i = across ? at.col : at.row, room = across ? Math.max(s, ctx.measureText(String(i)).width + 6) : Math.max(s, 13), mid = (i + 0.5) * s;
                    band(mid - room / 2, mid + room / 2, MARK.select);
                    number(i, MARK.ink);
                }
            };
            paint(rulers.top, W, RULER.top, plan.width, true);
            paint(rulers.left, RULER.left, H, plan.height, false);
        }
        // What follows the pointer, over the map: the one-screen patch, the
        // selection, the measured walk, the cell pointed at.
        function drawOver() {
            const s = state.cell, ctx = prepare(over, plan.width * s, plan.height * s);
            if (state.show.screen && state.point) {
                const { corners } = lab.screen(state.point.col + 0.5, state.point.row + 0.5);
                ctx.beginPath();
                corners.forEach(([x, y], i) => { if (i) ctx.lineTo(x * s, y * s); else ctx.moveTo(x * s, y * s); });
                ctx.closePath();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; ctx.fill();
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)'; ctx.lineWidth = 3.5; ctx.stroke();
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
            }
            if (state.select) {
                const b = boxOf(state.select), x = b.c0 * s, y = b.r0 * s, w = (b.c1 - b.c0 + 1) * s, h = (b.r1 - b.r0 + 1) * s;
                ctx.fillStyle = 'rgba(242, 181, 68, 0.28)'; ctx.fillRect(x, y, w, h);
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
                ctx.strokeStyle = MARK.select; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
            }
            const m = state.measure;
            if (m) {
                const centre = p => [(p.col + 0.5) * s, (p.row + 0.5) * s], ends = [[m.a, '起']];
                if (m.b) {
                    ends.push([m.b, '终']);
                    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                    ctx.beginPath(); ctx.moveTo(...centre(m.a)); ctx.lineTo(...centre(m.b)); ctx.stroke(); ctx.setLineDash([]);
                    if (m.result?.path) {
                        ctx.beginPath();
                        m.result.path.forEach((p, i) => { if (i) ctx.lineTo(...centre(p)); else ctx.moveTo(...centre(p)); });
                        ctx.lineJoin = 'round'; ctx.strokeStyle = MARK.ink; ctx.lineWidth = 5; ctx.stroke();
                        ctx.strokeStyle = MARK.walk; ctx.lineWidth = 2.5; ctx.stroke();
                    }
                }
                for (const [p, text] of ends) {
                    const [x, y] = centre(p), r = Math.max(8, s * 0.42);
                    ctx.fillStyle = MARK.walk; disc(ctx, x, y, r); ctx.fill();
                    ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1.5; ctx.stroke();
                    ctx.font = `bold ${Math.round(r * 1.2)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillStyle = MARK.ink; ctx.fillText(text, x, y + 0.5);
                }
            }
            if (state.hover) {
                const x = state.hover.col * s, y = state.hover.row * s;
                ctx.strokeStyle = MARK.ink; ctx.lineWidth = 3; ctx.strokeRect(x + 0.5, y + 0.5, s, s);
                ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, s, s);
            }
        }
        // The overview: every map small, a frame and a name each, monsters as
        // dots, and a line for each pair of portals (dashed while a boss
        // keeps it shut, pink where its two ends disagree). As big as fits
        // the window.
        function drawWorld() {
            const s = worldCell = clamp(Math.floor(Math.min((stage.clientWidth - 18) / world.width, (stage.clientHeight - 18) / world.height)), WORLD.min, WORLD.max);
            const W = world.width * s, H = world.height * s, tags = [];
            ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (W * H)));
            const ctx = prepare(worldCanvas, W, H);
            for (const m of world.maps) {
                const p = lab.planOf(m.id), x0 = m.x * s, y0 = m.y * s, floor = COLOURS[p.floor] || UNKNOWN;
                p.cells.forEach((cell, i) => { ctx.fillStyle = cell.kind === 'herb' ? floor : colourOf(cell); ctx.fillRect(x0 + (i % p.width) * s, y0 + Math.floor(i / p.width) * s, s, s); });
                if (state.show.monsters) for (const mo of p.monsters) {
                    ctx.fillStyle = mo.boss ? MONSTER.boss : MONSTER[gameConfig.monsters[mo.kind]?.model || mo.kind] || MONSTER.other;
                    disc(ctx, x0 + mo.x * s, y0 + mo.y * s, mo.boss ? Math.max(3.5, s * 0.9) : Math.max(2, s * 0.55)); ctx.fill();
                    ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1; ctx.stroke();
                }
                const on = m.id === worldOver;
                ctx.strokeStyle = on ? MARK.select : 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = on ? 3 : 1.5;
                ctx.strokeRect(x0 + 0.5, y0 + 0.5, p.width * s - 1, p.height * s - 1);
                tags.push({ text: `${m.name} ${m.id}`, x: x0 + p.width * s / 2, y: y0 + p.height * s / 2, side: 'centre', gap: 0 });
            }
            if (state.show.portals) for (const link of world.links) {
                const ends = [link.a, link.b].filter(Boolean);
                if (ends.length === 2) {
                    ctx.setLineDash(link.requires ? [7, 5] : []); ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(link.a.x * s, link.a.y * s); ctx.lineTo(link.b.x * s, link.b.y * s);
                    ctx.strokeStyle = MARK.ink; ctx.lineWidth = 4.5; ctx.stroke();
                    ctx.strokeStyle = link.straight ? WORLD.link : MARK.walk; ctx.lineWidth = 2; ctx.stroke();
                    ctx.setLineDash([]);
                }
                for (const e of ends) {
                    ctx.fillStyle = COLOURS.gate; disc(ctx, e.x * s, e.y * s, Math.max(3, s * 0.8)); ctx.fill();
                    ctx.strokeStyle = MARK.ink; ctx.lineWidth = 1.5; ctx.stroke();
                }
            }
            drawTags(ctx, tags, W, H);
        }
        function redraw() { if (plan) { drawBase(); drawRulers(); drawOver(); } else if (world) drawWorld(); }
        function follow() { if (plan) { drawRulers(); drawOver(); } }

        // ---- the words beside the map ----
        function showReadout() { readout.textContent = plan && state.hover ? lab.describe(plan, state.hover.col, state.hover.row) : world ? WORLD.hint : '指到地图上，这里显示坐标和那一格是什么'; }
        function showMeasure() {
            const m = state.measure, box = $('[data-measure]');
            if (!plan || !m) { box.textContent = '还没量。'; return; }
            const from = lab.refOf(plan.id, m.a);
            if (!m.b) { box.textContent = `起点 ${from}，再点终点。`; return; }
            const r = m.result, lines = [`${from} → ${lab.refOf(plan.id, m.b)}`, `直线 ${fixed(r.straight)} 格`];
            lines.push(r.steps == null ? '走不到（被挡住了，或者起点、终点站不了人）' : `走路 ${fixed(r.steps)} 格：走 ${fixed(r.walkSeconds)} 秒，跑 ${fixed(r.runSeconds)} 秒`);
            box.innerHTML = lines.map(escape).join('<br>');
        }
        const go = (col, row) => `<button type="button" data-go="${col},${row}">(${col}, ${row})</button>`;
        // The overview in words: the maps, and each pair of portals -- said
        // out loud where the way there and the way back disagree about
        // which side the other map lies on.
        function showWorldInfo() {
            const name = id => world.maps.find(m => m.id === id)?.name || id;
            const open = m => `<a href="?map=${encodeURIComponent(m.id)}" data-to="${escape(m.id)}">${escape(m.name)} ${escape(m.id)}</a>`;
            const traits = m => [m.safe && '安全区', m.training && '训练场', m.duel && '对战专用', m.dark && '黑暗'].filter(Boolean).map(t => ` · ${t}`).join('');
            const said = link => {
                const { a, b } = link, lock = link.requires ? `（击败${escape(link.requiresName)}后开启）` : '';
                if (!b) return `${escape(name(a.id))} (${a.col}, ${a.row}) 往${SIDES[a.out] || '？'}出去${lock}：<span class="bad">那边没有门通回来</span>`;
                const line = `${escape(name(a.id))} (${a.col}, ${a.row}) ⇄ ${escape(name(b.id))} (${b.col}, ${b.row})${lock}`;
                return link.straight ? line : `${line}<br><span class="bad">方向对不上</span>：从${escape(name(a.id))}是往${SIDES[a.out]}出去，从${escape(name(b.id))}回来却是往${SIDES[b.out]}出去（粉色的线）`;
            };
            info.innerHTML = [
                `<p><b>总览</b> · ${world.maps.length} 张地图。门从哪边出去，那张图就摆在哪边；摆不下就顺着那个方向往外挪。点一块区域（或下面的名字）打开它。</p>`,
                `<h3>地图</h3><ul>${world.maps.map(m => `<li>${open(m)} · ${m.width} × ${m.height} 格${traits(m)}</li>`).join('')}</ul>`,
                world.links.length ? `<h3>传送门连接</h3><ul>${world.links.map(l => `<li>${said(l)}</li>`).join('')}</ul>` : ''
            ].join('');
        }
        function showInfo() {
            if (world) { showWorldInfo(); return; }
            if (!plan) { info.innerHTML = ''; return; }
            const html = [`<p><b>${escape(plan.name)}</b> <code>${escape(plan.id)}</code> · ${plan.width} × ${plan.height} 格（列 0–${plan.width - 1}，行 0–${plan.height - 1}）</p>`];
            const traits = [plan.safe && '安全区（没有怪）', plan.training && '训练场（不会倒下）', plan.duel && '对战专用', plan.dark && '黑暗（要火把照明）'].filter(Boolean);
            if (traits.length) html.push(`<p>${traits.join(' · ')}</p>`);
            for (const text of plan.problems) html.push(`<p class="bad">游戏读这张地图会报错：${escape(text)}</p>`);
            const section = (title, items) => { if (items.length) html.push(`<h3>${title}</h3><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`); };
            const kinds = new Map();
            for (const m of plan.monsters) kinds.set(m.kind, [...(kinds.get(m.kind) || []), m]);
            section('怪物', [...kinds.values()].map(ms => `${escape(ms[0].name)}${ms[0].boss ? '（首领）' : ''} <code>${escape(ms[0].letter)}</code> × ${ms.length}：警戒 ${fixed(ms[0].alert, 2)} 格，追击 ${fixed(ms[0].leash, 2)} 格 ${ms.map(m => go(m.col, m.row)).join(' ')}`));
            section('传送门', plan.portals.map(p => !p.to ? `${go(p.col, p.row)} 没有登记去向` : [
                `${go(p.col, p.row)} → <a href="?map=${encodeURIComponent(p.to)}" data-to="${escape(p.to)}">${escape(p.toName)} ${escape(p.to)}</a>${p.requires ? `（击败${escape(p.requiresName)}后开启）` : ''}`,
                p.lands ? `到那边站在 ${escape(lab.refOf(p.to, p.lands))}` : '', p.arrival ? `从那边过来站在 ${go(p.arrival.col, p.arrival.row)}` : ''
            ].filter(Boolean).join('；')));
            section('宝箱', plan.chests.map(k => `${go(k.col, k.row)}${k.loot ? ` 掉落表 <code>${escape(k.loot)}</code>` : ' 没有登记'}${k.requires ? `（${escape(k.requiresName)}守着）` : ''}`));
            section('建筑', plan.buildings.map(b => `${escape(b.name)} <code>${escape(b.kind)}</code> ${escape(lab.refOf(plan.id, [b.col, b.row], [b.col + b.w - 1, b.row + b.d - 1]).replace(`${plan.id} `, ''))}${b.front ? `，门口 ${go(b.front[0], b.front[1])}` : ''}`));
            section('火把', [['墙上的火把 <code>!</code>', 'wall'], ['立着的火炬 <code>i</code>', 'stand']].map(([name, kind]) => [name, plan.lamps.filter(l => l.kind === kind)]).filter(([, ls]) => ls.length).map(([name, ls]) => `${name} × ${ls.length}：${ls.map(l => go(l.col, l.row)).join(' ')}`));
            section('出生点和木桩', [...plan.spawns.map(p => `${plan.spawns.length > 1 ? `出生点 ${p.index + 1}` : '出生点'} ${go(p.col, p.row)}`), ...(plan.dummy ? [`${escape(plan.dummy.name)} ${go(plan.dummy.col, plan.dummy.row)}`] : [])]);
            info.innerHTML = html.join('');
        }
        // What this map holds, one entry a look: a kind, and for a block
        // whether it hides; each with the letters the rows write it by.
        function showLegend() {
            legend.textContent = '';
            if (!plan) return;
            const marked = new Set([...plan.monsters, ...plan.spawns, ...plan.chests, ...plan.lamps, ...(plan.dummy ? [plan.dummy] : [])].map(m => m.row * plan.width + m.col));
            const looks = new Map(), order = Object.keys(terrainKit.KIND), floor = COLOURS[plan.floor] || UNKNOWN;
            plan.cells.forEach((cell, i) => {
                const key = `${cell.kind}/${cell.solid}/${cell.hides}`;
                if (!looks.has(key)) looks.set(key, { cell, letters: new Set() });
                if (!marked.has(i)) looks.get(key).letters.add(cell.letter);
            });
            for (const { cell, letters } of [...looks.values()].sort((a, b) => order.indexOf(a.cell.kind) - order.indexOf(b.cell.kind) || a.cell.level - b.cell.level)) {
                const item = document.createElement('span'), swatch = document.createElement('canvas'), code = document.createElement('code');
                swatch.width = swatch.height = 36; swatch.style.width = swatch.style.height = '18px';
                const ctx = swatch.getContext('2d');
                ctx.scale(2, 2); drawCell(ctx, 0, 0, 18, cell, floor);
                code.textContent = [...letters].sort().join(' ');
                item.append(swatch, lab.kindName(cell.kind) + (cell.kind === 'stone' ? (cell.hides ? ' 高2以上' : ' 高1') : ''), code);
                legend.append(item);
            }
        }

        // ---- picking a cell, a rectangle ----
        // To the clipboard when the browser allows it; else the text box is
        // selected, to be copied by hand. Never throws.
        let noteTimer = 0;
        function note(text) {
            copied.textContent = text;
            clearTimeout(noteTimer); noteTimer = setTimeout(() => { copied.textContent = ''; }, 3000);
        }
        async function copy(text, extra = '') {
            let done = false;
            try { await navigator.clipboard.writeText(text); done = true; } catch (_) {
                try { refBox.focus({ preventScroll: true }); refBox.select(); done = !!document.execCommand?.('copy'); } catch (__) { done = false; }
            }
            note(done ? `已复制${extra}` : `没能自动复制，请在框里手动复制${extra}`);
        }
        // The selection is settled: its words go in the box (and are copied).
        function chosen(copyIt = true) {
            const b = boxOf(state.select), ref = lab.refOf(plan.id, state.select.a, state.select.b);
            refBox.value = ref;
            if (copyIt) copy(ref, b.c0 === b.c1 && b.r0 === b.r1 ? '' : ` · ${b.c1 - b.c0 + 1} × ${b.r1 - b.r0 + 1} 格`);
        }
        function select(a, b = a, copyIt = false) { state.select = { a: { ...a }, b: { ...b } }; chosen(copyIt); follow(); }
        function setMeasure(a, b, done) {
            const end = b && !same(a, b) ? b : null;
            state.measure = { a, b: end, fixed: !!(done && end), result: end ? lab.measure(plan, a, end) : null };
            showMeasure();
        }
        // Scroll a cell to the middle of the view and pick it.
        function show(col, row) {
            const s = state.cell;
            stage.scrollTo({ left: (col + 0.5) * s + RULER.left - stage.clientWidth / 2, top: (row + 0.5) * s + RULER.top - stage.clientHeight / 2 });
            state.point = { col, row };
            select({ col, row });
        }

        // ---- the pointer: mouse and fingers alike ----
        const cellUnder = e => {
            const r = base.getBoundingClientRect();
            return { col: clamp(Math.floor((e.clientX - r.left) / state.cell), 0, plan.width - 1), row: clamp(Math.floor((e.clientY - r.top) / state.cell), 0, plan.height - 1) };
        };
        function point(cell) {
            if (same(cell, state.hover)) return false;
            state.hover = cell; state.point = cell;
            showReadout();
            return true;
        }
        // The board keeps a pointer that is dragged off it.
        const capture = id => { try { board.setPointerCapture(id); } catch (_) { /* the pointer is already gone */ } };
        board.addEventListener('pointerdown', e => {
            if (!plan || (e.pointerType === 'mouse' && e.button !== 0)) return;
            const cell = cellUnder(e);
            point(cell);
            if (state.tool === 'pan') {
                // A mouse drags the map along; a finger scrolls it as it would
                // any page (the browser then cancels the pointer). A press
                // that goes nowhere picks its cell.
                const mouse = e.pointerType === 'mouse';
                drag = { kind: 'pan', id: e.pointerId, cell, mouse, x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
                if (mouse) { e.preventDefault(); capture(e.pointerId); }
                follow();
                return;
            }
            e.preventDefault();
            capture(e.pointerId);
            if (state.tool === 'measure') {
                // The second press ends a measure begun; else one begins here.
                if (state.measure && !state.measure.fixed) { setMeasure(state.measure.a, cell, true); drag = null; }
                else { setMeasure(cell, null, false); drag = { kind: 'measure', id: e.pointerId }; }
            } else {
                state.select = { a: cell, b: cell };
                drag = { kind: 'select', id: e.pointerId };
            }
            follow();
        });
        board.addEventListener('pointermove', e => {
            if (!plan) return;
            if (drag?.kind === 'pan') {
                if (e.pointerId !== drag.id) return;
                if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
                if (drag.mouse && drag.moved) { stage.scrollLeft = drag.left - (e.clientX - drag.x); stage.scrollTop = drag.top - (e.clientY - drag.y); }
                return;
            }
            if (drag && e.pointerId !== drag.id) return;
            const cell = cellUnder(e);
            if (!point(cell)) return;
            if (drag?.kind === 'select') state.select.b = cell;
            if (state.measure && !state.measure.fixed && (state.tool === 'measure' || drag?.kind === 'measure')) setMeasure(state.measure.a, cell, false);
            follow();
        });
        board.addEventListener('pointerup', e => {
            if (!plan || !drag || e.pointerId !== drag.id) return;
            const was = drag, cell = cellUnder(e);
            drag = null;
            if (was.kind === 'pan') { if (!was.moved) { state.select = { a: was.cell, b: was.cell }; chosen(); } }
            else if (was.kind === 'select') { state.select.b = cell; chosen(); }
            else if (state.measure && !state.measure.fixed) setMeasure(state.measure.a, cell, true);
            follow();
        });
        board.addEventListener('pointercancel', () => { drag = null; });
        board.addEventListener('pointerleave', () => {
            if (drag || !state.hover) return;
            state.hover = null;
            showReadout(); follow();
        });
        board.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
        // The overview: the pointer names the cell of whichever map it is
        // over; a click opens that map at that cell.
        const worldUnder = e => { const r = worldCanvas.getBoundingClientRect(); return lab.worldAt(world, (e.clientX - r.left) / worldCell, (e.clientY - r.top) / worldCell); };
        function overWorld(at) {
            readout.textContent = at ? lab.describe(at.id, at.col, at.row) : WORLD.hint;
            if ((at?.id || null) !== worldOver) { worldOver = at?.id || null; drawWorld(); }
        }
        worldCanvas.addEventListener('pointermove', e => { if (world) overWorld(worldUnder(e)); });
        worldCanvas.addEventListener('pointerleave', () => { if (world) overWorld(null); });
        worldCanvas.addEventListener('click', e => {
            const at = world && worldUnder(e);
            if (at) { pick(at.id); show(at.col, at.row); }
        });
        window.addEventListener('resize', () => { if (world) drawWorld(); });
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !plan) return;
            state.select = null; state.measure = null; drag = null; refBox.value = '';
            showMeasure(); follow();
        });

        // ---- the panel ----
        function setTool(tool) {
            state.tool = tool;
            if (state.measure && !state.measure.fixed) state.measure = null;
            board.dataset.tool = tool;
            // A finger draws a rectangle or a measure; with the pan tool it scrolls the map.
            board.style.touchAction = tool === 'pan' ? 'auto' : 'none';
            $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
            $('[data-tool-note]').textContent = TOOLS[tool];
            showMeasure(); follow(); savePrefs();
        }
        const fitCell = () => clamp(Math.floor(Math.min((stage.clientWidth - RULER.left - 2) / plan.width, (stage.clientHeight - RULER.top - 2) / plan.height)), CELL.min, CELL.max);
        function showZoom() { zoom.value = String(state.cell); $('[data-zoom-text]').textContent = `${state.cell} 像素`; }
        // A new size for the cells; what is at the middle of the view stays there.
        function setCell(px) {
            px = clamp(Math.round(px), CELL.min, CELL.max);
            const was = state.cell, fx = (stage.scrollLeft + stage.clientWidth / 2 - RULER.left) / was, fy = (stage.scrollTop + stage.clientHeight / 2 - RULER.top) / was;
            state.cell = px;
            showZoom(); redraw(); savePrefs();
            stage.scrollLeft = fx * px + RULER.left - stage.clientWidth / 2; stage.scrollTop = fy * px + RULER.top - stage.clientHeight / 2;
        }
        // Map `id` on the sheet. Rows the loader cannot read are said, not thrown.
        function pick(id) {
            state.map = id; state.hover = state.point = state.select = state.measure = null; drag = null;
            refBox.value = ''; picker.value = id;
            plan = null; world = null; worldOver = null; errorBox.hidden = true;
            if (id === WORLD.id) world = lab.world();
            else try { plan = lab.planOf(id); } catch (error) {
                errorBox.textContent = `这张地图读不出来（${id}）：${error.message}`; errorBox.hidden = false;
            }
            sheet.hidden = !plan; worldBox.hidden = !world;
            // The overview has no cells to pick: its size follows the window, and the tools rest.
            for (const control of [zoom, ...$$('[data-tool]')]) control.disabled = !!world;
            if (state.cell == null) state.cell = plan ? clamp(fitCell(), ...CELL.first) : CELL.fallback;
            showZoom(); redraw(); showReadout(); showMeasure(); showInfo(); showLegend();
            stage.scrollTo(0, 0);
            // The address keeps the map: a reload (the rows were changed) shows the same one.
            try { const url = new URL(location.href); url.searchParams.set('map', id); history.replaceState(null, '', url); } catch (_) { /* the address stays */ }
            savePrefs();
        }
        picker.innerHTML = [`<option value="${WORLD.id}">${WORLD.name}</option>`, ...list.map(m => `<option value="${escape(m.id)}">${escape(m.name)} ${escape(m.id)}</option>`)].join('');
        picker.addEventListener('change', () => pick(picker.value));
        zoom.min = String(CELL.min); zoom.max = String(CELL.max);
        zoom.addEventListener('input', () => { if (plan) setCell(+zoom.value); });
        $('[data-fit]').addEventListener('click', () => { if (plan) { setCell(fitCell()); stage.scrollTo(0, 0); } else if (world) drawWorld(); });
        $('[data-tools]').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
        $$('[data-show]').forEach(b => {
            b.checked = !!state.show[b.dataset.show];
            b.addEventListener('change', () => { state.show[b.dataset.show] = b.checked; redraw(); savePrefs(); });
        });
        $('[data-copy]').addEventListener('click', () => { if (refBox.value) copy(refBox.value); else note('先在地图上点一格'); });
        refBox.addEventListener('focus', () => refBox.select());
        info.addEventListener('click', e => {
            const to = e.target.closest('[data-to]'), cell = e.target.closest('[data-go]');
            if (to && known(to.dataset.to)) { e.preventDefault(); pick(to.dataset.to); }
            else if (cell && plan) show(...cell.dataset.go.split(',').map(Number));
        });

        setTool(state.tool);
        pick(state.map);
        // For tests and the console: the plan on the sheet and the page's hands.
        window.mapPreview = {
            lab, state, pick, show, select, setTool, setCell, redraw,
            get plan() { return plan; },
            get world() { return world; },
            measure(a, b) { setMeasure({ ...a }, { ...b }, true); follow(); return state.measure.result; }
        };
    }
    return { start };
})();
