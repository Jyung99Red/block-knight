// A shared adventure between two phones (design.md 10; user, 2026-10-10).
// One phone hosts its own world -- its region, its bosses, chests,
// resources and time of day -- and keeps playing in it; the other joins
// it, one more fighter beside the host's. The host runs the world and
// decides everything in it; the guest sends its controls and draws the
// host's snapshots, predicting in between as a duel's guest does
// (core/duel.js): its copy of the world is a mirror (core/sim.js), which
// plays on from each snapshot to this phone's own time with its own
// unconfirmed controls replayed, nothing in it judged. No DOM and no
// network here: `send` and `now` come from the caller, so Node tests can
// play both ends.
//
// What is the world's stays the host's (its save): a chest opened, a boss
// down, a resource gathered, a thicket burnt. What the guest picks up,
// drinks or spends is its own: its bag ({ inventory, loadout }, from its
// own save) rides in the host's world (sim.bags.guest) and comes back in
// every snapshot, for the guest's phone to keep -- what it got in the
// host's world goes home with it (user, 2026-10-10). The guest trades at
// the base's shop and smithy through the host (`trade`): the same rules on
// that bag there. Its gear stays as it came.
//
// Messages: hello { protocol, rules } both ways on connect, the guest's
// with its bag; host world { visit, region, progress, state } as the guest
// is let in and whenever the host's world is built anew (the party went
// through a portal, everyone fell, ...); host snap { visit, serial, ack,
// stamp, wait, state, events, ground? } every coop.snapshotSeconds
// (`ground`: the terrain's changes, whenever they change); guest input
// { seq, cmd } and trade { op, id, n }; either way beat, away / back (a
// phone in the background) and leave. As in a duel the guest numbers its
// inputs and beats (`stamp`) and a snapshot names the last one had and
// how long ago (`wait`), which times the way there and back.
// A snapshot leaves out what never changes once placed (buildings,
// portals, lamps) and rounds its numbers: the guest only plays on from
// them till the next one.
const coopKit = (() => {
    const PROTOCOL = 1;
    const GUEST = 'guest';
    const P = () => gameConfig.pvp, C = () => gameConfig.coop;
    const STEP = simLoop.STEP;
    const FIXED = new Set(['building', 'portal', 'lamp']);
    const LIVE = new Set(['dummy', 'monster', 'chest', 'grave', 'drop', 'brush', 'node']);
    const TRADES = { buy: (bag, id) => inventoryKit.buy(bag, id), sell: (bag, id, n) => inventoryKit.sell(bag, id, n), craft: (bag, id) => inventoryKit.craft(bag, id) };
    const PREDICTED = duelKit.PREDICTED;
    // A frame this long after the last one: this phone itself stood still
    // (a slow moment, a page in the background), and what the other sent
    // meanwhile may still be waiting to be read. Silence is counted from
    // this long before such a frame, not from before the stall.
    const STALL = 1;

    // Everything both phones must agree on, as one short fingerprint: the
    // rules and every model a blow is judged by.
    let fingerprint = null;
    function rules() {
        if (!fingerprint) {
            const { input, controlsLayout, graphics, camera, ...shared } = gameConfig, I = gameConfig.items;
            const gear = Object.keys(I).filter(id => I[id].slot).map(id => equipmentModels.forLoadout({ [I[id].slot]: id }));
            fingerprint = duelKit.hash(JSON.stringify([PROTOCOL, shared, playerModel, playerPoses, playerMoves, gear, dummyModel, dummyPoses, goblinModel, goblinPoses, wolfModel, wolfPoses, spiderModel, spiderPoses]));
        }
        return fingerprint;
    }

    const num = v => typeof v === 'number' && Number.isFinite(v);
    const count = v => Number.isSafeInteger(v) && v >= 0;
    const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    // A bag from the other phone, made safe the way a save is.
    function cleanBag(bag) {
        const out = saveKit.clean({ v: saveKit.VERSION, inventory: bag?.inventory, loadout: bag?.loadout });
        return { inventory: out.inventory, loadout: out.loadout };
    }

    // ---- the world, as both phones build it ----
    // Every change to the terrain, gathered resources too: [[col, row, kind, level]].
    const changes = t => Object.entries(t.edits).map(([key, [kind, level]]) => { const [c, r] = key.split(',').map(Number); return [c, r, kind, level]; });
    // The terrain made to match a list of `changes`.
    function setGround(t, list) {
        const want = new Set(list.map(([c, r]) => `${c},${r}`));
        for (const key of Object.keys(t.edits)) {
            if (want.has(key)) continue;
            const [c, r] = key.split(',').map(Number), [kind, level] = terrainKit.generated(t, c, r);
            terrainKit.set(t, c, r, kind, level);
        }
        terrainKit.applyEdits(t, list);
    }
    const validGround = list => Array.isArray(list) && list.every(e => Array.isArray(e) && e.length === 4 && count(e[0]) && count(e[1]) && typeof e[2] === 'string' && count(e[3]));
    // What a guest builds the host's world from, besides its state: the
    // region and the progress that places what is in it.
    function worldOf(sim) {
        const p = propKit.progressOf(sim);
        return { region: sim.region, progress: { bosses: { ...p.bosses }, revived: { ...p.revived }, chests: { ...p.chests }, clock: p.clock, gathered: {}, edits: { [sim.region]: changes(sim.terrain) } } };
    }
    const ROUND = (key, v) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v;
    // The state sent: a snapshot without what never changes, and the
    // world's progress the guest's copy reads (the hour, what is open).
    function stateOf(sim) {
        const s = worldSim.snapshot(sim), p = propKit.progressOf(sim);
        s.entities = s.entities.filter(e => !FIXED.has(e.type));
        s.world = { clock: p.clock, bosses: p.bosses, revived: p.revived, chests: p.chests };
        return JSON.parse(JSON.stringify(s, ROUND));
    }
    // Written into a guest's copy: what never changes is kept.
    function restore(sim, state) {
        const fixed = sim.entities.filter(e => FIXED.has(e.type));
        worldSim.restore(sim, state);
        sim.entities = [...fixed, ...sim.entities];
        const p = propKit.progressOf(sim), w = state.world;
        Object.assign(p, { clock: w.clock, bosses: { ...w.bosses }, revived: { ...w.revived }, chests: { ...w.chests } });
    }
    function validState(sim, s) {
        if (!obj(s) || !num(s.time) || s.time < 0 || !count(s.tick) || s.region !== sim.region || s.duel !== false || !count(s.seed) || !count(s.serial)) return false;
        if (!Array.isArray(s.fighters) || s.fighters.length !== sim.fighters.length) return false;
        if (!s.fighters.every((f, i) => obj(f) && f.id === sim.fighters[i].id && num(f.x) && num(f.y) && num(f.hp) && num(f.facing) && obj(f.input) && obj(f.guard) && obj(f.loadout))) return false;
        if (!Array.isArray(s.entities) || !s.entities.every(e => obj(e) && typeof e.id === 'string' && LIVE.has(e.type) && num(e.x) && num(e.y) && (e.type !== 'monster' || Object.hasOwn(sim.rigs.monsters, e.kind)))) return false;
        if (s.entities.some(e => e.type === 'dummy') && !sim.rigs.dummy) return false;
        const w = s.world, bag = s.bags?.[GUEST];
        if (!obj(w) || !num(w.clock) || !obj(w.bosses) || !obj(w.revived) || !obj(w.chests)) return false;
        if (!obj(bag) || !obj(bag.inventory) || !count(bag.inventory.gold) || !obj(bag.inventory.items) || !obj(bag.loadout)) return false;
        return s.result === null || obj(s.result);
    }
    // A guest's copy of the host's world, from a `world` message; throws
    // if it does not make one.
    function mirror(msg) {
        const s = msg.state;
        if (!obj(msg.progress) || !obj(s) || !Array.isArray(s.fighters) || !obj(s.fighters[0]) || !gameConfig.maps[msg.region] || gameConfig.maps[msg.region].duel) throw new Error('Not a world');
        const sim = worldSim.create({ region: msg.region, progress: msg.progress, loadout: s.fighters[0].loadout, seed: s.seed });
        for (const f of s.fighters.slice(1)) worldSim.join(sim, { id: f.id, loadout: f.loadout, bag: s.bags?.[f.id] || null, spot: f });
        sim.mirror = true;
        if (!validState(sim, s)) throw new Error('Not a world');
        restore(sim, s);
        return sim;
    }

    // ---- the host's end ----
    // world(): the host's world now (its page builds it anew as the party
    // travels). on (all optional): join({ loadout, bag }) a guest is let
    // in: put its fighter in the world now (worldSim.join, id GUEST, with
    // that very bag, which this end keeps across worlds); part(reason) the
    // guest is gone ('left' | 'timeout' | 'away' (in the background too
    // long) | 'lost' (the channel closed) | 'incompatible'): take its
    // fighter out. The room stays open for the next one.
    function host({ send, now, world, on = {} }) {
        // guest: { seq (last input had), heard, away, awaySince, stamp,
        // stampAt (the last stamp had, and when), bag }, or null.
        let guest = null, eventId = 0, history = [], serial = 0, visit = 0, ground = -1, lastSnap = -Infinity, lastSent = -Infinity, selfAway = false, frameAt = now();
        function post(message) { lastSent = now(); send(message); }
        const index = sim => sim.fighters.findIndex(f => f.id === GUEST);
        function drop(reason, tell = null) {
            if (!guest) return;
            if (tell) post({ t: tell });
            guest = null; history = [];
            on.part?.(reason);
        }
        // The world as it is now, to the guest: as it is let in, and
        // whenever the world is built anew (the page says so).
        function enter() {
            if (!guest) return;
            const sim = world();
            visit++; history = []; ground = sim.terrain.rev; lastSnap = now();
            post({ t: 'world', visit, ...worldOf(sim), state: stateOf(sim) });
        }
        function snapshot() {
            const sim = world(), t = now();
            lastSnap = t;
            const msg = { t: 'snap', visit, serial: ++serial, ack: guest.seq, stamp: guest.stamp, wait: Math.max(0, t - guest.stampAt), state: stateOf(sim), events: history };
            if (sim.terrain.rev !== ground) { ground = sim.terrain.rev; msg.ground = changes(sim.terrain); }
            post(msg);
        }
        function receive(msg) {
            if (!obj(msg) || typeof msg.t !== 'string') return;
            if (msg.t === 'hello') {
                if (guest) return;
                if (msg.protocol !== PROTOCOL || msg.rules !== rules()) { on.part?.('incompatible'); return; }
                const bag = cleanBag(msg.bag);
                guest = { seq: 0, heard: now(), away: false, awaySince: 0, stamp: 0, stampAt: now(), bag };
                on.join?.({ loadout: bag.loadout, bag });
                enter();
                return;
            }
            if (!guest) return;
            guest.heard = now();
            if (msg.t === 'leave') { drop('left'); return; }
            if (count(msg.stamp) && msg.stamp > guest.stamp) { guest.stamp = msg.stamp; guest.stampAt = guest.heard; }
            if (count(msg.ack) && msg.ack <= eventId) history = history.filter(e => e.id > msg.ack);
            if (msg.t === 'away' || msg.t === 'back') { guest.away = msg.t === 'away'; guest.awaySince = guest.heard; }
            else if (msg.t === 'input' && msg.seq === guest.seq + 1) {
                guest.seq = msg.seq;
                const sim = world(), i = index(sim);
                if (i >= 0) worldSim.command(sim, msg.cmd, i);
            } else if (msg.t === 'trade' && Object.hasOwn(TRADES, msg.op) && typeof msg.id === 'string') {
                TRADES[msg.op](guest.bag, msg.id, msg.n === 'all' ? Infinity : Number(msg.n) || 1);
            }
        }
        // Events as they happen (the page drains the world): numbered for the guest.
        function take(events) {
            if (!guest) return;
            for (const e of events) history.push({ ...e, id: ++eventId });
            if (history.length > P().historyEvents) history.splice(0, history.length - P().historyEvents);
        }
        // The frame: a snapshot when one is due; a guest not heard from
        // for too long (or away too long) is let go.
        function frame() {
            const t = now(), gap = t - frameAt;
            frameAt = t;
            if (!guest) return;
            if (gap > STALL) guest.heard = Math.max(guest.heard, t - STALL);
            if (guest.away ? t - guest.awaySince > P().awaySeconds : t - guest.heard > P().timeoutSeconds) { drop(guest.away ? 'away' : 'timeout', 'leave'); return; }
            if (!selfAway && t - lastSnap >= C().snapshotSeconds - 1e-9) snapshot();
            if (t - lastSent >= P().heartbeatSeconds) post({ t: 'beat' });
        }
        return {
            role: 'host', selfId: 'player',
            get guestIn() { return !!guest; },
            // The guest's bag, kept here across worlds; null with no guest.
            get bag() { return guest?.bag || null; },
            // Who the world waits for: the guest in the background, or nobody.
            get waiting() { return guest?.away ? 'peer' : null; },
            // A guest's channel is open: introduce this phone.
            open() { post({ t: 'hello', protocol: PROTOCOL, rules: rules() }); },
            receive, take, frame, enter,
            // This phone's page went to the background, or is back.
            away(flag) {
                if (selfAway === !!flag) return;
                selfAway = !!flag;
                if (guest) post({ t: selfAway ? 'away' : 'back' });
                if (!selfAway && guest) guest.heard = now();
            },
            // In the background no frames run: this keeps the channel alive there.
            pulse() { if (guest && now() - lastSent >= P().heartbeatSeconds) post({ t: 'beat' }); },
            // The room is closed for good.
            close() { drop('closed', 'leave'); },
            // The guest's channel itself is gone.
            lost() { drop('lost'); }
        };
    }

    // ---- the guest's end ----
    // bag: what it brings ({ inventory, loadout }: its own save's).
    // on (all optional): start(sim) a world to play in (let in, or the
    // host's world built anew); end(reason) 'incompatible' | 'timeout' |
    // 'lost' (the channel closed) | 'left' (the host closed its room) |
    // 'away' (the host in the background too long) | 'closed' (this phone
    // left): over for good.
    function guest({ send, now, bag, on = {} }) {
        let phase = 'hello', sim = null, visit = 0, endReason = null, peerOk = false;
        let lastHeard = now(), lastSent = -Infinity, hostAway = false, awaySince = 0, selfAway = false;
        // `latency` one way, from `timed` samples (`stamps`: when each
        // numbered message left); `frameAt` when the last frame ran;
        // `synced` once its time follows the snapshots.
        let inputSeq = 0, pending = [], applied = -1, seenEvent = 0, latency = 0.03, timed = 0, frameAt = now(), synced = false, stamp = 0;
        const stamps = new Map();
        // drawing: bodies before the last live step, and snapshot
        // corrections still being eased out
        let before = new Map(), offsets = new Map();
        const outbox = [];
        const loop = simLoop.create(dt => {
            remember();
            worldSim.step(sim, dt, { judge: false });
            take(worldSim.drain(sim));
        });
        const self = () => sim.fighters.findIndex(f => f.id === GUEST);
        const bodies = () => [...sim.fighters, ...sim.monsters];
        // What drawing blends from (ui/app.js): each fighter and monster before the last step.
        function remember() {
            before = new Map(bodies().map(b => [b.id, {
                x: b.x, y: b.y, h: b.h, facing: b.facing, gait: b.gait, moveBlend: b.moveBlend, runBlend: b.runBlend, guardBlend: b.guardBlend, shoveOut: b.shoveOut, shoveFor: b.shoveFor,
                act: b.act ? { move: b.act.move, phase: b.act.phase, t: b.act.t } : null
            }]));
        }
        function drawn(b) {
            const was = before.get(b.id), a = loop.alpha();
            return was ? { x: was.x + (b.x - was.x) * a, y: was.y + (b.y - was.y) * a, facing: space.lerpAngle(was.facing, b.facing, a) } : { x: b.x, y: b.y, facing: b.facing };
        }
        const lead = () => Math.min(P().replaySeconds, 2 * latency + STEP / 2);
        function post(message) {
            lastSent = now();
            if (message.t === 'input' || message.t === 'beat') { message = { ...message, stamp: ++stamp }; stamps.set(stamp, lastSent); }
            send(message);
        }
        // This phone's own predicted events show at once; the host's copies
        // of these are skipped, everything else comes from the host.
        function take(events) { for (const e of events) if (e.side === GUEST && PREDICTED.has(e.type)) outbox.push(e); }
        function end(reason, tell = null) {
            if (phase === 'ended') return;
            if (tell) post({ t: tell });
            phase = 'ended'; endReason = reason;
            on.end?.(reason);
        }
        function enter(msg) {
            if (!count(msg.visit) || msg.visit <= visit) return;
            let next;
            try { next = mirror(msg); } catch (_) { end('incompatible', 'leave'); return; }
            visit = msg.visit; sim = next; phase = 'playing';
            applied = -1; synced = false; offsets = new Map();
            loop.reset(); remember();
            on.start?.(sim);
        }
        function applySnapshot(msg) {
            if (msg.visit !== visit || !Number.isSafeInteger(msg.serial) || msg.serial <= applied || !count(msg.ack) || msg.ack > inputSeq ||
                !count(msg.stamp) || msg.stamp > stamp || !num(msg.wait) || msg.wait < 0 || !Array.isArray(msg.events) ||
                (msg.ground !== undefined && !validGround(msg.ground)) || !validState(sim, msg.state)) return;
            applied = msg.serial;
            const at = now();
            if (stamps.has(msg.stamp)) {
                // There and back, less the time the host kept it before
                // this snapshot left; the first few samples count in full.
                const sample = Math.min(P().latencySeconds, Math.max(0, (at - stamps.get(msg.stamp) - msg.wait) / 2));
                latency += (sample - latency) * Math.max(0.1, 1 / ++timed);
                for (const n of stamps.keys()) { if (n > msg.stamp) break; stamps.delete(n); }
            }
            pending = pending.filter(p => p.seq > msg.ack);
            // Where this phone's time and its bodies stood at the last frame.
            const was = new Map(bodies().map(b => [b.id, drawn(b)])), stood = sim.time + loop.carry;
            if (msg.ground) setGround(sim.terrain, msg.ground);
            restore(sim, msg.state);
            remember();
            let left = 0;
            if (!hostAway) {
                // Play on from the snapshot to this phone's own time,
                // replaying its controls the host has not had yet at the
                // steps they were given; that time is steered towards the
                // snapshot's plus the lead (core/duel.js).
                const want = msg.state.time + lead() - (at - frameAt), off = want - stood;
                const to = synced && Math.abs(off) <= P().resyncSeconds ? stood + off * P().steer : want;
                synced = true;
                const span = Math.min(P().replaySeconds, Math.max(0, to - sim.time)), n = Math.floor(span / STEP + 1e-6), me = self();
                let k = 0;
                for (let i = 0; i < n; i++) {
                    while (k < pending.length && pending[k].time <= sim.time + 1e-9) worldSim.command(sim, pending[k++].cmd, me);
                    if (i === n - 1) remember();
                    worldSim.step(sim, STEP, { judge: false });
                }
                while (k < pending.length) worldSim.command(sim, pending[k++].cmd, me);
                left = span - n * STEP;
            } else synced = false;
            worldSim.drain(sim);
            loop.reset(left);
            // Draw from where things were drawn, easing the jump out.
            const next = new Map();
            for (const b of bodies()) {
                const w = was.get(b.id);
                if (!w) continue;
                const o = offsets.get(b.id) || { x: 0, y: 0, facing: 0 }, d = drawn(b);
                o.x += w.x - d.x; o.y += w.y - d.y; o.facing = space.wrapAngle(o.facing + w.facing - d.facing);
                next.set(b.id, Math.hypot(o.x, o.y) > 90 ? { x: 0, y: 0, facing: 0 } : o);
            }
            offsets = next;
            for (const e of msg.events) {
                if (!obj(e) || !count(e.id) || e.id <= seenEvent) continue;
                seenEvent = e.id;
                if (!(e.side === GUEST && PREDICTED.has(e.type))) outbox.push(e);
            }
        }
        function receive(msg) {
            if (phase === 'ended' || !obj(msg) || typeof msg.t !== 'string') return;
            lastHeard = now();
            if (msg.t === 'hello') {
                if (msg.protocol !== PROTOCOL || msg.rules !== rules()) end('incompatible', 'leave');
                else peerOk = true;
                return;
            }
            if (!peerOk) return;
            if (msg.t === 'leave') end('left');
            else if (msg.t === 'away' || msg.t === 'back') { hostAway = msg.t === 'away'; awaySince = lastHeard; synced = false; }
            else if (msg.t === 'world') enter(msg);
            else if (msg.t === 'snap' && sim) applySnapshot(msg);
        }
        // This phone's own controls: played at once, and sent.
        function command(cmd) {
            if (phase !== 'playing') return false;
            if (!worldSim.command(sim, cmd, self())) return false;
            take(worldSim.drain(sim));
            if (pending.length >= 256) { end('lost', 'leave'); return false; }
            pending.push({ seq: ++inputSeq, cmd, time: sim.time });
            post({ t: 'input', seq: inputSeq, cmd, ack: seenEvent });
            return true;
        }
        function frame(seconds) {
            if (phase === 'ended') return outbox.splice(0);
            const t = now();
            if (t - frameAt > STALL) lastHeard = Math.max(lastHeard, t - STALL);
            frameAt = t;
            // A host that said it is away is waited for, pvp.awaySeconds at most.
            if (hostAway ? t - awaySince > P().awaySeconds : !selfAway && t - lastHeard > P().timeoutSeconds) {
                end(hostAway ? 'away' : 'timeout', 'leave');
                return outbox.splice(0);
            }
            if (sim && !hostAway) loop.advance(seconds);
            const ease = Math.exp(-seconds * 18);
            for (const o of offsets.values()) { o.x *= ease; o.y *= ease; o.facing *= ease; }
            if (t - lastSent >= P().heartbeatSeconds) post({ t: 'beat', ack: seenEvent });
            return outbox.splice(0);
        }
        return {
            role: 'guest', selfId: GUEST,
            get phase() { return phase; }, get sim() { return sim; }, get endReason() { return endReason; },
            // What this phone carries now, as the host's world last said.
            get bag() { return sim?.bags[GUEST] || null; },
            // Who the world waits for: the host in the background, or nobody.
            get waiting() { return hostAway ? 'peer' : null; },
            // The channel is open: introduce this phone and what it brings.
            open() { lastHeard = now(); post({ t: 'hello', protocol: PROTOCOL, rules: rules(), bag }); },
            receive, command, frame,
            // A trade at the base's shop or smithy (core/inventory.js
            // buy | sell | craft), already made on this phone's copy of the
            // bag: the host makes it on the bag itself.
            trade(op, id, n = 1) {
                if (phase !== 'playing' || !Object.hasOwn(TRADES, op)) return false;
                post({ t: 'trade', op, id, n: n === Infinity ? 'all' : n });
                return true;
            },
            // Drawing helpers: interpolation between the last two live
            // steps and the eased snapshot corrections.
            alpha: () => loop.alpha(),
            before: id => before.get(id) || null,
            offset: id => offsets.get(id) || { x: 0, y: 0, facing: 0 },
            // This phone's page went to the background, or is back.
            away(flag) {
                if (phase === 'ended' || selfAway === !!flag) return;
                selfAway = !!flag;
                if (!selfAway) { lastHeard = now(); synced = false; }
                post({ t: selfAway ? 'away' : 'back' });
            },
            pulse() { if (phase !== 'ended' && now() - lastSent >= P().heartbeatSeconds) post({ t: 'beat', ack: seenEvent }); },
            // Leaving the host's world for good.
            leave() { end('closed', 'leave'); },
            // The channel itself is gone.
            lost() { end('lost'); }
        };
    }
    return { PROTOCOL, GUEST, rules, stateOf, mirror, host, guest };
})();
