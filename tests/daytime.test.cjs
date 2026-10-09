// The time of day (design.md 2.5): worked out from time already kept (the
// seconds played, or a duel's start hour and its own time), the sun by day
// and the moon by night, and the sky's look between its named hours.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { dayKit, worldSim: W, gameConfig } = load();
const D = gameConfig.day;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
// (Objects made in the game's own context are not this one's.)
const plain = value => JSON.parse(JSON.stringify(value));

test('a day is day.seconds of play; a new game starts at startHour', () => {
    assert.equal(D.seconds, 1200, '20 minutes (user)');
    assert.deepEqual([D.sunrise, D.sunset], [7, 19], 'light from 7 to 19 (user)');
    assert.equal(dayKit.hourAt(0), D.startHour);
    assert.ok(near(dayKit.hourAt(D.seconds), D.startHour), 'round the clock in one day');
    assert.ok(near(dayKit.hourAt(D.seconds / 24), D.startHour + 1), 'an hour is a 24th of it');
    for (const h of [0, 3.5, 7, 12.25, 19, 23.9]) assert.ok(near(dayKit.hourAt(dayKit.secondsAt(h)), h), `secondsAt(${h})`);
});

test('the adventure tells the hour by the seconds played; a duel by its start hour and its own time', () => {
    const sim = W.create({ region: 'field', progress: { clock: D.seconds / 2 } });
    assert.ok(near(dayKit.hourOf(sim), (D.startHour + 12) % 24));
    for (let i = 0; i < 100; i++) W.step(sim, 0.05);
    assert.ok(near(dayKit.hourOf(sim), (D.startHour + 12 + 5 * 24 / D.seconds) % 24, 1e-6), 'the hour goes on with play');
    assert.ok(near(dayKit.hourOf(sim, 3), (dayKit.hourOf(sim) + 3) % 24), 'a shift for testing');
    const duel = W.create({ map: gameConfig.maps.arena, duel: true, dayFrom: dayKit.secondsAt(21) });
    assert.ok(near(dayKit.hourOf(duel), 21));
    for (let i = 0; i < 100; i++) W.step(duel, 0.05);
    assert.ok(near(dayKit.hourOf(duel), 21 + 5 * 24 / D.seconds, 1e-6), 'a duel\'s hour goes on with the fight');
    assert.equal(W.create({ region: 'field', dayFrom: 999 }).dayFrom, 0, 'only a duel starts at a given hour');
});

test('the sun from sunrise to sunset, the moon the rest; neither too low for its shadows; each fades in and out', () => {
    for (let h = 0; h < 24; h += 0.25) {
        const s = dayKit.sky(h), [x, y, z] = s.dir;
        assert.equal(s.body, h >= D.sunrise && h < D.sunset ? 'sun' : 'moon', `${h}`);
        assert.ok(near(Math.hypot(x, y, z), 1, 1e-9), `${h}: a direction`);
        assert.ok(y >= Math.sin(D[s.body].low) - 1e-9 && y <= Math.sin(D[s.body].high) + 1e-9, `${h}: height ${y}`);
        assert.ok(s.fade >= 0 && s.fade <= 1);
    }
    for (const h of [D.sunrise, D.sunset]) assert.equal(dayKit.sky(h).fade, 0, `${h}: the one hands over to the other in the dark`);
    assert.equal(dayKit.sky(13).fade, 1);
    assert.ok(dayKit.sky(D.sunrise + 0.5).dir[0] > 0.8 && dayKit.sky(D.sunset - 0.5).dir[0] < -0.8, 'up in the east, down in the west');
    const noon = dayKit.sky((D.sunrise + D.sunset) / 2).dir;
    assert.ok(near(noon[1], Math.sin(D.sun.high)) && noon[2] < 0, 'highest at midday, over the north: shadows fall towards the camera');
});

test('the look goes evenly from one named hour to the next, round midnight too', () => {
    for (const [h, name] of D.looks) {
        const l = dayKit.look(h);
        assert.ok(l.from === name && l.mix === 0, `${h} is ${name}`);
    }
    assert.equal(dayKit.look(12).from, 'day');
    assert.equal(dayKit.look(1).from, 'night');
    assert.ok(['dawn'].includes(dayKit.look(D.sunrise + 0.75).from) && ['dawn'].includes(dayKit.look(D.sunset - 0.75).from), 'warm light at sunrise and sunset (user)');
    // Weight of each look, hour by hour: no jumps.
    const weights = h => { const l = dayKit.look(h), w = {}; w[l.from] = (w[l.from] || 0) + 1 - l.mix; w[l.to] = (w[l.to] || 0) + l.mix; return w; };
    let last = weights(0);
    for (let h = 0.01; h < 24.005; h += 0.01) {
        const w = weights(h);
        for (const k of new Set([...Object.keys(w), ...Object.keys(last)])) assert.ok(Math.abs((w[k] || 0) - (last[k] || 0)) < 0.02, `${h.toFixed(2)} ${k}`);
        last = w;
    }
});

test('a fighter sees what the day gives by day and the night by night, and it goes over between with the light (user, 2026-10-09)', () => {
    const { day, night } = gameConfig.player.sight, seen = h => dayKit.sight(h);
    const same = (got, want, text) => assert.ok(near(got.angle, want.angle, 0.002) && near(got.near, want.near, 0.5), `${text}: ${JSON.stringify(got)}`);
    assert.deepEqual(plain(seen(12)), plain(day), 'exactly the day values at noon'); assert.deepEqual(plain(seen(0)), plain(night), 'and the night values at midnight');
    same(seen(12), day, 'noon'); same(seen(8.5), day, 'morning'); same(seen(17), day, 'afternoon');
    same(seen(23), night, 'night'); same(seen(3), night, 'small hours');
    assert.equal(dayKit.daylight(12), 1); assert.equal(dayKit.daylight(0), 0);
    // Dawn and dusk go over smoothly, one way and the other, and never past the two.
    for (const [from, to] of [[6, 8], [18.25, 20]]) {
        let last = seen(from);
        for (let k = 1; k <= 200; k++) {
            const now = seen(from + (to - from) * k / 200), up = to > from && from < 12;
            const sign = up ? 1 : -1;
            assert.ok(sign * (now.angle - last.angle) >= -1e-9 && sign * (now.near - last.near) >= -1e-9, 'one way');
            assert.ok(now.angle >= night.angle - 1e-9 && now.angle <= day.angle + 1e-9 && now.near >= night.near - 1e-9 && now.near <= day.near + 1e-9, 'between the two');
            last = now;
        }
    }
    // In steps too small to see (the shade's edge is not cast anew every frame).
    assert.equal(seen(6.5).angle, seen(6.5001).angle);
});
