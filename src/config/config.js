// Central balance & tuning config for Neon Defense.
// This file is the single source of truth for numbers that the designer might
// want to tweak. Logic lives in entities.js / game.js / autopilot.js.

// -------------------------------------------------------------------------
// Tower base stats. Applied by Tower constructor.
// Optional fields (pelletCount, spread, splash, chainCount, maxHover, etc.)
// are only copied onto the tower when present.
// -------------------------------------------------------------------------
const TOWERS = {
    basic:    { cost: 50,  range: 100, damage: 10,  fireRate: 40,
                displayName: 'Blaster',   defaultTargetMode: 'first' },
    sniper:   { cost: 100, range: 250, damage: 40,  fireRate: 100,
                displayName: 'Sniper',    defaultTargetMode: 'mostHp' },
    rapid:    { cost: 150, range: 80,  damage: 8,   fireRate: 60,
                displayName: 'Shotgun',   defaultTargetMode: 'first',
                pelletCount: 5, spread: 0.4, pierce: 2 },
    laser:    { cost: 200, range: 150, damage: 1.5, fireRate: 1,
                displayName: 'Laser',     defaultTargetMode: 'leastHp',
                slowEffect: 0.2 },
    rocket:   { cost: 250, range: 200, damage: 30,  fireRate: 90,
                displayName: 'Rocket',    defaultTargetMode: 'mostHp',
                splash: 70 },
    flak:     { cost: 150, range: 250, damage: 15,  fireRate: 35,
                displayName: 'Flak (AA)', defaultTargetMode: 'first',
                splash: 50 },
    electric: { cost: 300, range: 120, damage: 25,  fireRate: 60,
                displayName: 'Tesla',     defaultTargetMode: 'leastHp',
                chainCount: 3 },
    silo:     { cost: 400, range: 100, damage: 120, fireRate: 80,
                displayName: 'Silo',      defaultTargetMode: 'mostHp',
                maxHover: 4, splash: 40 },
    income:   { cost: 200, range: 0,   damage: 0,   fireRate: 0,
                displayName: 'Relay',     defaultTargetMode: 'closest',
                incomePerWave: 20 }
};

// -------------------------------------------------------------------------
// Enemy base stats. hp is multiplied by the wave's hpMultiplier.
// -------------------------------------------------------------------------
const ENEMIES = {
    normal: { hp: 20, speed: 1,   reward: 5,  radius: 12 },
    fast:   { hp: 10, speed: 1.8, reward: 3,  radius: 10 },
    tank:   { hp: 60, speed: 0.6, reward: 10, radius: 15 },
    air:    { hp: 25, speed: 0.6, reward: 8,  radius: 14 }
};

// -------------------------------------------------------------------------
// Wave pacing and air-wave behavior.
// -------------------------------------------------------------------------
const WAVE_CONFIG = {
    // Frames of cooldown between waves. Extra-long before an air wave.
    normalCooldown: 180,
    airWaveCooldown: 300,
    // Delay between wave trigger and first enemy spawn.
    preWaveSpawnDelay: 60,
    // Fraction of air enemies that follow the ground path instead of flying straight.
    airPathFollowChance: 0.2,
    // Wave-end payout: base + perWave * waveNumber.
    endOfWavePayoutBase: 20,
    endOfWavePayoutPerWave: 5
};

// -------------------------------------------------------------------------
// Repair potion pricing.
// -------------------------------------------------------------------------
const POTION_CONFIG = {
    baseCost: 150,
    costPerUse: 75,
    healAmount: 5
};

// -------------------------------------------------------------------------
// Autopilot tuning. All strategy knobs live here; the autopilot only
// implements the rules using these numbers.
// -------------------------------------------------------------------------
const AUTOPILOT_CONFIG = {
    // How often (in update ticks) the autopilot runs. 30 = roughly 2 Hz.
    tickInterval: 30,

    // For each tower type: (wave) => desired count on the board.
    wantedCount: {
        basic:    w => Math.max(4, Math.ceil(w / 3.5)),        // More basics, scale faster
        flak:     w => w >= 4  ? Math.max(2, Math.min(8, 2 + Math.floor(w / 8))) : 0,  // More flak for air waves
        rapid:    w => w >= 2  ? Math.ceil(w / 4.5) : 0,       // More rapids, scale faster
        laser:    w => w >= 3  ? Math.min(8, Math.ceil(w / 5)) : 0,  // More lasers for slow
        sniper:   w => w >= 5  ? Math.ceil(w / 5.5) : 0,       // More snipers, scale faster
        rocket:   w => w >= 6  ? Math.ceil(w / 6)   : 0,       // More rockets, scale faster
        electric: w => w >= 8  ? Math.ceil(w / 7.5)   : 0,     // More electric, scale faster
        silo:     w => w >= 12 ? Math.ceil(w / 8)  : 0,        // More silos, scale faster
        income:   w => w >= 8 ? Math.max(1, Math.floor(w / 7))  : 0  // Earlier income, more relays
    },

    // Order used when scanning for the biggest tower-count deficit.
    buildOrder: ['flak', 'laser', 'income', 'basic', 'rapid', 'sniper', 'rocket', 'electric', 'silo'],

    // Priority weight when choosing which tower to upgrade (higher = prefer).
    upgradeValue: { silo: 10, rocket: 9, electric: 8, sniper: 7, laser: 6, flak: 5, rapid: 4, basic: 3, income: 2 },

    // (wave) => probability that the autopilot builds vs upgrades this tick.
    buildChance: w => w < 10 ? 0.85 : w < 20 ? 0.7 : w < 40 ? 0.6 : 0.55,

    // A wave is "air imminent" if <= N waves away (or currently active).
    airImminentWindow: 2,

    // Auto-potion when health drops to or below this threshold.
    potionHealthThreshold: 5,  // Buy potions earlier (was 3)

    // Bonus awarded when placing near an existing laser (synergy nudge).
    laserSynergyRange: 3,     // tiles
    laserSynergyScore: 40,

    // Money-saving rules: how much extra to keep on top of the tower's cost.
    saveBufferFlakUrgent: 100, // saving for flak before wave 5
    saveBufferFlakNeeded: 50,  // saving for flak mid-game
    // Force saving for the target tower when deficit >= N
    saveDeficitSevere: 2,
    saveDeficitModerate: 1,
    saveEarlyTowerTotal: 8,    // saveDeficitModerate only kicks in while this few total towers

    // Build urgency thresholds.
    mustBuildMinTowers: 6,       // always build if fewer towers than this (increased from 5)
    mustBuildWantedFraction: 0.7 // or if below 70% of totalWanted (more aggressive)
};

// -------------------------------------------------------------------------
// Per-tower upgrade tree. Each entry has 3 upgrades. `apply(tower)` mutates
// the tower when purchased. getUpgradeCost(level) uses baseCost * costMult^level.
// -------------------------------------------------------------------------
const TOWER_UPGRADES = {
    basic: [
        { name: 'Damage', desc: 'Increases bullet damage', baseCost: 40, costMult: 1.5, apply: (t) => { t.damage += 8; } },
        { name: 'Speed',  desc: 'Shoots faster',           baseCost: 30, costMult: 1.4, apply: (t) => { t.fireRate = Math.max(5, Math.floor(t.fireRate * 0.8)); } },
        { name: 'Range',  desc: 'Increases targeting range', baseCost: 30, costMult: 1.3, apply: (t) => { t.range += 15; } }
    ],
    sniper: [
        { name: 'Caliber',  desc: 'Huge damage boost',            baseCost: 80,  costMult: 1.6, apply: (t) => { t.damage += 30; } },
        { name: 'Scope',    desc: 'Increases range',              baseCost: 60,  costMult: 1.4, apply: (t) => { t.range += 40; } },
        { name: 'Ricochet', desc: 'Bullets bounce to next enemy', baseCost: 120, costMult: 1.8, apply: (t) => { t.pierce = (t.pierce || 1) + 1; } }
    ],
    rapid: [
        { name: 'Damage',      desc: 'More pellet damage',          baseCost: 100, costMult: 1.5, apply: (t) => { t.damage += 4; } },
        { name: 'Pellets',     desc: 'More pellets per shot',       baseCost: 80,  costMult: 1.6, apply: (t) => { t.pelletCount = (t.pelletCount || 5) + 3; } },
        { name: 'Penetration', desc: 'Pellets pierce more enemies', baseCost: 120, costMult: 1.7, apply: (t) => { t.pierce = (t.pierce || 2) + 1; } }
    ],
    laser: [
        { name: 'Intensity', desc: 'More continuous damage',  baseCost: 150, costMult: 1.5, apply: (t) => { t.damage += 1; } },
        { name: 'Range',     desc: 'Increases targeting range', baseCost: 100, costMult: 1.4, apply: (t) => { t.range += 20; } },
        { name: 'Cryo Beam', desc: 'Slows down enemies',        baseCost: 200, costMult: 2.0, apply: (t) => { t.slowEffect = Math.min(0.85, (t.slowEffect || 0.2) + 0.25); } }
    ],
    rocket: [
        { name: 'Payload',    desc: 'More dmg & explosion size', baseCost: 200, costMult: 1.6, apply: (t) => { t.damage += 20; t.splash = (t.splash || 70) + 15; } },
        { name: 'Multi-Shot', desc: 'Fires extra rockets',       baseCost: 300, costMult: 2.0, apply: (t) => { t.multiShot = (t.multiShot || 1) + 1; } },
        { name: 'Range',      desc: 'Increases targeting range', baseCost: 150, costMult: 1.4, apply: (t) => { t.range += 25; } }
    ],
    flak: [
        { name: 'Shrapnel',   desc: 'Larger flak explosions', baseCost: 150, costMult: 1.5, apply: (t) => { t.splash += 20; } },
        { name: 'Radar',      desc: 'Increases AA range',     baseCost: 100, costMult: 1.4, apply: (t) => { t.range += 50; } },
        { name: 'Autoloader', desc: 'Fires shells faster',    baseCost: 200, costMult: 1.6, apply: (t) => { t.fireRate = Math.max(15, Math.floor(t.fireRate * 0.75)); } }
    ],
    electric: [
        { name: 'Voltage',   desc: 'More chain damage',       baseCost: 200, costMult: 1.6, apply: (t) => { t.damage += 15; } },
        { name: 'Conductor', desc: 'Jumps to more enemies',   baseCost: 250, costMult: 1.8, apply: (t) => { t.chainCount = (t.chainCount || 3) + 1; } },
        { name: 'Range',     desc: 'Increases targeting range', baseCost: 150, costMult: 1.4, apply: (t) => { t.range += 20; } }
    ],
    silo: [
        { name: 'Warhead',  desc: 'More dmg & splash radius', baseCost: 300, costMult: 1.6, apply: (t) => { t.damage += 30; t.splash = (t.splash || 40) + 10; } },
        { name: 'Capacity', desc: 'More max hovering rockets', baseCost: 400, costMult: 2.0, apply: (t) => { t.maxHover = (t.maxHover || 3) + 1; } },
        { name: 'Assembly', desc: 'Builds rockets faster',     baseCost: 250, costMult: 1.5, apply: (t) => { t.fireRate = Math.max(30, Math.floor(t.fireRate * 0.8)); } }
    ],
    income: [
        { name: 'Efficiency', desc: '+10¢ per wave',       baseCost: 150, costMult: 1.6, apply: (t) => { t.incomePerWave += 10; } },
        { name: 'Overcharge', desc: '+15¢ per wave',       baseCost: 250, costMult: 1.8, apply: (t) => { t.incomePerWave += 15; } },
        { name: 'Network',    desc: '+5¢ per other Relay', baseCost: 200, costMult: 1.5, apply: (t) => { t.networkBonus = (t.networkBonus || 0) + 1; } }
    ]
};
