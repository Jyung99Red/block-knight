// The interact key (design.md 3.5): one target at a time, picked from the entities in reach that offer
// something (core/props.js offer), nearest first with a penalty for being
// off to the side, so the one ahead of a fighter wins over one behind. The
// target holds on a little past its reach, so the prompt does not flicker
// at the edge. Pressing the key does the target's action at once, or for an
// action with a `hold` (opening a chest) starts filling a bar that runs
// while the key stays down and the target stays the same and ready.
// A fight stops none of it (user, 2026-10-06: every limit taken out for
// now; they may come back).
//
// Besides entities, a partner lying down in a shared adventure is a target
// (fighterKit.offer: picked up, design.md 10). In a mirror (core/sim.js)
// the hand goes out and a hold fills, but the action itself is the host's
// to do.
//
// On a fighter: focus (the target's id, or null), using ({ id, t } while
// a hold fills, else null), and the left hand reaching out to it: handOut
// (0..1, how far) and handFor (seconds it stays out after a use). The
// reach is the same for every interaction for now (user, 2026-10-04).
const interactKit = (() => {
    const I = () => gameConfig.interact;
    // The rules of a target: a fighter's, or its entity kit's.
    const kitOf = e => combatKit.kitOf(e);
    function offerOf(sim, e, p) {
        const kit = kitOf(e);
        return kit.offer && (!kit.present || kit.present(e)) ? kit.offer(sim, e, p) : null;
    }
    // The best target for `p` now, or null.
    function pick(sim, p) {
        const S = I();
        let best = null, score = Infinity;
        const consider = e => {
            const held = e.id === p.focus, d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > (held ? S.release : S.reach)) return;
            if (!offerOf(sim, e, p)) return;
            const off = d > 1e-6 ? Math.abs(space.wrapAngle(Math.atan2(e.y - p.y, e.x - p.x) - p.facing)) : 0;
            const s = d + off * S.facingWeight - (held ? S.holdBonus : 0);
            if (s < score) { score = s; best = e; }
        };
        for (const e of sim.entities) consider(e);
        for (const f of sim.fighters) if (f !== p) consider(f);
        return best;
    }
    const byId = (sim, id) => entityKit.byId(sim, id) || sim.fighters.find(f => f.id === id) || null;
    // The current target and what it offers, for the screen: null or
    // { entity, offer, progress (0..1 of a hold under way) }.
    function target(sim, p) {
        const e = p.focus ? byId(sim, p.focus) : null, offer = e && offerOf(sim, e, p);
        if (!offer) return null;
        const progress = p.using && p.using.id === e.id && offer.hold > 0 ? Math.min(1, p.using.t / offer.hold) : 0;
        return { entity: e, offer, progress };
    }
    function press(sim, p) {
        const t = target(sim, p);
        if (!t || !t.offer.ready) return false;
        p.handFor = I().hand.stay;
        if (t.offer.hold > 0) { p.using = { id: t.entity.id, t: 0 }; return true; }
        if (!sim.mirror) kitOf(t.entity).use(sim, t.entity, p);
        return true;
    }
    function release(sim, p) { p.using = null; }
    function tick(sim, p, dt) {
        const H = I().hand;
        p.handFor = Math.max(0, p.handFor - dt);
        p.handOut = p.using || p.handFor > 0 ? Math.min(1, p.handOut + dt / H.out) : Math.max(0, p.handOut - dt / H.back);
        const e = pick(sim, p);
        p.focus = e ? e.id : null;
        const u = p.using;
        if (!u) return;
        const t = target(sim, p);
        if (!t || t.entity.id !== u.id || !t.offer.ready || !p.input.buttons.interact.held) { p.using = null; return; }
        u.t += dt;
        if (u.t >= t.offer.hold - 1e-9) { p.using = null; p.handFor = H.stay; if (!sim.mirror) kitOf(t.entity).use(sim, t.entity, p); }
    }
    return { pick, target, press, release, tick };
})();
