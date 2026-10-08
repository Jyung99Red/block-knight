// Characters for the world view (render/world_view.js): fighters,
// monsters, the dummy and chests, each one skinned mesh posed from its
// solved rig. Drawing only.
const viewBodies = (() => {
    // `stage`: what the world's parts share (render/world_view.js `build`).
    function create({ T, scene, tx }) {
        const C = gameConfig, P = palette, U = C.world.unitsPerBlock;
        // Box whose faces carry 16 texels per block, like Minecraft.
        function boxGeo(w, h, d) {
            const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv;
            const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
            for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
            return g;
        }
        // Each character is one skinned mesh: every box is welded into one
        // geometry and bound to a bone of its own, whose world matrix is the
        // box's matrix from the rig. So a character is one draw call (and
        // one for its shadow) however many boxes it has. Boxes `apart` keep
        // a mesh of their own: the player's blade, to glow while charging.
        // Each character has its own materials, so a hit flashes only the
        // one struck. With ?boxes in the address, hit boxes are outlined:
        // body boxes in cyan, weapon boxes (grown by combat.weaponPad) red.
        const showBoxes = /[?&]boxes(=|&|$)/.test(window.location.search);
        const pad = C.combat.weaponPad / U, colour = new T.Color();
        // `look` swaps palette colours by name (playerModel.looks). `ghost`
        // and `fade` are what its materials read (render/view_shaders.js
        // `embodied`): none of it left out, and fading as the look has
        // other bodies fade, unless told.
        const solid = { value: 0 }, bodyFade = { value: 0 };
        function character(rig, apart = () => false, look = {}, { ghost = solid, fade = bodyFade } = {}) {
            const thin = made => viewShaders.embodied(T, made, ghost, fade);
            const material = thin(new T.MeshLambertMaterial({ map: tx.grain, vertexColors: true }));
            const pos = [], nor = [], uv = [], col = [], skin = [], weight = [], index = [], bones = [], boned = [], loose = [], lines = [];
            rig.parts.forEach((part, i) => {
                const name = look[part.color] || part.color;
                if (!P[name]) throw new Error(`Unknown palette colour ${name}`);
                const g = boxGeo(...part.size);
                if (apart(part)) {
                    const mesh = new T.Mesh(g, thin(new T.MeshLambertMaterial({ color: P[name], map: tx.grain })));
                    mesh.matrixAutoUpdate = false; mesh.castShadow = true; mesh.receiveShadow = true;
                    scene.add(mesh); loose.push({ i, mesh });
                } else {
                    const base = pos.length / 3, bone = bones.length;
                    bones.push(new T.Bone()); boned.push(i);
                    colour.set(P[name]);
                    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
                    for (let k = 0; k < g.attributes.position.count; k++) { col.push(colour.r, colour.g, colour.b); skin.push(bone, 0, 0, 0); weight.push(1, 0, 0, 0); }
                    for (const k of g.index.array) index.push(base + k);
                    g.dispose();
                }
                if (showBoxes && (part.kind === 'body' || part.kind === 'weapon')) {
                    const line = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(...part.size)), new T.LineBasicMaterial({ color: part.kind === 'weapon' ? '#ff5d4f' : '#5ccfc4', depthTest: false, transparent: true }));
                    line.matrixAutoUpdate = false; line.renderOrder = 10;
                    scene.add(line);
                    lines.push({ i, line, grow: part.kind === 'weapon' ? part.size.map(v => (v + 2 * pad) / v) : null });
                }
            });
            const geometry = new T.BufferGeometry();
            geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
            geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
            geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
            geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
            geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skin, 4));
            geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weight, 4));
            geometry.setIndex(index);
            const mesh = new T.SkinnedMesh(geometry, material);
            mesh.bind(new T.Skeleton(bones), new T.Matrix4());
            // Bounds would have to follow the bones; a handful of characters
            // is cheaper drawn than culled.
            mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
            scene.add(mesh);
            const grown = new T.Matrix4();
            // A shield's white double, shown only while a parry flashes it
            // (render/effects.js): one box round all the shield's boxes, which
            // hang on one bone.
            const shieldParts = rig.parts.map((part, i) => ({ part, i })).filter(({ part }) => C.items[part.owner]?.offhand === 'shield');
            let blinker = null;
            if (shieldParts.length) {
                const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
                for (const { part } of shieldParts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], part.at[k] - part.size[k] / 2); hi[k] = Math.max(hi[k], part.at[k] + part.size[k] / 2); }
                const box = new T.Mesh(new T.BoxGeometry(...hi.map((v, k) => v - lo[k] + 0.02)), new T.MeshBasicMaterial({ color: '#ffffff' }));
                box.matrixAutoUpdate = false; box.visible = false;
                scene.add(box);
                blinker = { box, bone: shieldParts[0].part.bone, at: new T.Matrix4().makeTranslation(...hi.map((v, k) => (v + lo[k]) / 2)), on: false };
            }
            // Flames on a torch: shown only while it burns, glowing.
            const flames = loose.filter(l => rig.parts[l.i].tag === 'flame').map(l => l.mesh);
            for (const f of flames) { f.material.emissive.set(P[rig.parts[loose.find(l => l.mesh === f).i].color]); f.castShadow = false; }
            let lit = false;
            return {
                mesh, blade: loose.find(l => rig.parts[l.i].kind === 'weapon')?.mesh.material || null, flames,
                // Every mesh of it: this phone's own fighter's cast their
                // shadow in its torch's light another way (render/view_light.js `flameLit`).
                meshes: [mesh, ...loose.map(l => l.mesh)],
                materials: [material, ...loose.filter(l => rig.parts[l.i].tag !== 'flame').map(l => l.mesh.material)],
                light(on) { lit = on; for (const f of flames) f.visible = on && mesh.visible; },
                // Show the shield white (or not); false when there is no shield.
                flash(on) {
                    if (!blinker) return false;
                    blinker.on = on; blinker.box.visible = on && mesh.visible;
                    return true;
                },
                place(solved) {
                    boned.forEach((part, b) => bones[b].matrixWorld.fromArray(solved.parts[part]));
                    for (const { i, mesh: m } of loose) { m.matrix.fromArray(solved.parts[i]); m.matrixWorldNeedsUpdate = true; }
                    if (blinker) { blinker.box.matrix.fromArray(solved.bones[blinker.bone]).multiply(blinker.at); blinker.box.matrixWorldNeedsUpdate = true; }
                    for (const { i, line, grow } of lines) {
                        line.matrix.fromArray(solved.parts[i]);
                        if (grow) line.matrix.multiply(grown.makeScale(...grow));
                        line.matrixWorldNeedsUpdate = true;
                    }
                },
                show(visible) {
                    mesh.visible = visible;
                    for (const l of loose) l.mesh.visible = visible && (lit || rig.parts[l.i].tag !== 'flame');
                    for (const l of lines) l.line.visible = visible;
                    if (blinker) blinker.box.visible = visible && blinker.on;
                }
            };
        }
        // `fade`: what other bodies' colours fade by (render/world_view.js
        // sets it each frame from the hour's look).
        return { character, fade: bodyFade };
    }
    return { create };
})();
