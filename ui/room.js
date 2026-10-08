// The room screen (design.md 8.4): pick a weapon (pvp.weapons), then
// create a room and show its code, or type the other phone's code on a
// keypad and join. Once the channel is up the link is handed to
// `connected({ link, role, code, on, weapon })`; the duel itself is
// ui/app.js's, which sets on.message and on.close. `closed()`: the screen
// was left without a connection. The pick is remembered on this phone.
const roomScreen = (() => {
    const INTRO = '两台手机都要联网，不必连同一个 Wi-Fi。先选武器，然后一台创建房间，另一台输入房间号加入。';
    const KEY = 'pvp-weapon';
    // One line on how each weapon type plays.
    const LINES = { sword: '射程远，出招稳重', dagger: '出招快，连段长，要贴近' };
    const typeOf = main => gameConfig.combo.weapons[gameConfig.items[main].weapon];
    function attach(root, { connected, closed }) {
        const panel = root.querySelector('[data-room]'), $ = sel => panel.querySelector(sel);
        const title = $('[data-room-title]'), note = $('[data-room-note]'), code = $('[data-room-code]'), slots = [...code.children];
        const status = $('[data-room-status]'), keys = $('[data-room-keys]'), picker = $('[data-room-weapons]');
        const choices = gameConfig.pvp.weapons;
        let weapon = choices[0];
        try { const kept = localStorage.getItem(KEY); if (choices.includes(kept)) weapon = kept; } catch { /* no storage: the first weapon */ }
        picker.innerHTML = choices.map(main => {
            const item = gameConfig.items[main], type = gameConfig.items[main].weapon;
            return `<button type="button" role="radio" data-weapon="${main}"><span class="weapon-icon">${item.icon}</span><b>${typeOf(main).name}</b><small>${LINES[type] || ''}</small></button>`;
        }).join('');
        // The weapons' pictures are drawn from their models the first time the picker shows.
        let drawn = false;
        const drawIcons = () => {
            if (drawn) return;
            drawn = true;
            picker.querySelectorAll('[data-weapon]').forEach(b => { b.querySelector('.weapon-icon').innerHTML = itemScreens.iconHtml(b.dataset.weapon); });
        };
        function pick(main) {
            if (!choices.includes(main)) return;
            weapon = main;
            try { localStorage.setItem(KEY, main); } catch { /* not kept */ }
            picker.querySelectorAll('[data-weapon]').forEach(b => { const on = b.dataset.weapon === main; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        }
        pick(weapon);
        const actions = Object.fromEntries([...panel.querySelectorAll('[data-room-action]')].map(b => [b.dataset.roomAction, b]));
        let step = 'closed', typed = '', link = null, attempt = 0;
        // Link callbacks; the duel takes message and close over.
        let hooks = {};

        function say(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
        function digits(text) { slots.forEach((slot, i) => { slot.textContent = text[i] || ''; slot.classList.toggle('next', step === 'join' && i === text.length); }); }
        const SHOW = {
            entry: { title: '联机对战', note: INTRO, pick: true, buttons: { host: '创建房间', join: '加入房间', back: '返回' }, primary: 'host' },
            hosting: { title: '创建房间', note: '把房间号告诉对方，让对方点"加入房间"。', code: true, buttons: { back: '取消' } },
            join: { title: '加入房间', note: '输入对方的 4 位房间号。', code: true, keys: true, buttons: { connect: '加入', back: '返回' }, primary: 'connect' },
            joining: { title: '加入房间', note: '', code: true, keys: true, buttons: { back: '取消' } }
        };
        function show(next) {
            step = next;
            const S = SHOW[next];
            panel.hidden = false;
            title.textContent = S.title;
            note.textContent = S.pick ? S.note : [S.note, `你用：${typeOf(weapon).name}`].filter(Boolean).join(' ');
            picker.hidden = !S.pick;
            if (S.pick) drawIcons();
            code.hidden = !S.code; keys.hidden = !S.keys;
            panel.classList.toggle('keyed', !!S.keys);
            for (const [id, button] of Object.entries(actions)) {
                button.hidden = !S.buttons[id];
                if (S.buttons[id]) button.textContent = S.buttons[id];
                button.classList.toggle('primary', S.primary === id);
            }
            keys.querySelectorAll('button').forEach(b => { b.disabled = next !== 'join'; });
            refresh();
        }
        function refresh() {
            if (step === 'join' || step === 'joining') digits(typed);
            actions.connect.disabled = typed.length !== 4;
        }

        // ---- hosting: a room with a fresh code, waiting for one guest ----
        function makeLink(role, roomCode) {
            hooks = {};
            return netLink.create({
                open: () => handOver(role, roomCode),
                message: msg => hooks.message?.(msg),
                close: () => hooks.close?.(),
                status: text => { if (step !== 'closed') say(text); }
            });
        }
        async function host(retries = 3) {
            const mine = ++attempt, roomCode = netLink.randomCode();
            link = makeLink('host', roomCode);
            show('hosting'); digits(roomCode);
            say('正在连接联机服务器…');
            try {
                await link.host(roomCode);
            } catch (error) {
                if (mine !== attempt) return;
                link.close(); link = null;
                if (error.code === 'taken' && retries > 0) { host(retries - 1); return; }
                show('entry'); say(`创建失败：${error.message}`, true);
                return;
            }
            if (mine === attempt && step === 'hosting') say('等待对方加入…');
        }
        // ---- joining with a typed code ----
        async function join() {
            if (typed.length !== 4) return;
            const mine = ++attempt, roomCode = typed;
            link = makeLink('guest', roomCode);
            show('joining'); say('正在连接…');
            try {
                await link.join(roomCode);
            } catch (error) {
                if (mine !== attempt) return;
                link.close(); link = null;
                show('join'); say(`加入失败：${error.message}`, true);
            }
        }
        function handOver(role, roomCode) {
            if (!link) return;
            const handed = link;
            link = null; attempt++;
            close();
            connected({ link: handed, role, code: roomCode, on: hooks, weapon });
        }
        function cancel() {
            attempt++;
            link?.close(); link = null;
        }
        function close() { step = 'closed'; panel.hidden = true; say(''); }
        function type(key) {
            if (step !== 'join') return;
            if (key === 'back') typed = typed.slice(0, -1);
            else if (key === 'clear') typed = '';
            else if (/^\d$/.test(key) && typed.length < 4) typed += key;
            say('');
            refresh();
        }

        actions.host.addEventListener('click', () => host());
        actions.join.addEventListener('click', () => { typed = ''; show('join'); say(''); });
        actions.connect.addEventListener('click', join);
        actions.back.addEventListener('click', () => {
            if (step === 'hosting' || step === 'join') { cancel(); show('entry'); say(''); }
            else if (step === 'joining') { cancel(); show('join'); say(''); }
            else { cancel(); close(); closed?.(); }
        });
        keys.addEventListener('click', e => { const key = e.target.closest('[data-key]')?.dataset.key; if (key) type(key); });
        picker.addEventListener('click', e => { if (step === 'entry') pick(e.target.closest('[data-weapon]')?.dataset.weapon); });
        // Keys while the screen is open: digits, Backspace and Enter on the
        // keypad, Escape for back. Taken before the game sees them.
        window.addEventListener('keydown', e => {
            if (step === 'closed') return;
            if (step === 'join' && /^(Digit|Numpad)\d$/.test(e.code)) type(e.code.slice(-1));
            else if (step === 'join' && e.code === 'Backspace') type('back');
            else if (step === 'join' && (e.code === 'Enter' || e.code === 'NumpadEnter')) join();
            else if (e.code === 'Escape') { if (!e.repeat) actions.back.click(); }
            else return;
            e.preventDefault(); e.stopPropagation();
        }, true);

        return {
            open() { cancel(); typed = ''; show('entry'); say(''); actions.host.focus({ preventScroll: true }); },
            isOpen: () => step !== 'closed',
            get step() { return step; }, get weapon() { return weapon; }, pick
        };
    }
    return { attach };
})();
