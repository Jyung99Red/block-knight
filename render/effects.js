// Drawn-only feedback (design.md 2.5): blade
// trails, block debris, hit flash, a parry's white flash, a small camera shake, stagger stars, the
// charge glow, the pause-line cue, a fallen monster's burst and an enraged
// one's red glow. Reads simulation events and solved rigs; never writes the
// simulation. Kept low-key on purpose. `selfId` is the fighter this phone
// plays: its hits and hurts shake the camera, its pause line is cued.
const renderEffects = (() => {
    const TRAIL_N = 40, TRAIL_AGE = 0.11, MAXP = 120;

    function create(T, scene, rnd) {
        const unit = new T.BoxGeometry(1, 1, 1), dummy = new T.Object3D(), col = new T.Color();
        // ---- debris: small cubes that pop, fall and bounce ----
        const parts = new T.InstancedMesh(unit, new T.MeshBasicMaterial(), MAXP);
        parts.frustumCulled = false; scene.add(parts);
        const pool = Array.from({ length: MAXP }, () => ({ life: 0 }));
        dummy.scale.setScalar(0); dummy.updateMatrix();
        for (let i = 0; i < MAXP; i++) { parts.setMatrixAt(i, dummy.matrix); parts.setColorAt(i, col.set('#ffffff')); }
        dummy.scale.setScalar(1);
        function burst(at, n, colors, lo, hi, size, float = false) {
            for (let k = 0; k < n; k++) {
                const i = pool.findIndex(q => q.life <= 0);
                if (i < 0) break;
                const th = rnd() * Math.PI * 2, up = 0.3 + rnd() * 0.9, v = lo + rnd() * (hi - lo);
                Object.assign(pool[i], { life: 0.45 + rnd() * 0.3, x: at[0], y: at[1], z: at[2], vx: Math.cos(th) * v, vy: up * v, vz: Math.sin(th) * v, s: size * (0.7 + rnd() * 0.6), spin: rnd() * 6, float });
                parts.setColorAt(i, col.set(colors[rnd() * colors.length | 0]));
            }
            parts.instanceColor.needsUpdate = true;
        }
        function tickParts(dt) {
            pool.forEach((p, i) => {
                if (p.life <= 0) return;
                p.life -= dt; p.vy += (p.float ? 1.2 : -9.8) * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
                if (p.y < p.s / 2) { p.y = p.s / 2; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
                p.spin += dt * 8;
                dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.spin, p.spin * 0.7, 0);
                dummy.scale.setScalar(p.life > 0 ? p.s * Math.min(1, p.life / 0.3) : 0); dummy.updateMatrix();
                parts.setMatrixAt(i, dummy.matrix);
            });
            dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
            parts.instanceMatrix.needsUpdate = true;
        }

        // ---- blade trails: a ribbon through recent blade positions, one
        // per fighter ----
        const trailMaterial = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, side: T.DoubleSide, depthWrite: false });
        const trails = new Map();
        let clock = 0;
        function trailOf(id) {
            if (trails.has(id)) return trails.get(id);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(new Float32Array(TRAIL_N * 6), 3));
            geo.setAttribute('color', new T.BufferAttribute(new Float32Array(TRAIL_N * 8), 4));
            const index = [];
            for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            geo.setIndex(index); geo.setDrawRange(0, 0);
            const mesh = new T.Mesh(geo, trailMaterial);
            mesh.frustumCulled = false; scene.add(mesh);
            const trail = { geo, mesh, samples: [] };
            trails.set(id, trail);
            return trail;
        }
        function sampleBlade(trail, rig, solved, heavy) {
            const i = rig.parts.findIndex(p => p.kind === 'weapon'), half = rig.parts[i].size[2] / 2, m = solved.parts[i];
            trail.samples.push({ b: math3d.transformPoint(m, [0, 0, -half]), t: math3d.transformPoint(m, [0, 0, half]), at: clock, heavy });
            if (trail.samples.length > TRAIL_N) trail.samples.shift();
        }
        function drawTrail({ geo, samples }) {
            while (samples.length && clock - samples[0].at > TRAIL_AGE) samples.shift();
            const pos = geo.attributes.position.array, c = geo.attributes.color.array;
            samples.forEach((s, i) => {
                pos.set([...s.b, ...s.t], i * 6);
                const a = 0.6 * (1 - (clock - s.at) / TRAIL_AGE), rgb = s.heavy ? [1, 0.82, 0.45] : [1, 1, 1];
                c.set([...rgb, a * 0.1, ...rgb, a], i * 8);
            });
            geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
            geo.setDrawRange(0, Math.max(0, samples.length - 1) * 6);
        }

        // ---- stagger stars, one ring per reeling foe ----
        const starRings = new Map();
        function starsFor(id) {
            if (!starRings.has(id)) {
                const ring = new T.Group();
                for (let i = 0; i < 4; i++) {
                    const s = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.09), new T.MeshBasicMaterial({ color: '#ffd84a' }));
                    s.position.set(Math.cos(i / 4 * Math.PI * 2) * 0.32, 0, Math.sin(i / 4 * Math.PI * 2) * 0.32);
                    ring.add(s);
                }
                scene.add(ring); starRings.set(id, ring);
            }
            return starRings.get(id);
        }

        // ---- flashes, shake and glow, driven by events ----
        const flash = new Map(); // id -> seconds left
        // A parry flashes what guarded it white once -- the shield, or the
        // blade without one -- for BLINK seconds (user, 2026-10-03: the
        // model going white, not a glow; one flash of 0.2 s, no sparks).
        // id -> seconds left.
        const blinks = new Map(), BLINK = 0.2;
        const blinking = id => (blinks.get(id) || 0) > 0;
        // A monster's colours (models/palette.js), for the burst as it falls.
        const FALLEN = Object.fromEntries(Object.entries({
            goblin: ['goblin', 'goblinLight', 'rag'], wolf: ['wolf', 'wolfLight', 'wolfDark'], spider: ['spider', 'spiderLight', 'spiderMark'],
            goblinChief: ['chiefSkin', 'chiefRag', 'helmet', 'gold'], wolfKing: ['kingFur', 'mane', 'kingEye', 'gold']
        }).map(([kind, names]) => [kind, names.map(name => palette[name])]));
        let shake = 0, cue = 0, rested = 0;
        function onEvents(events, selfId = 'player') {
            for (const e of events) {
                if (e.type === 'hit' && e.target === selfId) {
                    flash.set(selfId, 0.12); burst(e.at, 6, ['#ffffff', '#e8b4a0'], 1.4, 2.4, 0.06);
                    if (e.heavy) shake = Math.max(shake, 0.1);
                } else if (e.type === 'hit') {
                    flash.set(e.target, 0.12);
                    if (e.heavy) { burst(e.at, 12, ['#ffffff', '#ffd27a', '#f2b544'], 2, 3.8, 0.08); if (e.source === selfId) shake = Math.max(shake, 0.12); }
                    else burst(e.at, 7, ['#ffffff', '#f4f1e6', '#d9dee3'], 1.5, 2.8, 0.06);
                } else if (e.type === 'block') burst(e.at, 5, ['#d9dee3', '#9aa2aa'], 1.2, 2.2, 0.05);
                else if (e.type === 'parry') {
                    flash.set(e.target, 0.12); blinks.set(e.side, BLINK); shake = Math.max(shake, 0.1);
                }
                else if (e.type === 'defeated') burst(e.at, e.boss ? 30 : 14, FALLEN[e.kind] || ['#ffffff'], 1.2, e.boss ? 3.4 : 2.6, e.boss ? 0.1 : 0.08);
                else if (e.type === 'revive') { burst(e.at, 30, ['#a183ff', '#ecd9ff', '#6b4a2a', ...(FALLEN[e.kind] || [])], 1.4, 3.4, 0.1); shake = Math.max(shake, 0.12); }
                else if (e.type === 'chest_open') burst(e.at, 16, ['#ffe066', '#d8b04a', '#ffffff'], 1.2, 3, 0.06);
                else if (e.type === 'pickup' && e.side === selfId) burst(e.at, 3, ['#fff3b0', '#ffffff'], 0.6, 1.2, 0.04);
                else if (e.type === 'rest' && e.side === selfId) rested = 0.9;
                else if (e.type === 'drink' && e.side === selfId) rested = 0.5;
                else if (e.type === 'burn') burst(e.at, 6, ['#ffb13b', '#ff6a2a', '#fff1a8'], 0.6, 1.4, 0.06);
                else if (e.type === 'burned') burst(e.at, 8, ['#3a3430', '#5a5048', '#ff8a3a'], 0.4, 1.2, 0.07);
                else if (e.type === 'gather') burst(e.at, 12, GATHERED[e.kind] || GATHERED.ore, 0.8, 2.2, 0.07);
                else if (e.type === 'enrage') burst(e.at, 8, ['#ff6a4a', '#d9473f'], 1, 2, 0.06);
                else if (e.type === 'pause_ready' && e.side === selfId) cue = 0.14;
            }
        }
        const white = new T.Color('#ffffff'), red = new T.Color('#ff8a7a'), gold = new T.Color('#f2b544'), rage = new T.Color('#ff3a24');
        // Chips thrown up by gathering, by resource.
        const GATHERED = { ore: [palette.stone, palette.ore, palette.stoneDark], crystal: [palette.crystal, palette.crystalDeep, '#ffffff'], herb: [palette.herb, palette.herbLight, palette.berry] };
        // Per frame. `view`: { selfId, fighters: [{ id, body, rig,
        // solved, blade, materials }] (those drawn), foes: [{ body, view:
        // { materials }, top, shown }] }.
        function update(dt, sim, view) {
            clock += dt;
            tickParts(dt);
            for (const [id, left] of flash) flash.set(id, Math.max(0, left - dt));
            for (const [id, left] of blinks) blinks.set(id, Math.max(0, left - dt));
            const lit = id => (flash.get(id) || 0) / 0.12;
            cue = Math.max(0, cue - dt);
            const drawn = new Set();
            rested = Math.max(0, rested - dt);
            // Thickets on fire: flames lick up from each burning block.
            for (const e of sim.entities) {
                if (e.type !== 'brush' || e.burning < 0 || rnd() > 0.7) continue;
                const [x, , z] = space.toBlocks(e.x, e.y);
                burst([x + (rnd() - 0.5) * 0.9, 0.3 + rnd() * 1.6, z + (rnd() - 0.5) * 0.9], 2, ['#ffb13b', '#ff6a2a', '#fff1a8'], 0.2, 0.6, 0.08 + rnd() * 0.06, true);
            }
            // A boss's grave called: violet motes rise round it, more as it goes on.
            for (const e of sim.entities) {
                if (e.type !== 'grave' || e.state !== 'calling' || rnd() > 0.35 + 0.6 * Math.min(1, e.t / gameConfig.props.graveCall)) continue;
                const [x, , z] = space.toBlocks(e.x, e.y), a2 = rnd() * Math.PI * 2, r = 0.3 + rnd() * 0.5;
                burst([x + Math.cos(a2) * r, 0.1 + rnd() * 0.5, z + Math.sin(a2) * r], 2, ['#a183ff', '#ecd9ff', '#6a4ad8'], 0.3, 0.9, 0.06 + rnd() * 0.05, true);
            }
            for (const f of view.fighters) {
                const a = f.body.act, trail = trailOf(f.id);
                drawn.add(f.id);
                // Resting at the hot spring: green motes rise round the body.
                if (rested > 0 && f.id === view.selfId && rnd() < 0.5) {
                    const [x, , z] = space.toBlocks(f.shown.x, f.shown.y, f.shown.h), a2 = rnd() * Math.PI * 2;
                    burst([x + Math.cos(a2) * 0.4, 0.2 + rnd() * 1.4, z + Math.sin(a2) * 0.4], 1, ['#9ff0a0', '#e8ffd8'], 0.2, 0.6, 0.05);
                }
                if (a?.phase === 'swing') sampleBlade(trail, f.rig, f.solved, gameConfig.combo.moves[a.move].knockback > 0);
                drawTrail(trail); trail.mesh.visible = true;
                for (const m of f.materials) m.emissive.copy(red).multiplyScalar(0.7 * lit(f.id));
                // A parry flashes the shield white; with no shield, the blade.
                const blink = blinking(f.id), shielded = f.flash(blink);
                // The blade glows gold while charging, flashes white on the pause line and on a parry.
                const charge = a?.phase === 'charge' ? Math.min(1, fighterKit.chargeOf(sim, f.body, a) / gameConfig.combat.charge.full) : 0;
                if (f.blade) {
                    if (blink && !shielded) f.blade.emissive.copy(white);
                    else if (cue > 0 && f.id === view.selfId) f.blade.emissive.copy(white).multiplyScalar(0.9);
                    else f.blade.emissive.copy(gold).multiplyScalar(0.9 * charge);
                }
            }
            for (const [id, trail] of trails) if (!drawn.has(id)) { trail.samples.length = 0; trail.mesh.visible = false; }
            const reeling = new Set();
            for (const foe of view.foes) {
                const k = lit(foe.body.id), angry = foe.body.enraged && foe.body.phase !== 'dead' ? 0.1 + 0.06 * Math.sin(clock * 7) : 0;
                for (const m of foe.view.materials) {
                    if (k > 0) m.emissive.copy(white).multiplyScalar(0.8 * k);
                    else m.emissive.copy(rage).multiplyScalar(angry);
                }
                if (foe.body.phase === 'reel') {
                    const ring = starsFor(foe.body.id), b = foe.shown || foe.body, [x, , z] = space.toBlocks(b.x, b.y, b.h);
                    ring.position.set(x, foe.top, z); ring.rotation.y = clock * 5; ring.visible = true;
                    reeling.add(foe.body.id);
                }
            }
            for (const [id, ring] of starRings) if (!reeling.has(id)) ring.visible = false;
            shake = Math.max(0, shake - dt);
        }
        // Camera jitter for this frame, in blocks.
        const jitter = () => shake > 0 ? [(rnd() - 0.5) * shake * 0.4, (rnd() - 0.5) * shake * 0.4] : [0, 0];
        return { onEvents, update, jitter };
    }
    return { create };
})();
