// The move tuner's 3D view (tune.html): the main character, the training
// dummy, see-through ghosts of the two keys, the blade's path over each
// swing, hit boxes, and the axes of the bone being edited, on a gridded
// floor of one-block squares. Drawing only: every matrix comes in solved
// (core/rig.js) from tune/panel.js. The camera orbits a point: drag to turn,
// right-drag (or shift-drag) to pan, wheel to zoom; a click on the body
// picks the bone under the pointer. The character faces +x.
const tuneView = (() => {
    // Camera presets: azimuth (0: from +z, the character's right; the game's
    // own camera looks from there), elevation, distance in blocks.
    const VIEWS = Object.freeze({
        three: { name: '右前方', az: 0.45, el: 0.22, dist: 6.8 },
        front: { name: '正面', az: Math.PI / 2, el: 0.12, dist: 6 },
        right: { name: '右侧', az: 0, el: 0.12, dist: 6 },
        left: { name: '左侧', az: Math.PI, el: 0.12, dist: 6 },
        back: { name: '背后', az: -Math.PI / 2, el: 0.2, dist: 6 },
        top: { name: '正上方', az: 0, el: 1.5, dist: 7 },
        game: { name: '游戏镜头', az: gameConfig.camera.yaw, el: gameConfig.camera.pitch, dist: gameConfig.camera.distance }
    });
    // x, y, z: the channel colours of the panel (tune.css).
    const COLORS = Object.freeze({ bg: '#1b2026', floor: '#262d34', grid: '#3a444e', gridMain: '#56626e', ring: '#f2b544', a: '#58a6ff', b: '#ff8a4c', trail: '#ffd479', body: '#5ccfc4', weapon: '#ff5d4f', pick: '#f2b544', x: '#ff5d5d', y: '#5fd35f', z: '#5c8dff' });

    function create(canvas, { onPick = () => {} } = {}) {
        const T = THREE;
        const renderer = new T.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new T.Scene();
        scene.background = new T.Color(COLORS.bg);
        const camera = new T.PerspectiveCamera(34, 1, 0.05, 200);
        scene.add(new T.HemisphereLight(palette.skyLight, palette.groundLight, 2.2));
        const sun = new T.DirectionalLight(palette.sun, 2.4);
        sun.position.set(3, 6, 4);
        scene.add(sun);
        const grain = renderTextures.create(T).grain;

        // ---- the floor: one-block squares, every fifth line brighter ----
        const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshLambertMaterial({ color: COLORS.floor }));
        floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002;
        scene.add(floor);
        const grid = new T.GridHelper(30, 30, COLORS.grid, COLORS.grid), major = new T.GridHelper(30, 6, COLORS.gridMain, COLORS.gridMain);
        grid.position.y = 0.001; major.position.y = 0.002;
        scene.add(grid, major);
        // The standard distance round the start, and a mark where the dummy stands.
        const ring = new T.Mesh(new T.RingGeometry(0.985, 1, 96), new T.MeshBasicMaterial({ color: COLORS.ring, transparent: true, opacity: 0.55, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004;
        scene.add(ring);

        // ---- characters: a mesh per box, placed by solved matrices ----
        const boxes = new Map();
        function boxGeo(w, h, d) {
            const key = `${w},${h},${d}`;
            if (!boxes.has(key)) {
                const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
                for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
                boxes.set(key, g);
            }
            return boxes.get(key);
        }
        // `material(part)` gives each box its material.
        function figure(rig, material) {
            const group = new T.Group(), parts = [];
            rig.parts.forEach((part, i) => {
                const mesh = new T.Mesh(boxGeo(...part.size), material(part));
                mesh.matrixAutoUpdate = false; mesh.userData.part = i;
                group.add(mesh); parts.push({ i, mesh });
            });
            scene.add(group);
            return {
                rig, group, parts,
                place(solved) { for (const { i, mesh } of parts) { mesh.matrix.fromArray(solved.parts[i]); mesh.matrixWorldNeedsUpdate = true; } },
                dispose() { scene.remove(group); for (const { mesh } of parts) if (mesh.material.userData.own) mesh.material.dispose(); }
            };
        }
        const solid = look => part => {
            const name = look[part.color] || part.color;
            if (!palette[name]) throw new Error(`Unknown palette colour ${name}`);
            const m = new T.MeshLambertMaterial({ color: palette[name], map: grain });
            if (part.tag === 'flame') m.emissive.set(palette[name]);
            m.userData.own = true;
            return m;
        };
        // Ghosts: see-through, the blade more solid so its line reads.
        const ghostMaterials = tone => ({
            body: new T.MeshBasicMaterial({ color: COLORS[tone], transparent: true, opacity: 0.16, depthWrite: false }),
            weapon: new T.MeshBasicMaterial({ color: COLORS[tone], transparent: true, opacity: 0.6, depthWrite: false })
        });
        const ghostLook = { a: ghostMaterials('a'), b: ghostMaterials('b') };
        let player = null, dummy = null, playerKey = null;
        const ghosts = { a: null, b: null };
        function setPlayer(rig, look) {
            const key = JSON.stringify(look);
            if (player?.rig === rig && playerKey === key) return;
            player?.dispose(); ghosts.a?.dispose(); ghosts.b?.dispose();
            player = figure(rig, solid(look)); playerKey = key;
            for (const tone of ['a', 'b']) {
                ghosts[tone] = figure(rig, part => part.kind === 'weapon' ? ghostLook[tone].weapon : ghostLook[tone].body);
                ghosts[tone].group.renderOrder = 2;
            }
            dropLines('player');
        }
        function setDummy(rig) {
            if (dummy?.rig === rig) return;
            dummy?.dispose();
            dummy = rig ? figure(rig, solid({})) : null;
            dropLines('dummy');
        }

        // The dummy fades while it stands between the camera and the character.
        function fadeDummy(body, target) {
            const p = body.bones[0], d = target.bones[0], to = [d[12] - p[12], d[14] - p[14]], eye = [camera.position.x - p[12], camera.position.z - p[14]];
            const cos = (to[0] * eye[0] + to[1] * eye[1]) / (Math.hypot(...to) * Math.hypot(...eye) || 1);
            const fade = cos > 0.6 && Math.hypot(...eye) > Math.hypot(...to);
            for (const { mesh } of dummy.parts) {
                const m = mesh.material;
                if (m.transparent === fade) continue;
                m.transparent = fade; m.opacity = fade ? 0.22 : 1; m.depthWrite = !fade;
            }
        }

        // ---- hit boxes: body boxes cyan, weapon boxes (grown by
        // combat.weaponPad) red, as the game's ?boxes shows them ----
        const pad = gameConfig.combat.weaponPad / gameConfig.world.unitsPerBlock;
        const boxLines = { player: null, dummy: null };
        const lineMaterials = {
            body: new T.LineBasicMaterial({ color: COLORS.body, depthTest: false, transparent: true }),
            weapon: new T.LineBasicMaterial({ color: COLORS.weapon, depthTest: false, transparent: true })
        };
        function linesOf(fig) {
            const group = new T.Group(), list = [];
            fig.rig.parts.forEach((part, i) => {
                if (part.kind !== 'body' && part.kind !== 'weapon') return;
                const line = new T.LineSegments(new T.EdgesGeometry(boxGeo(...part.size)), lineMaterials[part.kind]);
                line.matrixAutoUpdate = false; line.renderOrder = 10;
                group.add(line);
                list.push({ i, line, grow: part.kind === 'weapon' ? part.size.map(v => (v + 2 * pad) / v) : null });
            });
            scene.add(group);
            return { fig, group, list };
        }
        function dropLines(which) {
            const L = boxLines[which];
            if (!L) return;
            scene.remove(L.group);
            for (const { line } of L.list) line.geometry.dispose();
            boxLines[which] = null;
        }
        const grown = new T.Matrix4(), scaling = new T.Matrix4();
        function placeLines(which, fig, solved, show) {
            if (boxLines[which] && boxLines[which].fig !== fig) dropLines(which);
            let L = boxLines[which];
            if (!fig || !show) { if (L) L.group.visible = false; return; }
            if (!L) L = boxLines[which] = linesOf(fig);
            L.group.visible = true;
            for (const { i, line, grow } of L.list) {
                grown.fromArray(solved.parts[i]);
                if (grow) grown.multiply(scaling.makeScale(...grow));
                line.matrix.copy(grown); line.matrixWorldNeedsUpdate = true;
            }
        }

        // ---- the edited bone: its boxes tinted and its own axes drawn from
        // the joint (red x, green y, blue z: square to each other; the
        // panel turns a bone about these). A slider turns it about a gimbal
        // axis instead (tune/lab.js): the dashed line through the joint,
        // in the slider's colour, while a slider is in use ----
        const AXES = ['x', 'y', 'z'], AXIS = 0.38, DASHED = 0.6;
        const axisGeo = new T.BufferGeometry(), axisColors = new Float32Array(18);
        AXES.forEach((k, i) => { const c = new T.Color(COLORS[k]); c.toArray(axisColors, i * 6); c.toArray(axisColors, i * 6 + 3); });
        axisGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(18), 3));
        axisGeo.setAttribute('color', new T.BufferAttribute(axisColors, 3));
        const axes = new T.LineSegments(axisGeo, new T.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
        const dashGeo = new T.BufferGeometry();
        dashGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
        dashGeo.setAttribute('lineDistance', new T.BufferAttribute(new Float32Array([0, 2 * DASHED]), 1));
        const dashed = new T.Line(dashGeo, new T.LineDashedMaterial({ dashSize: 0.05, gapSize: 0.03, depthTest: false, transparent: true }));
        for (const line of [axes, dashed]) { line.renderOrder = 11; line.frustumCulled = false; line.visible = false; scene.add(line); }
        const tint = new T.Color(COLORS.pick).multiplyScalar(0.35);
        function markBone(bone, frame, slider) {
            const index = bone ? player.rig.index[bone] : undefined;
            for (const { i, mesh } of player.parts) {
                const part = player.rig.parts[i], m = mesh.material;
                if (part.bone === index) m.emissive.copy(tint);
                else if (part.tag === 'flame') m.emissive.copy(m.color);
                else m.emissive.setRGB(0, 0, 0);
            }
            axes.visible = index !== undefined && !!frame;
            if (axes.visible) {
                const at = frame.at, p = axisGeo.attributes.position;
                AXES.forEach((k, i) => {
                    const d = frame[k];
                    p.setXYZ(i * 2, at[0], at[1], at[2]);
                    p.setXYZ(i * 2 + 1, at[0] + d[0] * AXIS, at[1] + d[1] * AXIS, at[2] + d[2] * AXIS);
                });
                p.needsUpdate = true;
            }
            dashed.visible = !!slider;
            if (slider) {
                const { at, dir } = slider, p = dashGeo.attributes.position;
                p.setXYZ(0, at[0] - dir[0] * DASHED, at[1] - dir[1] * DASHED, at[2] - dir[2] * DASHED);
                p.setXYZ(1, at[0] + dir[0] * DASHED, at[1] + dir[1] * DASHED, at[2] + dir[2] * DASHED);
                p.needsUpdate = true;
                dashed.material.color.set(COLORS[slider.axis]);
            }
        }

        // ---- blade paths: a ribbon from hilt to tip over each swing ----
        const trailGroup = new T.Group();
        scene.add(trailGroup);
        let trailsShown = null;
        function setTrails(trails) {
            if (trails === trailsShown) return;
            trailsShown = trails;
            for (const child of [...trailGroup.children]) { trailGroup.remove(child); child.geometry.dispose(); child.material.dispose(); }
            for (const trail of trails || []) {
                const n = trail.samples.length;
                if (n < 2) continue;
                const pos = new Float32Array(n * 6), tip = new Float32Array(n * 3), index = [];
                trail.samples.forEach((s, k) => { pos.set(s.hilt, k * 6); pos.set(s.tip, k * 6 + 3); tip.set(s.tip, k * 3); });
                for (let k = 0; k < n - 1; k++) { const a = 2 * k; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
                const g = new T.BufferGeometry();
                g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(index);
                const ribbon = new T.Mesh(g, new T.MeshBasicMaterial({ color: COLORS.trail, transparent: true, opacity: trail.current ? 0.28 : 0.1, side: T.DoubleSide, depthWrite: false }));
                const lg = new T.BufferGeometry();
                lg.setAttribute('position', new T.BufferAttribute(tip, 3));
                const line = new T.Line(lg, new T.LineBasicMaterial({ color: COLORS.trail, transparent: true, opacity: trail.current ? 0.95 : 0.35 }));
                ribbon.renderOrder = line.renderOrder = 3;
                trailGroup.add(ribbon, line);
            }
        }

        // ---- the camera ----
        const orbit = { az: VIEWS.three.az, el: VIEWS.three.el, dist: VIEWS.three.dist, target: new T.Vector3(0, 0.95, 0), pan: new T.Vector3() };
        let follow = true;
        function setView(id) {
            const v = VIEWS[id];
            if (!v) return;
            Object.assign(orbit, { az: v.az, el: v.el, dist: v.dist });
            orbit.pan.set(0, 0, 0);
        }
        function placeCamera() {
            const c = Math.cos(orbit.el), at = orbit.target.clone().add(orbit.pan);
            camera.position.set(at.x + Math.sin(orbit.az) * c * orbit.dist, at.y + Math.sin(orbit.el) * orbit.dist, at.z + Math.cos(orbit.az) * c * orbit.dist);
            camera.lookAt(at);
        }
        let drag = null;
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, at: performance.now(), pan: e.button === 2 || e.shiftKey };
        });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            if (drag.pan) {
                // Along the screen's right and up, by as much as the view shows.
                const k = orbit.dist * 0.0018, right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
                orbit.pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
            } else {
                orbit.az -= dx * 0.008;
                orbit.el = Math.min(1.55, Math.max(-0.3, orbit.el + dy * 0.008));
            }
        });
        const pointer = new T.Vector2(), ray = new T.Raycaster();
        canvas.addEventListener('pointerup', e => {
            const d = drag;
            drag = null;
            if (!d || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4 || performance.now() - d.at > 500 || !player) return;
            const r = canvas.getBoundingClientRect();
            pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
            ray.setFromCamera(pointer, camera);
            const hit = ray.intersectObjects(player.parts.map(p => p.mesh), false)[0];
            if (hit) onPick(player.rig.bones[player.rig.parts[hit.object.userData.part].bone].name);
        });
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            orbit.dist = Math.min(40, Math.max(1.2, orbit.dist * Math.exp(e.deltaY * 0.0012)));
        }, { passive: false });

        function resize(width, height) {
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height; camera.updateProjectionMatrix();
        }
        // Everything shown this frame. state: { player: { rig, look, solved },
        // ghosts: { a, b } (solved or null), dummy: { rig, solved } | null,
        // trails (kept while the same array comes back), boxes (bool), bone
        // (name or null), axes (that bone's own { at, x, y, z }), slider
        // ({ at, dir, axis }: the axis a slider in use turns about, or
        // null), focus ([x, y, z] blocks: where the camera looks while
        // following), ring (blocks, or null) }.
        function draw(state) {
            if (follow && state.focus) orbit.target.set(state.focus[0], state.focus[1], state.focus[2]);
            placeCamera();
            setPlayer(state.player.rig, state.player.look);
            player.place(state.player.solved);
            for (const tone of ['a', 'b']) {
                const g = state.ghosts?.[tone];
                ghosts[tone].group.visible = !!g;
                if (g) ghosts[tone].place(g);
            }
            setDummy(state.dummy?.rig || null);
            if (dummy) { dummy.place(state.dummy.solved); fadeDummy(state.player.solved, state.dummy.solved); }
            setTrails(state.trails);
            placeLines('player', player, state.player.solved, state.boxes);
            placeLines('dummy', dummy, state.dummy?.solved, state.boxes && !!dummy);
            markBone(state.bone, state.axes, state.slider);
            ring.visible = state.ring != null;
            if (ring.visible) ring.scale.set(state.ring, state.ring, 1);
            renderer.render(scene, camera);
        }
        return {
            VIEWS, draw, resize, setView, renderer, camera, scene,
            setFollow(on) { follow = !!on; },
            get follow() { return follow; }
        };
    }
    return { VIEWS, create };
})();
