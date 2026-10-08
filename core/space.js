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
    return { toBlocks, yawOf, screenToGround, groundHeight, wrapAngle, turn, lerpAngle };
})();
