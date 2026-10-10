// A fighter: the move tree on A and B (pre-input, derive points, the pause
// line, the opening charge; the tree is the main weapon's type,
// design.md 4.2), the one attack key that gives A and B (a tap is an A, a
// hold a B), the guard key (with the shield if one is carried, else the
// weapon), the offhand key (potion, torch), being struck, and moving
// between all of that. Rules carried over from the 2D version (tag v1-2d,
// pve/spatial_engine.js). Every rule takes the fighter it applies to: an
// adventure has one (sim.player) or two sharing it, a duel two
// (sim.fighters).
//
// State on a fighter:
//   id, side   who it is ('player'; a duel's 'host' and 'guest'); events
//          carry it as `side`
//   input  its five controls: { move: { x, y }, buttons: { attack, guard,
//          offhand, interact: { held, presses } } }
//   stats  attacks, hits, misses, blocks, parries, hurt, kills
//   act    the move under way: { move, phase: windup|charge|swing|recover,
//          t (seconds into the phase), lead (windup already behind it when
//          it started: the time the key took to tell A from B), facing,
//          pressAt, share, stepTotal, hit: [ids], from: { move, t, feet } |
//          null: the move whose recovery it cut short, and where the feet
//          were then (core/player_anim.js) }
//   chain  the last finished swing, while its combo window is open:
//          { move, at (time the swing ended), cued }
//   buffer one input pressed ahead: { input: 'a' | 'b', at, age } (age
//          counts unfrozen time only, so a hitstop never eats into it)
//   combo  the inputs of the running combo, for display: 'a', 'b', '-'
//   guard  { state: down|raising|up, t, readyAt, bar, locked, queued }
//   shoveOut, shoveFor  a perfect parry's shove: how far out the guarding
//          arm is (0..1), and how long it still gives and goes out
//   stun, freeze (hitstop), push (knockback)
//   press  the attack key's press: null or { at, held, upAt, as (null while
//          it is still telling, then 'a' or 'b'), free (nothing has stood in
//          the way of a move since the press) }
//   down, downT  fallen (HP emptied where nobody is `endless`), and since when
//   rising seconds still getting up, picked up by a partner (design.md 10)
//   focus, using  the interact key's target and a hold under way (core/interact.js)
//   handOut, handFor  the left hand reaching out to interact (core/interact.js)
//   drink  a potion: null, or { phase: wait (pressed while busy) | drink, t }
//   lit    a torch carried in the offhand is burning
//   reveal seconds a ring of stealth worn still takes to hide its wearer
//          again (0: hidden; `hidden`)
//
// Swings are settled once every fighter has moved (`settle`): each is
// sampled against everyone as they stand after the step, and only then are
// the hits applied, so two fighters cutting each other in the same step
// both land, whoever is ticked first.
const fighterKit = (() => {
    const BUTTONS = Object.freeze(['attack', 'guard', 'offhand', 'interact']);
    const K = () => gameConfig.combo, F = () => gameConfig.combat;
    const moveOf = id => gameConfig.combo.moves[id];
    const emit = (sim, p, type, data) => combatKit.emit(sim, type, { side: p.id, ...data });
    const approach = (value, target, rate) => target > value ? Math.min(target, value + rate) : Math.max(target, value - rate);
    const heavyOf = m => m.knockback > 0 || m.stagger > 0;

    // `endless`: an emptied HP bar refills (training) instead of falling.
    // `stats`: HP, ATK and DEF (the base plus gear, core/inventory.js).
    function init(p, { id = 'player', endless = true, stats = inventoryKit.statsOf(inventoryKit.starter()) } = {}) {
        const buttons = {};
        for (const b of BUTTONS) buttons[b] = { held: false, presses: 0 };
        return Object.assign(p, {
            id, side: id, kind: 'fighter', hp: stats.maxHp, maxHp: stats.maxHp, atk: stats.atk, def: stats.def, endless,
            input: { move: { x: 0, y: 0 }, buttons },
            stats: { attacks: 0, hits: 0, misses: 0, blocks: 0, parries: 0, hurt: 0, kills: 0 },
            act: null, chain: null, buffer: null, combo: [], stun: 0, freeze: 0, push: null, press: null, down: false, downT: 0, rising: 0, focus: null, using: null, handOut: 0, handFor: 0, drink: null, lit: false, reveal: 0,
            guard: { state: 'down', t: 0, readyAt: -1, bar: F().guardBar.max, locked: false, queued: false }, guardBlend: 0, shoveOut: 0, shoveFor: 0
        });
    }
    // Everyone a fighter can hit: the training dummy, living monsters, and
    // in a duel the other fighter still standing (in a shared adventure the
    // other player is a partner, not a foe: design.md 10).
    function foes(sim, p) {
        const out = [];
        for (const e of sim.entities) if (e.type === 'dummy' || (e.type === 'monster' && monsterKit.living(e))) out.push(e);
        if (sim.duel) for (const f of sim.fighters) if (f !== p && !f.down) out.push(f);
        return out;
    }
    // Bodies in the way: other fighters and solid entities.
    const obstacles = (sim, p) => entityKit.obstacles(sim, p);
    // A fighter's own skeleton with its gear (sim.rigs.fighters).
    const rigOf = (sim, p) => sim.rigs.fighters[p.id];
    // The fighter's body as judged now.
    function solve(sim, p) {
        const rig = rigOf(sim, p);
        return rigKit.solve(rig, playerAnim.pose(rig, p), space.toBlocks(p.x, p.y, p.h), space.yawOf(p.facing));
    }
    function hurtboxes(sim, p) { return combatKit.hurtboxes(rigOf(sim, p), solve(sim, p)); }
    // Foes further than this from the fighter are not tested against a swing.
    const REACH = 240;

    // ---- the move tree ----
    // The pause line: this long after a move's swing ends, an A takes its
    // pause move. Each weapon type keeps its own beat.
    const pauseLine = id => moveOf(id).recovery + K().weapons[moveOf(id).weapon].pauseAfterRecovery;
    function chainOpen(p, at) {
        const c = p.chain;
        return !!c && at - c.at <= moveOf(c.move).recovery + K().windowAfterRecovery + 1e-9;
    }
    // The move an input pressed at `at` starts. The node is the move under
    // way (pressed ahead, in its windup or swing) or the last finished one
    // while its window is open. An A past the pause line takes the node's
    // pause move; a node without one treats it as an ordinary A. An input
    // with no entry starts over from the root of the fighter's weapon.
    function derive(p, input, at) {
        let node = null, paused = false;
        if (p.act && (p.act.phase === 'windup' || p.act.phase === 'swing')) node = p.act.move;
        else if (chainOpen(p, at)) {
            node = p.chain.move;
            paused = input === 'a' && at - p.chain.at >= pauseLine(node) - 1e-9;
        }
        const next = node ? moveOf(node).next || {} : {};
        const id = paused ? next.pause ?? next.a : next[input];
        return id ? { id, derived: true, paused: paused && !!next.pause } : { id: K().weapons[inventoryKit.weaponOf(p.loadout)].root[input], derived: false, paused: false };
    }
    // `lead`: seconds of the windup already behind it (see `decide`).
    function startMove(sim, p, input, at, lead = 0) {
        const d = derive(p, input, at), prev = p.act;
        p.act = {
            move: d.id, phase: 'windup', t: lead, lead, facing: p.facing, pressAt: at, share: 0, stepTotal: moveOf(d.id).step, hit: [],
            from: prev && prev.phase === 'recover' ? { move: prev.move, t: prev.t, feet: playerAnim.feetNow(rigOf(sim, p), p) } : null
        };
        p.combo = d.derived ? [...p.combo, ...(d.paused ? ['-'] : []), input] : [input];
        p.chain = null; p.buffer = null;
        // Attacking stands the body still: a run is over.
        p.runBlend = 0; p.moveTime = 0;
        // And it gives away the wearer of a ring of stealth.
        const ring = inventoryKit.stealthOf(p.loadout);
        if (ring) p.reveal = ring.cooldown;
        p.stats.attacks++;
        emit(sim, p, 'attack', { move: d.id });
    }
    // An A or a B, pressed at `at`.
    function attack(sim, p, input, at, lead) {
        // Guard up (or going up), or a potion at the lips: A and B do nothing.
        if (p.guard.state !== 'down' || p.guard.queued || p.drink) return false;
        if (p.act?.phase === 'charge') return false;
        // Pre-input: kept, never dropped; only the latest counts, and it runs
        // at the derive point, so pressing early never makes a move faster.
        if (p.act || p.stun > 0 || p.freeze > 0) { p.buffer = { input, at, age: 0 }; return true; }
        startMove(sim, p, input, at, lead);
        return true;
    }
    // ---- the attack key (user, 2026-10-03): one key for A and B. Let go
    // before combo.holdSeconds it is an A; held that long, a B. Either
    // counts from the press (the pause line, the charge). Telling them apart
    // takes time, and it is not lost: a move that starts at once begins that
    // far into its windup, so it lands when a key of its own would have.
    const startable = p => !p.act && p.stun <= 0 && p.freeze <= 0 && p.guard.state === 'down' && !p.guard.queued && !p.drink;
    const TELLING = Object.freeze({ phase: 'windup' });
    function decide(sim, p, input) {
        const k = p.press;
        k.as = input;
        return attack(sim, p, input, k.at, k.free && startable(p) ? sim.time - k.at : 0);
    }
    // Charge held so far for the move started by the B press at `act.pressAt`.
    function chargeOf(sim, p, act) {
        const b = p.press, C = F().charge;
        if (!b || b.at !== act.pressAt) return 0;
        return Math.min(C.full, (b.held ? sim.time : b.upAt) - b.at);
    }
    // `charged`: the swing comes out of a held charge. Let go before the
    // windup was over, it is the minimum charge (design.md 4.1).
    function beginSwing(sim, p, charged = false) {
        const a = p.act, m = moveOf(a.move), C = F().charge;
        if (m.charge) {
            a.share = charged ? Math.min(1, Math.max(0, (chargeOf(sim, p, a) - C.threshold) / (C.full - C.threshold))) : 0;
            a.stepTotal = m.step + (m.chargeStep || 0) * a.share;
        }
        // A charge can turn; the cut goes where the body faces now.
        a.facing = p.facing;
        a.phase = 'swing'; a.t = 0;
        emit(sim, p, 'swing', { move: a.move, heavy: heavyOf(m) });
    }
    // `quiet`: a predicted swing (a duel's guest) ends without a verdict.
    function endSwing(sim, p, quiet = false) {
        const a = p.act;
        if (!a.hit.length && !quiet) { p.stats.misses++; emit(sim, p, 'miss', { move: a.move }); }
        a.phase = 'recover'; a.t = 0;
        p.chain = { move: a.move, at: sim.time, cued: false };
    }
    // The fighter's body at swing progress u, for sampling the sweep.
    function solveAt(sim, p, a, x0, y0, x1, y1, u0, u1) {
        const rig = rigOf(sim, p), m = moveOf(a.move);
        return u => {
            const k = u1 > u0 ? (u - u0) / (u1 - u0) : 1;
            const body = { ...p, act: { ...a, t: u * m.swing } };
            return rigKit.solve(rig, playerAnim.pose(rig, body), space.toBlocks(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, p.h), space.yawOf(a.facing));
        };
    }
    // Swings advanced this step, waiting for `settle`.
    const sweeps = [];
    function swingStep(sim, p, dt) {
        const a = p.act, m = moveOf(a.move);
        const u0 = a.t / m.swing;
        a.t = Math.min(m.swing, a.t + dt);
        const u1 = a.t / m.swing;
        // The lunge: forward along the locked facing, easing out.
        const lunge = u => a.stepTotal * (1 - (1 - u) * (1 - u));
        const x0 = p.x, y0 = p.y, want = lunge(u1) - lunge(u0);
        if (want !== 0) terrainKit.moveCircle(sim.terrain, p, Math.cos(a.facing) * want, Math.sin(a.facing) * want, obstacles(sim, p));
        sweeps.push({ p, a, x0, y0, x1: p.x, y1: p.y, u0, u1, done: a.t >= m.swing - 1e-9 });
    }
    // Judge every swing of this step against everyone as they stand now,
    // then apply what landed. Each foe within reach is hit at most once by
    // a move, and never across a wall. With `judge` false (a duel's guest
    // predicting) swings pass through: the host decides every hit.
    function settle(sim, judge = true) {
        const list = sweeps.splice(0), landed = [];
        if (judge) {
            for (const s of list) {
                const { p, a } = s;
                if (p.act !== a) continue;
                const targets = foes(sim, p).filter(f => !a.hit.includes(f.id) && Math.hypot(f.x - p.x, f.y - p.y) <= REACH && terrainKit.lineClear(sim.terrain, p.x, p.y, f.x, f.y))
                    .map(f => ({ id: f.id, foe: f, boxes: combatKit.kitOf(f).hurtboxes(sim, f) }));
                if (!targets.length) continue;
                for (const hit of combatKit.contacts(rigOf(sim, p), solveAt(sim, p, a, s.x0, s.y0, s.x1, s.y1, s.u0, s.u1), s.u0, s.u1, targets)) {
                    a.hit.push(hit.id);
                    landed.push({ p, a, hit, foe: targets.find(t => t.id === hit.id).foe });
                }
            }
            for (const l of landed) land(sim, l);
        }
        for (const s of list) if (s.done && s.p.act === s.a) endSwing(sim, s.p, !judge);
    }
    function land(sim, { p, a, hit, foe }) {
        const m = moveOf(a.move), raw = p.atk * (m.ratio + (m.chargeRatio || 0) * a.share), heavy = heavyOf(m);
        // Another fighter has a shield and stun of its own (a duel): only a
        // heavy move breaks its combo (design.md 4.4).
        if (foe.kind === 'fighter') {
            combatKit.strike(sim, foe, p, raw, hit.point, { move: a.move, heavy, stun: heavy, knockback: m.knockback });
            return;
        }
        const amount = combatKit.defended(raw, foe.def);
        p.stats.hits++;
        emit(sim, p, 'hit', { source: p.id, target: foe.id, move: a.move, damage: amount, heavy, at: hit.point });
        combatKit.kitOf(foe).struck(sim, foe, { amount, stagger: m.stagger, by: p });
        combatKit.impact(sim, foe, p, 'hit', m.knockback);
    }

    // ---- the guard key: always there (user, 2026-10-03: guarding is the
    // defence, there is no dodge). It guards with the shield when one is
    // carried, else with the weapon, weaker (combatKit.guardOf).
    function raise(sim, p) {
        const g = p.guard;
        g.queued = false; g.state = 'raising'; g.t = 0;
        p.chain = null; p.combo = []; p.buffer = null;
        p.runBlend = 0; p.moveTime = 0;
        emit(sim, p, 'guard_raise', { with: combatKit.guardOf(p) });
        combatKit.spendGuard(sim, p, F().guardBar.raiseCost);
    }
    const GUARD = {
        // It drops a charge at once. Any other move plays out whole --
        // windup, swing and recovery (user, 2026-10-01) -- and the guard
        // goes up as it ends; a stun is waited out the same way.
        press(sim, p) {
            const g = p.guard;
            if (g.locked) { emit(sim, p, 'guard_locked'); return false; }
            if (g.state !== 'down' || g.queued) return false;
            if (p.act?.phase === 'charge') { p.act = null; emit(sim, p, 'charge_dropped'); }
            p.buffer = null;
            if (p.act || p.stun > 0) { g.queued = true; return true; }
            raise(sim, p);
            return true;
        },
        release(sim, p) {
            const g = p.guard;
            g.queued = false;
            if (g.state !== 'down') { g.state = 'down'; emit(sim, p, 'guard_lower'); }
        },
        tick(sim, p, dt) {
            const g = p.guard;
            if (g.state === 'raising') {
                g.t += dt;
                if (g.t >= F().guard.startup - 1e-9) { g.state = 'up'; g.readyAt = sim.time; }
            }
            // A perfect parry's shove (combatKit.strike): the guarding arm
            // gives (shoveFor counts that down first, through the hitstop:
            // `tick`), then goes out and comes straight back. It is a pose and no more
            // (core/player_anim.js): nothing waits for it, and with the
            // guard down it is on its way back at once.
            const S = F().guard.shove, out = g.state === 'up' && p.shoveFor > 1e-9, giving = p.shoveFor > S.out + 1e-9;
            p.shoveFor = out ? Math.max(0, p.shoveFor - dt) : 0;
            if (!out) p.shoveOut = Math.max(0, p.shoveOut - dt / S.back);
            else if (!giving) p.shoveOut = Math.min(1, p.shoveOut + dt / S.out);
        }
    };
    // ---- the offhand key: the item carried there (a shield is the guard
    // key's; with one, or nothing, the key does nothing) ----
    const ITEMS = {
        // A potion (design.md 3.4): a press drinks one, if any are
        // left -- at once when free, else as soon as the move or stun is
        // over (like the guard, and meanwhile A and B do nothing; another
        // press calls it off). The drink takes potion.seconds; a blow that
        // gets through spills it and the potion is kept.
        potion: {
            press(sim, p) {
                if (p.drink?.phase === 'wait') { p.drink = null; return true; }
                if (p.drink) return false;
                if (inventoryKit.count(propKit.bagOf(sim, p), 'potion') < 1) { emit(sim, p, 'potion_empty'); return false; }
                p.buffer = null;
                if (p.act?.phase === 'charge') { p.act = null; emit(sim, p, 'charge_dropped'); }
                p.drink = { phase: 'wait', t: 0 };
                if (!p.act && p.stun <= 0) startDrink(sim, p);
                return true;
            },
            tick(sim, p, dt) {
                const d = p.drink;
                if (!d) return;
                if (d.phase === 'wait') {
                    d.t += dt;
                    if (!p.act && p.stun <= 0) startDrink(sim, p);
                    return;
                }
                d.t += dt;
                if (d.t < F().potion.seconds - 1e-9) return;
                p.drink = null;
                // (A mirror leaves the drink itself to the host.)
                if (sim.mirror) return;
                const bag = propKit.bagOf(sim, p);
                if (inventoryKit.count(bag, 'potion') < 1) return;
                inventoryKit.give(bag, 'potion', -1);
                const before = p.hp;
                p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * F().potion.heal));
                emit(sim, p, 'drink', { healed: p.hp - before, left: inventoryKit.count(bag, 'potion') });
            }
        },
        // A torch: each press lights it or puts it out. It lights the dark
        // (drawn) and sets thickets alight (core/props.js).
        torch: {
            press(sim, p) { light(sim, p, !p.lit); return true; },
            tick() {}
        }
    };
    function light(sim, p, on) {
        if (p.lit === on) return;
        p.lit = on;
        emit(sim, p, on ? 'torch_lit' : 'torch_out');
    }
    function startDrink(sim, p) {
        p.drink = { phase: 'drink', t: 0 };
        p.chain = null; p.combo = []; p.buffer = null;
        p.runBlend = 0; p.moveTime = 0;
        emit(sim, p, 'drink_start');
    }
    // The offhand item the offhand key uses, or null.
    const itemOf = p => ITEMS[inventoryKit.offhandOf(p.loadout)] || null;
    // ---- a ring of stealth (design.md 7.2; user, 2026-10-06): monsters do
    // not notice its wearer (core/monster.js). Starting an attack gives the
    // wearer away; the ring hides them again once its cooldown has passed
    // with no monster in a fight (it counts from the fight's end) ----
    const hidden = p => !p.down && !(p.reveal > 0) && !!inventoryKit.stealthOf(p.loadout);
    function tickStealth(sim, p, dt) {
        if (!(p.reveal > 0)) return;
        const ring = inventoryKit.stealthOf(p.loadout);
        p.reveal = !ring ? 0 : monsterKit.inFight(sim) ? ring.cooldown : Math.max(0, p.reveal - dt);
    }

    function press(sim, p, button) {
        if (p.down) return false;
        if (button === 'attack') {
            // Free to attack, the body stands at once, as for a windup, while
            // the key tells A from B; a run is over.
            const free = startable(p);
            p.press = { at: sim.time, held: true, upAt: null, as: null, free };
            if (free) { p.runBlend = 0; p.moveTime = 0; }
            return true;
        }
        if (button === 'guard') return GUARD.press(sim, p);
        if (button === 'offhand') { const item = itemOf(p); return item ? item.press(sim, p) : false; }
        // Interact works alongside the guard (design.md 3.5).
        return interactKit.press(sim, p);
    }
    function release(sim, p, button) {
        if (p.down) return;
        if (button === 'attack' && p.press?.held) {
            const k = p.press;
            k.held = false; k.upAt = sim.time;
            if (!k.as) decide(sim, p, 'a');
            // Letting go of a charge cuts.
            else if (p.act?.phase === 'charge' && p.act.pressAt === k.at) beginSwing(sim, p, true);
        }
        if (button === 'guard') GUARD.release(sim, p);
        if (button === 'interact') interactKit.release(sim, p);
    }

    // ---- being struck (combatKit.strike, or a parry thrown back) ----
    // The HP bar emptied where the fighter can lose: down for good.
    function fall(sim, p) {
        if (p.down) return;
        Object.assign(p, { down: true, downT: 0, rising: 0, act: null, chain: null, combo: [], buffer: null, press: null, stun: 0, push: null, speed: 0, pace: 0, runBlend: 0, moveTime: 0, focus: null, using: null, handOut: 0, handFor: 0, drink: null, shoveOut: 0, shoveFor: 0 });
        p.guard.state = 'down'; p.guard.queued = false;
        emit(sim, p, 'down');
    }
    // A blow that got through: `amount` HP, and with `stun` the combo is
    // broken and the controls freeze for combat.hitStun.
    function struck(sim, p, { amount, stun = true }) {
        combatKit.damage(sim, p, amount);
        p.stats.hurt++;
        if (p.hp === 0) { fall(sim, p); return; }
        if (!stun) return;
        if (p.drink) { p.drink = null; emit(sim, p, 'drink_spilled'); }
        p.act = null; p.chain = null; p.combo = [];
        if (p.guard.state !== 'down') p.guard.state = 'down';
        // Still holding the guard key: it goes back up once the stun is over.
        p.guard.queued = p.input.buttons.guard.held && !p.guard.locked;
        // (Getting up is not cut short.)
        p.stun = Math.max(p.stun, F().hitStun);
        p.runBlend = 0; p.moveTime = 0;
    }

    // ---- a partner down (design.md 10; user, 2026-10-10) ----
    // In a shared adventure a fallen fighter waits for the other: holding
    // the interact key over it for coop.reviveHold seconds picks it up
    // with coop.reviveHp of its HP. It gets up over coop.riseSeconds,
    // standing still meanwhile (as stunned). Not in a duel, nor alone.
    function offer(sim, f, p) {
        if (sim.duel || f === p || !f.down || sim.result) return null;
        return { verb: '救起', name: '同伴', hold: gameConfig.coop.reviveHold, ready: true, why: '' };
    }
    function use(sim, f, p) {
        if (!f.down) return;
        const R = gameConfig.coop;
        Object.assign(f, { down: false, downT: 0, hp: Math.max(1, Math.round(f.maxHp * R.reviveHp)), stun: R.riseSeconds, rising: R.riseSeconds });
        emit(sim, f, 'rescued', { by: p.id, at: space.toBlocks(f.x, f.y, 30) });
    }

    // ---- moving ----
    function motion(sim, p, dt) {
        // An attack key still telling A from B stands the body like a windup.
        const P = gameConfig.player, mv = p.input.move, mag = Math.hypot(mv.x, mv.y), a = p.act || (p.press && !p.press.as && p.press.free ? TELLING : null);
        const guarding = p.guard.state !== 'down', charging = a?.phase === 'charge', drinking = p.drink?.phase === 'drink';
        let striding = false;
        p.speed = 0;
        if (mag > 1e-6 && !p.stun && (!a || charging)) {
            // From a standstill the walk builds up over startSeconds, and
            // heading away from where the body faces is slower until it has
            // turned: no gliding off at full speed (user, 2026-10-02).
            p.pace = Math.min(1, p.pace + dt / P.startSeconds);
            const off = Math.abs(space.wrapAngle(Math.atan2(mv.y, mv.x) - p.facing));
            let speed = P.speed * Math.min(1, mag) * p.pace * (1 - P.turnSlow * (1 - Math.cos(off)) / 2), turn = P.turnRate;
            if (guarding) { speed *= F().guard.moveMultiplier; turn *= F().guard.turnMultiplier; }
            else if (drinking) { speed *= F().potion.moveMultiplier; turn *= F().potion.turnMultiplier; }
            else if (charging) { speed *= F().charge.moveMultiplier; turn *= F().charge.turnMultiplier; }
            else speed *= 1 + (P.runSpeed / P.speed - 1) * p.runBlend;
            const x0 = p.x, y0 = p.y;
            terrainKit.moveCircle(sim.terrain, p, mv.x / mag * speed * dt, mv.y / mag * speed * dt, obstacles(sim, p));
            const moved = Math.hypot(p.x - x0, p.y - y0);
            p.gait += moved / playerAnim.cycleLength(rigOf(sim, p), p.runBlend);
            p.speed = moved / dt;
            p.facing = space.turn(p.facing, Math.atan2(mv.y, mv.x), turn * dt);
            // Walking off ends the combo.
            if (!a && moved > 1e-9) { p.chain = null; p.combo = []; }
            // An unbroken walk turns into a run: stick well pushed, free
            // walking (no shield, no charge), and really getting somewhere.
            striding = !guarding && !drinking && !a && mag >= P.runStick - 1e-9 && moved >= 0.5 * P.speed * dt;
        } else if (mag > 1e-6 && a?.phase === 'windup' && !p.stun) {
            // A windup lets the stick turn the body, slower, to aim the
            // move; the swing locks it, and the recovery does not turn at
            // all (user, 2026-10-02).
            p.facing = space.turn(p.facing, Math.atan2(mv.y, mv.x), P.turnRate * K().windupTurnMultiplier * dt);
        }
        if (p.speed === 0) p.pace = 0;
        p.moveTime = striding ? p.moveTime + dt : 0;
        p.runBlend = approach(p.runBlend, p.moveTime >= P.runAfter - 1e-9 ? 1 : 0, dt / P.runRampSeconds);
    }

    function tick(sim, p, dt) {
        const B = gameConfig.animation.blendSeconds;
        if (p.down) { p.downT += dt; p.speed = 0; blends(p, dt, B); return; }
        // The guard bar runs on under the hitstop.
        combatKit.tickGuardBar(sim, p, dt);
        if (p.freeze > 0) {
            p.freeze = Math.max(0, p.freeze - dt);
            // A parried blow drives the guard back while the hitstop holds
            // everything else (user, 2026-10-05); the shove waits for its end.
            const S = F().guard.shove, held = S.out;
            if (p.shoveFor > held) p.shoveFor = Math.max(held, p.shoveFor - dt);
            blends(p, dt, B);
            return;
        }
        // A buffered input expires, unless it is a B still held down: that is
        // an opening charge waiting for its turn, not a stale press.
        const b = p.buffer;
        if (b && (b.age += dt) > K().bufferSeconds + 1e-9 && !(b.input === 'b' && p.press?.held && p.press.at === b.at)) p.buffer = null;
        if (p.push) combatKit.tickPush(sim, p, dt, obstacles(sim, p));
        if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
        if (p.rising > 0) p.rising = Math.max(0, p.rising - dt);
        // The attack key held long enough is a B.
        const k = p.press;
        if (k && !k.as) {
            if (!startable(p)) k.free = false;
            if (k.held && sim.time - k.at >= K().holdSeconds - 1e-9) decide(sim, p, 'b');
        }
        free(sim, p);
        GUARD.tick(sim, p, dt);
        tickStealth(sim, p, dt);
        itemOf(p)?.tick(sim, p, dt);
        interactKit.tick(sim, p, dt);
        motion(sim, p, dt);
        tickAct(sim, p, dt);
        free(sim, p);
        // Crossing the pause line of a node that has a pause move is cued once.
        const c = p.chain;
        if (c && !p.act) {
            const m = moveOf(c.move);
            if (!chainOpen(p, sim.time)) { p.chain = null; p.combo = []; }
            else if (m.next?.pause && !c.cued && sim.time - c.at >= pauseLine(c.move) - 1e-9) {
                c.cued = true; emit(sim, p, 'pause_ready', { move: m.next.pause });
            }
        }
        blends(p, dt, B);
    }
    // Free again (a move over, a stun over, a hitstop over) with something
    // waiting: a queued shield goes up, else a buffered input runs.
    function free(sim, p) {
        if (p.act || p.stun > 0) return;
        if (p.guard.queued) raise(sim, p);
        else if (p.buffer && p.guard.state === 'down' && !p.drink) { const w = p.buffer; startMove(sim, p, w.input, w.at); }
    }
    function blends(p, dt, B) {
        p.moveBlend = approach(p.moveBlend, p.speed > 1e-6 ? 1 : 0, dt / B);
        const up = p.guard.state !== 'down';
        p.guardBlend = approach(p.guardBlend, up ? 1 : 0, dt / (up ? F().guard.startup : B));
    }
    function tickAct(sim, p, dt) {
        const a = p.act;
        if (!a) return;
        const m = moveOf(a.move);
        if (a.phase === 'windup') {
            a.t += dt;
            if (a.t < m.windup - 1e-9) return;
            // Still holding the B that started a charging move: charge -- unless
            // the shield was pressed meanwhile, which drops the charge.
            if (m.charge && p.press?.held && p.press.at === a.pressAt) {
                if (p.guard.queued) { p.act = null; emit(sim, p, 'charge_dropped'); raise(sim, p); return; }
                a.phase = 'charge'; a.t = 0; emit(sim, p, 'charge'); return;
            }
            beginSwing(sim, p);
        } else if (a.phase === 'charge') {
            a.t += dt;
        } else if (a.phase === 'swing') {
            swingStep(sim, p, dt);
        } else {
            a.t += dt;
            // At the derive point a buffered input this move derives cuts the
            // recovery short; one that starts over waits for its end.
            if (m.derive != null && a.t >= m.derive - 1e-9 && p.buffer && derive(p, p.buffer.input, p.buffer.at).derived) { const b = p.buffer; startMove(sim, p, b.input, b.at); return; }
            if (a.t >= m.recovery - 1e-9) {
                p.act = null;
                if (p.buffer) { const b = p.buffer; startMove(sim, p, b.input, b.at); }
            }
        }
    }
    return { BUTTONS, init, press, release, tick, settle, struck, fall, offer, use, foes, solve, hurtboxes, derive, chargeOf, rigOf, light, hidden, ITEMS };
})();
