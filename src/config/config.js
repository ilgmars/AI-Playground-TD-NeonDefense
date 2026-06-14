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
// ASCENSION_TIERS lists the *named* tiers (A0 … A10). Anything above 10 is
// generated procedurally — each step beyond A10 stacks a small
// multiplier bump so difficulty climbs forever. ASCENSION_NAMED_MAX_TIER
// keeps the named upper bound; ASCENSION_MAX_TIER is retained as an alias
// equal to Infinity so legacy clamp expressions become no-ops.
const ASCENSION_NAMED_MAX_TIER = 10;
const ASCENSION_MAX_TIER = Infinity;
const ASCENSION_MAX_TIER_M1 = 7; // tiers above this are reserved for Milestone 3
// Per-step multipliers applied to every tier past A10. Steep on purpose —
// each extra tier compounds: +20% HP / +10% count / −8% payout. By A20
// that's roughly 6× HP and 2.5× count versus baseline, with payouts
// nearly halved. Endless is meant to wall players relatively fast so
// the high-score table has real spread.
const ASCENSION_ENDLESS_STEP = { hpMult: 1.20, countMult: 1.10, payoutMult: 0.92 };

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

// Returns the cumulative effect map for a tier. All multipliers start at
// 1.0 and are composed by multiplying every modifier up to and including
// `tier`. Tiers above the named table (A10) stack ASCENSION_ENDLESS_STEP
// per extra tier — difficulty is endless.
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

    const safeTier = Math.max(0, tier | 0);
    const namedTop = Math.min(safeTier, ASCENSION_NAMED_MAX_TIER);

    for (let i = 1; i <= namedTop; i++) {
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

    // Endless climb: each step past A10 stacks the small bump.
    const overshoot = Math.max(0, safeTier - ASCENSION_NAMED_MAX_TIER);
    if (overshoot > 0) {
        effects.hpMult     *= Math.pow(ASCENSION_ENDLESS_STEP.hpMult,     overshoot);
        effects.countMult  *= Math.pow(ASCENSION_ENDLESS_STEP.countMult,  overshoot);
        effects.payoutMult *= Math.pow(ASCENSION_ENDLESS_STEP.payoutMult, overshoot);
    }
    return effects;
}

// Spec lookup for any tier (named OR endless). Used by UI to render labels.
function getAscensionTierSpec(tier) {
    const t = Math.max(0, tier | 0);
    if (t <= ASCENSION_NAMED_MAX_TIER) {
        return ASCENSION_TIERS[t] || { tier: t, label: 'A' + t, name: 'Unknown', modifier: null, kind: 'stat' };
    }
    const overshoot = t - ASCENSION_NAMED_MAX_TIER;
    return {
        tier: t,
        label: 'A' + t,
        name: 'Endless +' + overshoot,
        modifier: ASCENSION_ENDLESS_STEP,
        kind: 'endless'
    };
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
    silo:     { cost: 400, range: 150, damage: 140, fireRate: 80,
                displayName: 'Silo',      defaultTargetMode: 'mostHp',
                maxHover: 4, splash: 55 },
    income:   { cost: 200, range: 0,   damage: 0,   fireRate: 0,
                displayName: 'Relay',     defaultTargetMode: 'closest',
                incomePerWave: 20 },

    // Tech-tree-unlocked extra towers (Arsenal branch). Both compose
    // EXISTING behaviour flags so they need no entities.js dispatch case:
    //   mortar    → fires via the default projectile branch + splash explode
    //               (long range, big AoE, slow cadence — siege artillery).
    //   disruptor → default branch projectile that applies the source tower's
    //               slowEffect/slowDuration on hit (entities.js Projectile),
    //               with a small splash — a low-damage area-slow support tower.
    // Build buttons are hidden until the granting node is owned (main.js).
    mortar:    { cost: 350, range: 280, damage: 90,  fireRate: 130,
                 displayName: 'Mortar',    defaultTargetMode: 'mostHp',
                 splash: 70 },
    disruptor: { cost: 250, range: 160, damage: 6,   fireRate: 45,
                 displayName: 'Disruptor', defaultTargetMode: 'first',
                 splash: 45, slowEffect: 0.45, slowDuration: 90 },
    // Railgun: extreme range, heavy single-shot that PIERCES a line of enemies.
    // Fires via the default projectile branch; pierce handled by Projectile.
    railgun:   { cost: 300, range: 320, damage: 70,  fireRate: 110,
                 displayName: 'Railgun',   defaultTargetMode: 'first',
                 pierce: 3 },
    // Beacon: pure SUPPORT — no attack (range 0), projects a damage aura to
    // nearby towers (Game.applyAura reads any tower with auraBonus). Passive,
    // so it short-circuits combat in Tower.update like income towers.
    beacon:    { cost: 275, range: 0,   damage: 0,   fireRate: 0,
                 displayName: 'Beacon',    defaultTargetMode: 'closest',
                 auraBonus: 0.06, auraRange: 3 },

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
    air:    { hp: 25, speed: 0.6, reward: 8,  radius: 14, defense: 0.08 },
    // Shortcut-cutter: mostly follows the road, but at precomputed
    // U-bends it crawls straight across the grass at 0.45× speed,
    // skipping the detour (GameMap.computeShortcuts + Enemy._crawl).
    // Tanky enough to survive the exposed crossing; pays a premium.
    cutter: { hp: 45, speed: 0.85, reward: 12, radius: 13, defense: 0.12 }
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
    endOfWavePayoutPerWave: 6,    // Better scaling
    // Shortcut-cutter introduction. From cutterFromWave, every Nth
    // spawn of a TANK wave is a cutter (index-based — deterministic
    // for MP); from cutterNormalFromWave the same applies to NORMAL
    // waves at a sparser cadence.
    cutterFromWave: 15,
    cutterEveryNth: 3,
    cutterNormalFromWave: 25,
    cutterNormalEveryNth: 6
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
        income:   w => w >= 5 ? Math.min(14, Math.max(1, Math.floor(w / 7))) : 0, // earlier + denser — relays pay back fast and fund everything else
        // Tree-unlocked towers — modest targets (advanced unlocks); only built
        // once the player owns them (the autopilot zeroes wanted for locked
        // types). Keeps composition diverse without destabilising the curve.
        mortar:    w => w >= 12 ? Math.min(6, Math.ceil(w / 10)) : 0,           // siege splash
        railgun:   w => w >= 14 ? Math.min(6, Math.ceil(w / 10)) : 0,           // line-pierce
        disruptor: w => w >= 10 ? Math.min(4, Math.ceil(w / 14)) : 0,           // area slow support
        beacon:    w => w >= 12 ? Math.min(3, Math.ceil(w / 18)) : 0            // damage aura support
    },

    // Order used when scanning for the biggest tower-count deficit.
    buildOrder: ['flak', 'laser', 'sniper', 'rocket', 'silo', 'electric', 'mortar', 'railgun', 'basic', 'rapid', 'disruptor', 'beacon', 'income'],

    // Priority weight when choosing which tower to upgrade (higher = prefer).
    // Income bumped 2 → 6: relay upgrades have multiplicative payoff on every
    // future wave, so they're competitive with mid-tier combat upgrades.
    upgradeValue: { silo: 10, rocket: 9, railgun: 9, mortar: 8, electric: 8, sniper: 7, income: 6, laser: 6, flak: 5, disruptor: 5, beacon: 4, rapid: 4, basic: 3 },

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
    ],
    mortar: [
        { name: 'Warhead',  desc: 'More damage & blast radius', baseCost: 250, costMult: 1.6, apply: (t) => { t.damage += 40; t.splash = (t.splash || 70) + 15; } },
        { name: 'Spotter',  desc: 'Increases range',            baseCost: 150, costMult: 1.4, apply: (t) => { t.range += 40; } },
        { name: 'Autoload', desc: 'Fires faster',               baseCost: 300, costMult: 1.7, apply: (t) => { t.fireRate = Math.max(40, Math.floor(t.fireRate * 0.8)); } }
    ],
    disruptor: [
        { name: 'Field',     desc: 'Stronger slow effect',  baseCost: 200, costMult: 1.6, apply: (t) => { t.slowEffect = Math.min(0.85, (t.slowEffect || 0.45) + 0.15); } },
        { name: 'Radius',    desc: 'Larger slow field',      baseCost: 150, costMult: 1.5, apply: (t) => { t.splash += 20; } },
        { name: 'Capacitor', desc: 'Fires faster',           baseCost: 200, costMult: 1.6, apply: (t) => { t.fireRate = Math.max(15, Math.floor(t.fireRate * 0.8)); } }
    ],
    railgun: [
        { name: 'Slug',       desc: 'Heavier round (more damage)', baseCost: 250, costMult: 1.6, apply: (t) => { t.damage += 45; } },
        { name: 'Penetrator', desc: 'Pierces more enemies',        baseCost: 220, costMult: 1.8, apply: (t) => { t.pierce = (t.pierce || 3) + 1; } },
        { name: 'Cooling',    desc: 'Fires faster',                baseCost: 280, costMult: 1.6, apply: (t) => { t.fireRate = Math.max(40, Math.floor(t.fireRate * 0.8)); } }
    ],
    beacon: [
        { name: 'Amplifier', desc: 'Stronger damage aura',  baseCost: 300, costMult: 1.7, apply: (t) => { t.auraBonus = (t.auraBonus || 0.06) + 0.03; } },
        { name: 'Antenna',   desc: 'Larger aura radius',     baseCost: 250, costMult: 1.6, apply: (t) => { t.auraRange = (t.auraRange || 3) + 1; } },
        { name: 'Overcharge',desc: 'Even stronger aura',     baseCost: 400, costMult: 1.8, apply: (t) => { t.auraBonus = (t.auraBonus || 0.06) + 0.04; } }
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
// Tech Tree v2 — a branched passive/unlock graph (replaces the old 3×5
// tier list). Nodes live in a flat `id -> def` map and connect via prereq
// edges (`requires`). Logic (eligibility, escalating cost, respec, effect
// summing) lives in src/progression/tree.js; rendering in main.js computes
// layout from `branch` + prereq depth (no hand-authored coordinates).
//
// Node def:
//   branch    one of TREE_BRANCHES (cluster the node belongs to)
//   name/desc UI strings
//   kind      glyph hint (TREE_KIND_GLYPH in main.js)
//   baseCost  per-node base XP — the *variable* cost. Effective cost adds a
//             global escalator: baseCost * TREE_COST_GROWTH^(owned nodes).
//   requires  prereq node ids ([] = root, wired to CORE; always reachable)
//   effect    optional passive stat deltas, SAME keys the backpack uses
//             (damage/fireRate/payout/kill/interest/startMoney/maxHP/regen/
//             towerCost/upgradeCost). Negative = a keystone downside.
//             Summed by NeonTree.computeStats → Game.applyMetaPassives.
//   grants    optional unlock id pushed into unlockedNodes on purchase, read
//             by EXISTING consumers (ability.*/hero.*/kit.*/qol.* unchanged;
//             variant.all + tower.* are new gates in game.js/main.js).
//   keystone  build-defining capstone (bigger effect, deep, expensive).
//
// Escalating cost + shared CORE + prereq depth make a full clear
// astronomically priced, so players SPECIALISE into a build. Pre-unlocks
// (hero.pioneer/kit.standard) and ascension auto-grants are RESPEC_PROTECTED
// (kept on respec, never refunded, never counted toward escalation).
// -------------------------------------------------------------------------
const TREE_BRANCHES = {
    offense:   { name: 'OFFENSE',   color: '#f87171' },
    economy:   { name: 'ECONOMY',   color: '#fbbf24' },
    fortify:   { name: 'FORTIFY',   color: '#4ade80' },
    arsenal:   { name: 'ARSENAL',   color: '#a78bfa' },
    intel:     { name: 'INTEL',     color: '#38bdf8' },
    ascendant: { name: 'ASCENDANT', color: '#f472b6' }
};

// Global escalator: every allocatable node owned makes the NEXT one pricier.
const TREE_COST_GROWTH = 1.2;   // steep: by ~node 10 each costs ~6x base, ~38x by node 20 — forces committing to a path

// Towers NOT buildable by default — unlocked by a tree node that grants
// 'tower.<type>'. The core attack towers stay free; the Relay/income support
// tower + the tree-only towers live here. Build buttons hide until unlocked.
// Towers that must be unlocked in the tech tree before they can be built.
// Only Blaster, Sniper and Flak are free at the start — everything else
// (the rest of the core arsenal + the support/new towers) is gated.
const TREE_GATED_TOWERS = ['rapid', 'laser', 'rocket', 'electric', 'silo',
    'income', 'mortar', 'disruptor', 'railgun', 'beacon'];

// Respec refunds this fraction of total XP spent into the tree.
const TREE_RESPEC_REFUND = 0.30;

// Never cleared/refunded by respec, never counted toward escalation:
// the two pre-unlocks plus the four ascension auto-grant ids.
const RESPEC_PROTECTED = [
    'hero.pioneer', 'kit.standard',
    'kit.economist', 'qol.hpbars', 'qol.dailyseed', 'qol.skipsetup'
];

const TECH_TREE = {
    // ── OFFENSE — damage & fire rate ──────────────────────────────────────
    off_dmg1:  { branch: 'offense', name: 'Calibrated Barrels', kind: 'damage', baseCost: 40,  requires: [],                        effect: { damage: 0.05 },   desc: '+5% tower damage.' },
    off_rate1: { branch: 'offense', name: 'Feed Mechanism',     kind: 'rate',   baseCost: 40,  requires: [],                        effect: { fireRate: 0.05 }, desc: '+5% fire rate.' },
    off_dmg2:  { branch: 'offense', name: 'Hardened Rounds',    kind: 'damage', baseCost: 90,  requires: ['off_dmg1'],              effect: { damage: 0.06 },   desc: '+6% tower damage.' },
    off_rate2: { branch: 'offense', name: 'Servo Loaders',      kind: 'rate',   baseCost: 90,  requires: ['off_rate1'],             effect: { fireRate: 0.06 }, desc: '+6% fire rate.' },
    off_dmg3:  { branch: 'offense', name: 'AP Cores',           kind: 'damage', baseCost: 160, requires: ['off_dmg2'],              effect: { damage: 0.08 },   desc: '+8% tower damage.' },
    off_rate3: { branch: 'offense', name: 'Overclocked Coils',  kind: 'rate',   baseCost: 160, requires: ['off_rate2'],             effect: { fireRate: 0.08 }, desc: '+8% fire rate.' },
    off_focus: { branch: 'offense', name: 'Targeting Uplink',   kind: 'mixed',  baseCost: 220, requires: ['off_dmg2', 'off_rate2'], effect: { damage: 0.06, fireRate: 0.04 }, desc: '+6% damage and +4% fire rate.' },
    off_dmg4:  { branch: 'offense', name: 'Antimatter Slugs',   kind: 'damage', baseCost: 320, requires: ['off_dmg3'],              effect: { damage: 0.10 },   desc: '+10% tower damage.' },
    off_key:   { branch: 'offense', name: 'Glass Cannon',       kind: 'keystone', keystone: true, baseCost: 700, requires: ['off_dmg4', 'off_focus'], effect: { damage: 0.25, fireRate: 0.12, towerCost: -0.15 }, desc: 'KEYSTONE: +25% damage, +12% fire rate — but towers cost 15% more.' },

    // ── ECONOMY — credits, payout, interest ───────────────────────────────
    eco_pay1:   { branch: 'economy', name: 'Bounty Board',     kind: 'payout',   baseCost: 40,  requires: [],            effect: { payout: 0.06 },   desc: '+6% wave-completion payout.' },
    eco_kill1:  { branch: 'economy', name: 'Scrap Collectors', kind: 'kill',     baseCost: 40,  requires: [],            effect: { kill: 0.08 },     desc: '+8% credits per kill.' },
    eco_pay2:   { branch: 'economy', name: 'War Bonds',        kind: 'payout',   baseCost: 90,  requires: ['eco_pay1'],  effect: { payout: 0.08 },   desc: '+8% wave-completion payout.' },
    eco_int1:   { branch: 'economy', name: 'Reserve Account',  kind: 'interest', baseCost: 120, requires: ['eco_pay1'],  effect: { interest: 0.03 }, desc: '+3% of banked credits each wave.' },
    eco_start1: { branch: 'economy', name: 'Seed Capital',     kind: 'money',    baseCost: 90,  requires: ['eco_kill1'], effect: { startMoney: 50 }, desc: '+50¢ starting credits.' },
    eco_kill2:  { branch: 'economy', name: 'Black Market',     kind: 'kill',     baseCost: 160, requires: ['eco_kill1'], effect: { kill: 0.12 },     desc: '+12% credits per kill.' },
    eco_disc:   { branch: 'economy', name: 'Bulk Contracts',   kind: 'cost',     baseCost: 220, requires: ['eco_pay2'],  effect: { towerCost: 0.06, upgradeCost: 0.06 }, desc: '−6% tower build & upgrade cost.' },
    eco_int2:   { branch: 'economy', name: 'Compound Vault',   kind: 'interest', baseCost: 300, requires: ['eco_int1'],  effect: { interest: 0.05 }, desc: '+5% of banked credits each wave.' },
    eco_key:    { branch: 'economy', name: 'Greed Doctrine',   kind: 'keystone', keystone: true, baseCost: 700, requires: ['eco_int2', 'eco_disc'], effect: { payout: 0.30, interest: 0.10, kill: -0.15 }, desc: 'KEYSTONE: +30% payout, +10% interest — but −15% credits per kill.' },

    // ── FORTIFY — integrity & regen ───────────────────────────────────────
    def_hp1:   { branch: 'fortify', name: 'Plated Core',          kind: 'hp',    baseCost: 40,  requires: [],                       effect: { maxHP: 4 },    desc: '+4 max integrity.' },
    def_reg1:  { branch: 'fortify', name: 'Repair Drones',        kind: 'regen', baseCost: 40,  requires: [],                       effect: { regen: 1 },    desc: '+1 integrity regen per wave.' },
    def_hp2:   { branch: 'fortify', name: 'Reinforced Bulkheads', kind: 'hp',    baseCost: 90,  requires: ['def_hp1'],              effect: { maxHP: 5 },    desc: '+5 max integrity.' },
    def_reg2:  { branch: 'fortify', name: 'Nanite Swarm',         kind: 'regen', baseCost: 120, requires: ['def_reg1'],             effect: { regen: 1 },    desc: '+1 integrity regen per wave.' },
    def_hp3:   { branch: 'fortify', name: 'Ablative Armor',       kind: 'hp',    baseCost: 160, requires: ['def_hp2'],              effect: { maxHP: 6 },    desc: '+6 max integrity.' },
    def_field: { branch: 'fortify', name: 'Field Hospital',       kind: 'mixed', baseCost: 220, requires: ['def_hp2', 'def_reg1'],  effect: { maxHP: 6, regen: 1 }, desc: '+6 max integrity and +1 regen per wave.' },
    def_hp4:   { branch: 'fortify', name: 'Titanium Frame',       kind: 'hp',    baseCost: 320, requires: ['def_hp3'],              effect: { maxHP: 8 },    desc: '+8 max integrity.' },
    def_reg3:  { branch: 'fortify', name: 'Self-Repair Matrix',   kind: 'regen', baseCost: 300, requires: ['def_reg2'],             effect: { regen: 2 },    desc: '+2 integrity regen per wave.' },
    def_key:   { branch: 'fortify', name: 'Bastion Protocol',     kind: 'keystone', keystone: true, baseCost: 700, requires: ['def_hp4', 'def_field'], effect: { maxHP: 15, regen: 3, fireRate: -0.10 }, desc: 'KEYSTONE: +15 max integrity, +3 regen — but −10% fire rate.' },

    // ── ARSENAL — unlock abilities, heroes, kits, variants & extra towers ──
    ars_scan:      { branch: 'arsenal', name: 'Recon Uplink',          kind: 'ability', baseCost: 60,  requires: [],             grants: 'ability.scan',      desc: 'Unlock the Scan ability (reveal the next 3 waves).' },
    ars_eng:       { branch: 'arsenal', name: 'Field Engineer',        kind: 'hero',    baseCost: 80,  requires: [],             grants: 'hero.engineer',     desc: 'Unlock the Engineer hero (−10% tower / −5% upgrade cost).' },
    ars_econ:      { branch: 'arsenal', name: 'Economist Kit',         kind: 'kit',     baseCost: 80,  requires: [],             grants: 'kit.economist',     desc: 'Unlock the Economist starter kit.' },
    ars_air:       { branch: 'arsenal', name: 'Orbital Authorization', kind: 'ability', baseCost: 180, requires: ['ars_scan'],   grants: 'ability.airstrike', desc: 'Unlock the Airstrike ability.' },
    ars_warden:    { branch: 'arsenal', name: 'Warden Doctrine',       kind: 'hero',    baseCost: 200, requires: ['ars_eng'],    grants: 'hero.warden',       desc: 'Unlock the Warden hero (+5 max HP; repairs heal +1).' },
    ars_medic:     { branch: 'arsenal', name: 'Medic Kit',             kind: 'kit',     baseCost: 160, requires: ['ars_econ'],   grants: 'kit.medic',         desc: 'Unlock the Medic starter kit.' },
    ars_freeze:    { branch: 'arsenal', name: 'Cryo Authorization',    kind: 'ability', baseCost: 300, requires: ['ars_air'],    grants: 'ability.freeze',    desc: 'Unlock the Freeze Wave ability.' },
    ars_strat:     { branch: 'arsenal', name: 'Strategist Kit',        kind: 'kit',     baseCost: 280, requires: ['ars_medic'],  grants: 'kit.strategist',    desc: 'Unlock the Strategist starter kit.' },
    ars_variants:  { branch: 'arsenal', name: 'Variant Protocols',     kind: 'variant', baseCost: 350, requires: ['ars_air'],    grants: 'variant.all',       desc: "Unlock every tower's alternate variant immediately (no mastery grind)." },
    ars_mortar:    { branch: 'arsenal', name: 'Mortar Battery',        kind: 'tower', keystone: true, baseCost: 450, requires: ['ars_variants'], grants: 'tower.mortar',    desc: 'Unlock the MORTAR tower — long-range siege artillery (big splash, slow cadence).' },
    ars_disruptor: { branch: 'arsenal', name: 'Disruptor Array',       kind: 'tower', keystone: true, baseCost: 450, requires: ['ars_freeze'],   grants: 'tower.disruptor', desc: 'Unlock the DISRUPTOR tower — area-slow support (low damage, slows on hit).' },
    // Core arsenal: the standard attack towers are earned, not given. A fresh
    // save builds only Blaster, Sniper and Flak (AA for the wave-5 air rush);
    // these cheap early nodes unlock the rest. Costs still escalate via the
    // global GROWTH exponent, so a full unlock nudges you toward a build.
    ars_shotgun:   { branch: 'arsenal', name: 'Scatter Bay',           kind: 'tower', baseCost: 50,  requires: [],              grants: 'tower.rapid',    desc: 'Unlock the SHOTGUN tower — short-range spread, pierces 2.' },
    ars_laser:     { branch: 'arsenal', name: 'Beam Lab',              kind: 'tower', baseCost: 80,  requires: ['ars_shotgun'], grants: 'tower.laser',    desc: 'Unlock the LASER tower — continuous beam that also slows.' },
    ars_rocket:    { branch: 'arsenal', name: 'Rocketry',              kind: 'tower', baseCost: 110, requires: ['ars_laser'],   grants: 'tower.rocket',   desc: 'Unlock the ROCKET tower — homing splash damage.' },
    ars_tesla:     { branch: 'arsenal', name: 'Arc Reactor',           kind: 'tower', baseCost: 150, requires: ['ars_rocket'],  grants: 'tower.electric', desc: 'Unlock the TESLA tower — chain lightning across 3 targets.' },
    ars_silo:      { branch: 'arsenal', name: 'Silo Clearance',        kind: 'tower', baseCost: 200, requires: ['ars_tesla'],   grants: 'tower.silo',     desc: 'Unlock the SILO tower — long-range rocket swarm.' },

    // ── INTEL — automation, QoL, light passives ───────────────────────────
    int_hpbars:  { branch: 'intel', name: 'Threat Display',   kind: 'qol',    baseCost: 50,  requires: [],              grants: 'qol.hpbars',     desc: 'Unlock enemy HP bars.' },
    int_fastai:  { branch: 'intel', name: 'Co-Processor',     kind: 'qol',    baseCost: 80,  requires: [],              grants: 'qol.fastai',     desc: 'Unlock Fast Autopilot (built-in autopilot checks twice as often).' },
    int_start:   { branch: 'intel', name: 'Pre-Deployment',   kind: 'money',  baseCost: 120, requires: ['int_hpbars'],  effect: { startMoney: 50 }, desc: '+50¢ starting credits.' },
    int_pay:     { branch: 'intel', name: 'Logistics AI',     kind: 'payout', baseCost: 120, requires: ['int_fastai'],  effect: { payout: 0.06 },   desc: '+6% wave-completion payout.' },
    int_daily:   { branch: 'intel', name: 'Daily Uplink',     kind: 'qol',    baseCost: 150, requires: ['int_hpbars'],  grants: 'qol.dailyseed',  desc: 'Unlock the Daily Challenge (deterministic daily seed).' },
    int_skip:    { branch: 'intel', name: 'Loadout Memory',   kind: 'qol',    baseCost: 150, requires: ['int_fastai'],  grants: 'qol.skipsetup',  desc: 'Unlock one-click reuse of the last loadout.' },
    int_regen:   { branch: 'intel', name: 'Auto-Medic',       kind: 'regen',  baseCost: 160, requires: ['int_skip'],    effect: { regen: 1 },       desc: '+1 integrity regen per wave.' },
    int_preview: { branch: 'intel', name: 'Foresight Module', kind: 'qol',    baseCost: 220, requires: ['int_daily'],   grants: 'qol.ascpreview', desc: 'Unlock the Ascension +1 preview.' },
    int_dmg:     { branch: 'intel', name: 'Smart Targeting',  kind: 'damage', baseCost: 200, requires: ['int_preview'], effect: { damage: 0.06 },   desc: '+6% tower damage.' },

    // ── ASCENDANT — endgame cross-branch keystones ────────────────────────
    asc_gate:        { branch: 'ascendant', name: 'Ascendant Core',  kind: 'mixed', baseCost: 500, requires: ['off_dmg3', 'eco_pay2', 'def_hp3'], effect: { damage: 0.05, payout: 0.05, maxHP: 3 }, desc: 'Requires investment across Offense, Economy and Fortify. +5% damage, +5% payout, +3 max integrity.' },
    asc_war:         { branch: 'ascendant', name: 'War Machine',     kind: 'keystone', keystone: true, baseCost: 900,  requires: ['off_key', 'ars_variants'], effect: { damage: 0.15, fireRate: 0.10, kill: 0.10 }, desc: 'KEYSTONE: +15% damage, +10% fire rate, +10% credits per kill.' },
    asc_empire:      { branch: 'ascendant', name: 'Economic Empire', kind: 'keystone', keystone: true, baseCost: 900,  requires: ['eco_key', 'asc_gate'], effect: { payout: 0.20, interest: 0.08, startMoney: 100 }, desc: 'KEYSTONE: +20% payout, +8% interest, +100¢ start.' },
    asc_fortress:    { branch: 'ascendant', name: 'Living Fortress', kind: 'keystone', keystone: true, baseCost: 900,  requires: ['def_key', 'asc_gate'], effect: { maxHP: 12, regen: 2, payout: 0.10 }, desc: 'KEYSTONE: +12 max integrity, +2 regen, +10% payout.' },
    asc_legacy:      { branch: 'ascendant', name: "Veteran's Legacy",kind: 'mixed', baseCost: 800, requires: ['asc_gate'], effect: { damage: 0.08, payout: 0.08, kill: 0.08, regen: 1 }, desc: '+8% damage, +8% payout, +8% credits per kill, +1 regen.' },
    asc_singularity: { branch: 'ascendant', name: 'Singularity',     kind: 'keystone', keystone: true, baseCost: 1500, requires: ['asc_war', 'asc_empire', 'asc_fortress'], effect: { damage: 0.20, fireRate: 0.15, payout: 0.20, maxHP: 10 }, desc: 'GRAND KEYSTONE: +20% damage, +15% fire rate, +20% payout, +10 max integrity. The apex of every path.' },

    // ── REWORK additions: more choices + tree-unlocked towers ─────────────
    // Offense
    off_dmg5:  { branch: 'offense', name: 'Singularity Rounds',  kind: 'damage', baseCost: 450, requires: ['off_dmg4'],  effect: { damage: 0.12 },   desc: '+12% tower damage.' },
    off_rate4: { branch: 'offense', name: 'Cryo-Cooled Barrels', kind: 'rate',   baseCost: 360, requires: ['off_rate3'], effect: { fireRate: 0.10 }, desc: '+10% fire rate.' },
    // Economy
    eco_pay3:   { branch: 'economy', name: 'Profiteering', kind: 'payout', baseCost: 360, requires: ['eco_pay2'],   effect: { payout: 0.12 },   desc: '+12% wave payout.' },
    eco_kill3:  { branch: 'economy', name: 'Blood Money',  kind: 'kill',   baseCost: 360, requires: ['eco_kill2'],  effect: { kill: 0.15 },     desc: '+15% credits per kill.' },
    eco_start2: { branch: 'economy', name: 'Trust Fund',   kind: 'money',  baseCost: 220, requires: ['eco_start1'], effect: { startMoney: 100 }, desc: '+100¢ starting credits.' },
    // Fortify
    def_hp5:  { branch: 'fortify', name: 'Aegis Plating',     kind: 'hp',    baseCost: 450, requires: ['def_hp4'],  effect: { maxHP: 10 }, desc: '+10 max integrity.' },
    def_reg4: { branch: 'fortify', name: 'Regenerative Mesh', kind: 'regen', baseCost: 360, requires: ['def_reg3'], effect: { regen: 2 },  desc: '+2 integrity regen per wave.' },
    // Intel
    int_kill: { branch: 'intel', name: 'Target Analysis', kind: 'kill',     baseCost: 200, requires: ['int_pay'],   effect: { kill: 0.08 },     desc: '+8% credits per kill.' },
    int_int:  { branch: 'intel', name: 'Market Feed',     kind: 'interest', baseCost: 200, requires: ['int_start'], effect: { interest: 0.04 }, desc: '+4% of banked credits each wave.' },
    // Arsenal — the Relay/income tower now lives in the tree, plus two new towers
    ars_relay:   { branch: 'arsenal', name: 'Relay Network',     kind: 'tower', baseCost: 80,  requires: [],               grants: 'tower.income',   desc: 'Unlock the RELAY support tower (passive income). No longer buildable by default.' },
    ars_railgun: { branch: 'arsenal', name: 'Railgun Emplacement',kind: 'tower', keystone: true, baseCost: 420, requires: ['ars_variants'], grants: 'tower.railgun', desc: 'Unlock the RAILGUN tower — extreme-range round that pierces a line of enemies.' },
    ars_beacon:  { branch: 'arsenal', name: 'Beacon Array',      kind: 'tower', keystone: true, baseCost: 400, requires: ['ars_warden'],   grants: 'tower.beacon',  desc: 'Unlock the BEACON tower — projects a damage aura to nearby towers.' },
    // Ascendant — rewards going deep into the Arsenal towers
    asc_arsenal: { branch: 'ascendant', name: 'Master Armory', kind: 'keystone', keystone: true, baseCost: 1000, requires: ['ars_railgun', 'ars_beacon'], effect: { damage: 0.10, fireRate: 0.08 }, desc: 'KEYSTONE: +10% damage and +8% fire rate (needs both new tree towers).' }
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
// Boon magnitudes nerfed in the 2026-05-25 rebalance. The boon trigger
// is also capped at (ascensionTier + 1) per run, so even at A5 a player
// gets ~6 boons over a full run — power-creep stays bounded. Economy
// boons (interest, payout) were the biggest offenders: compound
// interest at 5%/wave applied to a million-credit bank produced
// per-wave deltas that tripped Aegis's spike detector and corrupted
// saves. Cut to a value that keeps them attractive without ballooning.
const BOONS = [
    { id: 'overdrive', name: 'Overdrive Matrix',   icon: '⚡', desc: '+10% tower damage (all current & future towers)',
      apply: (g) => g._applyDamageBoon(1.10) },
    { id: 'coils',     name: 'Resonant Coils',     icon: '🔁', desc: '+8% fire rate for every tower',
      apply: (g) => g._applyFireRateBoon(0.926) },
    { id: 'economy',   name: 'War Economy',        icon: '💰', desc: '+12% wave-completion payout',
      apply: (g) => { g.boonPayoutMult *= 1.12; } },
    { id: 'bounty',    name: 'Bounty Protocol',    icon: '🎯', desc: '+18% credits per kill',
      apply: (g) => { g.boonKillMult *= 1.18; } },
    { id: 'core',      name: 'Reinforced Core',    icon: '🛡️', desc: '+4 max integrity and repair 4 now',
      apply: (g) => { g.maxHealth += 4; g.health = Math.min(g.maxHealth, g.health + 4); } },
    { id: 'interest',  name: 'Compound Interest',  icon: '📈', desc: '+1.5% of banked credits added each wave (capped)',
      apply: (g) => { g.boonInterest += 0.015; } },
    { id: 'regen',     name: 'Nanorepair Swarm',   icon: '✚', desc: 'Repair to full now + regen 1 integrity / wave',
      apply: (g) => { g.health = g.maxHealth; g.boonRegen += 1; } },
    { id: 'arsenal',   name: 'Surplus Arsenal',    icon: '🏭', desc: '-12% tower build cost',
      apply: (g) => { g.towerCostMult *= 0.88; } },
    { id: 'engineer',  name: 'Field Engineering',  icon: '🔧', desc: '-12% upgrade cost',
      apply: (g) => { g.upgradeCostMult *= 0.88; } }
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
// Backpack items — a spatial-grid inventory. Each item occupies a multi-cell
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
    const node = TECH_TREE[nodeId];
    return node ? { id: nodeId, ...node } : null;
}
