// Heads-up display over the 3D view: this fighter's HP and guard bar, the
// foe being fought (its HP, stagger, enrage, a boss tag), small HP bars and
// a "!" over monsters in a fight, the region and the gold carried, the
// clock (the hour of the day), the running combo with the move's name,
// and floating damage numbers. The
// world (design.md 6): the interact key names what it would do (dim
// with nothing in reach, greyed when it cannot now), a tag over the target
// says what it is and why not, and a ring over it fills while a hold runs; the
// region's name as it is entered, a banner when a boss falls, and what is
// picked up. In a duel: the rival's HP in the foe panel and over its head,
// the countdown, and an arrow at the edge of the screen while the rival is
// in sight but off it. In a shared adventure (design.md 10): the room's
// code (the host's, for the other phone to type), the partner's HP over
// its head and the arrow to it, and a line while this one is down and the
// partner is not, or while the world waits for the host. What is carried
// (gold, potions) is this fighter's own (its bag, else the progress: as
// core/props.js bagOf). Reads the simulation; never writes it.
const hud = (() => {
    const FIGHTING = monsterKit.FIGHTING;
    // What a world with nothing carried shows (a duel).
    const EMPTY = Object.freeze({ inventory: Object.freeze({ gold: 0, items: Object.freeze({}) }) });
    // The clock (design.md 3.6; user, 2026-10-06): a dial with noon at the
    // top that its hand goes round once a day. Its rim is the day's light
    // by the hour, in `segments` arcs: each the colour of the look that
    // hour has (core/daytime.js `look`, day.looks), going over from one to
    // the next as the light does. The badge is the sun or the moon.
    const CLOCK = { segments: 48, radius: 34, colors: { day: [96, 196, 78], dawn: [240, 140, 44], night: [62, 96, 200] } };
    // Degrees round the dial, clockwise from the top, of an hour.
    const dialAngle = hour => (hour - 12) * 15;
    function clockRing() {
        const point = deg => { const a = deg * Math.PI / 180; return `${(CLOCK.radius * Math.sin(a)).toFixed(2)} ${(-CLOCK.radius * Math.cos(a)).toFixed(2)}`; };
        let out = '';
        for (let k = 0; k < CLOCK.segments; k++) {
            const from = k * 24 / CLOCK.segments, to = (k + 1) * 24 / CLOCK.segments, l = dayKit.look((from + to) / 2);
            const a = CLOCK.colors[l.from], b = CLOCK.colors[l.to], rgb = a.map((v, i) => Math.round(v + (b[i] - v) * l.mix));
            // Each arc runs a little under the next: no seam between them.
            out += `<path d="M${point(dialAngle(from))}A${CLOCK.radius} ${CLOCK.radius} 0 0 1 ${point(dialAngle(to) + 0.8)}" stroke="rgb(${rgb.join(',')})"/>`;
        }
        return out;
    }
    function attach(root) {
        const $ = sel => root.querySelector(sel);
        const els = {
            hp: $('[data-hud="hp"]'), guard: $('[data-hud="guard"]'), guardBar: $('[data-hud="guard-bar"]'), goal: $('[data-hud="goal"]'),
            target: $('[data-hud="target"]'), targetName: $('[data-hud="target-name"]'), rage: $('[data-hud="rage"]'),
            targetHp: $('[data-hud="target-hp"]'), pipBox: $('[data-hud="pips"]'),
            combo: $('[data-hud="combo"]'), chips: $('[data-hud="chips"]'), move: $('[data-hud="move"]'),
            floats: $('[data-hud="floats"]'), mobs: $('[data-hud="mobs"]'), banner: $('[data-hud="banner"]'), arrow: $('[data-hud="arrow"]'),
            boss: $('[data-hud="boss"]'), key: $('[data-button="interact"]'), keyText: $('[data-hud="interact"]'),
            tag: $('[data-hud="tag"]'), hold: $('[data-hud="hold"]'), tagName: $('[data-hud="tag-name"]'), tagWhy: $('[data-hud="tag-why"]'), toasts: $('[data-hud="toasts"]'),
            room: $('[data-hud="room"]'), region: $('[data-hud="region"]'), regionTitle: $('[data-hud="region-title"]'), regionNote: $('[data-hud="region-note"]'),
            guardKey: $('[data-button="guard"]'), offhand: $('[data-button="offhand"]'), offhandCount: $('[data-hud="offhand-count"]'),
            clock: $('[data-hud="clock"]'), clockRing: $('[data-hud="clock-ring"]'), clockHand: $('[data-hud="clock-hand"]')
        };
        els.clockRing.innerHTML = clockRing();
        let shownTurn = NaN, shownTime = '';
        let toasts = [], notice = null;
        let comboKey = '', comboShownAt = -1, floats = [], focus = null, mobs = new Map(), fightAt = null, selfId = 'player';
        const width = (el, share) => { el.style.width = `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`; };
        const LABEL = { a: 'A', b: 'B', '-': '·' };
        const nameOf = body => body.kind === 'fighter' ? '对手' : body.kind === 'dummy' ? gameConfig.dummy.name : gameConfig.monsters[body.kind].name;
        const topOf = body => body.kind === 'fighter' ? 2.15 : body.kind === 'dummy' ? 1.95 : monsterKit.height(body.kind) + 0.25;
        // Where a target's tag floats, in blocks above its spot.
        const TAG = { building: 2.7, portal: 3.6, chest: 1.2, grave: 1.6 };
        // Where the ring of a hold under way sits, in blocks above the
        // target's spot: about the top of it.
        const HOLD = { chest: 0.75, grave: 1.1, ore: 1.05, crystal: 1.1, herb: 0.45 };
        // A line in the middle of the screen for `seconds`: the region
        // entered, a boss down.
        function announce(title, note, seconds, now) {
            notice = { until: now + seconds };
            els.regionTitle.textContent = title; els.regionNote.textContent = note;
            els.region.hidden = false; els.region.classList.remove('fade');
        }
        // A new world: forget the last one's foes; name the region entered
        // (unless `announce` is false: the same place rebuilt).
        function reset(sim = null, now = 0, { announce: named = true } = {}) {
            focus = null; comboKey = ''; fightAt = null;
            for (const m of mobs.values()) m.el.remove();
            mobs = new Map();
            for (const f of floats) f.el.remove();
            floats = [];
            for (const t of toasts) t.el.remove();
            toasts = [];
            els.banner.hidden = true; els.arrow.hidden = true; els.tag.hidden = true;
            els.region.hidden = true; notice = null;
            if (sim && !sim.duel && named) {
                const map = gameConfig.maps[sim.region], boss = sim.monsters.find(m => m.boss);
                const bossHere = sim.terrain.monsters.some(m => gameConfig.monsters[m.kind].boss);
                const note = map?.safe ? '安全区' : map?.training ? '训练场里不会倒下' : map?.dark ? '很暗，带上点燃的火把' : boss ? `首领：${gameConfig.monsters[boss.kind].name}` : bossHere ? '首领已被击败' : '';
                announce(map?.name || sim.map, note, 2.2, now);
            }
        }
        // The regions a boss opens, by name.
        function opens(kind) {
            const names = new Set();
            for (const map of Object.values(gameConfig.maps)) for (const p of map.portals || []) if (p.requires === kind) names.add(gameConfig.maps[p.to].name);
            return [...names];
        }
        // The foe the top-right panel shows: the rival in a duel; else the
        // monster last traded blows with, while it stands; else the nearest
        // one in a fight; else the training dummy, if the map has one (the
        // training ground's, or the test cave's among its monsters: one
        // that comes for the player goes before it).
        function target(sim, p) {
            if (sim.duel) return sim.fighters.find(f => f !== p) || null;
            const live = sim.monsters.filter(m => m.phase !== 'dead' || m.t < 1);
            const held = live.find(m => m.id === focus);
            if (held) return held;
            let best = null, far = 400;
            for (const m of live) {
                const d = Math.hypot(m.x - p.x, m.y - p.y);
                if (FIGHTING.has(m.phase) && d < far) { far = d; best = m; }
            }
            return best || sim.dummy;
        }
        function place(el, view, at) {
            const xy = view?.project(at);
            if (xy) el.style.transform = `translate(${xy.x.toFixed(1)}px, ${xy.y.toFixed(1)}px) translate(-50%, -100%)`;
            return !!xy;
        }
        const over = (body, shown) => (([x, y, z]) => [x, y + topOf(body), z])(space.toBlocks(shown.x, shown.y, shown.h));
        function mobOf(id) {
            let mob = mobs.get(id);
            if (!mob) {
                const el = document.createElement('div');
                el.className = 'mob'; el.hidden = true;
                el.innerHTML = '<span class="mob-alert" hidden>!</span><div class="mob-bar"><i></i></div>';
                els.mobs.appendChild(el);
                mob = { el, alert: el.firstChild, fill: el.querySelector('i') };
                mobs.set(id, mob);
            }
            return mob;
        }
        // The rival off screen but in sight: an arrow on the screen's edge
        // pointing at it.
        function pointAt(view, at) {
            const r = root.getBoundingClientRect(), xy = view?.project(at), margin = 34;
            if (xy && xy.x >= 0 && xy.x <= r.width && xy.y >= 0 && xy.y <= r.height) { els.arrow.hidden = true; return; }
            const cx = r.width / 2, cy = r.height / 2;
            let dx, dy;
            if (xy) { dx = xy.x - cx; dy = xy.y - cy; } else { dx = 0; dy = 1; }
            const k = Math.min((cx - margin) / Math.max(1e-6, Math.abs(dx)), (cy - margin) / Math.max(1e-6, Math.abs(dy)));
            els.arrow.hidden = false;
            els.arrow.style.transform = `translate(${(cx + dx * k).toFixed(1)}px, ${(cy + dy * k).toFixed(1)}px) translate(-50%, -50%) rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
        }
        // The interact key and the tag over its target.
        function interaction(sim, p, view) {
            const t = sim.duel || p.down ? null : interactKit.target(sim, p);
            els.key.classList.toggle('idle', !t);
            els.key.classList.toggle('blocked', !!t && !t.offer.ready);
            els.keyText.textContent = t ? t.offer.verb : '交互';
            els.key.setAttribute('aria-label', t ? `${t.offer.verb} ${t.offer.name}` : '交互');
            els.tag.hidden = !t;
            els.hold.hidden = true;
            if (!t) return;
            els.tagName.textContent = t.offer.name;
            els.tagWhy.textContent = t.offer.ready ? '' : t.offer.why;
            const e = t.entity, at = space.toBlocks(e.x, e.y, e.h);
            const ring = [at[0], at[1] + (HOLD[e.type === 'node' ? e.kind : e.type] ?? 0.8), at[2]];
            at[1] += TAG[e.type] ?? 1.5;
            els.tag.hidden = !place(els.tag, view, at);
            if (t.progress > 0) {
                const xy = view?.project(ring);
                els.hold.hidden = !xy;
                if (xy) {
                    els.hold.style.transform = `translate(${xy.x.toFixed(1)}px, ${xy.y.toFixed(1)}px) translate(-50%, -50%)`;
                    els.hold.style.setProperty('--hold', t.progress.toFixed(3));
                }
            }
        }
        // duel (optional): { countdown, phase, waiting } from the duel
        // session. coop (optional): { role: 'host' | 'guest', code, partner
        // (someone else is in the world), waiting ('peer': the host is in
        // the background), entering (the host's world not here yet) }.
        function update(sim, view, now, bodies = null, { self = 'player', duel = null, coop = null } = {}) {
            selfId = self;
            const p = sim.fighters.find(f => f.id === self) || sim.fighters[0], G = gameConfig.combat.guardBar;
            const shownOf = body => bodies?.get(body.id) || body;
            width(els.hp, p.hp / p.maxHp);
            width(els.guard, p.guard.bar / G.max);
            els.guardBar.classList.toggle('locked', p.guard.locked);
            // The guard key shows what it guards with: the shield, or the blade.
            els.guardKey.dataset.kind = combatKit.guardOf(p);
            // The offhand key shows the torch or the potion (and how many are
            // left, greyed with none); with a shield or nothing it is grey.
            const kind = inventoryKit.offhandOf(p.loadout), item = kind === 'torch' || kind === 'potion' ? kind : 'none';
            const bag = sim.bags?.[p.id] || sim.progress || EMPTY, potions = item === 'potion' ? inventoryKit.count(bag, 'potion') : 0;
            els.offhand.dataset.kind = item;
            els.offhand.classList.toggle('lit', !!p.lit);
            els.offhand.classList.toggle('disabled', item === 'none' || (item === 'potion' && potions < 1));
            els.offhandCount.hidden = item !== 'potion';
            els.offhandCount.textContent = String(potions);
            // The region and what is carried.
            const map = gameConfig.maps[sim.region];
            els.goal.hidden = !!sim.duel || !map;
            if (!els.goal.hidden) els.goal.textContent = map.training ? map.name : `${map.name} · ${gameConfig.items.gold.icon} ${bag.inventory.gold}`;
            els.room.hidden = !coop;
            if (coop) els.room.textContent = coop.role === 'host' ? `房间 ${coop.code} · ${coop.partner ? '同伴在这里' : '等人加入'}` : `联机 · 房间 ${coop.code}`;
            // The clock: the hour the world is drawn at, to a quarter of a
            // degree; the sun or the moon, whichever is up.
            const hour = view?.hour ? view.hour(sim) : dayKit.hourOf(sim), turn = Math.round(dialAngle(hour) * 4) / 4;
            if (turn !== shownTurn) {
                shownTurn = turn;
                els.clockHand.setAttribute('transform', `rotate(${turn})`);
                els.clock.dataset.body = dayKit.sky(hour).body;
                // Read out to ten minutes.
                const time = `${String(Math.floor(hour)).padStart(2, '0')}:${Math.floor(hour % 1 * 6)}0`;
                if (time !== shownTime) { shownTime = time; els.clock.setAttribute('aria-label', `时刻 ${time}`); }
            }
            interaction(sim, p, view);
            if (notice) {
                els.region.classList.toggle('fade', now > notice.until - 0.5);
                if (now > notice.until) { els.region.hidden = true; notice = null; }
            }
            toasts = toasts.filter(t => {
                if (now - t.born < 2.4) { t.el.classList.toggle('fade', now - t.born > 1.9); return true; }
                t.el.remove(); return false;
            });
            const d = target(sim, p);
            els.target.hidden = !d;
            if (d) {
                els.targetName.textContent = nameOf(d);
                els.boss.hidden = !d.boss;
                els.rage.hidden = !d.enraged;
                width(els.targetHp, d.hp / d.maxHp);
                // One pip per stagger point the target takes to reel.
                els.pipBox.hidden = d.kind === 'fighter';
                const most = d.type === 'monster' ? monsterKit.threshold(d.kind) : gameConfig.combat.stagger.threshold;
                if (els.pipBox.children.length !== most) {
                    els.pipBox.innerHTML = '<i></i>'.repeat(most);
                    els.pipBox.classList.toggle('many', most > 5);
                }
                const points = d.phase === 'reel' ? most : d.stagger;
                [...els.pipBox.children].forEach((pip, i) => pip.classList.toggle('on', i < Math.floor(points + 1e-9)));
                els.target.classList.toggle('reeling', d.phase === 'reel');
            }
            // Over each monster in a fight or hurt: a small bar; "!" as it notices.
            for (const m of sim.monsters) {
                const mob = mobOf(m.id), shown = shownOf(m);
                const visible = m.phase !== 'dead' && (FIGHTING.has(m.phase) || m.hp < m.maxHp) && (view?.seen(m.id) ?? true);
                mob.el.hidden = !visible || !place(mob.el, view, over(m, shown));
                if (mob.el.hidden) continue;
                mob.alert.hidden = m.phase !== 'alert';
                mob.el.classList.toggle('enraged', m.enraged);
                mob.el.classList.toggle('boss', m.boss);
                width(mob.fill, m.hp / m.maxHp);
            }
            // Bars of bodies no longer in this world go.
            for (const [id, mob] of mobs) if (!sim.monsters.some(m => m.id === id) && !sim.fighters.some(f => f.id === id)) { mob.el.remove(); mobs.delete(id); }
            // Over the rival, while it is in sight; an arrow when off screen.
            els.arrow.hidden = true;
            for (const f of sim.fighters) {
                if (f === p) continue;
                const mob = mobOf(f.id), seen = !f.down && (view?.seen(f.id) ?? true), at = over(f, shownOf(f));
                mob.el.hidden = !seen || !place(mob.el, view, at);
                if (!mob.el.hidden) width(mob.fill, f.hp / f.maxHp);
                if (seen) pointAt(view, at);
            }
            // The countdown, then "开始" for a moment; while the fight is
            // held for a phone in the background, who it waits for.
            // In a shared adventure: who it waits for, or this one down while the partner is not.
            const waits = coop?.entering ? '正在进入房主的世界…' : coop?.waiting === 'peer' && coop.role === 'guest' ? '房主暂时离开，等待中…'
                : coop && p.down && !sim.result ? '倒下了，等同伴' : '';
            els.banner.classList.toggle('note', duel?.phase === 'hold' || !!waits);
            if (waits) { els.banner.hidden = false; els.banner.textContent = waits; }
            else if (duel && duel.phase === 'hold') {
                els.banner.hidden = false; els.banner.textContent = duel.waiting === 'peer' ? '对方暂时离开，等待中…' : '对局暂停'; fightAt = null;
            } else if (duel && duel.countdown > 0 && (duel.phase === 'countdown' || duel.phase === 'starting')) {
                els.banner.hidden = false; els.banner.textContent = String(Math.ceil(duel.countdown - 1e-6)); fightAt = null;
            } else if (duel && duel.phase === 'fight') {
                if (fightAt === null) fightAt = now;
                els.banner.hidden = now - fightAt > 0.8;
                els.banner.textContent = '开始';
            } else els.banner.hidden = true;
            // The combo: chips for its inputs, the move's name; fades once it ends.
            const key = p.combo.join(' ') + '|' + (p.act?.move || '');
            if (p.combo.length && key !== comboKey) {
                comboKey = key; comboShownAt = now;
                els.chips.innerHTML = '';
                p.combo.forEach((input, i) => {
                    const chip = document.createElement('span');
                    chip.className = 'chip' + (input === '-' ? ' pause' : '') + (i === p.combo.length - 1 ? ' on' : '');
                    chip.textContent = LABEL[input];
                    els.chips.appendChild(chip);
                });
                els.move.textContent = p.act ? gameConfig.combo.moves[p.act.move].name : '';
            }
            const live = p.act || p.chain;
            els.combo.classList.toggle('show', !!p.combo.length && (live || now - comboShownAt < 0.6));
            if (!p.combo.length) comboKey = '';
            // Damage numbers rise and fade over their target.
            floats = floats.filter(f => {
                const age = now - f.born;
                if (age > 0.8) { f.el.remove(); return false; }
                const at = view?.project([f.at[0], f.at[1] + age * 0.9, f.at[2]]);
                if (at) f.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
                f.el.style.opacity = String(Math.min(1, (0.8 - age) / 0.3));
                return true;
            });
        }
        // Something picked up: one toast per item, counting up while fresh.
        function picked(e, now) {
            const item = gameConfig.items[e.item];
            if (!item) return;
            let t = toasts.find(x => x.item === e.item && now - x.born < 1.2);
            if (!t) {
                const el = document.createElement('div');
                el.className = 'toast';
                els.toasts.appendChild(el);
                t = { item: e.item, amount: 0, el, born: now };
                toasts.push(t);
                if (toasts.length > 4) toasts.shift().el.remove();
            }
            t.amount += e.amount; t.born = now;
            t.el.textContent = `${item.icon} ${item.name} +${t.amount}`;
        }
        function events(list, now) {
            for (const e of list) {
                if (e.type === 'pickup' && e.side === selfId) picked(e, now);
                if (e.type === 'boss_defeated') {
                    const names = opens(e.kind);
                    announce(`击败首领 · ${e.name}`, names.length ? `${names.join('、')}的大门已开启` : '这一带平定了', 3.5, now);
                }
                if (e.type === 'revive') announce(`${e.name}复活了`, '再打倒它，还会掉它的素材', 2.5, now);
                if (e.type === 'rest' && e.side === selfId) announce('生命回满了', '', 1.6, now);
                // Whoever this fighter last traded blows with stays in the panel.
                if (e.type === 'hit' || e.type === 'parry' || e.type === 'block') {
                    const other = e.target === selfId || e.type === 'block' ? e.source : e.target;
                    if (other) focus = other;
                }
                if (!['hit', 'block', 'parry'].includes(e.type) || !e.at) continue;
                const el = document.createElement('div');
                const toSelf = e.type === 'hit' && e.target === selfId;
                el.className = 'float' + (toSelf ? ' hurt' : '') + (e.type === 'parry' ? ' parry' : '') + (e.type === 'block' ? ' block' : '') + (e.heavy ? ' heavy' : '');
                el.textContent = e.type === 'parry' ? `弹反 ${e.damage}` : e.type === 'block' ? `格挡 ${e.damage}` : String(e.damage);
                els.floats.appendChild(el);
                floats.push({ el, at: e.at, born: now });
            }
        }
        // A line in the middle of the screen for a moment (a partner coming
        // or going): `announce`.
        return { update, events, reset, notice: announce };
    }
    return { attach };
})();
