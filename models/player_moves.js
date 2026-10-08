// Key poses of the main character's moves (sparse, see core/rig.js). Each
// move has `a`, the pose at the end of its windup, and `b`, at the end of
// its swing; the recovery eases back to the stance. Timing lives in
// game_config.js (combo.moves); each weapon type has its own moves. Keys are whole-body poses: a bone a key does
// not name is at rest. The sword's A A A, `rising` and `cleave` cut on the
// diagonal, the charged cut sweeps low (design.md 4.2); no blade touches
// the ground. rx < 0 raises an arm forward; ry > 0 turns towards the
// character's left (+x); rz < 0 lifts the right arm out to the side.
const playerMoves = (() => {
    // The shield arm, carried in front, unless a key says otherwise.
    const shieldArm = { upperArmL: { rx: -0.35, ry: 0.2, rz: 0.15 }, forearmL: { rx: -0.6 } };
    const key = pose => ({ ...shieldArm, ...pose });
    const moves = {
        // Diagonal, high right down to low left (user, 2026-10-03: the
        // A A A on the diagonal, the body turning less; in the windup the
        // wrist turned so the blade leans out to the right and back). Both
        // keys are the user's own numbers from the move tuner (2026-10-04),
        // as are the backslash's, the smite's `b`, the thrust's `b`, the
        // rising cut's `a` and the follow's keys below.
        slash: {
            a: key({ chest: { ry: -0.3, rx: -0.05 }, upperArmR: { rx: -1.88, ry: -0.63, rz: -0.41 }, handR: { rx: 0.84, ry: -1.2, rz: 2.27 }, thighR: { rx: 0.3 }, shinR: { rx: 0.15 }, thighL: { rx: -0.35 }, shinL: { rx: 0.1 } }),
            b: key({ chest: { ry: 0.33, rx: 0.25 }, upperArmR: { rx: -0.85, ry: 0.6 }, forearmR: { rz: 0.25 }, handR: { rx: 1.2 }, thighR: { rx: 0.35 }, shinR: { rx: 0.15 }, thighL: { rx: -0.4 }, shinL: { rx: 0.1 } })
        },
        // Back up the same diagonal: low left to the right, at the shoulder.
        backslash: {
            a: key({ chest: { ry: 0.3, rx: 0.12 }, upperArmR: { rx: -0.85, ry: 0.6, rz: 0.1 }, forearmR: { rz: 0.3 }, handR: { rx: 1.2 }, thighR: { rx: -0.3 }, shinR: { rx: 0.1 }, thighL: { rx: 0.3 }, shinL: { rx: 0.15 } }),
            b: key({ chest: { ry: -0.3, rx: -0.05 }, upperArmR: { rx: -1.5, rz: -0.3, ry: -0.65 }, handR: { rx: 1.3 }, thighR: { rx: -0.35 }, shinR: { rx: 0.1 }, thighL: { rx: 0.35 }, shinL: { rx: 0.15 } })
        },
        // The finisher, with weight: the upper arm level, out front to the right,
        // the forearm up and the blade leaning well back to the right from
        // the wrist (the user's own numbers); then down hard to the low left,
        // on a short step (user, 2026-10-03).
        smite: {
            a: key({ chest: { ry: -0.4, rx: -0.1 }, upperArmR: { rx: -1.5, ry: -0.85 }, forearmR: { rx: -1.5 }, handR: { rx: 2.6, ry: 1.3 }, thighR: { rx: 0.2 }, shinR: { rx: 0.1 }, thighL: { rx: -0.2 }, shinL: { rx: 0.1 } }),
            b: key({ pelvis: { py: -0.06 }, chest: { ry: 0.3, rx: 0.3 }, upperArmR: { rx: -0.85, ry: 0.65 }, handR: { rx: 0.772, rz: 0.2, ry: 0.467 }, thighR: { rx: 0.3 }, shinR: { rx: 0.2 }, thighL: { rx: -0.4 }, shinL: { rx: 0.15 } })
        },
        // Straight ahead.
        thrust: {
            a: key({ chest: { ry: -0.5, rx: -0.05 }, upperArmR: { rx: -0.35, ry: 0.35 }, forearmR: { rx: -1.3 }, handR: { rx: 1.5, ry: 0.3 }, upperArmL: { rx: -0.9, ry: 0.4 }, thighR: { rx: 0.5 }, shinR: { rx: 0.2 }, thighL: { rx: -0.25 }, shinL: { rx: 0.15 } }),
            b: key({ chest: { ry: 0.25, rx: 0.28 }, upperArmR: { rx: -1.52, ry: 0.08 }, forearmR: { rx: -0.1 }, handR: { rx: 1.4 }, upperArmL: { rx: -0.2, ry: 0.3 }, thighR: { rx: 0.55 }, shinR: { rx: 0.2 }, thighL: { rx: -0.6 }, shinL: { rx: 0.3 } })
        },
        // Diagonal, low left to high right: picks up where the slash ended.
        // It starts with the wrist turned over, the tip down at the ground.
        rising: {
            a: key({ pelvis: { py: -0.08 }, chest: { rx: 0.25, ry: 0.45 }, upperArmR: { rx: -0.8, rz: 0.8, ry: -0.5 }, forearmR: { rx: 0.3 }, handR: { rx: 1.2, ry: 2.9, rz: 1.35 }, thighR: { rx: 0.45 }, shinR: { rx: 0.3 }, thighL: { rx: -0.45 }, shinL: { rx: 0.2 } }),
            b: key({ chest: { rx: -0.2, ry: -0.35 }, upperArmR: { rx: -2.45, ry: -0.55 }, handR: { rx: 1.3 }, thighR: { rx: 0.3 }, shinR: { rx: 0.15 }, thighL: { rx: -0.5 }, shinL: { rx: 0.1 } })
        },
        // Diagonal, high right to low left: picks up where the backslash ended.
        cleave: {
            a: key({ chest: { rx: -0.2, ry: -0.3 }, upperArmR: { rx: -3.05, ry: -0.5 }, handR: { rx: 1.15 }, thighR: { rx: 0.3 }, shinR: { rx: 0.15 }, thighL: { rx: -0.5 }, shinL: { rx: 0.1 } }),
            b: key({ pelvis: { py: -0.08 }, chest: { rx: 0.35, ry: 0.35 }, upperArmR: { rx: -0.6, ry: 0.65 }, handR: { rx: 1.45 }, thighR: { rx: 0.5 }, shinR: { rx: 0.3 }, thighL: { rx: -0.7 }, shinL: { rx: 0.25 } })
        },
        // The opening B: the arm raised as for the A A A's last cut, but the
        // blade laid back over the shoulder; then a wide, low sweep round
        // from the right to the left, like a scythe through straw (user,
        // 2026-10-03).
        charged: {
            a: key({ pelvis: { py: -0.1 }, chest: { ry: -0.6, rx: -0.05 }, upperArmR: { ry: 0.2, rz: -1.45 }, forearmR: { rz: -1.5 }, handR: { ry: 2.8 }, upperArmL: { rx: -0.9, ry: 0.8 }, thighR: { rx: 0.55 }, shinR: { rx: 0.3 }, thighL: { rx: -0.45 }, shinL: { rx: 0.2 } }),
            b: key({ pelvis: { py: -0.12 }, chest: { ry: 0.5, rx: 0.1 }, upperArmR: { rx: -1.25, ry: 0.8 }, handR: { rx: 1.2 }, upperArmL: { rx: -0.4, ry: 0.1 }, thighR: { rx: 0.6 }, shinR: { rx: 0.35 }, thighL: { rx: -0.65 }, shinL: { rx: 0.25 } })
        },
        // After the charged cut: back left to right, the wrist turned at
        // the start so the blade lies out to the left.
        follow: {
            a: key({ chest: { ry: 0.35 }, upperArmR: { rx: -1.1, ry: 0.5 }, handR: { rx: 0.942, ry: 1.9, rz: 1.5 }, thighR: { rx: -0.3 }, shinR: { rx: 0.1 }, thighL: { rx: 0.3 }, shinL: { rx: 0.15 } }),
            b: key({ chest: { ry: -0.3 }, upperArmR: { rx: -1.1, ry: -0.5, rz: -0.15 }, handR: { rx: 1.1 }, thighR: { rx: -0.3 }, shinR: { rx: 0.1 }, thighL: { rx: 0.3 }, shinL: { rx: 0.15 } })
        },

        // ---- the dagger (design.md 4.2): low, tight, quick ----
        // Diagonal, high right down to low left, from a crouch.
        cut: {
            a: key({ pelvis: { py: -0.05 }, chest: { ry: -0.4, rx: 0.08 }, upperArmR: { rx: -1.75, ry: -0.6 }, handR: { rx: 1.2 }, thighR: { rx: 0.35 }, shinR: { rx: 0.25 }, thighL: { rx: -0.4 }, shinL: { rx: 0.2 } }),
            b: key({ pelvis: { py: -0.07 }, chest: { ry: 0.35, rx: 0.15 }, upperArmR: { rx: -0.85, ry: 0.55 }, handR: { rx: 1.35 }, thighR: { rx: 0.4 }, shinR: { rx: 0.25 }, thighL: { rx: -0.45 }, shinL: { rx: 0.2 } })
        },
        // Flat, back left to right at the waist.
        recut: {
            a: key({ pelvis: { py: -0.06 }, chest: { ry: 0.4, rx: 0.1 }, upperArmR: { rx: -1.15, ry: 0.6 }, handR: { rx: 1.2 }, thighR: { rx: -0.35 }, shinR: { rx: 0.2 }, thighL: { rx: 0.35 }, shinL: { rx: 0.25 } }),
            b: key({ pelvis: { py: -0.06 }, chest: { ry: -0.4, rx: 0.1 }, upperArmR: { rx: -1.15, ry: -0.65 }, handR: { rx: 1.2 }, thighR: { rx: -0.4 }, shinR: { rx: 0.2 }, thighL: { rx: 0.4 }, shinL: { rx: 0.25 } })
        },
        // Straight ahead from the hip.
        stab: {
            a: key({ pelvis: { py: -0.05 }, chest: { ry: -0.45, rx: 0.05 }, upperArmR: { rx: -0.25, ry: 0.3 }, forearmR: { rx: -1.4 }, handR: { rx: 1.5, ry: 0.25 }, thighR: { rx: 0.45 }, shinR: { rx: 0.25 }, thighL: { rx: -0.3 }, shinL: { rx: 0.15 } }),
            b: key({ pelvis: { py: -0.08 }, chest: { ry: 0.2, rx: 0.2 }, upperArmR: { rx: -1.45, ry: 0.06 }, handR: { rx: 1.57 }, upperArmL: { rx: 0.1, ry: 0.2 }, thighR: { rx: 0.6 }, shinR: { rx: 0.3 }, thighL: { rx: -0.65 }, shinL: { rx: 0.35 } })
        },
        // A low whirl, right round to the left: about half a turn.
        whirl: {
            a: key({ base: { ry: -0.45 }, pelvis: { py: -0.1 }, chest: { ry: -0.3, rx: 0.15 }, upperArmR: { rx: -1.05, ry: -0.95 }, handR: { rx: 1.25 }, thighR: { rx: 0.5 }, shinR: { rx: 0.45 }, thighL: { rx: -0.45 }, shinL: { rx: 0.35 } }),
            b: key({ base: { ry: 0.45 }, pelvis: { py: -0.1 }, chest: { ry: 0.3, rx: 0.15 }, upperArmR: { rx: -1.05, ry: 0.95 }, handR: { rx: 1.25 }, thighR: { rx: 0.5 }, shinR: { rx: 0.45 }, thighL: { rx: -0.45 }, shinL: { rx: 0.35 } })
        },
        // The finisher: the blade hand up over the head and straight down;
        // the other arm stays low, a little out for balance (user, 2026-10-02).
        drop: {
            a: key({ chest: { rx: -0.3 }, head: { rx: -0.1 }, upperArmR: { rx: -2.95, ry: -0.15 }, handR: { rx: 1.0 }, upperArmL: { rx: -0.6, ry: 0.3, rz: 0.25 }, forearmL: { rx: -0.7 }, thighR: { rx: 0.25 }, shinR: { rx: 0.15 }, thighL: { rx: -0.35 }, shinL: { rx: 0.1 } }),
            b: key({ pelvis: { py: -0.14 }, chest: { rx: 0.45 }, upperArmR: { rx: -0.75, ry: 0.1 }, handR: { rx: 1.35 }, upperArmL: { rx: -0.3, ry: 0.2, rz: 0.3 }, thighR: { rx: 0.55 }, shinR: { rx: 0.55 }, thighL: { rx: -0.75 }, shinL: { rx: 0.45 } })
        },
        // Low left up to high right, quick and short.
        flick: {
            a: key({ pelvis: { py: -0.08 }, chest: { rx: 0.25, ry: 0.4 }, upperArmR: { rx: -0.45, rz: 0.7 }, forearmR: { rx: -0.3 }, handR: { rx: 0.95 }, thighR: { rx: 0.45 }, shinR: { rx: 0.35 }, thighL: { rx: -0.45 }, shinL: { rx: 0.2 } }),
            b: key({ chest: { rx: -0.15, ry: -0.3 }, upperArmR: { rx: -2.2, ry: -0.5 }, handR: { rx: 1.3 }, thighR: { rx: 0.3 }, shinR: { rx: 0.15 }, thighL: { rx: -0.45 }, shinL: { rx: 0.1 } })
        },
        // The opening B: coiled low, then springing forward into a stab.
        lunge: {
            a: key({ pelvis: { py: -0.14 }, chest: { rx: 0.25, ry: -0.35 }, upperArmR: { rx: -0.2, ry: 0.3 }, forearmR: { rx: -1.5 }, handR: { rx: 1.5, ry: 0.25 }, upperArmL: { rx: -0.6, ry: 0.3 }, thighR: { rx: 0.65 }, shinR: { rx: 0.5 }, thighL: { rx: -0.35 }, shinL: { rx: 0.4 } }),
            b: key({ pelvis: { py: -0.1 }, chest: { rx: 0.3, ry: 0.15 }, upperArmR: { rx: -1.52, ry: 0.05 }, handR: { rx: 1.57 }, upperArmL: { rx: 0.35, rz: 0.2 }, thighR: { rx: 0.7 }, shinR: { rx: 0.3 }, thighL: { rx: -0.85 }, shinL: { rx: 0.35 } })
        },
        // Jumping back with a cut right to left across the front.
        retreat: {
            a: key({ pelvis: { py: -0.05 }, chest: { ry: -0.4, rx: 0.05 }, upperArmR: { rx: -0.95, ry: -0.6 }, handR: { rx: 1.3 }, thighR: { rx: -0.25 }, shinR: { rx: 0.15 }, thighL: { rx: 0.3 }, shinL: { rx: 0.25 } }),
            b: key({ pelvis: { py: -0.05 }, chest: { ry: 0.4, rx: -0.05 }, upperArmR: { rx: -0.95, ry: 0.6 }, handR: { rx: 1.3 }, thighR: { rx: -0.35 }, shinR: { rx: 0.25 }, thighL: { rx: 0.45 }, shinL: { rx: 0.35 } })
        }
    };
    return Object.freeze({
        moves,
        // What `key` adds to every move key (the move tuner, tune/lab.js,
        // writes a key back as `key({...})` without it).
        shieldArm,
        // Shield up: the left forearm across the front, the board facing
        // forward; the sword arm drawn back; the body bent forward a little
        // at the waist and turned to put the shield's shoulder ahead, the
        // head up and to the front. Upper body only: the legs are
        // guardLegs / guardBend. The user's numbers from the move tuner
        // (2026-10-05).
        guard: {
            chest: { rx: 0.2, ry: -0.15 }, head: { rx: -0.2, ry: 0.15 },
            upperArmL: { rx: -1.55, ry: -0.4, rz: 0.1 }, forearmL: { rz: -0.8 }, handL: { ry: -0.3 },
            upperArmR: { rx: -0.2, rz: -0.25 }, forearmR: { rx: -0.7 }, handR: { rx: 1.0, ry: -0.3 }
        },
        // A perfect parry shoves the blow back (user, 2026-10-05): the
        // guard goes out to this and comes back (combat.guard.shove). The
        // body leans in and the board goes forward, upright, turning
        // square to the front (the user's numbers from the move tuner).
        guardShove: {
            chest: { rx: 0.35, ry: -0.2 }, head: { rx: -0.3, ry: 0.2 },
            upperArmL: { rx: -1.78, ry: -0.4, rz: 0.5 }, forearmL: { rz: -1.15 }, handL: { ry: -0.3, rz: -0.3 },
            upperArmR: { rx: -0.55, rz: -0.25 }, forearmR: { rx: -0.7 }, handR: { rx: 1.0, ry: -0.3 }
        },
        // Guarding with the weapon (no shield carried): the blade held
        // across the chest, edge out, tip to the left, the body bent
        // forward as under the shield. The right arm only (turned to keep
        // the blade as the lean found it): the left keeps whatever it
        // carries.
        guardWeapon: {
            chest: { rx: 0.3, ry: -0.36 }, head: { rx: -0.2 },
            upperArmR: { rx: -0.69, ry: 0.96, rz: -1.11 }, forearmR: { rx: -0.71 }, handR: { rx: 0.05, ry: 0.8, rz: 0.5 }
        },
        // The weapon guard's shove after a perfect parry: the blade hand
        // pushed forward, the blade still across.
        guardWeaponShove: {
            chest: { rx: 0.4, ry: -0.12 }, head: { rx: -0.28 },
            upperArmR: { rx: -0.88, ry: 1.1, rz: -1.44 }, forearmR: { rx: -0.43 }, handR: { rx: 0.05, ry: 0.8, rz: 0.5 }
        },
        // The legs under either guard: a squat for a steady centre, both
        // knees bent forward, the feet side by side and a little apart, both
        // down (the user's numbers from the move tuner, 2026-10-05; the right
        // foot 0.008 blocks short of the ground, not seen). Standing, the
        // legs are guardLegs; walking, the stride goes on with guardBend
        // added, the knees kept bent.
        guardLegs: { thighR: { rx: -0.45, ry: -0.1 }, shinR: { rx: 0.5 }, thighL: { rx: -0.5, ry: 0.15 }, shinL: { rx: 0.65 } },
        guardBend: { thighR: { rx: -0.2 }, shinR: { rx: 0.4 }, thighL: { rx: -0.2 }, shinL: { rx: 0.4 } },
        // Drinking a potion: the flask up to the mouth, the head tipped
        // back. Upper body only: legs keep walking underneath.
        drink: {
            chest: { rx: -0.08 }, head: { rx: -0.45 },
            upperArmL: { rx: -1.35, ry: -0.75, rz: 0.2 }, forearmL: { rx: -1.65 }, handL: { rx: -0.3 },
            upperArmR: { rx: -0.1, rz: -0.15 }, forearmR: { rx: -0.6 }, handR: { rx: 0.95, ry: -0.2 }
        },
        // Carrying a torch: held up and forward on the left.
        torch: { upperArmL: { rx: -0.55, ry: 0.15, rz: 0.1 }, forearmL: { rx: -1.05 } },
        // Interacting, the same for every interaction for now (user,
        // 2026-10-04): the left hand a little forward, the chest leaning in
        // and turned a little to the right (the user's numbers, move tuner).
        reach: { chest: { rx: 0.15, ry: -0.2 }, upperArmL: { rx: -0.7, ry: 0.1, rz: 0.08 }, forearmL: { rx: -0.45 } },
        // Struck: thrown back; added on top, faded by the stun.
        flinch: { chest: { rx: -0.35 }, head: { rx: -0.25 }, upperArmR: { rz: -0.3 }, upperArmL: { rz: 0.3 } },
        // Fallen: on the back, arms flung out.
        down: { base: { rx: -1.45 }, chest: { rx: -0.1 }, head: { rx: -0.25 }, upperArmR: { rx: -0.3, rz: -1.1 }, forearmR: { rx: -0.3 }, upperArmL: { rx: -0.3, rz: 1.1 }, forearmL: { rx: -0.3 }, thighR: { rx: -0.25 }, shinR: { rx: 0.4 }, thighL: { rx: 0.1 }, shinL: { rx: 0.2 } }
    });
})();
