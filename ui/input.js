// Touch, mouse and keyboard to the five controls (design.md
// 3.2): a floating stick on the left, attack, guard and offhand on the right,
// interact on the left. One pointer per control and at most
// input.maxTouches at once (two thumbs). Movement leaves here already turned
// into a ground direction; the simulation never sees pixels.
//
// A drag across the picture itself, off every control, turns the camera
// round the fighter (`yaw`; user, 2026-10-08). Where the camera stands is
// this phone's own and is drawn only: the simulation never hears of it, but
// the stick's directions are the screen's, so they are read by it. A thumb
// turning the camera gives way to any control pressed past the two touches.
const inputLayer = (() => {
    const MOVE_KEYS = ['up', 'down', 'left', 'right'];

    function attach(root, sink) {
        const C = gameConfig.input;
        const zone = root.querySelector('[data-stick-zone]'), stick = root.querySelector('[data-stick]'), knob = root.querySelector('[data-knob]');
        const picture = root.querySelector('canvas');
        let yaw = gameConfig.camera.yaw;
        const buttons = {};
        root.querySelectorAll('[data-button]').forEach(el => { buttons[el.dataset.button] = el; });
        const pointers = new Map(); // pointerId -> { control, el, x0, y0 }
        const holds = new Map(); // button -> how many sources (pointer, key) hold it
        const keysHeld = new Set(), keyButtons = new Set(), removers = [];
        let stickVec = { x: 0, y: 0 }, keyVec = { x: 0, y: 0 }, sent = { x: 0, y: 0 }, rest = { x: 0, y: 0 };
        const listen = (node, type, fn, options) => { node.addEventListener(type, fn, options); removers.push(() => node.removeEventListener(type, fn, options)); };
        const codeTo = {};
        for (const [name, codes] of Object.entries(C.keys)) for (const code of codes) codeTo[code] = name;

        const stickActive = () => [...pointers.values()].some(p => p.control === 'stick');
        function sendMove() {
            const v = stickActive() ? stickVec : keyVec, g = space.screenToGround(v.x, v.y, yaw);
            if (g.x === sent.x && g.y === sent.y) return;
            sent = g; sink.move(g.x, g.y);
        }
        function hold(id) {
            const n = holds.get(id) || 0;
            holds.set(id, n + 1);
            if (n === 0) { buttons[id]?.classList.add('pressed'); sink.press(id); }
        }
        function drop(id) {
            const n = holds.get(id) || 0;
            if (n <= 0) return;
            holds.set(id, n - 1);
            if (n === 1) { buttons[id]?.classList.remove('pressed'); sink.release(id); }
        }
        function showStick(x, y) { stick.style.setProperty('--x', `${x}px`); stick.style.setProperty('--y', `${y}px`); }
        function moveKnob(dx, dy) {
            const len = Math.hypot(dx, dy), k = len > C.stickRadius ? C.stickRadius / len : 1;
            knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        }
        function restStick() { stick.classList.remove('active'); showStick(rest.x, rest.y); moveKnob(0, 0); }
        const local = e => { const r = root.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        // May `control` take a new pointer? One each, and maxTouches in all;
        // past that, the pointer turning the camera is let go for it.
        function canStart(control) {
            const held = [...pointers];
            if (held.some(([, p]) => p.control === control)) return false;
            if (held.length < C.maxTouches) return true;
            const look = control !== 'look' && held.find(([, p]) => p.control === 'look');
            if (look) end({ pointerId: look[0] });
            return !!look;
        }
        // Capture keeps a drag on its control; a pointer that is already gone
        // (or a synthetic one in a test) simply goes uncaptured.
        const capture = (el, id) => { try { el.setPointerCapture(id); } catch (_) { /* no live pointer */ } };

        listen(root, 'contextmenu', e => e.preventDefault());
        listen(zone, 'pointerdown', e => {
            e.preventDefault();
            if ((e.pointerType === 'mouse' && e.button !== 0) || !canStart('stick')) return;
            const at = local(e);
            pointers.set(e.pointerId, { control: 'stick', el: zone, x0: at.x, y0: at.y });
            capture(zone, e.pointerId);
            stick.classList.add('active'); showStick(at.x, at.y); moveKnob(0, 0);
            stickVec = { x: 0, y: 0 }; sendMove();
        });
        listen(zone, 'pointermove', e => {
            const p = pointers.get(e.pointerId);
            if (!p || p.control !== 'stick') return;
            // A mouse released outside the window never sent pointerup.
            if (e.pointerType === 'mouse' && e.buttons === 0) { end(e); return; }
            const at = local(e), dx = at.x - p.x0, dy = at.y - p.y0;
            moveKnob(dx, dy); stickVec = controlsKit.stickVector(dx, dy); sendMove();
        });
        for (const [id, el] of Object.entries(buttons)) {
            listen(el, 'pointerdown', e => {
                e.preventDefault();
                if ((e.pointerType === 'mouse' && e.button !== 0) || el.classList.contains('disabled') || !canStart(id)) return;
                pointers.set(e.pointerId, { control: id, el });
                capture(el, e.pointerId);
                hold(id);
            });
        }
        // The camera: the drag is taken from one pointer event to the next,
        // and what the stick or the keys hold is sent anew as the ground
        // turns under them.
        if (picture) {
            listen(picture, 'pointerdown', e => {
                e.preventDefault();
                if ((e.pointerType === 'mouse' && e.button !== 0) || !canStart('look')) return;
                pointers.set(e.pointerId, { control: 'look', el: picture, x: local(e).x });
                capture(picture, e.pointerId);
            });
            listen(picture, 'pointermove', e => {
                const p = pointers.get(e.pointerId);
                if (!p || p.control !== 'look') return;
                if (e.pointerType === 'mouse' && e.buttons === 0) { end(e); return; }
                const x = local(e).x;
                yaw = controlsKit.turned(yaw, x - p.x); p.x = x;
                sendMove();
            });
        }
        function end(e) {
            const p = pointers.get(e.pointerId);
            if (!p) return;
            pointers.delete(e.pointerId);
            if (p.el.hasPointerCapture?.(e.pointerId)) p.el.releasePointerCapture(e.pointerId);
            if (p.control === 'stick') { stickVec = { x: 0, y: 0 }; restStick(); sendMove(); } else if (p.control !== 'look') drop(p.control);
        }
        for (const el of [zone, picture, ...Object.values(buttons)].filter(Boolean)) for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(el, type, end);

        listen(window, 'keydown', e => {
            const name = codeTo[e.code];
            if (!name || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            if (e.repeat) return;
            if (MOVE_KEYS.includes(name)) { keysHeld.add(e.code); keyVec = controlsKit.keyVector(keysHeld); sendMove(); }
            else if (!keyButtons.has(name) && !buttons[name]?.classList.contains('disabled')) { keyButtons.add(name); hold(name); }
        });
        listen(window, 'keyup', e => {
            // macOS sends no keyup for keys let go while Cmd was down.
            if (e.key === 'Meta') { releaseKeys(); return; }
            const name = codeTo[e.code];
            if (!name) return;
            if (MOVE_KEYS.includes(name)) { keysHeld.delete(e.code); keyVec = controlsKit.keyVector(keysHeld); sendMove(); }
            else if (keyButtons.delete(name)) drop(name);
        });
        function releaseKeys() {
            keysHeld.clear(); keyVec = { x: 0, y: 0 };
            for (const name of [...keyButtons]) { keyButtons.delete(name); drop(name); }
            sendMove();
        }
        // Let go of everything: focus lost or the page hidden.
        function releaseAll() {
            for (const id of [...pointers.keys()]) end({ pointerId: id });
            releaseKeys();
        }
        listen(window, 'blur', releaseAll);
        listen(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

        // Safe-area insets, read through a probe because env() is CSS-only.
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
        root.appendChild(probe);
        function insets() {
            const s = getComputedStyle(probe);
            return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
        }
        function place() {
            const r = root.getBoundingClientRect(), L = controlsKit.layout(r.width, r.height, insets());
            for (const [id, b] of Object.entries(L.buttons)) {
                const el = buttons[id];
                if (!el) continue;
                Object.assign(el.style, { left: `${b.x - b.r}px`, top: `${b.y - b.r}px`, width: `${b.size}px`, height: `${b.size}px` });
            }
            const z = L.stickZone;
            Object.assign(zone.style, { left: `${z.x0}px`, top: `${z.y0}px`, width: `${z.x1 - z.x0}px`, height: `${z.y1 - z.y0}px` });
            stick.style.setProperty('--r', `${C.stickRadius}px`);
            rest = L.stickRest;
            if (!stickActive()) restStick();
            return L;
        }
        return {
            place, releaseAll,
            // Where the camera has been turned to (core/space.js: 0 due south of the fighter).
            yaw: () => yaw,
            state: () => ({ pointers: [...pointers.values()].map(p => p.control), stick: { ...stickVec }, keys: [...keysHeld], sent: { ...sent }, yaw }),
            destroy() { releaseAll(); removers.forEach(remove => remove()); probe.remove(); }
        };
    }
    return { attach };
})();
