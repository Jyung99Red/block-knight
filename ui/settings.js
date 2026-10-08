// This phone's settings, picked on the settings page (design.md 3.6;
// ui/settings_view.js, in the menu and on the title screen): sound, the
// frame-rate line, picture quality and how far the camera stands. Kept in localStorage apart from the save (the sound in
// ui/sfx.js's own key); none of it touches the rules. `apply` hands every
// value to whoever draws it, now and on each change.
//
// Picture quality is one of gameConfig.graphics.quality, or `custom`: the
// player's own values, each one of graphics.choices (user, 2026-10-06:
// sliders, to find what this phone runs steadily). `custom` holds the
// values drawn now whatever the quality: picking a quality copies its
// values in, so the sliders show them; moving one slider keeps the others
// and makes the quality `custom` (user, 2026-10-08: no custom values of
// before are kept to come back to).
const gameSettings = (() => {
    const KEY = 'blocky-rpg-settings';
    // Each setting: its label and its choices ([value, label]), in the
    // settings page's order.
    const CHOICES = Object.freeze({
        sound: { label: '音效', options: [[true, '开'], [false, '关']] },
        perf: { label: '帧率', options: [[true, '显示'], [false, '隐藏']] },
        camera: { label: '镜头', options: [['near', '近'], ['mid', '中'], ['far', '远']] },
        quality: { label: '画质', options: [['saver', '省电'], ['high', '清晰'], ['ultra', '极高'], ['custom', '自定义']] }
    });
    const DEFAULTS = Object.freeze({ sound: true, perf: true, quality: 'high', camera: 'mid' });
    const allowed = (key, value) => CHOICES[key]?.options.some(([v]) => v === value);
    const G = gameConfig.graphics, fits = (key, value) => G.choices[key]?.includes(value);
    let values = { ...DEFAULTS, custom: { ...G.quality.high } }, listener = null;
    try {
        const kept = JSON.parse(localStorage.getItem(KEY) || '{}');
        for (const key of Object.keys(DEFAULTS)) if (allowed(key, kept?.[key])) values[key] = kept[key];
        if (values.quality === 'custom') for (const key of Object.keys(G.choices)) if (fits(key, kept?.custom?.[key])) values.custom[key] = kept.custom[key];
    } catch (_) { /* Storage unavailable or unreadable: the defaults. */ }
    if (values.quality !== 'custom') values.custom = { ...G.quality[values.quality] };
    values.sound = sfx.isEnabled();
    function changed() {
        try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (_) { /* Not kept. */ }
        listener?.(copy());
    }
    const copy = () => ({ ...values, custom: { ...values.custom } });
    function set(key, value) {
        if (!allowed(key, value)) return;
        values[key] = value;
        if (key === 'sound') sfx.setEnabled(value);
        // Custom goes on from the values drawn; a quality brings its own.
        if (key === 'quality' && value !== 'custom') values.custom = { ...G.quality[value] };
        changed();
    }
    // One of the picture's values (key of graphics.choices): the others stay
    // as drawn, and the quality is custom from now.
    function setCustom(key, value) {
        if (!fits(key, value)) return;
        values.custom[key] = value;
        values.quality = 'custom';
        changed();
    }
    // The picture quality to draw with: a quality's name, or the custom
    // values (of `v`, by default the values now).
    const quality = (v = values) => v.quality === 'custom' ? { ...v.custom } : v.quality;
    // `fn(values)` now and after every change.
    function apply(fn) { listener = fn; fn(copy()); }
    // get('custom'): the picture's values drawn now (the sliders').
    return { CHOICES, get: key => key === 'custom' ? { ...values.custom } : values[key], set, setCustom, quality, apply };
})();
