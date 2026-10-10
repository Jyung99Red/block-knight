// The training dummy: anchored where the map puts it, it never walks,
// turns or gets pushed (design.md 5). While the player is
// within engageRange it attacks its moves in turn; its club hits by the same
// box test as the player's sword, and the blow is settled by
// combatKit.strike. Hits on it stagger it like any fighter.
//
// An entity (core/entity.js) of type 'dummy', found as sim.dummy:
//   { id, kind, x, y, h, facing, radius, solid, hp, maxHp, atk, def, anchored,
//   phase: idle|windup|swing|recover|reel, t, move (index), seq, wait,
//   struck (this swing already hit), stagger (points), flinch, freeze }
const dummyKit = (() => {
    const D = () => gameConfig.dummy, F = () => gameConfig.combat;
    const emit = (sim, type, data) => combatKit.emit(sim, type, { side: 'dummy', ...data });
    const clamp01 = v => Math.min(1, Math.max(0, v));
    const easeOut = t => 1 - (1 - t) * (1 - t);
    const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const smooth = t => t * t * (3 - 2 * t);

    function rig() { return rigKit.build(dummyModel, { equipment: [dummyPoses.club()] }); }
    function create(terrain, facing) {
        if (!terrain.dummy) return null;
        const at = terrainKit.cellCentre(terrain, terrain.dummy.col, terrain.dummy.row), S = D();
        return {
            id: 'dummy', type: 'dummy', kind: 'dummy', side: 'dummy', solid: true, x: at.x, y: at.y, h: space.groundHeight(at.x, at.y), facing, radius: S.radius,
            hp: S.maxHp, maxHp: S.maxHp, atk: S.atk, def: S.def, anchored: true, endless: true,
            phase: 'idle', t: 0, move: 0, seq: 0, wait: S.firstDelay, struck: false, stagger: 0, flinch: 0, freeze: 0, push: null
        };
    }
    // The judged pose: a pure function of the dummy's state.
    function pose(d) {
        const P = dummyPoses, move = D().moves[d.move], K = move && P.moves[move.id];
        let pose = P.idle;
        if (d.phase === 'windup') pose = rigKit.mix(P.idle, K.a, easeOut(clamp01(d.t / move.windup)));
        else if (d.phase === 'swing') pose = rigKit.mix(K.a, K.b, smooth(clamp01(d.t / move.swing)));
        else if (d.phase === 'recover') pose = rigKit.mix(K.b, P.idle, easeInOut(clamp01(d.t / move.recovery)));
        else if (d.phase === 'reel') {
            pose = rigKit.add(rigKit.mix(P.idle, P.reel, clamp01(d.t / gameConfig.animation.blendSeconds)),
                { spine: { rz: Math.sin(d.t * 9) * 0.12 }, base: { rz: Math.sin(d.t * 9 + 1) * 0.05 } });
        }
        if (d.flinch > 0) pose = rigKit.add(pose, rigKit.scale(P.flinch, d.flinch / D().flinchSeconds));
        return pose;
    }
    function solve(sim, d = sim.dummy) {
        return rigKit.solve(sim.rigs.dummy, pose(d), space.toBlocks(d.x, d.y, d.h), space.yawOf(d.facing));
    }
    function stagger(sim, amount) {
        const d = sim.dummy, S = F().stagger;
        if (d.phase === 'reel') return;
        d.stagger += amount;
        if (d.stagger >= S.threshold - 1e-9) {
            d.stagger = 0; d.phase = 'reel'; d.t = 0; d.struck = false;
            emit(sim, 'stagger');
        }
    }
    // A blow landed on it (combatKit.kitOf): it jolts back and may reel.
    function struck(sim, d, { amount, stagger: points = 0 }) {
        combatKit.damage(sim, d, amount);
        d.flinch = D().flinchSeconds;
        if (points > 0) stagger(sim, points);
    }
    function hurtboxes(sim, d = sim.dummy) { return combatKit.hurtboxes(sim.rigs.dummy, solve(sim, d)); }
    function swingStep(sim, dt) {
        const d = sim.dummy, move = D().moves[d.move];
        const u0 = d.t / move.swing;
        d.t = Math.min(move.swing, d.t + dt);
        const u1 = d.t / move.swing;
        // Whoever standing it can reach; the first one met is struck (none in a mirror).
        const targets = d.struck || sim.mirror ? [] : sim.fighters.filter(f => !f.down && terrainKit.lineClear(sim.terrain, d.x, d.y, f.x, f.y));
        if (targets.length) {
            const solveAt = u => rigKit.solve(sim.rigs.dummy, pose({ ...d, t: u * move.swing }), space.toBlocks(d.x, d.y, d.h), space.yawOf(d.facing));
            const hit = combatKit.sweep(sim.rigs.dummy, solveAt, u0, u1, targets.map(f => ({ id: f.id, boxes: fighterKit.hurtboxes(sim, f) })));
            if (hit) { d.struck = true; combatKit.strike(sim, targets.find(f => f.id === hit.id), d, d.atk * move.ratio, hit.point, { move: move.id }); }
        }
        if (d.phase === 'swing' && d.t >= move.swing - 1e-9) { d.phase = 'recover'; d.t = 0; }
    }
    function tick(sim, dt) {
        const d = sim.dummy;
        if (!d) return;
        if (d.flinch > 0) d.flinch = Math.max(0, d.flinch - dt);
        if (d.freeze > 0) { d.freeze = Math.max(0, d.freeze - dt); return; }
        if (d.push) combatKit.tickPush(sim, d, dt, sim.fighters);
        const S = D(), p = worldSim.nearestFighter(sim, d);
        if (d.phase === 'idle') {
            d.wait = Math.max(0, d.wait - dt);
            if (d.wait === 0 && p && Math.hypot(p.x - d.x, p.y - d.y) <= S.engageRange) {
                d.move = d.seq++ % S.moves.length; d.phase = 'windup'; d.t = 0; d.struck = false;
                emit(sim, 'windup', { move: S.moves[d.move].id });
            }
        } else if (d.phase === 'windup') {
            d.t += dt;
            if (d.t >= S.moves[d.move].windup - 1e-9) { d.phase = 'swing'; d.t = 0; emit(sim, 'swing', { move: S.moves[d.move].id, heavy: false }); }
        } else if (d.phase === 'swing') swingStep(sim, dt);
        else if (d.phase === 'recover') {
            d.t += dt;
            if (d.t >= S.moves[d.move].recovery - 1e-9) { d.phase = 'idle'; d.t = 0; d.wait = S.delay; }
        } else if (d.phase === 'reel') {
            d.t += dt;
            if (d.t >= F().stagger.duration - 1e-9) { d.phase = 'idle'; d.t = 0; d.wait = S.delay; emit(sim, 'recovered'); }
        }
    }
    return { rig, create, pose, solve, hurtboxes, struck, stagger, tick };
})();
