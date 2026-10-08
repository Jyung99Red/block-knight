// The move tuner's workbench (tune.html, a desktop page): everything the
// tuner does that is neither drawing nor the page itself. No DOM and no
// three.js, so the Node tests run it (tests/tune.test.cjs).
// - Editing: a key pose is changed where the game reads it (playerMoves,
//   playerPoses), copy on write, so keys that share a bone object (the
//   shield arm) stay apart; a bone is given its angles one by one, or
//   turned about its own axes; move timing is changed in gameConfig, which
//   the tuner's page loads unfrozen. A draft is what differs from the
//   files as they were loaded; nothing is written to the files from here.
// - Previews ("recordings"): one move from the stance, worked out
//   directly; a combo played through the real simulation with the attack
//   key pressed at the latest moment that still chains at full speed; or
//   one of the other poses (guard, drink, ...). Each answers stateAt(time)
//   with the body as the game would pose it.
// - Checks: a swing measured the way tests/hits.test.cjs measures it.
// - Export: what changed, as source text to paste back into the files.
const moveLab = (() => {
    const K = () => gameConfig.combo, MOVES = () => gameConfig.combo.moves;
    const STEP = simLoop.STEP, CHANNELS = rigKit.CHANNELS;
    // Bones in the order the files write them.
    const BONES = Object.freeze(playerModel.bones.map(b => b.name));
    const clone = v => JSON.parse(JSON.stringify(v));
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const round = (v, places = 3) => { const k = 10 ** places; return Math.round(v * k) / k || 0; };

    // ---- what can be edited ----
    // A move's key is named 'slash.a'; the other poses by their own names.
    const POSES = Object.freeze({
        stance: { name: '站姿', file: 'models/player_poses.js', of: () => playerPoses.stance },
        guard: { name: '举盾', file: 'models/player_moves.js', of: () => playerMoves.guard },
        guardShove: { name: '弹反·盾往前推', file: 'models/player_moves.js', of: () => playerMoves.guardShove },
        guardWeapon: { name: '横剑格挡', file: 'models/player_moves.js', of: () => playerMoves.guardWeapon },
        guardWeaponShove: { name: '弹反·武器往前推', file: 'models/player_moves.js', of: () => playerMoves.guardWeaponShove },
        guardLegs: { name: '格挡·站着的腿', file: 'models/player_moves.js', of: () => playerMoves.guardLegs },
        guardBend: { name: '格挡·走路弯膝（叠加）', file: 'models/player_moves.js', of: () => playerMoves.guardBend },
        drink: { name: '喝药', file: 'models/player_moves.js', of: () => playerMoves.drink },
        torch: { name: '举火把', file: 'models/player_moves.js', of: () => playerMoves.torch },
        reach: { name: '交互（左手往前）', file: 'models/player_moves.js', of: () => playerMoves.reach },
        flinch: { name: '受击（叠加）', file: 'models/player_moves.js', of: () => playerMoves.flinch },
        down: { name: '倒地', file: 'models/player_moves.js', of: () => playerMoves.down }
    });
    const KEYS = ['a', 'b'];
    // Timing fields a move may have (gameConfig.combo.moves); steps are whole world units.
    const TIMING = Object.freeze(['windup', 'swing', 'recovery', 'derive', 'step', 'chargeStep']);
    const WHOLE = new Set(['step', 'chargeStep']);
    const targets = () => [...Object.keys(playerMoves.moves).flatMap(id => KEYS.map(k => `${id}.${k}`)), ...Object.keys(POSES)];
    function poseOf(target) {
        const [id, key, extra] = String(target).split('.');
        if (key !== undefined) {
            if (extra !== undefined || !KEYS.includes(key) || !Object.hasOwn(playerMoves.moves, id)) throw new Error(`Unknown key ${target}`);
            return playerMoves.moves[id][key];
        }
        if (!Object.hasOwn(POSES, id)) throw new Error(`Unknown pose ${target}`);
        return POSES[id].of();
    }
    const known = target => { try { poseOf(target); return true; } catch (_) { return false; } };
    // The files as loaded, before any draft.
    const original = {
        poses: Object.fromEntries(targets().map(t => [t, clone(poseOf(t))])),
        timing: Object.fromEntries(Object.entries(MOVES()).map(([id, m]) => [id, Object.fromEntries(TIMING.filter(k => k in m).map(k => [k, m[k]]))]))
    };

    // Poses are sparse: a missing channel is 0.
    function samePose(a, b) {
        for (const bone of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
            for (const c of CHANNELS) if (Math.abs((a?.[bone]?.[c] || 0) - (b?.[bone]?.[c] || 0)) > 1e-9) return false;
        }
        return true;
    }
    // Only real bones and channels, finite numbers, zeros left out.
    function clean(pose) {
        const out = {};
        for (const [bone, p] of Object.entries(pose || {})) {
            if (!BONES.includes(bone) || !p || typeof p !== 'object') continue;
            const o = {};
            for (const [c, v] of Object.entries(p)) if (CHANNELS.includes(c) && Number.isFinite(v) && v !== 0) o[c] = v;
            out[bone] = o;
        }
        return out;
    }
    // One channel of one bone; 0 takes the channel out.
    function set(target, bone, channel, value) {
        if (!BONES.includes(bone) || !CHANNELS.includes(channel) || !Number.isFinite(value)) throw new Error(`Cannot set ${bone}.${channel} to ${value}`);
        const pose = poseOf(target), next = { ...(pose[bone] || {}) };
        value = round(value);
        if (value === 0) delete next[channel]; else next[channel] = value;
        // A bone the shield arm fills stays named, empty, so the arm stays at rest.
        if (Object.keys(next).length || (target.includes('.') && playerMoves.shieldArm[bone])) pose[bone] = next;
        else delete pose[bone];
    }
    // The whole pose at once (fresh objects, nothing shared).
    function replace(target, pose) {
        const live = poseOf(target);
        for (const bone of Object.keys(live)) delete live[bone];
        Object.assign(live, clean(clone(pose)));
    }
    const changed = target => !samePose(poseOf(target), original.poses[target]);

    const timingEditable = () => !Object.isFrozen(MOVES()) && !Object.isFrozen(MOVES()[Object.keys(MOVES())[0]]);
    // windup, swing and recovery at least one step; derive within the recovery.
    function setTiming(id, field, value) {
        const m = MOVES()[id];
        if (!m || !TIMING.includes(field) || !(field in m) || !Number.isFinite(value)) throw new Error(`Cannot set ${id}.${field}`);
        if (!timingEditable()) throw new Error('gameConfig is frozen: move timing is changed on the tuner page only');
        if (WHOLE.has(field)) m[field] = Math.round(value);
        else if (field === 'derive') m[field] = round(Math.min(m.recovery, Math.max(0, value)), 2);
        else {
            m[field] = round(Math.max(STEP, value), 2);
            if (field === 'recovery' && m.derive != null && m.derive > m[field]) m.derive = m[field];
        }
    }
    const timingChanged = id => Object.entries(original.timing[id] || {}).some(([k, v]) => MOVES()[id][k] !== v);
    const moveChanged = id => KEYS.some(k => changed(`${id}.${k}`)) || timingChanged(id);

    // What differs from the files, as plain data (the page keeps it in
    // localStorage). Each entry carries `base`, the files' value it was
    // made on, so that a later change to the files is noticed (`apply`).
    function draft() {
        const poses = {}, timing = {};
        for (const t of targets()) if (changed(t)) poses[t] = { pose: clone(poseOf(t)), base: clone(original.poses[t]) };
        for (const id of Object.keys(original.timing)) {
            if (timingChanged(id)) timing[id] = { values: Object.fromEntries(Object.keys(original.timing[id]).map(k => [k, MOVES()[id][k]])), base: { ...original.timing[id] } };
        }
        return { version: 2, poses, timing };
    }
    // Put a draft back, entry by entry. Left out: what the files already
    // hold (`done`: written back), what the files changed since the entry
    // was made (`stale`: the files win, unless `force`), and what the files
    // no longer have. Returns the names of each ('slash.a', 'stance', and
    // 'slash.timing' for a move's timing) and `leftover`, the stale
    // entries as a draft of their own, to force in later.
    function apply(d, { force = false } = {}) {
        const out = { applied: [], done: [], stale: [], leftover: { version: 2, poses: {}, timing: {} } };
        // A draft from before `base` was kept holds bare values.
        const v2 = d?.version === 2;
        for (const [t, e] of Object.entries(d?.poses || {})) {
            if (!known(t)) continue;
            const pose = v2 ? e?.pose : e, base = v2 ? e?.base : null, file = original.poses[t];
            if (!pose || typeof pose !== 'object') continue;
            if (samePose(pose, file)) out.done.push(t);
            else if (!force && base && !samePose(base, file)) { out.stale.push(t); out.leftover.poses[t] = e; }
            else { replace(t, pose); out.applied.push(t); }
        }
        for (const [id, e] of Object.entries(d?.timing || {})) {
            const file = original.timing[id];
            if (!file || !timingEditable()) continue;
            const values = v2 ? e?.values : e, base = v2 ? e?.base : null, name = `${id}.timing`;
            if (!values || typeof values !== 'object') continue;
            if (Object.keys(file).every(k => values[k] === undefined || values[k] === file[k])) out.done.push(name);
            else if (!force && base && Object.keys(file).some(k => base[k] !== file[k])) { out.stale.push(name); out.leftover.timing[id] = e; }
            else {
                // Recovery first: derive is kept within it.
                for (const k of ['recovery', ...Object.keys(values)]) if (k in file && Number.isFinite(values[k])) setTiming(id, k, values[k]);
                out.applied.push(name);
            }
        }
        return out;
    }
    function revert(target) { replace(target, original.poses[target]); }
    function revertMove(id) {
        for (const k of KEYS) revert(`${id}.${k}`);
        if (timingEditable()) for (const [k, v] of Object.entries(original.timing[id])) MOVES()[id][k] = v;
    }
    function revertAll() {
        for (const t of targets()) revert(t);
        if (timingEditable()) for (const id of Object.keys(original.timing)) revertMove(id);
    }

    // ---- the move trees ----
    const weaponTypes = () => Object.keys(K().weapons);
    const movesOf = type => Object.keys(MOVES()).filter(id => MOVES()[id].weapon === type);
    // Inputs: 'a', 'b', and 'p' for an A after the pause line.
    const INPUT_LABELS = Object.freeze({ a: 'A', b: 'B', p: '· A' });
    const label = inputs => inputs.map(i => INPUT_LABELS[i]).join(' ');
    // The moves a list of inputs plays, or null where the tree has no such entry.
    function follow(type, inputs) {
        const out = [];
        for (const input of inputs) {
            const node = out.at(-1), next = node ? MOVES()[node].next || {} : null;
            const id = next ? next[input === 'p' ? 'pause' : input] : input === 'p' ? null : K().weapons[type]?.root[input];
            if (!id) return null;
            out.push(id);
        }
        return out;
    }
    const nextInputs = (type, inputs) => ['a', 'b', 'p'].filter(i => follow(type, [...inputs, i]));
    // Every combo played to its finisher, shortest first.
    function routes(type) {
        const out = [];
        const walk = inputs => {
            const next = inputs.length < 12 ? nextInputs(type, inputs) : [];
            if (inputs.length && !next.length) out.push(inputs);
            for (const i of next) walk([...inputs, i]);
        };
        walk([]);
        return out.sort((x, y) => x.length - y.length).map(inputs => ({ inputs, moves: follow(type, inputs), label: label(inputs) }));
    }

    // ---- bodies ----
    // The gear a preview wears: the starter gear, holding a weapon of the
    // type (the starter's own when it is of that type), and the offhand
    // item asked for (an item id, or null for an empty hand).
    function loadoutOf(type, offhand = gameConfig.gear.starter.offhand) {
        const S = gameConfig.gear.starter, items = gameConfig.items;
        const main = items[S.main]?.weapon === type ? S.main : Object.keys(items).find(id => items[id].weapon === type);
        if (!main) throw new Error(`No weapon of type ${type}`);
        return { ...S, main, offhand };
    }
    const rigs = new Map();
    function rigOf(loadout) {
        const key = JSON.stringify(loadout);
        if (!rigs.has(key)) rigs.set(key, rigKit.build(playerModel, { scale: gameConfig.models.playerScale, equipment: equipmentModels.forLoadout(loadout) }));
        return rigs.get(key);
    }
    // ---- a bone's axes, and turning it about them ----
    // A bone's three numbers are Euler angles, R = Ry * Rx * Rz
    // (core/math3d.js), so a slider turns the bone about a gimbal axis and
    // not about one of its own: ry about the parent's y, rx about the x
    // that ry has turned, rz about the bone's own z. With rx set, those
    // of ry and rz are no longer square to each other, and at rx = ±π/2
    // they are one line (the lock): one way of turning is then out of any
    // single slider's reach. That is where most keys hold the wrist, the
    // blade nearly in line with the forearm. So the page turns a bone about
    // its own axes too (`turn`), which are always square, and works the
    // three numbers out.
    const boneIndex = (rig, bone) => {
        const i = rig.index[bone];
        if (i === undefined) throw new Error(`Unknown bone ${bone}`);
        return i;
    };
    // A bone's own axes in the world, for a pose as solved; `at`: the joint.
    function frame(rig, solved, bone) {
        const m = solved.bones[boneIndex(rig, bone)];
        return { at: [m[12], m[13], m[14]], x: [m[0], m[1], m[2]], y: [m[4], m[5], m[6]], z: [m[8], m[9], m[10]] };
    }
    // The axes its rx, ry and rz sliders turn it about (`yaw`: the body's,
    // as given to rigKit.solve).
    function gimbal(rig, solved, pose, bone, yaw = 0) {
        const i = boneIndex(rig, bone), parent = rig.bones[i].parent, P = parent < 0 ? math3d.compose(0, 0, 0, 0, yaw, 0) : solved.bones[parent];
        const m = solved.bones[i], ry = pose[bone]?.ry || 0;
        return { at: [m[12], m[13], m[14]], x: math3d.transformDirection(P, [Math.cos(ry), 0, -Math.sin(ry)]), y: [P[4], P[5], P[6]], z: [m[8], m[9], m[10]] };
    }
    const ROTATIONS = ['rx', 'ry', 'rz'], TAU = 2 * Math.PI, ANGLE_LIMIT = 3.2;
    const rotationOf = p => math3d.compose(0, 0, 0, p?.rx || 0, p?.ry || 0, p?.rz || 0);
    // The three angles of a rotation matrix. Every pose has two sets (the
    // other goes the other way round the gimbal), each angle any number of
    // whole turns: the set nearest `near` is given, so the numbers move as
    // little as they can. At the lock rz keeps `near`'s and ry takes the rest.
    function anglesOf(m, near = {}) {
        const s = Math.min(1, Math.max(-1, -m[9])), rx = Math.asin(s), was = c => near?.[c] || 0;
        let sets;
        if (1 - Math.abs(s) < 1e-9) {
            const both = Math.atan2(-m[2], m[0]);
            sets = [{ rx, ry: s > 0 ? both + was('rz') : both - was('rz'), rz: was('rz') }];
        } else {
            const ry = Math.atan2(m[8], m[10]), rz = Math.atan2(m[1], m[5]);
            sets = [{ rx, ry, rz }, { rx: Math.PI - rx, ry: ry + Math.PI, rz: rz + Math.PI }];
        }
        let best = null, least = Infinity;
        for (const angles of sets) {
            let far = 0;
            for (const c of ROTATIONS) { angles[c] += Math.round((was(c) - angles[c]) / TAU) * TAU; far += Math.abs(angles[c] - was(c)); }
            if (far < least) { least = far; best = angles; }
        }
        return best;
    }
    // Turn a bone about one of its own axes ('x', 'y', 'z') by `angle`, and
    // write its three angles back. `from`: the angles it had as the gesture
    // began (a drag turns from there by the whole angle, so rounding does
    // not gather).
    function turn(target, bone, axis, angle, from = poseOf(target)[bone]) {
        if (!BONES.includes(bone) || !['x', 'y', 'z'].includes(axis) || !Number.isFinite(angle)) throw new Error(`Cannot turn ${bone} about ${axis} by ${angle}`);
        const spin = math3d.compose(0, 0, 0, axis === 'x' ? angle : 0, axis === 'y' ? angle : 0, axis === 'z' ? angle : 0);
        const next = anglesOf(math3d.multiply(rotationOf(from), spin), poseOf(target)[bone]);
        // Within the sliders' range.
        for (const c of ROTATIONS) set(target, bone, c, Math.abs(next[c]) > ANGLE_LIMIT ? next[c] - Math.round(next[c] / TAU) * TAU : next[c]);
    }
    // What playerAnim.pose needs of a body, at rest.
    const REST = Object.freeze({ gait: 0, moveBlend: 0, runBlend: 0, guardBlend: 0, shoveOut: 0, shoveFor: 0, stun: 0, down: false, downT: 0, drink: null, handOut: 0, act: null });
    const IDLE_DUMMY = Object.freeze({ phase: 'idle', t: 0, move: 0, flinch: 0 });
    const standardOf = type => K().weapons[type].standard;
    // The attacker starts at the origin facing +x (simulation facing 0); the
    // dummy, if any, stands `distance` ahead facing back.
    const dummyAt = distance => ({ ...IDLE_DUMMY, x: distance, y: 0, h: 0, facing: Math.PI });
    // Before the first move and after the last, standing.
    const LEAD = 0.25, TAIL = 0.35;
    // The step taken over a swing, easing out (core/fighter.js).
    const lungeOf = (stepTotal, u) => stepTotal * (1 - (1 - u) * (1 - u));
    const phaseLength = (m, phase) => phase === 'windup' ? m.windup : phase === 'swing' ? m.swing : phase === 'recover' ? m.recovery : Infinity;

    // ---- one move from the stance ----
    // opts: offhand, distance (to the dummy), target (false: no dummy).
    function single(id, { offhand, distance, target = true } = {}) {
        const m = MOVES()[id];
        if (!m) throw new Error(`Unknown move ${id}`);
        const type = m.weapon, loadout = loadoutOf(type, offhand), rig = rigOf(loadout);
        distance = distance ?? standardOf(type);
        const t1 = LEAD, t2 = t1 + m.windup, t3 = t2 + m.swing, t4 = t3 + m.recovery, end = t4 + TAIL;
        // The least charge: the step is the move's own.
        const stepTotal = m.step, dummy = target ? dummyAt(distance) : null;
        function actAt(time) {
            if (time < t1 || time >= t4) return null;
            if (time < t2) return { move: id, phase: 'windup', t: time - t1, lead: 0, from: null };
            if (time < t3) return { move: id, phase: 'swing', t: time - t2, lead: 0, from: null };
            return { move: id, phase: 'recover', t: time - t3, lead: 0, from: null };
        }
        const xAt = time => time < t2 ? 0 : time >= t3 ? stepTotal : lungeOf(stepTotal, (time - t2) / m.swing);
        // Where the blade first touches the dummy, sampled step by step as the game does.
        let hit = null;
        if (dummy) {
            const boxes = dummyBoxes(dummy), n = Math.max(1, Math.ceil(m.swing / STEP));
            const solveAt = u => rigKit.solve(rig, playerAnim.pose(rig, { ...REST, act: { move: id, phase: 'swing', t: u * m.swing, lead: 0, from: null } }), space.toBlocks(lungeOf(stepTotal, u), 0, 0), space.yawOf(0));
            for (let i = 0; i < n && !hit; i++) {
                const c = combatKit.sweep(rig, solveAt, i / n, (i + 1) / n, [{ id: 'dummy', boxes }]);
                if (c) hit = { occ: 0, move: id, time: t2 + c.u * m.swing };
            }
        }
        const F = gameConfig.dummy.flinchSeconds;
        return {
            kind: 'single', type, loadout, moves: [id], duration: end,
            segments: [{ occ: 0, move: id, phase: 'windup', start: t1, end: t2 }, { occ: 0, move: id, phase: 'swing', start: t2, end: t3 }, { occ: 0, move: id, phase: 'recover', start: t3, end: t4 }],
            occs: [{ move: id, start: t1, end: t4, swing: [t2, t3] }],
            keys: { [`${id}.a`]: t2, [`${id}.b`]: t3 },
            hits: hit ? [hit] : [],
            stateAt(time) {
                const act = actAt(time);
                return {
                    x: xAt(time), y: 0, facing: 0, occ: act ? 0 : -1, body: { ...REST, act },
                    dummy: dummy && { ...dummy, flinch: hit && time >= hit.time ? Math.max(0, F - (time - hit.time)) : 0 }
                };
            }
        };
    }
    let dummyRig = null;
    function dummyBoxes(d) {
        const rig = dummyRig || (dummyRig = dummyKit.rig());
        return combatKit.hurtboxes(rig, rigKit.solve(rig, dummyKit.pose(d), space.toBlocks(d.x, d.y, 0), space.yawOf(d.facing)));
    }

    // ---- a combo through the real simulation ----
    // A small open floor; the player and the dummy are put in place after.
    const FLOOR = Object.freeze({ name: '动作调试', training: true, rows: [...Array(4).fill('.'.repeat(24)), '......@...D.............', ...Array(4).fill('.'.repeat(24))] });
    // opts: offhand, distance, target, hold (seconds the opening B is held:
    // past its windup it charges). Each input is pressed at the latest
    // moment that still chains at full speed: an A just before the derive
    // point, a B holdSeconds before it (it is told from an A by then), an A
    // after the pause line as soon as the line is crossed. A tap lets go at
    // once, like the tests' taps, so a move from a standstill starts at the
    // very beginning of its windup.
    function combo(type, inputs, { offhand, distance, target = true, hold } = {}) {
        const moves = follow(type, inputs);
        if (!moves || !moves.length) throw new Error(`No combo ${label(inputs)} for ${type}`);
        const loadout = loadoutOf(type, offhand), C = K(), HOLD = C.holdSeconds, U = gameConfig.world.unitsPerBlock;
        distance = distance ?? standardOf(type);
        const sim = worldSim.create({ map: FLOOR, loadout, seed: 1 }), p = sim.player;
        const x0 = 6.5 * U, y0 = 4.5 * U;
        Object.assign(p, { x: x0, y: y0, facing: 0 });
        let d = sim.dummy;
        if (d && target) Object.assign(d, { x: x0 + distance, y: y0, facing: Math.PI, wait: 1e9 });
        else if (d) { sim.entities = sim.entities.filter(e => e !== d); d = null; }

        const frames = [], hits = [];
        let next = 0, releaseAt = Infinity, occ = -1, lastAct = null, idleSince = null;
        const command = type => worldSim.command(sim, { type, button: 'attack' });
        // Time left before the move under way reaches its derive point.
        function toDerive(a) {
            const m = MOVES()[a.move], derive = m.derive ?? Infinity;
            if (a.phase === 'windup') return m.windup - a.t + m.swing + derive;
            if (a.phase === 'swing') return m.swing - a.t + derive;
            if (a.phase === 'recover') return derive - a.t;
            return Infinity;
        }
        function ready(input) {
            if (next === 0) return sim.time >= LEAD - 1e-9;
            if (input === 'p') {
                const c = p.chain;
                return !p.act && !!c && sim.time - c.at >= MOVES()[c.move].recovery + C.weapons[type].pauseAfterRecovery - 1e-9;
            }
            const a = p.act;
            if (!a || a.move !== moves[next - 1]) return false;
            return toDerive(a) <= (input === 'b' ? HOLD : 2 * STEP) + 1e-9;
        }
        const snap = () => frames.push({
            x: p.x - x0, y: p.y - y0, facing: p.facing, occ: p.act ? occ : -1, freeze: p.freeze,
            body: {
                gait: p.gait, moveBlend: p.moveBlend, runBlend: p.runBlend, guardBlend: p.guardBlend, shoveOut: p.shoveOut, shoveFor: p.shoveFor, stun: p.stun, down: p.down, downT: p.downT,
                drink: p.drink && { ...p.drink },
                act: p.act && { move: p.act.move, phase: p.act.phase, t: p.act.t, lead: p.act.lead, from: p.act.from && { ...p.act.from } }
            },
            dummy: d && { x: d.x - x0, y: d.y - y0, h: 0, facing: d.facing, phase: d.phase, t: d.t, move: d.move, flinch: d.flinch }
        });
        snap();
        for (let k = 0; k < 2000; k++) {
            if (next < inputs.length && !p.press?.held && ready(inputs[next])) {
                command('press');
                if (inputs[next] === 'b') releaseAt = sim.time + (next === 0 ? Math.max(HOLD, hold ?? HOLD) : HOLD);
                else command('release');
                next++;
            }
            // A B is let go only once it has been told from an A.
            if (p.press?.held && p.press.as && sim.time >= releaseAt - 1e-9) command('release');
            worldSim.step(sim, STEP);
            if (p.act && p.act !== lastAct) occ++;
            lastAct = p.act;
            for (const e of worldSim.drain(sim)) if (e.type === 'hit' && e.source === p.id) hits.push({ occ, move: e.move, time: frames.length * STEP });
            snap();
            const idle = next === inputs.length && !p.act && !p.press?.held && !p.buffer;
            idleSince = idle ? idleSince ?? frames.length : null;
            if (idleSince !== null && (frames.length - idleSince) * STEP >= TAIL - 1e-9) break;
        }
        return recording('combo', type, loadout, moves, frames, hits);
    }

    // A recording from frames one step apart: the timeline, and the state at
    // any time in between (a phase's clock runs on between two frames,
    // except in a hitstop).
    function recording(kind, type, loadout, moves, frames, hits) {
        const n = frames.length, segments = [], occs = [], keys = {};
        frames.forEach((f, i) => {
            const a = f.body.act, time = i * STEP, last = segments.at(-1);
            if (!a) { if (last && last.end === null) last.end = time; return; }
            if (last && last.end === null && last.occ === f.occ && last.phase === a.phase) return;
            if (last && last.end === null) last.end = time;
            segments.push({ occ: f.occ, move: a.move, phase: a.phase, start: time, end: null });
        });
        if (segments.at(-1)?.end === null) segments.at(-1).end = (n - 1) * STEP;
        for (const s of segments) {
            const o = occs[s.occ] || (occs[s.occ] = { move: s.move, start: s.start, end: s.end, swing: null });
            o.end = s.end;
            if (s.phase === 'swing') o.swing = [s.start, s.end];
            // `a` is reached as the windup ends, `b` as the swing ends.
            if (s.phase === 'windup') keys[`${s.move}.a`] ??= s.end;
            if (s.phase === 'swing') keys[`${s.move}.b`] ??= s.end;
        }
        function stateAt(time) {
            const f = Math.min(n - 1, Math.max(0, time / STEP)), i = Math.min(n - 1, Math.floor(f)), u = f - i;
            const f0 = frames[i], f1 = frames[Math.min(n - 1, i + 1)], lerp = (a, b) => a + (b - a) * u;
            let act = f0.body.act;
            if (act) {
                const b = f1.body.act, same = b && f1.occ === f0.occ && b.phase === act.phase;
                const run = f0.freeze > 0 ? 0 : u * STEP;
                act = { ...act, t: same ? lerp(act.t, b.t) : Math.min(phaseLength(MOVES()[act.move], act.phase), act.t + run) };
            }
            const body = { ...f0.body, act };
            for (const k of ['gait', 'moveBlend', 'runBlend', 'guardBlend', 'shoveOut', 'shoveFor', 'stun', 'downT']) body[k] = lerp(f0.body[k], f1.body[k]);
            let dummy = f0.dummy;
            if (dummy && f1.dummy) dummy = { ...dummy, x: lerp(dummy.x, f1.dummy.x), y: lerp(dummy.y, f1.dummy.y), flinch: lerp(dummy.flinch, f1.dummy.flinch), t: dummy.phase === f1.dummy.phase ? lerp(dummy.t, f1.dummy.t) : dummy.t };
            return { x: lerp(f0.x, f1.x), y: lerp(f0.y, f1.y), facing: space.lerpAngle(f0.facing, f1.facing, u), occ: f0.occ, body, dummy };
        }
        return { kind, type, loadout, moves, duration: (n - 1) * STEP, segments, occs, keys, hits, stateAt };
    }

    // ---- the other poses, each shown coming and going (the guard's
    // walking bend, walking forward under the shield; a parry's shove, out
    // of a guard already up) ----
    // opts: type (the weapon held), offhand where the pose does not decide it.
    function pose(id, { type = loadoutTypeOf(gameConfig.gear.starter), offhand } = {}) {
        if (!Object.hasOwn(POSES, id)) throw new Error(`Unknown pose ${id}`);
        const F = gameConfig.combat, S = gameConfig.gear.starter.offhand;
        const hand = { guard: S, guardShove: S, guardWeapon: null, guardWeaponShove: null, guardLegs: S, guardBend: S, drink: 'potion', torch: 'torch' }[id];
        const loadout = loadoutOf(type, hand !== undefined ? hand : offhand);
        const at = LEAD, ramp = (t, from, len) => clamp01((t - from) / len), H = gameConfig.interact.hand, V = F.guard.shove;
        // Walking under the guard, as fast as the guard lets the body go.
        const speed = gameConfig.player.speed * F.guard.moveMultiplier, cycle = playerAnim.cycleLength(rigOf(loadout), 0);
        const walked = t => Math.max(0, t - at) * speed;
        const shows = {
            stance: { duration: 1.6, key: 0, body: () => ({}) },
            torch: { duration: 1.6, key: 0, body: () => ({}) },
            guard: { duration: 1.4, key: at + F.guard.startup, body: t => ({ guardBlend: t < 1.1 ? ramp(t, at, F.guard.startup) : 1 - ramp(t, 1.1, gameConfig.animation.blendSeconds) }) },
            // (Its key is where it is right out: it gives first.)
            guardShove: {
                duration: at + V.in + V.out + V.back + TAIL, key: at + V.in + V.out,
                body: t => ({
                    guardBlend: 1, shoveFor: t < at ? 0 : Math.max(0, at + V.in + V.out - t),
                    shoveOut: t < at + V.in + V.out ? ramp(t, at + V.in, V.out) : 1 - ramp(t, at + V.in + V.out, V.back)
                })
            },
            drink: { duration: at + F.potion.seconds + TAIL, key: at + 0.2, body: t => ({ drink: t >= at && t < at + F.potion.seconds ? { phase: 'drink', t: t - at } : null }) },
            flinch: { duration: at + F.hitStun + TAIL, key: at + 0.2 * F.hitStun, body: t => ({ stun: t >= at ? Math.max(0, F.hitStun - (t - at)) : 0 }) },
            down: { duration: at + 1.2, key: at + 0.5, body: t => (t >= at ? { down: true, downT: t - at } : {}) },
            guardBend: {
                duration: 3, key: at + 1.2, x: walked,
                body: t => ({ guardBlend: ramp(t, 0, F.guard.startup), moveBlend: ramp(t, at, gameConfig.animation.blendSeconds), gait: walked(t) / cycle })
            },
            reach: { duration: at + H.out + H.stay + H.back + TAIL, key: at + H.out, body: t => ({ handOut: t < at ? 0 : t < at + H.out + H.stay ? ramp(t, at, H.out) : 1 - ramp(t, at + H.out + H.stay, H.back) }) }
        };
        shows.guardWeapon = shows.guardLegs = shows.guard;
        shows.guardWeaponShove = shows.guardShove;
        const show = shows[id];
        return {
            kind: 'pose', type, loadout, moves: [], duration: show.duration, segments: [], occs: [], keys: { [id]: show.key }, hits: [],
            stateAt: time => ({ x: show.x ? show.x(time) : 0, y: 0, facing: 0, occ: -1, body: { ...REST, ...show.body(time) }, dummy: null })
        };
    }
    const loadoutTypeOf = loadout => inventoryKit.weaponOf(loadout);

    // ---- checks, as tests/hits.test.cjs makes them ----
    // The attacker at the origin, from the stance, its step left out; the
    // blade tip over the swing (41 samples): angle (radians, + is the
    // attacker's left, unwrapped), height and how far ahead (blocks).
    function tipPath(id, rig) {
        const m = MOVES()[id], blade = rig.parts.findIndex(p => p.kind === 'weapon'), half = rig.parts[blade].size[2] / 2, out = [];
        for (let k = 0; k <= 40; k++) {
            const s = rigKit.solve(rig, playerAnim.pose(rig, { ...REST, act: { move: id, phase: 'swing', t: k / 40 * m.swing, from: null } }));
            const tip = math3d.transformPoint(s.parts[blade], [0, 0, half]);
            out.push({ angle: Math.atan2(tip[0], tip[2]), height: tip[1], ahead: tip[2] });
        }
        for (let k = 1; k < out.length; k++) out[k].angle = out[k - 1].angle + space.wrapAngle(out[k].angle - out[k - 1].angle);
        return out;
    }
    // Does the move touch a dummy or a standing person `dist` straight ahead?
    function lands(id, rig, kind, dist) {
        const m = MOVES()[id], at = space.toBlocks(dist, 0, 0), yaw = space.yawOf(Math.PI);
        let boxes;
        if (kind === 'dummy') boxes = dummyBoxes({ ...dummyAt(dist) });
        else { const body = rigOf(gameConfig.gear.starter); boxes = combatKit.hurtboxes(body, rigKit.solve(body, playerAnim.pose(body, REST), at, yaw)); }
        const solveAt = u => rigKit.solve(rig, playerAnim.pose(rig, { ...REST, act: { move: id, phase: 'swing', t: u * m.swing, from: null } }), [0, 0, 0], space.yawOf(0));
        const n = Math.ceil(m.swing / STEP);
        for (let i = 0; i < n; i++) if (combatKit.sweep(rig, solveAt, i / n, (i + 1) / n, [{ id: 't', boxes }])) return true;
        return false;
    }
    // Everything the tests hold a move to, measured now. `reach`: the
    // furthest the dummy is still touched (world units), when the move
    // touches it at the standard distance and not at TOO_FAR. `quick`
    // measures the blade's path only (a few hundredths of a second, where
    // the hit tests take a few tenths): lands*, tooFar and reach stay null.
    const TOO_FAR = 140;
    function measure(id, { offhand, quick = false } = {}) {
        const m = MOVES()[id], type = m.weapon, rig = rigOf(loadoutOf(type, offhand)), standard = standardOf(type);
        const path = tipPath(id, rig), angles = path.map(x => x.angle), degrees = r => r * 180 / Math.PI;
        const out = {
            standard, path, sweep: degrees(Math.max(...angles) - Math.min(...angles)),
            start: path[0], end: path.at(-1), lowest: Math.min(...path.map(x => x.height)),
            landsDummy: null, landsPlayer: null, tooFar: null, reach: null
        };
        if (quick) return out;
        Object.assign(out, { landsDummy: lands(id, rig, 'dummy', standard), landsPlayer: lands(id, rig, 'player', standard), tooFar: lands(id, rig, 'dummy', TOO_FAR) });
        // Between the standard distance and TOO_FAR, to about a world unit.
        if (out.landsDummy && !out.tooFar) {
            let lo = standard, hi = TOO_FAR;
            for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (lands(id, rig, 'dummy', mid)) lo = mid; else hi = mid; }
            out.reach = Math.round(lo);
        }
        return out;
    }

    // ---- export: source text to paste back into the files ----
    // Pose numbers as the files write them: whole ones with a ".0".
    const num = v => Number.isInteger(v) ? v.toFixed(1) : String(round(v));
    const boneText = (bone, p) => {
        const cs = Object.keys(p).filter(c => CHANNELS.includes(c) && p[c]);
        return cs.length ? `${bone}: { ${cs.map(c => `${c}: ${num(p[c])}`).join(', ')} }` : `${bone}: {}`;
    };
    // `base`: what `key` adds (the shield arm); a bone equal to it is left
    // out, and one it fills but the pose leaves at rest is written empty.
    function poseText(pose, base = {}) {
        const parts = [];
        for (const bone of BONES) {
            const p = pose[bone], b = base[bone];
            if (b ? samePose({ x: p || {} }, { x: b }) : !p || !Object.keys(p).some(c => p[c])) continue;
            parts.push(boneText(bone, p || {}));
        }
        return parts.length ? `{ ${parts.join(', ')} }` : '{}';
    }
    // A move's two keys, as written in models/player_moves.js.
    function moveSource(id) {
        const k = playerMoves.moves[id], arm = playerMoves.shieldArm;
        return `        ${id}: {\n            a: key(${poseText(k.a, arm)}),\n            b: key(${poseText(k.b, arm)})\n        },`;
    }
    // One of the other poses, on one line.
    const poseSource = id => `${id === 'stance' ? '    ' : '        '}${id}: ${poseText(poseOf(id))},`;
    // A move's line in game_config.js (combo.moves), every field.
    const cfgNum = v => Number.isInteger(v) ? String(v) : Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? v.toFixed(2) : String(v);
    const value = v => typeof v === 'string' ? `'${v}'` : typeof v === 'number' ? cfgNum(v) : typeof v === 'boolean' ? String(v) : `{ ${Object.entries(v).map(([k, x]) => `${k}: ${value(x)}`).join(', ')} }`;
    const timingSource = id => `                ${id}: ${value(MOVES()[id])},`;
    // Everything that differs from the files, grouped by file; '' when nothing does.
    function changesSource() {
        const moved = Object.keys(playerMoves.moves).filter(id => KEYS.some(k => changed(`${id}.${k}`)));
        const posed = Object.keys(POSES).filter(changed), timed = Object.keys(original.timing).filter(timingChanged);
        const out = [];
        if (moved.length) out.push('// models/player_moves.js：playerMoves.moves（招式的关键姿势）', ...moved.map(moveSource));
        for (const id of posed) out.push(`// ${POSES[id].file}：${id === 'stance' ? 'playerPoses' : 'playerMoves'}.${id}（${POSES[id].name}）`, poseSource(id));
        if (timed.length) out.push('// game_config.js：combo.moves（节奏）', ...timed.map(timingSource));
        return out.join('\n');
    }

    return {
        STEP, BONES, POSES, KEYS, TIMING, INPUT_LABELS, targets, poseOf, set, replace, changed, samePose,
        timingEditable, setTiming, timingChanged, moveChanged, draft, apply, revert, revertMove, revertAll,
        original: target => clone(original.poses[target]), originalTiming: id => ({ ...original.timing[id] }),
        weaponTypes, movesOf, label, follow, nextInputs, routes, loadoutOf, rigOf, standardOf,
        ANGLE_LIMIT, frame, gimbal, anglesOf, turn,
        single, combo, pose, measure, tipPath, TOO_FAR, moveSource, poseSource, timingSource, changesSource
    };
})();
