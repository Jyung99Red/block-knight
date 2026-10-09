// Fighting rules every fighter shares: damage, impact (hitstop and
// knockback), the guard bar, a blow meeting a fighter, and the hit
// test itself. A hit is a weapon box touching a body box
// (design.md 4.3): the attacker's swing is sampled at
// sub-steps between simulation steps so a fast blade cannot pass through a
// thin limb.
const combatKit = (() => {
    const C = () => gameConfig.combat;
    // The rules of whoever is struck: a fighter, or an entity that can be
    // hit (the training dummy, a monster: core/entity.js). Each kit has
    // hurtboxes(sim, body) and struck(sim, body, { amount, stagger, by }).
    const kitOf = body => body.kind === 'fighter' ? fighterKit : entityKit.kitOf(body);

    function defended(raw, def = 0) {
        return Math.max(1, Math.round(raw * (1 - def / (def + C().damage.defenseConstant))));
    }
    function emit(sim, type, data = {}) { sim.events.push({ type, time: sim.time, ...data }); }

    // Take hit points. A body marked `endless` (training) is refilled
    // instead of falling.
    function damage(sim, body, amount) {
        body.hp = Math.max(0, body.hp - amount);
        if (body.hp === 0 && body.endless) { body.hp = body.maxHp; emit(sim, 'refilled', { side: body.side }); }
    }

    // On contact both fighters' clocks stop for the hitstop; then the one
    // struck is pushed `distance` world units straight away from the other.
    function impact(sim, victim, attacker, kind, distance = C().impact.knockback[kind]) {
        const I = C().impact, stop = I.hitstop[kind] || 0;
        for (const body of [victim, attacker]) body.freeze = Math.max(body.freeze || 0, stop);
        if (victim.anchored || !(distance > 0)) return;
        const dx = victim.x - attacker.x, dy = victim.y - attacker.y, len = Math.hypot(dx, dy);
        if (len < 1e-9) return;
        const speed = distance / I.knockbackSeconds;
        victim.push = { x: dx / len * speed, y: dy / len * speed, t: I.knockbackSeconds };
    }
    // Knockback plays out after the hitstop, with ordinary collision.
    function tickPush(sim, body, dt, obstacles) {
        const k = body.push, span = Math.min(dt, k.t);
        terrainKit.moveCircle(sim.terrain, body, k.x * span, k.y * span, obstacles);
        k.t -= span;
        if (k.t <= 1e-9) body.push = null;
    }

    // ---- guard bar (design.md 4.5) ----
    // What a fighter guards with: the shield when one is carried, else the
    // weapon. Its numbers (combat.guard.shield / .weapon).
    function guardOf(body) { return inventoryKit.offhandOf(body.loadout) === 'shield' ? 'shield' : 'weapon'; }
    const guardBy = body => C().guard[guardOf(body)];
    function guardCost(raw, body, parry) {
        const G = C().guardBar;
        return raw / body.maxHp * guardBy(body).blockCostScale * G.max * (parry ? G.parryCostRatio : 1);
    }
    // Every guard cost goes through here. An empty bar drops the guard and
    // locks it until the bar refills to unlockRatio.
    function spendGuard(sim, body, amount) {
        const g = body.guard;
        g.bar = Math.max(0, g.bar - amount);
        if (g.bar > 1e-9) return;
        g.bar = 0; g.locked = true; g.state = 'down'; g.queued = false;
        emit(sim, 'guard_broken', { side: body.side });
    }
    function tickGuardBar(sim, body, dt) {
        const g = body.guard, G = C().guardBar;
        if (g.state !== 'down') { spendGuard(sim, body, G.holdDrain * dt); return; }
        if (g.bar >= G.max) return;
        g.bar = Math.min(G.max, g.bar + G.max / G.refillSeconds * dt);
        if (g.locked && g.bar >= G.max * G.unlockRatio - 1e-9) { g.locked = false; emit(sim, 'guard_ready', { side: body.side }); }
    }

    // ---- a blow meets a fighter: a block, a perfect parry, or a hit ----
    // `raw` is the blow before DEF; `point` (blocks) is only for effects.
    // blow: { move, heavy, stun (a hit breaks the combo), knockback (how far
    // a hit pushes) }. A foe's blow always stuns and pushes the standard
    // distance; a fighter's own move says (fighterKit, a duel).
    function strike(sim, victim, attacker, raw, point, { move, heavy = false, stun = true, knockback = C().impact.knockback.hit } = {}) {
        const v = victim, fighter = attacker.kind === 'fighter';
        if (v.guard.state === 'up' && inFront(v, attacker)) {
            const G = guardBy(v), parry = sim.time - v.guard.readyAt <= G.parryWindow + 1e-9;
            if (parry) {
                const counter = defended(v.atk * C().damage.parryAtkRatio, attacker.def);
                v.stats.parries++;
                emit(sim, 'parry', { side: v.side, target: attacker.id, damage: counter, at: point });
                kitOf(attacker).struck(sim, attacker, { amount: counter, stagger: C().stagger.parry, by: v });
                if (!(fighter && attacker.down)) impact(sim, attacker, v, 'parry');
                // The guarding arm shoves forward once the hitstop is over (fighterKit).
                v.shoveFor = C().guard.shove.in + C().guard.shove.out;
            } else {
                const amount = Math.round(defended(raw, v.def) * G.blockMultiplier);
                damage(sim, v, amount);
                v.stats.blocks++;
                emit(sim, 'block', { side: v.side, source: attacker.id, damage: amount, at: point, with: guardOf(v) });
                impact(sim, v, attacker, 'block');
            }
            // Paid after the hit is settled: the block that empties the bar still counts.
            spendGuard(sim, v, guardCost(raw, v, parry));
            if (v.hp === 0) fighterKit.fall(sim, v);
            return;
        }
        const amount = defended(raw, v.def);
        if (fighter) attacker.stats.hits++;
        emit(sim, 'hit', { side: attacker.side, source: attacker.id, target: v.id, move, damage: amount, heavy, at: point });
        fighterKit.struck(sim, v, { amount, stun });
        if (!v.down) impact(sim, v, attacker, 'hit', stun ? knockback : 0);
    }

    // ---- hit test ----
    const UNIT = () => gameConfig.world.unitsPerBlock;
    // Body boxes of a fighter as it stands now.
    function hurtboxes(rig, solved) { return rigKit.boxes(rig, solved, ['body']).map(b => b.box); }
    // Boxes that strike, grown by `pad` blocks on every side: weapon boxes,
    // or for a ram (the wolf's leap) the body itself.
    function attackBoxes(rig, solved, kinds = ['weapon'], pad = 0) {
        return rigKit.boxes(rig, solved, kinds).map(({ box }) => ({ ...box, h: box.h.map(v => v + pad) }));
    }
    function weaponBoxes(rig, solved, pad) { return attackBoxes(rig, solved, ['weapon'], pad); }
    const thinnest = boxes => Math.min(...boxes.map(b => 2 * Math.min(...b.h)));
    // How far the striking boxes' corners travel between two solved states.
    function travel(rig, s0, s1, kinds) {
        let far = 0;
        const w0 = attackBoxes(rig, s0, kinds), w1 = attackBoxes(rig, s1, kinds);
        w0.forEach((box, i) => {
            const c0 = math3d.corners(box), c1 = math3d.corners(w1[i]);
            c0.forEach((p, k) => { far = Math.max(far, math3d.length(math3d.sub(p, c1[k]))); });
        });
        return far;
    }
    // Sample the attacker's swing from progress u0 to u1. `solveAt(u)` gives
    // the attacker's solved rig at progress u; targets are { id, boxes }
    // (body boxes, already solved). Returns the first contact with each
    // target touched, in the order touched: [{ id, point, u }].
    // opts.kinds: which boxes strike (weapon by default); opts.pad: how much
    // they grow (combat.weaponPad by default).
    function contacts(rig, solveAt, u0, u1, targets, { kinds = ['weapon'], pad = C().weaponPad / UNIT() } = {}) {
        const found = [];
        if (!targets.length || !(u1 > u0)) return found;
        const first = solveAt(u0), last = solveAt(u1);
        const n = math3d.substeps(travel(rig, first, last, kinds), Math.min(...targets.map(t => thinnest(t.boxes))));
        const left = new Set(targets.map(t => t.id));
        for (let k = 1; k <= n && left.size; k++) {
            const solved = k === n ? last : solveAt(u0 + (u1 - u0) * k / n), strikers = attackBoxes(rig, solved, kinds, pad);
            for (const target of targets) {
                if (!left.has(target.id)) continue;
                for (const weapon of strikers) {
                    const box = target.boxes.find(b => math3d.overlap(weapon, b));
                    if (!box) continue;
                    found.push({ id: target.id, point: weapon.c.map((v, i) => (v + box.c[i]) / 2), u: u0 + (u1 - u0) * k / n });
                    left.delete(target.id);
                    break;
                }
            }
        }
        return found;
    }
    // The first contact of all, or null.
    function sweep(rig, solveAt, u0, u1, targets, opts) { return contacts(rig, solveAt, u0, u1, targets, opts)[0] || null; }
    // Is `from` within `half` radians of where `body` faces?
    function inArc(body, from, half) {
        const toward = Math.atan2(from.y - body.y, from.x - body.x);
        return Math.abs(space.wrapAngle(toward - body.facing)) <= half + 1e-9;
    }
    // Is `from` within the guard's front arc of `body`?
    function inFront(body, from) { return inArc(body, from, C().guard.frontAngle); }
    // Does the fighter `body` see `other` (a rival, a monster, the dummy)?
    // Only ahead of it (within `sight.angle` of where it faces) or right
    // by it (any part of the other within `sight.near`, behind it too:
    // user, 2026-10-04), with no block that hides between. `sight`: what
    // it sees at the hour ({ angle, near }: dayKit.sight; by day if not
    // given). The other's middle or either edge of it, as seen from
    // here, will do: a big body half round a corner shows.
    function sees(terrain, body, other, sight = gameConfig.player.sight.day) {
        const dx = other.x - body.x, dy = other.y - body.y, d = Math.hypot(dx, dy), r = d > 1e-6 ? (other.radius || 0) / d : 0;
        const near = d - (other.radius || 0) <= sight.near;
        for (const side of r ? [0, 1, -1] : [0]) {
            const at = { x: other.x - dy * r * side, y: other.y + dx * r * side };
            if ((near || inArc(body, at, sight.angle)) && terrainKit.sightClear(terrain, body.x, body.y, at.x, at.y)) return true;
        }
        return false;
    }
    return { kitOf, defended, emit, damage, impact, tickPush, guardOf, guardCost, spendGuard, tickGuardBar, strike, hurtboxes, attackBoxes, weaponBoxes, contacts, sweep, inFront, sees };
})();
