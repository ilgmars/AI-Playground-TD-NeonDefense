// Central balance & tuning config for Neon Defense.
// This file is the single source of truth for numbers that the designer might
// want to tweak. Logic lives in entities.js / game.js / autopilot.js.

// -------------------------------------------------------------------------
// Ascension tiers (Milestone 1: A0-A7 stat-only; A8-A10 reserved for M3
// new-enemy tiers). Each tier ADDS its modifier to the previous tier's
// stack — A5 has A1..A5 all active. Resolve a tier's full effect map via
// `getAscensionEffects(tier)`.
//
// Effect keys:
//   hpMult            -> multiplicative on per-spawn enemy HP
//   startMoneyMult    -> multiplicative on Game's initial money
//   airWaveInterval   -> "air wave every N waves" (default 5)
//   countMult         -> multiplicative on per-wave enemy count
//   payoutMult        -> multiplicative on wave-completion bonus + per-kill rewards
//   disableInvestCap  -> if true, investment-factor soft caps in startWave() are skipped
//   potionCostMult    -> multiplicative on POTION_CONFIG.baseCost + costPerUse
//   potionHeal        -> overrides POTION_CONFIG.healAmount
// -------------------------------------------------------------------------
const ASCENSION_MAX_TIER = 10;
const ASCENSION_MAX_TIER_M1 = 7; // tiers above this are reserved for Milestone 3

const ASCENSION_TIERS = [
    // tier 0 is always the baseline (no modifiers).
    { tier: 0, label: 'A0',  name: 'Baseline',      modifier: null,                                          kind: 'baseline' },
    { tier: 1, label: 'A1',  name: '+15% enemy HP', modifier: { hpMult: 1.15 },                              kind: 'stat' },
    { tier: 2, label: 'A2',  name: '-25% start $',  modifier: { startMoneyMult: 0.75 },                      kind: 'stat' },
    { tier: 3, label: 'A3',  name: 'Air every 4',   modifier: { airWaveInterval: 4 },                        kind: 'stat' },
    { tier: 4, label: 'A4',  name: '+15% count',    modifier: { countMult: 1.15 },                           kind: 'stat' },
    { tier: 5, label: 'A5',  name: '-40% payout',   modifier: { payoutMult: 0.60 },                          kind: 'stat' },
    { tier: 6, label: 'A6',  name: 'No invest cap', modifier: { disableInvestCap: true },                    kind: 'stat' },
    { tier: 7, label: 'A7',  name: 'Harsh potions', modifier: { potionCostMult: 2, potionHeal: 1 },          kind: 'stat' },
    // A8-A10 are declared for UI completeness but NOT playable until M3 adds
    // the Shielded / Splitter / Boss enemy types. Run Setup must lock these.
    { tier: 8, label: 'A8',  name: 'Shielded enemy', modifier: { spawnShielded: true },                      kind: 'enemy-m3' },
    { tier: 9, label: 'A9',  name: 'Splitter enemy', modifier: { spawnSplitter: true },                     kind: 'enemy-m3' },
    { tier: 10, label: 'A10', name: 'Boss enemy',    modifier: { spawnBoss: true },                          kind: 'enemy-m3' }
];

// Returns the cumulative effect map for a tier (0 <= tier <= 7 in M1).
// Out-of-range tiers clamp to baseline. All multipliers start at 1.0 and
// are composed by multiplication across all modifiers up to and including `tier`.
function getAscensionEffects(tier) {
    const effects = {
        hpMult: 1,
        startMoneyMult: 1,
        airWaveInterval: 5,
        countMult: 1,
        payoutMult: 1,
        disableInvestCap: false,
        potionCostMult: 1,
        potionHeal: null,  // null = use POTION_CONFIG.healAmount
        spawnShielded: false,
        spawnSplitter: false,
        spawnBoss: false
    };

    const safeTier = Math.max(0, Math.min(tier || 0, ASCENSION_MAX_TIER));

    for (let i = 1; i <= safeTier; i++) {
        const mod = ASCENSION_TIERS[i] && ASCENSION_TIERS[i].modifier;
        if (!mod) continue;
        for (const key of Object.keys(mod)) {
            if (key === 'disableInvestCap' || key === 'spawnShielded' || key === 'spawnSplitter' || key === 'spawnBoss') {
                effects[key] = mod[key];
            } else if (key === 'airWaveInterval' || key === 'potionHeal') {
                effects[key] = mod[key];  // overwrite (not multiplicative)
            } else {
                effects[key] *= mod[key]; // multiply multipliers
            }
        }
    }
    return effects;
}

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
                incomePerWave: 20 },

    // M3: Variants — unlocked by per-tower mastery m1 (1000 XP damage dealt).
    // Selected per-type in Run Setup; Game.getEffectiveTowerType resolves
    // base → variant at build time.
    basic_cryo:     { cost: 50,  range: 100, damage: 5,   fireRate: 40,
                      displayName: 'Cryo Blaster',   defaultTargetMode: 'first',
                      baseType: 'basic', slowEffect: 0.3, slowDuration: 60 },
    sniper_scatter: { cost: 100, range: 150, damage: 35,  fireRate: 100,
                      displayName: 'Scatter Sniper', defaultTargetMode: 'mostHp',
                      baseType: 'sniper', multiShot: 2, pierce: 1 },
    rapid_flame:    { cost: 150, range: 70,  damage: 3,   fireRate: 8,
                      displayName: 'Flamethrower',   defaultTargetMode: 'first',
                      baseType: 'rapid', burnDamage: 2, burnDuration: 120,
                      coneAngle: 0.6 },
    laser_pulse:    { cost: 200, range: 150, damage: 30,  fireRate: 60,
                      displayName: 'Pulse Laser',    defaultTargetMode: 'mostHp',
                      baseType: 'laser', pulsed: true },
    rocket_cluster: { cost: 250, range: 200, damage: 18,  fireRate: 90,
                      displayName: 'Cluster Rocket', defaultTargetMode: 'mostHp',
                      baseType: 'rocket', splash: 45, clusterCount: 4 },
    flak_emp:       { cost: 150, range: 250, damage: 8,   fireRate: 40,
                      displayName: 'EMP Flak',       defaultTargetMode: 'first',
                      baseType: 'flak', splash: 40, stunDuration: 60 },
    electric_plasma:{ cost: 300, range: 100, damage: 2,   fireRate: 1,
                      displayName: 'Plasma Coil',    defaultTargetMode: 'first',
                      baseType: 'electric', continuousAoE: true },
    silo_orbital:   { cost: 400, range: 120, damage: 360, fireRate: 480,
                      displayName: 'Orbital Strike', defaultTargetMode: 'mostHp',
                      baseType: 'silo', maxHover: 1, splash: 90, orbital: true },
    income_research:{ cost: 200, range: 0,   damage: 0,   fireRate: 0,
                      displayName: 'Research Node',  defaultTargetMode: 'closest',
                      baseType: 'income', incomePerWave: 0, auraBonus: 0.02, auraRange: 3 }
};

// M3: Map from base tower type → variant type id. Used by Run Setup to show
// base/variant toggles, and by Game to resolve loadout choices at build time.
const TOWER_VARIANTS = {
    basic:    'basic_cryo',
    sniper:   'sniper_scatter',
    rapid:    'rapid_flame',
    laser:    'laser_pulse',
    rocket:   'rocket_cluster',
    flak:     'flak_emp',
    electric: 'electric_plasma',
    silo:     'silo_orbital',
    income:   'income_research'
};

// -------------------------------------------------------------------------
// Enemy base stats. hp is multiplied by the wave's hpMultiplier.
// -------------------------------------------------------------------------
const ENEMIES = {
    normal: { hp: 20, speed: 1,   reward: 5,  radius: 12, defense: 0    },
    fast:   { hp: 10, speed: 1.8, reward: 3,  radius: 10, defense: 0    },
    tank:   { hp: 60, speed: 0.6, reward: 10, radius: 15, defense: 0.20 },
    air:    { hp: 25, speed: 0.6, reward: 8,  radius: 14, defense: 0.08 }
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
    endOfWavePayoutBase: 26,      // Better economy for early game
    endOfWavePayoutPerWave: 6     // Better scaling
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
        basic:    w => Math.max(4, Math.ceil(w / 3)),          // Solid basic coverage
        flak:     w => w >= 3  ? Math.max(2, Math.min(9, 2 + Math.floor(w / 7))) : 0,  // Good flak coverage
        rapid:    w => w >= 2  ? Math.ceil(w / 4) : 0,         // Balanced rapids
        laser:    w => w >= 3  ? Math.min(9, Math.ceil(w / 4.2)) : 0,  // Slightly more lasers
        sniper:   w => w >= 4  ? Math.ceil(w / 5) : 0,         // Balanced snipers
        rocket:   w => w >= 6  ? Math.ceil(w / 5.5)   : 0,     // Balanced rockets
        electric: w => w >= 7  ? Math.ceil(w / 6.5)   : 0,     // Balanced electric
        silo:     w => w >= 10 ? Math.ceil(w / 7.5)  : 0,      // Balanced silos
        income:   w => w >= 7 ? Math.max(1, Math.floor(w / 6.5))  : 0  // Balanced income
    },

    // Order used when scanning for the biggest tower-count deficit.
    buildOrder: ['flak', 'laser', 'income', 'basic', 'rapid', 'sniper', 'rocket', 'electric', 'silo'],

    // Priority weight when choosing which tower to upgrade (higher = prefer).
    upgradeValue: { silo: 10, rocket: 9, electric: 8, sniper: 7, laser: 6, flak: 5, rapid: 4, basic: 3, income: 2 },

    // (wave) => probability that the autopilot builds vs upgrades this tick.
    buildChance: w => w < 15 ? 0.85 : w < 30 ? 0.7 : w < 50 ? 0.6 : 0.55,

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
    mustBuildMinTowers: 7,       // balanced (was 8)
    mustBuildWantedFraction: 0.68 // or if below 68% of totalWanted
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

// M3: Alias variant upgrade trees to their base tower's. Variants share the
// same 3 upgrade slots as their base; clicking them opens the standard
// upgrade menu instead of crashing with "Cannot read properties of undefined".
for (const [base, variant] of Object.entries(TOWER_VARIANTS)) {
    if (TOWER_UPGRADES[base]) TOWER_UPGRADES[variant] = TOWER_UPGRADES[base];
}

// -------------------------------------------------------------------------
// Heroes (M2). Picked at run setup; one passive effect applied at Game
// construction. Pioneer is pre-unlocked on fresh save (see save.js).
// -------------------------------------------------------------------------
const HEROES = {
    pioneer:  { id: 'hero.pioneer',  name: 'Pioneer',  desc: '+25% starting money',
                apply: (g) => { g.money = Math.floor(g.money * 1.25); } },
    engineer: { id: 'hero.engineer', name: 'Engineer', desc: '-10% tower cost, -5% upgrade cost',
                apply: (g) => { g.towerCostMult = 0.9;  g.upgradeCostMult = 0.95; } },
    warden:   { id: 'hero.warden',   name: 'Warden',   desc: '+5 max HP; potions heal +1',
                apply: (g) => { g.maxHealth += 5; g.health += 5; g.potionHealBonus = 1; } }
};
const DEFAULT_HERO = 'pioneer';

// -------------------------------------------------------------------------
// Starter Kits (M2). Picked at run setup; one configuration change applied
// at Game construction. Standard is pre-unlocked.
// -------------------------------------------------------------------------
const STARTER_KITS = {
    standard:   { id: 'kit.standard',   name: 'Standard',   desc: 'Default loadout',
                  apply: (g) => { /* no-op */ } },
    economist:  { id: 'kit.economist',  name: 'Economist',  desc: '$75 start, free Relay pre-placed',
                  apply: (g) => { g.money = 75; g.prePlaceRelay = true; } },
    medic:      { id: 'kit.medic',      name: 'Medic',      desc: '+2 starting potions; potions cost 1.5x',
                  apply: (g) => { g.startingPotions = 2; g.potionCostKitMult = 1.5; } },
    strategist: { id: 'kit.strategist', name: 'Strategist', desc: 'See all waves; -20% starting money',
                  apply: (g) => { g.money = Math.floor(g.money * 0.8); g.showAllWavesPreview = true; } }
};
const DEFAULT_KIT = 'standard';

// -------------------------------------------------------------------------
// Active Abilities (M2). Picked at run setup; used during a run via the
// top-bar ability button. Logic lives in abilities.js.
// -------------------------------------------------------------------------
const ABILITIES = {
    none:      { id: 'ability.none',      name: 'None',         desc: 'No ability this run', charges: 0, kind: 'none' },
    scan:      { id: 'ability.scan',      name: 'Scan',         desc: 'Reveal next 3 waves', charges: 1, kind: 'reveal' },
    airstrike: { id: 'ability.airstrike', name: 'Airstrike',    desc: '200 dmg AoE, 80px radius', charges: 3, kind: 'target' },
    freeze:    { id: 'ability.freeze',    name: 'Freeze Wave',  desc: 'Stop all enemies 3s', charges: 1, kind: 'instant' }
};
const DEFAULT_ABILITY = 'none';

// -------------------------------------------------------------------------
// QoL nodes (M2). Toggled by ownership in save.unlockedNodes. Effects
// applied at Game construction or read per-frame.
// -------------------------------------------------------------------------
const QOL_NODES = {
    'qol.hpbars':      { name: 'Enemy HP Bars',   desc: 'Show HP bars above each enemy' },
    'qol.fastai':      { name: 'Fast Autopilot',  desc: 'Autopilot tick 15f (from 30f)' },
    'qol.dailyseed':   { name: 'Daily Seed',      desc: 'Daily Challenge button on Main Menu' },
    'qol.skipsetup':   { name: 'Skip Setup',      desc: 'One-click reuse of last loadout' },
    'qol.ascpreview':  { name: 'Ascension +1 Preview', desc: 'See next-tier modifier before clearing' }
};

// -------------------------------------------------------------------------
// Tech Tree (M2). 3 tiers x 5 nodes. Costs: T1=50, T2=200, T3=500 XP.
// Tier gating: need >= 2 owned nodes in prior tier to open next tier.
// Pre-unlocks: hero.pioneer + kit.standard (see save.js).
// Auto-unlocks: clearing A1/A3/A5/A7 grants specific nodes for free
// (see tree.js autoUnlockOnAscension).
// -------------------------------------------------------------------------
const TECH_TREE = {
    tier1: {
        cost: 50,
        nodes: [
            { id: 'hero.pioneer',   kind: 'hero',    desc: '+25% starting money' },
            { id: 'kit.standard',   kind: 'kit',     desc: 'Default loadout' },
            { id: 'hero.engineer',  kind: 'hero',    desc: '-10% tower cost, -5% upgrade cost' },
            { id: 'ability.scan',   kind: 'ability', desc: 'Reveal next 3 waves (1 charge)' },
            { id: 'kit.economist',  kind: 'kit',     desc: '$75 start + pre-placed Relay' }
        ]
    },
    tier2: {
        cost: 200,
        nodes: [
            { id: 'hero.warden',       kind: 'hero',    desc: '+5 max HP; potions heal +1' },
            { id: 'ability.airstrike', kind: 'ability', desc: 'Click-target 200 dmg AoE (3 charges)' },
            { id: 'kit.medic',         kind: 'kit',     desc: '+2 potions; potions cost 1.5x' },
            { id: 'qol.hpbars',        kind: 'qol',    desc: 'Show enemy HP bars' },
            { id: 'qol.fastai',        kind: 'qol',    desc: 'Autopilot tick 15f (faster)' }
        ]
    },
    tier3: {
        cost: 500,
        nodes: [
            { id: 'ability.freeze',    kind: 'ability', desc: 'Freeze all enemies 3s (1 charge)' },
            { id: 'kit.strategist',    kind: 'kit',     desc: 'See all waves; -20% start $' },
            { id: 'qol.dailyseed',     kind: 'qol',    desc: 'Daily Challenge seed button' },
            { id: 'qol.skipsetup',     kind: 'qol',    desc: 'One-click last-loadout reuse' },
            { id: 'qol.ascpreview',    kind: 'qol',    desc: 'Preview next Ascension modifier' }
        ]
    }
};

// Ascension-clear → free tree node mapping. Fires on first clear of each tier.
const ASCENSION_AUTO_UNLOCKS = {
    1:  'kit.economist',
    3:  'qol.hpbars',
    5:  'qol.dailyseed',
    7:  'qol.skipsetup'
    // A10 reward deferred to M3 (cosmetic banner).
};

// Lookup a node definition by id across all 3 tiers. Returns null if not found.
function getTreeNode(nodeId) {
    for (const tierKey of ['tier1', 'tier2', 'tier3']) {
        const tier = TECH_TREE[tierKey];
        for (const node of tier.nodes) {
            if (node.id === nodeId) {
                return { ...node, tier: tierKey, cost: tier.cost };
            }
        }
    }
    return null;
}
