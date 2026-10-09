// The world view's changes to three.js shader text (render/world_view.js):
// the sun's and the torch's soft shadows with more samples, shadows looked
// up only where their light falls, lights that are out or out of reach
// passed over, the light probes read at a face's corners, and what every
// character's material reads (the ghost of a hidden fighter, the fade of
// colours). Drawing only.
const viewShaders = (() => {
    // The samples of the engine's soft shadows lie on a disc
    // (`vogelDiskSample`: sample k of n is the golden angle times k round
    // it and the square root of (k + 0.5) / n out), which noise turns from
    // pixel to pixel. The engine works out the cosine and sine of every
    // sample's angle at every pixel; here the disc's `n` samples are a
    // constant list (`disc`, as shader text) and each is turned by the
    // pixel's own angle, whose cosine and sine are worked out once
    // (`turn`; `TURNED` turns sample `s`). The same samples, but for
    // rounding.
    const GOLDEN = 2.399963229728653;
    const disc = (name, n) => `const vec2 ${name}[${n}] = vec2[${n}]( ${Array.from({ length: n }, (_, k) => {
        const out = Math.sqrt((k + 0.5) / n);
        return `vec2( ${(out * Math.cos(k * GOLDEN)).toFixed(9)}, ${(out * Math.sin(k * GOLDEN)).toFixed(9)} )`;
    }).join(', ')} );`;
    const TURN = 'vec2 turn = vec2( cos( phi ), sin( phi ) );', TURNED = 'vec2( s.x * turn.x - s.y * turn.y, s.x * turn.y + s.y * turn.x )';
    // The engine's soft shadows take five samples in a disc that noise
    // turns from pixel to pixel; on a large shadow map (SUN_WIDE texels
    // or more) that disc is many texels wide and the five show as grain.
    // There, SUN_TAPS samples of the same disc are taken instead (a small
    // map keeps the engine's five: its disc is narrow, and phones are
    // spared the cost). The map's size is the light's own, so the choice
    // follows a change of picture quality with no new shader. A sample
    // names its mip level (the map has the one): it then takes no part in
    // the picking of one, and a graphics driver can pass the samples over
    // where they are not asked for (`shadowsWhereLit`); by OpenGL that
    // took two fifths off a frame by day (and there the samples fall a
    // hair otherwise: lit ground a step of 255 off here and there, as
    // noise; by Direct3D and Vulkan the picture is the same to the
    // pixel). The engine's shader is patched before any material is
    // compiled; a three.js whose shader reads otherwise is left as it is.
    const SUN_TAPS = 12, SUN_WIDE = 2048;
    function smoothShadows(T) {
        const chunk = T.ShaderChunk.shadowmap_pars_fragment, from = chunk.indexOf('shadow = ('), end = ') * 0.2;', to = chunk.indexOf(end, from);
        if (from < 0 || to < 0 || !chunk.slice(from, to).includes('vogelDiskSample( 4, 5, phi )') || !chunk.includes('vec2 shadowMapSize')) return;
        const taken = (name, n) => `${disc(name, n)}
    for ( int k = 0; k < ${n}; k ++ ) {
        vec2 s = ${name}[ k ];
        shadow += textureLod( shadowMap, vec3( shadowCoord.xy + ${TURNED} * radius, shadowCoord.z ), 0.0 );
    }
    shadow /= ${n}.0;`;
        T.ShaderChunk.shadowmap_pars_fragment = `${chunk.slice(0, from)}shadow = 0.0;
${TURN}
if ( shadowMapSize.x >= ${SUN_WIDE}.0 ) {
    ${taken('sunWide', SUN_TAPS)}
} else {
    ${taken('sunNarrow', 5)}
}${chunk.slice(to + end.length)}`;
    }
    // The engine's point light shadows take five samples; `taps` samples
    // of the same disc are taken instead, or a soft edge shows as grain.
    // A standing torch's shadows (render/view_light.js) take LAMP_TAPS,
    // fewer: its light is half the carried torch's, and the grain shows
    // half as much. How many is `pointShadowTaps`, set before a light's
    // shadow is looked up: the carried torch is the first point light
    // (it is added to the scene first, and the engine keeps the lights
    // that cast in the scene's order), the standing torches the rest.
    // `direct3d`: the samples name their mip level, as the sun's do. Only
    // there: Direct3D otherwise takes all of them at every pixel, the
    // torch burning or not (over half a frame), while by OpenGL and Vulkan
    // (the phones' kind) they are passed over as written, and so written
    // cost half as much again or more with the torch burning.
    // Patched before any material is compiled; a three.js whose shader
    // reads otherwise is left as it is.
    const LAMP_TAPS = gameConfig.graphics.lamp.shadow.taps;
    function softTorchShadows(T, taps, direct3d) {
        const chunk = T.ShaderChunk.shadowmap_pars_fragment, start = 'vec2 sample0 = vogelDiskSample( 0, 5, phi );', end = ') * 0.2;';
        const from = chunk.indexOf(start), to = chunk.indexOf(end, from);
        if (from < 0 || to < 0 || !chunk.slice(from, to).includes('bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize')) return;
        const taken = (name, n) => `${disc(name, n)}
    for ( int k = 0; k < ${n}; k ++ ) {
        vec2 s = ${name}[ k ];
        s = ${TURNED};
        shadow += ${direct3d ? 'textureGrad' : 'texture'}( shadowMap, vec4( bd3D + ( tangent * s.x + bitangent * s.y ) * texelSize, dp )${direct3d ? ', vec3( 0.0 ), vec3( 0.0 )' : ''} );
    }
    shadow /= ${n}.0;`;
        // (One list where the carried torch and the standing ones take as many.)
        const lists = taps === LAMP_TAPS ? `{
    ${taken('torchDisc', taps)}
}` : `if ( pointShadowTaps == ${taps} ) {
    ${taken('torchDisc', taps)}
} else {
    ${taken('lampDisc', LAMP_TAPS)}
}`;
        T.ShaderChunk.shadowmap_pars_fragment = `int pointShadowTaps = ${taps};
${chunk.slice(0, from)}shadow = 0.0;
${TURN}
${lists}${chunk.slice(to + end.length)}`;
        // (Where the engine's lights read otherwise, every point light takes the torch's.)
        const each = 'pointLightShadow = pointLightShadows[ i ];';
        T.ShaderChunk.lights_fragment_begin = T.ShaderChunk.lights_fragment_begin.replace(each, `${each}
		pointShadowTaps = UNROLLED_LOOP_INDEX < 1 ? ${taps} : ${LAMP_TAPS};`);
    }
    // A light's shadow is looked up only where its light falls: not while
    // the light is out, not past its reach, and not on a face turned away
    // from it -- there the light adds nothing, shadowed or not, so the
    // picture is the same (with the torch burning, a fifth off a frame).
    // The engine asks with `lit ? shadow : 1.0`; here it is `if`, and the
    // face's turn is asked too. Lambert and Phong, the lit materials here,
    // take a light by the cosine to the face; a material that lights
    // faces turned away (toon) would need its own. Nor is it looked up
    // while the light's shadows are at nothing, where the engine looks
    // it up and leaves the light as it is: a standing torch's as they
    // come and go, and the sun's in a dark region, which casts there only
    // so that every region's shaders are the same ones
    // (render/view_light.js `retune`). A three.js whose shader reads
    // otherwise is left as it is.
    function shadowsWhereLit(T) {
        const chunk = T.ShaderChunk.lights_fragment_begin;
        const asked = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (get(?:Point)?Shadow\( (point|directional)ShadowMap\[ i \][^;]*?\)) : 1\.0;/g;
        if ((chunk.match(asked) || []).length !== 2 || !chunk.includes('directionalLightShadow.shadowIntensity') || !chunk.includes('pointLightShadow.shadowIntensity')) return;
        T.ShaderChunk.lights_fragment_begin = chunk.replace(asked, 'if ( directLight.visible && receiveShadow && $2LightShadow.shadowIntensity > 0.0 && dot( geometryNormal, directLight.direction ) > 0.0 ) directLight.color *= $1;');
    }
    // A point light that is out is passed over whole: the torch while it
    // does not burn, and the moving lights nothing has been given
    // (render/view_light.js; those that cannot fall on the picture are
    // among them). They are always in the shader, and the engine works
    // each one out at every pixel to add nothing: by Vulkan, five of them
    // out (the torch and four moving lights, as it was) were over a
    // quarter of a frame by day. A light that burns is passed over the
    // same way at every pixel past its reach: the engine works its
    // falling off out there too, to nothing (a light with a reach gives
    // none at it or beyond), and with every standing torch on the
    // picture lit (user, 2026-10-09) most pixels are past the reach of
    // most of them. The picture is the same. A three.js whose shader
    // reads otherwise is left as it is.
    function darkLightsSkipped(T) {
        const chunk = T.ShaderChunk.lights_fragment_begin, from = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 )');
        const first = 'getPointLightInfo( pointLight, geometryPosition, directLight );', last = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
        const a = chunk.indexOf(first, from), b = chunk.indexOf(last, a), end = chunk.indexOf('#pragma unroll_loop_end', a);
        if (from < 0 || a < 0 || b < 0 || end < b) return;
        T.ShaderChunk.lights_fragment_begin = `${chunk.slice(0, a)}if ( pointLight.color != vec3( 0.0 ) ) {
		vec3 pointLightOff = pointLight.position - geometryPosition;
		if ( pointLight.distance <= 0.0 || dot( pointLightOff, pointLightOff ) < pointLight.distance * pointLight.distance ) {
		${chunk.slice(a, b + last.length)}
		}
		}${chunk.slice(b + last.length)}`;
    }
    // The light probes (render/terrain_light.js) worked out at each corner
    // of a face instead of at each of its pixels: the engine reads seven
    // texels of their 3D texture a pixel, and what they give back changes
    // slowly (a probe every two blocks), so a face's corners (a block
    // apart) hold it well enough, for far less (graphics.quality's
    // `bounce`). The engine's own reading goes into the vertex
    // shader of every lit material and hands its result on. The engine
    // tells only the fragment shader whether there are probes, so the
    // vertex shader always reads them (with none, an empty texture, and
    // the fragment shader does not take it). A three.js whose shaders
    // read otherwise keeps reading per pixel.
    function probesByVertex(T) {
        const S = T.ShaderChunk, read = S.lightprobes_pars_fragment, light = S.lights_fragment_begin, guard = '#ifdef USE_LIGHT_PROBES_GRID';
        const from = light.indexOf(guard), to = light.indexOf('#endif', from);
        if (from < 0 || to < 0 || !read.trim().startsWith(guard) || !read.trim().endsWith('#endif') || !read.includes('vec3 getLightProbeGridIrradiance(') || !S.shadowmap_vertex.includes('vec4 shadowWorldPosition;')) return;
        const unguarded = read.trim().slice(guard.length, -'#endif'.length);
        S.lights_fragment_begin = `${light.slice(0, from)}#ifdef USE_LIGHT_PROBES_GRID
		irradiance += vProbeIrradiance;
	${light.slice(to)}`;
        S.lightprobes_pars_fragment = `${read}
#ifdef USE_LIGHT_PROBES_GRID
varying vec3 vProbeIrradiance;
#endif`;
        S.shadowmap_pars_vertex = `${S.shadowmap_pars_vertex}
${unguarded}
varying vec3 vProbeIrradiance;`;
        S.shadowmap_vertex = `${S.shadowmap_vertex}
{
	vec4 probeAt = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		probeAt = batchingMatrix * probeAt;
	#endif
	#ifdef USE_INSTANCING
		probeAt = instanceMatrix * probeAt;
	#endif
	#ifdef HAS_NORMAL
		vProbeIrradiance = getLightProbeGridIrradiance( ( modelMatrix * probeAt ).xyz, transformNormalByInverseViewMatrix( transformedNormal, viewMatrix ) );
	#else
		vProbeIrradiance = getLightProbeGridIrradiance( ( modelMatrix * probeAt ).xyz, vec3( 0.0, 1.0, 0.0 ) );
	#endif
}`;
    }
    // The engine's shaders as they came, patched afresh for the quality's
    // shader-deep settings (torch shadow samples, probes by vertex): every
    // material compiled from then on reads them. `direct3d`: the page is
    // drawn by Direct3D (`softTorchShadows`).
    const CHUNKS = ['shadowmap_pars_fragment', 'lights_fragment_begin', 'lightprobes_pars_fragment', 'shadowmap_pars_vertex', 'shadowmap_vertex'];
    let pristine = null;
    function patchShaders(T, { torchTaps, bounce }, direct3d = false) {
        pristine ??= Object.fromEntries(CHUNKS.map(k => [k, T.ShaderChunk[k]]));
        Object.assign(T.ShaderChunk, pristine);
        smoothShadows(T);
        softTorchShadows(T, torchTaps, direct3d);
        shadowsWhereLit(T);
        darkLightsSkipped(T);
        if (bounce) probesByVertex(T);
    }
    // What every character's material reads each frame, both uniforms
    // ({ value }), so the shader is one and the same for them all:
    // `ghost`: a fighter a ring of stealth hides (fighterKit.hidden; user,
    // 2026-10-06) is drawn thinned out, graphics.ghost of its pixels left out in the
    // pattern of the camera's cut (render/terrain_mesh.js). Nothing is
    // blended, so nothing needs sorting and its shadow stays.
    // `fade`: how far its colours go to grey in the natural light (the look's
    // `fade`; render/terrain_mesh.js `fadeLight`).
    // Drawn only: the body is hit as ever.
    function embodied(T, material, ghost, fade) {
        material.onBeforeCompile = shader => {
            shader.uniforms.ghost = ghost;
            terrainMesh.fadeLight(T, shader, fade);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
uniform float ghost;
float ghostDither(vec2 p) {
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    ivec2 i = ivec2(mod(p, 4.0));
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
}`)
                .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ghost > ghostDither(gl_FragCoord.xy)) discard;`);
        };
        return material;
    }
    return { patchShaders, embodied };
})();
