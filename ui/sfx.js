// Procedural combat sounds (Web Audio, no asset files), carried over from
// the 2D version, plus monsters noticing, enraging and falling, the end of
// a fight, and the world's: loot picked up, a chest opening, a rest, a
// building entered, a boss down or called back, a potion drunk or spilt, a torch, fire. Presentation only: the simulation never waits on or reads
// anything here. Mobile browsers keep audio locked until the first touch,
// so the context is created and resumed on the first pointer press.
const sfx = (() => {
    const key = 'pvp-game-sfx-v1';
    let ctx = null, master = null, noise = null, enabled = true;
    try { enabled = localStorage.getItem(key) !== 'off'; } catch (_) { /* Storage may be unavailable. */ }
    function unlock() {
        if (!enabled) return;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        if (!ctx) {
            ctx = new Audio();
            master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
            // One shared second of white noise feeds every noisy sound.
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    }
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
    function envelope(gain, at, peak, length) {
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    }
    function tone(type, from, to, length, peak, delay = 0) {
        const at = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(from, at);
        osc.frequency.exponentialRampToValueAtTime(to, at + length);
        envelope(gain, at, peak, length);
        osc.connect(gain).connect(master); osc.start(at); osc.stop(at + length + 0.02);
    }
    function hiss(from, to, length, peak, q = 1.2) {
        const at = ctx.currentTime, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        source.buffer = noise; filter.type = 'bandpass'; filter.Q.value = q;
        filter.frequency.setValueAtTime(from, at); filter.frequency.exponentialRampToValueAtTime(to, at + length);
        envelope(gain, at, peak, length);
        source.connect(filter).connect(gain).connect(master); source.start(at); source.stop(at + length + 0.02);
    }
    const sounds = {
        swing: heavy => heavy ? hiss(900, 260, 0.16, 0.09, 0.9) : hiss(1800, 650, 0.09, 0.06),
        enemySwing: () => hiss(700, 240, 0.14, 0.05, 0.9),
        hit: () => { tone('sine', 150, 55, 0.1, 0.22); hiss(2600, 1200, 0.04, 0.07, 0.7); },
        hurt: () => { tone('triangle', 120, 45, 0.14, 0.2); hiss(900, 400, 0.06, 0.06, 0.8); },
        block: () => { tone('triangle', 520, 470, 0.12, 0.07); tone('square', 1040, 900, 0.06, 0.025); },
        // A struck bar of iron, low and full rather than a ping: a weight
        // behind it, a ring that beats slowly against itself, one soft
        // overtone, and the strike (user, 2026-10-03).
        parry: () => {
            tone('sine', 150, 92, 0.13, 0.16);
            tone('sine', 392, 389, 0.62, 0.09); tone('sine', 396, 393, 0.5, 0.05);
            tone('sine', 1080, 1068, 0.2, 0.022);
            hiss(1500, 650, 0.04, 0.05, 1.0);
        },
        guardBroken: () => tone('sawtooth', 320, 110, 0.26, 0.05),
        cue: () => tone('sine', 880, 900, 0.08, 0.04),
        alert: () => tone('square', 520, 780, 0.07, 0.018),
        enrage: () => { tone('sawtooth', 120, 95, 0.32, 0.045); hiss(500, 300, 0.25, 0.03, 0.8); },
        fallen: () => { tone('triangle', 170, 55, 0.3, 0.14); hiss(700, 200, 0.18, 0.05, 0.7); },
        win: () => { tone('sine', 660, 660, 0.16, 0.06); tone('sine', 880, 880, 0.26, 0.06, 0.14); },
        draw: () => { tone('sine', 520, 520, 0.2, 0.05); tone('sine', 520, 500, 0.3, 0.05, 0.18); },
        countdown: last => tone('sine', last ? 990 : 660, last ? 990 : 660, last ? 0.22 : 0.09, 0.05),
        lose: () => { tone('triangle', 330, 300, 0.2, 0.06); tone('triangle', 220, 180, 0.4, 0.06, 0.18); },
        pickup: gold => gold ? tone('sine', 1320, 1760, 0.07, 0.035) : tone('triangle', 880, 1100, 0.08, 0.04),
        chest: () => { hiss(500, 260, 0.2, 0.04, 0.9); tone('sine', 660, 660, 0.12, 0.05, 0.16); tone('sine', 990, 990, 0.22, 0.05, 0.26); },
        rest: () => { tone('sine', 523, 523, 0.3, 0.04); tone('sine', 659, 659, 0.3, 0.035, 0.08); tone('sine', 784, 784, 0.4, 0.035, 0.16); },
        door: () => tone('square', 300, 220, 0.06, 0.03),
        drink: () => { tone('sine', 300, 520, 0.12, 0.05); tone('sine', 520, 700, 0.14, 0.04, 0.12); },
        spill: () => hiss(1200, 500, 0.18, 0.05, 0.8),
        empty: () => tone('square', 180, 160, 0.05, 0.025),
        torch: lit => lit ? hiss(400, 1400, 0.25, 0.05, 0.6) : hiss(900, 300, 0.15, 0.03, 0.8),
        burn: () => { hiss(1500, 600, 0.5, 0.05, 0.5); hiss(300, 200, 0.6, 0.04, 1.2); },
        // Stone cracking (ore, crystal) or leaves rustling (a herb).
        gather: kind => kind === 'herb' ? hiss(2400, 1400, 0.16, 0.04, 0.5) : (tone('square', 220, 140, 0.08, 0.05), hiss(900, 400, 0.18, 0.05, 0.9), kind === 'crystal' && tone('sine', 1760, 1980, 0.18, 0.03, 0.05)),
        // A boss's grave called: a low swell and a falling call.
        call: () => { hiss(200, 900, 0.6, 0.05, 0.7); tone('sawtooth', 70, 110, 0.7, 0.05); tone('sine', 392, 262, 0.5, 0.05, 0.45); },
        boss: () => { tone('sine', 523, 523, 0.18, 0.06); tone('sine', 659, 659, 0.18, 0.06, 0.16); tone('sine', 784, 784, 0.18, 0.06, 0.32); tone('sine', 1047, 1047, 0.5, 0.06, 0.48); }
    };
    // Simulation events carry who they belong to (`side`); `selfId` is the
    // fighter this phone plays. A duel's result says who won; `outcome`
    // turns that into this phone's 'win', 'lose' or 'draw'.
    function play(e, selfId = 'player', outcome = null) {
        if (!enabled || !ctx || ctx.state !== 'running') return;
        const own = e.side === selfId;
        if (e.type === 'swing') (own ? sounds.swing(e.heavy) : sounds.enemySwing());
        else if (e.type === 'hit') (e.target === selfId ? sounds.hurt : sounds.hit)();
        else if (e.type === 'block') sounds.block();
        else if (e.type === 'parry') sounds.parry();
        else if (e.type === 'guard_broken' && own) sounds.guardBroken();
        else if (e.type === 'pause_ready' && own) sounds.cue();
        else if (e.type === 'alert') sounds.alert();
        else if (e.type === 'enrage') sounds.enrage();
        else if (e.type === 'defeated') sounds.fallen();
        else if (e.type === 'result') sounds[e.outcome || outcome]?.();
        else if (e.type === 'pickup' && own) sounds.pickup(e.item === 'gold');
        else if (e.type === 'chest_open') sounds.chest();
        else if (e.type === 'rest' && own) sounds.rest();
        else if (e.type === 'open' && own) sounds.door();
        else if (e.type === 'boss_defeated') sounds.boss();
        else if (e.type === 'grave_call') sounds.call();
        else if (e.type === 'revive') sounds.fallen();
        else if (e.type === 'drink' && own) sounds.drink();
        else if (e.type === 'drink_spilled' && own) sounds.spill();
        else if (e.type === 'potion_empty' && own) sounds.empty();
        else if ((e.type === 'torch_lit' || e.type === 'torch_out') && own) sounds.torch(e.type === 'torch_lit');
        else if (e.type === 'burn' && e.side) sounds.burn();
        else if (e.type === 'gather' && own) sounds.gather(e.kind);
    }
    // A beat of the duel's countdown; `last` is the start itself.
    function tick(last = false) { if (enabled && ctx && ctx.state === 'running') sounds.countdown(last); }
    // Sound on or off (the menu's settings), kept on this phone.
    function setEnabled(on) {
        enabled = !!on;
        try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) { /* Not kept. */ }
        if (enabled) unlock();
    }
    return { play, tick, isEnabled: () => enabled, setEnabled };
})();
