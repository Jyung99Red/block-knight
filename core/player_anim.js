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
    const footOf = (rig, side) => rig.parts.findIndex(p => p.tag === 'foot' && rig.bones[p.bone].name === `foot${side}`);

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
    // A move's keys say where the feet stand, not how the legs bend:
    // footR / footL is the ankle's place in the body's frame (pz forward,
    // px out from under its hip, py the boot's lowest point off the
    // ground) and the boot's tilt and turn (rx toe down, ry towards the
    // left). A foot a key leaves out stays where it is (the smite's: user,
    // 2026-10-09). The hips stand as high as at rest, pelvis py higher or
    // lower. Between keys a foot stands where it is, or is lifted and
    // stepped (`stepTo`); then each leg is turned to reach it (`reach`).
    const legRigs = new WeakMap();
    function legsOf(rig) {
        if (!legRigs.has(rig)) legRigs.set(rig, ['R', 'L'].map(side => {
            const thigh = rig.index[`thigh${side}`], shin = rig.index[`shin${side}`], foot = rig.index[`foot${side}`], boot = rig.parts[footOf(rig, side)];
            const corners = [];
            for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(boot.at.map((v, i) => v + [x, y, z][i] * boot.size[i] / 2));
            // How far the boot reaches below its ankle, tilted by rx.
            const under = rx => Math.min(...corners.map(c => c[1] * Math.cos(rx) - c[2] * Math.sin(rx)));
            return { names: [thigh, shin, foot].map(i => rig.bones[i].name), shin, hip: rig.bones[thigh].at, knee: -rig.bones[shin].at[1], ankle: -rig.bones[foot].at[1], under };
        }));
        return legRigs.get(rig);
    }
    // A foot: { x, z, y, rx, ry }, y the boot's lowest point off the ground.
    function footAt(rig, solved, l) {
        const m = solved.bones[rig.index[l.names[2]]];
        return { x: m[12], z: m[14], y: m[13] + l.under(Math.asin(-m[9])), rx: Math.asin(-m[9]), ry: Math.atan2(m[8], m[10]) };
    }
    // The rest's feet, and how high it stands (its base), as it is drawn
    // standing. Kept per rig and pose, but worked out anew on the move
    // tuner's page, whose edits change the poses.
    const rests = new WeakMap();
    function standOf(rig, rest) {
        const keep = globalThis.unfrozenConfig !== true;
        if (!rests.has(rig)) rests.set(rig, new WeakMap());
        if (keep && rests.get(rig).has(rest)) return rests.get(rig).get(rest);
        const pose = grounded(rig, rest), solved = rigKit.solve(rig, pose);
        const stand = { base: pose.base.py, feet: legsOf(rig).map(l => footAt(rig, solved, l)) };
        if (keep) rests.get(rig).set(rest, stand);
        return stand;
    }
    // Where a key puts the feet, the one it leaves out where it was (`held`).
    const placed = (rig, key, held) => legsOf(rig).map((l, i) => {
        const f = key[l.names[2]], k = rig.scale;
        return f ? { x: l.hip[0] + (f.px || 0) * k, z: (f.pz || 0) * k, y: (f.py || 0) * k, rx: f.rx || 0, ry: f.ry || 0 } : held[i];
    });
    // From feet `from` to `to` over s (0..1), each lifted on an arc as high
    // as its step is long allows (`raised` false: not lifted, where it
    // would be set down). Standing, one foot at a time (the one going
    // forward first, each taking the time its step is long, easing in and
    // out). `ahead`: how far the body itself goes meanwhile (s eased as it
    // goes), the feet going with it together; one that stays in the world
    // goes as far back in the body's frame, unlifted.
    function stepTo(from, to, s, ahead = 0, raised = true) {
        const F = playerPoses.feet, far = from.map((f, i) => Math.hypot(to[i].x - f.x, to[i].z + ahead - f.z));
        const first = to[0].z - from[0].z >= to[1].z - from[1].z ? 0 : 1, split = ahead ? 1 : far[first] / (far[0] + far[1] || 1);
        return from.map((f, i) => {
            const t = to[i], k = ahead ? s : smooth(clamp01(i === first ? s / (split || 1) : (s - split) / (1 - split || 1)));
            // A foot still in the air from the step before comes down meanwhile.
            const go = (a, b) => a + (b - a) * k, was = f.arc || 0;
            const arc = was * (1 - smooth(clamp01(2 * s))) + (raised ? Math.min(F.lift, F.liftPerBlock * far[i]) * Math.sin(Math.PI * k) : 0);
            return { x: go(f.x, t.x), z: go(f.z, t.z + ahead) - ahead * s, y: go(f.y - was, t.y) + arc, rx: go(f.rx, t.rx), ry: go(f.ry, t.ry), arc };
        });
    }
    // A move's recovery, from where its swing left the feet (`swung`; for
    // a move cut short, its key `b`) back to the rest: they keep the cut's
    // stance up to the derive point (the next move of a combo takes them as
    // they are), then step back. A move that keeps its feet is a finisher:
    // none goes on from it.
    function recoverFeet(rig, id, t, rest, swung, raised) {
        const m = gameConfig.combo.moves[id], start = m.derive || 0, home = standOf(rig, rest).feet;
        return stepTo(swung || placed(rig, playerMoves.moves[id].b, home), home, clamp01((t - start) / Math.max(1e-9, m.recovery - start)), 0, raised);
    }
    // The feet at a moment of the move `act`, in the body's frame as it is
    // then (the swing's step taken so far is behind it).
    function feetOf(rig, act, rest) {
        const m = gameConfig.combo.moves[act.move], K = playerMoves.moves[act.move], from = act.from;
        // Where the move found them: at rest, or in the recovery it cut short.
        const found = from ? recoverFeet(rig, from.move, from.t, rest) : standOf(rig, rest).feet;
        const a = placed(rig, K.a, from ? recoverFeet(rig, from.move, from.t, rest, null, false) : found);
        if (act.phase === 'windup') {
            const lead = act.lead || 0;
            return stepTo(found, a, clamp01(m.windup > lead ? (act.t - lead) / (m.windup - lead) : 1));
        }
        if (act.phase === 'charge') return a;
        // The swing: the feet go as the body goes its `step` forward
        // (core/fighter.js), easing out.
        const b = placed(rig, K.b, a);
        if (act.phase === 'swing') {
            const u = clamp01(act.t / m.swing);
            return stepTo(a, b, 1 - (1 - u) * (1 - u), (act.stepTotal ?? m.step) / gameConfig.world.unitsPerBlock * rig.scale);
        }
        return recoverFeet(rig, act.move, act.t, rest, b);
    }
    // A bone's angles (rx, ry, rz) for the turn `m` (a matrix).
    const anglesOf = m => ({ rx: Math.asin(Math.min(1, Math.max(-1, -m[9]))), ry: Math.atan2(m[8], m[10]), rz: Math.atan2(m[1], m[5]) });
    // The pose with its legs turned so the feet stand on `feet`: the hips
    // as the pose has them, standing as high as the rest does, lower only
    // where a foot would not reach the ground (so they do not bob up as it
    // lifts). Each knee bends forward, pointing the way its foot does; the
    // ankle turns the boot as the foot says.
    function reach(rig, pose, feet, rest) {
        const legs = legsOf(rig), k = rig.scale, out = { ...pose, base: { ...pose.base, py: standOf(rig, rest).base } };
        for (const l of legs) for (const name of l.names) delete out[name];
        const P = rigKit.solve(rig, out).bones[rig.index.pelvis], X = [P[0], P[1], P[2]], Y = [P[4], P[5], P[6]], Z = [P[8], P[9], P[10]];
        const goals = legs.map((l, i) => ({ H: math3d.transformPoint(P, l.hip), T: [feet[i].x, feet[i].y - l.under(feet[i].rx), feet[i].z] }));
        // Lower the hips where a straight leg would not reach the ground
        // under its foot, but only so far: past that the foot falls short.
        let drop = 0;
        goals.forEach(({ H, T }, i) => {
            const most = legs[i].knee + legs[i].ankle, flat = Math.hypot(T[0] - H[0], T[2] - H[2]);
            drop = Math.max(drop, H[1] - T[1] + (feet[i].arc || 0) - Math.sqrt(Math.max(0, most * most - flat * flat)));
        });
        drop = Math.min(drop, playerPoses.feet.sink * k);
        out.base.py -= drop / k;
        goals.forEach(({ H, T }, i) => {
            const l = legs[i], w = [T[0] - H[0], T[1] - H[1] + drop, T[2] - H[2]];
            // In the hips' frame, then out of the turn the thigh takes.
            const t = [math3d.dot(w, X), math3d.dot(w, Y), math3d.dot(w, Z)], ry = feet[i].ry - (pose.base?.ry || 0) - (pose.pelvis?.ry || 0);
            const u = [Math.cos(ry) * t[0] - Math.sin(ry) * t[2], t[1], Math.sin(ry) * t[0] + Math.cos(ry) * t[2]];
            // The knee bends for the reach d (thigh and shin, law of cosines).
            const d = Math.min(l.knee + l.ankle, Math.max(Math.abs(l.knee - l.ankle) + 1e-6, Math.hypot(...u)));
            const shin = Math.acos(Math.min(1, Math.max(-1, (d * d - l.knee * l.knee - l.ankle * l.ankle) / (2 * l.knee * l.ankle))));
            const v = [0, -l.knee - l.ankle * Math.cos(shin), -l.ankle * Math.sin(shin)], g = u.map(c => c * d / (Math.hypot(...u) || 1));
            // The thigh: out to the side (rz), then forward or back (rx).
            const rz = Math.asin(Math.min(1, Math.max(-1, -g[0] / v[1]))), rx = Math.atan2(g[2], g[1]) - Math.atan2(v[2], Math.cos(rz) * v[1]);
            out[l.names[0]] = { rx: Math.atan2(Math.sin(rx), Math.cos(rx)), ry, rz };
            out[l.names[1]] = { rx: shin };
        });
        // The ankle: the boot's turn in the body's frame, less the shin's.
        const solved = rigKit.solve(rig, out);
        legs.forEach((l, i) => {
            const S = solved.bones[l.shin], St = [S[0], S[4], S[8], 0, S[1], S[5], S[9], 0, S[2], S[6], S[10], 0, 0, 0, 0, 1];
            out[l.names[2]] = anglesOf(math3d.multiply(St, math3d.compose(0, 0, 0, feet[i].rx, feet[i].ry, 0)));
        });
        return out;
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
        let pose = locomotion(rig, body), stepping = 1, standing = false;
        const act = body.act, lowerBody = playerModel.layers.lower, rest = restOf(body.loadout);
        // A torch is carried up and forward when the arm is not busy (a
        // move cross-fades in over the carry, and goes back to it).
        if (rest !== playerPoses.stance) pose = { ...pose, ...playerMoves.torch };
        if (act) {
            // Out of a walk the move cross-fades in; out of a move it does not need to.
            const w = act.from || act.phase !== 'windup' ? 1 : clamp01((act.t - (act.lead || 0)) / BLEND());
            if (act.phase !== 'charge') stepping = 1 - w;
            // The legs stand the body on its feet (feetOf, reach). Out of a
            // standstill they are the move's at once: its feet start where
            // the rest has them.
            const legs = 1 - (1 - w) * (body.moveBlend || 0);
            let moving = reach(rig, movePose(act, rest), feetOf(rig, act, rest), rest);
            // Charging may walk: the legs walk under the held charge, like
            // under a raised shield, and the body rests on them as walking.
            standing = legs === 1 && !(act.phase === 'charge' && body.moveBlend > 0);
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
        if (standing && !body.down) return rigKit.add(pose);
        const air = lift(rig, body.gait, body.runBlend || 0) * body.moveBlend * stepping;
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
