// The main character's pose as a pure function of simulation state
// (design.md 2.3): stance, walk, run, moves, guard (shield or blade) and
// flinch depend only on what the simulation holds, so the host and a guest
// pose a body the same way, and a hit test sees what is drawn. `present`
// adds what is drawn but never tested (breathing, leaning, trembling).
const playerAnim = (() => {
    const cycles = new WeakMap();
    const BLEND = () => gameConfig.animation.blendSeconds;
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const easeOut = t => 1 - (1 - t) * (1 - t);
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const smooth = t => t * t * (3 - 2 * t);
    const footOf = (rig, side) => rig.parts.findIndex(p => p.tag === 'foot' && rig.bones[p.bone].name === `shin${side}`);

    // Catmull-Rom through a closed loop of poses; phase in [0, 1).
    function loop(keys, phase) {
        const n = keys.length, f = ((phase % 1) + 1) % 1 * n, i = Math.floor(f), t = f - i;
        const P = k => keys[((i + k) % n + n) % n];
        const t2 = t * t, t3 = t2 * t;
        const w = [0.5 * (-t + 2 * t2 - t3), 0.5 * (2 - 5 * t2 + 3 * t3), 0.5 * (t + 4 * t2 - 3 * t3), 0.5 * (t3 - t2)];
        return rigKit.add(...[-1, 0, 1, 2].map((k, j) => rigKit.scale(P(k), w[j])));
    }
    // A gait's keys for one step, then the same mirrored for the other.
    const cycleKeys = list => [...list, ...list.map(rigKit.mirror)];
    const keyed = {};
    const keysOf = (name, part) => keyed[`${name}.${part}`] || (keyed[`${name}.${part}`] = cycleKeys(playerPoses[name][part]));

    // Raise or lower the whole body so its lowest box rests on the ground.
    function grounded(rig, pose) {
        const low = rigKit.lowest(rig, rigKit.solve(rig, pose));
        return rigKit.add(pose, { base: { py: -low / rig.scale } });
    }
    // A pure gait, measured once per skeleton. Each step starts as the
    // right foot comes down (key 0) and stays down for `stance` of the
    // cycle: the whole step walking; running, up to the last key of the
    // step, then both feet are off the ground until the other foot comes
    // down (models/player_poses.js). `length`: world units covered by one
    // full cycle, so that the body goes as far over the stance as the
    // planted foot goes back. The keys swing the legs on curves, so the
    // foot would go back unevenly against the body's even progress; `warp`
    // (PLANT + 1 samples) times the keys along the stance instead, so the
    // foot keeps pace with the ground and the body need not surge.
    const PLANT = 24;
    function measure(rig, name) {
        const foot = footOf(rig, 'R'), keys = keysOf(name, 'legs'), n = keys.length / 2;
        const stance = playerPoses[name].flight ? 0.5 * (n - 1) / n : 0.5;
        const z = phase => rigKit.solve(rig, grounded(rig, loop(keys, phase))).parts[foot][14];
        // Where the curve turns the foot forward a hair, it holds still instead.
        const N = 120, zs = [z(0)];
        for (let i = 1; i <= N; i++) zs.push(Math.min(zs[i - 1], z(i / N * stance)));
        const back = zs[0] - zs[N];
        if (!(back > 0)) throw new Error(`The ${name} keys must move the planted foot backwards`);
        const warp = [0];
        for (let k = 1, i = 0; k < PLANT; k++) {
            const target = zs[0] - k / PLANT * back;
            while (zs[i + 1] > target) i++;
            warp.push((i + (zs[i] - target) / Math.max(1e-12, zs[i] - zs[i + 1])) / N * stance);
        }
        warp.push(stance);
        const g = { length: back / stance * gameConfig.world.unitsPerBlock, stance, warp, air: null };
        // In the air the legs no longer hold the body up: it carries on from
        // the toe-off as it was rising, arcs `flight.height` higher, and
        // comes down to meet the touchdown (a smooth curve over the
        // grounded heights). `air` (PLANT + 1 samples over the flight) is
        // how far above the grounded pose that is, never below it.
        const F = playerPoses[name].flight;
        if (F) {
            const rise = phase => -rigKit.lowest(rig, rigKit.solve(rig, loop(keys, keyPhase(g, phase)))) / rig.scale, e = 1e-3, span = 0.5 - stance;
            const y0 = rise(stance), v0 = (y0 - rise(stance - e)) / e * span, y1 = rise(0.5), v1 = (rise(0.5 + e) - y1) / e * span;
            g.air = Array.from({ length: PLANT + 1 }, (_, k) => {
                const v = k / PLANT, v2 = v * v, v3 = v2 * v;
                const arc = (2 * v3 - 3 * v2 + 1) * y0 + (v3 - 2 * v2 + v) * v0 + (3 * v2 - 2 * v3) * y1 + (v3 - v2) * v1 + F.height * 4 * v * (1 - v);
                return Math.max(0, arc - rise(stance + v * span));
            });
        }
        return g;
    }
    const gaitOf = rig => {
        if (!cycles.has(rig)) cycles.set(rig, { walk: measure(rig, 'walk'), run: measure(rig, 'run') });
        return cycles.get(rig);
    };
    // Cycle length for a walk-to-run blend; the simulation advances the gait
    // phase by distance over this.
    function cycleLength(rig, runBlend = 0) {
        const c = gaitOf(rig);
        return c.walk.length + (c.run.length - c.walk.length) * runBlend;
    }
    const halfOf = phase => ((phase % 0.5) + 0.5) % 0.5;
    // The key phase shown at gait phase `phase`: along the stance, timed so
    // the planted foot keeps pace with the ground; in the air, as it comes.
    function keyPhase(g, phase) {
        const half = halfOf(phase);
        if (half >= g.stance) return phase;
        const f = half / g.stance * PLANT, i = Math.min(PLANT - 1, Math.floor(f));
        return phase - half + g.warp[i] + (g.warp[i + 1] - g.warp[i]) * (f - i);
    }
    function legs(rig, phase, moveBlend, runBlend) {
        const c = gaitOf(rig), stride = rigKit.mix(loop(keysOf('walk', 'legs'), keyPhase(c.walk, phase)), loop(keysOf('run', 'legs'), keyPhase(c.run, phase)), runBlend);
        return rigKit.mix(rigKit.pick(playerPoses.stance, playerModel.layers.lower), stride, moveBlend);
    }
    // Running, the body is off the ground between strides (model units
    // above the grounded pose).
    function lift(rig, phase, runBlend) {
        const g = gaitOf(rig).run, half = halfOf(phase);
        if (!g.air || !(runBlend > 0) || half < g.stance) return 0;
        const f = (half - g.stance) / (0.5 - g.stance) * PLANT, i = Math.min(PLANT - 1, Math.floor(f));
        return (g.air[i] + (g.air[i + 1] - g.air[i]) * (f - i)) * runBlend;
    }
    function locomotion(rig, body) {
        const P = playerPoses, run = body.runBlend || 0;
        const swing = name => rigKit.add(loop(keysOf(name, 'arms'), body.gait), P[name].carry || {});
        const arms = rigKit.mix(swing('walk'), swing('run'), run);
        const upper = rigKit.add(rigKit.pick(P.stance, playerModel.layers.upper), rigKit.scale(arms, body.moveBlend));
        return rigKit.add(legs(rig, body.gait, body.moveBlend, run), upper);
    }
    // A move in progress, `act` = { move, phase, t, lead, from }: the windup
    // eases from wherever the previous move's recovery had got to (or the
    // rest) into key `a` -- over what is left of it after `lead`, the time
    // the attack key took to tell A from B; the swing goes `a` to `b`; the
    // recovery back to the rest. `rest`: the stance, or what the body
    // stands in between moves (restOf).
    function movePose(act, rest = playerPoses.stance) {
        const K = playerMoves.moves[act.move], m = gameConfig.combo.moves[act.move];
        if (act.phase === 'windup') {
            const from = act.from ? movePose({ move: act.from.move, phase: 'recover', t: act.from.t }, rest) : rest, lead = act.lead || 0;
            return rigKit.mix(from, K.a, easeOut(clamp01(m.windup > lead ? (act.t - lead) / (m.windup - lead) : 1)));
        }
        if (act.phase === 'charge') return K.a;
        if (act.phase === 'swing') return rigKit.mix(K.a, K.b, smooth(clamp01(act.t / m.swing)));
        return rigKit.mix(K.b, rest, easeInOut(clamp01(act.t / m.recovery)));
    }
    // The stance a move comes out of and goes back to: a carried torch is
    // held up and forward, so a move's recovery brings the left arm back up
    // to it (not to the stance's, whence the arm would jump to the torch as
    // the move ended). Worked out once; made anew each time on the move
    // tuner's page (its config unfrozen), whose edits change the poses.
    let torchRest = null;
    function restOf(loadout) {
        if (inventoryKit.offhandOf(loadout) !== 'torch') return playerPoses.stance;
        if (globalThis.unfrozenConfig === true) return { ...playerPoses.stance, ...playerMoves.torch };
        return torchRest ??= Object.freeze({ ...playerPoses.stance, ...playerMoves.torch });
    }

    // ---- the feet in a move (design.md 2.4): they never slide ----
    // A foot is planted, standing where it is on the ground (through the
    // swing's step too: the body goes on over it), or stepping: lifted off
    // and set down where the next key puts it. Keys say where the feet go
    // (`spotsOf`); a move without a step keeps both feet where it found
    // them (user, 2026-10-09). The legs are then turned to reach (`reach`):
    // the hips as high as the keys hold them, lower only where a foot
    // cannot reach.
    const legRigs = new WeakMap();
    function legsOf(rig) {
        if (!legRigs.has(rig)) legRigs.set(rig, ['R', 'L'].map(side => {
            const thigh = rig.index[`thigh${side}`], shin = rig.index[`shin${side}`], foot = footOf(rig, side);
            const knee = rig.bones[shin].at[1], sole = rig.parts[foot].at, r = Math.hypot(sole[1], sole[2]);
            return { thigh, shin, foot, hip: rig.bones[thigh].at, knee, sole, r, bend: Math.atan2(sole[2], -sole[1]), long: Math.abs(knee) + r };
        }));
        return legRigs.get(rig);
    }
    // Where a pose stands its feet: [x, z, y] in the body's frame,
    // grounded, y the height of the boot's middle (a key may hold a foot a
    // little off the ground: it is kept so, the key as it was made). Kept
    // per rig and key, but worked out anew on the move tuner's page, whose
    // edits change the keys.
    const spotRigs = new WeakMap();
    function spotsOf(rig, pose) {
        const keep = globalThis.unfrozenConfig !== true;
        if (!spotRigs.has(rig)) spotRigs.set(rig, new WeakMap());
        const kept = spotRigs.get(rig);
        if (keep && kept.has(pose)) return kept.get(pose);
        const solved = rigKit.solve(rig, grounded(rig, pose));
        const spots = legsOf(rig).map(l => [solved.parts[l.foot][12], solved.parts[l.foot][14], solved.parts[l.foot][13]]);
        if (keep) kept.set(pose, spots);
        return spots;
    }
    // From spots `from` to `to` over s (0..1), each foot lifted on an arc
    // as high as its step is long allows (`raised` false: not lifted, where
    // it would be set down); [x, z, y, arc] each, y counting the arc.
    // Standing, one foot at a time (the one going forward first, each
    // taking the time its step is long, easing in and out). `ahead`: how
    // far the body itself goes meanwhile (s eased as it goes), the feet
    // going with it together; one that stays in the world goes as far back
    // in the body's frame, unlifted.
    function stepTo(from, to, s, ahead = 0, raised = true) {
        const F = playerPoses.feet, far = from.map((f, i) => Math.hypot(to[i][0] - f[0], to[i][1] + ahead - f[1]));
        const first = to[0][1] - from[0][1] >= to[1][1] - from[1][1] ? 0 : 1, split = ahead ? 1 : far[first] / (far[0] + far[1] || 1);
        return from.map((f, i) => {
            const t = to[i], k = ahead ? s : smooth(clamp01(i === first ? s / (split || 1) : (s - split) / (1 - split || 1)));
            // A foot still in the air from the step before comes down meanwhile.
            const was = f[2] - (f[3] || 0), arc = (f[3] || 0) * (1 - smooth(clamp01(2 * s))) + (raised ? Math.min(F.lift, F.liftPerBlock * far[i]) * Math.sin(Math.PI * k) : 0);
            return [f[0] + (t[0] - f[0]) * k, f[1] + (t[1] + ahead - f[1]) * k - ahead * s, was + (t[2] - was) * k + arc, arc];
        });
    }
    const stillOf = id => { const m = gameConfig.combo.moves[id]; return !m.step && !m.chargeStep; };
    // A move's recovery, from where its swing left the feet back to the
    // rest: they keep the cut's stance up to the derive point (the next move
    // of a combo takes them as they are), then step back.
    function recoverFeet(rig, id, t, rest, swungTo, raised) {
        const m = gameConfig.combo.moves[id], start = m.derive || 0;
        return stepTo(swungTo, spotsOf(rig, rest), clamp01((t - start) / Math.max(1e-9, m.recovery - start)), 0, raised);
    }
    // Where a move's swing left the feet: on its key `b`, or, for a move
    // without a step, where it found them (`from`: what it cut short).
    const swungOf = (rig, id, from, rest) => stillOf(id) ? foundOf(rig, from, rest, false) : spotsOf(rig, playerMoves.moves[id].b);
    // Where a move found the feet: the rest, or the recovery it cut short.
    const foundOf = (rig, from, rest, raised = true) => from ? recoverFeet(rig, from.move, from.t, rest, swungOf(rig, from.move, from.from, rest), raised) : spotsOf(rig, rest);
    // The feet at a moment of the move `act`, in the body's frame as it is
    // then (the swing's step taken so far is behind it). A move without a
    // step sets them down where it found them, and they stay there.
    function feetOf(rig, act, rest) {
        const m = gameConfig.combo.moves[act.move], K = playerMoves.moves[act.move], still = stillOf(act.move);
        const found = foundOf(rig, act.from, rest), a = still ? foundOf(rig, act.from, rest, false) : spotsOf(rig, K.a);
        if (act.phase === 'windup') {
            const lead = act.lead || 0;
            return stepTo(found, a, clamp01(m.windup > lead ? (act.t - lead) / (m.windup - lead) : 1));
        }
        if (act.phase === 'charge') return a;
        // The swing: the feet go as the body goes its `step` forward
        // (core/fighter.js), easing out; one the keys leave where it stood
        // in the world stays planted.
        const b = still ? a : spotsOf(rig, K.b);
        if (act.phase === 'swing') {
            const u = clamp01(act.t / m.swing);
            return stepTo(a, b, 1 - (1 - u) * (1 - u), (act.stepTotal ?? m.step) / gameConfig.world.unitsPerBlock);
        }
        return recoverFeet(rig, act.move, act.t, rest, b);
    }
    // Turn the legs of `pose` so the feet stand on `feet` ([x, z, y, arc]
    // in the body's frame, y the boot's middle). The hips go down for a foot
    // that would not reach the ground under its arc (so they do not bob up
    // as it lifts). The thigh keeps its turn (ry) from the pose, less the
    // hips'; the knee bends as the pose has it, never backwards. With no
    // ankle, a boot rocks on its heel or toe as the leg tilts (never into
    // the ground, and clear of it when stepping). Also gives `low`, the
    // body's lowest point, so the ground does not move it.
    function reach(rig, pose, feet) {
        const legs = legsOf(rig), k = rig.scale, out = grounded(rig, pose), solved = rigKit.solve(rig, out);
        const P = solved.bones[rig.index.pelvis], X = [P[0], P[1], P[2]], Y = [P[4], P[5], P[6]], Z = [P[8], P[9], P[10]];
        const goals = legs.map((l, i) => ({ H: math3d.transformPoint(P, l.hip), T: [feet[i][0], feet[i][2], feet[i][1]], arc: feet[i][3] || 0 }));
        // Lower the hips where a straight leg would not reach, but only so
        // far: past that the foot falls short (a long lunge drags it).
        let drop = 0;
        goals.forEach(({ H, T, arc }, i) => {
            const flat = Math.hypot(T[0] - H[0], T[2] - H[2]), most = legs[i].long;
            drop = Math.max(drop, H[1] - T[1] + arc - Math.sqrt(Math.max(0, most * most - flat * flat)));
        });
        drop = Math.min(drop, playerPoses.feet.sink * k);
        out.base = { ...out.base, py: (out.base?.py || 0) - drop / k };
        const aim = (l, H, T) => {
            const w = [T[0] - H[0], T[1] - H[1] + drop, T[2] - H[2]];
            // In the hips' frame, then out of the thigh's turn; turning the
            // hips does not turn the planted feet.
            const t = [math3d.dot(w, X), math3d.dot(w, Y), math3d.dot(w, Z)], ry = (pose[rig.bones[l.thigh].name]?.ry || 0) - (pose.pelvis?.ry || 0);
            const u = [Math.cos(ry) * t[0] - Math.sin(ry) * t[2], t[1], Math.sin(ry) * t[0] + Math.cos(ry) * t[2]];
            const d = Math.min(l.long, Math.max(Math.abs(Math.abs(l.knee) - l.r) + 1e-6, Math.hypot(...u)));
            // The knee: how far it bends for the reach d. Of the two ways,
            // the one nearer the pose's (a key may hold it a hair past
            // straight), but never bent backwards.
            const c = (d * d - l.knee * l.knee - l.r * l.r) / (2 * l.knee), was = pose[rig.bones[l.shin].name]?.rx || 0;
            const A = Math.acos(Math.min(1, Math.max(-1, -c / l.r))), shin = l.bend - A >= -0.02 && Math.abs(l.bend - A - was) < Math.abs(l.bend + A - was) ? l.bend - A : l.bend + A;
            const v = [0, l.knee + l.sole[1] * Math.cos(shin) - l.sole[2] * Math.sin(shin), l.sole[1] * Math.sin(shin) + l.sole[2] * Math.cos(shin)];
            const s = d / (Math.hypot(...u) || 1), g = [u[0] * s, u[1] * s, u[2] * s];
            // The thigh: out to the side (rz), then forward or back (rx).
            const rz = Math.asin(Math.min(1, Math.max(-1, -g[0] / v[1])));
            const rx = Math.atan2(g[2], g[1]) - Math.atan2(v[2], Math.cos(rz) * v[1]);
            out[rig.bones[l.thigh].name] = { rx: Math.atan2(Math.sin(rx), Math.cos(rx)), ry, rz };
            out[rig.bones[l.shin].name] = { rx: shin };
        };
        goals.forEach(({ H, T }, i) => aim(legs[i], H, T));
        // A boot tipped into the ground (toe or heel), or dragging it when
        // stepping, is raised: its lowest corner as high as its arc.
        const tipped = rigKit.solve(rig, out);
        goals.forEach(({ H, T, arc }, i) => {
            const under = arc - Math.min(...math3d.corners(math3d.obb(tipped.parts[legs[i].foot], rig.parts[legs[i].foot].size.map(v => v / 2))).map(c => c[1]));
            if (under > 0) aim(legs[i], H, [T[0], T[1] + under, T[2]]);
        });
        return { pose: out, low: rigKit.lowest(rig, rigKit.solve(rig, out)) };
    }

    // The legs under a guard. The pose's legs are the stance's turning into
    // the stride by moveBlend: the guard's standing legs take the stance's
    // share, and the stride's share is bent.
    function guardLegs(pose, moveBlend) {
        const lower = playerModel.layers.lower, stance = rigKit.pick(playerPoses.stance, lower);
        return rigKit.add(rigKit.pick(pose, lower), rigKit.scale(rigKit.add(playerMoves.guardLegs, rigKit.scale(stance, -1)), 1 - moveBlend), rigKit.scale(playerMoves.guardBend, moveBlend));
    }
    // How far a perfect parry's shove is out (fighter.shoveOut, shoveFor),
    // as a share of the way from the guard to its shoved pose. First it
    // gives: driven back the other way by combat.guard.shove `give` as the
    // blow is taken. Then it snaps out from there to the pose, fastest at
    // the start, and comes straight back, easing out and in.
    function shoveShare(body) {
        const S = gameConfig.combat.guard.shove, level = clamp01(body.shoveOut || 0);
        if (!(body.shoveFor > 0)) return smooth(level);
        const given = S.give * easeOut(clamp01(1 - (body.shoveFor - S.out) / S.in)), k = easeOut(level);
        return k - given * (1 - k);
    }
    // The judged pose. `body` needs { gait, moveBlend, runBlend }, and for a
    // fighter { act, guardBlend, shoveOut, shoveFor, stun, down, downT, drink,
    // handOut, loadout }.
    function pose(rig, body) {
        let pose = locomotion(rig, body), stepping = 1, footing = 0;
        const act = body.act, lowerBody = playerModel.layers.lower, rest = restOf(body.loadout);
        // A torch is carried up and forward when the arm is not busy (a
        // move cross-fades in over the carry, and goes back to it).
        if (rest !== playerPoses.stance) pose = { ...pose, ...playerMoves.torch };
        if (act) {
            // Out of a walk the move cross-fades in; out of a move it does not need to.
            const w = act.from || act.phase !== 'windup' ? 1 : clamp01((act.t - (act.lead || 0)) / BLEND());
            if (act.phase !== 'charge') stepping = 1 - w;
            // The feet planted, or stepping (feetOf), and the body as high as
            // they put it (with both off the ground at once, it is up too).
            // Standing, the legs are the move's at once: its feet start where
            // the stance has them.
            const legs = 1 - (1 - w) * (body.moveBlend || 0), placed = reach(rig, movePose(act, rest), feetOf(rig, act, rest));
            let moving = placed.pose;
            footing = placed.low * legs;
            // Charging may walk: the legs walk under the held charge, like
            // under a raised shield.
            if (act.phase === 'charge') moving = { ...moving, ...rigKit.mix(rigKit.pick(moving, lowerBody), rigKit.pick(pose, lowerBody), body.moveBlend) };
            pose = { ...rigKit.mix(pose, moving, w), ...rigKit.mix(rigKit.pick(pose, lowerBody), rigKit.pick(moving, lowerBody), legs) };
        }
        // Interacting: the left hand goes a little forward (not in a move).
        if (!act && body.handOut > 0) pose = rigKit.mix(pose, { ...pose, ...playerMoves.reach }, smooth(clamp01(body.handOut)));
        // Guarding: the shield up if one is carried, else the blade across
        // the chest (the left arm keeps what it holds); either way the knees
        // bend (guardLegs). A perfect parry shoves the guarding arm forward
        // and lets it come back (shoveShare): part of the guard, so it goes
        // as the guard goes.
        if (body.guardBlend > 0) {
            const legs = guardLegs(pose, body.moveBlend || 0), shield = inventoryKit.offhandOf(body.loadout) === 'shield';
            const held = shield ? playerMoves.guard : playerMoves.guardWeapon, shoved = shield ? playerMoves.guardShove : playerMoves.guardWeaponShove;
            const up = body.shoveOut > 0 || body.shoveFor > 0 ? rigKit.mix(held, shoved, shoveShare(body)) : held;
            const raised = shield ? { ...legs, ...up } : { ...pose, ...legs, ...up };
            pose = rigKit.mix(pose, raised, body.guardBlend);
        }
        // Drinking: the flask comes up over a fifth of a second, stays, and
        // goes down over the last tenth.
        const d = body.drink;
        if (d?.phase === 'drink') {
            const S = gameConfig.combat.potion.seconds, k = Math.min(clamp01(d.t / 0.2), clamp01((S - d.t) / 0.1));
            pose = rigKit.mix(pose, { ...rigKit.pick(pose, lowerBody), ...playerMoves.drink }, smooth(k));
        }
        if (body.down) { pose = rigKit.mix(pose, playerMoves.down, easeOut(clamp01(body.downT / 0.5))); stepping = 0; }
        if (body.stun > 0) {
            // Thrown back over the first fifth of the stun, then easing back.
            const left = clamp01(body.stun / gameConfig.combat.hitStun), k = left > 0.8 ? (1 - left) / 0.2 : left / 0.8;
            pose = rigKit.add(pose, rigKit.scale(playerMoves.flinch, k));
        }
        const air = lift(rig, body.gait, body.runBlend || 0) * body.moveBlend * stepping + (body.down ? 0 : footing);
        return air > 0 ? rigKit.add(grounded(rig, pose), { base: { py: air } }) : grounded(rig, pose);
    }
    // Drawn-only additions. `look` = { time, lean } (lean in radians).
    function present(judged, body, look) {
        const B = playerPoses.breath, s = Math.sin(look.time * B.rate) * (1 - body.moveBlend) * (body.act || body.down ? 0 : 1);
        const shake = body.act?.phase === 'charge' ? Math.sin(look.time * 70) * 0.012 : 0;
        return rigKit.add(judged, {
            base: { rz: look.lean || 0 },
            chest: { rx: B.chest * s, ry: shake }, head: { rx: B.head * s },
            upperArmR: { rz: -B.arms * s, ry: shake }, upperArmL: { rz: B.arms * s }
        });
    }
    return { pose, present, movePose, cycleLength, loop, gaitOf };
})();
