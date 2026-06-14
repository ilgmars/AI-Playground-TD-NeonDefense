// Rule-based autopilot. Runs every AUTOPILOT_CONFIG.tickInterval update ticks.
// Each tick: at most ONE of { build a tower, upgrade a tower }, and maybe
// a potion buy. Behavior is unchanged from the original inline implementation
// in game.js — this class only reorganizes the logic into named phases.

// M3: Extract base type from a tower type string.
// e.g. 'laser_pulse' → 'laser', 'flak_emp' → 'flak', 'laser' → 'laser'.
// Handles variants whose names are baseType_suffix (all M3 variants follow this).
// Exception: 'income_research' should map to 'income' (two-word base).
function baseOf(towerType) {
    if (!towerType) return towerType;
    // Handle income_research specially — its base is 'income'.
    if (towerType === 'income_research') return 'income';
    // All other variants follow baseType_suffix pattern.
    const under = towerType.indexOf('_');
    return under === -1 ? towerType : towerType.slice(0, under);
}

function effectiveTowerType(game, towerType) {
    if (game && typeof game.getEffectiveTowerType === 'function') {
        return game.getEffectiveTowerType(towerType);
    }
    return towerType;
}

class Autopilot {
    constructor(game) {
        this.game = game;
    }

    // Entry point — called from Game.update() on each autopilot tick.
    // Drains affordable build+upgrade picks until either nothing was actionable
    // this loop or MAX_ACTIONS_PER_TICK is hit. Late-game income often outpaces
    // a single-action-per-tick spend rate; this lets the autopilot keep up
    // without changing the tick interval (which would also speed up potion
    // buying / ability use).
    run() {
        this._tryUseAbilities();

        const g = this.game;
        const MAX_ACTIONS_PER_TICK = (AUTOPILOT_CONFIG.maxActionsPerTick) || 4;

        for (let action = 0; action < MAX_ACTIONS_PER_TICK; action++) {
            const state = this._analyzeState();

            // Potion only on the first pass — re-analysis happens implicitly
            // since potion changes health, not the build/upgrade decision space.
            if (action === 0) this._tryBuyPotion(state);

            state.savingForPotion = (
                g.health <= AUTOPILOT_CONFIG.potionHealthThreshold &&
                g.health < g.maxHealth &&
                g.money < g.getPotionCost()
            );

            const moneyBefore = g.money;
            const built = this._tryBuild(state);
            let upgraded = false;
            if (!built || g.money >= AUTOPILOT_CONFIG.upgradeAlongsideBuild) {
                upgraded = this._tryUpgrade(state);
            }

            // Nothing actionable this loop — stop draining.
            if (!built && !upgraded) break;
            if (g.money === moneyBefore) break;
        }
    }

    // -----------------------------------------------------------------
    // State analysis
    // -----------------------------------------------------------------

    // Compute everything the decision phases need, once per tick.
    _analyzeState() {
        const g = this.game;
        const w = g.wave;

        const counts = this._countTowers();
        const wanted = this._wantedCounts(w);

        const isAirWave     = g.currentWaveDef && g.currentWaveDef.type === 'air';
        const airInterval   = (g.ascension && g.ascension.airWaveInterval) || 5;
        const wavesUntilAir = isAirWave ? 0 : (airInterval - (w % airInterval)) % airInterval;
        const isAirImminent = isAirWave || wavesUntilAir <= AUTOPILOT_CONFIG.airImminentWindow;

        // Role-critical: flak needed from first air wave onward; laser needed from wave 3.
        const needFlak   = w >= Math.max(2, airInterval - 2) && counts.flak < Math.max(1, wanted.flak);
        // urgentFlak: original first-air-wave warning, OR mid-air-wave panic
        // (active air wave with zero flak — bypass placement scoring later).
        const urgentFlak = (w === airInterval && !g.currentWaveDef && counts.flak === 0)
                         || (isAirWave && counts.flak === 0);
        const needLaser  = w >= 3 && counts.laser === 0 && this._isBuildable('laser');

        const targetType = this._pickTargetType(counts, wanted, urgentFlak, needFlak, needLaser);

        const totalTowers = g.towers.length;
        const totalWanted = Object.values(wanted).reduce((a, b) => a + b, 0);
        const mustBuild   = totalTowers < AUTOPILOT_CONFIG.mustBuildMinTowers
                            || urgentFlak || needFlak || needLaser
                            || totalTowers < Math.floor(totalWanted * AUTOPILOT_CONFIG.mustBuildWantedFraction);
        const buildChance = AUTOPILOT_CONFIG.buildChance(w);
        const preferBuild = mustBuild || totalTowers < totalWanted || Math.random() < buildChance;

        const saving = this._computeSaving(counts, wanted, targetType, urgentFlak, needFlak, needLaser, totalTowers);

        return {
            w, counts, wanted,
            isAirImminent,
            urgentFlak, needFlak, needLaser,
            targetType,
            preferBuild,
            savingForTower: saving.forTower,
            savingCost: saving.cost
        };
    }

    _countTowers() {
        const counts = { basic: 0, sniper: 0, rapid: 0, laser: 0, rocket: 0, flak: 0, electric: 0, silo: 0, income: 0,
            mortar: 0, disruptor: 0, railgun: 0, beacon: 0 };
        // M3: Use baseOf so variants (e.g. laser_pulse, flak_emp) count toward their base type.
        for (let t of this.game.towers) {
            const base = baseOf(t.type);
            if (base in counts) counts[base]++;
        }
        return counts;
    }

    // Respect the player's tech-tree unlocks: the autopilot only builds what
    // the player could build by hand. In bare headless harnesses without
    // main.js the helper is absent → treat everything as buildable (those
    // harnesses unlock all towers, so the full mix is still exercised).
    _isBuildable(type) {
        if (typeof window !== 'undefined' && typeof window.isTowerUnlocked === 'function') {
            return window.isTowerUnlocked(type);
        }
        return true;
    }

    _wantedCounts(wave) {
        const wanted = {};
        const capMult = AUTOPILOT_CONFIG.wantedCountCapMult || {};
        for (let type in AUTOPILOT_CONFIG.wantedCount) {
            // Locked towers want 0 → every selection path (deficit scan,
            // affordable pick, fallback) keys off wanted, so they're never
            // chosen until unlocked.
            if (!this._isBuildable(type)) { wanted[type] = 0; continue; }
            const raw = AUTOPILOT_CONFIG.wantedCount[type](wave);
            const mult = (capMult[type] !== undefined) ? capMult[type] : 1.0;
            wanted[type] = Math.max(0, Math.round(raw * mult));
        }
        return wanted;
    }

    // Which tower type to try to build (regardless of affordability).
    _pickTargetType(counts, wanted, urgentFlak, needFlak, needLaser) {
        if (urgentFlak || needFlak) return 'flak';
        if (needLaser) return 'laser';

        // Biggest deficit in buildOrder sequence. Ties break toward the first type.
        let best = 'basic';
        let bestDeficit = -1;
        for (let type of AUTOPILOT_CONFIG.buildOrder) {
            const d = wanted[type] - counts[type];
            if (d > bestDeficit) { bestDeficit = d; best = type; }
        }
        return best;
    }

    // Decide whether to hold money for an important tower purchase.
    _computeSaving(counts, wanted, targetType, urgentFlak, needFlak, needLaser, totalTowers) {
        const g = this.game;
        const CFG = AUTOPILOT_CONFIG;

        if (urgentFlak && g.money < this._towerCost('flak') + CFG.saveBufferFlakUrgent) {
            return { forTower: 'flak', cost: this._towerCost('flak') + CFG.saveBufferFlakUrgent };
        }
        // Only block upgrades/builds for the FIRST flak. Once we have ≥1,
        // subsequent flaks are handled by normal build priority.
        if (needFlak && counts.flak === 0 && g.money < this._towerCost('flak') + CFG.saveBufferFlakNeeded) {
            return { forTower: 'flak', cost: this._towerCost('flak') + CFG.saveBufferFlakNeeded };
        }
        if (needLaser && g.money < this._towerCost('laser')) {
            return { forTower: 'laser', cost: this._towerCost('laser') };
        }
        if (targetType && counts[targetType] < wanted[targetType] && g.money < this._towerCost(targetType)) {
            const deficit = wanted[targetType] - counts[targetType];
            if (deficit >= CFG.saveDeficitSevere
                || (deficit >= CFG.saveDeficitModerate && totalTowers < CFG.saveEarlyTowerTotal)) {
                return { forTower: targetType, cost: this._towerCost(targetType) };
            }
        }
        return { forTower: null, cost: 0 };
    }

    // -----------------------------------------------------------------
    // Phase 1: build
    // -----------------------------------------------------------------

    _tryBuild(state) {
        if (state.savingForPotion) return false;
        if (!state.preferBuild) return false;
        const saveCommit = AUTOPILOT_CONFIG.saveCommitFraction || 0.75;
        const savedTowerCost = state.savingForTower ? this._towerCost(state.savingForTower) : 0;
        if (state.savingForTower
            && this.game.money >= state.savingCost * saveCommit
            && this.game.money < savedTowerCost
            && this.game.money < state.savingCost) return false;
        // After first air wave: hold money for the FIRST flak (0 flak on board).
        // Only block when "close" (within $75 of flak cost): too far away and we need defense now.
        // Once ≥1 flak exists, build/upgrade freely — subsequent flaks via buildOrder.
        const g = this.game;
        const airInterval = (g.ascension && g.ascension.airWaveInterval) || 5;
        const flakCost = this._towerCost('flak');
        if (state.needFlak && state.counts.flak === 0 && state.w > airInterval
            && g.money >= flakCost - 75 && g.money < flakCost) return false;

        const spots = this._findBuildableSpots();
        if (spots.length === 0) {
            state.savingForTower = null; // map full — allow upgrades
            return false;
        }

        let chosenType = this._pickAffordableType(state);
        if (!chosenType) return false;

        if ((state.urgentFlak || state.needFlak) && state.counts.flak === 0 && chosenType !== 'flak') {
            return false;
        }

        let bestSpot = this._pickBestSpot(spots, chosenType);

        // If target type has no valid placement, try alternatives in build-order priority.
        if (!bestSpot) {
            for (const t of AUTOPILOT_CONFIG.buildOrder) {
                if (t === chosenType) continue;
                if (!this._canAfford(t)) continue;
                if ((state.counts[t] || 0) >= (state.wanted[t] || 0)) continue;
                bestSpot = this._pickBestSpot(spots, t);
                if (bestSpot) { chosenType = t; break; }
            }
        }

        if (!bestSpot) {
            // No tower can be placed usefully; allow upgrades instead of hoarding.
            state.savingForTower = null;
            return false;
        }

        this.game.buildTower(bestSpot.c, bestSpot.r, chosenType);
        return true;
    }

    // Returns path-adjacent tiles first; falls back to all buildable tiles
    // when path-adjacent spots are exhausted, so towers keep being placed.
    _findBuildableSpots() {
        const g = this.game;
        const adjacent = [];
        const allSpots = [];
        const neighbors = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]];

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (!g.map.isBuildable(c, r)) continue;
                if (g.towers.find(t => t.c === c && t.r === r)) continue;

                let pathNeighbors = 0, orthoNeighbors = 0;
                for (let i = 0; i < 8; i++) {
                    const nc = c + neighbors[i][0];
                    const nr = r + neighbors[i][1];
                    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
                    const cell = g.map.grid[nr][nc];
                    if (cell === 1 || cell === 2 || cell === 3) {
                        pathNeighbors++;
                        if (i < 4) orthoNeighbors++;
                    }
                }
                const spot = { c, r, pathNeighbors, orthoNeighbors };
                allSpots.push(spot);
                if (pathNeighbors > 0) adjacent.push(spot);
            }
        }
        return adjacent.length > 0 ? adjacent : allSpots;
    }

    // If we can't afford the target, fall back to the best affordable alternative.
    _pickAffordableType(state) {
        const g = this.game;
        const target = state.targetType;
        if (this._canAfford(target)) return target;

        const { counts, wanted, urgentFlak, needFlak } = state;
        const candidates = AUTOPILOT_CONFIG.buildOrder.filter(t => {
            if (!this._canAfford(t)) return false;
            if (t === 'flak')  return urgentFlak || needFlak || counts.flak < wanted.flak;
            if (t === 'laser') return counts.laser < wanted.laser;
            return counts[t] < wanted[t];
        });

        candidates.sort((a, b) => {
            if (urgentFlak || needFlak) {
                if (a === 'flak') return -1;
                if (b === 'flak') return 1;
            }
            return (wanted[b] - counts[b]) - (wanted[a] - counts[a]);
        });
        return candidates[0] || null;
    }

    _towerCost(baseType) {
        if (this.game && typeof this.game.getTowerBuildCost === 'function') return this.game.getTowerBuildCost(baseType);
        const effType = effectiveTowerType(this.game, baseType);
        const cfg = TOWERS[effType] || TOWERS[baseType];
        const mult = (this.game && this.game.towerCostMult) || 1;
        return Math.floor(cfg.cost * mult);
    }

    _canAfford(baseType) {
        if (!baseType) return false;
        if (this.game && typeof this.game.canAfford === 'function') return this.game.canAfford(baseType);
        return this.game.money >= this._towerCost(baseType);
    }

    _pickBestSpot(spots, buildType) {
        let bestSpot = null;
        let bestScore = -9999;
        for (let spot of spots) {
            const score = this._scorePlacement(spot, buildType);
            if (score > bestScore) { bestScore = score; bestSpot = spot; }
        }
        if (bestScore <= -9999) return null;
        return bestSpot;
    }

    // Combined score: path coverage + tower-specific shape preferences + laser synergy.
    _scorePlacement(spot, buildType) {
        const effType = effectiveTowerType(this.game, buildType);
        const towerCfg = TOWERS[effType] || TOWERS[buildType];
        const range = towerCfg.range;

        // How many path tiles this spot can reach with its range.
        const pathCoverage = this._pathTilesInRange(spot, range);

        // Combat towers that cannot reach the path are dead spend; save money for upgrades.
        if (range > 0 && pathCoverage === 0) return -9999;

        let score = Math.random();
        score += pathCoverage * 0.3;

        score += this._typeShapeBonus(spot, baseOf(effType), pathCoverage);
        score += this._laserSynergyBonus(spot, buildType);

        return score;
    }

    _pathTilesInRange(spot, range) {
        const g = this.game;
        let count = 0;
        for (let pr = 0; pr < ROWS; pr++) {
            for (let pc = 0; pc < COLS; pc++) {
                const cell = g.map.grid[pr][pc];
                if (cell !== 1 && cell !== 2 && cell !== 3) continue;
                if (Math.hypot(pc - spot.c, pr - spot.r) * TILE_SIZE <= range) count++;
            }
        }
        return count;
    }

    _typeShapeBonus(spot, buildType, pathCoverage) {
        const g = this.game;

        if (buildType === 'flak') {
            // Middle of the path gives flak the widest intercept window.
            const startP = g.map.path[0];
            const endP   = g.map.path[g.map.path.length - 1];
            const midC = (startP.c + endP.c) / 2;
            const midR = (startP.r + endP.r) / 2;
            return Math.max(0, 12 - Math.hypot(spot.c - midC, spot.r - midR)) * 6
                 + pathCoverage * 3;
        }

        if (buildType === 'rapid' || buildType === 'basic') {
            // Short-range towers want to hug the path.
            return spot.orthoNeighbors * 4 + spot.pathNeighbors * 1;
        }
        if (buildType === 'sniper') {
            // Prefer open space with some path visibility.
            return -spot.orthoNeighbors * 2 + pathCoverage * 0.2;
        }
        if (buildType === 'silo') {
            // Range is only 100px (2.5 tiles) — must hug the path. Penalize
            // stacking near another silo (overlapping orbits = wasted spend).
            return spot.orthoNeighbors * 3 + pathCoverage * 0.5
                 - this._sameTypeProximityPenalty(spot, 'silo', 3, 8);
        }
        if (buildType === 'rocket') {
            // Longer range (200px), slightly prefer central position.
            // Mild penalty on stacking — splash towers want spread coverage.
            return -(Math.abs(spot.c - COLS / 2) + Math.abs(spot.r - ROWS / 2)) * 0.3
                   - spot.orthoNeighbors * 1
                   - this._sameTypeProximityPenalty(spot, 'rocket', 4, 4);
        }
        if (buildType === 'laser' || buildType === 'electric') {
            return spot.orthoNeighbors * 1;
        }
        return 0;
    }

    // Penalty per same-base-type tower within `radius` tiles. Used to discourage
    // stacking splash towers (silos / rockets) so coverage spreads out.
    _sameTypeProximityPenalty(spot, baseType, radius, perHit) {
        let n = 0;
        for (const t of this.game.towers) {
            if (baseOf(t.type) !== baseType) continue;
            if (Math.hypot(t.c - spot.c, t.r - spot.r) <= radius) n++;
        }
        return n * perHit;
    }

    // Flat bonus for placing near an existing laser (encourages chokepoint stacking).
    _laserSynergyBonus(spot, buildType) {
        if (buildType === 'flak') return 0;
        // M3: Match both 'laser' base and 'laser_pulse' variant.
        const lasers = this.game.towers.filter(t => baseOf(t.type) === 'laser');
        for (let laser of lasers) {
            if (Math.hypot(laser.c - spot.c, laser.r - spot.r) <= AUTOPILOT_CONFIG.laserSynergyRange) {
                return AUTOPILOT_CONFIG.laserSynergyScore;
            }
        }
        return 0;
    }

    // -----------------------------------------------------------------
    // Phase 2: upgrade
    // -----------------------------------------------------------------

    _tryUpgrade(state) {
        if (state.savingForTower) return false;
        if (state.savingForPotion) return false;

        const g = this.game;

        // Collect every affordable upgrade across every tower.
        const options = [];
        for (let t of g.towers) {
            for (let i = 0; i < 3; i++) {
                const cost = t.getUpgradeCost(i);
                if (g.money >= cost) options.push({ t, i, cost });
            }
        }
        if (options.length === 0) return false;

        options.sort(this._upgradeComparator(state.isAirImminent));

        const pick = options[0];
        g.money -= pick.cost;
        pick.t.upgrade(pick.i);
        g.addUpgradeEffect(pick.t.x, pick.t.y);
        g.uiDirty = true;
        return true;
    }

    // Comparator that encodes the upgrade priority:
    //   1. During air imminent windows: flak > laser > everything else
    //   2. Lower-total-level towers first (spread upgrades)
    //   3. Higher upgradeValue type first
    _upgradeComparator(isAirImminent) {
        const values = AUTOPILOT_CONFIG.upgradeValue;
        return (a, b) => {
            if (isAirImminent) {
                // M3: Use baseOf so variants (flak_emp, laser_pulse) share upgrade priority.
                const aBase = baseOf(a.t.type), bBase = baseOf(b.t.type);
                if (aBase === 'flak'  && bBase !== 'flak')  return -1;
                if (bBase === 'flak'  && aBase !== 'flak')  return  1;
                if (aBase === 'laser' && bBase !== 'laser') return -1;
                if (bBase === 'laser' && aBase !== 'laser') return  1;
            }
            // Weighted score: high-value tower types beat low-value ones even
            // when slightly more leveled. Formula: upgradeValue*2 - totalLevel.
            // Silo (10) at L4 = 16 still beats Basic (3) at L0 = 6.
            const aTotal = a.t.upgrades[0] + a.t.upgrades[1] + a.t.upgrades[2];
            const bTotal = b.t.upgrades[0] + b.t.upgrades[1] + b.t.upgrades[2];
            const aScore = (values[baseOf(a.t.type)] || 1) * 2 - aTotal;
            const bScore = (values[baseOf(b.t.type)] || 1) * 2 - bTotal;
            return bScore - aScore;
        };
    }

    // -----------------------------------------------------------------
    // Phase 3: emergency potion
    // -----------------------------------------------------------------

    _tryBuyPotion(state) {
        const g = this.game;
        if (g.health > AUTOPILOT_CONFIG.potionHealthThreshold) return;
        if (g.health >= g.maxHealth) return;
        const cost = g.getPotionCost();
        if (g.money < cost) return;
        // Survival beats tower savings — buy potion unconditionally when affordable.
        g.buyPotion();
    }

    // -----------------------------------------------------------------
    // Phase 0: abilities (runs before build/upgrade/potion)
    // -----------------------------------------------------------------

    // M3: Autopilot triggers Airstrike on dense clusters and Freeze on low HP.
    // Scan is ignored (pure info).
    _tryUseAbilities() {
        if (!this.game.ability || !this.game.ability.isUsable()) return;
        if (this.game.state !== 'playing') return;

        const kind = this.game.ability.kind;
        if (kind === 'target') {
            // Airstrike — find densest cluster of enemies, strike if >= 8
            let best = null;
            let bestCount = 0;
            for (const e of this.game.enemies) {
                if (!e.active) continue;
                let count = 0;
                for (const o of this.game.enemies) {
                    if (!o.active) continue;
                    const dx = o.x - e.x, dy = o.y - e.y;
                    if (dx*dx + dy*dy <= 80*80) count++;
                }
                if (count > bestCount) { bestCount = count; best = e; }
            }
            if (bestCount >= 8 && best) {
                if (this.game.ability.tryUse()) {
                    this.game.airstrike(best.x, best.y);
                    if (typeof window.refreshAbilityUI === 'function') window.refreshAbilityUI();
                }
            }
        } else if (kind === 'instant') {
            // Freeze — trigger when HP <= 3 (emergency save)
            if (this.game.health <= 3) {
                if (this.game.ability.tryUse()) {
                    this.game.freezeAllEnemies(180);
                    if (typeof window.refreshAbilityUI === 'function') window.refreshAbilityUI();
                }
            }
        }
        // kind === 'reveal' (Scan): autopilot ignores info-only abilities.
    }
}
