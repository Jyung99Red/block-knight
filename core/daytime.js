// The time of day (design.md 2.5): one day is world.day.seconds of play,
// light from sunrise to sunset. It is worked out from time already kept,
// so nothing new is saved: in the adventure from the seconds played
// (progress.clock, which also grows resources back -- time passed by
// sleeping, one day, would be added there), in a duel from the hour the
// host's game was at when the match began (sim.dayFrom, seconds into the
// day) and the duel's own time. Drawing only: no rule reads it.
//
// Hours run 0..24. Directions are in blocks: x east, y up, z south (the
// camera, where it first stands, looks north, screen-up on -z).
const dayKit = (() => {
    const D = () => gameConfig.day;
    const wrap = h => ((h % 24) + 24) % 24;
    // Seconds into the day -> hour.
    function hourAt(seconds) {
        return wrap(D().startHour + seconds / D().seconds * 24);
    }
    // The hour of a world, `shift` hours on (a test's ?hour, never saved).
    function hourOf(sim, shift = 0) {
        const seconds = sim.duel ? (sim.dayFrom || 0) + sim.time : sim.progress?.clock || 0;
        return wrap(hourAt(seconds) + shift);
    }
    // Seconds into the day of an hour: what a host hands its guest.
    const secondsAt = hour => wrap(hour - D().startHour) / 24 * D().seconds;

    // The look of the sky at an hour, as two of D().looks and how far from
    // the first to the second (0..1, eased): the looks are named at hours
    // round the clock, and between two the light goes from one to the next.
    function look(hour) {
        const keys = D().looks, h = wrap(hour), n = keys.length;
        // The last key at or before the hour (before the first: the last
        // of the day before), and the one after it.
        let i = n - 1;
        while (i >= 0 && keys[i][0] > h) i--;
        if (i < 0) i = n - 1;
        const [h0, from] = keys[i], [h1, to] = keys[(i + 1) % n];
        const span = wrap(h1 - h0) || 24, u = wrap(h - h0) / span;
        return { from, to, mix: u * u * (3 - 2 * u) };
    }

    // The light from the sky at an hour: the sun by day, the moon by night,
    // each on an arc from the east (rising) over the north to the west
    // (setting), `high` at its highest, never lower than `low` (its shadows
    // would run off the shadowed ground round the player). `fade` 0..1:
    // the light comes up over `fadeHours` after rising and goes down as
    // long before setting, so the one hands over to the other in the dark.
    // `dir` points towards the light.
    function sky(hour) {
        const d = D(), h = wrap(hour), day = h >= d.sunrise && h < d.sunset;
        const rise = day ? d.sunrise : d.sunset, length = day ? d.sunset - d.sunrise : 24 - (d.sunset - d.sunrise);
        const since = wrap(h - rise), u = since / length, theta = Math.PI * u;
        const arc = day ? d.sun : d.moon;
        let x = Math.cos(theta), y = Math.sin(theta) * Math.sin(arc.high), z = -Math.sin(theta) * Math.cos(arc.high);
        const low = Math.sin(arc.low);
        if (y < low) {
            const flat = Math.hypot(x, z) || 1, keep = Math.sqrt(1 - low * low) / flat;
            x *= keep; z *= keep; y = low;
        }
        const fade = Math.max(0, Math.min(1, since / d.fadeHours, (length - since) / d.fadeHours));
        return { body: day ? 'sun' : 'moon', dir: [x, y, z], fade: fade * fade * (3 - 2 * fade), day };
    }
    return { hourAt, hourOf, secondsAt, look, sky };
})();
