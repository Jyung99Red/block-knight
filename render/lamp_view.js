// The torches that stand in a map (core/props.js `lamp`; models/props.js
// `lamps`): on a stand, or on a wall's face. All of them are one mesh, their
// flames one more (a few bright cubes each, licking). They always burn;
// `lights` is where each one's light is ([x, y, z], blocks) for the moving
// lights and the block light (render/view_light.js); `posts`, their mesh
// (none with no torch in the map). Drawn only.
const lampView = (() => {
    const FLAMES = 2;
    // `material`: the lit material for the posts (vertex colours).
    function create(T, scene, sim, material) {
        const P = palette, lamps = sim.entities.filter(e => e.type === 'lamp'), lights = [];
        if (!lamps.length) { material.dispose(); return { lights, posts: null, update() {} }; }
        const pos = [], nor = [], uv = [], col = [], index = [], colour = new T.Color(), turn = new T.Matrix4(), flames = [];
        for (const e of lamps) {
            const model = propModels.lamps[e.kind], [x, , z] = space.toBlocks(e.x, e.y), [dx, dz] = e.side ? propKit.DIRS[e.side] : [0, 0];
            // A wall torch stands out of its wall's face, half a block from the cell's middle.
            turn.makeRotationY(e.side ? Math.atan2(-dx, -dz) : 0).setPosition(x + dx * 0.5, 0, z + dz * 0.5);
            for (const part of model.parts) {
                if (!P[part.color]) throw new Error(`Unknown palette colour ${part.color}`);
                const g = new T.BoxGeometry(...part.size).translate(...part.at).applyMatrix4(turn), base = pos.length / 3;
                colour.set(P[part.color]);
                pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
                for (let k = 0; k < g.attributes.position.count; k++) col.push(colour.r, colour.g, colour.b);
                for (const k of g.index.array) index.push(base + k);
                g.dispose();
            }
            const at = new T.Vector3(...model.flame).applyMatrix4(turn);
            flames.push({ at, seed: e.col * 0.9 + e.row * 1.3 });
            lights.push({ at: at.toArray(), seed: e.col * 3 + e.row });
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        geometry.setIndex(index);
        const posts = new T.Mesh(geometry, material);
        posts.castShadow = true; posts.receiveShadow = true;
        scene.add(posts);
        const fire = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), flames.length * FLAMES);
        fire.frustumCulled = false;
        scene.add(fire);
        const place = new T.Object3D(), tint = new T.Color();
        function update(clock) {
            let n = 0;
            for (const { at, seed } of flames) for (let k = 0; k < FLAMES; k++, n++) {
                const a = k * 1.7 + seed, lick = 0.5 + 0.5 * Math.sin(clock * (9 + 2 * k) + a), size = k ? 0.1 + 0.05 * lick : 0.16 + 0.04 * lick;
                place.position.set(at.x, at.y + (k ? 0.12 + 0.06 * lick : 0), at.z);
                place.rotation.set(0, a + clock * (k ? 2 : 1), 0); place.scale.setScalar(size); place.updateMatrix();
                fire.setMatrixAt(n, place.matrix); fire.setColorAt(n, tint.set(k ? P.flameTip : P.flame));
            }
            fire.instanceMatrix.needsUpdate = true;
            if (fire.instanceColor) fire.instanceColor.needsUpdate = true;
        }
        update(0);
        return { lights, posts, update };
    }
    return { create };
})();
