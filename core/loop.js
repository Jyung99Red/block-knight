// Fixed-step clock: real frame time in, whole simulation steps out. A long
// frame (a background tab, a slow phone) is capped so the game slows down
// instead of jumping (roadmap.md 4.1).
const simLoop = (() => {
    const STEP = 0.01, MAX_FRAME = 0.1;
    function create(stepFn, { step = STEP, maxFrame = MAX_FRAME } = {}) {
        let carry = 0;
        return {
            step,
            // Feed `seconds` of real time; runs and returns the steps due.
            advance(seconds) {
                carry += Math.min(Math.max(0, seconds), maxFrame);
                let n = 0;
                while (carry >= step - 1e-9) { stepFn(step); carry -= step; n++; }
                return n;
            },
            // How far real time has run into the next step, 0..1: drawing
            // blends the last two states by this so motion stays even.
            alpha() { return Math.min(1, carry / step); },
            // Real time fed in and not yet run as a step, seconds.
            get carry() { return carry; },
            // Run exactly `seconds` of simulation now (tests, debugging).
            run(seconds) {
                const n = Math.round(seconds / step);
                for (let i = 0; i < n; i++) stepFn(step);
                return n;
            },
            // Start afresh, `left` seconds into the next step (a duel's guest
            // keeps its place in time across a snapshot).
            reset(left = 0) { carry = Math.min(step, Math.max(0, left)); }
        };
    }
    return { STEP, MAX_FRAME, create };
})();
