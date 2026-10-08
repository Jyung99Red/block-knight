// The settings page (design.md 3.6), shown in the menu and on the title
// screen: a row per setting of ui/settings.js, every choice a key (the one
// in use lit); under the picture quality its values' sliders, showing the
// quality picked. A key picks its choice; moving a slider makes the
// quality custom (user, 2026-10-08).
const settingsView = (() => {
    // Half a slider's knob (CSS pixels), which the track is short of at
    // either end. (How far a finger goes before its way is judged:
    // gameConfig.input.sliderSlop.)
    const KNOB = 8;
    // The picture quality's sliders, one per value of graphics.choices:
    // the label, and how a value reads. The pixel ratio reads as what is
    // drawn: never more than the phone's own, and the picture's size in
    // device pixels.
    const SLIDERS = {
        pixelRatio: ['像素比', v => {
            const own = window.devicePixelRatio || 1, used = Math.min(v, own);
            return `×${+used.toFixed(2)}${v > own ? '（手机上限）' : ''} ${Math.round(window.innerWidth * used)}×${Math.round(window.innerHeight * used)}`;
        }],
        sunShadow: ['太阳影子', v => String(v)],
        torchShadow: ['火把影子', v => String(v)],
        torchTaps: ['火把柔边', v => `${v} 点`],
        bounce: ['反弹光', v => v ? '开' : '关'],
        lampShadows: ['火炬影子', v => v ? `${v} 盏` : '关']
    };
    const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    // `el`: the page's element, filled by render(). Each row's name has an
    // id: `prefix` keeps two pages' ids apart.
    function attach(el, { prefix }) {
        function render() {
            el.innerHTML = Object.entries(gameSettings.CHOICES).map(([key, c]) => {
                const now = gameSettings.get(key), id = `${prefix}-${key}`;
                const row = `<div class="setting-row"><span class="setting-name" id="${id}">${c.label}</span><div class="choice" role="radiogroup" aria-labelledby="${id}">`
                    + c.options.map(([value, label], i) => `<button type="button" role="radio" aria-checked="${value === now}" data-setting="${key}" data-pick="${i}">${label}</button>`).join('')
                    + '</div></div>';
                return key === 'quality' ? row + sliders() : row;
            }).join('');
        }
        // The picture's values, one slider each.
        function sliders() {
            const values = gameSettings.get('custom'), choices = gameConfig.graphics.choices;
            return `<div class="sliders">${Object.entries(SLIDERS).map(([key, [label, read]]) => {
                const options = choices[key], at = Math.max(0, options.indexOf(values[key]));
                return `<label class="slider"><span>${label}<b data-custom-shown="${key}">${esc(read(options[at]))}</b></span>`
                    + `<span class="slider-track" data-track><input type="range" min="0" max="${options.length - 1}" step="1" value="${at}" data-custom="${key}" aria-label="${label}"></span></label>`;
            }).join('')}</div>`;
        }
        // A setting's key picks its choice.
        el.addEventListener('click', e => {
            const s = e.target.closest('[data-setting]');
            if (!s) return;
            gameSettings.set(s.dataset.setting, gameSettings.CHOICES[s.dataset.setting].options[Number(s.dataset.pick)][0]);
            render();
        });
        // A slider moved: its value reads at once; let go, it is kept and drawn.
        const slid = e => {
            const input = e.target.closest?.('[data-custom]');
            if (!input) return null;
            const key = input.dataset.custom, value = gameConfig.graphics.choices[key][Number(input.value)];
            el.querySelector(`[data-custom-shown="${key}"]`).textContent = SLIDERS[key][1](value);
            return { key, value };
        };
        el.addEventListener('input', slid);
        el.addEventListener('change', e => { const s = slid(e); if (s) { gameSettings.setCustom(s.key, s.value); render(); } });
        // A slider moves for a sideways drag only (user, 2026-10-08: a
        // scroll begun on one moved it). Its input takes no touch; its track
        // waits until the finger has gone input.sliderSlop: sideways, the slider
        // follows the finger; up or down, it is the page's scroll
        // (touch-action: pan-y) and the slider stays as it was. A tap puts
        // it where tapped. Let go, a new value is kept (`change`).
        let sliding = null;
        const follow = (s, x) => {
            const r = s.track.getBoundingClientRect(), share = (x - r.left - KNOB) / Math.max(1, r.width - 2 * KNOB);
            const at = String(Math.round(Math.max(0, Math.min(1, share)) * Number(s.input.max)));
            if (at === s.input.value) return;
            s.input.value = at;
            s.input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        el.addEventListener('pointerdown', e => {
            const track = e.target.closest?.('[data-track]');
            if (!track || e.button > 0) return;
            const input = track.querySelector('[data-custom]');
            sliding = { id: e.pointerId, track, input, x: e.clientX, y: e.clientY, from: input.value, way: null };
            // A mouse dragged off the track still moves it.
            try { track.setPointerCapture(e.pointerId); } catch (_) { /* Not a live pointer. */ }
        });
        el.addEventListener('pointermove', e => {
            const s = sliding;
            if (!s || e.pointerId !== s.id) return;
            if (!s.way) {
                const dx = Math.abs(e.clientX - s.x), dy = Math.abs(e.clientY - s.y);
                if (Math.max(dx, dy) < gameConfig.input.sliderSlop) return;
                s.way = dx > dy ? 'side' : 'scroll';
            }
            if (s.way === 'side') follow(s, e.clientX);
        });
        el.addEventListener('pointerup', e => {
            const s = sliding;
            if (!s || e.pointerId !== s.id) return;
            sliding = null;
            if (s.way === 'scroll') return;
            if (!s.way) follow(s, e.clientX);
            if (s.input.value !== s.from) s.input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // The page took the finger for its scroll: the slider goes back.
        el.addEventListener('pointercancel', e => {
            const s = sliding;
            if (!s || e.pointerId !== s.id) return;
            sliding = null;
            if (s.input.value === s.from) return;
            s.input.value = s.from;
            s.input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return { render, stop: () => { sliding = null; } };
    }
    return { attach };
})();
