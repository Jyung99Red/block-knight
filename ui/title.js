// The title screen (design.md 3.6; user, 2026-10-08): the page opens on
// it, over the base dimmed and standing still. 继续冒险 when there is a
// save; 新的冒险 (开始冒险 without one: a save is erased only once asked);
// the shared adventure's room and the duel's (ui/room.js); this phone's settings, unfolded beside the keys
// (ui/settings_view.js). No 退出: a page cannot close itself, and a phone
// leaves a game by its own gesture; the menu's 回到主界面 comes back here.
// Behind it the camera goes from one thing of the region to another,
// picked at random (render/world_view.js), the picture going dark at each
// cut (`dim`).
const titleScreen = (() => {
    // hooks: saved() a save exists; act(name) for continue, new, coop and duel.
    function attach(root, hooks) {
        const el = root.querySelector('[data-title]');
        const keys = Object.fromEntries([...el.querySelectorAll('[data-title-act]')].map(b => [b.dataset.titleAct, b]));
        const box = el.querySelector('[data-title-settings]'), settingsPage = settingsView.attach(box, { prefix: 'title-setting' });
        const cut = el.querySelector('[data-title-cut]');
        let open = false, unfolded = false, dark = -1;
        // How dark the picture behind is, 0 to 1 (the world view's `tourFade`).
        function dim(amount) {
            const now = Math.round(amount * 100) / 100;
            if (now === dark) return;
            dark = now;
            cut.style.opacity = String(now);
        }
        function render() {
            const saved = hooks.saved();
            keys.continue.hidden = !saved;
            keys.new.textContent = saved ? '新的冒险' : '开始冒险';
            keys.new.classList.toggle('primary', !saved);
            // Red while it would erase a save (user, 2026-10-08).
            keys.new.classList.toggle('danger', saved);
            box.hidden = !unfolded;
            keys.settings.setAttribute('aria-expanded', String(unfolded));
            if (unfolded) settingsPage.render();
        }
        // Shown again while open, it is only brought up to date.
        function show() {
            const was = open;
            open = true; el.hidden = false;
            root.classList.add('at-title');
            if (!was) unfolded = false;
            render();
            if (!was) (hooks.saved() ? keys.continue : keys.new).focus({ preventScroll: true });
        }
        function close() {
            if (!open) return;
            open = false; el.hidden = true;
            root.classList.remove('at-title');
            settingsPage.stop();
        }
        el.addEventListener('click', e => {
            const key = e.target.closest('[data-title-act]');
            if (!key) return;
            if (key.dataset.titleAct === 'settings') { unfolded = !unfolded; render(); }
            else hooks.act(key.dataset.titleAct);
        });
        return { open: show, close, dim, isOpen: () => open };
    }
    return { attach };
})();
