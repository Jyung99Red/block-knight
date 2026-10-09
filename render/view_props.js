// Props for the world view (render/world_view.js): portal openings,
// chests, bosses' graves, loot on the ground, burning thickets, the torches that stand in
// the map and a monster's range warning. Drawing only.
const viewProps = (() => {
    // `stage`: what the world's parts share (render/world_view.js `build`);
    // `character`: render/view_bodies.js, for the chests; `motion`: what
    // has moved this frame, there too -- the loot drawn turns, and is
    // added to it. `far`: how far from the camera's focus (blocks) loot
    // is drawn.
    function create({ T, scene, sim, tx, ground, far: FAR }, { character, motion }) {
        const C = gameConfig, P = palette;
        // ---- props: portal openings, chests, loot on the ground ----
        const portals = sim.entities.filter(e => e.type === 'portal').map(e => {
            const plane = new T.Mesh(new T.PlaneGeometry(0.98, terrainKit.PORTAL_HEIGHT - 0.04), new T.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false }));
            const [x, , z] = space.toBlocks(e.x, e.y);
            plane.position.set(x, terrainKit.PORTAL_HEIGHT / 2, z);
            if (e.side === 'east' || e.side === 'west') plane.rotation.y = Math.PI / 2;
            scene.add(plane);
            return { body: e, plane };
        });
        const chestRig = rigKit.build(propModels.chest), chests = new Map();
        for (const e of sim.entities) if (e.type === 'chest') chests.set(e.id, character(chestRig));
        // Graves: shown while they show (core/props.js), coming up out of the
        // ground when they first do; called, the stone trembles as it glows.
        const graveRig = rigKit.build(propModels.grave), graves = new Map();
        for (const e of sim.entities) if (e.type === 'grave') graves.set(e.id, character(graveRig));
        const unitBox = new T.BoxGeometry(1, 1, 1), DROPS = 64, drops = new T.InstancedMesh(unitBox, new T.MeshLambertMaterial({ map: tx.grain }), DROPS);
        drops.castShadow = true; drops.frustumCulled = false; drops.count = 0;
        scene.add(drops);
        // Flames on burning thickets: a few bright cubes per block, licking.
        const FIRES = 48, fires = new T.InstancedMesh(unitBox, new T.MeshBasicMaterial(), FIRES);
        fires.frustumCulled = false; fires.count = 0;
        scene.add(fires);
        // The torches that stand in the map (render/lamp_view.js), fading as
        // the terrain does; `lamps`, where their lights are (render/view_light.js).
        const lamps = lampView.create(T, scene, sim, viewShaders.embodied(T, new T.MeshLambertMaterial({ map: tx.grain, vertexColors: true }), { value: 0 }, ground.fade));
        const place = new T.Object3D(), tint = new T.Color();
        // Seconds a chest's lid takes to open, and a grave to come up.
        const OPENS = 0.45, RISES = 0.6;
        // Where the props that move now are ([x, z], blocks): loot (it
        // turns), a chest opening, a grave coming up or called. A standing
        // torch's shadows are drawn anew while one is by (render/view_light.js).
        function stirring(current) {
            const out = [];
            for (const e of current.entities) {
                if (!(e.type === 'drop' || (e.type === 'chest' && e.open && e.t < OPENS) || (e.type === 'grave' && (e.state === 'calling' || (e.state === 'ready' && e.t < RISES))))) continue;
                const [x, , z] = space.toBlocks(e.x, e.y);
                out.push([x, z]);
            }
            return out;
        }
        // Each frame: `me`, the camera's focus (blocks); `clock`, seconds
        // drawn so far.
        function update(current, me, clock) {
            lamps.update(clock);
            for (const { body, plane } of portals) {
                const locked = body.requires && !current.progress?.bosses?.[body.requires];
                plane.material.color.set(P[propModels.portal[locked ? 'locked' : 'open']]);
                plane.material.opacity = locked ? 0.42 : 0.55 + 0.12 * Math.sin(clock * 2.4);
            }
            for (const e of current.entities) {
                if (e.type !== 'chest') continue;
                const view = chests.get(e.id);
                if (!view) continue;
                const k = e.open ? Math.min(1, e.t / OPENS) : 0, lid = rigKit.scale(propModels.chest.open, 1 - (1 - k) * (1 - k));
                view.place(rigKit.solve(chestRig, lid, space.toBlocks(e.x, e.y, e.h), space.yawOf(e.facing)));
            }
            for (const e of current.entities) {
                if (e.type !== 'grave') continue;
                const view = graves.get(e.id);
                if (!view) continue;
                view.show(e.state !== 'hidden');
                if (e.state === 'hidden') continue;
                // It comes up out of the ground as it shows; called, it glows
                // and sinks back over graveCall seconds, and the boss rises
                // where it was (user, 2026-10-08).
                const under = e.state === 'ready' ? 1 - Math.min(1, e.t / RISES) : Math.min(1, e.t / C.props.graveCall);
                const shake = e.state === 'calling' ? 0.02 * Math.min(1, e.t) * Math.sin(clock * 47) : 0;
                const [x, , z] = space.toBlocks(e.x, e.y, e.h);
                view.place(rigKit.solve(graveRig, {}, [x + shake, -1.2 * under * under, z], space.yawOf(e.facing)));
                for (const m of view.materials) m.emissive.set(P.portalGlow).multiplyScalar(e.state === 'calling' ? 0.25 * Math.min(1, e.t / C.props.graveCall) : 0);
            }
            let n = 0;
            for (const e of current.entities) {
                if (e.type !== 'drop' || n >= DROPS) continue;
                const look = propModels.drops[e.item] || propModels.drops.gold, [x, y, z] = space.toBlocks(e.x, e.y, e.h);
                if (Math.hypot(x - me[0], z - me[2]) > FAR) continue;
                const bob = e.h === 0 ? 0.04 + 0.04 * Math.sin(clock * 3 + e.facing * 5) : 0;
                place.position.set(x, y + look.size[1] / 2 + bob, z);
                place.rotation.set(0, e.facing + clock * 1.6, 0);
                place.scale.set(...look.size);
                place.updateMatrix();
                drops.setMatrixAt(n, place.matrix); drops.setColorAt(n, tint.set(P[look.color]));
                motion.at.push([x, z]);
                n++;
            }
            drops.count = n;
            drops.instanceMatrix.needsUpdate = true;
            if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
            let f = 0;
            for (const e of current.entities) {
                if (e.type !== 'brush' || e.burning < 0) continue;
                const [x, , z] = space.toBlocks(e.x, e.y), life = 1 - e.burning / C.props.burnSeconds;
                for (let k = 0; k < 4 && f < FIRES; k++, f++) {
                    const a = k * 1.7 + e.col * 0.9 + e.row * 1.3, lick = 0.5 + 0.5 * Math.sin(clock * (9 + k) + a);
                    const size = (0.28 + 0.22 * lick) * Math.max(0.3, life);
                    place.position.set(x + Math.cos(a) * 0.25, terrainKit.BRUSH_HEIGHT * Math.max(0.2, life) + size / 2 - 0.1 + lick * 0.2, z + Math.sin(a) * 0.25);
                    place.rotation.set(0, a + clock, 0); place.scale.setScalar(size); place.updateMatrix();
                    fires.setMatrixAt(f, place.matrix); fires.setColorAt(f, tint.set(k % 2 ? P.flame : P.flameTip));
                }
            }
            fires.count = f;
            fires.instanceMatrix.needsUpdate = true;
            if (fires.instanceColor) fires.instanceColor.needsUpdate = true;
        }
        // ---- range warnings: the swept outline of a monster's move on the
        // ground (core/monster.js reach), fading in through its windup ----
        const warnShapes = new Map();
        function warnGeometry(kind, move) {
            const key = `${kind}:${move}`;
            if (!warnShapes.has(key)) {
                const hull = monsterKit.reach(kind, move).hull, g = new T.BufferGeometry(), pts = [];
                for (let i = 1; i < hull.length - 1; i++) for (const p of [hull[0], hull[i + 1], hull[i]]) pts.push(p[0], 0, p[1]);
                g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
                warnShapes.set(key, g);
            }
            return warnShapes.get(key);
        }
        const warnMaterial = () => new T.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        // `entry`: monster `m`'s own (render/world_view.js), which keeps its
        // warning. (A monster out of sight shows no warning either.)
        function warn(entry, m, visible) {
            const S = C.monsters[m.kind], mv = S.moves[m.move], active = visible && (m.phase === 'windup' || m.phase === 'swing');
            if (!active) { if (entry.warning) entry.warning.visible = false; return; }
            if (!entry.warning) { entry.warning = new T.Mesh(warnGeometry(m.kind, m.move), warnMaterial()); entry.warning.renderOrder = 1; scene.add(entry.warning); }
            const w = entry.warning;
            w.geometry = warnGeometry(m.kind, m.move); w.visible = true;
            // It follows the turning windup, then stays where the swing began.
            if (m.phase === 'windup') {
                const [x, , z] = space.toBlocks(m.x, m.y, m.h);
                w.position.set(x, 0.012, z); w.rotation.y = space.yawOf(m.facing);
                w.material.opacity = 0.14 + 0.3 * Math.min(1, m.t / mv.windup);
            } else w.material.opacity = 0.44 * (1 - Math.min(1, m.t / mv.swing));
        }
        // The warnings' shapes are kept apart from the scene; `once` disposes
        // of a thing only once (render/world_view.js `dispose`).
        function dispose(once) {
            for (const g of warnShapes.values()) once(g, () => g.dispose());
        }
        return { update, warn, dispose, stirring, lamps: lamps.lights, lampPosts: lamps.posts };
    }
    return { create };
})();
