// The move tuner's page (tune.html, a desktop tool; the game is index.html).
// Pick a weapon and a move, a combo or another pose; drag a bone's rx, ry,
// rz, or turn it about its own axes, and the body follows at once; play the timeline slowed down or scrub
// it; see the checks the tests make; copy what changed as source text to
// paste back into the files. Edits live in this page only, kept as a draft
// in localStorage, until they are written back (tune/lab.js does the
// work, tune/view.js the drawing).
const tuneApp = (() => {
    const STORE = { draft: 'blockKnight.tune.draft', prefs: 'blockKnight.tune.prefs' };
    const storage = () => { try { return window.localStorage; } catch (_) { return null; } };
    const readJSON = key => { try { return JSON.parse(storage()?.getItem(key) || 'null'); } catch (_) { return null; } };
    const writeJSON = (key, value) => { try { storage()?.setItem(key, JSON.stringify(value)); } catch (_) { /* nowhere to keep it */ } };

    const BONE_GROUPS = [
        ['躯干', [['base', '整个人'], ['pelvis', '骨盆'], ['chest', '胸'], ['head', '头']]],
        ['右臂（拿武器）', [['upperArmR', '大臂'], ['forearmR', '小臂'], ['handR', '手腕']]],
        ['左臂（拿盾）', [['upperArmL', '大臂'], ['forearmL', '小臂'], ['handL', '手腕']]],
        ['右腿', [['thighR', '大腿'], ['shinR', '小腿'], ['footR', '脚']]],
        ['左腿', [['thighL', '大腿'], ['shinL', '小腿'], ['footL', '脚']]]
    ];
    const BONE_NAMES = Object.fromEntries(BONE_GROUPS.flatMap(([group, bones]) => bones.map(([id, name]) => [id, `${group.replace(/（.*）/, '')}·${name}`])));
    const HINTS = {
        base: 'ry 整个人转向（正数转向左边）；rx 负数往后倒。py 上下没有效果：人总会自动落到地上',
        pelvis: 'ry 扭胯。出招时 py 是胯的高低（负数往下蹲，脚不动、膝盖弯）；其他姿势里 py 没有效果（人总会自动落到地上），要蹲低就弯腿：大腿 rx 负、小腿 rx 正',
        chest: 'rx 正数往前弯腰，负数后仰；ry 正数转向左边',
        head: 'rx 负数抬头后仰',
        upperArmR: 'rx 负数往前抬（-1.57 平举，-3.1 举过头顶）；ry 正数往身体左边摆；rz 负数往右侧张开',
        forearmR: 'rx 负数弯肘',
        handR: 'rx 正数往掌心弯；ry 绕小臂拧手腕；rz 绕剑身自转（只改刃口朝哪边）。剑快和小臂成一条线时（rx 接近 1.57）滑块少一个方向，用下面的"绕自身轴"',
        upperArmL: 'rx 负数往前抬；ry 正数往身体左边摆；rz 正数往左侧张开',
        forearmL: 'rx 负数弯肘',
        handL: 'rx 正数往掌心弯；ry 绕小臂拧手腕；rz 绕朝前的轴自转（火把、药瓶的长轴）',
        thighR: 'rx 负数往前抬腿，正数往后',
        shinR: 'rx 正数弯膝',
        thighL: 'rx 负数往前抬腿，正数往后',
        shinL: 'rx 正数弯膝',
        footR: '出招的腿由程序摆，这里写脚踩在哪：pz 往前（负数往后），px 往左（负数往右），py 离地多高；rx 正数脚尖朝下、负数脚尖翘起，ry 正数脚尖往左转。一个姿势不写这只脚，它就停在原地不动',
        footL: '出招的腿由程序摆，这里写脚踩在哪：pz 往前（负数往后），px 往左（负数往右），py 离地多高；rx 正数脚尖朝下、负数脚尖翘起，ry 正数脚尖往左转。一个姿势不写这只脚，它就停在原地不动'
    };
    const MOVED = new Set(['base', 'pelvis']), FEET = new Set(['footR', 'footL']), LEGS = new Set(['thighR', 'shinR', 'thighL', 'shinL']);
    const channelsOf = bone => FEET.has(bone) ? ['pz', 'px', 'py', 'rx', 'ry'] : MOVED.has(bone) ? ['rx', 'ry', 'rz', 'px', 'py', 'pz'] : ['rx', 'ry', 'rz'];
    const RANGES = { r: [-moveLab.ANGLE_LIMIT, moveLab.ANGLE_LIMIT, 0.01], p: [-0.6, 0.6, 0.01] };
    // A bone's own axes, in the view's colours.
    const OWN_AXES = [['x', '红'], ['y', '绿'], ['z', '蓝']];
    const TIMING_TEXT = {
        windup: ['前摇', '按下到开始挥（关键姿势 a）'],
        swing: ['挥动', '从 a 挥到 b，只有这段会打中'],
        recovery: ['后摇', '从 b 回到站姿'],
        derive: ['派生点', '后摇开始后多久能接下一招'],
        step: ['踏步', '挥动时往前走多远（世界单位，40 = 1 格；负数后撤）'],
        chargeStep: ['蓄满加步', '蓄满时多走的距离']
    };
    const PHASES = { windup: '前摇', charge: '蓄力', swing: '挥动', recover: '后摇' };
    const OFFHANDS = ['wooden_shield', '', 'torch', 'potion'];
    const fixed = (v, n = 2) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function start() {
        const root = document.getElementById('tune'), $ = sel => root.querySelector(sel), $$ = sel => [...root.querySelectorAll(sel)];
        const lab = moveLab, U = gameConfig.world.unitsPerBlock, moves = () => gameConfig.combo.moves;

        // ---- state: what is shown, kept between visits ----
        const saved = readJSON(STORE.prefs) || {};
        const types = lab.weaponTypes();
        const state = {
            type: types.includes(saved.type) ? saved.type : types[0],
            // An item id, or '' for an empty hand.
            offhand: OFFHANDS.includes(saved.offhand) ? saved.offhand : gameConfig.gear.starter.offhand || '',
            mode: ['single', 'combo', 'pose'].includes(saved.mode) ? saved.mode : 'single',
            move: moves()[saved.move] ? saved.move : null, key: saved.key === 'b' ? 'b' : 'a',
            pose: Object.hasOwn(lab.POSES, saved.pose) ? saved.pose : 'stance',
            route: Array.isArray(saved.route) ? saved.route : null, hold: Number.isFinite(saved.hold) ? saved.hold : gameConfig.combo.holdSeconds,
            target: saved.target !== false, distance: Number.isFinite(saved.distance) ? saved.distance : null,
            speed: [0.05, 0.1, 0.25, 0.5, 1].includes(saved.speed) ? saved.speed : 0.25, loop: saved.loop !== false,
            show: { ghosts: true, trails: true, boxes: false, ...saved.show }, follow: saved.follow !== false, view: saved.view || 'three',
            bone: null, open: new Set(saved.open || ['upperArmR', 'handR'])
        };
        const rootMove = type => gameConfig.combo.weapons[type].root.a;
        if (!state.move || moves()[state.move].weapon !== state.type) state.move = rootMove(state.type);
        if (!state.route || !lab.follow(state.type, state.route)) state.route = lab.routes(state.type)[0]?.inputs || ['a'];
        const savePrefs = () => writeJSON(STORE.prefs, { ...state, bone: undefined, open: [...state.open] });

        // The draft from the last visit, on top of the files as they are
        // now. What the files changed since it was made is the files' (the
        // notice says which); those entries are kept aside, and saved with
        // the draft, until a choice is made.
        const baseline = new Map();
        const loaded = lab.apply(readJSON(STORE.draft));
        let pending = loaded.stale.length ? loaded.leftover : null;

        // ---- the view ----
        let view = null;
        try {
            view = tuneView.create($('[data-canvas]'), { onPick: bone => { selectBone(bone, true); } });
        } catch (error) {
            console.error(error);
            const box = $('[data-fallback]');
            box.textContent = '这个浏览器没有开启 WebGL，3D 画面无法显示。'; box.hidden = false;
        }
        const viewBox = $('[data-view]');
        const fit = () => view?.resize(viewBox.clientWidth, viewBox.clientHeight);
        new ResizeObserver(fit).observe(viewBox);
        fit();
        view?.setView(state.view);
        view?.setFollow(state.follow);

        // ---- the preview under way ----
        let rec = null, time = 0, playing = true, trails = null, trailsDirty = true;
        const editing = () => state.mode === 'pose' ? state.pose : `${state.move}.${state.key}`;
        const keyTime = () => rec?.keys[editing()];
        const options = () => ({ offhand: state.offhand || null, distance: state.distance ?? lab.standardOf(state.type), target: state.target });
        function rebuild() {
            clearTimeout(rebuild.soon);
            try {
                if (state.mode === 'single') rec = lab.single(state.move, options());
                else if (state.mode === 'combo') rec = state.route.length ? lab.combo(state.type, state.route, { ...options(), hold: state.hold }) : lab.pose('stance', { type: state.type, offhand: state.offhand || null });
                else rec = lab.pose(state.pose, { type: state.type, offhand: state.offhand || null });
            } catch (error) {
                console.error(error);
                rec = lab.pose('stance', { type: state.type, offhand: state.offhand || null });
            }
            time = clamp(time, 0, rec.duration);
            trailsDirty = true;
            drawTimeline();
        }
        rebuild.later = (ms = 350) => { clearTimeout(rebuild.soon); rebuild.soon = setTimeout(rebuild, ms); };

        // ---- the judged body at a moment of the preview ----
        const dummyRig = dummyKit.rig();
        function bodyAt(t) {
            const s = rec.stateAt(t), rig = lab.rigOf(rec.loadout), body = { ...s.body, loadout: rec.loadout };
            return { s, rig, body, judged: playerAnim.pose(rig, body) };
        }
        const solveBody = (b, pose) => rigKit.solve(b.rig, pose, space.toBlocks(b.s.x, b.s.y, 0), space.yawOf(b.s.facing));
        function computeTrails() {
            const rig = lab.rigOf(rec.loadout), blade = rig.parts.findIndex(p => p.kind === 'weapon');
            if (blade < 0) return [];
            const half = rig.parts[blade].size[2] / 2, N = 24;
            return rec.occs.filter(o => o?.swing).map(o => {
                const samples = [];
                for (let k = 0; k <= N; k++) {
                    const b = bodyAt(o.swing[0] + (o.swing[1] - o.swing[0]) * k / N), m = solveBody(b, b.judged).parts[blade];
                    samples.push({ hilt: math3d.transformPoint(m, [0, 0, -half]), tip: math3d.transformPoint(m, [0, 0, half]) });
                }
                return { samples, current: state.mode !== 'pose' && o.move === state.move };
            });
        }
        // The slider under the pointer, or the one holding the keys: the
        // axis it turns its bone about is drawn (a gimbal's, tune/lab.js).
        const inUse = { hover: null, focus: null };
        function sliderAxis(b, solved, shown) {
            const used = inUse.hover || inUse.focus;
            if (!used) return null;
            const g = lab.gimbal(b.rig, solved, shown, used.bone, space.yawOf(b.s.facing)), axis = used.c[1];
            return { at: g.at, dir: g[axis], axis };
        }
        function draw() {
            if (!rec) return;
            const b = bodyAt(time), shown = playerAnim.present(b.judged, b.body, { time, lean: 0 }), solved = solveBody(b, shown);
            let ghosts = null;
            if (view && state.show.ghosts && state.mode !== 'pose') {
                ghosts = {};
                for (const k of ['a', 'b']) {
                    const at = rec.keys[`${state.move}.${k}`];
                    if (at != null) { const g = bodyAt(at); ghosts[k] = solveBody(g, g.judged); }
                }
            }
            if (state.show.trails && trailsDirty) { trails = computeTrails(); trailsDirty = false; }
            const d = b.s.dummy;
            view?.draw({
                player: { rig: b.rig, look: equipmentModels.lookOf(rec.loadout), solved },
                ghosts, trails: state.show.trails ? trails : null, boxes: state.show.boxes, bone: state.bone,
                axes: view && state.bone ? lab.frame(b.rig, solved, state.bone) : null, slider: view ? sliderAxis(b, solved, shown) : null,
                dummy: d ? { rig: dummyRig, solved: rigKit.solve(dummyRig, dummyKit.pose(d), space.toBlocks(d.x, d.y, 0), space.yawOf(d.facing)) } : null,
                focus: [...space.toBlocks(b.s.x, b.s.y, 0)].map((v, i) => i === 1 ? 0.95 : v),
                ring: state.mode === 'pose' ? null : lab.standardOf(rec.type) / U
            });
            drawReadout(b.s);
        }

        // ---- the timeline ----
        const track = $('[data-track]'), lanes = $('[data-lanes]'), playhead = $('[data-playhead]');
        const at = t => `${(rec.duration > 0 ? t / rec.duration : 0) * 100}%`;
        function drawTimeline() {
            const html = [], names = new Map();
            for (const s of rec.segments) {
                const current = state.mode !== 'pose' && s.move === state.move;
                html.push(`<div class="seg ph-${s.phase}${current ? ' current' : ''}" data-occ="${s.occ}" style="left:${at(s.start)};width:${at(s.end - s.start)}" title="${moves()[s.move].name} ${PHASES[s.phase]} ${fixed(s.end - s.start)} 秒"></div>`);
                if (!names.has(s.occ)) names.set(s.occ, s);
            }
            rec.occs.forEach((o, i) => {
                if (!o) return;
                const hit = rec.hits.some(h => h.occ === i);
                html.push(`<div class="occ${state.mode !== 'pose' && o.move === state.move ? ' current' : ''}" data-occ="${i}" style="left:${at(o.start)};width:${at(o.end - o.start)}">${moves()[o.move].name}${rec.kind === 'combo' ? (hit ? ' ✓' : ' ✗') : ''}</div>`);
            });
            for (const h of rec.hits) html.push(`<div class="hit" style="left:${at(h.time)}" title="命中"></div>`);
            for (const [name, t] of Object.entries(rec.keys)) {
                const [move, k] = name.split('.');
                const mine = state.mode === 'pose' ? name === state.pose : move === state.move;
                if (mine) html.push(`<button type="button" class="key${name === editing() ? ' on' : ''}" data-keyname="${name}" style="left:${at(t)}" title="关键姿势 ${k || name}">◆<span>${k || ''}</span></button>`);
            }
            lanes.innerHTML = html.join('');
        }
        let scrubbing = false;
        function seek(e) {
            const r = track.getBoundingClientRect();
            time = clamp((e.clientX - r.left) / r.width, 0, 1) * rec.duration;
        }
        track.addEventListener('pointerdown', e => {
            const key = e.target.closest('[data-keyname]');
            setPlaying(false);
            if (key) {
                const name = key.dataset.keyname;
                if (name.includes('.')) state.key = name.split('.')[1];
                time = rec.keys[name];
                refreshEditor(); drawTimeline();
                return;
            }
            const occ = e.target.closest('[data-occ]');
            if (occ && state.mode === 'combo') {
                const o = rec.occs[+occ.dataset.occ];
                if (o && o.move !== state.move) selectMove(o.move);
            }
            scrubbing = true; track.setPointerCapture(e.pointerId); seek(e);
        });
        track.addEventListener('pointermove', e => { if (scrubbing) seek(e); });
        track.addEventListener('pointerup', () => { scrubbing = false; });
        function drawReadout(s) {
            playhead.style.left = at(time);
            const a = s.body.act;
            let text = `${fixed(time)} / ${fixed(rec.duration)} 秒`;
            if (a) {
                const m = moves()[a.move], len = { windup: m.windup, swing: m.swing, recover: m.recovery }[a.phase];
                text += ` · ${m.name} ${PHASES[a.phase]}${len ? ` ${Math.round(clamp(a.t / len, 0, 1) * 100)}%` : ` ${fixed(a.t)} 秒`}`;
            }
            $('[data-readout]').textContent = text;
        }

        // ---- playing ----
        const playButton = $('[data-act="play"]');
        function setPlaying(on) {
            playing = on;
            playButton.textContent = on ? '⏸' : '▶';
        }
        function stepFrames(n) { setPlaying(false); time = clamp(Math.round(time / lab.STEP + n) * lab.STEP, 0, rec.duration); }
        $('[data-act="start"]').addEventListener('click', () => { time = 0; });
        $('[data-act="back"]').addEventListener('click', () => stepFrames(-1));
        $('[data-act="forward"]').addEventListener('click', () => stepFrames(1));
        playButton.addEventListener('click', () => {
            if (!playing && time >= rec.duration - 1e-9) time = 0;
            setPlaying(!playing);
        });
        const speedBox = $('[data-speed]'), loopBox = $('[data-loop]');
        speedBox.value = String(state.speed); loopBox.checked = state.loop;
        speedBox.addEventListener('change', () => { state.speed = +speedBox.value; savePrefs(); });
        loopBox.addEventListener('change', () => { state.loop = loopBox.checked; savePrefs(); });
        let last = performance.now();
        function frame(now) {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            if (playing && rec) {
                time += dt * state.speed;
                if (time > rec.duration) {
                    if (state.loop) time = 0;
                    else { time = rec.duration; setPlaying(false); }
                }
            }
            try { draw(); } catch (error) { console.error(error); }
            requestAnimationFrame(frame);
        }

        // ---- choosing what to look at ----
        function tabs(box, items, current, pick) {
            box.innerHTML = items.map(([id, text]) => `<button type="button" data-id="${id}" class="${id === current ? 'on' : ''}">${text}</button>`).join('');
            box.onclick = e => { const b = e.target.closest('[data-id]'); if (b) pick(b.dataset.id); };
        }
        function refreshChoices() {
            tabs($('[data-types]'), types.map(t => [t, gameConfig.combo.weapons[t].name]), state.type, setType);
            $$('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
            $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== state.mode; });
            $('[data-offhand]').value = state.offhand || '';
            $('[data-moves]').innerHTML = lab.movesOf(state.type).map(id => `<button type="button" data-move="${id}" class="${id === state.move ? 'on' : ''}">${moves()[id].name}<small>${id}</small>${lab.moveChanged(id) ? '<i title="改过">●</i>' : ''}</button>`).join('');
            $('[data-poses]').innerHTML = Object.entries(lab.POSES).map(([id, p]) => `<button type="button" data-pose="${id}" class="${id === state.pose ? 'on' : ''}">${p.name}<small>${id}</small>${lab.changed(id) ? '<i title="改过">●</i>' : ''}</button>`).join('');
            $('[data-routes]').innerHTML = lab.routes(state.type).map(r => `<button type="button" data-inputs="${r.inputs.join('')}" class="${r.inputs.join('') === state.route.join('') ? 'on' : ''}" title="${r.moves.map(id => moves()[id].name).join(' → ')}">${r.label}</button>`).join('');
            const route = lab.follow(state.type, state.route) || [];
            $('[data-route]').innerHTML = route.length
                ? route.map((id, i) => `<button type="button" data-route-move="${id}" class="${id === state.move ? 'on' : ''}"><b>${lab.INPUT_LABELS[state.route[i]]}</b>${moves()[id].name}${lab.moveChanged(id) ? '<i>●</i>' : ''}</button>`).join('<span class="arrow">→</span>')
                : '<span class="tune-note">用下面的按钮拼一段连招，或选上面现成的。</span>';
            const next = lab.nextInputs(state.type, state.route);
            $$('[data-input]').forEach(b => { if (['a', 'b', 'p'].includes(b.dataset.input)) b.disabled = !next.includes(b.dataset.input); });
            const hold = $('[data-hold]');
            $('[data-hold-row]').hidden = state.route[0] !== 'b' || !moves()[route[0]]?.charge;
            hold.value = String(state.hold);
            const C = gameConfig.combat.charge;
            $('[data-hold-text]').textContent = `按住 ${fixed(state.hold)} 秒${state.hold > C.threshold ? `（蓄力 ${Math.round(clamp((state.hold - C.threshold) / (C.full - C.threshold), 0, 1) * 100)}%）` : '（最小蓄力）'}`;
            $('[data-target-box]').hidden = state.mode === 'pose';
            $('[data-target]').checked = state.target;
            const distance = state.distance ?? lab.standardOf(state.type);
            $('[data-distance]').value = String(distance);
            $('[data-distance-text]').textContent = `${Math.round(distance)}（${fixed(distance / U)} 格；标准 ${lab.standardOf(state.type)}）`;
            $$('[data-show]').forEach(b => { b.checked = !!state.show[b.dataset.show]; });
            $('[data-follow]').checked = state.follow;
            $('[data-views]').innerHTML = Object.entries(tuneView.VIEWS).map(([id, v]) => `<button type="button" data-view-id="${id}" class="${id === state.view ? 'on' : ''}">${v.name}</button>`).join('');
        }
        function setType(type) {
            if (type === state.type) return;
            state.type = type;
            if (moves()[state.move]?.weapon !== type) state.move = rootMove(type);
            state.route = lab.routes(type)[0]?.inputs || ['a'];
            state.distance = null;
            changedChoice();
        }
        function selectMove(id) {
            state.move = id;
            const t = rec?.keys[`${id}.${state.key}`];
            if (t != null && state.mode === 'combo') { time = t; setPlaying(false); }
            refreshChoices(); refreshEditor(); drawTimeline(); trailsDirty = true; checks.now();
            savePrefs();
        }
        function changedChoice() {
            refreshChoices(); rebuild(); refreshEditor(); checks.now();
            if (state.mode !== 'combo') time = 0;
            savePrefs();
        }
        $('[data-modes]').addEventListener('click', e => {
            const b = e.target.closest('[data-mode]');
            if (!b || b.dataset.mode === state.mode) return;
            state.mode = b.dataset.mode;
            if (state.mode === 'combo') {
                const route = lab.follow(state.type, state.route) || [];
                if (!route.includes(state.move) && route.length) state.move = route[0];
            }
            time = 0; changedChoice();
        });
        $('[data-offhand]').addEventListener('change', e => { state.offhand = e.target.value; changedChoice(); });
        $('[data-moves]').addEventListener('click', e => {
            const b = e.target.closest('[data-move]');
            if (!b) return;
            state.move = b.dataset.move; time = 0; changedChoice();
        });
        $('[data-poses]').addEventListener('click', e => {
            const b = e.target.closest('[data-pose]');
            if (!b) return;
            state.pose = b.dataset.pose; time = 0; changedChoice();
        });
        $('[data-routes]').addEventListener('click', e => {
            const b = e.target.closest('[data-inputs]');
            if (!b) return;
            state.route = [...b.dataset.inputs];
            const route = lab.follow(state.type, state.route) || [];
            if (!route.includes(state.move)) state.move = route[0];
            time = 0; changedChoice();
        });
        $('[data-route]').addEventListener('click', e => { const b = e.target.closest('[data-route-move]'); if (b) selectMove(b.dataset.routeMove); });
        $$('[data-input]').forEach(b => b.addEventListener('click', () => {
            const i = b.dataset.input;
            if (i === 'pop') state.route = state.route.slice(0, -1);
            else if (i === 'clear') state.route = [];
            else state.route = [...state.route, i];
            const route = lab.follow(state.type, state.route) || [];
            if (route.length && !route.includes(state.move)) state.move = route.at(-1);
            time = 0; changedChoice();
        }));
        $('[data-hold]').addEventListener('input', e => { state.hold = +e.target.value; refreshChoices(); rebuild.later(150); savePrefs(); });
        $('[data-target]').addEventListener('change', e => { state.target = e.target.checked; changedChoice(); });
        $('[data-distance]').addEventListener('input', e => { state.distance = +e.target.value; refreshChoices(); rebuild.later(120); checks.later(); savePrefs(); });
        $('[data-standard]').addEventListener('click', () => { state.distance = null; changedChoice(); });
        $$('[data-show]').forEach(b => b.addEventListener('change', () => { state.show[b.dataset.show] = b.checked; trailsDirty = true; savePrefs(); }));
        $('[data-follow]').addEventListener('change', e => { state.follow = e.target.checked; view?.setFollow(state.follow); savePrefs(); });
        $('[data-views]').addEventListener('click', e => {
            const b = e.target.closest('[data-view-id]');
            if (!b) return;
            state.view = b.dataset.viewId; view?.setView(state.view); refreshChoices(); savePrefs();
        });
        $('[data-keys]').addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) selectKey(b.dataset.key); });
        function selectKey(k) {
            if (state.mode === 'pose') return;
            state.key = k;
            const t = keyTime();
            if (t != null) { time = t; setPlaying(false); }
            refreshEditor(); drawTimeline(); savePrefs();
        }

        // ---- editing a pose: a row per bone, sliders for its channels ----
        const bonesBox = $('[data-bones]');
        bonesBox.innerHTML = BONE_GROUPS.map(([group, bones]) => `<h3>${group}</h3>` + bones.map(([id, name]) => `
            <div class="bone" data-bone="${id}">
                <button type="button" class="bone-head"><span class="bone-name">${name}</span><code>${id}</code><span class="bone-sum" data-sum></span></button>
                <div class="bone-body" hidden>
                    <p class="bone-hint">${HINTS[id]}</p>
                    ${channelsOf(id).map(c => { const [lo, hi, step] = RANGES[c[0]]; return `
                    <div class="ch" data-ch="${c}">
                        <span class="ch-name ch-${c}">${c}</span>
                        <input type="range" min="${lo}" max="${hi}" step="${step}" data-slider>
                        <input type="number" step="0.01" data-number>
                        <button type="button" data-zero title="归零">0</button>
                        <button type="button" class="ch-was" data-was hidden></button>
                    </div>`; }).join('')}
                    <div class="turn"${FEET.has(id) ? ' hidden' : ''}>
                        <span class="turn-label">绕自身轴</span>
                        ${OWN_AXES.map(([a, colour]) => `<button type="button" class="ch-r${a}" data-turn="${a}" title="按住左右拖：绕这根骨头自己的 ${a} 轴（画面上的${colour}线）转，三个数会一起变；Shift 更细">${a.toUpperCase()} ⟲</button>`).join('')}
                        <span class="turn-note">按住左右拖</span>
                    </div>
                </div>
            </div>`).join('')).join('');
        const boneRows = Object.fromEntries($$('.bone').map(el => [el.dataset.bone, el]));
        function refreshEditor() {
            const target = editing(), pose = lab.poseOf(target), was = lab.original(target);
            const name = state.mode === 'pose' ? `${lab.POSES[state.pose].name} <code>${state.pose}</code>` : `${moves()[state.move].name} <code>${state.move}</code>`;
            $('[data-editing]').innerHTML = `正在改：${name}${lab.changed(target) ? ' <i title="改过">●</i>' : ''}`;
            $('[data-keys]').hidden = state.mode === 'pose';
            $$('[data-key]').forEach(b => b.classList.toggle('on', b.dataset.key === state.key));
            for (const [bone, row] of Object.entries(boneRows)) {
                const p = pose[bone] || {}, w = was[bone] || {};
                row.classList.toggle('picked', bone === state.bone);
                row.classList.toggle('set', Object.values(p).some(v => v));
                // A move's legs are its feet (the program bends them); the
                // other poses' are the thighs and shins.
                row.hidden = state.mode === 'pose' ? FEET.has(bone) : LEGS.has(bone);
                row.querySelector('.bone-body').hidden = !state.open.has(bone);
                row.classList.toggle('open', state.open.has(bone));
                row.querySelector('[data-sum]').textContent = Object.keys(p).filter(c => p[c]).map(c => `${c} ${+fixed(p[c])}`).join(' · ');
                for (const ch of row.querySelectorAll('[data-ch]')) {
                    const c = ch.dataset.ch, v = p[c] || 0, old = w[c] || 0;
                    const slider = ch.querySelector('[data-slider]'), number = ch.querySelector('[data-number]');
                    if (document.activeElement !== slider) slider.value = String(v);
                    if (document.activeElement !== number) number.value = fixed(v);
                    const differs = Math.abs(v - old) > 1e-9;
                    ch.classList.toggle('changed', differs);
                    showWas(ch, differs, +fixed(old));
                }
            }
            refreshTiming(); refreshSource();
        }
        // Beside a changed number, the file's: a button that puts it back.
        function showWas(row, differs, old) {
            const was = row.querySelector('[data-was]');
            was.hidden = !differs;
            was.textContent = differs ? `原 ${old} ↺` : '';
            was.title = differs ? `还原成文件里的 ${old}` : '';
        }
        // Undo: each gesture (a slider dragged, a number typed) is one step.
        const undo = [], redo = [];
        let gesture = false;
        function beginEdit() {
            if (gesture) return;
            gesture = true;
            undo.push(lab.draft()); redo.length = 0;
            if (undo.length > 200) undo.shift();
        }
        function endEdit() { gesture = false; }
        function restore(from, to) {
            if (!from.length) return;
            to.push(lab.draft());
            lab.revertAll(); lab.apply(from.pop());
            edited({ timing: true });
        }
        // After any change to a pose or the timing.
        function edited({ timing = false } = {}) {
            trailsDirty = true;
            if (!playing && keyTime() != null && !timing) time = keyTime();
            refreshEditor(); refreshChoices(); drawTimeline(); checks.later(); saveDraft.later();
            if (timing) rebuild.later(90); else rebuild.later();
        }
        function selectBone(bone, reveal = false) {
            state.bone = bone;
            if (reveal) state.open.add(bone);
            refreshEditor();
            if (reveal) boneRows[bone]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        bonesBox.addEventListener('click', e => {
            const row = e.target.closest('[data-bone]');
            if (!row) return;
            const bone = row.dataset.bone;
            if (e.target.closest('.bone-head')) {
                if (state.open.has(bone) && state.bone === bone) state.open.delete(bone); else state.open.add(bone);
                state.bone = bone; refreshEditor(); savePrefs();
            } else if (e.target.closest('[data-zero], [data-was]')) {
                // To zero, or back to the file's number.
                const c = e.target.closest('[data-ch]').dataset.ch, back = e.target.closest('[data-was]');
                beginEdit(); lab.set(editing(), bone, c, back ? lab.original(editing())[bone]?.[c] || 0 : 0); endEdit();
                state.bone = bone; edited();
            }
        });
        const channelOf = e => { const ch = e.target.closest('[data-ch]'), row = e.target.closest('[data-bone]'); return ch && row ? { bone: row.dataset.bone, c: ch.dataset.ch } : null; };
        bonesBox.addEventListener('pointerdown', e => { if (e.target.matches('[data-slider]')) { beginEdit(); const t = channelOf(e); if (t) state.bone = t.bone; } });
        bonesBox.addEventListener('input', e => {
            const t = channelOf(e), v = parseFloat(e.target.value);
            if (!t || !Number.isFinite(v)) return;
            beginEdit();
            lab.set(editing(), t.bone, t.c, v);
            state.bone = t.bone;
            edited();
        });
        bonesBox.addEventListener('change', e => { if (channelOf(e)) endEdit(); });
        // Fine control: drag sideways on a channel's name, 0.01 a pixel (Shift: 0.002).
        let nudge = null;
        bonesBox.addEventListener('pointerdown', e => {
            const name = e.target.closest('.ch-name'), t = name && channelOf(e);
            if (!t) return;
            e.preventDefault();
            name.setPointerCapture(e.pointerId);
            beginEdit();
            nudge = { ...t, x: e.clientX, from: lab.poseOf(editing())[t.bone]?.[t.c] || 0 };
            state.bone = t.bone;
        });
        bonesBox.addEventListener('pointermove', e => {
            if (!nudge) return;
            lab.set(editing(), nudge.bone, nudge.c, nudge.from + (e.clientX - nudge.x) * (e.shiftKey ? 0.002 : 0.01));
            edited();
        });
        const endNudge = () => { if (nudge) { nudge = null; endEdit(); } };
        bonesBox.addEventListener('pointerup', endNudge);
        bonesBox.addEventListener('pointercancel', endNudge);
        // Turning a bone about one of its own axes: drag sideways on X, Y
        // or Z, 0.01 a pixel (Shift: 0.002), from the pose it had as the
        // drag began. Its three numbers follow.
        let turning = null;
        bonesBox.addEventListener('pointerdown', e => {
            const handle = e.target.closest('[data-turn]'), bone = handle?.closest('[data-bone]')?.dataset.bone;
            if (!bone) return;
            e.preventDefault();
            document.activeElement?.blur?.();
            handle.setPointerCapture(e.pointerId);
            beginEdit();
            turning = { bone, axis: handle.dataset.turn, x: e.clientX, from: { ...lab.poseOf(editing())[bone] } };
            state.bone = bone;
            refreshEditor();
        });
        bonesBox.addEventListener('pointermove', e => {
            if (!turning) return;
            lab.turn(editing(), turning.bone, turning.axis, (e.clientX - turning.x) * (e.shiftKey ? 0.002 : 0.01), turning.from);
            edited();
        });
        const endTurn = () => { if (turning) { turning = null; endEdit(); } };
        bonesBox.addEventListener('pointerup', endTurn);
        bonesBox.addEventListener('pointercancel', endTurn);
        // Which slider is in use (see sliderAxis).
        const sliderOf = e => { const t = channelOf(e); return t && t.c[0] === 'r' ? t : null; };
        bonesBox.addEventListener('pointerover', e => { inUse.hover = sliderOf(e); });
        bonesBox.addEventListener('pointerleave', () => { inUse.hover = null; });
        bonesBox.addEventListener('focusin', e => { inUse.focus = sliderOf(e); });
        bonesBox.addEventListener('focusout', () => { inUse.focus = null; });

        // ---- timing ----
        const timingBox = $('[data-timing]');
        function refreshTiming() {
            $('[data-timing-box]').hidden = state.mode === 'pose';
            if (state.mode === 'pose') return;
            const m = moves()[state.move], was = lab.originalTiming(state.move), editable = lab.timingEditable();
            const fields = lab.TIMING.filter(k => k in m);
            const signature = `${state.move}:${fields.join()}`;
            if (timingBox.dataset.signature !== signature) {
                timingBox.dataset.signature = signature;
                timingBox.innerHTML = fields.map(k => {
                    const whole = k === 'step' || k === 'chargeStep', [lo, hi, step] = whole ? [k === 'step' ? -40 : 0, 40, 1] : [k === 'derive' ? 0 : 0.01, 1.2, 0.01];
                    return `<div class="ch tm" data-field="${k}" title="${TIMING_TEXT[k][1]}">
                        <span class="ch-name">${TIMING_TEXT[k][0]}</span>
                        <input type="range" min="${lo}" max="${hi}" step="${step}" data-slider ${editable ? '' : 'disabled'}>
                        <input type="number" step="${step}" data-number ${editable ? '' : 'disabled'}>
                        <button type="button" class="ch-was" data-was hidden></button>
                    </div>`;
                }).join('') + `<p class="tune-note">${moves()[state.move].derive == null ? '收尾招没有派生点：后摇总是放完。' : ''}一整招：<span data-total></span></p>`;
            }
            for (const row of timingBox.querySelectorAll('[data-field]')) {
                const k = row.dataset.field, v = m[k], slider = row.querySelector('[data-slider]'), number = row.querySelector('[data-number]');
                if (k === 'derive') slider.max = String(m.recovery);
                if (document.activeElement !== slider) slider.value = String(v);
                if (document.activeElement !== number) number.value = k === 'step' || k === 'chargeStep' ? String(v) : fixed(v);
                const differs = v !== was[k];
                row.classList.toggle('changed', differs);
                showWas(row, differs, was[k]);
            }
            const total = timingBox.querySelector('[data-total]');
            if (total) total.textContent = `前摇 ${fixed(m.windup)} + 挥动 ${fixed(m.swing)} + 后摇 ${fixed(m.recovery)} = ${fixed(m.windup + m.swing + m.recovery)} 秒`;
        }
        timingBox.addEventListener('pointerdown', e => { if (e.target.matches('[data-slider]')) beginEdit(); });
        timingBox.addEventListener('input', e => {
            const row = e.target.closest('[data-field]'), v = parseFloat(e.target.value);
            if (!row || !Number.isFinite(v)) return;
            beginEdit();
            lab.setTiming(state.move, row.dataset.field, v);
            edited({ timing: true });
        });
        timingBox.addEventListener('change', e => { if (e.target.closest('[data-field]')) endEdit(); });
        timingBox.addEventListener('click', e => {
            const k = e.target.closest('[data-was]')?.closest('[data-field]')?.dataset.field;
            if (!k) return;
            beginEdit(); lab.setTiming(state.move, k, lab.originalTiming(state.move)[k]); endEdit();
            edited({ timing: true });
        });

        // ---- checks: the blade's path at once, the hit tests once the sliders rest ----
        const checksBox = $('[data-checks]');
        const side = (angle, height) => `${Math.abs(angle) < 0.09 ? '正前' : angle > 0 ? '左' : '右'} ${Math.round(Math.abs(angle) * 180 / Math.PI)}° · 高 ${fixed(height)} 格`;
        function baselineOf(id) {
            if (!baseline.has(id)) {
                const draft = lab.draft();
                lab.revertAll();
                try { baseline.set(id, lab.measure(id, { offhand: state.offhand || null, quick: true })); } finally { lab.apply(draft); }
            }
            return baseline.get(id);
        }
        let lastFull = null;
        function showChecks(full) {
            $('[data-checks-box]').hidden = state.mode === 'pose';
            if (state.mode === 'pose') return;
            const id = state.move, m = lab.measure(id, { offhand: state.offhand || null, quick: true }), was = baselineOf(id);
            if (full) lastFull = { id, ...lab.measure(id, { offhand: state.offhand || null }) };
            const f = lastFull?.id === id ? lastFull : null, sword = moves()[id].weapon === 'sword';
            const yes = (ok, good = true) => ok == null ? '<span class="wait">…</span>' : ok === good ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>';
            const sweepOff = Math.abs(m.sweep - was.sweep);
            checksBox.innerHTML = `
                <dt>扫过的角度</dt><dd><b class="${sweepOff > 15 ? 'warn' : ''}">${Math.round(m.sweep)}°</b>（文件里 ${Math.round(was.sweep)}°；测试允许和设计值差 15° 以内）</dd>
                <dt>剑尖起点</dt><dd>${side(m.start.angle, m.start.height)}${m.start.ahead < 0 ? ' · 在身后' : ''}</dd>
                <dt>剑尖终点</dt><dd>${side(m.end.angle, m.end.height)}${m.end.ahead < 0 ? ' · 在身后' : ''}</dd>
                <dt>剑尖最低</dt><dd><b class="${m.lowest < 0 ? 'bad' : sword && m.lowest < 0.3 ? 'warn' : ''}">${fixed(m.lowest)} 格</b>${sword ? '（剑不碰地：至少 0.3 格）' : ''}</dd>
                <dt>标准距离 ${f?.standard ?? lab.standardOf(moves()[id].weapon)}</dt><dd>打到木桩 ${yes(f?.landsDummy)} 打到人 ${yes(f?.landsPlayer)}</dd>
                <dt>${lab.TOO_FAR} 以外</dt><dd>打不到 ${yes(f?.tooFar, false)}</dd>
                <dt>最远打到</dt><dd>${f ? f.reach != null ? `${f.reach}（${fixed(f.reach / U)} 格）` : '—' : '<span class="wait">…</span>'}</dd>`;
        }
        const checks = {
            quick: 0, full: 0,
            now() { clearTimeout(this.quick); clearTimeout(this.full); showChecks(false); this.full = setTimeout(() => showChecks(true), 30); },
            later() {
                if (!this.quick) this.quick = setTimeout(() => { this.quick = 0; showChecks(false); }, 120);
                clearTimeout(this.full); this.full = setTimeout(() => showChecks(true), 450);
            }
        };

        // ---- export and the draft ----
        const source = $('[data-export]');
        function thisSource() {
            if (state.mode === 'pose') return `// ${lab.POSES[state.pose].file}\n${lab.poseSource(state.pose)}`;
            const id = state.move;
            return `// models/player_moves.js\n${lab.moveSource(id)}${lab.timingChanged(id) ? `\n// game_config.js\n${lab.timingSource(id)}` : ''}`;
        }
        function refreshSource() { source.value = lab.changesSource() || '（还没有改动）'; }
        async function copy(text, label) {
            try { await navigator.clipboard.writeText(text); }
            catch (_) { source.value = text; source.select(); document.execCommand?.('copy'); }
            $('[data-copied]').textContent = `已复制${label}`;
            setTimeout(() => { $('[data-copied]').textContent = ''; refreshSource(); }, 2500);
        }
        $$('[data-copy]').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.copy === 'all') { const text = lab.changesSource(); if (text) copy(text, '全部改动'); else $('[data-copied]').textContent = '还没有改动'; }
            else copy(thisSource(), '这一项');
        }));
        $$('[data-revert]').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.revert === 'all' && !window.confirm('把所有改动都还原成文件里的数？（可以 Ctrl+Z 撤销）')) return;
            beginEdit();
            if (b.dataset.revert === 'all') lab.revertAll();
            else if (state.mode === 'pose') lab.revert(state.pose);
            else lab.revertMove(state.move);
            endEdit(); edited({ timing: true });
        }));
        const saveDraft = () => {
            const d = lab.draft();
            if (pending) for (const part of ['poses', 'timing']) for (const [k, e] of Object.entries(pending[part])) if (!(k in d[part])) d[part][k] = e;
            writeJSON(STORE.draft, d);
        };
        saveDraft.later = () => { clearTimeout(saveDraft.soon); saveDraft.soon = setTimeout(saveDraft, 300); };

        // ---- keys ----
        window.addEventListener('keydown', e => {
            const mod = e.ctrlKey || e.metaKey, field = e.target.closest?.('input, textarea, select');
            // A field keeps its own keys, except that a slider lets Space and undo through.
            if (field && !(field.type === 'range' && (e.key === ' ' || mod))) return;
            // A focused button would be pressed by the Space too (on its keyup).
            if (e.key === ' ' && document.activeElement?.matches('button, input[type="range"]')) document.activeElement.blur();
            if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) restore(redo, undo); else restore(undo, redo); return; }
            if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); restore(redo, undo); return; }
            if (mod || e.altKey) return;
            if (e.key === ' ') { e.preventDefault(); playButton.click(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrames(e.shiftKey ? -10 : -1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrames(e.shiftKey ? 10 : 1); }
            else if (e.key === 'Home') { time = 0; }
            else if (e.key === '1' || e.key === '2') selectKey(e.key === '1' ? 'a' : 'b');
        });

        // ---- the draft against the files ----
        const nameOf = n => {
            const [id, k] = n.split('.');
            if (!k) return lab.POSES[id]?.name || id;
            return `${moves()[id]?.name || id} ${k === 'timing' ? '节奏' : k}`;
        };
        function showNotice() {
            $('[data-notice]').hidden = !pending;
            if (pending) $('[data-notice-text]').textContent = `这些项在你上次调过之后，文件里又改过了，现在显示的是文件里的新数据：${loaded.stale.map(nameOf).join('、')}。上次草稿里的这几项先没有套用。`;
        }
        $$('[data-notice]').forEach(b => b.tagName === 'BUTTON' && b.addEventListener('click', () => {
            if (b.dataset.notice === 'restore') { beginEdit(); lab.apply(pending, { force: true }); endEdit(); }
            pending = null;
            showNotice(); saveDraft(); edited({ timing: true });
        }));
        showNotice();
        // What was already written back is gone from the draft from now on.
        saveDraft();

        refreshChoices(); rebuild(); refreshEditor(); checks.now();
        setPlaying(true);
        requestAnimationFrame(frame);
        // For tests and the console: the workbench, the view, and where the preview is.
        window.tune = {
            lab, view, state,
            get rec() { return rec; },
            get time() { return time; }, set time(t) { time = clamp(t, 0, rec.duration); },
            get playing() { return playing; }, pause() { setPlaying(false); }, play() { setPlaying(true); },
            draw, rebuild, refresh: () => { refreshChoices(); refreshEditor(); drawTimeline(); }
        };
    }
    return { start };
})();
