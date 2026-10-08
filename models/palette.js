// Colour names used by every model and texture. Models name a colour; only
// this table holds values, so a restyle touches one file
// (design.md 2.1).
const palette = Object.freeze({
    // characters
    skin: '#e2b48b', hair: '#5a3a24', eye: '#2a2d38',
    tunic: '#3d6db3', tunicTrim: '#e9e4d6', pants: '#4a3a2c', boots: '#33261c',
    rivalTunic: '#b8443a', rivalTrim: '#f0d9a8',
    belt: '#5b3b22', leather: '#7a5233', gold: '#d8b04a',
    // equipment
    steel: '#dfe5ec', steelDark: '#9aa2aa', wood: '#8a5a2e', woodDark: '#6b4423',
    daggerGrip: '#3b2a1e', ironTunic: '#5f6b78', torchWrap: '#4a3a2a', flame: '#ffb13b', flameTip: '#fff1a8',
    potionRed: '#d8394a', glass: '#cfe6ef', cork: '#9a7246',
    // training dummy
    sack: '#c9b48a', rope: '#7b6243', straw: '#e3c76a', target: '#c8433a',
    // goblin
    goblin: '#7fb550', goblinLight: '#8cc25a', goblinDark: '#6fa244', goblinEye: '#f6d84a', pupil: '#1f1a12', mouth: '#3a2a1a',
    rag: '#6b4a2a', ragDark: '#5a3e23', ragLight: '#8a6a3c', clubGrip: '#6b4a2b', club: '#4f3a24', goblinFoot: '#5a4027',
    // wolf
    wolf: '#9c9ea3', wolfLight: '#b5b7bc', wolfHead: '#a7a9ae', wolfMuzzle: '#cbccd0', wolfDark: '#8d8f94', wolfLeg: '#8f9196',
    wolfNose: '#26272b', wolfEye: '#f2c94c', fang: '#f4f1e6',
    // cave spider
    spider: '#5b4a5f', spiderLight: '#6f5d73', spiderDark: '#3f3344', spiderLeg: '#4e4053', spiderEye: '#ff5a3c', spiderFang: '#d9cfbf', spiderMark: '#b8432f',
    // bosses: the goblin chief, the wolf king
    chiefSkin: '#5f8a34', chiefSkinLight: '#6f9c3e', chiefSkinDark: '#527a2c', chiefRag: '#8a2f2a', chiefRagDark: '#6a2420', chiefRagLight: '#a8473d',
    chiefClub: '#3a2a1a', helmet: '#7d8088', horn: '#e8dcc0',
    kingFur: '#4c4d55', kingFurLight: '#60616a', kingHead: '#56575f', kingMuzzle: '#7c7d85', kingDark: '#3a3b41', kingLeg: '#46474e', kingEye: '#ff7a3a', mane: '#2c2d33',
    // terrain
    grass: '#6aa94b', grassLight: '#8cc95e', dirt: '#8b5d3c', path: '#b4925e', pebble: '#8e8a83',
    stone: '#8e9297', stoneDark: '#5f6368', stoneLight: '#b8bcc0', moss: '#5d8a3c',
    bark: '#6c4a2c', leaves: '#3f8b3c', leavesDark: '#1f4d22', leavesLight: '#6dbb57',
    stem: '#4f8f36', flowerRed: '#d9473f', flowerYellow: '#f0cf3c', flowerWhite: '#f2f0ea', flowerViolet: '#8a6ad8',
    cobble: '#9b9a93', cobbleDark: '#6e6d68', gravel: '#8d8579', plank: '#a3733f', plankDark: '#7a5230', roof: '#a6463b', roofDark: '#7c3129',
    door: '#5a3a22', window: '#2c3542', portalStone: '#4a4357', portalStoneLight: '#6b6279', portalGlow: '#a183ff', portalLocked: '#c0453a',
    roofSpring: '#6f9fc4', roofSmithy: '#7b7b85', roofShop: '#c2574a', roofStorage: '#a07a45',
    // props
    chestWood: '#8f5d2c', chestDark: '#6a4220', earItem: '#8cc25a', peltItem: '#a7a9ae', tuskItem: '#efe6cc', fangItem: '#f4f1e6', silkItem: '#e8e4f0',
    // world
    sky: '#a9cdea', skyLight: '#e7f2ff', groundLight: '#6f5d47', sun: '#fff2d8', darkSky: '#05060a',
    // the world's light by look (render/view_light.js): the sun warm, the
    // sky's light cool; sunrise and sunset, a grey day among the rocks, and
    // the night under the moon
    sunWarm: '#ffe4b8', skyCool: '#d9e8ff',
    sunDawn: '#ffd9a8', skyDawn: '#e6e0f3', groundDawn: '#786048', skyDawnBack: '#e8d3c0',
    sunGrey: '#eef1f6', skyGrey: '#d2dbe8', groundGrey: '#625d59', skyGreyBack: '#b9c4cf',
    moon: '#b8c9f2', skyNight: '#7f95c8', groundNight: '#2c2f40', skyNightBack: '#141c30',
    brush: '#8a6a3c', brushDark: '#4e3a20', water: '#4d8cbd', pondBed: '#c8e4dc',
    fencePost: '#5e4630', fenceRail: '#8a7052',
    // resources
    ore: '#c9824a', oreLight: '#e8a868', crystal: '#7fe3f0', crystalDeep: '#3aa6c8', herb: '#3f9a4a', herbLight: '#7acb62', berry: '#d8394a'
});
