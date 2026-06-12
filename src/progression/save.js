// Persistent save for Neon Defense (Milestone 1 schema, version 1).
// Exposes a `NeonSave` namespace used by main.js and game.js.
// Schema is forward-compatible with Milestones 2-3: tree-buyable fields
// (unlockedNodes, towerMastery) are present but unused in M1.

const NeonSave = (function () {
    const KEY = 'neonDefense.save';
    const SIG_KEY = 'neonDefense.save.sig';
    const SCHEMA_VERSION = 1;

    // Tower types used by the current game. Kept in sync with TOWERS keys in config.js.
    const TOWER_TYPES = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];
    const MASTERY_PERK_DEFAULTS = { damage: 0, fireRate: 0, efficiency: 0, bounty: 0 };
    // Damage / Fire Rate / Bounty are ENDLESS (diminishing effect, geometric
    // cost) so per-tower mastery XP always has a sink. Bounty replaced the
    // old shooter Efficiency perk (a −10%-capped upgrade discount nobody
    // felt): kills by this tower type pay extra credits — a perk you can
    // watch working every wave. Efficiency lives on for INCOME towers only
    // (their upgrades are the economy engine, so the discount matters
    // there), with a doubled cap.
    const MASTERY_PERK_LIMITS = { damage: Infinity, fireRate: Infinity, efficiency: 10, bounty: Infinity };
    const MASTERY_PERK_BASE_COST = { damage: 250, fireRate: 250, efficiency: 400, bounty: 300 };
    // Endless perks grow geometrically (cost = base * growth^rank); the
    // capped one keeps the old linear step. Geometric growth makes the sink
    // bottomless while early ranks stay close to the old linear feel.
    const MASTERY_PERK_COST_GROWTH = { damage: 1.16, fireRate: 1.16, bounty: 1.16 };
    const MASTERY_PERK_COST_STEP = { efficiency: 200 };

    // Backpack — spatial-grid inventory. Persistence + the
    // meta-XP salvage economy live here; placement validity / effects live
    // in backpack.js + config.js. Salvage cost escalates with how many
    // items you already own, so it doubles as an endless meta-XP sink.
    // Fresh saves start with a deliberately tiny 2×2 grid (4 cells). Players
    // earn meta-XP and spend it on EXPAND to grow it — that's the Backpack-
    // Hero progression beat: the bag itself is the long-term upgrade.
    const BACKPACK_W = 2, BACKPACK_H = 2;
    const BACKPACK_MAX_W = 9, BACKPACK_MAX_H = 8;
    const SALVAGE_BASE_COST = 300;
    const SALVAGE_COST_GROWTH = 1.12;
    // Bag expansion is deliberately endgame-priced: starts at 1500 and
    // each subsequent +COL/+ROW costs 50% more than the last (×1.5 per
    // growth step). Fully expanding to 9×8 from the 2×2 start costs
    // ~580K meta-XP — a multi-ascension grind.
    const EXPAND_BASE_COST = 1500;
    const EXPAND_COST_GROWTH = 1.5;
    // Salvage Luck — meta-XP sink that bumps the wave-20+ end-of-run drop
    // chance by 1 percentage point per rank. Insignificant per buy,
    // exponentially priced (×1.35), and capped above by the chance ceiling
    // (so it can never push the roll to 100%).
    const LUCK_BASE_COST = 500;
    const LUCK_COST_GROWTH = 1.35;
    const LUCK_PER_RANK = 0.01;
    const LUCK_CHANCE_CAP = 0.95;
    // Sell refund — flat per rarity. Always below the current salvage roll
    // cost for commons (so re-rolling isn't free), but a single end-of-run
    // rare hands back a meaningful chunk of meta-XP. Caller supplies the
    // rarity via the item def; unknown rarity refunds 0.
    const SELL_REFUND = { common: 100, uncommon: 250, rare: 500, epic: 1000, legendary: 2500 };

    function createFreshSave() {
        const mastery = {};
        for (const t of TOWER_TYPES) {
            mastery[t] = { xp: 0, totalXP: 0, milestones: { m1: false, m2: false }, perks: { ...MASTERY_PERK_DEFAULTS } };
        }
        const highScores = {};
        for (let i = 0; i <= 10; i++) highScores['a' + i] = [];

        return {
            version: SCHEMA_VERSION,
            metaXP: 0,
            totalXPEarned: 0,
            ascensionCleared: 0,                               // highest tier where wave 30 was reached
            mpAscensionCleared: 0,                             // coop has its own progression; reserved for future tier-picker
            unlockedNodes: ['hero.pioneer', 'kit.standard'],   // M2 pre-unlocked tree nodes
            towerMastery: mastery,                             // filled in M3
            highScores: highScores,                            // per-Ascension top-5 lists of { name, wave }
            globalCache: {},                                   // per-tier mirror of NeonMP.global entries — persisted so a reloaded device keeps relaying other players' scores even if they go offline
            lastLoadout: {
                heroId: 'hero.pioneer',
                kitId: 'kit.standard',
                abilityId: 'ability.none',
                towerLoadout: null  // M3: null → all base types. Filled per-type when user selects a variant.
            },
            backpack: { w: BACKPACK_W, h: BACKPACK_H, placed: [], stash: [], luckBoost: 0 },
            maxWaveReached: 0,
            // Aegis flags; written by NeonAegis.flag() and consulted by
            // onRunEnded to withhold rewards until RESET SAVE clears them.
            cheaterDetected: false,
            cheaterReason: null,
            settings: { skipRunSetup: false }
        };
    }

    // Pull any legacy data into the fresh save and grant welcome XP.
    // Legacy sources handled (in priority order):
    //   neonDefenseScores_easy | _normal | _hard  (645ce59 format)
    //   neonDefenseScores                          (pre-645ce59 format)
    function migrateLegacy(save) {
        let legacyFound = false;

        // 645ce59 per-difficulty scoreboards → a0/a2/a4 respectively.
        // Mapping rationale (from spec): Easy≈A0, Normal≈A2, Hard≈A4.
        const legacyMap = [
            { key: 'neonDefenseScores_easy',   tier: 'a0' },
            { key: 'neonDefenseScores_normal', tier: 'a2' },
            { key: 'neonDefenseScores_hard',   tier: 'a4' }
        ];
        for (const { key, tier } of legacyMap) {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                try {
                    const scores = JSON.parse(raw);
                    if (Array.isArray(scores)) {
                        save.highScores[tier] = scores;
                        legacyFound = true;
                    }
                } catch (_) { /* ignore bad JSON */ }
            }
        }

        // Pre-645ce59 flat scoreboard (only if no _easy key yet).
        if (!legacyFound && localStorage.getItem('neonDefenseScores') !== null) {
            try {
                const scores = JSON.parse(localStorage.getItem('neonDefenseScores'));
                if (Array.isArray(scores)) {
                    save.highScores.a0 = scores;
                    legacyFound = true;
                }
            } catch (_) { /* ignore */ }
        }

        if (legacyFound) {
            save.metaXP = 200;          // welcome grant ~ 2 Tier-1 nodes' worth
            save.totalXPEarned = 200;
        }

        return legacyFound;
    }

    // Verify the signature stored next to the save. Returns one of:
    //   'ok'       — sig matches, save is untampered
    //   'pre-aegis' — no sig yet (legacy save, first load after Aegis)
    //   'mismatch' — sig present but does not match the data (tamper)
    function _verifyStoredSig(jsonStr) {
        if (typeof NeonAegis === 'undefined') return 'ok';        // tests/node
        const sig = localStorage.getItem(SIG_KEY);
        if (sig === null) return 'pre-aegis';
        return NeonAegis.verify(jsonStr, sig) ? 'ok' : 'mismatch';
    }

    function load() {
        const raw = localStorage.getItem(KEY);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.version === SCHEMA_VERSION) {
                    const sigState = _verifyStoredSig(raw);
                    backfillV1Fields(parsed);
                    // Uncorrupt: prior versions bricked saves by setting
                    // cheaterDetected=true and re-signing. We no longer
                    // persist that flag, and we actively clear it on load
                    // so existing players' saves heal themselves.
                    if (parsed.cheaterDetected) {
                        parsed.cheaterDetected = false;
                        parsed.cheaterReason = null;
                        write(parsed);
                    } else if (sigState === 'pre-aegis' || sigState === 'mismatch') {
                        // Either legacy unsigned or hand-edited save. Either
                        // way we re-sign and move on — cheat detection now
                        // lives in the run scope, not on the save.
                        write(parsed);
                    }
                    return parsed;
                }
            } catch (_) { /* fall through to fresh */ }
        }
        const fresh = createFreshSave();
        migrateLegacy(fresh);
        write(fresh);
        return fresh;
    }

    function write(save) {
        const json = JSON.stringify(save);
        localStorage.setItem(KEY, json);
        if (typeof NeonAegis !== 'undefined') {
            try { localStorage.setItem(SIG_KEY, NeonAegis.sign(json)); } catch (_) {}
        }
    }

    // Non-schema-bump backfill for M1-era saves missing M2 fields.
    // Idempotent — safe to call on every load.
    function backfillV1Fields(save, persist = true) {
        // High-score buckets must exist before anything else reads them —
        // recordRun + UI code both index into `save.highScores['a' + tier]`
        // without null-guarding the parent object.
        if (!save.highScores || typeof save.highScores !== 'object') save.highScores = {};
        for (let i = 0; i <= 10; i++) {
            const key = 'a' + i;
            if (!Array.isArray(save.highScores[key])) save.highScores[key] = [];
        }
        if (typeof save.metaXP        !== 'number') save.metaXP = 0;
        if (typeof save.totalXPEarned !== 'number') save.totalXPEarned = save.metaXP;
        if (typeof save.ascensionCleared !== 'number') save.ascensionCleared = 0;
        if (typeof save.mpAscensionCleared !== 'number') save.mpAscensionCleared = 0;
        if (!save.globalCache || typeof save.globalCache !== 'object') save.globalCache = {};
        if (!Array.isArray(save.unlockedNodes)) save.unlockedNodes = [];
        if (!save.unlockedNodes.includes('hero.pioneer')) save.unlockedNodes.push('hero.pioneer');
        if (!save.unlockedNodes.includes('kit.standard')) save.unlockedNodes.push('kit.standard');
        if (!save.towerMastery || typeof save.towerMastery !== 'object') save.towerMastery = {};
        for (const type of TOWER_TYPES) {
            if (!save.towerMastery[type] || typeof save.towerMastery[type] !== 'object') {
                save.towerMastery[type] = { xp: 0, totalXP: 0, milestones: { m1: false, m2: false }, perks: { ...MASTERY_PERK_DEFAULTS } };
            }
            if (typeof save.towerMastery[type].xp !== 'number') save.towerMastery[type].xp = 0;
            if (typeof save.towerMastery[type].totalXP !== 'number') save.towerMastery[type].totalXP = save.towerMastery[type].xp;
            save.towerMastery[type].totalXP = Math.max(save.towerMastery[type].totalXP, save.towerMastery[type].xp);
            if (!save.towerMastery[type].milestones || typeof save.towerMastery[type].milestones !== 'object') {
                save.towerMastery[type].milestones = { m1: false, m2: false };
            }
            save.towerMastery[type].milestones.m1 = !!save.towerMastery[type].milestones.m1;
            save.towerMastery[type].milestones.m2 = !!save.towerMastery[type].milestones.m2;
            if (!save.towerMastery[type].perks || typeof save.towerMastery[type].perks !== 'object') {
                save.towerMastery[type].perks = { ...MASTERY_PERK_DEFAULTS };
            }
            for (const perk of Object.keys(MASTERY_PERK_DEFAULTS)) {
                const rank = save.towerMastery[type].perks[perk];
                save.towerMastery[type].perks[perk] = Math.max(0, Math.min(MASTERY_PERK_LIMITS[perk], Number.isFinite(rank) ? Math.floor(rank) : 0));
            }
            // Perk rework migration: shooters' old Efficiency ranks
            // become Bounty ranks 1:1 (the perk slot they replaced) —
            // players keep their invested value. Income towers keep
            // Efficiency (it's their meaningful perk).
            if (type !== 'income' && save.towerMastery[type].perks.efficiency > 0) {
                save.towerMastery[type].perks.bounty += save.towerMastery[type].perks.efficiency;
                save.towerMastery[type].perks.efficiency = 0;
            }
        }
        if (save.lastLoadout === undefined || save.lastLoadout === null) {
            save.lastLoadout = { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none', towerLoadout: null };
        }
        if (typeof save.lastLoadout !== 'object' || save.lastLoadout === null) {
            save.lastLoadout = { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none', towerLoadout: null };
        }
        if (typeof save.lastLoadout.towerLoadout === 'undefined') save.lastLoadout.towerLoadout = null;
        if (!save.settings || typeof save.settings !== 'object') save.settings = { skipRunSetup: false };
        if (typeof save.settings.skipRunSetup !== 'boolean') save.settings.skipRunSetup = false;

        // Backpack backfill — tolerant of older saves / hand-edited codes.
        const bp = (save.backpack && typeof save.backpack === 'object') ? save.backpack : {};
        bp.w = Math.max(1, Math.min(BACKPACK_MAX_W, Math.floor(bp.w) || BACKPACK_W));
        bp.h = Math.max(1, Math.min(BACKPACK_MAX_H, Math.floor(bp.h) || BACKPACK_H));
        bp.placed = Array.isArray(bp.placed) ? bp.placed.filter(p =>
            p && typeof p.id === 'string' &&
            Number.isFinite(p.x) && Number.isFinite(p.y)
        ).map(p => ({ id: p.id, x: p.x | 0, y: p.y | 0, rot: ((p.rot | 0) % 4 + 4) % 4 })) : [];
        bp.stash = Array.isArray(bp.stash) ? bp.stash.filter(s => typeof s === 'string') : [];
        bp.luckBoost = Math.max(0, Math.floor(Number(bp.luckBoost) || 0));
        save.backpack = bp;
        save.maxWaveReached = Math.max(0, Math.floor(Number(save.maxWaveReached) || 0));
        save.cheaterDetected = !!save.cheaterDetected;
        if (typeof save.cheaterReason !== 'string') save.cheaterReason = null;

        if (persist) write(save);
    }

    // Meta-XP cost of one salvage roll — grows with total items owned so it
    // stays an endless XP sink even after the tech tree is maxed.
    function getSalvageCost(save) {
        const bp = save.backpack || { placed: [], stash: [] };
        const owned = (bp.placed ? bp.placed.length : 0) + (bp.stash ? bp.stash.length : 0);
        return Math.round(SALVAGE_BASE_COST * Math.pow(SALVAGE_COST_GROWTH, owned) / 5) * 5;
    }

    // Spend meta-XP and drop `itemId` into the stash. Caller rolls the id
    // (NeonBackpack.salvageRoll). Returns the cost paid, or -1 if too poor.
    function salvage(save, itemId) {
        backfillV1Fields(save, false);
        const cost = getSalvageCost(save);
        if (save.metaXP < cost) return -1;
        save.metaXP -= cost;
        save.backpack.stash.push(itemId);
        write(save);
        return cost;
    }

    // Free item grant (OVERCLOCK drop / end-of-run reward). Goes to the
    // stash, which has NO gameplay effect until the player manually places
    // it — so this never perturbs an in-progress run or the auto-tune bot.
    function grantItem(save, itemId) {
        if (typeof itemId !== 'string') return false;
        backfillV1Fields(save, false);
        save.backpack.stash.push(itemId);
        write(save);
        return true;
    }

    // Meta-XP cost to grow the grid by one row/column. Grows with how much
    // it's already been expanded.
    function getExpandCost(save) {
        const bp = save.backpack || { w: BACKPACK_W, h: BACKPACK_H };
        const grown = Math.max(0, (bp.w || BACKPACK_W) - BACKPACK_W)
                    + Math.max(0, (bp.h || BACKPACK_H) - BACKPACK_H);
        return Math.round(EXPAND_BASE_COST * Math.pow(EXPAND_COST_GROWTH, grown) / 10) * 10;
    }

    // Pure refund — no inventory mutation here, because callers may be
    // selling from the held buffer, stash, or grid. Returns the XP amount
    // credited to metaXP, given an item's rarity string.
    function getSellRefund(rarity) {
        return (rarity && SELL_REFUND[rarity]) || 0;
    }
    function sellItem(save, rarity) {
        const refund = getSellRefund(rarity);
        if (refund <= 0) return 0;
        backfillV1Fields(save, false);
        save.metaXP += refund;
        write(save);
        return refund;
    }

    // Meta-XP sink that nudges the next end-of-run loot roll by a flat
    // +1% per rank. Gated by maxWaveReached ≥ 20 so it only opens after
    // the player has actually reached the loot gate.
    function getLuckBoostCost(save) {
        const rank = (save.backpack && Number(save.backpack.luckBoost)) || 0;
        return Math.round(LUCK_BASE_COST * Math.pow(LUCK_COST_GROWTH, rank) / 5) * 5;
    }
    function luckBoostUnlocked(save) {
        return (Number(save.maxWaveReached) || 0) >= 20;
    }
    // Returns cost paid, or -1 if locked / too poor.
    function buyLuckBoost(save) {
        backfillV1Fields(save, false);
        if (!luckBoostUnlocked(save)) return -1;
        const cost = getLuckBoostCost(save);
        if (save.metaXP < cost) return -1;
        save.metaXP -= cost;
        save.backpack.luckBoost = (save.backpack.luckBoost || 0) + 1;
        write(save);
        return cost;
    }

    // axis: 'w' (add a column) or 'h' (add a row). Returns cost paid, or -1
    // if maxed / too poor.
    function expandBackpack(save, axis) {
        backfillV1Fields(save, false);
        const bp = save.backpack;
        if (axis === 'w' && bp.w >= BACKPACK_MAX_W) return -1;
        if (axis === 'h' && bp.h >= BACKPACK_MAX_H) return -1;
        if (axis !== 'w' && axis !== 'h') return -1;
        const cost = getExpandCost(save);
        if (save.metaXP < cost) return -1;
        save.metaXP -= cost;
        if (axis === 'w') bp.w++; else bp.h++;
        write(save);
        return cost;
    }

    // True if the given nodeId exists in save.unlockedNodes. Safe for any input.
    function hasUnlocked(save, nodeId) {
        return Array.isArray(save.unlockedNodes) && save.unlockedNodes.includes(nodeId);
    }

    // Spec formula:
    //   waveXP          = min(wave,30) + max(0, wave-30) * 0.5
    //   tierMult        = 1 + tier * 0.5
    //   clearBonus      = (wave >= 30) ? 50 : 0
    //   firstClearBonus = (firstClear) ? 100 : 0
    //   runXP           = waveXP * tierMult + clearBonus + firstClearBonus
    function calculateRunXP(wave, tier, firstClear) {
        const baseWave = Math.min(wave, 30) + Math.max(0, wave - 30) * 0.5;
        const tierMult = 1 + tier * 0.5;
        const clearBonus = wave >= 30 ? 50 : 0;
        const firstBonus = firstClear ? 100 : 0;
        const total = Math.floor(baseWave * tierMult + clearBonus + firstBonus);
        return {
            waveXP:     Math.floor(baseWave * tierMult),
            clearBonus: clearBonus,
            firstBonus: firstBonus,
            total:      total
        };
    }

    // M3: Sum damageDealt across all alive towers, bucketed by base tower type
    // (variants like 'basic_cryo' roll up to 'basic'). Increments
    // save.towerMastery[type].xp (spendable) and totalXP (lifetime), then sets
    // milestones m1 at 1000 / m2 at 10000 lifetime XP.
    // Returns an array of { type, xpGained, newMilestones: ['m1'|'m2'] } for UI.
    function ensureMasteryEntry(save, type) {
        if (!save.towerMastery) save.towerMastery = {};
        if (!save.towerMastery[type]) {
            save.towerMastery[type] = { xp: 0, totalXP: 0, milestones: { m1: false, m2: false }, perks: { ...MASTERY_PERK_DEFAULTS } };
        }
        return save.towerMastery[type];
    }

    function tallyMastery(save, towers) {
        // Variants now own their OWN mastery track. XP is attributed to the
        // exact tower type used (e.g. 'basic_cryo'), not rolled up to base —
        // variants unlock via the base's m1 milestone, then grow separately.
        const perType = {};
        for (const t of towers) {
            const type = t.type;
            if (!type) continue;
            // Accept any known base or variant id (variants like 'basic_cryo'
            // aren't in TOWER_TYPES; gate by base presence instead).
            const base = type.split('_')[0];
            if (!TOWER_TYPES.includes(base)) continue;
            const dmg = t.damageDealt || 0;
            if (dmg <= 0) continue;
            perType[type] = (perType[type] || 0) + dmg;
        }

        const results = [];
        for (const type of Object.keys(perType)) {
            const xpGained = Math.floor(perType[type]);
            if (xpGained <= 0) continue;
            const entry = ensureMasteryEntry(save, type);
            entry.xp += xpGained;
            entry.totalXP = (entry.totalXP || 0) + xpGained;

            const newMilestones = [];
            const milestones = entry.milestones;
            if (!milestones.m1 && entry.totalXP >= 1000)  { milestones.m1 = true; newMilestones.push('m1'); }
            if (!milestones.m2 && entry.totalXP >= 10000) { milestones.m2 = true; newMilestones.push('m2'); }

            results.push({ type, xpGained, newMilestones, newXP: entry.totalXP });
        }
        write(save);
        return results;
    }

    // Accept any non-empty string type id (covers base + variants). Returns
    // Infinity for unknown perks or maxed ranks. Lazy entry is fine — a
    // missing entry counts as rank 0.
    function getMasteryPerkCost(save, type, perk) {
        if (typeof type !== 'string' || !type || !(perk in MASTERY_PERK_LIMITS)) return Infinity;
        const rank = (save.towerMastery && save.towerMastery[type] && save.towerMastery[type].perks && save.towerMastery[type].perks[perk]) || 0;
        if (rank >= MASTERY_PERK_LIMITS[perk]) return Infinity;
        const growth = MASTERY_PERK_COST_GROWTH[perk];
        if (growth) {
            // Endless perk: geometric. Round to a tidy 5¢ so the label reads
            // cleanly even at huge ranks.
            return Math.round(MASTERY_PERK_BASE_COST[perk] * Math.pow(growth, rank) / 5) * 5;
        }
        return MASTERY_PERK_BASE_COST[perk] + rank * MASTERY_PERK_COST_STEP[perk];
    }

    function purchaseMasteryPerk(save, type, perk) {
        backfillV1Fields(save);
        if (typeof type !== 'string' || !type || !(perk in MASTERY_PERK_LIMITS)) return false;
        const mastery = ensureMasteryEntry(save, type);
        const rank = mastery.perks[perk] || 0;
        if (rank >= MASTERY_PERK_LIMITS[perk]) return false;
        const cost = getMasteryPerkCost(save, type, perk);
        if (mastery.xp < cost) return false;
        mastery.xp -= cost;
        mastery.perks[perk] = rank + 1;
        write(save);
        return true;
    }

    // Updates save in place for a completed run and persists it.
    // Returns the breakdown object (incl. `firstClear` boolean for UI).
    function recordRun(save, result) {
        const { wave, tier, name } = result;
        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = calculateRunXP(wave, tier, firstClear);
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        if (firstClear) {
            save.ascensionCleared = tier;
        }

        // High-score entry (top 5 by wave, descending). Only recorded if name provided.
        if (name && typeof name === 'string' && name.length > 0) {
            const key = 'a' + tier;
            const list = save.highScores[key] || [];
            list.push({ name: name.toUpperCase().slice(0, 3), wave: wave });
            list.sort((a, b) => b.wave - a.wave);
            save.highScores[key] = list.slice(0, 5);
        }

        write(save);
        return { ...xp, firstClear };
    }

    // ── Portable save code ────────────────────────────────────────────────
    // Format:  ND1.<base64(JSON)>.<base36 checksum>
    // base64 keeps it copy/paste-safe; the checksum rejects truncated or
    // hand-edited codes before they overwrite a real save.
    function _hash(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }

    function _b64encode(str) {
        if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
        return Buffer.from(str, 'utf8').toString('base64');   // Node (tests)
    }
    function _b64decode(b64) {
        if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
        return Buffer.from(b64, 'base64').toString('utf8');    // Node (tests)
    }

    function encodeSaveCode(save) {
        const json = JSON.stringify(save);
        // Prefer ND2 (Aegis-signed) when available; fall back to ND1 in
        // bare-node tests that didn't preload aegis.js.
        if (typeof NeonAegis !== 'undefined') {
            return 'ND2.' + _b64encode(json) + '.' + NeonAegis.sign(json);
        }
        return 'ND1.' + _b64encode(json) + '.' + _hash(json).toString(36);
    }

    // Returns the decoded save object. Throws Error on malformed/corrupt input —
    // caller should catch and surface the message, never overwrite on failure.
    function decodeSaveCode(code) {
        const trimmed = String(code || '').trim();

        // ND2 — Aegis multi-pass signature. Three dot-separated base-36 fields.
        const m2 = /^ND2\.([A-Za-z0-9+/=]+)\.([a-z0-9]+\.[a-z0-9]+\.[a-z0-9]+)$/.exec(trimmed);
        if (m2) {
            const json = _b64decode(m2[1]);
            if (typeof NeonAegis === 'undefined' || !NeonAegis.verify(json, m2[2])) {
                throw new Error('Save code signature invalid — refusing to load.');
            }
            let obj;
            try { obj = JSON.parse(json); }
            catch (e) { throw new Error('Save code payload is not valid JSON.'); }
            if (!obj || typeof obj !== 'object' || typeof obj.metaXP !== 'number') {
                throw new Error('Save code does not contain a valid save.');
            }
            backfillV1Fields(obj, false);
            return obj;
        }

        // ND1 — legacy weak hash. Still readable so old exports keep working;
        // re-saving migrates to ND2.
        const m1 = /^ND1\.([A-Za-z0-9+/=]+)\.([a-z0-9]+)$/.exec(trimmed);
        if (m1) {
            const json = _b64decode(m1[1]);
            if (_hash(json).toString(36) !== m1[2]) {
                throw new Error('Save code is corrupted (checksum mismatch).');
            }
            let obj;
            try { obj = JSON.parse(json); }
            catch (e) { throw new Error('Save code payload is not valid JSON.'); }
            if (!obj || typeof obj !== 'object' || typeof obj.metaXP !== 'number') {
                throw new Error('Save code does not contain a valid save.');
            }
            backfillV1Fields(obj, false);
            return obj;
        }

        throw new Error('Not a valid save code (expected "ND2.…" or "ND1.…").');
    }

    return {
        KEY,
        SCHEMA_VERSION,
        TOWER_TYPES,
        createFreshSave,
        migrateLegacy,
        load,
        write,
        hasUnlocked,
        calculateRunXP,
        recordRun,
        tallyMastery,
        ensureMasteryEntry,
        MASTERY_PERK_LIMITS,
        getMasteryPerkCost,
        purchaseMasteryPerk,
        getSalvageCost,
        salvage,
        grantItem,
        getExpandCost,
        expandBackpack,
        getLuckBoostCost,
        luckBoostUnlocked,
        buyLuckBoost,
        getSellRefund,
        sellItem,
        LUCK_PER_RANK,
        LUCK_CHANCE_CAP,
        encodeSaveCode,
        decodeSaveCode
    };
})();

// Node test harness can require() this file.
if (typeof window !== 'undefined') window.NeonSave = NeonSave;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonSave };
