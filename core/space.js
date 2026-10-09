// The one place where simulation coordinates meet 3D and screen
// coordinates (design.md 2.2).
// - Simulation: ground position (x, y) in world units, y grows towards the
//   bottom of the screen; height h; facing theta, 0 = +x, pi/2 = +y.
// - 3D (blocks): (x, h, y) / unitsPerBlock, no flip, so screen-up is -z.
// - A model faces its own +z, so its yaw about the vertical is pi/2 - theta.
const space = (() => {
    const unit = () => gameConfig.world.unitsPerBlock;
    function toBlocks(x, y, h = 0) { const u = unit(); return [x / u, h / u, y / u]; }
    function yawOf(facing) { return Math.PI / 2 - facing; }
    // A screen direction (sx right, sy down) to a ground direction, for a
    // camera orbiting at `yaw` (0: camera due south, looking north).
    function screenToGround(sx, sy, yaw = gameConfig.camera.yaw) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        return { x: c * sx + s * sy, y: -s * sx + c * sy };
    }
    // ---- the camera's picture on the ground (render/world_view.js) ----
    // What a camera shows round the point it looks at, on the ground: the
    // camera stands `distance` blocks off, `pitch` above the horizon, and looks
    // at the point `lookHeight` over the ground (`fov` the vertical field in
    // degrees). All in blocks. `right`: half the picture's width at the
    // depth of that point; `wide`: half its width at its far edge, where it
    // is widest; `ahead` and `behind`: how far its ground goes beyond that
    // point and short of it, along the camera's direction.
    function sight({ pitch, fov, aspect, distance, lookHeight }) {
        const half = fov * Math.PI / 360, high = lookHeight + Math.sin(pitch) * distance, back = Math.cos(pitch) * distance;
        // (A top edge level with the horizon would show ground without end.)
        const top = Math.max(0.1, pitch - half);
        return {
            right: Math.tan(half) * aspect * distance,
            wide: aspect * high * Math.sin(half) / Math.sin(top),
            ahead: high / Math.tan(top) - back,
            behind: Math.max(0, back - high / Math.tan(pitch + half))
        };
    }
    // A ground offset (x, z) as the picture sees it, `yaw` round: along its
    // width (to the right) and along its depth (away from the camera).
    const acrossOf = (x, z, yaw) => x * Math.cos(yaw) - z * Math.sin(yaw);
    const alongOf = (x, z, yaw) => -x * Math.sin(yaw) - z * Math.cos(yaw);
    // Where a camera that follows a body at `at` ([x, z]) looks. It looks at
    // the body, except near the edge of the ground bodies can come to
    // (`reach`: [x0, z0, x1, z1], terrainKit.reachOf): the picture, as
    // `view` (`sight`, each side cut at `far`) gives it round the point
    // looked at, may show only `edge` blocks past that, so the body at the
    // edge stands `edge` blocks short of the picture's, and what lies beyond
    // the ground is not shown. Ground too small for that along one axis is
    // looked at from its middle. Whichever way the camera is turned the body
    // is never left nearer the picture's edge than `edge`.
    function holdCamera(at, yaw, view, { reach, edge, far = Infinity }) {
        const right = Math.min(far, view.right), ahead = Math.min(far, view.ahead), behind = Math.min(far, view.behind);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        // The picture's corners about the point looked at, as offsets on the ground.
        const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
        for (const u of [-right, right]) for (const f of [-behind, ahead]) {
            const o = [c * u - s * f, -s * u - c * f];
            for (let i = 0; i < 2; i++) { low[i] = Math.min(low[i], o[i]); high[i] = Math.max(high[i], o[i]); }
        }
        // The picture lies inside the ground and `edge` round it when the
        // point looked at lies in a box: the point of it nearest to the body.
        const hold = (v, i) => {
            const from = reach[i] - edge - low[i], to = reach[i + 2] + edge - high[i];
            return from > to ? (from + to) / 2 : Math.min(to, Math.max(from, v));
        };
        const x = hold(at[0], 0), z = hold(at[1], 1);
        // Where the body stands in the picture, kept `edge` short of its sides.
        const across = acrossOf(at[0] - x, at[1] - z, yaw), along = alongOf(at[0] - x, at[1] - z, yaw);
        const sideways = Math.max(0, right - edge), up = Math.max(0, ahead - edge), down = Math.max(0, behind - edge);
        const u = Math.max(-sideways, Math.min(sideways, across)), f = Math.max(-down, Math.min(up, along));
        if (u === across && f === along) return [x, z];
        return [at[0] - (c * u - s * f), at[1] - (-s * u - c * f)];
    }
    // Can light from (x, z) that reaches `radius` blocks fall on the picture
    // whose middle is `look` ([x, z]), turned `yaw`, and as wide, deep and
    // long as `view` (`sight`)? (A box round the picture, not the picture.)
    function pictureReaches(look, yaw, view, x, z, radius) {
        const across = Math.abs(acrossOf(x - look[0], z - look[1], yaw)), along = alongOf(x - look[0], z - look[1], yaw);
        const gapAcross = Math.max(0, across - view.wide), gapAlong = along > view.ahead ? along - view.ahead : along < -view.behind ? -view.behind - along : 0;
        return gapAcross * gapAcross + gapAlong * gapAlong <= radius * radius;
    }
    // The ground position under a body: the simulation's only source of
    // "where the floor is". Flat for now (design.md 2.2).
    function groundHeight(/* x, y */) { return 0; }
    function wrapAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
    // Turn `from` towards `to` by at most `maxStep` radians.
    function turn(from, to, maxStep) {
        const delta = wrapAngle(to - from);
        return Math.abs(delta) <= maxStep ? to : wrapAngle(from + Math.sign(delta) * maxStep);
    }
    // Angle part way from a to b along the short way round.
    function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
    return { toBlocks, yawOf, screenToGround, sight, holdCamera, pictureReaches, groundHeight, wrapAngle, turn, lerpAngle };
})();
