// The world's light and the time of day (render/world_view.js): the sky's
// light, the sun (or the moon) where the hour puts it and its shadows, the
// torch's light and its shadows, the moving lights (a torch that stands in
// the map is one; the nearest of those cast shadows too), the light at a
// cave's doors; each frame, the hour's
// light on everything, what the ground gives back, the ponds' sky, where
// the torch's light goes and what gives block light. Drawing only.
const viewLight = (() => {
    const UP = [0, 1, 0];
    // The picture's tunable numbers are game_config.js `graphics` (what
    // each is for is written there): the looks' light, a region's own day
    // look, the sun's steps and soft edge, the torch, a fire, a torch that
    // stands in the map, a doorway, block light, bounce, the ponds' sky.
    const {
        looks: LIGHT, dayLook: LOOK, sunStep: SUN_STEP, sunSoft: SUN_SOFT, torch: TORCH, fire: FIRE, lamp: LAMP, doorway: DOORWAY,
        glow: GLOW, bounce: BOUNCE, waterSky: WATER_SKY
    } = gameConfig.graphics;
    // Is the point (blocks) inside a block of the terrain (or off the map)?
    function inBlock(t, [x, y, z]) {
        const c = Math.floor(x), r = Math.floor(z);
        return !terrainKit.inside(t, c, r) || (terrainKit.solidAt(t, c, r) && y < terrainKit.levelAt(t, c, r));
    }
    // Is the point inside one of `bodies` ([x, z, radius, top], blocks: upright cylinders)?
    const inBody = (bodies, [x, y, z]) => bodies.some(([bx, bz, r, top]) => y < top && (x - bx) ** 2 + (z - bz) ** 2 < r * r);
    // The last point going from `from` to `to` that is not inside a block
    // (or one of `bodies`), tried every fiftieth of a block or nearer.
    function clearOf(t, from, to, bodies = []) {
        const steps = Math.max(12, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * 50));
        let last = from;
        for (let k = 1; k <= steps; k++) {
            const at = from.map((v, i) => v + (to[i] - v) * k / steps);
            if (inBlock(t, at) || inBody(bodies, at)) break;
            last = at;
        }
        return last;
    }

    // A vector ([x, y, z]) turned by `yaw` about the upright axis, as a rig's root is (core/rig.js).
    const turned = (v, yaw) => math3d.transformDirection(math3d.compose(0, 0, 0, 0, yaw, 0), v);
    // A torch's light is this far above the middle of its flame's box (blocks).
    const FLAME_UP = 0.15;
    // Where a skeleton's flame is while the torch is only carried: the
    // bearer standing, in its own frame ([x, y, z], blocks, the light's
    // FLAME_UP up). Worked out once a skeleton; `loadout`: what it carries.
    const carried = new WeakMap();
    function carriedAt(rig, loadout) {
        if (!carried.has(rig)) {
            const m = rigKit.solve(rig, playerAnim.pose(rig, { gait: 0, moveBlend: 0, runBlend: 0, loadout })).parts[rig.parts.findIndex(part => part.tag === 'flame')];
            carried.set(rig, [m[12], m[13] + FLAME_UP, m[14]]);
        }
        return carried.get(rig);
    }

    // `stage`: what the world's parts share (render/world_view.js `build`).
    function create({ T, scene, sim, selfId, tune, dark, ground }) {
        const C = gameConfig, P = palette, U = C.world.unitsPerBlock;
        // A dark region's light is the `dark` look at every hour.
        const dayLook = LOOK[sim.region] || 'day';
        const lookOf = name => LIGHT[dark ? 'dark' : name === 'day' ? dayLook : name];
        // The light now, a blend of two looks: intensities, the four
        // colours, fog, the torch, the shadows' darkness; `outside`, how
        // much of it is day (0 at night), for the light at a cave's doors.
        const now = { sky: 0, sun: 0, fog: [0, 0], torch: 0, shadow: 1, fade: [0, 0], outside: 1, colors: [0, 1, 2, 3].map(() => new T.Color()) };
        const other = new T.Color();
        function blend(hour) {
            const l = dayKit.look(hour), a = lookOf(l.from), b = lookOf(l.to), u = l.mix, mix = (p, q) => p + (q - p) * u;
            for (const k of ['sky', 'sun', 'torch', 'shadow']) now[k] = mix(a[k], b[k]);
            for (const k of ['fog', 'fade']) { now[k][0] = mix(a[k][0], b[k][0]); now[k][1] = mix(a[k][1], b[k][1]); }
            now.colors.forEach((c, i) => c.set(P[a.colors[i]]).lerp(other.set(P[b.colors[i]]), u));
            now.outside = dayKit.daylight(hour);
        }
        blend(dayKit.hourOf(sim, tune.hourShift));
        const sky = now.colors[3].clone();
        scene.background = sky;
        scene.fog = new T.Fog(sky, C.camera.distance + now.fog[0], C.camera.distance + now.fog[1]);
        // The shadows' maps follow the menu's settings. The torch's keep
        // its light from passing walls (user, 2026-10-06). A shadow map of
        // a new size is made anew on the next frame.
        function retune() {
            sun.castShadow = !dark;
            const resize = (shadow, size) => {
                if (shadow.mapSize.x === size) return false;
                shadow.mapSize.set(size, size);
                if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
                return true;
            };
            // (The texel and the radii whether the size changed or not: a
            // light's map is 512 a side to begin with, the saver quality's
            // sun's on a phone and the ultra quality's torch's.)
            resize(sun.shadow, tune.sunMap);
            texel = 2 * extent / tune.sunMap;
            sun.shadow.radius = Math.max(1, SUN_SOFT / texel);
            resize(torchLight.shadow, tune.torchMap);
            torchLight.shadow.radius = TORCH.soft * tune.torchMap;
            for (const c of casters) {
                if (resize(c.light.shadow, tune.torchMap)) c.light.shadow.needsUpdate = true;
                c.light.shadow.radius = TORCH.soft * tune.torchMap;
            }
        }

        const hemisphere = new T.HemisphereLight(now.colors[0], now.colors[1], now.sky);
        scene.add(hemisphere);
        const sun = new T.DirectionalLight(now.colors[2], now.sun), extent = C.graphics.shadowExtent;
        // The torch's light: always there (lights coming and going would
        // rebuild every shader), at zero while no torch burns, its shadow
        // map then not redrawn. Then the moving lights without shadows:
        // as many as the world has things that give light -- a burning
        // thicket, a doorway's glow, someone else's torch, a torch that
        // stands in the map (user, 2026-10-09: no limit) -- less the
        // standing torches' that cast. Each frame they go to what gives
        // light and can fall on the picture (`frame`), the nearest first,
        // and the rest of them are at zero.
        // (Its shadow map's size and softness: `retune`.)
        const torchLight = new T.PointLight(P.flame, 0, TORCH.reach, TORCH.decay);
        torchLight.castShadow = true;
        // A point light's shadow bias as its shadow map has it, in depth:
        // TORCH.bias is in one over blocks, and the map's depth goes as
        // near times far over (far less near), over the distance.
        const depthBias = (near, far) => -TORCH.bias * near * far / (far - near);
        Object.assign(torchLight.shadow.camera, { near: TORCH.near, far: TORCH.reach });
        torchLight.shadow.bias = depthBias(TORCH.near, TORCH.reach); torchLight.shadow.normalBias = TORCH.normalBias;
        scene.add(torchLight);
        // The standing torches' shadows (LAMP.shadow; user, 2026-10-07):
        // so many lights that cast (the quality's lampShadows), each for
        // one of the nearest standing torches that are lit; any other
        // standing torch has one of the moving lights below, as before.
        // Their shadow maps are the torch's in size and softness (`retune`)
        // and are drawn anew only when `kindle` says so. Each: `lamp`, the
        // standing torch it lights now (render/lamp_view.js `lights`);
        // `strength`, how far its shadows have come, 0..1; `drawn`, its
        // shadow map is that torch's; `stale`, for how many frames it has
        // waited to be drawn anew; `near`, something moved by it last
        // frame; `age`, seconds since it was drawn; `rev`, the terrain's
        // revision then. (They are added after the torch's light: the
        // shaders tell them from it by their order, render/view_shaders.js.)
        const SHADE = LAMP.shadow;
        // (Nothing stands nearer a standing torch's light than this, blocks.)
        const LAMP_NEAR = 0.05;
        const casters = Array.from({ length: tune.built.lampShadows }, () => {
            const light = new T.PointLight(P.flame, 0, LAMP.reach, LAMP.decay);
            light.castShadow = true;
            light.shadow.camera.near = LAMP_NEAR;
            light.shadow.bias = depthBias(LAMP_NEAR, LAMP.reach); light.shadow.normalBias = TORCH.normalBias;
            // (Drawn at least once, as the torch's.)
            light.shadow.autoUpdate = false; light.shadow.needsUpdate = true;
            scene.add(light);
            return { light, lamp: null, strength: 0, drawn: false, stale: 0, near: false, age: 0, rev: -1 };
        });
        // (A doorway's glow only in a dark region: `doorways`, below.)
        const doorways = dark ? sim.entities.filter(e => e.type === 'portal').map(e => space.toBlocks(e.x + Math.cos(e.facing) * DOORWAY.inside * U, e.y + Math.sin(e.facing) * DOORWAY.inside * U, 0)).map(([x, , z]) => [x, DOORWAY.height, z]) : [];
        const lampCount = sim.entities.filter(e => e.type === 'lamp').length;
        const gives = lampCount + sim.entities.filter(e => e.type === 'brush').length + doorways.length + Math.max(0, sim.fighters.length - 1);
        const pool = Array.from({ length: Math.max(0, gives - Math.min(casters.length, lampCount)) }, () => {
            const light = new T.PointLight('#ffffff', 0, 1, 1);
            scene.add(light);
            return light;
        });
        const glowColour = new T.Color();
        // All of `glowing` ({ at: [x, y, z], color, intensity, reach,
        // decay; lamp: the standing torch it is, if one }, blocks) are
        // lit, the nearest to `me` first. Of the standing torches among
        // them the nearest have the lights that cast, the rest of what is
        // lit the moving lights. A standing
        // torch's shadows come and go over SHADE.fade seconds as it gets
        // and loses its turn (a world's first frame shows them whole);
        // while they go, the one that takes its turn waits unshadowed.
        // Its shadow map is drawn anew when it gets the light, when the
        // terrain has changed, while something of `stirring` ([x, z],
        // blocks: what moves) is within SHADE.margin of its reach and
        // once more when that has left, and every SHADE.refresh seconds
        // for whatever else changed -- one light's a frame at most, the
        // one that has waited longest.
        let begun = false;
        function kindle(glowing, me, frameSeconds, stirring, rev) {
            const [x, , z] = space.toBlocks(me.x, me.y, me.h), far = g => (g.at[0] - x) ** 2 + (g.at[2] - z) ** 2;
            glowing.sort((a, b) => far(a) - far(b));
            const lit = glowing, holder = lamp => casters.find(c => c.lamp === lamp), litAs = c => c.lamp && lit.find(g => g.lamp === c.lamp);
            // Whose turn: one that casts already keeps it against one less than SHADE.keep blocks nearer.
            const turn = lit.filter(g => g.lamp).map(g => [g.lamp, Math.sqrt(far(g)) - (holder(g.lamp) ? SHADE.keep : 0)])
                .sort((a, b) => a[1] - b[1]).slice(0, casters.length).map(([lamp]) => lamp);
            for (const c of casters) {
                if (!c.lamp || turn.includes(c.lamp)) continue;
                c.strength = litAs(c) ? Math.max(0, c.strength - frameSeconds / SHADE.fade) : 0;
                if (!c.strength) c.lamp = null;
            }
            for (const lamp of turn) {
                const free = !holder(lamp) && casters.find(c => !c.lamp);
                if (!free) continue;
                Object.assign(free, { lamp, strength: 0, drawn: false });
                free.light.position.set(...lamp.at);
            }
            const within = (LAMP.reach + SHADE.margin) ** 2;
            for (const c of casters) {
                if (!c.lamp) continue;
                const near = stirring.some(([sx, sz]) => (sx - c.lamp.at[0]) ** 2 + (sz - c.lamp.at[2]) ** 2 < within);
                c.age += frameSeconds;
                if (c.stale || !c.drawn || near || c.near || c.rev !== rev || c.age >= SHADE.refresh) c.stale++;
                c.near = near;
            }
            const waiting = casters.filter(c => c.lamp && c.stale).sort((a, b) => (a.drawn - b.drawn) || (b.stale - a.stale));
            for (const c of begun ? waiting.slice(0, 1) : waiting) {
                c.light.shadow.needsUpdate = true;
                Object.assign(c, { drawn: true, stale: 0, age: 0, rev });
            }
            for (const c of casters) {
                const g = litAs(c);
                if (!g) { c.light.intensity = 0; continue; }
                if (c.drawn && turn.includes(c.lamp)) c.strength = begun ? Math.min(1, c.strength + frameSeconds / SHADE.fade) : 1;
                c.light.color.set(g.color); c.light.intensity = g.intensity; c.light.shadow.intensity = c.strength;
            }
            const rest = lit.filter(g => !(g.lamp && holder(g.lamp)));
            pool.forEach((light, i) => {
                const g = rest[i];
                if (!g) { light.intensity = 0; return; }
                light.position.set(...g.at); light.color.set(g.color);
                light.intensity = g.intensity; light.distance = g.reach; light.decay = g.decay;
            });
            begun = true;
        }
        // The bearer's own body in its torch's light (user, 2026-10-07).
        // The light is where the torch is carried, outside the body, which
        // so casts its shadow as anything does. Only where a wall or
        // another body holds the light back (`frame`) is it in by the
        // bearer's middle, where the body could only shut it in: then,
        // while the torch's shadows are drawn, `meshes` (the body) are
        // drawn moved by `flameShift`, from where the light would be to
        // where it is -- to the light they then stand as they would have,
        // and the shadow falls much as it did. In any other light the body
        // casts where it stands.
        const flameShift = new T.Vector3(), stood = new T.Matrix4();
        function flameLit(meshes) {
            const torch = torchLight.shadow.camera;
            for (const mesh of meshes) {
                // (Moved, it is not where its bounds say.)
                mesh.frustumCulled = false;
                mesh.onBeforeShadow = (renderer, object, camera, shadowCamera) => {
                    if (shadowCamera !== torch) return;
                    stood.copy(object.matrixWorld);
                    const e = object.matrixWorld.elements;
                    e[12] += flameShift.x; e[13] += flameShift.y; e[14] += flameShift.z;
                    object.modelViewMatrix.multiplyMatrices(shadowCamera.matrixWorldInverse, object.matrixWorld);
                };
                mesh.onAfterShadow = (renderer, object, camera, shadowCamera) => { if (shadowCamera === torch) object.matrixWorld.copy(stood); };
            }
        }
        // `meshes` cast no shadow in the light of `lights` (point lights),
        // and as ever in any other: for a point light's shadows they have
        // a material of their own, which writes nothing while those
        // lights' shadows are drawn.
        const shy = [];
        function shun(meshes, lights) {
            const cameras = lights.map(l => l.shadow.camera), material = new T.MeshDistanceMaterial();
            shy.push(material);
            for (const mesh of meshes) {
                mesh.customDistanceMaterial = material;
                mesh.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry, depthMaterial) => {
                    if (depthMaterial === material) material.depthWrite = material.colorWrite = !cameras.includes(shadowCamera);
                };
            }
        }
        Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 60 });
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
        scene.add(sun, sun.target);
        // The sun (or the moon) goes where the hour puts it (dayKit.sky);
        // its shadow box follows what the screen shows (`placeSun`: the
        // middle of its ground, render/world_view.js), snapped to whole shadow texels
        // in the light's frame so edges do not shimmer while walking.
        const lightDir = new T.Vector3(), lightRight = new T.Vector3(), lightUp = new T.Vector3(), upward = new T.Vector3(...UP);
        let aimedAt = NaN;
        function aim(hour) {
            const stepped = Math.round(hour / SUN_STEP) * SUN_STEP;
            if (stepped === aimedAt) return;
            aimedAt = stepped;
            lightDir.set(...dayKit.sky(stepped).dir);
            lightRight.crossVectors(upward, lightDir).normalize();
            lightUp.crossVectors(lightDir, lightRight);
        }
        // One texel of the sun's shadow map, blocks (`retune`).
        let texel = 1;
        const focus = new T.Vector3();
        // (`placed`: where its shadow box is now, across the light: `settle`.)
        const placed = { u: NaN, v: NaN };
        function placeSun(x, y, z) {
            focus.set(x, y, z);
            const u = Math.round(focus.dot(lightRight) / texel) * texel, v = Math.round(focus.dot(lightUp) / texel) * texel, w = focus.dot(lightDir);
            sun.target.position.copy(lightRight).multiplyScalar(u).addScaledVector(lightUp, v).addScaledVector(lightDir, w);
            sun.position.copy(sun.target.position).addScaledVector(lightDir, 25);
            placed.u = u; placed.v = v;
        }
        // The sun's and the carried torch's shadow maps are drawn anew
        // only when what they show has changed, as the standing torches'
        // are (`kindle`); a map left as it is goes on being looked up
        // where it was drawn from, so the shadows stay where they lie.
        // Called once everything is placed for the frame. `moved`: where
        // what casts a shadow has moved this frame ([x, z] each, blocks:
        // render/view_bodies.js `motion`); `rev`: the terrain's revision.
        // The sun's: when its box has gone a texel on or the sun a step
        // (`placeSun`, `aim`), the terrain has changed, or anything
        // moved this frame or the last. The torch's, while it burns: when
        // it is lit, its light has gone TORCH_DRIFT blocks from where the
        // map was drawn from, the terrain has changed, or something moved
        // within SHADE.margin of its reach, this frame or the last. Both
        // every SHADE.refresh seconds besides, for what moves too slowly
        // to count (a body at rest breathes). A map not made yet is drawn
        // (one never drawn is no texture, and nothing lit would draw).
        const TORCH_DRIFT = 0.01;
        sun.shadow.autoUpdate = false; torchLight.shadow.autoUpdate = false;
        const sunMap = { u: NaN, v: NaN, aimed: NaN, rev: -1, age: 0, stirred: false };
        const torchMap = { at: new T.Vector3(), rev: -1, age: 0, stirred: false, burning: false };
        // Does this phone's fighter's torch burn (`frame`)?
        let burning = false;
        function settle(moved, rev, frameSeconds) {
            const stirred = moved.length > 0;
            sunMap.age += frameSeconds;
            if (!sun.shadow.map || stirred || sunMap.stirred || sunMap.u !== placed.u || sunMap.v !== placed.v || sunMap.aimed !== aimedAt || sunMap.rev !== rev || sunMap.age >= SHADE.refresh) {
                sun.shadow.needsUpdate = true;
                Object.assign(sunMap, { u: placed.u, v: placed.v, aimed: aimedAt, rev, age: 0 });
            }
            sunMap.stirred = stirred;
            const at = torchLight.position, within = (TORCH.reach + SHADE.margin) ** 2;
            const near = burning && moved.some(([x, z]) => (x - at.x) ** 2 + (z - at.z) ** 2 < within);
            torchMap.age += frameSeconds;
            if (!torchLight.shadow.map || (burning && (!torchMap.burning || near || torchMap.stirred || torchMap.rev !== rev || torchMap.age >= SHADE.refresh || at.distanceToSquared(torchMap.at) > TORCH_DRIFT ** 2))) {
                torchLight.shadow.needsUpdate = true;
                torchMap.at.copy(at); torchMap.rev = rev; torchMap.age = 0;
            }
            torchMap.stirred = near; torchMap.burning = burning;
        }
        // The hour's light on everything: the sky's, the sun's or the moon's
        // (fading in after it rises and out before it sets), the fog and
        // what is seen past the map (`mists`: the materials of the mist
        // under a map with a cliff, render/world_view.js).
        const mists = [];
        function daylight(hour) {
            blend(hour);
            aim(hour);
            hemisphere.color.copy(now.colors[0]); hemisphere.groundColor.copy(now.colors[1]); hemisphere.intensity = now.sky;
            sun.color.copy(now.colors[2]); sun.intensity = now.sun * (dark ? 1 : dayKit.sky(hour).fade);
            sun.shadow.intensity = now.shadow;
            sky.copy(now.colors[3]); scene.fog.color.copy(sky);
            for (const m of mists) m.color.copy(sky);
            const d = tune.distance * tune.zoom;
            scene.fog.near = d + now.fog[0]; scene.fog.far = d + now.fog[1];
        }

        // Each torch's light's way out from its bearer towards the flame, eased (TORCH).
        const torchOffsets = new Map();
        // Where each fighter's boxes were a frame ago ([x, y, z], blocks), to tell one that moves.
        const spots = new Map();
        const bounceLight = [0, 0, 0];
        // Each frame: the hour's light, what the ground gives back, the
        // ponds' sky, the torch's light and the moving lights, block light.
        // `drawn`: the fighters drawn this frame (render/world_view.js);
        // `shownOf`: a body as shown; `lamps`: where the torches that stand
        // in the map have their light (render/lamp_view.js `lights`);
        // `stirring`: where the props that move are ([x, z], blocks;
        // render/view_props.js); `near`: what the lights nearest to are lit
        // for ({ x, y, h }, world units; the fighter, or what the title
        // screen's camera looks at); `picture`: what the fighter's camera
        // shows ({ look: [x, z], yaw, view }: core/space.js `sight`), or
        // null where it is not worked out (the title screen: all of the
        // lights are lit). A light that cannot reach the picture is out.
        function frame(current, { me, near = me, picture = null, drawn, shownOf, clock, frameSeconds, lamps = [], stirring = [] }) {
            // The hour's light.
            const hour = dayKit.hourOf(current, tune.hourShift);
            daylight(hour);
            // The ground and the walls give back the hour's light, their
            // colour (render/terrain_light.js, the probes): the sky's and
            // the sun's (or the moon's) as it falls on open ground.
            const up = Math.max(0, lightDir.y);
            bounceLight[0] = (hemisphere.color.r * hemisphere.intensity + sun.color.r * sun.intensity * up) * BOUNCE;
            bounceLight[1] = (hemisphere.color.g * hemisphere.intensity + sun.color.g * sun.intensity * up) * BOUNCE;
            bounceLight[2] = (hemisphere.color.b * hemisphere.intensity + sun.color.b * sun.intensity * up) * BOUNCE;
            ground.bounce(bounceLight);
            // The ponds give back the sky as the hour lights it, and ripple.
            ground.water.time.value = clock;
            ground.water.sky.value.copy(now.colors[3]).multiplyScalar(now.sky * WATER_SKY);
            ground.water.horizon.value.copy(now.colors[3]).lerp(now.colors[0], 0.5).multiplyScalar(now.sky * WATER_SKY);
            // The torch light (TORCH), flickering a little: where the flame
            // is while the torch is only carried (`carriedAt`: beside the
            // bearer, turning with the body and not with the arm), and
            // `follow` of the flame's way from there, eased -- short of any
            // block or body on the way out from the bearer's middle, or the
            // light would be shut inside it (a wall's near side would go
            // dark, a monster's shadow turn all about). Anyone else's
            // burning torch is one of the moving lights. `shift`, if given,
            // is set to how far the light was held back (`flameLit`).
            const flicker = k => 1 + 0.08 * Math.sin(clock * 13 + k) + 0.05 * Math.sin(clock * 23.7 + 2 * k);
            const standing = [];
            const stand = (b, top) => { const [x, , z] = space.toBlocks(b.x, b.y); standing.push([x, z, b.radius / U + TORCH.clear, top]); };
            for (const d of drawn) stand(d.shown, 1.9);
            if (current.dummy) stand(current.dummy, 1.95);
            for (const m of current.monsters) if (m.phase !== 'dead') stand(shownOf(m), monsterKit.height(m.kind));
            const flameOf = (d, shift = null) => {
                const m = d.solved.parts[d.rig.parts.findIndex(part => part.tag === 'flame')];
                const root = space.toBlocks(d.shown.x, d.shown.y, d.shown.h), yaw = space.yawOf(d.shown.facing), rest = carriedAt(d.rig, d.body.loadout);
                // The flame's way from where it is carried, in the bearer's own frame.
                const flame = turned([m[12] - root[0], m[13] + FLAME_UP - root[1], m[14] - root[2]], -yaw), want = flame.map((v, i) => (v - rest[i]) * TORCH.follow);
                let off = torchOffsets.get(d.id);
                if (!off) torchOffsets.set(d.id, off = want);
                else for (let i = 0; i < 3; i++) off[i] += (want[i] - off[i]) * Math.min(1, frameSeconds * TORCH.ease);
                const to = turned(rest.map((v, i) => v + off[i]), yaw).map((v, i) => v + root[i]);
                const others = standing.filter((_, i) => i >= drawn.length || drawn[i] !== d);
                const at = clearOf(current.terrain, [root[0], root[1] + TORCH.height, root[2]], to, others);
                if (shift) shift.set(at[0] - to[0], at[1] - to[1], at[2] - to[2]);
                return at;
            };
            const bearer = drawn.find(d => d.id === selfId && d.body.lit);
            if (bearer) {
                torchLight.position.set(...flameOf(bearer, flameShift));
                torchLight.intensity = now.torch * flicker(0);
            } else torchLight.intensity = 0;
            // (Its shadow map is drawn only while it burns: `settle`.)
            burning = !!bearer;
            const glowing = [];
            // Block light from the same sources, in steps of a tenth.
            const glows = [], tenth = v => Math.round(v * 10) / 10, rgbOf = (color, k) => glowColour.set(color).toArray().map(v => tenth(v * k));
            if (bearer) glows.push({ at: torchLight.position.toArray(), reach: GLOW.torch, rgb: rgbOf(P.flame, 1) });
            for (const d of drawn) if (d.id !== selfId && d.body.lit) {
                const at = flameOf(d);
                glowing.push({ at, color: P.flame, intensity: now.torch * flicker(d.solved.parts.length), reach: TORCH.reach, decay: TORCH.decay });
                glows.push({ at, reach: GLOW.torch, rgb: rgbOf(P.flame, 1) });
            }
            for (const e of current.entities) {
                if (e.type !== 'brush' || e.burning < 0) continue;
                const [x, , z] = space.toBlocks(e.x, e.y), life = Math.max(0, 1 - e.burning / C.props.burnSeconds);
                glowing.push({ at: [x, FIRE.height, z], color: P.flame, intensity: FIRE.intensity * Math.sqrt(life) * flicker(e.col * 3 + e.row), reach: FIRE.reach, decay: FIRE.decay });
                glows.push({ at: [x, FIRE.height, z], reach: GLOW.fire, rgb: rgbOf(P.flame, Math.sqrt(life)) });
            }
            for (const l of lamps) {
                glowing.push({ at: l.at, color: P.flame, intensity: now.torch * LAMP.light * flicker(l.seed), reach: LAMP.reach, decay: LAMP.decay, lamp: l });
                glows.push({ at: l.at, reach: LAMP.glow, rgb: rgbOf(P.flame, LAMP.light) });
            }
            const door = DOORWAY.night + (1 - DOORWAY.night) * now.outside;
            for (const at of doorways) {
                const color = other.set(P.moon).lerp(glowColour.set(P.skyLight), now.outside).getHex();
                glowing.push({ at, color, intensity: DOORWAY.intensity * door, reach: DOORWAY.reach, decay: DOORWAY.decay });
                glows.push({ at, reach: GLOW.doorway, rgb: rgbOf(color, GLOW.door * door) });
            }
            // What moves, for the standing torches' shadows: those props,
            // the dummy and every monster (a fallen one sinks), and a
            // fighter with a box that is not where it was (slower than
            // SHADE.still it is at rest: breathing shows in no shadow).
            const moving = [...stirring], where = b => { const [bx, , bz] = space.toBlocks(b.x, b.y); return [bx, bz]; };
            if (current.dummy) moving.push(where(current.dummy));
            for (const m of current.monsters) moving.push(where(shownOf(m)));
            const least = SHADE.still * Math.max(frameSeconds, 1 / 120);
            for (const d of drawn) {
                const was = spots.get(d.id), at = d.solved.parts.map(m => [m[12], m[13], m[14]]);
                if (!was || was.length !== at.length || at.some((v, i) => Math.abs(v[0] - was[i][0]) + Math.abs(v[1] - was[i][1]) + Math.abs(v[2] - was[i][2]) > least)) moving.push(where(d.shown));
                spots.set(d.id, at);
            }
            // (The block light is the same for all of them, seen or not: a
            // cell's glow is a texel.)
            kindle(picture ? glowing.filter(g => space.pictureReaches(picture.look, picture.yaw, picture.view, g.at[0], g.at[2], g.reach)) : glowing, near, frameSeconds, moving, current.terrain.rev);
            ground.glow(glows, now.torch * GLOW.power);
        }
        // (The shadow maps are the lights' own render targets.)
        function dispose() {
            sun.dispose(); torchLight.dispose();
            for (const light of pool) light.dispose();
            for (const c of casters) c.light.dispose();
            for (const material of shy) material.dispose();
        }
        return {
            now, sky, mists, retune, frame, placeSun, settle, dispose,
            // `meshes`: the torch's bearer's own body, which casts its
            // shadow as the flame does; the standing torches' posts, which
            // cast none in their own light.
            flameLit,
            shunLamps: meshes => shun(meshes, casters.map(c => c.light))
        };
    }
    return { create };
})();
