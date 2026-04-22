// Persistent save for Neon Defense (Milestone 1 schema, version 1).
// Exposes a `NeonSave` namespace used by main.js and game.js.
// Schema is forward-compatible with Milestones 2-3: tree-buyable fields
// (unlockedNodes, towerMastery) are present but unused in M1.

const NeonSave = (function () {
    const KEY = 'neonDefense.save';
    const SCHEMA_VERSION = 1;

    // Tower types used by the current game. Kept in sync with TOWERS keys in config.js.
    const TOWER_TYPES = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];

    function createFreshSave() {
        const mastery = {};
        for (const t of TOWER_TYPES) {
            mastery[t] = { xp: 0, milestones: { m1: false, m2: false } };
        }
        const highScores = {};
        for (let i = 0; i <= 10; i++) highScores['a' + i] = [];

        return {
            version: SCHEMA_VERSION,
            metaXP: 0,
            totalXPEarned: 0,
            ascensionCleared: 0,          // highest tier where wave 30 was reached
            unlockedNodes: [],            // filled in M2
            towerMastery: mastery,        // filled in M3
            highScores: highScores,       // per-Ascension top-5 lists of { name, wave }
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

    return {
        KEY,
        SCHEMA_VERSION,
        TOWER_TYPES,
        createFreshSave,
        migrateLegacy,
        load,
        write,
        calculateRunXP,
        recordRun
    };
})();
