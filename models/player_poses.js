// Key poses of the main character (sparse; see core/rig.js). Animation logic
// lives in core/player_anim.js. Angles in radians: rx > 0 tips a limb
// backwards (a thigh) or bends it (a shin, or a hand towards the palm).
const playerPoses = Object.freeze({
    // Standing, sword forward and low, shield on the left forearm; both
    // boots flat (user, 2026-10-09: the ankle turned back as far as the leg
    // tips it).
    stance: {
        chest: { rx: 0.04 },
        upperArmR: { rx: -0.15, rz: -0.1 }, forearmR: { rx: -0.55 }, handR: { rx: 0.95, ry: -0.2 },
        upperArmL: { rx: -0.1, rz: 0.12 }, forearmL: { rx: -0.5 },
        thighR: { rx: -0.08 }, shinR: { rx: 0.12 }, footR: { rx: -0.04 },
        thighL: { rx: 0.1 }, shinL: { rx: 0.08 }, footL: { rx: -0.18 }
    },
    // A gait cycle is two steps: the keys of the right foot's step, evenly
    // spaced, then the same mirrored for the left. Key 0 is the right foot
    // coming down. `legs` replaces the lower body; `arms` (mirrored too) and
    // `carry` (the sword arm's hold, not mirrored) are added to the upper
    // body. The stride is measured from the legs, and the keys are timed
    // along it, so feet do not slide whatever the angles
    // (core/player_anim.js).
    // Walking, a light jog at the walking speed (user, 2026-10-20; was a
    // walk of contact and passing): touchdown, mid-stance, toe-off, then
    // both feet a little off the ground; shorter strides than the run's,
    // the elbows bent.
    walk: {
        legs: [
            { pelvis: { ry: 0.06 }, thighR: { rx: -0.48 }, shinR: { rx: 0.25 }, thighL: { rx: 0.48 }, shinL: { rx: 1.1 } },
            { thighR: { rx: -0.12 }, shinR: { rx: 0.38 }, thighL: { rx: -0.25 }, shinL: { rx: 1.55 } },
            { pelvis: { ry: -0.03 }, thighR: { rx: 0.52 }, shinR: { rx: 0.08 }, thighL: { rx: -0.66 }, shinL: { rx: 1.0 } }
        ],
        arms: [
            { chest: { rx: 0.1, ry: -0.08 }, upperArmR: { rx: 0.3 }, upperArmL: { rx: -0.34 }, forearmL: { rx: -0.25 } },
            { chest: { rx: 0.1 } }
        ],
        carry: { forearmR: { rx: -0.4 }, handR: { rx: -0.3 } },
        flight: { height: 0.03 }
    },
    // Running, a jog (user, 2026-10-02): touchdown, mid-stance (the knee
    // gives), toe-off; from the toe-off to the other foot's touchdown both
    // feet are off the ground, the body `flight.height` (blocks) up at
    // most. The sword is carried with the elbow bent and the blade up, clear
    // of the ground.
    run: {
        legs: [
            { pelvis: { ry: 0.08 }, thighR: { rx: -0.65 }, shinR: { rx: 0.25 }, thighL: { rx: 0.6 }, shinL: { rx: 1.35 } },
            { thighR: { rx: -0.2 }, shinR: { rx: 0.45 }, thighL: { rx: -0.4 }, shinL: { rx: 1.9 } },
            { pelvis: { ry: -0.04 }, thighR: { rx: 0.72 }, shinR: { rx: 0.08 }, thighL: { rx: -0.85 }, shinL: { rx: 1.15 } }
        ],
        arms: [
            { chest: { rx: 0.14, ry: -0.1 }, upperArmR: { rx: 0.4 }, upperArmL: { rx: -0.45 }, forearmL: { rx: -0.35 } },
            { chest: { rx: 0.14 } }
        ],
        carry: { forearmR: { rx: -0.55 }, handR: { rx: -0.45 } },
        flight: { height: 0.09 }
    },
    // The feet in a move (core/player_anim.js): a foot that steps is lifted
    // `liftPerBlock` of the step's length, `lift` blocks at most; where a
    // foot cannot reach the ground the hips go down, `sink` blocks at most.
    feet: { lift: 0.09, liftPerBlock: 0.35, sink: 0.12 },
    // Breathing while idle; drawn only, never part of a hit test.
    breath: { rate: 2.2, chest: 0.012, head: -0.008, arms: 0.02 }
});
