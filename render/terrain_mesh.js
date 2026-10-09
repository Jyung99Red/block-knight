// Terrain drawn in 16 x 16 chunks (design.md 2.5, 6.1): each
// chunk is one mesh of only the block faces that can be seen (a face
// against another block is left out), textured from one atlas, so a chunk
// is one draw and a change rebuilds only the chunks it touched (their
// revision moved: core/terrain.js `set`). Tree crowns, roofs and portal
// lintels are drawn-only blocks ("decor") worked out from the trees and the
// buildings and portals; flowers and tufts are baked in too. Faces darken
// in the corners where they meet other blocks -- the ground at the foot of
// a wall, a wall at its foot and in its inside corners, a crown under its
// own leaves (corner shading, baked into the vertex colours) -- and each
// block gets a slight shade of its own. How much of the sky each face sees
// dims the sky's light on it (render/terrain_light.js; a vertex attribute
// of its own, `sky`, that only the sky's light is multiplied by). The map's floor goes on under the
// blocks, so it is what shows where the camera's cut opens a wall.
// Presentation only: nothing here is judged.
//
// The material cuts a hole where blocks stand between the camera and the
// player (`cut`): fragments in a cylinder round the line from the camera to
// the player's chest, on the camera's side of the player along the ground,
// are dropped in a dither pattern, so the player shows through a wall or a
// roof in front, while walls behind stay whole. The hole opens only while
// blocks do hide the player (`hides`): a wall beside them is in the
// cylinder too, but hides nothing and stays whole (user, 2026-10-04).
//
// What the player's fighter does not see is shaded in the material too
// (`sight`), so the blocks, the plants and the stones there go dark with
// the ground they stand on (user, 2026-10-05).
//
// Tree crowns are a mesh of their own per chunk, in a see-through
// material: where they come between the camera and a body (the player, a
// monster, the dummy, a rival: `see`), they fade, smoothly, to
// graphics.leaves.least, so nothing stands hidden under a tree (user,
// 2026-10-07) -- the wider the nearer the camera they stand, so the crowns
// in front of the picture open on the ground round the body too (user,
// 2026-10-08). The cut leaves them alone, and they do not open it.
const terrainMesh = (() => {
    // The picture's numbers here are game_config.js `graphics` (what each
    // is for is written there): the corners' shading, the ponds and their
    // water, the cliffs.
    const {
        corners: { ground: AO, faces: FACE_AO }, water: WATER, leaves: LEAVES,
        pond: { depth: POND_DEPTH, bed: POND_BED, bank: POND_BANK, floor: POND_FLOOR }, cliff: { depth: CLIFF_DEPTH, shade: CLIFF_SHADE }
    } = gameConfig.graphics;
    // How many bodies the crowns fade over at once (the nearest).
    const SEE_MAX = 8;
    // Whole-number hash of a cell to [0, 1): the same world every time, and
    // the same after one chunk is rebuilt.
    function hash(a, b, c = 0) {
        let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
        h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
        return ((h ^ h >>> 16) >>> 0) / 4294967296;
    }
    const GROUND = { 0: 'grassTop', 1: 'path', 5: 'cobble', 6: 'gravel' };
    // The tile of a map's own floor.
    const floorOf = t => GROUND[t.floor] || 'grassTop';
    // The shade of sight (render/view_sight.js), as shader text: the colour
    // on its way to the screen is mixed towards the shade where the ground
    // mask is white at `at`, a world (x, z) in blocks. Uniforms: `sightMask`
    // (white where the fighter does not see, north up), `sightAt` (its
    // middle x, z and half its width, blocks) and `sightTone` (the shade's
    // colour as the screen shows it, and how strong). It goes in ahead of
    // the fog, which then takes the shade as it takes the ground.
    const SIGHT_UNIFORMS = 'uniform sampler2D sightMask; uniform vec3 sightAt; uniform vec4 sightTone;';
    const sightShade = at => `gl_FragColor.rgb = mix(gl_FragColor.rgb, sightTone.rgb, sightTone.a * texture2D(sightMask, vec2(0.5) + vec2((${at}).x - sightAt.x, sightAt.y - (${at}).y) / (2.0 * sightAt.z)).g);`;
    // The same shade for a material that is not the terrain's own (the
    // ground beyond the map, the mist under a cliff): `sight` is the
    // terrain's (`create`). `also(shader)`: what else its shader takes
    // (the ground beyond the map fades as the terrain does: `fadeLight`).
    function shadeUnseen(material, sight, also = null) {
        material.onBeforeCompile = shader => { also?.(shader); unseen(shader, sight); };
        return material;
    }
    // Colours fading to grey in the natural light -- the sky's, what the
    // ground gives back of it, the sun's or the moon's (graphics.looks'
    // `fade`; user, 2026-10-06) -- as shader text
    // for a material lit as the engine's Lambert is: its own colour goes
    // `lightFade` (the uniform `fade`: { value }) of the way to grey once
    // the point lights (a torch, a fire, a doorway's glow) have been taken
    // in colour, and before the rest is; so the light keeps its own tint
    // (the moon's blue) and a torch brings a thing's colours back. `begin`:
    // the engine's lights as the material reads them. A three.js whose
    // lights read otherwise is left as it is.
    const SUN_LIGHTS = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
    function fadeLight(T, shader, fade, begin = T.ShaderChunk.lights_fragment_begin) {
        const include = '#include <lights_fragment_begin>', at = begin.indexOf(SUN_LIGHTS);
        if (at < 0) { shader.fragmentShader = shader.fragmentShader.replace(include, begin); return; }
        shader.uniforms.lightFade = fade;
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float lightFade;')
            .replace(include, `${begin.slice(0, at)}material.diffuseColor = mix( material.diffuseColor, vec3( dot( material.diffuseColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), lightFade );\n${begin.slice(at)}`);
    }
    function unseen(shader, sight) {
        Object.assign(shader.uniforms, { sightMask: sight.mask, sightAt: sight.at, sightTone: sight.tone });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vSightAt;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvSightAt = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec2 vSightAt; ${SIGHT_UNIFORMS}`)
            .replace('#include <fog_fragment>', `${sightShade('vSightAt')}\n#include <fog_fragment>`);
    }
    // The water's material (WATER): the engine's shiny one, its face turned
    // by the ripples, the sky mixed in by fresnel and its see-through-ness
    // going with it; shaded where unseen as the terrain is. `water` holds
    // its uniforms: `time` (seconds), `sky` and `horizon` (colours).
    function waterMaterial(T, sight, water) {
        const material = new T.MeshPhongMaterial({ color: palette.water, specular: WATER.glint, shininess: WATER.shine, transparent: true, opacity: WATER.opacity, depthWrite: false });
        const waves = WATER.waves.map(([x, z, length, speed, height]) => {
            const d = Math.hypot(x, z), k = 2 * Math.PI / length;
            return `w = dot(p, vec2(${(x / d * k).toFixed(4)}, ${(z / d * k).toFixed(4)})) + waterTime * ${(speed * k).toFixed(4)}; slope += vec2(${(x / d * k * height).toFixed(4)}, ${(z / d * k * height).toFixed(4)}) * cos(w);`;
        }).join('\n    ');
        material.onBeforeCompile = shader => {
            unseen(shader, sight);
            Object.assign(shader.uniforms, { waterTime: water.time, waterSky: water.sky, waterHorizon: water.horizon });
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vWaterAt;')
                .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterAt = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <lights_fragment_begin>', fireSheen(T))
                .replace('#include <common>', `#include <common>
varying vec3 vWaterAt; uniform float waterTime; uniform vec3 waterSky; uniform vec3 waterHorizon;
// The water's face (world) at p, turned by the ripples.
vec3 waterFace(vec2 p) {
    vec2 slope = vec2(0.0); float w;
    ${waves}
    return normalize(vec3(-slope.x, 1.0, -slope.y));
}`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 waterUp = waterFace(vWaterAt.xz);
normal = normalize((viewMatrix * vec4(waterUp, 0.0)).xyz);`)
                .replace('#include <opaque_fragment>', `vec3 waterEye = normalize(cameraPosition - vWaterAt);
float waterEdge = pow(1.0 - max(dot(waterEye, waterUp), 0.0), 5.0), waterMirror = ${WATER.mirror.toFixed(3)} + ${(1 - WATER.mirror).toFixed(3)} * waterEdge;
vec3 waterSeen = reflect(-waterEye, waterUp);
vec3 waterBack = mix(waterHorizon, waterSky, smoothstep(0.0, 0.7, waterSeen.y));
vec3 waterShine = reflectedLight.directSpecular + waterFire * ${WATER.fire.toFixed(3)};
outgoingLight = mix(outgoingLight - reflectedLight.directSpecular, waterBack, waterMirror) + waterShine;
diffuseColor.a = max(mix(diffuseColor.a, 1.0, waterEdge), min(1.0, dot(waterShine, vec3(0.333))));
#include <opaque_fragment>`);
        };
        return material;
    }
    // The engine's light on a face with the sky's (the hemisphere light's)
    // multiplied by the face's `vSky`, and the block light added (read in
    // the cell the face looks into: `glowMap`, a texel a cell, times
    // `glowPower`; not read at all where `glows` is false). A three.js
    // whose shader reads otherwise has the sky's light whole.
    function skyLit(T, glows) {
        const chunk = T.ShaderChunk.lights_fragment_begin, hemi = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
        return `${chunk.includes(hemi) ? chunk.replace(hemi, hemi.replace(';', ' * vSky;')) : chunk}
#if defined( RE_IndirectDiffuse )
${glows ? 'irradiance += texture2D(glowMap, (vCutPos.xz + vSide.xz * 0.5) / glowSize).rgb * glowPower;' : ''}
#endif`;
    }
    // The engine's light with the point lights' (torches, fires) wide
    // sheen gathered in `waterFire` (WATER.fireSpread). A three.js whose
    // shader reads otherwise gets none.
    function fireSheen(T) {
        const chunk = T.ShaderChunk.lights_fragment_begin, from = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 )'), call = 'RE_Direct( directLight,', at = chunk.indexOf(call, from);
        const sheen = `waterFire += directLight.color * pow(saturate(dot(geometryNormal, normalize(directLight.direction + geometryViewDir))), ${WATER.fireSpread.toFixed(1)});\n\t\t`;
        return `vec3 waterFire = vec3(0.0);\n${from < 0 || at < 0 ? chunk : chunk.slice(0, at) + sheen + chunk.slice(at)}`;
    }
    // Tile and shade spread per solid kind (by name).
    const BLOCK = { stone: ['stone', 0.07], tree: ['bark', 0.05], wood: ['plank', 0.04], portal: ['portalStone', 0.06], brush: ['brush', 0.1], ore: ['ore', 0.06], crystal: ['crystalRock', 0.05], hedge: ['leaves', 0.12] };

    // Drawn-only blocks: { 'x,y,z': { tile, tint } } for the whole map.
    function decor(sim) {
        const t = sim.terrain, K = terrainKit.KIND, out = new Map();
        const solidBlock = (c, y, r) => terrainKit.inside(t, c, r) && terrainKit.isSolid(terrainKit.kindAt(t, c, r)) && y < terrainKit.levelAt(t, c, r);
        const add = (x, y, z, tile, tint = null) => { if (!solidBlock(x, y, z)) out.set(`${x},${y},${z}`, { tile, tint }); };
        for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) {
            if (terrainKit.kindAt(t, c, r) !== K.tree) continue;
            // A crown of three layers (user, 2026-10-07: fewer leaves): one
            // wide layer round the trunk's top, its outer ring gappy, then a
            // narrow one and a cross on top.
            const h = terrainKit.levelAt(t, c, r);
            for (let y = h - 1; y <= h + 1; y++) {
                const rad = y >= h ? 1 : 2;
                for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
                    if (dx === 0 && dz === 0 && y < h) continue;
                    if (Math.abs(dx) === rad && Math.abs(dz) === rad && (rad === 2 || y === h + 1 || hash(c + dx, y, r + dz) < 0.5)) continue;
                    if (rad === 2 && Math.max(Math.abs(dx), Math.abs(dz)) === 2 && hash(c + dx, y, r + dz, 9) < 0.45) continue;
                    if (y === h + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
                    add(c + dx, y, r + dz, 'leaves');
                }
            }
        }
        // Roofs: two steps, overhanging east and west, so the door side
        // stays open to the camera and the roof stays low.
        for (const b of sim.entities) {
            if (b.type !== 'building') continue;
            const { col, row, w, d } = b.footprint, tint = palette[propModels.roofs[b.kind]] || null;
            for (let k = 0; k < 2; k++) {
                const c0 = col - 1 + k, c1 = col + w - k;
                for (let c = c0; c <= c1; c++) for (let r = row; r < row + d; r++) add(c, terrainKit.HOUSE_HEIGHT + k, r, 'roof', tint);
            }
        }
        // A lintel over each portal's opening and pillars.
        for (const p of sim.entities) {
            if (p.type !== 'portal') continue;
            const c = Math.floor(p.x / t.unit), r = Math.floor(p.y / t.unit), [dx, dy] = propKit.DIRS[p.side];
            for (const k of [-1, 0, 1]) add(c - dy * k, terrainKit.PORTAL_HEIGHT, r - dx * k, 'portalStone');
        }
        return out;
    }

    // ---- one chunk's geometry ----
    function builder() {
        const pos = [], nor = [], uv = [], col = [], sky = [], idx = [];
        return {
            pos, nor, uv, col, sky, idx,
            // The sky light of quads given none (`skies`, below).
            open: 1,
            // A quad p0..p3 counter-clockwise seen from outside; p0-p1 the
            // bottom edge of the tile. `shades`: per-corner brightness;
            // `skies`: per-corner share of the sky's light.
            quad(p, n, rect, rgb, shades = [1, 1, 1, 1], skies = null) {
                const base = pos.length / 3, [u0, v0, u1, v1] = rect;
                for (let i = 0; i < 4; i++) {
                    pos.push(...p[i]); nor.push(...n);
                    col.push(rgb[0] * shades[i], rgb[1] * shades[i], rgb[2] * shades[i]);
                    sky.push(skies ? skies[i] : this.open);
                }
                uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
                // Split along the brighter diagonal so corner shade stays even.
                if (shades[0] + shades[2] < shades[1] + shades[3]) idx.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
                else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
        };
    }
    // The six faces of a unit block at (x, y, z) (its low corner).
    const FACES = {
        top: { n: [0, 1, 0], at: (x, y, z) => [[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]] },
        south: { n: [0, 0, 1], d: [0, 1], at: (x, y, z) => [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
        north: { n: [0, 0, -1], d: [0, -1], at: (x, y, z) => [[x + 1, y, z], [x, y, z], [x, y + 1, z], [x + 1, y + 1, z]] },
        east: { n: [1, 0, 0], d: [1, 0], at: (x, y, z) => [[x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1]] },
        west: { n: [-1, 0, 0], d: [-1, 0], at: (x, y, z) => [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]] }
    };
    const SIDES = ['south', 'north', 'east', 'west'];
    // A box of any size turned `turn` about its vertical axis (flowers).
    function smallBox(b, [cx, cy, cz], [sx, sy, sz], turn, rect, rgb) {
        const c = Math.cos(turn), s = Math.sin(turn), hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
        const N = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
        b.quad([P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz)], N(0, 1, 0), rect, rgb);
        b.quad([P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)], N(0, 0, 1), rect, rgb);
        b.quad([P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)], N(0, 0, -1), rect, rgb);
        b.quad([P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)], N(1, 0, 0), rect, rgb);
        b.quad([P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)], N(-1, 0, 0), rect, rgb);
    }

    // `blockLight`: the block light is drawn (graphics.quality); `probes`:
    // the light probes are.
    function create(T, scene, sim, tx, { blockLight = true, probes = true } = {}) {
        const t = sim.terrain, K = terrainKit.KIND, tiles = tx.tiles, colour = new T.Color(), floorTile = floorOf(t);
        // The cut: centre (the player's chest) and eye (the camera), blocks.
        // `on` is the switch (1, or 0 for none at all); `open` is how far
        // the hole is open, 0..1: the view opens it only while blocks do
        // hide the player (`hides`, below).
        const cut = { center: { value: new T.Vector3() }, eye: { value: new T.Vector3() }, radius: { value: 1.3 }, on: { value: 1 }, open: { value: 0 } };
        // The shade of sight (`sightShade`, above): nothing is shaded until
        // the view gives it a mask and a tone. A face reads the mask a
        // little way out in front of itself: the wall that ends the sight
        // is itself seen, its top and its far side not.
        const sight = { mask: { value: null }, at: { value: new T.Vector3(0, 0, 1) }, tone: { value: new T.Vector4(0, 0, 0, 0) } };
        // The bodies the crowns fade over (`seeThrough`, below): each a
        // point (blocks, about its middle) and how far round the line from
        // it to the camera the leaves fade (w; 0 for none), and `widen`
        // blocks further for each block the leaves stand nearer the camera
        // than the body does, along the ground.
        const see = { bodies: { value: Array.from({ length: SEE_MAX }, () => new T.Vector4()) }, least: { value: LEAVES.least }, widen: { value: LEAVES.widen } };
        // How far the terrain's colours fade to grey in the natural light
        // (`fadeLight`, above): the view sets it by the look of the hour.
        const fade = { value: 0 };
        // Block light (render/terrain_light.js): a texel a cell, made anew
        // by `glow` when what gives light has moved a cell or changed.
        const glowData = new Uint8Array(t.width * t.height * 4), glowMap = new T.DataTexture(glowData, t.width, t.height);
        glowMap.magFilter = glowMap.minFilter = T.LinearFilter; glowMap.needsUpdate = true;
        const glowPower = { value: 0 };
        let glowKey = '';
        // `sources`: { at: [x, y, z] (blocks), reach (cells), rgb (0..1) }
        // each; `power`: how bright a source's own cell is lit. Returns
        // whether the light was made anew.
        function glow(sources, power) {
            if (!blockLight) return false;
            glowPower.value = power;
            const list = sources.map(g => ({ c: Math.floor(g.at[0]), r: Math.floor(g.at[2]), reach: g.reach, rgb: g.rgb }));
            const key = `${t.rev}|${list.map(g => `${g.c},${g.r},${g.reach},${g.rgb.map(v => v.toFixed(2))}`).sort().join(';')}`;
            if (key === glowKey) return false;
            glowKey = key;
            terrainLight.blockLight(t, list, glowData);
            glowMap.needsUpdate = true;
            return true;
        }
        // The terrain's shader text, for the blocks and (`leaves`) for the
        // crowns: those take no cut, and fade over the bodies under them.
        function terrainShader(shader, leaves) {
            Object.assign(shader.uniforms, { cutCenter: cut.center, cutEye: cut.eye, cutRadius: cut.radius, cutOn: cut.on, cutOpen: cut.open, sightMask: sight.mask, sightAt: sight.at, sightTone: sight.tone, glowMap: { value: glowMap }, glowSize: { value: new T.Vector2(t.width, t.height) }, glowPower, seeBodies: see.bodies, seeLeast: see.least, seeWiden: see.widen });
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float sky; varying float vSky; varying vec3 vCutPos; varying vec3 vSide;')
                .replace('#include <project_vertex>', '#include <project_vertex>\nvCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSide = normal; vSky = sky;');
            fadeLight(T, shader, fade, skyLit(T, blockLight));
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
varying float vSky; varying vec3 vCutPos; varying vec3 vSide;
uniform sampler2D glowMap; uniform vec2 glowSize; uniform float glowPower;
${SIGHT_UNIFORMS}
uniform vec3 cutCenter; uniform vec3 cutEye; uniform float cutRadius; uniform float cutOn; uniform float cutOpen;
float cutDither(vec2 p) {
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 i = ivec2(mod(p, 4.0));
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
}
uniform vec4 seeBodies[${SEE_MAX}]; uniform float seeLeast; uniform float seeWiden;
// How much of a crown stays: less on the line from a body to the camera,
// and for further round it the nearer the camera the leaves stand.
float leafStays() {
    float k = 0.0;
    for (int i = 0; i < ${SEE_MAX}; i++) {
        vec4 b = seeBodies[i];
        if (b.w <= 0.0) continue;
        vec3 axis = normalize(cutEye - b.xyz), rel = vCutPos - b.xyz;
        float along = dot(rel, axis), ahead = dot(rel.xz, normalize(axis.xz)), reach = b.w + seeWiden * max(ahead, 0.0);
        k = max(k, (1.0 - smoothstep(reach * 0.45, reach, length(rel - axis * along))) * smoothstep(-0.3, 0.2, ahead));
    }
    return 1.0 - k * (1.0 - seeLeast);
}`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (${leaves ? 'false' : 'true'} && cutOn > 0.5 && cutOpen > 0.01 && vCutPos.y > 0.05) {
    vec3 axis = normalize(cutEye - cutCenter);
    vec3 rel = vCutPos - cutCenter;
    float along = dot(rel, axis);
    // Only what stands on the camera's side of the player, on the ground plane.
    float ahead = dot(rel.xz, normalize(axis.xz));
    float fade = (1.0 - smoothstep(cutRadius * 0.55, cutRadius, length(rel - axis * along))) * smoothstep(0.1, 0.35, ahead);
    if (fade * 0.85 * cutOpen > cutDither(gl_FragCoord.xy)) discard;
}`)
                .replace('#include <fog_fragment>', `${sightShade('vCutPos.xz + vSide.xz * 0.3')}\n#include <fog_fragment>${leaves ? '\ngl_FragColor.a *= leafStays();' : ''}`);
        }
        const material = new T.MeshLambertMaterial({ map: tx.atlas, vertexColors: true });
        // Hidden faces are left out, so the back faces three.js would cast
        // shadows with are often missing: cast with both sides.
        material.shadowSide = T.DoubleSide;
        material.onBeforeCompile = shader => terrainShader(shader, false);
        // The crowns: the same, see-through (their shadows stay whole).
        const leafMaterial = new T.MeshLambertMaterial({ map: tx.atlas, vertexColors: true, transparent: true });
        leafMaterial.shadowSide = T.DoubleSide;
        leafMaterial.onBeforeCompile = shader => terrainShader(shader, true);
        // Up to SEE_MAX bodies, nearest first: { at: [x, y, z] (blocks,
        // about its middle), size (blocks: how tall it is) }.
        function seeThrough(list) {
            see.bodies.value.forEach((v, i) => {
                const b = list[i];
                if (b) v.set(b.at[0], b.at[1], b.at[2], LEAVES.reach * Math.max(1, b.size / 1.8)); else v.set(0, 0, 0, 0);
            });
        }
        // The ponds' water (WATER): its own material, a mesh of its own per chunk.
        const water = { time: { value: 0 }, sky: { value: new T.Color() }, horizon: { value: new T.Color() } };
        const wetMaterial = waterMaterial(T, sight, water);
        let deco = null, decoRev = -1;
        const chunks = new Map();
        // Where nothing standing is in the way: ground under open air.
        const column = (c, r) => terrainKit.inside(t, c, r) && terrainKit.isSolid(terrainKit.kindAt(t, c, r));
        // The opaque blocks (the ground, the columns, decor) as a grid, and
        // the sky each open cell sees (render/terrain_light.js); both made
        // anew when the terrain changes; `grounds`, what the ground was
        // under each cell then (`groundOf`, row by row).
        let blocks = null, skyAt = null, grounds = [];
        // Does an opaque block fill (c, y, r)?
        const opaque = (c, y, r) => blocks.solid(c, y, r);
        // Does it hide a block's face against it? A crown's leaves do not:
        // they can be seen through (the trunk inside shows).
        const shut = (c, y, r) => opaque(c, y, r) && deco.get(`${c},${y},${r}`)?.tile !== 'leaves';
        // The sky light at the corners `points` of the face of block (c, y, r) that looks along `n`.
        const skies = (points, n, c, y, r) => terrainLight.corners(blocks, skyAt, points, n, c, y, r);
        // The sky light on the small things standing in open cell (c, y, r).
        const openSky = (c, y, r) => terrainLight.skyShade(skyAt(c, y, r, FACES.top.n));
        // Corner shading of the face of block (c, y, r) that looks along
        // `n`, for its corners `points`: each corner looks at the three
        // cells it touches in the layer the face looks into -- one either
        // side of it and the one across.
        function faceShades(points, n, c, y, r) {
            const axes = [0, 1, 2].filter(k => n[k] === 0), at = [c + n[0], y + n[1], r + n[2]], mid = [c + 0.5, y + 0.5, r + 0.5];
            return points.map(p => {
                const a = [...at], b = [...at], d = [...at];
                for (const [i, k] of axes.entries()) {
                    const step = p[k] > mid[k] ? 1 : -1;
                    (i ? b : a)[k] += step; d[k] += step;
                }
                const s1 = opaque(...a) ? 1 : 0, s2 = opaque(...b) ? 1 : 0, corner = opaque(...d) ? 1 : 0;
                return FACE_AO[s1 && s2 ? 0 : 3 - s1 - s2 - corner];
            });
        }
        // One face of a block, shaded in its corners.
        function face(b, F, c, y, r, rect, rgb) {
            const points = F.at(c, y, r);
            b.quad(points, F.n, rect, rgb, faceShades(points, F.n, c, y, r), skies(points, F.n, c, y, r));
        }
        // Does a block (the terrain's or decor) stand on the straight line
        // from `from` to `to` ([x, y, z], blocks)? Sampled every fifth of a
        // block, where the line runs lower than the highest block. Decor is
        // looked up by number here: this runs every frame.
        const decoKey = (c, y, r) => ((y + 8) * 2048 + c + 512) * 2048 + r + 512;
        let decoKeys = new Set(), top = 0;
        function hides(from, to) {
            const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 0.2));
            for (let i = 1; i < n; i++) {
                const y = from[1] + dy * i / n;
                if (y >= top || y < 0) continue;
                const c = Math.floor(from[0] + dx * i / n), r = Math.floor(from[2] + dz * i / n), level = Math.floor(y);
                if (terrainKit.inside(t, c, r)) {
                    const k = terrainKit.kindAt(t, c, r);
                    if (terrainKit.isSolid(k) && k !== K.gate && level < terrainKit.levelAt(t, c, r)) return true;
                }
                if (decoKeys.has(decoKey(c, level, r))) return true;
            }
            return false;
        }
        const tintOf = (base, c, y, r, vary) => { const k = 1 - vary + hash(c, y, r) * vary * 1.6; return [base[0] * k, base[1] * k, base[2] * k]; };
        const WHITE = [1, 1, 1];
        // Doors and windows on buildings: face overrides 'c,y,r,side' -> tile.
        function facades() {
            const out = new Map();
            for (const b of sim.entities) {
                if (b.type !== 'building') continue;
                const [dc, dr] = b.doorCell, { col, row, w, d } = b.footprint;
                out.set(`${dc},0,${dr},${b.door}`, 'door'); out.set(`${dc},1,${dr},${b.door}`, 'door');
                for (let c = col; c < col + w; c++) if (c !== dc && (c - col) % 2 === 1) out.set(`${c},1,${row + d - 1},south`, 'window');
                for (let r = row; r < row + d; r++) if ((r - row) % 2 === 1) { out.set(`${col},1,${r},west`, 'window'); out.set(`${col + w - 1},1,${r},east`, 'window'); }
            }
            return out;
        }
        let fronts = facades();
        // Spots kept free of flowers: spawns, homes, doors and portals.
        const clear = [...t.spawns, ...t.monsters, ...sim.entities.map(e => ({ col: Math.floor(e.x / t.unit), row: Math.floor(e.y / t.unit) }))];

        // One chunk: its blocks and ground (`b`), its ponds' water (`wet`)
        // and its tree crowns (`leaf`).
        function build(i) {
            const b = builder(), wet = builder(), leaf = builder(), { c0, r0, c1, r1 } = terrainKit.chunkCells(t, i);
            for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
                const k = terrainKit.kindAt(t, c, r), name = terrainKit.NAMES[k];
                // Beyond a cliff's edge nothing is drawn; the cells along it show its face.
                if (k === K.drop) continue;
                cliff(b, c, r);
                if (k === K.water) { pond(b, wet, c, r); continue; }
                if (!terrainKit.isSolid(k)) {
                    // Ground, shaded at corners that meet a wall; a herb
                    // grows on the map's own floor.
                    const shades = [[0, 1], [1, 1], [1, 0], [0, 0]].map(([sx, sz]) => {
                        const dx = sx ? 1 : -1, dz = sz ? 1 : -1, s1 = column(c + dx, r), s2 = column(c, r + dz), corner = column(c + dx, r + dz);
                        return AO[s1 && s2 ? 0 : 3 - s1 - s2 - corner];
                    });
                    const points = FACES.top.at(c, -1, r);
                    b.quad(points, FACES.top.n, tiles[GROUND[k === K.herb ? t.floor : k]], tintOf(WHITE, c, -1, r, 0.06), shades, skies(points, FACES.top.n, c, -1, r));
                    b.open = openSky(c, 0, r);
                    if (k === K.herb) herb(b, c, r);
                    else if (k === K.grass && hash(c, r, 7) < 0.18 && !clear.some(s => Math.abs(c - s.col) <= 1 && Math.abs(r - s.row) <= 1)) flower(b, c, r);
                    b.open = 1;
                    continue;
                }
                // Under a block (and a portal's opening) the map's floor goes on.
                b.quad(FACES.top.at(c, -1, r), FACES.top.n, tiles[floorTile], tintOf(WHITE, c, -1, r, 0.06));
                if (k === K.gate) continue;
                if (k === K.fence) { b.open = openSky(c, 0, r); fence(b, c, r); b.open = 1; continue; }
                const [tile, vary] = BLOCK[name], level = terrainKit.levelAt(t, c, r);
                for (let y = 0; y < level; y++) {
                    const rgb = tintOf(WHITE, c, y, r, vary), own = k === K.stone && hash(c, y, r, 3) < 0.3 ? 'mossy' : tile;
                    if (y === level - 1 && !shut(c, y + 1, r)) face(b, FACES.top, c, y, r, tiles[k === K.tree ? 'barkTop' : own], rgb);
                    for (const side of SIDES) {
                        const F = FACES[side];
                        if (shut(c + F.d[0], y, r + F.d[1])) continue;
                        face(b, F, c, y, r, tiles[fronts.get(`${c},${y},${r},${side}`) || own], rgb);
                    }
                }
                if (k === K.crystal) { b.open = openSky(c, level, r); crystals(b, c, level, r); b.open = 1; }
            }
            // Decor that belongs to this chunk (by the cell under it; decor
            // off the map's edge goes to the nearest chunk).
            const cx = i % t.cw, cz = Math.floor(i / t.cw);
            for (const [key, d] of deco) {
                const [x, y, z] = key.split(',').map(Number);
                if (Math.min(t.cw - 1, Math.max(0, Math.floor(x / 16))) !== cx || Math.min(t.ch - 1, Math.max(0, Math.floor(z / 16))) !== cz) continue;
                const base = d.tint ? colour.set(d.tint).toArray() : WHITE, rgb = tintOf(base, x, y, z, d.tile === 'leaves' ? 0.12 : 0.05), into = d.tile === 'leaves' ? leaf : b;
                if (!opaque(x, y + 1, z)) face(into, FACES.top, x, y, z, tiles[d.tile], rgb);
                for (const side of SIDES) {
                    const F = FACES[side];
                    if (!opaque(x + F.d[0], y, z + F.d[1])) face(into, F, x, y, z, tiles[d.tile], rgb);
                }
            }
            return { b, wet, leaf };
        }
        // A pond on cell (c, r): its water (into `wet`) POND_DEPTH below the
        // ground, its bed POND_BED below, and the earth of the bank, darker
        // going down, wherever the next cell is not water.
        function pond(b, wet, c, r) {
            const y = -POND_BED, water = (dc, dr) => terrainKit.inside(t, c + dc, r + dr) && terrainKit.kindAt(t, c + dc, r + dr) === K.water;
            const at = h => [[c, h, r + 1], [c + 1, h, r + 1], [c + 1, h, r], [c, h, r]];
            wet.quad(at(-POND_DEPTH), FACES.top.n, tiles.white, WHITE);
            const bed = at(y);
            b.quad(bed, FACES.top.n, tiles.gravel, tintOf(colour.set(palette.pondBed).toArray(), c, -2, r, 0.08).map(v => v * POND_FLOOR), undefined, skies(bed, FACES.top.n, c, -1, r));
            b.open = openSky(c, 0, r);
            // The top strip of the dirt tile, as deep as the bank is high.
            const [u0, v0, u1, v1] = tiles.dirt, bank = [u0, v1 - (v1 - v0) * POND_BED, u1, v1], rgb = tintOf(WHITE, c, -2, r, 0.06), [hi, lo] = POND_BANK, shades = [lo, lo, hi, hi];
            if (!water(0, -1)) b.quad([[c, y, r], [c + 1, y, r], [c + 1, 0, r], [c, 0, r]], [0, 0, 1], bank, rgb, shades);
            if (!water(0, 1)) b.quad([[c + 1, y, r + 1], [c, y, r + 1], [c, 0, r + 1], [c + 1, 0, r + 1]], [0, 0, -1], bank, rgb, shades);
            if (!water(-1, 0)) b.quad([[c, y, r + 1], [c, y, r], [c, 0, r], [c, 0, r + 1]], [1, 0, 0], bank, rgb, shades);
            if (!water(1, 0)) b.quad([[c + 1, y, r], [c + 1, y, r + 1], [c + 1, 0, r + 1], [c + 1, 0, r]], [-1, 0, 0], bank, rgb, shades);
            b.open = 1;
        }
        // The cliff under each edge of cell (c, r) that the drop lies
        // beyond: a block of earth, then rock, CLIFF_DEPTH down in all,
        // darker the deeper (the mist under the map takes it from there:
        // render/world_view.js).
        function cliff(b, c, r) {
            for (const side of SIDES) {
                const F = FACES[side], nc = c + F.d[0], nr = r + F.d[1];
                if (!terrainKit.inside(t, nc, nr) || terrainKit.kindAt(t, nc, nr) !== K.drop) continue;
                for (let d = 0; d < CLIFF_DEPTH; d++) {
                    const hi = 1 - d * CLIFF_SHADE, lo = hi - CLIFF_SHADE;
                    b.quad(F.at(c, -1 - d, r), F.n, tiles[d ? 'stone' : 'dirt'], tintOf(WHITE, c, -1 - d, r, 0.06), [lo, lo, hi, hi]);
                }
            }
        }
        // A fence on cell (c, r): a post, and two rails to each next cell
        // that holds a fence or a block (drawn thinner than the cell it
        // closes).
        // Plain weathered wood, the post darker than the rails: the plank
        // tile's boards and seams did not suit so thin a thing (user,
        // 2026-10-04: the shape is right, the material was not).
        function fence(b, c, r) {
            const x = c + 0.5, z = r + 0.5;
            const post = tintOf(colour.set(palette.fencePost).toArray(), c, 0, r, 0.1), rail = tintOf(colour.set(palette.fenceRail).toArray(), c, 1, r, 0.1);
            smallBox(b, [x, 0.5, z], [0.24, 1, 0.24], 0, tiles.white, post);
            for (const side of SIDES) {
                const [dx, dz] = FACES[side].d;
                if (!column(c + dx, r + dz)) continue;
                for (const y of [0.4, 0.78]) smallBox(b, [x + dx * 0.31, y, z + dz * 0.31], dx ? [0.38, 0.14, 0.1] : [0.1, 0.14, 0.38], 0, tiles.white, rail);
            }
        }
        // A tuft or a flower on grass cell (c, r): tiny boxes.
        function flower(b, c, r) {
            const x = c + 0.15 + hash(c, r, 11) * 0.7, z = r + 0.15 + hash(c, r, 12) * 0.7, turn = hash(c, r, 13) * Math.PI * 2;
            const stem = colour.set(palette.stem).toArray();
            if (hash(c, r, 14) < 0.55) {
                for (let k = 0; k < 3; k++) smallBox(b, [x + (k - 1) * 0.09, 0.12 + k % 2 * 0.04, z + (hash(c, r, 20 + k) - 0.5) * 0.1], [0.05, 0.24 + k % 2 * 0.08, 0.05], turn, tiles.white, stem);
            } else {
                smallBox(b, [x, 0.15, z], [0.05, 0.3, 0.05], turn, tiles.white, stem);
                const petal = [palette.flowerRed, palette.flowerYellow, palette.flowerWhite, palette.flowerViolet][hash(c, r, 15) * 4 | 0];
                smallBox(b, [x, 0.34, z], [0.15, 0.13, 0.15], turn, tiles.white, colour.set(petal).toArray());
            }
        }
        // A herb on cell (c, r): a leafy clump with red berries.
        function herb(b, c, r) {
            const leaf = colour.set(palette.herb).toArray(), light = colour.set(palette.herbLight).toArray(), berry = colour.set(palette.berry).toArray();
            const x = c + 0.5, z = r + 0.5, turn = hash(c, r, 31) * Math.PI;
            for (let k = 0; k < 5; k++) {
                const a = turn + k * 1.26, d = k ? 0.17 : 0;
                smallBox(b, [x + Math.cos(a) * d, 0.14 + (k ? 0 : 0.08), z + Math.sin(a) * d], [0.2, 0.28 + (k ? 0 : 0.14), 0.2], a, tiles.white, k % 2 ? light : leaf);
            }
            for (let k = 0; k < 3; k++) {
                const a = turn + 0.6 + k * 2.1;
                smallBox(b, [x + Math.cos(a) * 0.2, 0.33, z + Math.sin(a) * 0.2], [0.08, 0.08, 0.08], a, tiles.white, berry);
            }
        }
        // Crystals standing on a crystal boulder's top (`level` high).
        function crystals(b, c, level, r) {
            const glow = colour.set(palette.crystal).toArray(), deep = colour.set(palette.crystalDeep).toArray();
            for (let k = 0; k < 3; k++) {
                const x = c + 0.25 + hash(c, r, 40 + k) * 0.5, z = r + 0.25 + hash(c, r, 50 + k) * 0.5, h = 0.25 + hash(c, r, 60 + k) * 0.3;
                smallBox(b, [x, level + h / 2, z], [0.13, h, 0.13], hash(c, r, 70 + k) * Math.PI, tiles.white, k === 1 ? deep : glow);
            }
        }
        function mesh(b, material) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
            g.setAttribute('sky', new T.Float32BufferAttribute(b.sky, 1));
            g.setIndex(b.pos.length / 3 > 65535 ? new T.Uint32BufferAttribute(b.idx, 1) : new T.Uint16BufferAttribute(b.idx, 1));
            g.computeBoundingSphere();
            const m = new T.Mesh(g, material);
            m.castShadow = material !== wetMaterial; m.receiveShadow = true;
            return m;
        }
        // ---- light probes (render/terrain_light.js): looked round anew
        // when the terrain changes; the hour's light laid on by `bounce`.
        // A grid three.js reads for every lit material: an object it
        // knows by `isLightProbeGrid`, with the probes' numbers in a 3D
        // texture, seven texels a probe (their 27 numbers four by four),
        // each of the seven a stack of slices along z with one more at
        // either end. ----
        const probeGrid = new T.Object3D();
        Object.assign(probeGrid, { isLightProbeGrid: true, texture: null, boundingBox: new T.Box3(), resolution: new T.Vector3() });
        if (probes) scene.add(probeGrid);
        let baked = null;
        const lastBounce = [-1, -1, -1];
        // The colour things give back, linear, by what terrainLight names.
        const colourOf = name => {
            if (BLOCK[name]) return tx.means[BLOCK[name][0]];
            if (name === 'water') return colour.set(palette.water).toArray();
            return tx.means[name] || null;
        };
        // What the ground is under open cell (c, r): its tile, or none.
        const groundOf = (c, r) => {
            if (!terrainKit.inside(t, c, r)) return floorTile;
            const k = terrainKit.kindAt(t, c, r);
            return k === K.drop ? null : k === K.water ? 'water' : GROUND[k] || floorTile;
        };
        // `changed`: the cells that have changed since the last look round
        // (`update`), or null for all of it: only the probes near them
        // look round again (terrainLight.probes). The probes stand where
        // they stood, so their texture stays; `bounce` lays the new
        // numbers into it.
        function bake(changed = null) {
            const before = baked;
            baked = terrainLight.probes(blocks, t, { colour: colourOf, ground: groundOf, skyAt }, before && changed && { from: before, changed });
            if (!before || !probeGrid.texture || before.count.some((v, i) => v !== baked.count[i])) {
                const [nx, ny, nz] = baked.count;
                probeGrid.texture?.dispose();
                const texture = new T.Data3DTexture(new Uint16Array(nx * ny * 7 * (nz + 2) * 4), nx, ny, 7 * (nz + 2));
                Object.assign(texture, { format: T.RGBAFormat, type: T.HalfFloatType, magFilter: T.LinearFilter, minFilter: T.LinearFilter });
                probeGrid.texture = texture;
                probeGrid.boundingBox.min.fromArray(baked.min); probeGrid.boundingBox.max.fromArray(baked.max);
                probeGrid.resolution.set(nx, ny, nz);
            }
            lastBounce.fill(-1);
        }
        // The light the ground and the walls are lit by now ([r, g, b],
        // linear, as irradiance): their colour given back is that times
        // their own over pi. Laid into the texture only when it has moved
        // by more than a few hundredths.
        function bounce(light) {
            if (!baked) return false;
            if (light.every((v, i) => Math.abs(v - lastBounce[i]) <= 0.02 * Math.max(0.05, lastBounce[i]))) return false;
            light.forEach((v, i) => { lastBounce[i] = v; });
            const [nx, ny, nz] = baked.count, data = probeGrid.texture.image.data, slices = nz + 2, half = T.DataUtils.toHalfFloat;
            for (let k = 0; k < slices; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                const p = (Math.min(nz - 1, Math.max(0, k - 1)) * ny + j) * nx + i;
                for (let m = 0; m < 28; m++) {
                    const ch = Math.floor(m / 3), b = m % 3, v = m < 27 ? baked.sh[p * 27 + b * 9 + ch] * light[b] / Math.PI : 0;
                    data[(((Math.floor(m / 4) * slices + k) * ny + j) * nx + i) * 4 + m % 4] = half(v);
                }
            }
            probeGrid.texture.needsUpdate = true;
            return true;
        }
        // Take a chunk's meshes out of the scene.
        function drop({ mesh: m, water: w, leaves: l }) {
            for (const one of [m, w, l]) if (one) { scene.remove(one); one.geometry.dispose(); }
        }
        // Rebuild every chunk whose revision moved (all of them the first time).
        function update() {
            if (decoRev !== t.rev) {
                deco = decor(sim); fronts = facades(); decoRev = t.rev;
                // (The crowns hide nothing from the cut: they fade by themselves.)
                decoKeys = new Set(); top = 0;
                for (const [key, d] of deco) { const [x, y, z] = key.split(',').map(Number); if (d.tile !== 'leaves') decoKeys.add(decoKey(x, y, z)); top = Math.max(top, y + 1); }
                for (let r = 0; r < t.height; r++) for (let c = 0; c < t.width; c++) if (terrainKit.isSolid(terrainKit.kindAt(t, c, r))) top = Math.max(top, terrainKit.levelAt(t, c, r));
                // The light worked out on the grid -- the sky each cell
                // sees, the probes -- is worked out again only as far as
                // the change reaches (`changed`: the cells filled
                // otherwise, and for the probes those whose ground is
                // another too; null the first time, for all of it). A
                // herb picked changes none of it: the light stays as it
                // is.
                const next = terrainLight.blocks(t, [...deco].map(([key, d]) => [...key.split(',').map(Number), d.tile]));
                const under = Array.from({ length: t.width * t.height }, (_, i) => groundOf(i % t.width, Math.floor(i / t.width)));
                const changed = blocks && terrainLight.changes(blocks, next);
                skyAt = terrainLight.sky(next, changed && { from: skyAt, changed: changed.filter(cell => cell[3]) });
                if (changed) under.forEach((name, i) => { if (name !== grounds[i]) changed.push([i % t.width, -1, Math.floor(i / t.width), false]); });
                blocks = next; grounds = under;
                if (probes && !(baked && changed && !changed.length)) bake(changed);
            }
            let rebuilt = 0;
            t.chunks.forEach((chunk, i) => {
                const have = chunks.get(i);
                if (have && have.rev === chunk.rev) return;
                if (have) drop(have);
                const { b, wet, leaf } = build(i), m = mesh(b, material), w = wet.pos.length ? mesh(wet, wetMaterial) : null, l = leaf.pos.length ? mesh(leaf, leafMaterial) : null;
                scene.add(m);
                if (w) scene.add(w);
                if (l) scene.add(l);
                chunks.set(i, { rev: chunk.rev, mesh: m, water: w, leaves: l });
                rebuilt++;
            });
            return rebuilt;
        }
        update();
        return {
            cut, sight, fade, water, glow, bounce, material, update, hides, seeThrough,
            meshes: () => [...chunks.values()].map(c => c.mesh),
            dispose() {
                for (const chunk of chunks.values()) drop(chunk);
                chunks.clear(); material.dispose(); leafMaterial.dispose(); wetMaterial.dispose(); glowMap.dispose();
                scene.remove(probeGrid); probeGrid.texture?.dispose();
            }
        };
    }
    return { create, decor, hash, floorOf, shadeUnseen, fadeLight };
})();
