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
    basic_cryo:     { cost: 50,  range: 100, damage: 8,   fireRate: 40,
                      displayName: 'Cryo Blaster',   defaultTargetMode: 'first',
                      baseType: 'basic', slowEffect: 0.3, slowDuration: 60 },
    sniper_scatter: { cost: 100, range: 210, damage: 35,  fireRate: 100,
                      displayName: 'Scatter Sniper', defaultTargetMode: 'mostHp',
                      baseType: 'sniper', multiShot: 2, pierce: 1 },
    rapid_flame:    { cost: 150, range: 70,  damage: 3,   fireRate: 8,
                      displayName: 'Flamethrower',   defaultTargetMode: 'first',
                      baseType: 'rapid', burnDamage: 2, burnDuration: 120,
                      coneAngle: 0.6 },
    laser_pulse:    { cost: 200, range: 160, damage: 50,  fireRate: 60,
                      displayName: 'Pulse Laser',    defaultTargetMode: 'mostHp',
                      baseType: 'laser', pulsed: true },
    rocket_cluster: { cost: 250, range: 200, damage: 18,  fireRate: 90,
                      displayName: 'Cluster Rocket', defaultTargetMode: 'mostHp',
                      baseType: 'rocket', splash: 45, clusterCount: 4 },
    flak_emp:       { cost: 150, range: 250, damage: 12,  fireRate: 40,
                      displayName: 'EMP Flak',       defaultTargetMode: 'first',
                      baseType: 'flak', splash: 40, stunDuration: 60 },
    electric_plasma:{ cost: 300, range: 110, damage: 12,  fireRate: 60,
                      displayName: 'Plasma Coil',    defaultTargetMode: 'first',
                      baseType: 'electric', chainCount: 3,
                      burnDamage: 3, burnDuration: 90 },
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
        basic:    w => Math.min(18, Math.max(4, Math.ceil(w / 5))),              // cheap filler, not a role blocker
        flak:     w => w >= 3  ? Math.min(12, 1 + Math.floor(w / 8)) : 0,       // first AA is critical; avoid overbuilding air-only towers
        rapid:    w => w >= 2  ? Math.min(15, Math.ceil(w / 7)) : 0,            // moderate — short range
        laser:    w => w >= 3  ? Math.min(30, Math.ceil(w / 3)) : 0,            // TOP priority — slow is critical
        sniper:   w => w >= 4  ? Math.min(40, Math.ceil(w / 5)) : 0,            // reduced — doesn't slow enemies
        rocket:   w => w >= 6  ? Math.min(45, Math.ceil(w / 4)) : 0,            // reduced vs sniper
        electric: w => w >= 7  ? Math.min(20, Math.ceil(w / 6)) : 0,            // moderate
        silo:     w => w >= 10 ? Math.min(25, Math.ceil(w / 5)) : 0,            // moderate
        income:   w => w >= 5 ? Math.min(14, Math.max(1, Math.floor(w / 7))) : 0  // earlier + denser — relays pay back fast and fund everything else
    },

    // Order used when scanning for the biggest tower-count deficit.
    buildOrder: ['flak', 'laser', 'sniper', 'rocket', 'silo', 'electric', 'basic', 'rapid', 'income'],

    // Priority weight when choosing which tower to upgrade (higher = prefer).
    // Income bumped 2 → 6: relay upgrades have multiplicative payoff on every
    // future wave, so they're competitive with mid-tier combat upgrades.
    upgradeValue: { silo: 10, rocket: 9, electric: 8, sniper: 7, income: 6, laser: 6, flak: 5, rapid: 4, basic: 3 },

    // (wave) => probability that the autopilot builds vs upgrades this tick.
    buildChance: w => w < 15 ? 0.85 : w < 30 ? 0.7 : w < 50 ? 0.6 : 0.55,

    // A wave is "air imminent" if <= N waves away (or currently active).
    // Bumped 2→3 since iter1's multi-action tick can absorb the extra prep
    // builds without starving ground-defence; gives flak/laser more lead time.
    airImminentWindow: 3,

    // Auto-potion when health drops to or below this threshold.
    potionHealthThreshold: 12, // Buy before critical — saves for potion if needed

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
    saveCommitFraction: 0.75,  // only block fallback builds once close to target cost

    // Build urgency thresholds.
    mustBuildMinTowers: 7,       // balanced (was 8)
    mustBuildWantedFraction: 0.68, // or if below 68% of totalWanted

    // If money is above this after building, also upgrade in the same tick.
    // Prevents late-game income from piling up unused when build opportunities remain.
    upgradeAlongsideBuild: 200,

    // Maximum number of build/upgrade actions the autopilot may take in a
    // single tick. Drains affordable picks until either nothing is actionable
    // or the cap is hit. Bounds CPU work and prevents single-tick stutter.
    // Late-game income with this at 1 used to outpace the autopilot's spend.
    maxActionsPerTick: 4
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
        name: 'STARTERS',
        nodes: [
            { id: 'hero.pioneer',   kind: 'hero',    desc: 'Hero: start each run with +25% money.' },
            { id: 'kit.standard',   kind: 'kit',     desc: 'Starter kit: baseline loadout, no penalties.' },
            { id: 'hero.engineer',  kind: 'hero',    desc: 'Hero: towers cost 10% less and upgrades cost 5% less.' },
            { id: 'ability.scan',   kind: 'ability', desc: 'Active ability: reveal the next 3 waves once per run.' },
            { id: 'kit.economist',  kind: 'kit',     desc: 'Starter kit: $75 start, but a free Relay is pre-placed.' }
        ]
    },
    tier2: {
        cost: 200,
        name: 'CORE TOOLS',
        nodes: [
            { id: 'hero.warden',       kind: 'hero',    desc: 'Hero: +5 max HP; repair potions heal +1 more.' },
            { id: 'ability.airstrike', kind: 'ability', desc: 'Active ability: 3 targeted 200-damage area strikes.' },
            { id: 'kit.medic',         kind: 'kit',     desc: 'Starter kit: +2 starting repairs; repairs cost 1.5x.' },
            { id: 'qol.hpbars',        kind: 'qol',    desc: 'Intel: show enemy HP bars above active enemies.' },
            { id: 'qol.fastai',        kind: 'qol',    desc: 'Automation: built-in Autopilot checks twice as often.' }
        ]
    },
    tier3: {
        cost: 500,
        name: 'ADVANCED SYSTEMS',
        nodes: [
            { id: 'ability.freeze',    kind: 'ability', desc: 'Active ability: freeze every enemy for 3 seconds.' },
            { id: 'kit.strategist',    kind: 'kit',     desc: 'Starter kit: reveal future waves; start with 20% less money.' },
            { id: 'qol.dailyseed',     kind: 'qol',    desc: 'Challenge mode: unlock a deterministic daily-seed run button.' },
            { id: 'qol.skipsetup',     kind: 'qol',    desc: 'Launch flow: reuse the last loadout from the main menu.' },
            { id: 'qol.ascpreview',    kind: 'qol',    desc: 'Intel: preview the next hidden Ascension modifier.' }
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

// -------------------------------------------------------------------------
// Roguelike Boons (endless). Every 10 waves the run pauses and offers a
// choice of 3 random boons from this pool. Effects are permanent for the
// rest of the run and STACK (taking +damage twice compounds). Each `apply`
// only touches a single Game hook so the system stays low-coupling — see
// Game._applyDamageBoon / _applyFireRateBoon and the boon* multiplier
// fields set in the constructor.
// -------------------------------------------------------------------------
const BOONS = [
    { id: 'overdrive', name: 'Overdrive Matrix',   icon: '⚡', desc: '+18% tower damage (all current & future towers)',
      apply: (g) => g._applyDamageBoon(1.18) },
    { id: 'coils',     name: 'Resonant Coils',     icon: '🔁', desc: '+14% fire rate for every tower',
      apply: (g) => g._applyFireRateBoon(0.877) },
    { id: 'economy',   name: 'War Economy',        icon: '💰', desc: '+25% wave-completion payout',
      apply: (g) => { g.boonPayoutMult *= 1.25; } },
    { id: 'bounty',    name: 'Bounty Protocol',    icon: '🎯', desc: '+35% credits per kill',
      apply: (g) => { g.boonKillMult *= 1.35; } },
    { id: 'core',      name: 'Reinforced Core',    icon: '🛡️', desc: '+6 max integrity and repair 6 now',
      apply: (g) => { g.maxHealth += 6; g.health = Math.min(g.maxHealth, g.health + 6); } },
    { id: 'interest',  name: 'Compound Interest',  icon: '📈', desc: '+5% of banked credits added each wave',
      apply: (g) => { g.boonInterest += 0.05; } },
    { id: 'regen',     name: 'Nanorepair Swarm',   icon: '✚', desc: 'Repair to full now + regen 2 integrity / wave',
      apply: (g) => { g.health = g.maxHealth; g.boonRegen += 2; } },
    { id: 'arsenal',   name: 'Surplus Arsenal',    icon: '🏭', desc: '-20% tower build cost',
      apply: (g) => { g.towerCostMult *= 0.8; } },
    { id: 'engineer',  name: 'Field Engineering',  icon: '🔧', desc: '-20% upgrade cost',
      apply: (g) => { g.upgradeCostMult *= 0.8; } }
];

// Pick `n` distinct boons at random. randFn defaults to Math.random (which
// the auto-tune harness re-seeds globally, preserving determinism there).
function rollBoonChoices(n, randFn) {
    const r = randFn || Math.random;
    const pool = BOONS.slice();
    const out = [];
    while (out.length < n && pool.length) {
        out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    }
    return out;
}

// -------------------------------------------------------------------------
// Backpack items (Backpack-Hero-style). Each item occupies a multi-cell
// SHAPE in the persistent backpack grid; the shape can be rotated. Effects
// are flat stat deltas summed across all PLACED items, then folded into the
// existing balance-safe run hooks (see Game.applyBackpack). `synergy` grants
// an extra delta for each orthogonally-adjacent cell belonging to an item
// carrying one of `tags`. Effects are deliberately modest and the grid is
// small, so total backpack power stays bounded.
//
// Stat keys (all optional): damage/fireRate/payout/kill (fractional, e.g.
// 0.06 = +6%), maxHP (flat), interest (fraction of bank/wave),
// towerCost/upgradeCost (fractional discount).
// shape: matrix of 0/1 rows; rarity drives salvage-roll weight + color.
// -------------------------------------------------------------------------
const BACKPACK_ITEMS = {
    plasma_cell:  { id: 'plasma_cell',  name: 'Plasma Cell',     rarity: 'common',   tags: ['power'],
                    shape: [[1]],                 effect: { damage: 0.06 },
                    desc: '+6% tower damage' },
    coolant_coil: { id: 'coolant_coil', name: 'Coolant Coil',    rarity: 'common',   tags: ['tech'],
                    shape: [[1],[1]],             effect: { fireRate: 0.05 },
                    desc: '+5% fire rate (1×2 column)' },
    credit_chip:  { id: 'credit_chip',  name: 'Credit Chip',     rarity: 'common',   tags: ['econ'],
                    shape: [[1]],                 effect: { payout: 0.08 },
                    desc: '+8% wave-completion payout' },
    interest_ledger: { id: 'interest_ledger', name: 'Interest Ledger', rarity: 'uncommon', tags: ['econ'],
                    shape: [[1,1]],               effect: { interest: 0.03 },
                    desc: '+3% of banked credits each wave' },
    targeting_core: { id: 'targeting_core', name: 'Targeting Core', rarity: 'uncommon', tags: ['power'],
                    shape: [[1,0],[1,1]],         effect: { damage: 0.10 },
                    synergy: { tags: ['tech'], perAdj: { damage: 0.03 }, max: 4 },
                    desc: '+10% damage; +3% more per adjacent tech item (max 4)' },
    bounty_module: { id: 'bounty_module', name: 'Bounty Module', rarity: 'uncommon', tags: ['econ'],
                    shape: [[1],[1],[1]],         effect: { kill: 0.18 },
                    desc: '+18% credits per kill (needs a 1×3 column)' },
    overclock_matrix: { id: 'overclock_matrix', name: 'Overclock Matrix', rarity: 'rare', tags: ['power','tech'],
                    shape: [[1,1,1],[0,1,0]],     effect: { damage: 0.14, fireRate: 0.08 },
                    desc: '+14% damage and +8% fire rate (T-shape)' },
    reactor_bulwark: { id: 'reactor_bulwark', name: 'Reactor Bulwark', rarity: 'rare', tags: ['core'],
                    shape: [[1,1],[1,1]],         effect: { maxHP: 8 },
                    synergy: { tags: ['core','tech'], perAdj: { maxHP: 2 }, max: 6 },
                    desc: '+8 max HP; +2 more per adjacent core/tech (max 6)' },
    fabricator: { id: 'fabricator', name: 'Fabricator', rarity: 'uncommon', tags: ['tech'],
                    shape: [[1,1],[1,0]],         effect: { towerCost: 0.08, upgradeCost: 0.08 },
                    desc: '−8% tower build & upgrade cost' },

    // ── Common pool (small footprints, modest bonuses) ────────────────────
    munition_pack: { id: 'munition_pack', name: 'Munition Pack', rarity: 'common', tags: ['power'],
                    shape: [[1]],                 effect: { damage: 0.05 },
                    desc: '+5% tower damage' },
    capacitor:    { id: 'capacitor',    name: 'Capacitor',       rarity: 'common', tags: ['tech'],
                    shape: [[1]],                 effect: { fireRate: 0.04 },
                    desc: '+4% fire rate' },
    bank_chip:    { id: 'bank_chip',    name: 'Bank Chip',       rarity: 'common', tags: ['econ'],
                    shape: [[1]],                 effect: { payout: 0.06 },
                    desc: '+6% wave-completion payout' },
    shield_emitter: { id: 'shield_emitter', name: 'Shield Emitter', rarity: 'common', tags: ['core'],
                    shape: [[1]],                 effect: { maxHP: 3 },
                    desc: '+3 max integrity' },
    flux_diode:   { id: 'flux_diode',   name: 'Flux Diode',      rarity: 'common', tags: ['tech','econ'],
                    shape: [[1]],                 effect: { kill: 0.08 },
                    desc: '+8% credits per kill' },
    patch_kit:    { id: 'patch_kit',    name: 'Patch Kit',       rarity: 'common', tags: ['core'],
                    shape: [[1]],                 effect: { regen: 1 },
                    desc: '+1 integrity regen per wave' },
    aim_assist:   { id: 'aim_assist',   name: 'Aim Assist',      rarity: 'common', tags: ['power'],
                    shape: [[1,1]],               effect: { damage: 0.07 },
                    desc: '+7% damage (1×2 row)' },
    cooler_fin:   { id: 'cooler_fin',   name: 'Cooler Fin',      rarity: 'common', tags: ['tech'],
                    shape: [[1],[1]],             effect: { fireRate: 0.06 },
                    desc: '+6% fire rate (1×2 column)' },
    cargo_pod:    { id: 'cargo_pod',    name: 'Cargo Pod',       rarity: 'common', tags: ['econ'],
                    shape: [[1,1]],               effect: { payout: 0.10 },
                    desc: '+10% wave payout (1×2 row)' },
    spark_plug:   { id: 'spark_plug',   name: 'Spark Plug',      rarity: 'common', tags: ['power'],
                    shape: [[1],[1]],             effect: { damage: 0.08 },
                    desc: '+8% damage (1×2 column)' },
    reserve_vault: { id: 'reserve_vault', name: 'Reserve Vault', rarity: 'common', tags: ['econ'],
                    shape: [[1]],                 effect: { startMoney: 25 },
                    desc: '+25¢ starting credits' },

    // ── Uncommon pool (mid footprints, ~12–20 % effects, occasional adj) ──
    gauss_array:  { id: 'gauss_array',  name: 'Gauss Array',     rarity: 'uncommon', tags: ['power'],
                    shape: [[1,0],[1,1]],         effect: { damage: 0.12 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.02 }, max: 4 },
                    desc: '+12% damage; +2% per adjacent power item (max 4)' },
    tachyon_coil: { id: 'tachyon_coil', name: 'Tachyon Coil',    rarity: 'uncommon', tags: ['tech'],
                    shape: [[1],[1],[1]],         effect: { fireRate: 0.11 },
                    desc: '+11% fire rate (1×3 column)' },
    merchant_pad: { id: 'merchant_pad', name: 'Merchant Pad',    rarity: 'uncommon', tags: ['econ'],
                    shape: [[1,1,1]],             effect: { payout: 0.14 },
                    desc: '+14% wave payout (1×3 row)' },
    salvage_drone: { id: 'salvage_drone', name: 'Salvage Drone', rarity: 'uncommon', tags: ['econ','tech'],
                    shape: [[0,1],[1,1]],         effect: { kill: 0.20 },
                    desc: '+20% credits per kill' },
    overdrive_chip: { id: 'overdrive_chip', name: 'Overdrive Chip', rarity: 'uncommon', tags: ['power','tech'],
                    shape: [[1,1],[1,1]],         effect: { damage: 0.09, fireRate: 0.05 },
                    desc: '+9% damage, +5% fire rate (2×2)' },
    hardened_plate: { id: 'hardened_plate', name: 'Hardened Plate', rarity: 'uncommon', tags: ['core'],
                    shape: [[1],[1],[1]],         effect: { maxHP: 5, regen: 1 },
                    desc: '+5 max integrity, +1 regen per wave' },
    capital_fund: { id: 'capital_fund', name: 'Capital Fund',    rarity: 'uncommon', tags: ['econ'],
                    shape: [[1,1]],               effect: { interest: 0.06 },
                    desc: '+6% of banked credits each wave' },
    recycler:     { id: 'recycler',     name: 'Recycler',        rarity: 'uncommon', tags: ['tech'],
                    shape: [[1,0],[1,1]],         effect: { towerCost: 0.12 },
                    desc: '−12% tower build cost' },
    engineer_kit: { id: 'engineer_kit', name: 'Engineer Kit',    rarity: 'uncommon', tags: ['tech'],
                    shape: [[0,1],[1,1]],         effect: { upgradeCost: 0.12 },
                    desc: '−12% upgrade cost' },
    med_bay:      { id: 'med_bay',      name: 'Med Bay',         rarity: 'uncommon', tags: ['core'],
                    shape: [[1,1]],               effect: { regen: 2 },
                    desc: '+2 integrity regen per wave' },

    // ── Rare pool (big shapes, headline effects, strong synergies) ────────
    singularity_lens: { id: 'singularity_lens', name: 'Singularity Lens', rarity: 'rare', tags: ['power','tech'],
                    shape: [[1,1,1],[0,1,0]],     effect: { damage: 0.18, fireRate: 0.10 },
                    desc: '+18% damage and +10% fire rate (T-shape)' },
    plasma_battery: { id: 'plasma_battery', name: 'Plasma Battery', rarity: 'rare', tags: ['power','core'],
                    shape: [[1,1],[1,1]],         effect: { damage: 0.10, maxHP: 4 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.01 }, max: 8 },
                    desc: '+10% damage, +4 max HP; +1% damage per adjacent power cell (max 8)' },
    orbital_uplink: { id: 'orbital_uplink', name: 'Orbital Uplink', rarity: 'rare', tags: ['econ'],
                    shape: [[1],[1],[1],[1]],     effect: { payout: 0.25 },
                    desc: '+25% wave payout (long 1×4 column)' },
    arc_capacitor: { id: 'arc_capacitor', name: 'Arc Capacitor',  rarity: 'rare', tags: ['tech'],
                    shape: [[1,1,0],[0,1,1]],     effect: { fireRate: 0.14 },
                    synergy: { tags: ['tech'], perAdj: { fireRate: 0.01 }, max: 6 },
                    desc: '+14% fire rate; +1% per adjacent tech (max 6)' },
    aegis_module: { id: 'aegis_module', name: 'Aegis Module',    rarity: 'rare', tags: ['core','tech'],
                    shape: [[1,1],[1,1]],         effect: { maxHP: 6, regen: 2 },
                    synergy: { tags: ['core','tech'], perAdj: { maxHP: 3 }, max: 6 },
                    desc: '+6 max HP, +2 regen; +3 max HP per adjacent core/tech (max 6)' },
    mint_array:   { id: 'mint_array',   name: 'Mint Array',      rarity: 'rare', tags: ['econ'],
                    shape: [[1,1,1],[1,1,1]],     effect: { interest: 0.10, payout: 0.10 },
                    desc: '+10% interest and +10% wave payout (big 2×3 — needs an expanded bag)' },
    oracle_chip:  { id: 'oracle_chip',  name: 'Oracle Chip',     rarity: 'rare', tags: ['power'],
                    shape: [[0,1,0],[1,1,1]],     effect: { damage: 0.20 },
                    synergy: { tags: ['tech'], perAdj: { damage: 0.04 }, max: 5 },
                    desc: '+20% damage; +4% per adjacent tech (max 5)' },
    treasury:     { id: 'treasury',     name: 'Treasury',        rarity: 'rare', tags: ['econ'],
                    shape: [[1,1],[1,0]],         effect: { startMoney: 100, interest: 0.05 },
                    desc: '+100¢ starting credits, +5% banked credits each wave' },

    // ── Common (6 more, single/double-cell footprints) ────────────────────
    tactical_sight: { id: 'tactical_sight', name: 'Tactical Sight', rarity: 'common', tags: ['power'],
                    shape: [[1]],                 effect: { damage: 0.05 },
                    desc: '+5% tower damage' },
    coin_cache:   { id: 'coin_cache',   name: 'Coin Cache',      rarity: 'common', tags: ['econ'],
                    shape: [[1,1]],               effect: { startMoney: 30 },
                    desc: '+30¢ starting credits (1×2 row)' },
    iron_strap:   { id: 'iron_strap',   name: 'Iron Strap',      rarity: 'common', tags: ['core'],
                    shape: [[1],[1]],             effect: { maxHP: 4 },
                    desc: '+4 max integrity (1×2 column)' },
    glow_tube:    { id: 'glow_tube',    name: 'Glow Tube',       rarity: 'common', tags: ['tech'],
                    shape: [[1]],                 effect: { upgradeCost: 0.04 },
                    desc: '−4% upgrade cost' },
    booster_pin:  { id: 'booster_pin',  name: 'Booster Pin',     rarity: 'common', tags: ['power'],
                    shape: [[1],[1]],             effect: { damage: 0.06, fireRate: 0.02 },
                    desc: '+6% damage and +2% fire rate (1×2 column)' },
    field_patch:  { id: 'field_patch',  name: 'Field Patch',     rarity: 'common', tags: ['core'],
                    shape: [[1]],                 effect: { regen: 1, maxHP: 1 },
                    desc: '+1 max HP and +1 integrity regen per wave' },

    // ── Uncommon (6 more, L/Z/S/2×2 shapes) ────────────────────────────────
    stabilizer:   { id: 'stabilizer',   name: 'Stabilizer',      rarity: 'uncommon', tags: ['core'],
                    shape: [[0,1],[1,1]],         effect: { maxHP: 4, regen: 1 },
                    desc: '+4 max HP and +1 regen per wave' },
    vault_key:    { id: 'vault_key',    name: 'Vault Key',       rarity: 'uncommon', tags: ['econ'],
                    shape: [[1],[1],[1]],         effect: { interest: 0.08 },
                    desc: '+8% of banked credits each wave (1×3 column)' },
    caster_bay:   { id: 'caster_bay',   name: 'Caster Bay',      rarity: 'uncommon', tags: ['power','tech'],
                    shape: [[0,1,1],[1,1,0]],     effect: { damage: 0.10, fireRate: 0.06 },
                    desc: '+10% damage and +6% fire rate (S-piece)' },
    trade_hub:    { id: 'trade_hub',    name: 'Trade Hub',       rarity: 'uncommon', tags: ['econ'],
                    shape: [[1,1],[1,1]],         effect: { payout: 0.14, kill: 0.08 },
                    desc: '+14% wave payout and +8% per-kill credits (2×2)' },
    forge_press: { id: 'forge_press',   name: 'Forge Press',     rarity: 'uncommon', tags: ['tech'],
                    shape: [[1,0],[1,1]],         effect: { damage: 0.08, fireRate: 0.08 },
                    desc: '+8% damage and +8% fire rate (L-piece)' },
    drone_hive:   { id: 'drone_hive',   name: 'Drone Hive',      rarity: 'uncommon', tags: ['tech','power'],
                    shape: [[1],[1],[1]],         effect: { fireRate: 0.13 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.02 }, max: 4 },
                    desc: '+13% fire rate; +2% damage per adjacent power item (max 4)' },

    // ── Rare (6 more, big shapes + strong adjacency) ──────────────────────
    cluster_ring: { id: 'cluster_ring', name: 'Cluster Ring',    rarity: 'rare', tags: ['power'],
                    shape: [[1,1,0],[0,1,1]],     effect: { damage: 0.18 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.03 }, max: 6 },
                    desc: '+18% damage; +3% per adjacent power item (max 6) (Z-piece)' },
    hyperloop:    { id: 'hyperloop',    name: 'Hyperloop',       rarity: 'rare', tags: ['econ'],
                    shape: [[1],[1],[1],[1]],     effect: { payout: 0.30 },
                    desc: '+30% wave payout (1×4 column — needs an expanded bag)' },
    carbon_spine: { id: 'carbon_spine', name: 'Carbon Spine',    rarity: 'rare', tags: ['core'],
                    shape: [[1,1,1],[1,1,1]],     effect: { maxHP: 10, regen: 2 },
                    synergy: { tags: ['core','tech'], perAdj: { maxHP: 1 }, max: 8 },
                    desc: '+10 max HP, +2 regen; +1 max HP per adjacent core/tech (max 8)' },
    tachyon_lance: { id: 'tachyon_lance', name: 'Tachyon Lance', rarity: 'rare', tags: ['power','tech'],
                    shape: [[1,1,1],[0,1,0]],     effect: { damage: 0.22, fireRate: 0.12 },
                    desc: '+22% damage and +12% fire rate (T-piece)' },
    auto_banker:  { id: 'auto_banker',  name: 'Auto-Banker',     rarity: 'rare', tags: ['econ'],
                    shape: [[0,1,1],[1,1,0]],     effect: { kill: 0.25, interest: 0.05 },
                    desc: '+25% credits per kill and +5% banked credits each wave (S-piece)' },
    sigil_greed:  { id: 'sigil_greed',  name: 'Sigil of Greed',  rarity: 'rare', tags: ['econ'],
                    shape: [[1,1,1]],             effect: { payout: 0.25, startMoney: 25 },
                    desc: '+25% wave payout and +25¢ starting credits (1×3 row)' },

    // ── Epic (6 brand new) ────────────────────────────────────────────────
    singularity_core: { id: 'singularity_core', name: 'Singularity Core', rarity: 'epic', tags: ['power','core'],
                    shape: [[1,1],[1,1]],         effect: { damage: 0.15, maxHP: 6 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.02 }, max: 6 },
                    desc: '+15% damage, +6 max HP; +2% damage per adjacent power cell (max 6)' },
    quantum_forge: { id: 'quantum_forge', name: 'Quantum Forge', rarity: 'epic', tags: ['power','tech'],
                    shape: [[1,1,1],[1,1,1]],     effect: { damage: 0.12, fireRate: 0.10, upgradeCost: 0.05 },
                    desc: '+12% damage, +10% fire rate, −5% upgrade cost (2×3 — needs an expanded bag)' },
    eternal_engine: { id: 'eternal_engine', name: 'Eternal Engine', rarity: 'epic', tags: ['power'],
                    shape: [[1],[1],[1],[1]],     effect: { damage: 0.30 },
                    desc: '+30% damage (1×4 column)' },
    mint_foundry: { id: 'mint_foundry', name: 'Mint Foundry',    rarity: 'epic', tags: ['econ'],
                    shape: [[1,1],[1,1]],         effect: { payout: 0.40, interest: 0.12 },
                    desc: '+40% wave payout and +12% interest (2×2)' },
    citadel_pylon: { id: 'citadel_pylon', name: 'Citadel Pylon', rarity: 'epic', tags: ['core'],
                    shape: [[1],[1],[1],[1]],     effect: { maxHP: 15, regen: 4 },
                    desc: '+15 max integrity and +4 regen per wave (1×4 column)' },
    phase_inverter: { id: 'phase_inverter', name: 'Phase Inverter', rarity: 'epic', tags: ['tech'],
                    shape: [[0,1,0],[1,1,1]],     effect: { fireRate: 0.18, damage: 0.08 },
                    synergy: { tags: ['tech'], perAdj: { fireRate: 0.02 }, max: 6 },
                    desc: '+18% fire rate, +8% damage; +2% rate per adjacent tech (max 6)' },

    // ── Legendary (4 trophies — multi-stat, build-defining) ───────────────
    black_hole:   { id: 'black_hole',   name: 'Black Hole',      rarity: 'legendary', tags: ['power'],
                    shape: [[1,1],[1,1]],         effect: { damage: 0.50 },
                    synergy: { tags: ['power'], perAdj: { damage: 0.06 }, max: 8 },
                    desc: '+50% damage; +6% per adjacent power cell (max 8)' },
    aurora_reactor: { id: 'aurora_reactor', name: 'Aurora Reactor', rarity: 'legendary', tags: ['power','tech','core'],
                    shape: [[1,1,1],[1,1,1]],     effect: { damage: 0.10, fireRate: 0.08, maxHP: 8, regen: 2, payout: 0.15 },
                    desc: '+10% damage, +8% fire rate, +8 max HP, +2 regen, +15% payout (2×3)' },
    genesis_module: { id: 'genesis_module', name: 'Genesis Module', rarity: 'legendary', tags: ['power','tech','econ','core'],
                    shape: [[1,1],[1,1]],         effect: { damage: 0.15, fireRate: 0.10, payout: 0.20, maxHP: 5 },
                    desc: '+15% damage, +10% fire rate, +20% payout, +5 max HP (2×2 — all four tag groups)' },
    omnicore:     { id: 'omnicore',     name: 'Omnicore',        rarity: 'legendary', tags: ['power','tech','econ','core'],
                    shape: [[1,1,1],[1,1,1]],     effect: { damage: 0.12, fireRate: 0.10, payout: 0.15, maxHP: 8, regen: 3, startMoney: 100 },
                    desc: '+12% damage, +10% fire rate, +15% payout, +8 max HP, +3 regen, +100¢ start (2×3)' },
};

// Five tiers — adding epic + legendary on top of the original three.
// Weights sum to 100 so the math is easy to reason about; epic/legendary
// stay rare enough to feel like trophies (each ascension push noticeably
// improves the odds via lootWeights() in backpack.js).
const BACKPACK_RARITY_WEIGHT = { common: 50, uncommon: 28, rare: 14, epic: 6, legendary: 2 };

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
