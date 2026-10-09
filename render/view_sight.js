// The shade of sight for the world view (render/world_view.js): what this
// phone's fighter cannot see is shaded on the terrain. Drawing only: what
// is seen is decided by the simulation (core/terrain.js `sightFan`).
const viewSight = (() => {
    // The shade's colour and how far it goes (game_config.js graphics.shade).
    const SHADE = gameConfig.graphics.shade;
    // `stage`: what the world's parts share (render/world_view.js `build`).
    function create({ T, renderer, sim, ground }) {
        const C = gameConfig, U = C.world.unitsPerBlock, t = sim.terrain;
        // ---- ground masks: a fan of rays (terrainKit.sightFan) drawn from
        // straight above into a small texture, north up, and blurred along
        // and then across: white where the rays do not reach, soft at the
        // edge. `size` texels across the `2 * half` blocks round its middle.
        // The shade of sight is drawn with one. ----
        const BLUR = 1.1;
        // A nine-texel bell curve in five taps; `along` is one texel's step.
        const blur = new T.ShaderMaterial({
            uniforms: { map: { value: null }, along: { value: new T.Vector2() } }, depthTest: false, depthWrite: false,
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `uniform sampler2D map; uniform vec2 along; varying vec2 vUv;
void main() {
    float a = texture2D(map, vUv).g * 0.227027
        + (texture2D(map, vUv + along * 1.384615).g + texture2D(map, vUv - along * 1.384615).g) * 0.316216
        + (texture2D(map, vUv + along * 3.230769).g + texture2D(map, vUv - along * 3.230769).g) * 0.070270;
    gl_FragColor = vec4(a, a, a, 1.0);
}`
        });
        const pass = new T.Scene(), flat = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), full = new T.Mesh(new T.PlaneGeometry(2, 2), blur);
        full.frustumCulled = false; pass.add(full);
        const masks = [];
        function fanMask(size, half) {
            const geo = new T.BufferGeometry(), out = half * 1.5;
            let pos = null;
            const fanMesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide, fog: false }));
            fanMesh.frustumCulled = false;
            const above = new T.Scene(), eye = new T.OrthographicCamera(-half, half, half, -half, 0, 10);
            above.background = new T.Color('#000000'); above.add(fanMesh);
            eye.up.set(0, 0, -1); eye.position.set(0, 5, 0); eye.lookAt(0, 0, 0);
            const target = samples => new T.WebGLRenderTarget(size, size, { depthBuffer: false, samples });
            const drawnMask = target(4), blurred = [target(0), target(0)];
            const steps = [[drawnMask, eye, above, null], [blurred[0], flat, pass, [BLUR / size, 0, drawnMask]], [blurred[1], flat, pass, [0, BLUR / size, blurred[0]]]];
            // The fan round (x, z), blocks: between each ray and the next,
            // from where it ends out past the texture's edge.
            function draw(x, z, fan) {
                const n = fan.n;
                if (!pos || pos.length < fan.angle.length * 18) {
                    geo.dispose();
                    pos = new Float32Array(fan.angle.length * 18);
                    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
                }
                for (let i = 0, o = 0; i < n; i++) {
                    const j = (i + 1) % n, c0 = Math.cos(fan.angle[i]), s0 = Math.sin(fan.angle[i]), c1 = Math.cos(fan.angle[j]), s1 = Math.sin(fan.angle[j]);
                    const d0 = fan.reach[i] / U, d1 = fan.reach[j] / U;
                    const nx0 = x + c0 * d0, nz0 = z + s0 * d0, fx0 = x + c0 * out, fz0 = z + s0 * out;
                    const nx1 = x + c1 * d1, nz1 = z + s1 * d1, fx1 = x + c1 * out, fz1 = z + s1 * out;
                    pos[o++] = nx0; pos[o++] = 0; pos[o++] = nz0; pos[o++] = fx0; pos[o++] = 0; pos[o++] = fz0; pos[o++] = fx1; pos[o++] = 0; pos[o++] = fz1;
                    pos[o++] = nx0; pos[o++] = 0; pos[o++] = nz0; pos[o++] = fx1; pos[o++] = 0; pos[o++] = fz1; pos[o++] = nx1; pos[o++] = 0; pos[o++] = nz1;
                }
                geo.setDrawRange(0, n * 6);
                geo.attributes.position.needsUpdate = true;
                eye.position.set(x, 5, z);
                for (const [to, cam, what, from] of steps) {
                    if (from) { blur.uniforms.along.value.set(from[0], from[1]); blur.uniforms.map.value = from[2].texture; }
                    renderer.setRenderTarget(to); renderer.render(what, cam);
                }
                renderer.setRenderTarget(null);
            }
            const mask = { texture: blurred[1].texture, half, out, draw, dispose() { geo.dispose(); fanMesh.material.dispose(); for (const one of [drawnMask, ...blurred]) one.dispose(); } };
            masks.push(mask);
            return mask;
        }

        // ---- sight: what this fighter cannot see is shaded; walls at least
        // eye high cast the shade, and so does everything outside the front
        // arc it sees (player.sight, the hour's) but for a small ring round
        // it (user, 2026-10-04). The same in the adventure
        // and in a duel (user, 2026-10-04). The edge of sight comes exact
        // from the terrain (terrainKit.sightFan: rays past every wall
        // corner), so it slides evenly as the fighter walks; an even spread
        // of rays stepped along left the edge jumping from one ray to the
        // next. Sight is worked out as far as `SIGHT_FAR` blocks, which is
        // past the screen's edge; past the mask the shade takes the mask's
        // edge, which is past sight and so all shade.
        //
        // The shade's edge is soft (user, 2026-10-04; drawing only, what is
        // seen is decided as before): its mask is how far the terrain's
        // material goes towards `SHADE.color` (render/terrain_mesh.js),
        // `opacity` of the way at most. It is in the material, not a dark
        // sheet over the ground, so that what stands on the ground --
        // blocks, plants, stones -- goes dark with it (user, 2026-10-05). ----
        const SIGHT_FAR = 20, MASK = 256;
        const mask = fanMask(MASK, SIGHT_FAR), fan = { n: 0, angle: new Float64Array(0), reach: new Float64Array(0) };
        ground.sight.mask.value = mask.texture; ground.sight.at.value.set(0, 0, mask.half);
        ground.sight.tone.value.set(...SHADE.color.map(v => v / 255), SHADE.opacity);
        let lastX = NaN, lastZ = NaN, lastFacing = NaN, lastRev = -1, lastAngle = NaN, lastNear = NaN;
        // Recast only when the fighter has moved or turned, what it sees
        // (`seen`: { angle, near }, the hour's: dayKit.sight) has changed,
        // or the terrain has.
        function update(x, z, facing, seen) {
            if (x === lastX && z === lastZ && facing === lastFacing && lastRev === t.rev && seen.angle === lastAngle && seen.near === lastNear) return;
            lastX = x; lastZ = z; lastFacing = facing; lastRev = t.rev; lastAngle = seen.angle; lastNear = seen.near;
            terrainKit.sightFan(t, x * U, z * U, SIGHT_FAR * U, { facing, half: seen.angle, near: seen.near, out: fan });
            ground.sight.at.value.set(x, z, mask.half);
            mask.draw(x, z, fan);
        }
        // Shaded or not (not under the title screen's camera: drawing only).
        function show(on) { ground.sight.tone.value.w = on ? SHADE.opacity : 0; }
        // The masks' targets and the blur are in no scene.
        function dispose() {
            for (const one of masks) one.dispose();
            blur.dispose(); full.geometry.dispose();
        }
        return { update, show, dispose };
    }
    return { create };
})();
