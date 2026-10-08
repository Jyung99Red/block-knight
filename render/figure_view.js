// The menu's figure and the item icons (design.md 3.6, 7.3), drawn by a
// small renderer of their own, apart from the world's. The figure is the
// main character in what the bag says is worn, standing and breathing,
// turned by dragging; an icon is an item's own model (models/equipment.js)
// drawn once into a picture, so gear needs no picture files. The renderer
// is made on first use; without WebGL there is no figure and icons are
// null (the screens fall back to the item's emoji). Presentation only.
const figureView = (() => {
    // Icon pixels; half the picture's width in blocks for every weapon.
    const ICON = 96, BG = 0x000000, WEAPON_HALF = 0.55;
    let kit = null;
    function setup() {
        if (kit !== null) return kit;
        try {
            const T = THREE, canvas = document.createElement('canvas');
            canvas.className = 'figure-canvas';
            const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
            renderer.setClearColor(BG, 0);
            kit = { T, renderer, canvas, grain: renderTextures.create(T).grain, materials: new Map(), boxes: new Map(), sized: null };
        } catch (error) {
            console.error(error);
            kit = false;
        }
        return kit;
    }
    // Boxes carry 16 grain texels per block, like the world's characters.
    function box(w, h, d) {
        const key = `${w},${h},${d}`;
        if (!kit.boxes.has(key)) {
            const g = new kit.T.BoxGeometry(w, h, d), uv = g.attributes.uv;
            const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
            for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
            kit.boxes.set(key, g);
        }
        return kit.boxes.get(key);
    }
    function material(name, glow) {
        const key = `${name}${glow ? '!' : ''}`;
        if (!kit.materials.has(key)) {
            if (!palette[name]) throw new Error(`Unknown palette colour ${name}`);
            const m = new kit.T.MeshLambertMaterial({ color: palette[name], map: kit.grain });
            if (glow) m.emissive.set(palette[name]);
            kit.materials.set(key, m);
        }
        return kit.materials.get(key);
    }
    // A mesh per part `pick`ed, placed by matrices from core/rig.js;
    // `look` swaps palette colours by name.
    function meshes(rig, look, pick) {
        const out = [];
        rig.parts.forEach((part, i) => {
            if (!pick(part)) return;
            const mesh = new kit.T.Mesh(box(...part.size), material(look[part.color] || part.color, part.tag === 'flame'));
            mesh.matrixAutoUpdate = false;
            out.push({ i, mesh });
        });
        return out;
    }
    function lights(scene) {
        const T = kit.T;
        scene.add(new T.HemisphereLight(palette.skyLight, palette.groundLight, 2.2));
        const sun = new T.DirectionalLight(palette.sun, 2.4);
        sun.position.set(2, 4, 3);
        scene.add(sun);
    }

    // ---- the figure ----
    // { canvas, show(loadout), frame(time), turn(radians), size(w, h) }, or
    // null without WebGL.
    let figure = null;
    function figureOf() {
        if (figure || !setup()) return figure;
        const T = kit.T, scene = new T.Scene(), camera = new T.PerspectiveCamera(28, 1, 0.1, 50);
        lights(scene);
        let rig = null, loadout = null, parts = [], yaw = -0.45, width = 0, height = 0;
        function show(next) {
            const key = JSON.stringify(next);
            if (key === JSON.stringify(loadout)) return;
            for (const { mesh } of parts) scene.remove(mesh);
            loadout = { ...next };
            rig = rigKit.build(playerModel, { equipment: equipmentModels.forLoadout(loadout) });
            parts = meshes(rig, equipmentModels.lookOf(loadout), part => part.tag !== 'flame');
            for (const { mesh } of parts) scene.add(mesh);
        }
        function frame(time) {
            if (!rig || !width || !height) return;
            const body = { gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, stun: 0, loadout };
            const solved = rigKit.solve(rig, playerAnim.present(playerAnim.pose(rig, body), body, { time, lean: 0 }), [0, 0, 0], yaw);
            for (const { i, mesh } of parts) { mesh.matrix.fromArray(solved.parts[i]); mesh.matrixWorldNeedsUpdate = true; }
            // Resizing clears the canvas: only when the size has changed.
            const ratio = Math.min(window.devicePixelRatio || 1, 2), key = `${width}x${height}@${ratio}`;
            if (kit.sized !== key) { kit.renderer.setPixelRatio(ratio); kit.renderer.setSize(width, height, false); kit.sized = key; }
            kit.renderer.render(scene, camera);
        }
        // The camera stands back far enough for the whole figure, sword and
        // shield out to the sides, whatever the box's shape.
        const FIT = { height: 2.6, width: 2.1 };
        function size(w, h) {
            width = Math.round(w); height = Math.round(h);
            camera.aspect = width / Math.max(1, height);
            const tan = Math.tan(camera.fov * Math.PI / 360), d = Math.max(FIT.height / 2 / tan, FIT.width / 2 / tan / camera.aspect);
            camera.position.set(0, 0.92 + d * 0.09, d);
            camera.lookAt(0, 0.92, 0);
            camera.updateProjectionMatrix();
        }
        figure = { canvas: kit.canvas, show, frame, size, turn: radians => { yaw += radians; } };
        return figure;
    }

    // ---- icons ----
    // Hand items lie across the picture: blades from the lower left to the
    // upper right, a shield face on, a torch or flask upright. Armor is the
    // body's chest and upper arms in it.
    // Where the item's own x, y and z axes go (its z runs along it).
    const A = Math.SQRT1_2;
    const DIAGONAL = [[-A, A, 0], [0, 0, 1], [A, A, 0]], FACE_ON = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], UPRIGHT = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
    function itemMeshes(id) {
        const item = gameConfig.items[id], T = kit.T, group = new T.Group();
        if (item.slot === 'armor') {
            const rig = rigKit.build(playerModel, { equipment: equipmentModels.forLoadout({ armor: id }) }), solved = rigKit.solve(rig, {});
            const bones = new Set(['chest', 'upperArmR', 'upperArmL'].map(b => rig.index[b]));
            for (const { i, mesh } of meshes(rig, equipmentModels.lookOf({ armor: id }), part => bones.has(part.bone) && (part.owner === 'body' || part.owner === id))) {
                mesh.matrix.fromArray(solved.parts[i]);
                group.add(mesh);
            }
            group.rotation.set(0.25, -0.5, 0);
            return group;
        }
        const entries = equipmentModels.forLoadout({ [item.slot]: id });
        if (!entries.length) return null;
        const holder = new T.Group(), axes = item.weapon ? DIAGONAL : item.offhand === 'shield' ? FACE_ON : UPRIGHT;
        holder.matrixAutoUpdate = false;
        holder.matrix.makeBasis(...axes.map(v => new T.Vector3(...v)));
        for (const entry of entries) for (const part of entry.parts) {
            const mesh = new T.Mesh(box(...part.size), material(part.color, part.tag === 'flame'));
            mesh.position.set(...part.at);
            holder.add(mesh);
        }
        group.add(holder);
        group.rotation.set(item.offhand === 'shield' ? 0.15 : 0.35, item.offhand === 'shield' ? -0.45 : 0.3, 0);
        return group;
    }
    const icons = new Map();
    // An item's picture as a data: URL, or null (no model, or no WebGL).
    function icon(id) {
        if (icons.has(id)) return icons.get(id);
        let url = null;
        if (gameConfig.items[id]?.slot && setup()) {
            try { url = draw(id); } catch (error) { console.error(error); }
        }
        icons.set(id, url);
        return url;
    }
    function draw(id) {
        const group = itemMeshes(id);
        if (!group) return null;
        const T = kit.T, scene = new T.Scene();
        lights(scene);
        scene.add(group);
        scene.updateMatrixWorld(true);
        // An orthographic camera fitted round the item, a margin left.
        const bounds = new T.Box3().setFromObject(group), centre = bounds.getCenter(new T.Vector3()), extent = bounds.getSize(new T.Vector3());
        // Weapons share one scale, so a short blade looks short.
        const fitted = Math.max(extent.x, extent.y) / 2 * 1.12, half = gameConfig.items[id].weapon ? Math.max(fitted, WEAPON_HALF) : fitted;
        const camera = new T.OrthographicCamera(-half, half, half, -half, 0.1, 20);
        camera.position.set(centre.x, centre.y, centre.z + 5);
        camera.lookAt(centre);
        const r = kit.renderer, size = new T.Vector2();
        r.getSize(size);
        const ratio = r.getPixelRatio();
        r.setPixelRatio(1); r.setSize(ICON, ICON, false);
        r.render(scene, camera);
        const url = kit.canvas.toDataURL('image/png');
        // Back to the figure's size; its next frame redraws it.
        r.setPixelRatio(ratio); r.setSize(size.x, size.y, false);
        kit.sized = null;
        return url;
    }
    return { figure: figureOf, icon };
})();
