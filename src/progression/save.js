// Persistent save for Neon Defense (Milestone 1 schema, version 1).
// Exposes a `NeonSave` namespace used by main.js and game.js.
// Schema is forward-compatible with Milestones 2-3: tree-buyable fields
// (unlockedNodes, towerMastery) are present but unused in M1.

const NeonSave = (function () {
    const KEY = 'neonDefense.save';
    const SCHEMA_VERSION = 1;

    // Tower types used by the current game. Kept in sync with TOWERS keys in config.js.
    const TOWER_TYPES = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];
    const MASTERY_PERK_DEFAULTS = { damage: 0, fireRate: 0, efficiency: 0 };
    // Damage & Fire Rate are ENDLESS (no cap) so per-tower mastery XP always
    // has a sink. Efficiency stays capped — it's a cost *reducer*, letting it
    // run to infinity would zero out upgrade costs and break economy balance.
    const MASTERY_PERK_LIMITS = { damage: Infinity, fireRate: Infinity, efficiency: 5 };
    const MASTERY_PERK_BASE_COST = { damage: 250, fireRate: 250, efficiency: 400 };
    // Endless perks grow geometrically (cost = base * growth^rank); the
    // capped one keeps the old linear step. Geometric growth makes the sink
    // bottomless while early ranks stay close to the old linear feel.
    const MASTERY_PERK_COST_GROWTH = { damage: 1.16, fireRate: 1.16 };
    const MASTERY_PERK_COST_STEP = { efficiency: 200 };

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
            unlockedNodes: ['hero.pioneer', 'kit.standard'],   // M2 pre-unlocked tree nodes
            towerMastery: mastery,                             // filled in M3
            highScores: highScores,                            // per-Ascension top-5 lists of { name, wave }
            lastLoadout: {
                heroId: 'hero.pioneer',
                kitId: 'kit.standard',
                abilityId: 'ability.none',
                towerLoadout: null  // M3: null → all base types. Filled per-type when user selects a variant.
            },
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

    function load() {
        const raw = localStorage.getItem(KEY);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.version === SCHEMA_VERSION) {
                    backfillV1Fields(parsed);
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
        localStorage.setItem(KEY, JSON.stringify(save));
    }

    // Non-schema-bump backfill for M1-era saves missing M2 fields.
    // Idempotent — safe to call on every load.
    function backfillV1Fields(save, persist = true) {
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
        if (persist) write(save);
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
    function tallyMastery(save, towers) {
        const perType = {};
        for (const t of towers) {
            const base = (t.type || '').split('_')[0];
            if (!TOWER_TYPES.includes(base)) continue;
            const dmg = t.damageDealt || 0;
            if (dmg <= 0) continue;
            perType[base] = (perType[base] || 0) + dmg;
        }

        const results = [];
        for (const type of Object.keys(perType)) {
            const xpGained = Math.floor(perType[type]);
            if (xpGained <= 0) continue;
            if (!save.towerMastery[type]) save.towerMastery[type] = { xp: 0, totalXP: 0, milestones: { m1: false, m2: false }, perks: { ...MASTERY_PERK_DEFAULTS } };
            save.towerMastery[type].xp += xpGained;
            save.towerMastery[type].totalXP = (save.towerMastery[type].totalXP || 0) + xpGained;

            const newMilestones = [];
            const milestones = save.towerMastery[type].milestones;
            if (!milestones.m1 && save.towerMastery[type].totalXP >= 1000) { milestones.m1 = true; newMilestones.push('m1'); }
            if (!milestones.m2 && save.towerMastery[type].totalXP >= 10000) { milestones.m2 = true; newMilestones.push('m2'); }

            results.push({ type, xpGained, newMilestones, newXP: save.towerMastery[type].totalXP });
        }
        write(save);
        return results;
    }

    function getMasteryPerkCost(save, type, perk) {
        if (!TOWER_TYPES.includes(type) || !(perk in MASTERY_PERK_LIMITS)) return Infinity;
        const rank = (save.towerMastery[type] && save.towerMastery[type].perks && save.towerMastery[type].perks[perk]) || 0;
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
        if (!TOWER_TYPES.includes(type) || !(perk in MASTERY_PERK_LIMITS)) return false;
        const mastery = save.towerMastery[type];
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
        return 'ND1.' + _b64encode(json) + '.' + _hash(json).toString(36);
    }

    // Returns the decoded save object. Throws Error on malformed/corrupt input —
    // caller should catch and surface the message, never overwrite on failure.
    function decodeSaveCode(code) {
        const m = /^ND1\.([A-Za-z0-9+/=]+)\.([a-z0-9]+)$/.exec(String(code || '').trim());
        if (!m) throw new Error('Not a valid save code (expected "ND1.…").');
        const json = _b64decode(m[1]);
        if (_hash(json).toString(36) !== m[2]) {
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
        MASTERY_PERK_LIMITS,
        getMasteryPerkCost,
        purchaseMasteryPerk,
        encodeSaveCode,
        decodeSaveCode
    };
})();

// Node test harness can require() this file.
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonSave };
