// Monsters (design.md 5): the goblin, the wolf and the cave spider. Patrol
// round home, notice a player they can see and stand alert a moment, then fight,
// walking round any wall between (terrainKit.wayTo): free again, a
// monster turns to the player if it must and picks what to do from the
// table of the distance band the player is in (design.md 5.2), on the
// world's own dice; it enrages when low. Past the leash it walks home,
// whoever is by it, mending as it goes, and a blow on the way does not
// turn it round (user, 2026-10-06). A fighter a ring hides
// (fighterKit.hidden) is not noticed.
// Their blows hit by the same box test as the player's sword (design.md
// 5); the wolf's leap and the spider's spring ram with the whole body along
// the path. How far a move reaches, and the warning on the ground, are swept
// out of its key poses once (`reach`).
// Bosses (design.md 5) are the same skeletons made bigger, with a
// look and moves of their own; a boss down stays down (the save) till its
// grave calls it back, and the portals and chests waiting on it open. A fallen monster drops its loot
// (core/props.js). One that gives up the chase and gets home is whole
// again.
//
// A monster is an entity (core/entity.js) of type 'monster': { id, kind,
//   side: 'monster', boss, x, y, h, facing, radius, solid, hp, maxHp, atk,
//   def, home: { x, y }, phase, t, move (name of the move under way),
//   flip (that move drawn mirrored: its key poses say `either`),
//   cooldowns ({ move: seconds left }), wait, struck, stopped (a leap that
//   has met something), stagger, flinch, freeze, push, enraged, patrolAt
//   (angle of the next waypoint), rest, gait, speed, moveBlend }
// phase: patrol | alert | chase | approach | windup | swing | recover | reel
//   | return | dead | rise (a boss called back at its grave, core/props.js,
//   coming up out of the ground: it cannot be struck until it is up, then
//   stands alert)
// A kind's `model` names the skeleton it is built on (its own kind if not
// given), `scale` sizes it and `look` swaps colours (models/).
const monsterKit = (() => {
    const M = () => gameConfig.monsters, F = () => gameConfig.combat;
    const UNIT = () => gameConfig.world.unitsPerBlock;
    const MODELS = { goblin: () => goblinModel, wolf: () => wolfModel, spider: () => spiderModel };
    const POSES = { goblin: () => goblinPoses, wolf: () => wolfPoses, spider: () => spiderPoses };
    // What a kind carries or wears: by kind, else by model.
    const GEAR = { goblin: () => [goblinPoses.club()], wolf: () => [], spider: () => [], goblinChief: () => [goblinPoses.club(), goblinPoses.helmet()], wolfKing: () => [wolfPoses.mane()] };
    // Phases in which a monster is in a fight.
    const FIGHTING = new Set(['rise', 'alert', 'chase', 'approach', 'windup', 'swing', 'recover', 'reel']);
    const emit = (sim, m, type, data) => combatKit.emit(sim, type, { side: 'monster', id: m.id, kind: m.kind, ...data });
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const easeOut = t => 1 - (1 - t) * (1 - t);
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const smooth = t => t * t * (3 - 2 * t);
    const approach = (value, target, rate) => target > value ? Math.min(target, value + rate) : Math.max(target, value - rate);
    const configOf = kind => {
        const S = M()[kind];
        if (!S || !MODELS[S.model || kind]) throw new Error(`Unknown monster ${kind}`);
        return S;
    };
    const modelOf = kind => configOf(kind).model || kind;
    const posesOf = kind => POSES[modelOf(kind)]();
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const living = m => m.phase !== 'dead';
    const engaged = m => FIGHTING.has(m.phase);
    // Is any monster of this world in a fight?
    function inFight(sim) { for (const e of sim.entities) if (e.type === 'monster' && engaged(e)) return true; return false; }
    // Distance walked by the monster being ticked, for its gait.
    let walked = 0;

    function rig(kind) { const S = configOf(kind), model = modelOf(kind); return rigKit.build(MODELS[model](), { scale: S.scale || 1, equipment: (GEAR[kind] || GEAR[model])() }); }
    // The colours a kind swaps (models/: a model's `looks`).
    function look(kind) { const S = configOf(kind); return S.look ? MODELS[modelOf(kind)]().looks[S.look] : {}; }
    function create(terrain, spawn, index) {
        const S = configOf(spawn.kind), at = terrainKit.cellCentre(terrain, spawn.col, spawn.row);
        return {
            id: `m${index}`, type: 'monster', kind: spawn.kind, side: 'monster', boss: !!S.boss, solid: true,
            x: at.x, y: at.y, h: space.groundHeight(at.x, at.y), facing: Math.PI / 2 + index * 1.3, radius: S.radius,
            hp: S.maxHp, maxHp: S.maxHp, atk: S.atk, def: S.def, home: { x: at.x, y: at.y },
            phase: 'patrol', t: 0, move: null, flip: false, cooldowns: {}, wait: 0, struck: false, stopped: false,
            stagger: 0, flinch: 0, freeze: 0, push: null, enraged: false,
            patrolAt: index * 1.7, rest: 0.4 * index, gait: 0, speed: 0, moveBlend: 0
        };
    }

    // ---- the pose: a pure function of the monster's state ----
    const lunge = (move, u) => move.step * (1 - (1 - u) * (1 - u));
    // World units covered by one gait cycle (two steps): each leg swings
    // `amp` either side, so a planted foot travels 2 L sin(amp) a step.
    function cycleLength(kind) {
        const leg = posesOf(kind).walk.leg;
        return 4 * leg.length * (configOf(kind).scale || 1) * Math.sin(leg.amp) * UNIT();
    }
    function locomotion(P, m) {
        const out = {}, phase = m.gait * Math.PI * 2;
        for (const [bone, channel, amp, offset] of P.walk.swing) (out[bone] || (out[bone] = {}))[channel] = amp * Math.sin(phase + offset) * m.moveBlend;
        return rigKit.add(P.idle, out);
    }
    // Lift or lower the whole body so its lowest box (any but the weapon)
    // rests on the ground.
    function grounded(rigData, pose) {
        const low = rigKit.lowest(rigData, rigKit.solve(rigData, pose), part => part.kind !== 'weapon');
        return rigKit.add(pose, { base: { py: -low / rigData.scale } });
    }
    // A move's key poses, mirrored left for right when `flip`.
    const mirrored = new WeakMap();
    function keysOf(K, flip) {
        if (!K || !flip) return K;
        if (!mirrored.has(K)) mirrored.set(K, { ...K, a: rigKit.mirror(K.a), b: rigKit.mirror(K.b) });
        return mirrored.get(K);
    }
    function pose(rigData, m) {
        const P = posesOf(m.kind), S = configOf(m.kind), move = S.moves[m.move], K = keysOf(move && P.moves[move.pose || m.move], m.flip);
        const walk = locomotion(P, m), B = gameConfig.animation.blendSeconds;
        let pose = walk, hop = 0;
        if (m.phase === 'alert') pose = rigKit.add(walk, rigKit.scale(P.alert, clamp01(Math.min(m.t, S.alertSeconds - m.t) / B)));
        else if (m.phase === 'windup') pose = rigKit.mix(walk, K.a, easeOut(clamp01(m.t / move.windup)));
        else if (m.phase === 'swing') {
            const u = clamp01(m.t / move.swing);
            pose = rigKit.mix(K.a, K.b, smooth(u));
            hop = (K.hop || 0) * Math.sin(Math.PI * u);
        } else if (m.phase === 'recover') pose = rigKit.mix(K.b, walk, easeInOut(clamp01(m.t / move.recovery)));
        else if (m.phase === 'reel') {
            pose = rigKit.add(rigKit.mix(walk, P.reel, clamp01(m.t / B)), { base: { rz: Math.sin(m.t * 9) * 0.07, ry: Math.sin(m.t * 6) * 0.1 } });
        } else if (m.phase === 'dead') pose = rigKit.mix(walk, P.dead, easeOut(clamp01(m.t / 0.45)));
        if (m.flinch > 0 && m.phase !== 'dead') pose = rigKit.add(pose, rigKit.scale(P.flinch, m.flinch / S.flinchSeconds));
        pose = grounded(rigData, pose);
        // Rising out of the ground: all of it below at first, what it wears
        // over its head too.
        if (m.phase === 'rise') hop -= (height(m.kind) + 0.6) / (S.scale || 1) * (1 - easeOut(clamp01(m.t / M().riseSeconds)));
        return hop ? rigKit.add(pose, { base: { py: hop } }) : pose;
    }
    function rigOf(sim, m) { return sim.rigs.monsters[m.kind]; }
    function solve(sim, m) { return rigKit.solve(rigOf(sim, m), pose(rigOf(sim, m), m), space.toBlocks(m.x, m.y, m.h), space.yawOf(m.facing)); }
    function hurtboxes(sim, m) { return m.phase === 'rise' ? [] : combatKit.hurtboxes(rigOf(sim, m), solve(sim, m)); }
    // What strikes in a move, and how much it grows for the hit test.
    const striking = move => move.ram ? { kinds: ['body', 'weapon'], pad: 0 } : { kinds: ['weapon'], pad: F().weaponPad / UNIT() };

    // ---- reach, swept out of the key poses (design.md 5) ----
    // For move `name` of `kind`, in the monster's own frame (blocks, +z
    // ahead, standing at the origin): `hull`, the convex outline on the
    // ground of everything that strikes over the swing, lunge included (the
    // warning; wider rather than narrower); `forward`, in world units, how
    // far ahead of the monster's centre it reaches; `stand`, how far it
    // would reach without the lunge (where a near move starts from: the
    // lunge is there to catch a player stepping back, design.md 5.2). A
    // move drawn either way round warns of both.
    const reaches = new Map();
    function reach(kind, name) {
        const key = `${kind}:${name}`;
        if (reaches.has(key)) return reaches.get(key);
        const S = configOf(kind), move = S.moves[name], r = rig(kind), { kinds, pad } = striking(move), points = [];
        let forward = 0, stand = 0;
        const N = 32;
        for (let k = 0; k <= N; k++) {
            const u = k / N, ahead = lunge(move, u) / UNIT(), body = { kind, phase: 'swing', t: u * move.swing, move: name, flinch: 0, gait: 0, moveBlend: 0 };
            const solved = rigKit.solve(r, pose(r, body), [0, 0, ahead], 0);
            for (const box of combatKit.attackBoxes(r, solved, kinds, pad)) {
                for (const c of math3d.corners(box)) { points.push([c[0], c[2]]); forward = Math.max(forward, c[2]); stand = Math.max(stand, c[2] - ahead); }
            }
        }
        if (posesOf(kind).moves[move.pose || name].either) for (const [x, z] of [...points]) points.push([-x, z]);
        const out = Object.freeze({ hull: Object.freeze(hull(points)), forward: forward * UNIT(), stand: stand * UNIT() });
        reaches.set(key, out);
        return out;
    }
    // Convex hull, counter-clockwise (Andrew's monotone chain).
    function hull(points) {
        const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [], upper = [];
        for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
        for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
        return [...lower.slice(0, -1), ...upper.slice(0, -1)];
    }

    // ---- being hit (combatKit.kitOf); `by` is the fighter who struck ----
    function struck(sim, m, { amount, stagger: points = 0, by = null }) {
        if (!living(m)) return;
        combatKit.damage(sim, m, amount);
        if (m.hp <= 0) { defeat(sim, m, by); return; }
        const S = configOf(m.kind);
        m.flinch = S.flinchSeconds;
        if (!m.enraged && S.enrage && m.hp <= m.maxHp * S.enrage.threshold + 1e-9) { m.enraged = true; emit(sim, m, 'enrage', { at: chest(m) }); }
        // On its way home it goes on home, and does not reel (user, 2026-10-06).
        if (m.phase === 'return') return;
        // Struck before it noticed anyone: it fights back at once.
        if (m.phase === 'patrol' || m.phase === 'alert') { m.phase = 'chase'; m.t = 0; m.wait = S.firstDelay; }
        if (points > 0) stagger(sim, m, points);
    }
    // Stagger points that make a kind reel (bosses take more).
    function threshold(kind) { return configOf(kind).stagger ?? F().stagger.threshold; }
    function stagger(sim, m, amount) {
        if (m.phase === 'reel') return;
        m.stagger += amount;
        if (m.stagger >= threshold(m.kind) - 1e-9) {
            m.stagger = 0; m.phase = 'reel'; m.t = 0; m.struck = false;
            emit(sim, m, 'stagger');
        }
    }
    function defeat(sim, m, by) {
        m.phase = 'dead'; m.t = 0; m.stagger = 0; m.flinch = 0; m.hp = 0;
        if (by?.stats) by.stats.kills++;
        emit(sim, m, 'defeated', { at: chest(m), boss: m.boss });
        const S = configOf(m.kind);
        if (S.loot) propKit.drop(sim, S.loot, m.x, m.y);
        if (m.boss) {
            const bag = propKit.progressOf(sim);
            bag.bosses[m.kind] = true;
            delete bag.revived?.[m.kind];
            emit(sim, m, 'boss_defeated', { name: S.name });
        }
    }
    // The top of a kind's body at rest, in blocks (for bars over its head).
    const heights = new Map();
    function height(kind) {
        if (!heights.has(kind)) {
            const r = rig(kind), solved = rigKit.solve(r, pose(r, { kind, phase: 'patrol', t: 0, move: null, flinch: 0, gait: 0, moveBlend: 0 }));
            let top = 0;
            r.parts.forEach((part, i) => { if (part.kind === 'body') for (const c of math3d.corners(math3d.obb(solved.parts[i], part.size.map(v => v / 2)))) top = Math.max(top, c[1]); });
            heights.set(kind, top);
        }
        return heights.get(kind);
    }
    // About the middle of the body, in blocks, for effects.
    function chest(m) { const at = space.toBlocks(m.x, m.y, m.h); return [at[0], at[1] + 0.6, at[2]]; }

    // ---- moving ----
    // Bodies a monster cannot walk through: fighters (unless fallen) and
    // solid entities (the training dummy, other living monsters, chests).
    function obstacles(sim, m) { return entityKit.obstacles(sim, m); }
    function face(m, at, rate, dt) { m.facing = space.turn(m.facing, Math.atan2(at.y - m.y, at.x - m.x), rate * dt); }
    // Step towards (x, y) at `speed`; true once there.
    function walkTo(sim, m, x, y, speed, dt, turn = true) {
        const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy);
        if (d < 3) return true;
        const go = Math.min(d, speed * dt), x0 = m.x, y0 = m.y;
        terrainKit.moveCircle(sim.terrain, m, dx / d * go, dy / d * go, obstacles(sim, m));
        if (turn) face(m, { x, y }, configOf(m.kind).turnRate, dt);
        walked += Math.hypot(m.x - x0, m.y - y0);
        return false;
    }
    // Step towards (x, y), or towards a body there that it comes up to
    // `short` of, round whatever wall stands in the way (terrainKit.wayTo);
    // true once at (x, y) itself.
    const way = { x: 0, y: 0, direct: true };
    function walkRound(sim, m, x, y, short, speed, dt, turn = true) {
        terrainKit.wayTo(sim.terrain, m.x, m.y, x, y, m.radius, short, way);
        return walkTo(sim, m, way.x, way.y, speed, dt, turn) && way.x === x && way.y === y;
    }
    // Is a body standing on the monster's home, and the monster up against it?
    function heldOff(sim, m) {
        return obstacles(sim, m).some(o => distance(o, m.home) < o.radius + m.radius && distance(o, m) < o.radius + m.radius + 3);
    }

    // ---- choosing what to do (design.md 5.2) ----
    // How far a kind's bands go: `near` as far as any move of its near
    // table reaches without its lunge (a near move starts once the player
    // is within that, so a step back does not clear it), `mid` as far as
    // any move of its mid table reaches, lunge and all (and never short of
    // near). Beyond `mid` is far.
    const edges = new Map();
    function bands(kind) {
        if (!edges.has(kind)) {
            const S = configOf(kind), far = (table, key) => Math.max(0, ...Object.keys(table || {}).filter(name => S.moves[name]).map(name => reach(kind, name)[key]));
            const near = far(S.near, 'stand');
            edges.set(kind, Object.freeze({ near, mid: Math.max(near, far(S.mid, 'forward')) }));
        }
        return edges.get(kind);
    }
    // Roll a band's table at distance d: moves that do not reach the player
    // (near ones without their lunge) or are cooling down are left out, the
    // rest go by weight. A move's name, 'approach', or null when nothing
    // is left.
    function roll(sim, m, table, d, key) {
        const S = configOf(m.kind), left = Object.entries(table).filter(([name]) => !S.moves[name] || (d <= reach(m.kind, name)[key] && !(m.cooldowns[name] > 0)));
        let die = entityKit.random(sim) * left.reduce((sum, [, weight]) => sum + weight, 0);
        for (const [name, weight] of left) if ((die -= weight) < 0) return name;
        return left.length ? left.at(-1)[0] : null;
    }
    function begin(sim, m, name) {
        const move = configOf(m.kind).moves[name];
        m.move = name; m.phase = 'windup'; m.t = 0; m.struck = false; m.stopped = false;
        // Which way round a move drawn either way goes: the world's dice.
        m.flip = !!posesOf(m.kind).moves[move.pose || name].either && entityKit.random(sim) < 0.5;
        if (move.cooldown) m.cooldowns[name] = move.cooldown;
        emit(sim, m, 'windup', { move: name });
    }

    // How many others of this monster's kind are in a move just now, windup to recovery.
    const MOVING = new Set(['windup', 'swing', 'recover']);
    function inMove(sim, m) { let n = 0; for (const o of sim.monsters) if (o !== m && o.kind === m.kind && MOVING.has(o.phase)) n++; return n; }

    // ---- the AI, on the monster's own clock (dt is already times tempo) ----
    // It minds the nearest fighter still standing (in PVE, the player).
    function think(sim, m, dt) {
        const S = configOf(m.kind), p = worldSim.nearestFighter(sim, m) || sim.fighters[0], d = distance(m, p), alive = !p.down;
        const t = sim.terrain, short = m.radius + p.radius;
        for (const name in m.cooldowns) m.cooldowns[name] = Math.max(0, m.cooldowns[name] - dt);
        switch (m.phase) {
            case 'patrol': {
                // It notices only a player it can see: a wall that hides is in the way (terrainKit.sightClear), and so is a ring of stealth.
                if (alive && d <= S.alertRange && !fighterKit.hidden(p) && terrainKit.sightClear(t, m.x, m.y, p.x, p.y)) { m.phase = 'alert'; m.t = 0; emit(sim, m, 'alert'); return; }
                if (m.rest > 0) { m.rest = Math.max(0, m.rest - dt); return; }
                const x = m.home.x + Math.cos(m.patrolAt) * S.patrolRadius, y = m.home.y + Math.sin(m.patrolAt) * S.patrolRadius;
                // A waypoint in a wall or behind one is passed over.
                if (!terrainKit.openWay(t, m.x, m.y, x, y, m.radius)) { m.patrolAt += 2.4; return; }
                if (walkTo(sim, m, x, y, S.patrolSpeed, dt)) { m.patrolAt += 2.4; m.rest = S.patrolRest; }
                return;
            }
            case 'rise':
                m.t += dt;
                if (m.t >= M().riseSeconds - 1e-9) { m.phase = 'alert'; m.t = 0; emit(sim, m, 'alert'); }
                return;
            case 'alert':
                face(m, p, S.turnRate, dt);
                m.t += dt;
                if (m.t >= S.alertSeconds - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.firstDelay; }
                return;
            case 'chase': {
                if (!alive || distance(m, m.home) > S.leash) { m.phase = 'return'; m.t = 0; return; }
                const edge = bands(m.kind);
                m.wait = Math.max(0, m.wait - dt);
                // A block between them: no blow would land across it (swingStep), so it goes round first, looking where it walks.
                if (!terrainKit.lineClear(t, m.x, m.y, p.x, p.y)) { walkRound(sim, m, p.x, p.y, short, S.speed, dt); return; }
                face(m, p, S.turnRate, dt);
                // The gap after a move: facing the player, it creeps up to the near band.
                if (m.wait > 0) {
                    if (d > edge.near * S.standOff) walkRound(sim, m, p.x, p.y, short, S.patrolSpeed, dt, false);
                    return;
                }
                // Free: a player off to the side or behind is turned to first, on the spot.
                if (Math.abs(space.wrapAngle(Math.atan2(p.y - m.y, p.x - m.x) - m.facing)) > M().turnFirst) return;
                // A pack (design.md 5.2): only `pack` of a kind are in a move at
                // once; within reach of the player the others wait their turn,
                // facing it from outside their near band.
                if (S.pack && d <= edge.mid && inMove(sim, m) >= S.pack) {
                    if (d > edge.near * M().packStandOff) walkRound(sim, m, p.x, p.y, short, S.patrolSpeed, dt, false);
                    return;
                }
                const choice = d > edge.mid ? null : d <= edge.near ? roll(sim, m, S.near, d, 'stand') : roll(sim, m, S.mid, d, 'forward');
                if (choice === 'approach') { m.phase = 'approach'; m.t = 0; return; }
                if (choice) { begin(sim, m, choice); return; }
                // Far, or nothing it can use from here: it closes in.
                walkRound(sim, m, p.x, p.y, short, S.speed, dt, false);
                return;
            }
            case 'approach':
                // A stretch of walking in, cut short once the player is near.
                m.t += dt;
                face(m, p, S.turnRate, dt);
                if (!alive || d <= bands(m.kind).near || m.t >= M().approachSeconds - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = 0; return; }
                walkRound(sim, m, p.x, p.y, short, S.speed, dt, false);
                return;
            case 'windup': {
                const move = S.moves[m.move];
                // It keeps turning to the player until `lock` before the swing.
                if (alive && m.t < move.windup - move.lock) face(m, p, S.trackTurn, dt);
                m.t += dt;
                if (m.t >= move.windup - 1e-9) { m.phase = 'swing'; m.t = 0; emit(sim, m, 'swing', { move: m.move, heavy: !!move.ram }); }
                return;
            }
            case 'swing': swingStep(sim, m, dt); return;
            case 'recover':
                m.t += dt;
                if (m.t >= S.moves[m.move].recovery - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.delay; }
                return;
            case 'reel':
                m.t += dt;
                if (m.t >= F().stagger.duration - 1e-9) { m.phase = 'chase'; m.t = 0; m.wait = S.delay; emit(sim, m, 'recovered'); }
                return;
            case 'return':
                // Home again: whole, calm, and back on its rounds. A body
                // standing on its home (the player, as like as not) keeps it
                // off: up against that body is home, or it would walk on the
                // spot, mending and never fighting, for as long as they stood.
                if (walkRound(sim, m, m.home.x, m.home.y, 0, S.speed, dt) || heldOff(sim, m)) Object.assign(m, { phase: 'patrol', t: 0, rest: S.patrolRest, hp: m.maxHp, enraged: false, stagger: 0 });
                return;
        }
    }
    // The swing: lunge along the locked facing and sample the blow from the
    // last step to this one, the body's own movement included.
    function swingStep(sim, m, dt) {
        const S = configOf(m.kind), move = S.moves[m.move], r = rigOf(sim, m);
        const u0 = m.t / move.swing;
        m.t = Math.min(move.swing, m.t + dt);
        const u1 = m.t / move.swing;
        const x0 = m.x, y0 = m.y, want = m.stopped ? 0 : lunge(move, u1) - lunge(move, u0);
        if (want > 0) terrainKit.moveCircle(sim.terrain, m, Math.cos(m.facing) * want, Math.sin(m.facing) * want, obstacles(sim, m));
        const p = worldSim.nearestFighter(sim, m);
        if (!m.struck && p && terrainKit.lineClear(sim.terrain, m.x, m.y, p.x, p.y)) {
            const x1 = m.x, y1 = m.y;
            const at = u => {
                const k = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
                return rigKit.solve(r, pose(r, { ...m, t: u * move.swing }), space.toBlocks(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, m.h), space.yawOf(m.facing));
            };
            const hit = combatKit.sweep(r, at, u0, u1, [{ id: p.id, boxes: fighterKit.hurtboxes(sim, p) }], striking(move));
            if (hit) {
                m.struck = true; m.stopped = true;
                combatKit.strike(sim, p, m, m.atk * move.ratio * (m.enraged ? S.enrage.atk : 1), hit.point, { move: m.move });
            }
        }
        if (m.phase === 'swing' && m.t >= move.swing - 1e-9) { m.phase = 'recover'; m.t = 0; }
    }

    function tickOne(sim, m, dt) {
        if (m.push) combatKit.tickPush(sim, m, dt, living(m) ? obstacles(sim, m) : []);
        if (!living(m)) { m.t += dt; m.moveBlend = approach(m.moveBlend, 0, dt / gameConfig.animation.blendSeconds); return; }
        if (m.flinch > 0) m.flinch = Math.max(0, m.flinch - dt);
        if (m.freeze > 0) { m.freeze = Math.max(0, m.freeze - dt); return; }
        const S = configOf(m.kind), tempo = m.enraged ? S.enrage.tempo : 1;
        walked = 0;
        think(sim, m, dt * tempo);
        // Walking home it mends (user, 2026-10-06); home, it is whole (`think`).
        if (m.phase === 'return') m.hp = Math.min(m.maxHp, m.hp + m.maxHp * M().returnHeal * dt);
        m.gait += walked / cycleLength(m.kind);
        m.speed = walked / dt;
        m.moveBlend = approach(m.moveBlend, walked > 1e-6 ? 1 : 0, dt / gameConfig.animation.blendSeconds);
        m.h = space.groundHeight(m.x, m.y);
    }
    function tick(sim, dt) { for (const m of sim.monsters) tickOne(sim, m, dt); }
    return { FIGHTING, rig, look, create, pose, solve, hurtboxes, struck, stagger, threshold, reach, bands, cycleLength, height, tick, living, engaged, inFight, present: living, modelOf };
})();
