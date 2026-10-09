// Every tunable number of the game, and nothing else. Units: world units
// (40 to a block) for positions, distances and speeds; seconds for time;
// radians for angles; CSS pixels for anything on the touch layer.
// docs/parameters.md mirrors this file.
const gameConfig = (() => {
    // The move tuner (tune.html) changes move timing live, so its page asks
    // for the table unfrozen; the game and the tests always freeze it.
    const freeze = value => {
        if (globalThis.unfrozenConfig === true) return value;
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    return freeze({
        // 1. Scale. A block is 40 world units; the simulation keeps world
        // units so distances read the same as in the 2D version.
        world: { unitsPerBlock: 40 },

        // 2. The main character on foot.
        // speed: walking, world units/second at full stick. turnRate:
        // radians/second while turning towards the stick. radius: wall
        // collision. startSeconds: from a standstill to full walking speed.
        // turnSlow: walking straight away from the facing is this share
        // slower (easing with the angle) until the body has turned.
        // Running: after `runAfter` seconds of unbroken walking
        // with the stick pushed at least `runStick` of the way, speed eases up
        // to runSpeed over runRampSeconds (set apart from the walk, user
        // 2026-10-02: changing one leaves the other), and back down the same
        // way once the walk is broken (stick eased off or released, a wall).
        // sight: what the body sees, by day and by night (the hour's own,
        // between the two as the light goes over: core/daytime.js `sight`;
        // user, 2026-10-09: it was 75 degrees and 100 all day). `angle`: it
        // sees only what lies within this of where it faces, either side
        // (by day 60 degrees: the front 120; by night 45: the front 90),
        // and not past blocks at least eye high; the rest of the ground is
        // shaded, with the blocks and plants on it (user, 2026-10-05), and
        // a monster or a rival there is not drawn (user, 2026-10-04: the
        // same in the adventure and in a duel). `near`: world units round
        // the body it sees whichever way it faces, a little behind it too
        // (by day two and a half blocks: user, 2026-10-06, it was two; by
        // night one and a half); walls hide there as well.
        player: {
            speed: 122, turnRate: 8, radius: 12, runAfter: 1.5, runSpeed: 252, runRampSeconds: 0.3, runStick: 0.9, startSeconds: 0.12, turnSlow: 0.5,
            sight: { day: { angle: Math.PI / 3, near: 100 }, night: { angle: Math.PI / 4, near: 60 } }
        },

        // 3. Animation. blendSeconds: idle <-> walk cross-fade.
        animation: { blendSeconds: 0.1 },

        // 4. Sizes that will decide hits (design.md 4.3). The
        // body boxes themselves are model data in models/; these scale it.
        // playerScale multiplies the whole character. Blade lengths are on
        // the weapons (`items`, blocks).
        models: { playerScale: 1 },

        // 4b. Fighting rules shared by every fight (training, PVE, PVP).
        // fighters.base: the main character's stats before equipment (no
        // levels: equipment is the only growth, design.md 7.1); each
        // item worn adds its own (`items`). The starter gear makes 360 HP,
        // 30 ATK, 8 DEF; a duel is always fought in it.
        // hitStun: a hit that is not guarded freezes the one struck's
        // controls this long. weaponPad: weapon boxes grow by this much on
        // every side for hit tests only (design.md 4.3).
        // Damage = max(1, round(raw * (1 - DEF / (DEF + defenseConstant)))).
        // A blocked hit does the guard's blockMultiplier of that (`guard`);
        // a perfect parry hits back for atk * parryAtkRatio. Impact: on contact both fighters'
        // clocks stop for `hitstop`; then the one struck is pushed
        // `knockback` units over knockbackSeconds. Player moves carry their
        // own knockback in the combo table; these are for hits on the
        // player, blocks and parries. Stagger: points from moves (and
        // `parry`) fill to `threshold`, then the target reels `duration`.
        combat: {
            fighters: { base: { maxHp: 340, atk: 22, def: 4 } },
            hitStun: 0.35, weaponPad: 8,
            damage: { defenseConstant: 17.5, parryAtkRatio: 0.5 },
            impact: { hitstop: { hit: 0.06, block: 0.04, parry: 0.08 }, knockback: { hit: 10, block: 5, parry: 8 }, knockbackSeconds: 0.12 },
            stagger: { threshold: 3, duration: 1.5, parry: 1 },
            // The opening B: held past its windup it charges. Charge time
            // counts from the press; damage grows from `threshold` to `full`
            // seconds. While charging the body walks and turns slower.
            charge: { threshold: 0.3, full: 2.3, moveMultiplier: 0.6, turnMultiplier: 0.65 },
            // The guard key: guarding is the defence, there is no dodge
            // (user, 2026-10-03). `startup` from press to up; only hits from
            // within frontAngle of facing are blocked (60 degrees either
            // side: the front 120; user, 2026-10-04, it was 180). What it guards with
            // decides the rest: the shield when one is carried, else the
            // weapon, weaker (user: shield 120, weapon 80 against the old
            // shield's 100). blockMultiplier: the share of the damage a
            // block lets through; blockCostScale: what a block costs of the
            // guard bar; a hit within parryWindow of the guard coming up is a
            // perfect parry. shove: a perfect parry pushes the shield (or
            // the weapon hand) forward, as if throwing the blow back (user,
            // 2026-10-06): first it gives -- over `in` seconds, inside the
            // hitstop, the guard is driven back, `give` of the shove's way
            // the other way, as the blow is taken; then it goes out to its
            // pose over `out` seconds, fastest at the start, and straight
            // back over `back`, three tenths of the time going out and
            // seven coming back. No going past the pose and no holding
            // there (user). A pose only: it locks nothing, and goes with
            // the guard as soon as the guard is lowered.
            guard: {
                startup: 0.16, moveMultiplier: 0.3, turnMultiplier: 0.5, frontAngle: Math.PI / 3,
                shove: { in: 0.06, give: 0.4, out: 0.1, back: 0.24 },
                shield: { blockMultiplier: 0.2, blockCostScale: 2, parryWindow: 0.22 },
                weapon: { blockMultiplier: 0.3, blockCostScale: 3, parryWindow: 0.15 }
            },
            // Guard bar (points). Raising costs raiseCost, holding drains
            // holdDrain a second, a blocked hit costs
            // raw / maxHp * blockCostScale * max (a parry parryCostRatio of
            // that). Down, it refills in refillSeconds; emptied, the guard
            // stays locked until it is back to unlockRatio.
            guardBar: { max: 100, raiseCost: 10, holdDrain: 10, parryCostRatio: 0.5, refillSeconds: 3, unlockRatio: 0.4 },
            // A potion in the offhand, drunk with the offhand key: a drink takes
            // `seconds`, walking and turning slowed meanwhile, and heals
            // `heal` of max HP at the end; a blow that gets through spills
            // it (the potion is kept). Pressed in a move or a stun, it waits
            // for that to be over.
            potion: { seconds: 0.8, heal: 0.3, moveMultiplier: 0.3, turnMultiplier: 0.5 }
        },

        // 4c. Player moves (design.md 4.1, 4.2). Every weapon belongs to a
        // weapon type (`items.*.weapon`), and the type has its own move tree:
        // `weapons.<type>.root` is what A and B start out of a combo, and
        // `standard` the distance (centre to centre, world units) every move
        // of the type must land at (tests). `moves` holds the moves of every
        // type, each naming its `weapon`; ids are unique across types.
        // Each move: windup -> swing -> recovery, seconds. Only the swing
        // hits. `derive`, counted from the swing's end, is when a buffered
        // input that `next` derives cuts the recovery short; a finisher has
        // none, and an input with no entry starts over from the root once
        // the recovery is over. `next` maps the next input -- A, B, or A
        // after a pause -- to the move it derives. ratio: damage per ATK;
        // stagger: stagger points (whole numbers, user 2026-10-02);
        // knockback: world units the target is pushed; step: how far the
        // body moves along its facing during the swing (negative: back). A
        // `charge` move grows ratio by chargeRatio and step by chargeStep
        // with its charge. Shapes and reach come from the key poses
        // (models/player_moves.js).
        // weapons.<type>.pauseAfterRecovery: the pause line after a
        // recovery ends (the sword's a little sooner, user 2026-10-02);
        // windowAfterRecovery: the chain resets this long after;
        // bufferSeconds: an input pressed ahead that has not run within this
        // long is dropped. holdSeconds: one attack key gives A and B (user,
        // 2026-10-03): let go sooner it is an A, held this long a B; a move
        // that starts at once begins that far into its windup, so telling
        // them apart costs no time. windupTurnMultiplier: in a windup the
        // stick turns the body at this share of player.turnRate; the swing
        // locks the facing and the recovery does not turn (user,
        // 2026-10-02).
        combo: {
            windowAfterRecovery: 0.7, bufferSeconds: 0.5, holdSeconds: 0.2, windupTurnMultiplier: 1 / 3,
            weapons: {
                // Heavy and far-reaching: everything a beat slower than the dagger.
                sword: { name: '剑', root: { a: 'slash', b: 'charged' }, standard: 60, pauseAfterRecovery: 0.15 },
                // Quick and close: chains up to six moves; B inside a combo flicks and goes on.
                dagger: { name: '短刃', root: { a: 'cut', b: 'lunge' }, standard: 48, pauseAfterRecovery: 0.2 }
            },
            moves: {
                slash: { weapon: 'sword', name: '斜斩', windup: 0.13, swing: 0.10, recovery: 0.32, derive: 0.15, ratio: 0.36, stagger: 0, knockback: 0, step: 3, next: { a: 'backslash', b: 'rising' } },
                backslash: { weapon: 'sword', name: '回扫', windup: 0.13, swing: 0.10, recovery: 0.39, derive: 0.17, ratio: 0.38, stagger: 0, knockback: 0, step: 3, next: { a: 'smite', b: 'cleave', pause: 'thrust' } },
                smite: { weapon: 'sword', name: '重斩', windup: 0.25, swing: 0.16, recovery: 0.55, ratio: 0.52, stagger: 0, knockback: 0, step: 8 },
                thrust: { weapon: 'sword', name: '连刺', windup: 0.30, swing: 0.08, recovery: 0.56, ratio: 0.61, stagger: 0, knockback: 0, step: 15 },
                rising: { weapon: 'sword', name: '上挑', windup: 0.38, swing: 0.12, recovery: 0.57, ratio: 0.74, stagger: 2, knockback: 16, step: 3 },
                cleave: { weapon: 'sword', name: '下劈', windup: 0.38, swing: 0.10, recovery: 0.59, ratio: 0.80, stagger: 2, knockback: 16, step: 5 },
                charged: { weapon: 'sword', name: '蓄力斩', windup: 0.54, swing: 0.14, recovery: 0.63, derive: 0.30, ratio: 0.36, chargeRatio: 0.96, stagger: 2, knockback: 20, step: 4, chargeStep: 13, charge: true, next: { a: 'follow' } },
                follow: { weapon: 'sword', name: '追斩', windup: 0.13, swing: 0.10, recovery: 0.51, ratio: 0.48, stagger: 0, knockback: 0, step: 3 },
                cut: { weapon: 'dagger', name: '斜切', windup: 0.10, swing: 0.08, recovery: 0.30, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'recut', b: 'flick' } },
                recut: { weapon: 'dagger', name: '反切', windup: 0.10, swing: 0.08, recovery: 0.32, derive: 0.12, ratio: 0.26, stagger: 0, knockback: 0, step: 4, next: { a: 'stab', b: 'flick', pause: 'retreat' } },
                stab: { weapon: 'dagger', name: '直刺', windup: 0.10, swing: 0.06, recovery: 0.34, derive: 0.13, ratio: 0.30, stagger: 0, knockback: 0, step: 10, next: { a: 'whirl', b: 'flick' } },
                whirl: { weapon: 'dagger', name: '旋刃', windup: 0.14, swing: 0.16, recovery: 0.40, derive: 0.16, ratio: 0.36, stagger: 0, knockback: 0, step: 2, next: { a: 'drop' } },
                drop: { weapon: 'dagger', name: '落刃', windup: 0.22, swing: 0.10, recovery: 0.60, ratio: 0.70, stagger: 1, knockback: 14, step: 8 },
                flick: { weapon: 'dagger', name: '挑刃', windup: 0.16, swing: 0.08, recovery: 0.36, derive: 0.14, ratio: 0.42, stagger: 1, knockback: 10, step: 4, next: { a: 'whirl' } },
                lunge: { weapon: 'dagger', name: '突刺', windup: 0.18, swing: 0.10, recovery: 0.45, derive: 0.16, ratio: 0.48, stagger: 1, knockback: 10, step: 30, next: { a: 'recut' } },
                retreat: { weapon: 'dagger', name: '退步斩', windup: 0.08, swing: 0.08, recovery: 0.40, ratio: 0.40, stagger: 0, knockback: 0, step: -26 }
            }
        },

        // 4d. Training dummy: anchored where the map puts it, never walks,
        // turns or gets pushed. It attacks its moves in turn, `delay` apart,
        // while the player is within engageRange. radius: body collision.
        // clubLength: blocks. flinchSeconds: how long a hit jolts it back.
        // Move times are seconds, ratio is per ATK.
        dummy: {
            name: '训练木桩', maxHp: 600, atk: 24, def: 1, radius: 14, engageRange: 120, firstDelay: 0.8, delay: 0.45, clubLength: 0.9, flinchSeconds: 0.22,
            moves: [
                { id: 'swipe', name: '快斩', windup: 1.3, swing: 0.16, recovery: 0.95, ratio: 0.6 },
                { id: 'smash', name: '重击', windup: 1.6, swing: 0.16, recovery: 1.15, ratio: 1.0 }
            ]
        },

        // 4e. Monsters (design.md 5): patrol from waypoint to waypoint
        // patrolRadius round home at patrolSpeed, resting patrolRest at
        // each; notice the player within alertRange and in sight (no block
        // two high between) and stand alert for alertSeconds; then fight
        // (design.md 5.2), turning at turnRate, walking round walls in the
        // way (`radius` decides what gap it fits through).
        // Free again (firstDelay after the alert, `delay` after a move or a
        // reel) it decides: a player more than turnFirst off its facing
        // first gets turned to; then by distance, `near` (within the reach
        // of any move of its near table, not counting its lunge), `mid`
        // (else within the reach of any move of its mid table, lunge and
        // all) or far. Far, it closes in at `speed`; near or mid it rolls
        // that band's table (move: weight), leaving out moves that do not
        // reach the player that way or are cooling down (`cooldown` seconds
        // from the windup). Light moves are quick and leave a short gap, heavy
        // ones slow with a long one (user, 2026-10-03: a wider range); every
        // gap still holds a combo, and every windup leaves time to guard.
        // `approach` walks at `speed` for up to approachSeconds or until
        // the player is near, then decides again. In the gap after a move it faces the player and
        // creeps at patrolSpeed to standOff of its near band's edge. A
        // move's reach comes from its key poses (core/monster.js), never
        // from here. During a windup the body keeps turning to the player
        // at trackTurn until `lock` seconds before the swing (a bite only
        // the last moment: it follows a step aside). Past `leash`
        // from home it walks back home, wherever the player is, and a blow
        // on the way does not turn it round (user, 2026-10-06); walking
        // home it mends returnHeal of its HP a second (user, 2026-10-06).
        // At enrage.threshold of its HP it enrages for good: damage times
        // enrage.atk, its whole clock (cooldowns too) times enrage.tempo.
        // HP is the old value times the old hpScale 3, and so is ATK, to
        // keep the old danger (the 2D version). Moves, by name (the key
        // poses of the same name, or of `pose`): seconds; ratio per ATK;
        // step: world units lunged during the swing; ram: the body itself
        // is the weapon (the wolf's leap). reactSeconds: how soon a player
        // is taken to react to a warning; only the tests read it (every
        // blow can be guarded, the guard pressed this long after the
        // warning shows: user 2026-10-03, no dodge). corpseSeconds: a
        // fallen monster lies this long, then sinks away. loot: the table
        // rolled when it falls (`loot` below). stagger: points that make it
        // reel (else combat.stagger.threshold; bosses take 10, user
        // 2026-10-02). A monster that gets home after giving up a chase is
        // whole again. pack: at most this many of the kind are in a move at
        // once (windup to recovery; user, 2026-10-03: two wolves); the
        // others wait their turn, packStandOff of their near band's edge
        // from the player. No `pack`: no limit.
        // Bosses (design.md 5): `model` is the skeleton they are
        // built on, `scale` how much bigger, `look` their colours
        // (models/); a boss down stays down and opens what waits on it.
        // `revive`: the materials its grave takes to call it back for
        // another fight (user, 2026-10-07; design.md 5): it rises out of the
        // ground at home over riseSeconds, and cannot be struck until it is
        // up; it is back till beaten again (user, 2026-10-08).
        monsters: {
            corpseSeconds: 2.5, riseSeconds: 1.2, approachSeconds: 0.8, turnFirst: Math.PI / 4, reactSeconds: 0.35, packStandOff: 1.5, returnHeal: 0.3,
            goblin: {
                name: '哥布林', loot: 'goblin', maxHp: 105, atk: 36, def: 3, radius: 12, speed: 54, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 60, patrolSpeed: 16, patrolRest: 1.4, alertRange: 150, alertSeconds: 0.5, leash: 260, standOff: 0.85,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: {
                    flail: { name: '乱挥', windup: 0.85, lock: 0.35, swing: 0.16, recovery: 1.45, ratio: 0.6, step: 8 },
                    pounce: { name: '猛扑', windup: 1.35, lock: 0.4, swing: 0.2, recovery: 2.0, ratio: 0.9, step: 36, cooldown: 5 }
                },
                near: { flail: 1 },
                mid: { pounce: 1, approach: 2 }
            },
            wolf: {
                name: '野狼', loot: 'wolf', maxHp: 90, atk: 54, def: 2, radius: 16, speed: 78, turnRate: 3, trackTurn: 1.6,
                patrolRadius: 80, patrolSpeed: 22, patrolRest: 1.0, alertRange: 180, alertSeconds: 0.4, leash: 300, standOff: 0.85, pack: 2,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: {
                    bite: { name: '撕咬', windup: 0.72, lock: 0.17, swing: 0.16, recovery: 1.1, ratio: 0.6, step: 35 },
                    leap: { name: '扑击', windup: 1.25, lock: 0.35, swing: 0.54, recovery: 2.2, ratio: 0.9, step: 150, ram: true, cooldown: 6 }
                },
                near: { bite: 1 },
                mid: { leap: 1, approach: 2 }
            },
            // The cave spider (千柱窟): low and quick on its legs, little HP.
            spider: {
                name: '洞穴蜘蛛', loot: 'spider', maxHp: 80, atk: 44, def: 2, radius: 16, speed: 70, turnRate: 3.4, trackTurn: 1.8,
                patrolRadius: 60, patrolSpeed: 20, patrolRest: 1.6, alertRange: 150, alertSeconds: 0.4, leash: 280, standOff: 0.85,
                firstDelay: 0.3, delay: 0.45, flinchSeconds: 0.22, enrage: { threshold: 0.3, atk: 1.3, tempo: 1.2 },
                moves: {
                    strike: { name: '刺足', windup: 0.8, lock: 0.3, swing: 0.14, recovery: 1.4, ratio: 0.6, step: 40 },
                    spring: { name: '跳扑', windup: 1.2, lock: 0.35, swing: 0.42, recovery: 2.2, ratio: 0.85, step: 110, ram: true, cooldown: 5 }
                },
                near: { strike: 1 },
                mid: { spring: 1, approach: 2 }
            },
            goblinChief: {
                name: '哥布林头目', model: 'goblin', scale: 1.45, look: 'chief', boss: true, loot: 'goblinChief', stagger: 10, revive: { goblin_ear: 6 },
                maxHp: 450, atk: 48, def: 5, radius: 18, speed: 50, turnRate: 2.6, trackTurn: 1.4,
                patrolRadius: 0, patrolSpeed: 16, patrolRest: 2, alertRange: 190, alertSeconds: 0.7, leash: 360, standOff: 0.85,
                firstDelay: 0.5, delay: 0.6, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.2 },
                moves: {
                    flail: { name: '横扫', windup: 0.8, lock: 0.3, swing: 0.2, recovery: 1.2, ratio: 0.6, step: 10 },
                    slam: { name: '震地', windup: 1.5, lock: 0.4, swing: 0.18, recovery: 2.4, ratio: 1.0, step: 6, cooldown: 4 },
                    pounce: { name: '猛扑', windup: 1.25, lock: 0.35, swing: 0.24, recovery: 2.2, ratio: 0.85, step: 60, cooldown: 6 }
                },
                near: { flail: 3, slam: 2 },
                mid: { pounce: 1, approach: 2 }
            },
            wolfKing: {
                name: '狼王', model: 'wolf', scale: 1.4, look: 'king', boss: true, loot: 'wolfKing', stagger: 10, revive: { wolf_pelt: 6 },
                maxHp: 420, atk: 60, def: 4, radius: 22, speed: 88, turnRate: 3, trackTurn: 1.8,
                patrolRadius: 0, patrolSpeed: 22, patrolRest: 2, alertRange: 210, alertSeconds: 0.6, leash: 380, standOff: 0.85,
                firstDelay: 0.4, delay: 0.5, flinchSeconds: 0.18, enrage: { threshold: 0.5, atk: 1.25, tempo: 1.25 },
                moves: {
                    bite: { name: '撕咬', windup: 0.85, lock: 0.12, swing: 0.16, recovery: 1.1, ratio: 0.6, step: 58 },
                    // The same bite, sooner and with a longer recovery.
                    quickBite: { name: '快咬', pose: 'bite', windup: 0.65, lock: 0.12, swing: 0.16, recovery: 1.3, ratio: 0.6, step: 58 },
                    leap: { name: '扑击', windup: 1.15, lock: 0.3, swing: 0.6, recovery: 2.3, ratio: 0.9, step: 190, ram: true, cooldown: 5 }
                },
                near: { bite: 1, quickBite: 1 },
                mid: { leap: 1, approach: 2 }
            }
        },

        // 4f. Items and loot (design.md 6.4, 7). items: everything that
        // can be carried, with its name, icon and line for the screens.
        // kind: gold | material | gear | supply. Gear goes in a `slot`
        // (main, offhand, armor, accessory) and adds its `stats`; a weapon's
        // `blade` (blocks) decides its reach (the two swords share one size,
        // only their colours differ: user 2026-10-02); an offhand item's
        // `offhand` is what it is for: a shield is what the guard key guards
        // with (the weapon guards without one), a torch or a potion is used
        // with the offhand key. An accessory's `stealth` keeps monsters
        // from noticing its wearer (user, 2026-10-06): starting an attack
        // gives the wearer away, and `cooldown` seconds with no monster in
        // a fight hide them again. `max`:
        // how many can be owned. `price`: what the shop sells it for;
        // `sell`: what it pays for one. `recipe`: what the smithy wants for
        // it (gold and materials). Gear is never lost; potions are used up.
        items: {
            gold: { kind: 'gold', name: '金币', icon: '🪙', desc: '打怪和开宝箱得来，在商店和铁匠铺花。' },
            goblin_ear: { kind: 'material', name: '哥布林耳', icon: '👂', sell: 4, desc: '哥布林掉的。铁匠铺打造要用，商店也收。' },
            wolf_pelt: { kind: 'material', name: '狼皮', icon: '🐺', sell: 6, desc: '野狼掉的。铁匠铺打造要用，商店也收。' },
            chief_tusk: { kind: 'material', name: '头目獠牙', icon: '🦷', sell: 30, desc: '哥布林头目的獠牙。能打成护符。' },
            king_fang: { kind: 'material', name: '狼王之牙', icon: '🦴', sell: 40, desc: '狼王的牙。能打成项链。' },
            iron_ore: { kind: 'material', name: '铁矿石', icon: '🪨', sell: 3, desc: '原野和山谷的铁矿石块里采来的。铁匠铺打造铁器要用。' },
            crystal: { kind: 'material', name: '晶石', icon: '💎', sell: 10, desc: '千柱窟里采来的晶石。能镶在饰品上。' },
            spider_silk: { kind: 'material', name: '蛛丝', icon: '🕸️', sell: 5, desc: '千柱窟的洞穴蜘蛛掉的。商店收。' },
            herb: { kind: 'material', name: '草药', icon: '🌿', sell: 2, desc: '野外的草药丛采来的。能编进护符，商店也收。' },
            potion: { kind: 'supply', slot: 'offhand', offhand: 'potion', name: '药水', icon: '🧪', price: 15, max: 5, desc: '放在副手。按副手键喝一口，回复三成生命；挨打会洒掉这一口（药水还在）。' },
            torch: { kind: 'gear', slot: 'offhand', offhand: 'torch', name: '火把', icon: '🔥', price: 30, max: 1, desc: '放在副手。按副手键点燃或熄灭，照亮暗处；带着它对枯木丛按交互键就能烧掉。拿着火把时只能用武器挡，也不能拿火把打。' },
            wooden_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '木剑', icon: '🗡️', stats: { atk: 8 }, blade: 0.92, max: 1, desc: '开局带着的剑。' },
            assassin_dagger: { kind: 'gear', slot: 'main', weapon: 'dagger', name: '刺客短刃', icon: '🔪', stats: { atk: 11 }, blade: 0.6, max: 1, recipe: { gold: 40, materials: { wolf_pelt: 2, iron_ore: 2 } }, desc: '短刃。比剑短，要贴得更近；出招快，连段最长六段，起手 B 是往前冲的突刺。' },
            iron_sword: { kind: 'gear', slot: 'main', weapon: 'sword', name: '铁剑', icon: '⚔️', stats: { atk: 16 }, blade: 0.92, max: 1, recipe: { gold: 80, materials: { iron_ore: 5, goblin_ear: 2 } }, desc: '和木剑一样长，铁打的刃，攻击高得多。' },
            wooden_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '木盾', icon: '🛡️', stats: { def: 2 }, max: 1, desc: '开局带着的盾。按住格挡键用盾挡，比用武器挡更稳。' },
            iron_shield: { kind: 'gear', slot: 'offhand', offhand: 'shield', name: '铁盾', icon: '🔰', stats: { def: 6 }, max: 1, recipe: { gold: 80, materials: { iron_ore: 4, wolf_pelt: 2 } }, desc: '更结实的盾。' },
            cloth_armor: { kind: 'gear', slot: 'armor', name: '布甲', icon: '👕', stats: { def: 2, maxHp: 20 }, max: 1, desc: '开局穿着的衣服。' },
            iron_armor: { kind: 'gear', slot: 'armor', name: '铁甲', icon: '🥋', stats: { def: 7, maxHp: 40 }, max: 1, recipe: { gold: 100, materials: { iron_ore: 6, wolf_pelt: 3 } }, desc: '加了肩甲和胸甲。' },
            chief_charm: { kind: 'gear', slot: 'accessory', name: '头目护符', icon: '📿', stats: { maxHp: 50 }, max: 1, recipe: { gold: 60, materials: { chief_tusk: 1, herb: 3 } }, desc: '用头目的獠牙打的护符。' },
            fang_necklace: { kind: 'gear', slot: 'accessory', name: '狼牙项链', icon: '🦷', stats: { atk: 4 }, max: 1, recipe: { gold: 60, materials: { king_fang: 1, crystal: 2 } }, desc: '用狼王的牙和晶石穿的项链。' },
            stealth_ring: { kind: 'gear', slot: 'accessory', name: '隐形戒指', icon: '💍', price: 150, max: 1, stealth: { cooldown: 5 }, desc: '戴在饰品栏。怪物察觉不到你；一出手就失效，脱战 5 秒后重新生效。' }
        },
        // What a new game starts with, worn (a duel is fought in this too).
        gear: { starter: { main: 'wooden_sword', offhand: 'wooden_shield', armor: 'cloth_armor', accessory: null } },
        loot: {
            goblin: [{ item: 'gold', chance: 1, amount: [2, 5] }, { item: 'goblin_ear', chance: 0.85, amount: [1, 2] }],
            wolf: [{ item: 'gold', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 0.9, amount: [1, 2] }],
            spider: [{ item: 'gold', chance: 1, amount: [2, 4] }, { item: 'spider_silk', chance: 0.85, amount: [1, 2] }],
            goblinChief: [{ item: 'gold', chance: 1, amount: [20, 30] }, { item: 'chief_tusk', chance: 1, amount: [1, 1] }],
            wolfKing: [{ item: 'gold', chance: 1, amount: [25, 35] }, { item: 'king_fang', chance: 1, amount: [1, 1] }],
            chiefChest: [{ item: 'gold', chance: 1, amount: [40, 60] }, { item: 'goblin_ear', chance: 1, amount: [2, 4] }, { item: 'wolf_pelt', chance: 1, amount: [1, 2] }],
            kingChest: [{ item: 'gold', chance: 1, amount: [60, 90] }, { item: 'wolf_pelt', chance: 1, amount: [3, 5] }],
            caveChest: [{ item: 'gold', chance: 1, amount: [50, 80] }, { item: 'crystal', chance: 1, amount: [2, 3] }, { item: 'wolf_pelt', chance: 1, amount: [2, 3] }],
            // The cheat chest in the village (user, 2026-10-06): gold, and
            // 20 of every material (user, 2026-10-08).
            cheatChest: [
                { item: 'gold', chance: 1, amount: [500, 500] },
                ...['iron_ore', 'wolf_pelt', 'goblin_ear', 'herb', 'crystal', 'spider_silk', 'chief_tusk', 'king_fang'].map(item => ({ item, chance: 1, amount: [20, 20] }))
            ],
            ironOre: [{ item: 'iron_ore', chance: 1, amount: [1, 2] }],
            crystal: [{ item: 'crystal', chance: 1, amount: [1, 1] }],
            herb: [{ item: 'herb', chance: 1, amount: [1, 2] }]
        },
        // Loot on the ground (world units, seconds). It pops out at
        // popSpeed[0..1] and up to popHeight over popSeconds, lies still,
        // and once restSeconds old flies to a fighter within pickupRange at
        // pullSpeed (lifting to pullHeight), picked up within
        // collectDistance. radius: wall collision while it pops.
        drops: { radius: 4, popSeconds: 0.45, popHeight: 24, popSpeed: [30, 80], restSeconds: 0.5, pickupRange: 64, pullSpeed: 280, pullHeight: 14, collectDistance: 10 },

        // 4g. The interact key (design.md 3.5). A target
        // is picked within `reach` of the fighter (world units), scored by
        // distance plus facingWeight per radian off the facing; the target
        // already picked keeps it out to `release` and scores holdBonus
        // better. chestHold: seconds the key is held to open a chest;
        // graveHold, to call a boss back at its grave.
        // hand: the left hand goes a little forward to interact (user,
        // 2026-10-04): out over `out` seconds, kept out while a hold fills
        // and `stay` seconds after a use, back over `back`.
        interact: { reach: 56, release: 72, facingWeight: 18, holdBonus: 10, chestHold: 0.6, graveHold: 1.0, hand: { out: 0.12, stay: 0.3, back: 0.2 } },
        // Props: chestRadius (a chest is solid); arriveDistance, how far
        // in front of the portal back someone arriving stands. A thicket
        // set alight sets its neighbours alight after burnSpread seconds
        // and is gone after burnSeconds. lampRadius: the post of a
        // standing torch, in the way as a chest is. A boss's grave
        // (graveRadius, solid while it shows) shows graveAfter seconds after
        // the boss falls (its body has sunk by then); called, it glows for
        // graveCall seconds before the boss rises.
        props: { chestRadius: 14, graveRadius: 14, graveAfter: 5, graveCall: 3, arriveDistance: 64, burnSpread: 0.35, burnSeconds: 1.4, lampRadius: 5 },
        // Resources (design.md 6.5): held `hold` seconds with the interact
        // key, each throws out its loot table and is gone until it grows
        // back: once regrowSeconds of play have passed, the next visit to
        // its region finds it again.
        gather: {
            regrowSeconds: 300,
            ore: { name: '铁矿', verb: '采矿', hold: 1.0, loot: 'ironOre' },
            crystal: { name: '晶石', verb: '采矿', hold: 1.2, loot: 'crystal' },
            herb: { name: '草药', verb: '采集', hold: 0.4, loot: 'herb' }
        },
        // Buildings of the base: name, the interact key's verb, and what it
        // does -- `rest` refills HP, `open` opens the building's panel.
        buildings: {
            hotSpring: { name: '温泉', verb: '泡温泉', action: 'rest' },
            smithy: { name: '铁匠铺', verb: '进入', action: 'open' },
            shop: { name: '商店', verb: '进入', action: 'open' },
            storage: { name: '仓库', verb: '进入', action: 'open' }
        },
        // The time of day (design.md 2.5; user, 2026-10-06): a day is
        // `seconds` of play (20 minutes), light from `sunrise` to `sunset`
        // (hours); a new game starts at `startHour`. looks: the sky's look
        // named at hours round the clock (render/view_light.js), the light
        // going over from one to the next between them; `dawn` is the warm
        // light of sunrise and sunset (user: the base's old morning light).
        // sun, moon: the highest and the lowest they stand above the
        // horizon (radians; lower, the shadows would run off the shadowed
        // ground round the player); fadeHours: how long each takes to come
        // up after rising, and to go down before setting.
        day: {
            seconds: 1200, startHour: 8, sunrise: 7, sunset: 19, fadeHours: 0.75,
            looks: [[6, 'night'], [7.75, 'dawn'], [9.5, 'day'], [16.5, 'day'], [18.25, 'dawn'], [20, 'night']],
            sun: { high: 1.1, low: 0.35 }, moon: { high: 0.95, low: 0.45 }
        },

        // 5. Oblique camera (design.md 1). yaw is where it stands at
        // first, 0 due south (screen-up on -z); a drag across the picture
        // takes it round the fighter from there (input.turn; user,
        // 2026-10-08). pitch is the angle down from the horizon;
        // distance and lookHeight are blocks; fov is vertical, in degrees
        // (about 58 degrees down, 30 wide and 16 away: the user's, by the
        // sliders, 2026-10-08 -- from 0.96, 34 and 13.2; a narrower, more
        // distant picture that shows about as much. The sliders stay on
        // the screen for now: ui/app.js). zoom: the
        // distance multiplier each camera setting of the menu picks.
        // edge: the camera stops following the fighter near the edge of
        // the ground it can walk to (terrainKit.reachOf), so as not to show
        // what lies past the map: the picture shows no more than this many
        // blocks beyond that ground, which puts the fighter standing at its
        // edge this far short of the picture's (user, 2026-10-09: 2 to 3).
        //
        // title: the title screen's camera (design.md 3.6; user,
        // 2026-10-08): not the fighter's; shot after shot, `seconds` each,
        // it looks at something of the region's picked at random --
        // `things`, by entity type (a lamp only when it stands), each
        // [its size, how high to look above its foot], blocks -- from a
        // side at random. At each cut the picture goes dark and comes back
        // over `fade` seconds. The shots take turns: each goes round its
        // thing by `turn` degrees, gliding evenly, its pitch (degrees down)
        // and distance (in sizes of the thing) from the first value to the
        // second. `fov`: the vertical field of view, degrees (wider than
        // the game's). `shift`: how far right of the middle the thing
        // stands, a share of the screen's width (the name and the keys are
        // on the left).
        camera: {
            yaw: 0, pitch: 1.01, distance: 16, fov: 30, lookHeight: 0.8, edge: 2.5, zoom: { near: 0.87, mid: 1, far: 1.13 },
            title: {
                seconds: 7, fade: 0.7, shift: 0.16, fov: 45,
                things: { building: [5, 1.4], portal: [3.5, 1.5], chest: [1.8, 0.5], stand: [2, 1.1], dummy: [2.4, 1] },
                shots: [
                    { turn: 30, pitch: [12, 16], distance: [2.2, 1.9] },
                    { turn: -25, pitch: [40, 34], distance: [3, 2.7] },
                    { turn: 30, pitch: [24, 18], distance: [2.6, 2.3] }
                ]
            }
        },

        // 6. Rendering cost, by the menu's picture quality (user,
        // 2026-10-06). Each quality: pixelRatio, the most device pixels
        // drawn to a CSS pixel (never more than the phone's own; high back
        // to 2 from 3, 45 frames a second on the user's phone; ultra 3,
        // down from 4: most phones' own ratio is 3 or less); sunShadow, the
        // sun's shadow map in texels a side on a small screen (short side
        // under 700 CSS px; twice that on a large one, at most 4096; never
        // off, which changed the picture's tone: user, 2026-10-06);
        // torchShadow, the torch's (it always casts them:
        // they keep its light from passing walls; user, 2026-10-06) and
        // torchTaps, the samples its soft edge takes (high 8, down from 12:
        // user, 2026-10-07); bounce, the light
        // probes' colour on or off (worked out at each corner of a face:
        // at each pixel looked the same and cost far more, so that choice
        // is gone; the block light is always on: user, 2026-10-06);
        // lampShadows, how many of the torches that stand in a map cast
        // shadows, the nearest (user, 2026-10-07; none on saver).
        // `custom` is the menu's own (user, 2026-10-06): each setting a
        // slider over its `choices`, starting from `high`. The moving
        // lights without shadows (a burning thicket, a doorway's glow,
        // someone else's torch, a standing torch) have no limit: every one
        // that can fall on the picture is lit (user, 2026-10-09; it was
        // the nearest 4).
        // shadowExtent is the half-width in blocks of the shadowed area
        // around the middle of the ground on screen. lamp: the torches that stand in a map (on a
        // stand or a wall; user, 2026-10-06), each one of the moving lights:
        // `light` of a carried torch's intensity now, `reach` blocks,
        // `decay`; `glow`, the cells its block light spreads. `shadow`:
        // the nearest of them cast shadows (the quality's lampShadows;
        // user, 2026-10-07), of walls, bodies and all but their own posts:
        // `taps`, the samples a soft edge takes; `fade`, the seconds its
        // shadows take to come and to go as it gets or loses its turn;
        // `keep`, how many blocks nearer another must be to take its turn;
        // its shadows are drawn anew while something that moves is within
        // `margin` blocks of its reach (one torch's a frame at most; a
        // fighter none of whose boxes goes `still` blocks a second is at
        // rest: it only breathes), and every `refresh` seconds whatever
        // else has changed. The sun's and the carried torch's shadows are
        // drawn anew by the same three numbers (render/view_light.js
        // `settle`): while a body moves faster than `still` (for the
        // torch's, within `margin` of its reach) or the light itself
        // has moved, and every `refresh` seconds.
        graphics: {
            quality: {
                saver: { pixelRatio: 1, sunShadow: 512, torchShadow: 128, torchTaps: 8, bounce: true, lampShadows: 0 },
                high: { pixelRatio: 2, sunShadow: 1024, torchShadow: 256, torchTaps: 8, bounce: true, lampShadows: 2 },
                ultra: { pixelRatio: 3, sunShadow: 2048, torchShadow: 512, torchTaps: 16, bounce: true, lampShadows: 2 }
            },
            choices: {
                pixelRatio: [1, 1.5, 2, 2.5, 3],
                sunShadow: [512, 1024, 2048, 4096],
                torchShadow: [128, 256, 512, 1024],
                torchTaps: [4, 6, 8, 12, 16],
                bounce: [false, true],
                lampShadows: [0, 1, 2, 3, 4]
            },
            shadowExtent: 15,
            lamp: { light: 0.5, reach: 6, decay: 1.3, glow: 6, shadow: { taps: 4, fade: 0.3, keep: 0.5, margin: 1, still: 0.3, refresh: 1 } },

            // The picture's own numbers (render/ reads them; no rule does).
            // They are here, in `graphics`, because the duel's rules
            // fingerprint leaves `graphics` out (core/duel.js `rules`):
            // tuning one does not make both phones refresh.
            //
            // looks: lighting by look: the sky's (hemisphere) and the sun's
            // (or the moon's) intensity, their colours (palette names: the
            // sky's light, the light off the ground, the sun, and the fog
            // far off), fog start and end past the camera distance
            // (blocks), the torch's intensity, and how dark the sun's
            // shadows are (1 full). By day the sun is warm and the sky's
            // light cool, so what lies in shadow turns a little blue (user,
            // 2026-10-04). The looks follow the time of day
            // (core/daytime.js, day.looks); `dawn` is sunrise and sunset,
            // the base's old morning light (user, 2026-10-06). At night the
            // moon's light is enough to see by out of doors (user; a little
            // darker since, 1.1 and 0.9 to 1.0 and 0.8: user, 2026-10-06).
            // A dark region stays `dark` whatever the hour: its sky's light
            // is enough to make out the walls and the way, and no more
            // (user, 2026-10-06: nobody gets lost there without a torch; it
            // was 0.05, all black, then 0.4). `fade`: how far colours go to
            // grey in the natural light -- the sky's, the ground's bounce,
            // the sun's or the moon's (render/terrain_mesh.js `fadeLight`);
            // a torch's light brings them back. Two numbers: for the
            // terrain and this phone's own fighter, and for every other
            // body. At night all of it a little (user, 2026-10-06: 0.2,
            // down from the first 0.3). In the dark the other bodies nearly
            // all the way: a goblin's green stood out of the gloom, a grey
            // wolf did not (user, 2026-10-06; the tone mapping takes dark
            // greys down and leaves dark colours as they are) -- this
            // phone's own fighter not, to be found.
            looks: {
                day: { sky: 1.9, sun: 2.7, colors: ['skyCool', 'groundLight', 'sunWarm', 'sky'], fog: [8, 26], torch: 3, shadow: 1, fade: [0, 0] },
                dawn: { sky: 1.7, sun: 2.9, colors: ['skyDawn', 'groundDawn', 'sunDawn', 'skyDawnBack'], fog: [8, 26], torch: 3, shadow: 1, fade: [0, 0] },
                grey: { sky: 2.2, sun: 2.0, colors: ['skyGrey', 'groundGrey', 'sunGrey', 'skyGreyBack'], fog: [8, 26], torch: 3, shadow: 1, fade: [0, 0] },
                night: { sky: 1.0, sun: 0.8, colors: ['skyNight', 'groundNight', 'moon', 'skyNightBack'], fog: [6, 22], torch: 6, shadow: 0.7, fade: [0.2, 0.2] },
                dark: { sky: 0.3, sun: 0.03, colors: ['skyLight', 'groundLight', 'sun', 'darkSky'], fog: [1, 9], torch: 9, shadow: 1, fade: [0, 0.8] }
            },
            // A region whose day looks other than `day`: grey among the rocks.
            dayLook: { valley: 'grey' },
            // sunStep: the sun's direction moves on in steps of this many
            // hours (its shadow map is snapped to whole texels, and a light
            // turning every frame would make the shadows' edges crawl).
            // sunSoft: how soft the edge of the sun's shadows is, blocks:
            // the reach of the shadow filter, the same on a small shadow
            // map as on a large one (user, 2026-10-04: soft, like the shade
            // of sight).
            sunStep: 0.05, sunSoft: 0.1,
            // A torch lights `reach` blocks round it. Its shadows (the
            // quality's torchShadow) are the torch's own, cast by blocks
            // and bodies alike; `bias` keeps a face from shadowing itself:
            // a face is shaded only by what is nearer the light by more than
            // this, as the difference of one over their distances (one over
            // blocks; a third of a block at two blocks). It is no number of
            // the shadow map's depth, which goes with `near`: with `near`
            // ten times further out and the same depth bias, the floor past
            // the square right under the light shaded itself, and that
            // square stood out bright (user, 2026-10-07).
            // Their edge is soft (user, 2026-10-06): blurred over `soft`
            // radians as seen from the light, in the quality's torchTaps
            // samples. Its light does not go with the flame, which a swing
            // pokes into a monster's body, the shadows then turning all
            // about (user, 2026-10-06): it is where the flame is while the
            // torch is only carried -- beside the bearer, outside the body
            // (which so casts its own shadow: user, 2026-10-07), turning
            // with the body and not with the arm -- and goes `follow` of
            // the flame's way from there, so the hand's movement still
            // shows a little, eased at `ease` a second. On the way out
            // from a point `height` blocks up the bearer's middle it stops
            // short of a wall, and of anyone else's body (`clear` blocks
            // wider than it). What is within `near` blocks of the light
            // casts no shadow in it: the torch and the arm that holds it,
            // which would darken the ground under the hand.
            torch: { reach: 7, decay: 1.2, bias: 0.08, normalBias: 0.02, soft: 0.03, follow: 0.35, height: 1.45, ease: 14, clear: 0.12, near: 0.5 },
            // A burning thicket's light: the flames' colour, flickering.
            fire: { intensity: 4, reach: 5, decay: 1.4, height: 0.8 },
            // In a dark region a little daylight comes in by each portal: a
            // soft light `inside` blocks in from it, so the dark does not
            // shut at the doorway (user, 2026-10-03). At night it is the
            // moon's, `night` as bright.
            doorway: { intensity: 4, reach: 6, decay: 1.4, inside: 1, height: 1.6, night: 0.4 },
            // Block light (render/terrain_light.js; user, 2026-10-06): how
            // many cells a torch's, a burning thicket's and a doorway's
            // light spreads round corners, how bright a doorway's is
            // against a torch's (`door`), and how bright it is at its
            // source for each unit of a torch's intensity now (`power`).
            // `power` was 0.16: that filled the shadow of a monster three
            // cells from the torch (user, 2026-10-06).
            glow: { torch: 8, fire: 6, doorway: 7, door: 0.5, power: 0.05 },
            // bounce: how much of the light the ground and the walls are
            // lit by they give back onto what is near (light probes; user,
            // 2026-10-06). waterSky: how bright the sky a pond gives back
            // is (the sky's own colour, paler low down), for each unit of
            // the sky's light.
            bounce: 0.7, waterSky: 0.5,
            // ghost: a fighter a ring of stealth hides (user, 2026-10-06)
            // is drawn thinned out, this share of its pixels left out.
            ghost: 0.4,
            // The shade of sight (design.md 2.5): what the fighter does not
            // see goes towards `color` (red, green, blue of 255), `opacity`
            // of the way at most (user, 2026-10-06).
            shade: { color: [5, 7, 13], opacity: 0.48 },
            // The mist under a map with a cliff: sheets of the sky's
            // colour, `step` blocks one under another.
            mist: { layers: 4, step: 0.9, opacity: 0.42 },
            // Corner shading by how many of the three cells round a corner
            // are filled (both sides, two, one, none): on the ground, and
            // the lighter one on the faces of blocks.
            corners: { ground: [0.5, 0.68, 0.84, 1], faces: [0.58, 0.74, 0.88, 1] },
            // How much sky a face sees (render/terrain_light.js; user,
            // 2026-10-06): rays per face (over the half of the sky above
            // the horizon it faces), how far they go (blocks), and how much
            // of the sky's light a face that sees no sky at all keeps.
            openSky: { rays: 16, far: 8, floor: 0.15 },
            // How far a pond's surface (`depth`) and its bed lie below the
            // ground (blocks), how dark the earth of its banks is at the
            // top and at the bed, and how dark its bed (`floor`; the
            // earth's colour under water: palette.pondBed).
            pond: { depth: 0.25, bed: 0.8, bank: [0.8, 0.45], floor: 0.9 },
            // A pond's water (user, 2026-10-06): see-through, so its bed
            // shows, most where it is looked straight down into (`opacity`
            // there, none edge on); it gives back the sky, the more the
            // more aslant it is seen (fresnel: `mirror` straight down, all
            // of it edge on); slow ripples (`waves`: [x, z, length
            // (blocks), speed, height] each) turn its face, and the sun's,
            // the moon's and a torch's light glint on it (`glint` how
            // bright, a colour value; `shine` how small); a torch's or a
            // fire's light also shows on it as a wide warm sheen (`fire`
            // how bright, `fireSpread` how narrow), where its true glint
            // would lie under the bank.
            water: { opacity: 0.55, mirror: 0.3, glint: '#484848', shine: 300, fire: 0.5, fireSpread: 6, waves: [[1, 0.35, 2.3, 0.45, 0.05], [-0.4, 1, 1.6, 0.6, 0.04], [0.7, -0.8, 0.9, 0.9, 0.02]] },
            // A cliff: blocks of earth and rock drawn down from its edge,
            // `depth` of them, each `shade` darker than the one above.
            cliff: { depth: 4, shade: 0.12 },
            // Tree crowns over a body (user, 2026-10-07): the leaves on the
            // line from it to the camera fade to `least` (of them left
            // drawn), within `reach` blocks of the line (more for a body
            // taller than the player), fading out to there. The nearer the
            // camera the leaves stand, the wider: `widen` blocks more for
            // each block they are nearer it than the body, along the ground
            // (user, 2026-10-08, the camera turning: reach up from 1.3, and
            // the trees that stand in front of the picture open wide).
            leaves: { least: 0.25, reach: 2, widen: 0.5 }
        },

        // 7. Touch and keyboard. deadZone and ramp: stick offset (CSS px)
        // below which nothing moves, and beyond which speed reaches full
        // over `ramp` more pixels. stickRadius: knob travel. maxTouches:
        // two thumbs (design.md 3.2). sliderSlop: how far a finger goes on
        // a settings slider before it is judged a sideways drag (the
        // slider moves) or a scroll (user, 2026-10-08; ui/settings_view.js).
        // turn: radians the camera goes round the fighter for each CSS px
        // a finger is dragged across the picture, a drag to the right
        // looking to the right (user, 2026-10-08).
        input: {
            deadZone: 12, ramp: 32, stickRadius: 52, maxTouches: 2, sliderSlop: 8, turn: 0.007,
            keys: {
                up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
                left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
                attack: ['KeyJ'], offhand: ['KeyK'], guard: ['KeyL'], interact: ['KeyE']
            }
        },

        // 8. Button layout (design.md 3.2). Each button's
        // centre is `x` from its `side` edge and `y` from the bottom edge,
        // both inside the safe area; `size` is the diameter. The stick
        // appears wherever the bottom-left zone (zoneWidth x zoneHeight from
        // the safe area's corner, out to the screen edges) is pressed, and
        // rests faintly at (restX, restY) from the bottom-left.
        controlsLayout: {
            minGap: 10,
            buttons: {
                attack: { side: 'right', x: 78, y: 72, size: 84 },
                offhand: { side: 'right', x: 70, y: 162, size: 72 },
                guard: { side: 'right', x: 176, y: 56, size: 72 },
                interact: { side: 'left', x: 64, y: 196, size: 56 }
            },
            stick: { zoneWidth: 250, zoneHeight: 190, restX: 120, restY: 96 }
        },

        // 9. Maps (design.md 6.3: the base, the regions, the training
        // ground, the test cave and the PVP arena). One character per block: `.` grass,
        // `:` path, `=` cobble, `;` gravel, `~` a pond (no body walks in;
        // it is seen across and struck across), `_` the drop beyond a
        // cliff's edge (the same, and nothing is drawn there), `+` a wooden
        // fence (1 high, seen over), `1`-`9` stone wall of that many
        // blocks, `T` tree, `H` a building's wall (3 high), `#` a portal's
        // pillar (3 high), `P` a portal's opening, `B` a dry thicket (2
        // high), `*` a hedge (1 high, seen over: a map's soft edge), `O` iron
        // ore and `X` crystal (1-high boulders), `h` a herb
        // (walked through), `C` a chest, `@` grass
        // where the player starts when not arriving through a portal (a
        // duel: the host on the first, the guest on the second, in reading
        // order), `D` the training dummy (facing `dummyFacing`, radians),
        // `i` a torch on a stand and `!` a torch on the wall beside its
        // cell (the wall to the north, else west, east, south; a block at
        // least 2 high), both always burning,
        // and monster homes: `g` goblin, `w` wolf, `s` cave spider, `G` the
        // goblin chief, `K` the wolf king; `B` a dry thicket (2 high, burnt
        // away by a lit torch). Rows run north (screen top) to south.
        // Next to the rows: `buildings` ({ kind, at: [col, row, width,
        // depth] over its H blocks, door: side, south by default}),
        // `portals` ({ at: [col, row] of its P, to: map, facing: the side
        // that leads into this map, requires: a boss to be down first }),
        // `chests` ({ at, loot, requires }). Someone arriving stands in front
        // of the portal that leads back. `training`: nobody falls there (an
        // emptied HP bar refills); elsewhere the player can fall. `safe`: no
        // monsters. `duel`: the map is for PVP only. `dark`: no daylight,
        // only a torch lights it (drawn). `floor`: the letter of the ground
        // the markers lie on (grass by default).
        maps: {
            // The base, a village (design.md 6.3; redrawn, 45 x 28: user,
            // 2026-10-06, kept 2026-10-07): no monsters. A wooden
            // fence on the north with the gate to the field, a rocky ridge on
            // the west, low rocks on the south, low rocks and a few trees on
            // the east with the gate to the training ground (the valley is
            // reached through the field only: user, 2026-10-04), and a gate
            // in the low rocks on the south, a lane from the spawn, to the
            // test cave (user, 2026-10-07). A cobbled
            // square in the middle, streets from it to both gates and lanes
            // to the four buildings; the spawn and the cheat chest south of
            // the square; the south-east is left open for later. Torches on
            // the walls by the doors and the gates, on stands at the
            // square's corners. Every portal goes out by the side its map
            // lies on, and comes in on the far map's opposite side (user,
            // 2026-10-04).
            base: {
                name: '曙光村', safe: true,
                rows: [
                    '4331....T.........T...:......T..........T...T',
                    '4421..........T.......:...T.......T........T.',
                    '5321..T....T..........:........T.......T.....',
                    '5321++++++++++++++++2#P#2++++++++++++++++1..T',
                    '5331................!:::!................21..',
                    '4321....HHHH...T.....:::......HHHH.......1...',
                    '54321...HHHH.........:::......HHHH......11.T.',
                    '4321....HHHH.........:::......HHHH.......12..',
                    '4331.....!:..........:::.......!:........21..',
                    '4421......:::::::::::::::::::::::.HHHH...11.T',
                    '5321.................:::..........HHHH...1...',
                    '64421...........i===========i.....HHHH...12..',
                    '54321T..........=============......!:...!21..',
                    '4321............=============:::::::::::.#1..',
                    '4321....HHHH....=============::::::::::::P1.T',
                    '4321....HHHH....=============:::::::::::.#1..',
                    '4331....HHHH....i===========i...........!21..',
                    '54421....!:..........:::.................1...',
                    '5321......::::::::::::::.................11.T',
                    '5321.................:::................11...',
                    '5331..................@..C...............1...',
                    '55331.................:..................12T.',
                    '4321..........T.......:...........T......21..',
                    '4321................!.:.!...............12..T',
                    '454311111112112111112#P#221111111211211111112',
                    '554422332222222223322222222233222222222332222',
                    '454322432333333224323333332243233333322432333',
                    '554434443354443344433544433444335444334443354'
                ],
                buildings: [
                    { kind: 'hotSpring', at: [8, 5, 4, 3] }, { kind: 'smithy', at: [30, 5, 4, 3] },
                    { kind: 'shop', at: [34, 9, 4, 3] }, { kind: 'storage', at: [8, 14, 4, 3] }
                ],
                portals: [
                    { at: [22, 3], to: 'field', facing: 'south' },
                    { at: [41, 14], to: 'clearing', facing: 'west' },
                    { at: [22, 24], to: 'grotto', facing: 'north' }
                ],
                chests: [{ at: [25, 20], loot: 'cheatChest' }]
            },
            // The first region, wide and open (the second draft of the
            // redrawn map: user, 2026-10-04): a rocky ridge on the west and
            // north, a cliff on the east, a wooden fence on the south. A pond
            // west of the middle, the road from the south gate round its
            // south shore and up to the goblin chief's walled yard in the
            // north-east (the gate to the valley and a chest). Goblins along
            // the road, wolves off it.
            field: {
                name: '晨雾原野',
                rows: [
                    '45444544454445444544566545444544465445444766676667666766___',
                    '44343333334343433333455533333343445333333656555555656565___',
                    '44223223222222232232344332232222233322322544544544444445___',
                    '54211111111111111111333211111111123111111333333#P#333333___',
                    '4431................1131.........11......3.....:.......3___',
                    '4331..................1..............T...3.....:.....C.3___',
                    '4321...23O...............................3..1..:.......3___',
                    '5321....2...............T..............T.3.....:.......3___',
                    '4321.............w.......................3......G......3___',
                    '4321.....................................3.............3___',
                    '4321.....................................3.............3___',
                    '64421......T.................h..T........3.........1...3___',
                    '654321...................................3.............3___',
                    '54321....................................3.............3___',
                    '4321....................h...............333333..33333333___',
                    '5321...................................22.....::........___',
                    '4321...........~~~............................::........___',
                    '4331..........~~~~~...........................::.......____',
                    '4331.........~~~~~~~..........................::.......____',
                    '5321.........~~~~~~~....................::::::::........___',
                    '4421.........~~~~~~~..................::::::::::........___',
                    '55331........~~~~~~~................:::::.........g..1..___',
                    '664331........~~~~~.......g...1...:::::............O....___',
                    '5421...........~~~..........1...:::::...g........1..g...___',
                    '4431..........................:::::...g............1.2.____',
                    '4331..h.........:::::::::::::::::......................____',
                    '4321...........::::::::::::::::......................._____',
                    '5321.........:::::...................................._____',
                    '4321.......:::::.......................................____',
                    '54321......:::..........................................___',
                    '4321......::........................h..............O....___',
                    '5331......::..................g.................w......____',
                    '4321......::..h...1O.................................._____',
                    '4321......::.@...................................h...._____',
                    '4321......::...................1.......................____',
                    '5321......::................1....1......................___',
                    '4321++++2#P#2++++++++++++++++++++++++++++++++++++++++++____',
                    '4331...................................................____',
                    '4331.................................................._____',
                    '5321.................................................._____'
                ],
                portals: [
                    { at: [10, 36], to: 'base', facing: 'north' },
                    { at: [48, 3], to: 'valley', facing: 'south', requires: 'goblinChief' }
                ],
                chests: [{ at: [53, 5], loot: 'chiefChest', requires: 'goblinChief' }]
            },
            // The second region, the way from the field to the cave (the
            // second draft of the redrawn map: user, 2026-10-04; no gate to
            // the village): a gravel floor between stepped ridges, a brook
            // two blocks wide down it with two fords, the road up its west bank from
            // the field's gate to the cave's, and across the brook the wolf
            // pack and the wolf king's den of rock in the north-east. The
            // east road ends where the ridge has come down: a way on, some
            // day.
            valley: {
                name: '灰岩谷', floor: ';',
                rows: [
                    '45444544454445444544454445455544454445444544454445444544',
                    '44343333334343433333343433344343434333333434333333434344',
                    '44223223222222232232232232243222222322322322322322222235',
                    '54211111#P#111111111111111133111111111111111111111111244',
                    '4431;;;;;::;;;;;;;;;;;;;;;;11;;;;;;;;;2;;;;;;;;;;;;;1234',
                    '4331;;;;;::;;;;;;;;;;;;;;;;;;;;;;;;;;;3;;;;;;;;;;C;;1244',
                    '4321;;;;;::;;;;........;;;;;;;;;;;;;;;2;;;2;;;;;;;;;1235',
                    '5321;;;;;::;;;;..~~~~..;;;;;;;;T;;;;;;2;;;;;;;;;;;;;1234',
                    '4321;;;;;::;;;;..~~~~..2O;;;;;;;;;;;;;3;;;;;;;K;;;;;1334',
                    '4321;;;;;::;;;;...~~...;;;;;;;;;;;;;;;2;;;;;;;;;;;;;1234',
                    '4321;;;;;;::;;;...~~..;;;;;;2;;;;;;;;;2;;;;2;;;;;;;;1235',
                    '5331;;;;;;::;;;..~~...;;;;;;;;;;;;;;;;3;;;;;;;;;2;;;1334',
                    '4321;;;;;;::;;;..~~..;;;;;;;;;;;;;;;;;2;;;;;;1;;;;;;1244',
                    '4321;;;g;;::;;g..~~.h.;;;;1;;;;;;;;;;;3;;;::;;;;;;;;1234',
                    '4321;;;;;;::;;;...~~..;;;;;;;;;;;;;;;;333:::222222231345',
                    '5321;;;;;;::;;;;..~~...1;;;;;;;;;;;;;;;;;:::;;;;;;;;1234',
                    '43212O;1;;::;;;;...~~..;;;;;;;;;;;;;;;;;:::;;;;;;;;;1234',
                    '54421;;;;;;::;;;;..~~...;;;;;;;;;;;;;;;:::;;;O;1;;;;1334',
                    '54431;;;;;;::;;;;...~~..;;;;;;;;;;;;h;:::;;;;;;;;;;;1235',
                    '5321;;;;;;;:::::::::::::::::::::::::::::::::::::;1123456',
                    '4421;;;;;;;:::::::::::::::::::::::::::::::::::::12123556',
                    '4421;;;;;;;;::;;;;;..~~..;;;;;;;;;;;;;;;;;;;;;;;;;;;1244',
                    '4421;;;;;;;;::;;;;;..~~...;;;;;;;;;;;;;;;;;;;;;;;;;;1235',
                    '5421;;w;;;;;::;;;;;...~~..;21;;;;;;;w;;;;;;;;2;;;;;;1244',
                    '4431;;;;;;;;::;;T;;;..~~...;;;;;;w;;;;;;;;;;;;1;;;;;1234',
                    '4331;;;;;;;::;;;;;;;...~~..h;;;;;;;;;;;;1;;;;;;;;;;;1244',
                    '54321;;;;;;::;;;;;;;;..~~..;;;;;;;;;;;2;;;;;;;;;;;;;1235',
                    '5321;;;;2;;::;;;;;;;;..~~..;;;;;;;;;;;;;;;;;;;;;;;;;1234',
                    '4321;;1;;;;:::::::::::::::::::::;;;;;;;;;;;;;;;;2;;13445',
                    '4321;.....::::::::::::::::::::::;;;;;;;;;;;;;;;;;;;12345',
                    '4321;.....::.....;;;;;..~~..;;;;;;;1;;;;;;;;O2;;;;;;1235',
                    '5331;.....::.@.h.;;;;;..~~...;;;;;;;w;;;;;;1;;;;;;;;1334',
                    '4321;.....::.....;;;;;...~~.2O;;w;;;;;;;;;;;;;;;;;;;1244',
                    '4321;.....::.....;1;;;;..~~..;;;11;;;;;;;;;;;;;;;;;;1234',
                    '432111111#P#1111112111111~~11111221111111111111111111345',
                    '5322222222222222222222222~~22222222222222222222222222234',
                    '4322222222222222222222222~~22222222222222222222222222234',
                    '4332222222222222222222222~~22222222222222222222222222334'
                ],
                portals: [
                    { at: [10, 34], to: 'field', facing: 'north' },
                    { at: [9, 3], to: 'cave', facing: 'south' }
                ],
                chests: [{ at: [49, 5], loot: 'kingChest', requires: 'wolfKing' }]
            },
            // A dark cave off the valley (design.md 2.5; redrawn, 55 x 40:
            // user, 2026-10-06, kept 2026-10-07): little to see without a
            // lit torch. One wide hall of pillars, rock coming in from its
            // walls; the gate in the south-west, two torches on stands by
            // it. The treasure room in the north-east is shut by a thicket
            // the torch burns away, a torch on the wall either side of it.
            // Three cave spiders among the pillars (user, 2026-10-07).
            cave: {
                name: '千柱窟', dark: true, floor: ';',
                rows: [
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;3333333333333333333333333333333333333333333333333;;;',
                    ';;;3333333;;;;;;33333;;;;;;;;;3333;;;;;;3;;;;;;;;;;3;;;',
                    ';;;3333333;;;;;;33333;;;;X;2;;3333;;;;;;3;;;;;;;;;;3;;;',
                    ';;;3333333;;;;1;33333;;;;;;;;;;33;;;;3;;3;;;;;C;;;;3;;;',
                    ';;;3333;;;;;;;;;33333;;3;;;;;;;;;;;;;;;;3;;;;;;;;;;3;;;',
                    ';;;3333;;;;;;;;;;333;;;;;;;;;3;;;;;;;;;;3;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;33;;;;;;;;;;w;33;;;;;;33;;;;3;;;;;;;;X;3;;;',
                    ';;;3;;;3;;;;33;;;;;1;;;;;;33;;;;;;33;;;;3;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;3;;;;;3;;;;;;;;;;;;;;;;;3333BBB33333;;;',
                    ';;;3;;;;;;2;;;;;;;;;;;;;;1;;;;33;2;;;;;;;;;!;;;!3333;;;',
                    ';;;3;;;;;3;;;;;;;;;;;;;;;;;;;;;;;;;;;3;;;;;;;;;;3333;;;',
                    ';;;3;;;;;;;;;3;;;;;;;;;3333;;;;;;;;;X3;;;;;;;;;;3333;;;',
                    ';;;3;;;;;;g;;3;;;;33;;333333;;;;;3;;;;;;;33;;;;;;;;3;;;',
                    ';;;3;;;3;;;;;X;;;;33;;3333333;;;;;;;;;;;;33;;3;;;;;3;;;',
                    ';;;3;;;;;;;33;;;;;;;;;3333333;;;;;;;2;;;;;;;;;s;;;;3;;;',
                    ';;;3;;;;;;;;;;;3;;;;;;3333333;;;;;;;;;3;;;;;;;;1;;;3;;;',
                    ';;;333333;;;;;;;;;;;;;333333;;;33;;;;;;w;;;;;;;;;;;3;;;',
                    ';;;33333333;;;;;;w;;;;;;333;;;;33;;;;;;;;;;;;3333333;;;',
                    ';;;33333333;;;;;;;3;;;;;;;;;;1;;;;;3;;;;;;;333333333;;;',
                    ';;;33333333;;;33;;;;;;;;;;;;;;;;;;;;;;;;3;;333333333;;;',
                    ';;;333333;;;1;33;;;;;;;;;;3;;;;;;;;;;;;;3;;333333333;;;',
                    ';;;333;;;;;;;;;;;;;;;;2;;;;;;;;;;;;;;;3;;;;333333333;;;',
                    ';;;333;;;;;;;;;;;3;;;;;;;;;;;;;33333;;;;;;;333333333;;;',
                    ';;;333;;s;;;3;;;;3;;;;;;;;;;3;;333333;;;;;;;;;333333;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;s;;3;;333333;;;;;;;;;333333;;;',
                    ';;;3;;;;;3;;;;;;;;;;33;;;;;;;;;333333;;;;;1;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;33;;;33;;;;33333;;;33;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;3;;;;;;;;;33;;;;33333;;g33;;3;;;;;;;3;;;',
                    ';;;3;;;O2;;;;;;;;;;;;;;;;;;;;;;;333;;;;;;;;;;;33;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;333;;;;3;;;333;;3;;;;;;;;33;;;3;;;',
                    ';;;3;;;;i;;;;;;;i3;;33333;;;;;;;;;;;;;;;33333;;;;;;3;;;',
                    ';;;3333;;;;;;;@;;;;;33333;;;;;2;;;;;;;;;33333;;;;;;3;;;',
                    ';;;3333;;;;;;;;;;;;;33333;;;;;;;;;;;;;;;33333;;;;;;3;;;',
                    ';;;33333333#P#33333333333333333333333333333333333333;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;'
                ],
                portals: [{ at: [12, 36], to: 'valley', facing: 'north' }],
                chests: [{ at: [46, 6], loot: 'caveChest' }]
            },
            clearing: {
                name: '训练场', training: true,
                dummyFacing: Math.PI,
                rows: [
                    '..T....T....T......T....T.....T...',
                    'T....T....T....T.T....T....T......',
                    '..T...T.T...T.....T..T...T.T..T.T.',
                    '.T..22221222222122222222122222..T.',
                    '.T..2.....................:..2....',
                    '....1.....................:..2.T..',
                    '..T.2...1.................:..1....',
                    '....#.....................:..2..T.',
                    '.T..P.............@...D..::..1....',
                    '....#..................::....2.T..',
                    '..T.2...............:::......1....',
                    '....1.........1....::........2..T.',
                    '.T..2..............:.........1....',
                    '....1..............:.........2.T..',
                    '....21111211112111112111121112..T.',
                    '..................................',
                    '..................................',
                    '..................................'
                ],
                portals: [{ at: [4, 8], to: 'base', facing: 'east' }]
            },
            // A test cave under the village (user, 2026-10-07: the cave's
            // dark without the long way there): a small dark hall of
            // pillars like the cave's, the gate in its north wall (the
            // village's south gate), two torches on stands by it; a little
            // room in the south shut by a thicket, a torch on the wall
            // either side; one cave spider, in the east (user, 2026-10-07:
            // one monster only). In the dark middle, out of the other
            // torches' reach, a training dummy facing west with a torch on
            // a stand either side of it, to try the dark with (user,
            // 2026-10-07).
            grotto: {
                name: '测试洞窟', dark: true, floor: ';',
                dummyFacing: Math.PI,
                rows: [
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;33333333333333#P#3333333333333;;;',
                    ';;;3332;;;;;;;;;;;;;;;;;;;;;;2333;;;',
                    ';;;33;;;;;;;;;;i;;;;;i;;;;;;;;;33;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;;;X;3;;;',
                    ';;;3;2;;33;;;;;;;;@;;;;;;;33;;;;3;;;',
                    ';;;3;O;;33;;;;;;;;;;;;;;;;33;1;;3;;;',
                    ';;;3;;;;;;;;133;;;;;;i;;;;;;;;;33;;;',
                    ';;;33;;;;;;;;33;;;;;;;;3;;;;;;133;;;',
                    ';;;332;;;;;;;;;;;;D;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;;;;;;;s;;;3;;;',
                    ';;;3;;;;;;;;33;;;;;;;;;;;;;;;;;;3;;;',
                    ';;;3;;;;;;;;33;;i;;;;;;;2;;;;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;;!;;;!;;3;;3;;;',
                    ';;;3;;3;;;;;;;;3;;;;;33BBB33;;;;3;;;',
                    ';;;3;;;;;;;;;;;;;;;;;3;;;;;3;;;;3;;;',
                    ';;;33;;;;;;;;;;;;;;;;3;X;O;3;;;;3;;;',
                    ';;;333;;;;;;;;;;;;;;;3;;;;;3;;233;;;',
                    ';;;333333333333333333333333333333;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;',
                    ';;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;'
                ],
                portals: [{ at: [18, 3], to: 'base', facing: 'south' }]
            },
            // The PVP arena (design.md 8.3): 20 x 11 blocks inside a
            // wall, the same seen from either spawn (point symmetric). Walls
            // inside and to the south are 2 high, so they hide a fighter
            // without hiding one standing behind them from the camera.
            arena: {
                name: '竞技场', duel: true,
                rows: [
                    '.T.TT.......TTT....T.....T..',
                    '.T.T............T..TT......T',
                    '.T.......TT.....T.T.....T...',
                    '...3333333333333333333333...',
                    '...3....................3...',
                    '...3.1......1........1..3...',
                    '.T.3....222..22..22.....3.T.',
                    '...3....2....22..2......3.T.',
                    '.T.3........::::........3...',
                    '.T.3.::@::::::::::::@::.3.T.',
                    '.T.3........::::........3.T.',
                    '...3......2..22....2....3.T.',
                    '.T.3.....22..22..222....3.T.',
                    '...3..1........1......1.3...',
                    '.T.3....................3.T.',
                    '...2222222222222222222222...',
                    '............................',
                    '............................',
                    '............................',
                    '............................'
                ]
            }
        },

        // 10. PVP (design.md 8): one phone hosts and runs the duel,
        // the other sends its controls and draws the host's snapshots,
        // predicting its own moves in between. countdown: seconds from both
        // being ready to the fight. snapshotSeconds: host to guest state;
        // heartbeatSeconds: guest to host when it has nothing else to say;
        // timeoutSeconds: nothing heard for this long and the connection
        // counts as lost. awaySeconds: how long a phone in the background
        // is waited for, the fight held still (user, 2026-10-04).
        // replaySeconds: how far past a snapshot the guest
        // predicts at most; latencySeconds: cap on its one-way estimate.
        // steer: the share of the difference between the guest's time and
        // a snapshot's that each snapshot takes out (small: the network's
        // unevenness does not show in the moves); resyncSeconds: past this
        // difference the guest's time jumps instead.
        // historyEvents: events the host keeps until the guest has them.
        // connectSeconds: how long finding the other phone may take.
        // weapons: the main hands each side may pick before a duel (user
        // 2026-10-02: one of each weapon type); the rest is gear.starter.
        pvp: {
            countdown: 3, snapshotSeconds: 0.05, heartbeatSeconds: 0.25, timeoutSeconds: 5, awaySeconds: 60,
            replaySeconds: 0.25, latencySeconds: 0.15, steer: 0.1, resyncSeconds: 0.1, historyEvents: 128, connectSeconds: 12,
            weapons: ['wooden_sword', 'assassin_dagger']
        }
    });
})();
