class Game {
    constructor(canvas, seed, ascensionTier, loadout) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Ascension is endless — accept any non-negative integer. Effects
        // beyond the named tiers stack procedurally (see config.js).
        this.ascensionTier = Math.max(0, (ascensionTier | 0));
        this.ascension = getAscensionEffects(this.ascensionTier);

        this.map = new GameMap(seed);
        this.seed = this.map.seed;
        this.enemies = [];
        this.towers = [];
        this.projectiles = [];
        this.particles = [];
        this.upgradeEffects = [];

        this.money = Math.floor(125 * this.ascension.startMoneyMult);

        // M2: loadout state (set before apply).
        this.loadout = loadout || { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none' };
        this.towerCostMult = 1;
        this.upgradeCostMult = 1;
        this.potionHealBonus = 0;
        this.potionCostKitMult = 1;
        this.startingPotions = 0;
        this.prePlaceRelay = false;
        this.showAllWavesPreview = false;

        // Roguelike boons (offered every 10 waves). Multipliers/accumulators
        // read by the economy & combat hooks; default to no-op.
        this.boons = [];                 // ids taken, in order
        this.pendingBoon = false;        // set at wave-complete, drained by main.js
        this.boonDamageMult = 1;
        this.boonFireRateMult = 1;
        this.boonPayoutMult = 1;
        this.boonKillMult = 1;
        this.boonInterest = 0;
        this.boonRegen = 0;

        this.autopilotTickInterval = AUTOPILOT_CONFIG.tickInterval;
        this.ability = null;  // set by applyLoadout

        this.health = 20;
        this.maxHealth = 20;
        // Tracks whether any enemy ever reached the base this run. The
        // retire +50% XP bonus only fires when this stays false (i.e. a
        // "flawless" retire). Boons / backpack items that grant max HP
        // mid-run don't reset it.
        this.hpEverLost = false;

        this.applyLoadout();

        this.wave = 1;
        this.selectedTower = null;
        this.autopilot = false;
        this.autopilotTimer = 0;
        this.state = 'start'; 
        this.uiDirty = false;
        this.potionCount = 0; // tracks purchases for scaling cost
        
        this.waveData = [
            { count: 10, type: 'normal', spawnRate: 60, hpMult: 1 },
            { count: 15, type: 'normal', spawnRate: 50, hpMult: 1.2 },
            { count: 10, type: 'fast', spawnRate: 40, hpMult: 1.2 },
            { count: 20, type: 'normal', spawnRate: 40, hpMult: 1.5 },
            { count: 5, type: 'tank', spawnRate: 90, hpMult: 1.5 },
            { count: 15, type: 'fast', spawnRate: 30, hpMult: 1.8 },
            { count: 10, type: 'tank', spawnRate: 80, hpMult: 2.0 },
            { count: 30, type: 'normal', spawnRate: 30, hpMult: 2.5 },
            { count: 20, type: 'fast', spawnRate: 20, hpMult: 3.0 },
            { count: 15, type: 'tank', spawnRate: 60, hpMult: 3.5 }
        ];
        
        this.currentWaveDef = null;
        this.spawnTimer = 0;
        this.enemiesSpawned = 0;
        this.waveCooldown = 0; 
    }

    applyLoadout() {
        const heroKey = this.loadout.heroId ? this.loadout.heroId.replace(/^hero\./, '') : null;
        const kitKey  = this.loadout.kitId  ? this.loadout.kitId.replace(/^kit\./, '')  : null;
        if (heroKey && HEROES[heroKey] && HEROES[heroKey].apply) HEROES[heroKey].apply(this);
        if (kitKey  && STARTER_KITS[kitKey]  && STARTER_KITS[kitKey].apply)  STARTER_KITS[kitKey].apply(this);
        this.ability = NeonAbilities.createInstance(this.loadout.abilityId);
        this.abilityTargetMode = false;   // true when awaiting click for Airstrike
        this.freezeTimer = 0;             // frames left on Freeze effect
        // M3: Tower loadout (base → variant) drives buildTower resolution.
        this.towerLoadout = this.loadout.towerLoadout || {};
        this.applyBackpack();
    }

    // Backpack items → existing balance-safe run hooks. An empty backpack
    // (fresh save / auto-tune harness) sums to all-zeros, so this is a
    // strict no-op there and the difficulty curve is untouched. Effects are
    // modest and the grid is small, so total power stays bounded.
    applyBackpack() {
        const save = window.save;
        if (!save || !save.backpack || !window.NeonBackpack || typeof BACKPACK_ITEMS === 'undefined') return;
        const s = window.NeonBackpack.computeStats(save.backpack, BACKPACK_ITEMS);
        if (s.damage)      this.boonDamageMult   *= (1 + s.damage);
        if (s.fireRate)    this.boonFireRateMult *= Math.max(0.4, 1 - s.fireRate);
        if (s.payout)      this.boonPayoutMult   *= (1 + s.payout);
        if (s.kill)        this.boonKillMult     *= (1 + s.kill);
        if (s.maxHP)     { this.maxHealth += s.maxHP; this.health += s.maxHP; }
        if (s.interest)    this.boonInterest     += s.interest;
        if (s.towerCost)   this.towerCostMult    *= Math.max(0.4, 1 - s.towerCost);
        if (s.upgradeCost) this.upgradeCostMult  *= Math.max(0.4, 1 - s.upgradeCost);
        if (s.startMoney)  this.money            += Math.floor(s.startMoney);
        if (s.regen)       this.boonRegen        += s.regen;
    }

    // M3: Given a base tower type (e.g. 'basic'), return the effective type
    // to build — either the base or its variant — based on this.towerLoadout.
    // Also handles pass-through of variant ids directly.
    getEffectiveTowerType(requestedType) {
        // If caller already passed a variant id, use it.
        if (requestedType && requestedType.includes('_')) return requestedType;
        const chosen = this.towerLoadout[requestedType];
        const variantUnlocked = window.save
            && window.save.towerMastery
            && window.save.towerMastery[requestedType]
            && window.save.towerMastery[requestedType].milestones
            && window.save.towerMastery[requestedType].milestones.m1;
        if (chosen && TOWERS[chosen] && chosen === TOWER_VARIANTS[requestedType] && variantUnlocked) return chosen;
        return requestedType;
    }

    start() {
        this.state = 'playing';
        this.applyPostInitEffects();
        this.startWave();
        this.updateUI();
    }

    // M2: Effects that depend on the map being ready (path midpoint, etc).
    applyPostInitEffects() {
        // Medic: N starting potions — implemented as immediate HP refund at run start
        // (bounded by maxHealth via Math.min).
        if (this.startingPotions > 0) {
            const baseHeal = (this.ascension.potionHeal !== null) ? this.ascension.potionHeal : POTION_CONFIG.healAmount;
            const heal = baseHeal + this.potionHealBonus;
            this.health = Math.min(this.maxHealth, this.health + heal * this.startingPotions);
        }

        // Economist: pre-place a free Relay at the tile nearest to the path midpoint.
        if (this.prePlaceRelay) this.placeFreeRelay();
    }

    // Find a buildable tile nearest to the path midpoint and place a free Relay.
    placeFreeRelay() {
        const path = this.map.path;
        if (!path || path.length === 0) return;
        const mid = path[Math.floor(path.length / 2)];
        let best = null;
        let bestDist = Infinity;
        for (let r = 0; r < window.ROWS; r++) {
            for (let c = 0; c < window.COLS; c++) {
                if (!this.map.isBuildable(c, r)) continue;
                const occupied = this.towers.find(t => t.c === c && t.r === r);
                if (occupied) continue;
                const dx = c - mid.c;
                const dy = r - mid.r;
                const d2 = dx*dx + dy*dy;
                if (d2 < bestDist) { bestDist = d2; best = { c, r }; }
            }
        }
        if (best) {
            const relay = new Tower(best.c, best.r, 'income');
            relay.totalSpent = 0;  // Free tower doesn't count toward investment-factor scaling.
            this.towers.push(relay);
        }
    }

    startWave() {
        // Multiplayer hook (versus mode): drain the spike queue BEFORE
        // the wave is built, so the controller can return how many
        // extra enemies (and of which types) the wave should include.
        // Returns { amount, mix } or null. No-op in single-player.
        const spikeInjection = this._onWaveStart
            ? (() => { try { return this._onWaveStart(this.wave); } catch (_) { return null; } })()
            : null;
        // M3: A10 — every 10th wave is a boss wave (one boss replaces normal spawns).
        this.isBossWave = this.ascension.spawnBoss && this.wave > 0 && this.wave % 10 === 0;


        // M3: Research Node aura — boosts damage of all towers within auraRange
        // tiles of each Research Node by auraBonus. Recomputes each wave (stackable).
        for (const t of this.towers) t.auraDamageBonus = 0;
        const researchNodes = this.towers.filter(t => t.type === 'income_research');
        for (const rn of researchNodes) {
            for (const t of this.towers) {
                if (t === rn) continue;
                const dc = t.c - rn.c, dr = t.r - rn.r;
                const dist = Math.sqrt(dc*dc + dr*dr);
                if (dist <= (rn.auraRange || 3)) {
                    t.auraDamageBonus = (t.auraDamageBonus || 0) + (rn.auraBonus || 0.02);
                }
            }
        }

        // Calculate total tower power for dynamic difficulty
        let totalTowerValue = 0;
        for (let t of this.towers) {
            totalTowerValue += t.totalSpent;
        }
        
        // Investment-based scaling: enemies scale with player power
        // This creates dynamic difficulty that responds to player strategy
        // Uses soft caps to prevent death spiral while maintaining challenge
        let investmentFactor;
        if (this.ascension.disableInvestCap) {
            // A6: soft caps removed — enemy HP scales 1:1 with investment forever.
            investmentFactor = 1 + (totalTowerValue / 5000);
        } else if (this.wave <= 20) {
            // Waves 1-20: Very gentle investment scaling (every 5000¢ = +1.0x)
            investmentFactor = 1 + (totalTowerValue / 5000);
        } else if (this.wave <= 35) {
            // Waves 21-35: Investment with gentle cap
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 4); // Cap starts at 4x
            investmentFactor = 4 + Math.sqrt(excess) * 1.0; // Moderate soft cap
        } else if (this.wave <= 55) {
            // Waves 36-55: Investment capped but still relevant
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 6); // Cap starts at 6x
            investmentFactor = 6 + Math.sqrt(excess) * 0.8; // Stronger soft cap
        } else if (this.wave <= 100) {
            // Waves 56-100: Investment heavily capped
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 8); // Cap starts at 8x
            investmentFactor = 8 + Math.log(1 + excess) * 0.7; // Logarithmic cap
        } else {
            // Waves 101+: Investment very heavily capped for extreme endgame
            let baseInvestment = 1 + (totalTowerValue / 5000);
            let excess = Math.max(0, baseInvestment - 10); // Cap starts at 10x
            investmentFactor = 10 + Math.log(1 + excess) * 0.5; // Strong logarithmic cap
        }

        // Wave-based scaling: provides baseline difficulty progression
        // Combined with investment factor for dynamic challenge
        let baseExpFactor;
        if (this.wave <= 5) {
            // Waves 1-5: Very gentle tutorial
            baseExpFactor = 0.65 + this.wave * 0.1; // 0.75, 0.85, 0.95, 1.05, 1.15
        } else if (this.wave <= 12) {
            // Waves 6-12: Gentle early game ramp
            baseExpFactor = 1.15 * Math.pow(1.05, this.wave - 5); // ~1.15 to ~1.6
        } else if (this.wave <= 25) {
            // Waves 13-25: Smooth mid-early game
            baseExpFactor = 1.6 * Math.pow(1.04, this.wave - 12); // ~1.6 to ~2.5
        } else if (this.wave <= 40) {
            // Waves 26-40: Mid-game
            baseExpFactor = 2.5 * Math.pow(1.038, this.wave - 25); // ~2.5 to ~4.2
        } else if (this.wave <= 60) {
            // Waves 41-60: Late game
            baseExpFactor = 4.2 * Math.pow(1.03, this.wave - 40); // ~4.2 to ~7.0
        } else if (this.wave <= 100) {
            // Waves 61-100: Extended endgame
            let endlessWaves = this.wave - 60;
            baseExpFactor = 7.0 + Math.log(1 + endlessWaves) * 0.8; // ~7.0 to ~10.0
        } else if (this.wave <= 200) {
            // Waves 101-200: Deep endgame with gentle growth
            let deepWaves = this.wave - 100;
            baseExpFactor = 10.0 + Math.log(1 + deepWaves) * 0.6; // ~10.0 to ~13.1
        } else {
            // Waves 201+: Extreme endgame with exponential milestone difficulty spikes
            let extremeWaves = this.wave - 200;
            
            // Base logarithmic growth
            let baseGrowth = 13.1 + Math.log(1 + extremeWaves) * 0.5;
            
            // Exponential milestone bonuses every 20 waves (220, 240, 260, etc.)
            let milestonesPassed = Math.floor(extremeWaves / 20);
            // Each milestone is stronger: 0.7, 0.84, 1.01, 1.21, 1.45...
            let milestoneBonus = 0;
            for (let i = 0; i < milestonesPassed; i++) {
                milestoneBonus += 0.7 * Math.pow(1.2, i); // 20% exponential growth per milestone
            }
            
            // Gradual ramp within each 20-wave segment
            let segmentProgress = (extremeWaves % 20) / 20; // 0 to 1
            let nextMilestoneValue = 0.7 * Math.pow(1.2, milestonesPassed);
            let segmentRamp = segmentProgress * nextMilestoneValue * 0.6; // Ramp to 60% of next milestone
            
            baseExpFactor = baseGrowth + milestoneBonus + segmentRamp;
        }

        // Final HP = base wave difficulty × capped investment factor
        // Investment helps early, but wave progression dominates late game
        let finalHpMult = baseExpFactor * investmentFactor;

        // Additional overall difficulty multiplier after wave 200
        // Increases by +3% every 5 waves (indefinitely)
        if (this.wave > 200) {
            let extremeWaves = this.wave - 200;
            let milestonesPassed = Math.floor(extremeWaves / 5);
            // Base 5% increase + 3% per 5 waves
            let overallDifficultyMultiplier = 1.05 + (milestonesPassed * 0.03);
            finalHpMult *= overallDifficultyMultiplier;
        }

        // Ascension HP multiplier (cumulative from A1 +15% upward)
        finalHpMult *= this.ascension.hpMult;

        if (this.wave > 0 && this.wave % this.ascension.airWaveInterval === 0) {
            // Air waves: challenging but fair with extreme endgame scaling
            let airCount;
            if (this.wave <= 15) {
                airCount = 7 + this.wave * 0.35; // Gentle early air
            } else if (this.wave <= 30) {
                airCount = 12.25 + (this.wave - 15) * 0.28; // Moderate mid-game growth
            } else if (this.wave <= 55) {
                airCount = 16.45 + (this.wave - 30) * 0.24; // Steady late game
            } else if (this.wave <= 100) {
                airCount = 22.45 + Math.log(this.wave - 54) * 3.0; // Logarithmic endgame
            } else if (this.wave <= 200) {
                airCount = 26.0 + Math.log(this.wave - 99) * 2.5; // Deep endgame
            } else {
                // Waves 201+: Extreme endgame with exponential milestone scaling
                let extremeWaves = this.wave - 200;
                let baseCount = 28.5 + Math.log(1 + extremeWaves) * 2.0;
                
                // Exponential milestone bonuses every 20 waves (220, 240, 260, etc.)
                let milestonesPassed = Math.floor(extremeWaves / 20);
                let milestoneBonus = 0;
                for (let i = 0; i < milestonesPassed; i++) {
                    milestoneBonus += 2.5 * Math.pow(1.15, i); // 15% exponential growth per milestone
                }
                
                airCount = baseCount + milestoneBonus;
            }
            
            this.currentWaveDef = {
                count: Math.min(300, Math.floor(airCount * this.ascension.countMult)),
                type: 'air',
                spawnRate: Math.max(20, 50 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 0.98
            };
            this.enemiesSpawned = 0;
            this.spawnTimer = 60;
            return;
        }

        let idx = (this.wave - 1) % this.waveData.length;
        let def = this.waveData[idx];

        let loops = Math.floor((this.wave - 1) / this.waveData.length);
        
        // Count scaling: gentle growth for early/mid game, milestone scaling for extreme endgame
        let countMult;
        if (this.wave <= 20) {
            countMult = 1 + loops * 0.15; // Very gentle early game
        } else if (this.wave <= 40) {
            countMult = 1 + loops * 0.15 + (this.wave - 20) * 0.01; // Slow mid-game
        } else if (this.wave <= 60) {
            countMult = 1 + loops * 0.15 + 20 * 0.01 + (this.wave - 40) * 0.014; // Moderate late game
        } else if (this.wave <= 100) {
            let baseCount = 1 + loops * 0.15 + 20 * 0.01 + 20 * 0.014;
            countMult = baseCount + Math.log(this.wave - 59) * 0.28; // Logarithmic endgame
        } else if (this.wave <= 200) {
            let baseCount = 1 + loops * 0.15 + 20 * 0.01 + 20 * 0.014 + Math.log(41) * 0.28;
            countMult = baseCount + Math.log(this.wave - 99) * 0.22; // Deep endgame
        } else {
            // Waves 201+: Extreme endgame with exponential milestone scaling
            let extremeWaves = this.wave - 200;
            let baseCount = 1 + loops * 0.15 + 20 * 0.01 + 20 * 0.014 + Math.log(41) * 0.28 + Math.log(101) * 0.22;
            let logGrowth = Math.log(1 + extremeWaves) * 0.18;
            
            // Exponential milestone bonuses every 20 waves (220, 240, 260, etc.)
            let milestonesPassed = Math.floor(extremeWaves / 20);
            let milestoneBonus = 0;
            for (let i = 0; i < milestonesPassed; i++) {
                milestoneBonus += 0.15 * Math.pow(1.15, i); // 15% exponential growth per milestone
            }
            
            countMult = baseCount + logGrowth + milestoneBonus;
        }

        this.currentWaveDef = {
            count: Math.min(300, Math.floor(def.count * countMult * this.ascension.countMult)),
            type: def.type,
            spawnRate: Math.max(12, def.spawnRate - loops * 2),
            hpMult: def.hpMult * finalHpMult
        };

        // Versus spike injection — bump the wave count by the queued
        // total. Mix isn't fine-grained here (the wave still spawns
        // homogeneous enemies of def.type), but the AMOUNT is honoured.
        // Bounded so a fat spike can't push a wave past the 300 cap.
        if (spikeInjection && spikeInjection.amount > 0) {
            const bonus = Math.max(0, Math.min(60, spikeInjection.amount | 0));
            this.currentWaveDef.count = Math.min(300, this.currentWaveDef.count + bonus);
            this.lastSpikeBonus = bonus;
        }

        this.enemiesSpawned = 0;
        this.spawnTimer = 60;
    }

    addUpgradeEffect(x, y) {
        this.upgradeEffects.push({
            x: x + TILE_SIZE / 2,
            y: y + TILE_SIZE / 2,
            radius: 0,
            alpha: 1
        });
    }

    runAutopilot() {
        // Implementation lives in src/ai/autopilot.js. Instantiated lazily on first call.
        if (!this._autopilotRunner) this._autopilotRunner = new Autopilot(this);
        this._autopilotRunner.run();
    }

    update() {
        if (this.state !== 'playing') return;

        // M2: Freeze ability — decrements per-game timer and unfreezes enemies.
        if (this.freezeTimer > 0) {
            this.freezeTimer--;
            if (this.freezeTimer === 0) {
                for (const e of this.enemies) {
                    e.frozen = false;
                    e.frozenFrames = 0;
                }
            }
        }

        if (this.autopilot) {
            this.autopilotTimer++;
            if (this.autopilotTimer >= this.autopilotTickInterval) {
                this.autopilotTimer = 0;
                this.runAutopilot();
            }
        }

        // Per-tower auto-upgrade — runs at half the autopilot cadence so it
        // remains responsive even when global autopilot is off.
        this._autoUpgradeTimer = (this._autoUpgradeTimer || 0) + 1;
        if (this._autoUpgradeTimer >= 30) {
            this._autoUpgradeTimer = 0;
            this._runAutoUpgrade();
        }

        for (let i = this.upgradeEffects.length - 1; i >= 0; i--) {
            let eff = this.upgradeEffects[i];
            eff.radius += 1.5;
            eff.alpha -= 0.04;
            if (eff.alpha <= 0) {
                this.upgradeEffects.splice(i, 1);
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.update();
            if (!p.active) {
                this.particles.splice(i, 1);
            }
        }
        // Particle / projectile caps. At wave 300+ the spawn rate
        // dwarfs the natural eviction and the array grows unbounded,
        // which is what makes the APK chug. 400 particles is plenty
        // for visual fidelity; older ones are oldest-first dropped.
        const PARTICLE_CAP = 400;
        if (this.particles.length > PARTICLE_CAP) {
            this.particles.splice(0, this.particles.length - PARTICLE_CAP);
        }
        const PROJECTILE_CAP = 400;
        if (this.projectiles.length > PROJECTILE_CAP) {
            this.projectiles.splice(0, this.projectiles.length - PROJECTILE_CAP);
        }

        if (this.currentWaveDef) {
            if (this.enemiesSpawned < this.currentWaveDef.count) {
                if (this.enemiesSpawned >= 10 && this._countActiveEnemies() === 0) {
                    this.enemiesSpawned = this.currentWaveDef.count;
                } else if (this.spawnTimer > 0) {
                    this.spawnTimer--;
                } else if (this.isBossWave && this.enemiesSpawned === 0) {
                    // M3: Boss wave — spawn one boss and short-circuit further spawns.
                    const boss = new Enemy(this.map.path, 'tank', this.currentWaveDef.hpMult);
                    boss.hp *= 20;
                    boss.maxHp *= 20;
                    boss.speed *= 0.5;
                    boss.reward = Math.floor((boss.reward || 0) * 10);
                    boss.radius = Math.max(boss.radius, 20);
                    boss.isBoss = true;
                    this.enemies.push(boss);
                    this.enemiesSpawned = this.currentWaveDef.count;
                } else {
                    const newEnemy = new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult);
                    if (this.freezeTimer > 0) {
                        newEnemy.frozen = true;
                        newEnemy.frozenFrames = this.freezeTimer;
                    }
                    // M3: A8 Shielded — 40% of enemies spawn with a shield.
                    if (this.ascension.spawnShielded && Math.random() < 0.4) {
                        newEnemy.shielded = true;
                        newEnemy.shieldBroken = false;
                    }
                    if (this.ascension.spawnSplitter && Math.random() < 0.3) {
                        newEnemy.splitterGeneration = 1;
                    }
                    this.enemies.push(newEnemy);
                    this.enemiesSpawned++;
                    this.spawnTimer = this.currentWaveDef.spawnRate;
                }
            } else {
                if (this._countActiveEnemies() === 0) {
                    this.currentWaveDef = null;
                    this.waveCooldown = ((this.wave + 1) % this.ascension.airWaveInterval === 0) ? WAVE_CONFIG.airWaveCooldown : WAVE_CONFIG.normalCooldown;
                    
                    // Wave completion bonus with scaling for late game
                    let waveBonus = WAVE_CONFIG.endOfWavePayoutBase + this.wave * WAVE_CONFIG.endOfWavePayoutPerWave;
                    
                    // Late game economic boost to keep up with difficulty
                    if (this.wave > 25) {
                        // Add bonus scaling for waves 26+
                        let lateGameBonus = Math.floor((this.wave - 25) * 4);
                        waveBonus += lateGameBonus;
                    }
                    if (this.wave > 45) {
                        // Extra boost for very late game
                        let veryLateBonus = Math.floor((this.wave - 45) * 3);
                        waveBonus += veryLateBonus;
                    }
                    if (this.wave > 100) {
                        // Deep endgame boost
                        let deepBonus = Math.floor((this.wave - 100) * 5);
                        waveBonus += deepBonus;
                    }
                    if (this.wave > 200) {
                        // Extreme endgame boost with exponential milestone bonuses
                        let extremeWaves = this.wave - 200;
                        let extremeBonus = Math.floor(extremeWaves * 10); // Increased from 8
                        
                        // Exponential milestone bonuses every 20 waves (220, 240, 260, etc.)
                        let milestonesPassed = Math.floor(extremeWaves / 20);
                        let milestoneBonus = 0;
                        for (let i = 0; i < milestonesPassed; i++) {
                            milestoneBonus += Math.floor(350 * Math.pow(1.18, i)); // 18% exponential growth per milestone
                        }
                        
                        waveBonus += extremeBonus + milestoneBonus;
                    }

                    // Ascension payout multiplier (A5 = 0.60), then boons.
                    waveBonus = Math.floor(waveBonus * this.ascension.payoutMult * this.boonPayoutMult);

                    this.money += waveBonus;
                    
                    // Income tower payout
                    let incomeTowers = this.towers.filter(t => t.type === 'income');
                    let relayCount = incomeTowers.length;
                    for (let t of incomeTowers) {
                        // t.incomePerWave can be fractional after mastery / backpack
                        // damage-mult scaling — floor here so credits stay integer.
                        let bonus = Math.floor(t.incomePerWave + (t.networkBonus || 0) * 5 * (relayCount - 1));
                        this.money += bonus;
                        // Income generated × 5 counts as mastery XP — at 20¢/wave
                        // base that's 100 XP/wave, so a Relay reaches the 1k
                        // variant unlock in ~10 productive waves instead of 50.
                        t.damageDealt += bonus * 5;
                    }
                    // Research Node earns 25 XP/wave it's active (no income to scale).
                    for (const t of this.towers) {
                        if (t.type === 'income_research') t.damageDealt += 25;
                    }

                    // Boons (Compound Interest) + Nanorepair regen, applied
                    // after all wave income is banked.
                    if (this.boonInterest > 0) {
                        // Cap interest payout per wave so a banked
                        // fortune doesn't generate an unbounded delta —
                        // both bad for balance and (historically) an
                        // Aegis money-spike false-positive trigger.
                        const interest = Math.min(50000, Math.floor(this.money * this.boonInterest));
                        this.money += interest;
                    }
                    if (this.boonRegen > 0 && this.health < this.maxHealth) {
                        this.health = Math.min(this.maxHealth, this.health + this.boonRegen);
                    }

                    // Roguelike boon pick — capped at one per ascension tier
                    // per run (A0 = 1 boon, A5 = 6 boons), spaced at waves
                    // 30, 80, 130, 180… This replaces the old "boon every
                    // 10 waves forever" which compounded into runaway
                    // economies past wave 200.
                    const boonsTaken = (this.boons && this.boons.length) || 0;
                    const boonCap = (this.ascensionTier | 0) + 1;
                    if (this.wave >= 30 && (this.wave - 30) % 50 === 0 && boonsTaken < boonCap) {
                        this.pendingBoon = true;
                    }
                    
                    if ((this.wave + 1) % this.ascension.airWaveInterval === 0) {
                        SoundFX.siren();
                    }
                }
            }
        } else {
            if (this.waveCooldown > 0) {
                this.waveCooldown--;
                if ((this.wave + 1) % this.ascension.airWaveInterval === 0) {
                    this.airWarning = true;
                } else {
                    this.airWarning = false;
                }
                
                if (this.waveCooldown === 0) {
                    this.wave++;
                    this.startWave();
                    this.airWarning = false;
                    this.uiDirty = true; 
                }
            }
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            let e = this.enemies[i];
            e.update();
            if (e.reachedEnd) {
                this.health--;
                this.hpEverLost = true;     // gates the retire bonus in onRunEnded
                this.enemies.splice(i, 1);
                this.uiDirty = true;
                if (this.health <= 0) {
                    this.gameOver();
                }
            } else if (!e.active) {
                // Multiplayer hook (versus mode): notify the controller
                // about the kill so it can fill the local spike meter.
                // No-op in single-player / race / co-op.
                if (this._onKill) {
                    try { this._onKill(e.type, this); } catch (_) {}
                }
                // Base reward with late-game scaling
                let reward = e.reward;
                if (this.wave > 35) {
                    // Boost rewards in late game to help economy
                    reward = Math.floor(reward * (1 + (this.wave - 35) * 0.025));
                }
                reward = Math.max(1, Math.floor(reward * this.ascension.payoutMult * this.boonKillMult));
                // Split-economy: a kill delivered by a REMOTE peer's
                // tower goes to THEIR bank — not ours. Their sim
                // independently credits its local money. We just skip
                // the local credit here.
                if (!e._noLocalCredit) this.money += reward;
                // M3: Splitter — spawn 2 half-HP, 0.75x-speed children at death site (generation 1 only).
                if (e.splitterGeneration === 1) {
                    for (let s = 0; s < 2; s++) {
                        const child = new Enemy(this.map.path, e.type, 1);
                        child.x = e.x + (s === 0 ? -8 : 8);
                        child.y = e.y;
                        child.hp = e.maxHp * 0.5;
                        child.maxHp = e.maxHp * 0.5;
                        child.speed *= 0.75;
                        child.splitterGeneration = 2;
                        child.pathIndex = e.pathIndex;
                        if (child.isAir && !child.followsPath) {
                            const dx = child.endX - child.x;
                            const dy = child.endY - child.y;
                            const dist = Math.hypot(dx, dy);
                            if (dist > 0) {
                                child.vx = (dx / dist) * child.speed;
                                child.vy = (dy / dist) * child.speed;
                            }
                        }
                        this.enemies.push(child);
                    }
                }
                this.enemies.splice(i, 1);
                this.uiDirty = true;
            }
        }

        // Coop split-economy: attribute each kill to the firing tower
        // so the wave-end credit block can refuse to credit local money
        // for kills delivered by a REMOTE-owned tower. We diff the
        // active set before/after every tower / projectile update; any
        // enemy that flipped active=false in this step was killed by
        // that owner.
        for (let t of this.towers) {
            let before = null;
            if (t._owner === 'remote') {
                before = new Set();
                for (const e of this.enemies) if (e.active) before.add(e);
            }
            t.update(this.enemies, this.projectiles, this.particles);
            if (before) {
                for (const e of this.enemies) {
                    if (!e.active && before.has(e)) e._noLocalCredit = true;
                }
            }
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            let p = this.projectiles[i];
            const srcRemote = !!(p.sourceTower && p.sourceTower._owner === 'remote');
            let before = null;
            if (srcRemote) {
                before = new Set();
                for (const e of this.enemies) if (e.active) before.add(e);
            }
            p.update(this.enemies, this.particles, this.projectiles);
            if (before) {
                for (const e of this.enemies) {
                    if (!e.active && before.has(e)) e._noLocalCredit = true;
                }
            }
            if (!p.active) {
                this.projectiles.splice(i, 1);
            }
        }
    }

    draw() {
        if (this.uiDirty) {
            this.updateUI();
            this.uiDirty = false;
        }
        
        // Reset transform to clear the actual physical canvas area
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Apply High-DPI and responsiveness scaling
        if (window.RENDER_SCALE) {
            this.ctx.scale(window.RENDER_SCALE, window.RENDER_SCALE);
        }
        
        this.map.draw(this.ctx);

        if (this.selectedTowers && this.selectedTowers.length > 0) {
            for (let t of this.selectedTowers) {
                this.ctx.beginPath();
                this.ctx.arc(t.x + TILE_SIZE/2, t.y + TILE_SIZE/2, t.range, 0, Math.PI*2);
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                this.ctx.fill();
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
                
                if (t.type === 'silo' || t.type === 'silo_orbital') {
                    for (let r of t.hoverRockets) {
                        let rx = t.x + TILE_SIZE/2 + Math.cos(r.angle) * r.dist;
                        let ry = t.y + TILE_SIZE/2 + Math.sin(r.angle) * r.dist;
                        this.ctx.beginPath();
                        this.ctx.arc(rx, ry, r.range, 0, Math.PI*2);
                        this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; 
                        this.ctx.lineWidth = 1;
                        this.ctx.stroke();
                    }
                }
            }
        }

        for (let t of this.towers) t.draw(this.ctx);
        for (let e of this.enemies) e.draw(this.ctx);
        for (let p of this.projectiles) p.draw(this.ctx);
        for (let p of this.particles) p.draw(this.ctx);

        for (let eff of this.upgradeEffects) {
            this.ctx.beginPath();
            this.ctx.arc(eff.x, eff.y, eff.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${eff.alpha})`;
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(eff.x, eff.y, eff.radius * 0.8, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(56, 189, 248, ${eff.alpha * 0.5})`;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }

        if (this.airWarning) {
            let alpha = Math.abs(Math.sin(this.waveCooldown / 15));
            this.ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
            this.ctx.font = 'bold 30px Outfit, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.shadowColor = '#ef4444';
            this.ctx.shadowBlur = 10;
            this.ctx.fillText(`WARNING: AIR WAVE IN ${Math.ceil(this.waveCooldown / 60)}`, (window.COLS * window.TILE_SIZE) / 2, (window.ROWS * window.TILE_SIZE) / 2);
            this.ctx.shadowBlur = 0;
        }
    }

    getPotionCost() {
        const base = POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
        return Math.floor(base * this.ascension.potionCostMult * this.potionCostKitMult);
    }

    buyPotion(opts) {
        let cost = this.getPotionCost();
        const remote = opts && opts.source === 'remote';
        // Split-economy: a remote peer healing themselves doesn't touch
        // our money or our HP. We just record the potion happened so
        // mastery / counters stay in sync.
        if (remote) {
            this.potionCount++;
            this.uiDirty = true;
            return true;
        }
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        const baseHeal = (this.ascension.potionHeal !== null)
            ? this.ascension.potionHeal
            : POTION_CONFIG.healAmount;
        const heal = baseHeal + this.potionHealBonus;
        this.health = Math.min(this.maxHealth, this.health + heal);
        this.potionCount++;
        this.uiDirty = true;
        SoundFX.upgrade();
        return true;
    }

    canAfford(type) {
        const effType = this.getEffectiveTowerType(type);
        return this.money >= this.getTowerBuildCost(effType);
    }

    getTowerBuildCost(type) {
        const effType = this.getEffectiveTowerType(type);
        const cfg = TOWERS[effType];
        const baseType = cfg.baseType || effType;
        let masteryCostMult = 1;
        if (baseType === 'income') {
            const mastery = window.save && window.save.towerMastery && window.save.towerMastery.income;
            const rank = mastery && mastery.perks ? (mastery.perks.fireRate || 0) : 0;
            masteryCostMult = Math.max(0.75, 1 - rank * 0.015);
        }
        return Math.floor(TOWERS[effType].cost * this.towerCostMult * masteryCostMult);
    }

    // ── Roguelike boons ──────────────────────────────────────────────────
    // Scale a single tower's offensive output (damage + derived fields).
    _scaleTowerDamage(t, f) {
        t.damage *= f;
        if (t.burnDamage   !== undefined) t.burnDamage   *= f;
        if (t.incomePerWave !== undefined) t.incomePerWave *= f;
        if (t.auraBonus    !== undefined) t.auraBonus    *= f;
    }
    _applyDamageBoon(f) {
        this.boonDamageMult *= f;
        for (const t of this.towers) this._scaleTowerDamage(t, f);
    }
    // Cheap active-count: a plain for-loop avoids the per-frame
    // Array.prototype.filter allocation that used to dominate the
    // late-wave update loop. Game.update calls this every tick, so
    // 0 garbage is the goal.
    _countActiveEnemies() {
        let n = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            if (this.enemies[i].active) n++;
        }
        return n;
    }
    _applyFireRateBoon(f) {
        this.boonFireRateMult *= f;
        for (const t of this.towers) {
            if (t.fireRate > 0) t.fireRate = Math.max(1, Math.round(t.fireRate * f));
        }
    }
    // Bring a freshly-built tower up to the run's accumulated boon state.
    _applyBoonsToNewTower(t) {
        if (this.boonDamageMult !== 1) this._scaleTowerDamage(t, this.boonDamageMult);
        if (this.boonFireRateMult !== 1 && t.fireRate > 0) {
            t.fireRate = Math.max(1, Math.round(t.fireRate * this.boonFireRateMult));
        }
    }
    // Pick 3 choices; randFn lets the autopilot path stay deterministic.
    getBoonChoices(randFn) {
        return rollBoonChoices(3, randFn);
    }
    chooseBoon(boonId) {
        const boon = BOONS.find(b => b.id === boonId);
        if (!boon) return false;
        boon.apply(this);
        this.boons.push(boon.id);
        this.uiDirty = true;
        if (window.SoundFX && SoundFX.build) SoundFX.build();
        return true;
    }
    // Multiplayer adapter — actions.applyInput dispatches boon picks
    // here. Mirrors chooseBoon with the boolean contract the dispatcher
    // expects (true = applied, false = rejected). Both peers in co-op
    // need to apply the same boon so their economy/damage multipliers
    // line up; calling chooseBoon directly preserves the existing
    // local-click path.
    pickBoon(boonId) { return this.chooseBoon(boonId); }

    buildTower(c, r, type, opts) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        const effType = this.getEffectiveTowerType(type);
        let cost = this.getTowerBuildCost(effType);
        // Co-op split-economy: a tower placed by a REMOTE peer appears
        // on our field (same map, same monsters) but we don't pay for
        // it — only the placer pays out of their own bank.
        const remote = opts && opts.source === 'remote';

        if (remote || this.money >= cost) {
            if (!remote) this.money -= cost;
            const built = new Tower(c, r, effType);
            if (remote) built._owner = 'remote';
            this._applyBoonsToNewTower(built);
            this.towers.push(built);
            this.uiDirty = true;
            if (!remote) SoundFX.build();
            return true;
        }
        SoundFX.error();
        return false;
    }

    selectPlacedTower(tower) {
        if (!tower) {
            this.selectedTowers = [];
            document.getElementById('upgrade-menu').classList.add('hidden');
        } else {
            this.selectedTowers = [tower];
            document.getElementById('upgrade-menu').classList.remove('hidden');
            this.updateUpgradeMenu();
        }
        
        let sellBtn = document.getElementById('sell-btn');
        if (sellBtn) {
            sellBtn.dataset.confirm = 'false';
            sellBtn.innerHTML = `SELL <span class="cost" id="sell-value"></span>`;
        }
    }

    selectAllTowersOfType(type) {
        this.selectedTowers = this.towers.filter(t => t.type === type);
        if (this.selectedTowers.length > 0) {
            document.getElementById('upgrade-menu').classList.remove('hidden');
            this.updateUpgradeMenu();
        }
        
        let sellBtn = document.getElementById('sell-btn');
        if (sellBtn) {
            sellBtn.dataset.confirm = 'false';
            sellBtn.innerHTML = `SELL <span class="cost" id="sell-value"></span>`;
        }
    }

    // Multiplayer adapter — applies one upgrade to one specific tower.
    // Used by actions.applyInput so a peer's UPGRADE input is replayable
    // without depending on the local selection state (Aegis sees the
    // same per-tower deduction it would for a local click). Returns
    // true if the upgrade was bought, false on rejection.
    upgradeTower(tower, slot, opts) {
        if (!tower || typeof slot !== 'number') return false;
        if (this.towers.indexOf(tower) < 0) return false;
        const cost = Math.floor(tower.getUpgradeCost(slot) * this.upgradeCostMult);
        const remote = opts && opts.source === 'remote';
        if (!remote && this.money < cost) return false;
        if (!remote) this.money -= cost;
        tower.upgrade(slot);
        this.addUpgradeEffect(tower.x, tower.y);
        this.uiDirty = true;
        if (!remote) SoundFX.upgrade();
        return true;
    }

    // Multiplayer adapter — sells a specific tower. Mirrors the inline
    // logic in main.js sell-btn handler; co-op sells go through here so
    // the same money/HP audit fires for remote inputs.
    sellTower(tower, opts) {
        if (!tower) return false;
        const idx = this.towers.indexOf(tower);
        if (idx < 0) return false;
        const sellValue = tower.getSellValue();
        this.towers.splice(idx, 1);
        // Split-economy: only the seller pockets the refund. A remote
        // peer demolishing their own tower removes it from our field
        // but doesn't credit our bank.
        const remote = opts && opts.source === 'remote';
        if (!remote) this.money += sellValue;
        if (this.selectedTowers && this.selectedTowers.indexOf(tower) >= 0) {
            this.selectedTowers = this.selectedTowers.filter(t => t !== tower);
        }
        this.uiDirty = true;
        return true;
    }

    buyUpgrade(index) {
        if (!this.selectedTowers || this.selectedTowers.length === 0) return;
        let upgradedAny = false;
        for (let t of this.selectedTowers) {
            let cost = Math.floor(t.getUpgradeCost(index) * this.upgradeCostMult);
            if (this.money >= cost) {
                this.money -= cost;
                t.upgrade(index);
                this.addUpgradeEffect(t.x, t.y);
                upgradedAny = true;
            }
        }
        if (upgradedAny) {
            this.uiDirty = true;
            SoundFX.upgrade();
        } else {
            SoundFX.error();
        }
    }

    updateUpgradeMenu() {
        if (!this.selectedTowers || this.selectedTowers.length === 0) return;
        let t = this.selectedTowers[0];
        
        document.getElementById('upgrade-type-name').textContent = TOWERS[t.type].displayName + (this.selectedTowers.length > 1 ? ` (${this.selectedTowers.length})` : '');
        const isIncomeType = t.type === 'income' || t.type === 'income_research';
        document.getElementById('tower-dmg').textContent = isIncomeType ? (t.incomePerWave + '¢') : Math.floor(t.damage);
        document.getElementById('tower-rng').textContent = isIncomeType ? 'passive' : Math.floor(t.range);
        document.getElementById('tower-spd').textContent = isIncomeType ? '/wave' : t.fireRate;
        
        // Targeting mode selector (not shown for income towers)
        let targetingEl = document.getElementById('targeting-mode');
        if (t.type === 'income' || t.type === 'income_research') {
            if (targetingEl) targetingEl.style.display = 'none';
        } else {
            if (!targetingEl) {
                let container = document.createElement('div');
                container.id = 'targeting-mode';
                container.style.cssText = 'display:flex; gap:4px; margin-bottom:8px; justify-content:center;';
                const modes = [['first','FIRST'],['closest','NEAR'],['mostHp','MAX HP'],['leastHp','MIN HP']];
                for (let [mode, label] of modes) {
                    let btn = document.createElement('button');
                    btn.dataset.mode = mode;
                    btn.textContent = label;
                    btn.style.cssText = 'flex:1; padding:3px 0; font-size:0.65rem; letter-spacing:1px;';
                    btn.addEventListener('click', () => {
                        for (let tower of this.selectedTowers) tower.targetMode = mode;
                        this.updateUpgradeMenu();
                    });
                    container.appendChild(btn);
                }
                let upgradesList = document.getElementById('upgrades-list');
                upgradesList.parentNode.insertBefore(container, upgradesList);
                targetingEl = container;
            }
            targetingEl.style.display = '';
            // Update active state
            for (let btn of targetingEl.children) {
                btn.classList.toggle('active', btn.dataset.mode === t.targetMode);
                btn.style.opacity = btn.dataset.mode === t.targetMode ? '1' : '0.45';
                btn.style.borderColor = btn.dataset.mode === t.targetMode ? 'var(--accent)' : '';
            }
        }
        
        let list = document.getElementById('upgrades-list');
        let defs = TOWER_UPGRADES[t.type];

        if (list.children.length === 0 || list.dataset.towerType !== t.type) {
            list.innerHTML = '';
            list.dataset.towerType = t.type;
            for (let i = 0; i < 3; i++) {
                let div = document.createElement('div');
                div.className = 'upgrade-item';
                div.innerHTML = `
                    <div class="upg-info">
                        <div><span class="upg-name"></span><span class="upg-level"></span></div>
                        <span class="upg-desc"></span>
                    </div>
                    <span class="upg-cost"></span>
                    <button class="upg-auto" type="button" title="Auto-buy this upgrade whenever it's affordable" aria-label="Auto-buy">▲</button>
                `;
                list.appendChild(div);
            }
        }

        for (let i = 0; i < 3; i++) {
            let def = defs[i];
            // Across all selected towers, show the CHEAPEST upgrade cost so the
            // panel never appears stuck-disabled just because the first-clicked
            // tower happens to be the highest-leveled one in the bulk set.
            let costs = this.selectedTowers.map(tw => Math.floor(tw.getUpgradeCost(i) * this.upgradeCostMult));
            let minCost = Math.min(...costs);
            let lvl = t.upgrades[i];
            let canAffordAny = this.selectedTowers.some((tw, j) => this.money >= costs[j]);

            let div = list.children[i];
            div.className = 'upgrade-item' + (canAffordAny ? '' : ' disabled');
            div.querySelector('.upg-name').textContent = def.name;
            div.querySelector('.upg-level').textContent = this.selectedTowers.length > 1 ? 'Bulk' : ('Lvl ' + lvl);
            div.querySelector('.upg-desc').textContent = def.desc;
            div.querySelector('.upg-cost').textContent = minCost + '¢' + (this.selectedTowers.length > 1 ? '+' : '');

            div.onclick = () => {
                this.buyUpgrade(i);
            };

            // Per-slot auto-upgrade toggle. Toggling on a bulk selection: if
            // any tower has the slot OFF, turn all ON; else turn all OFF.
            const autoBtn = div.querySelector('.upg-auto');
            const slotOn  = this.selectedTowers.every(tw => tw.autoUpgradeSlots && tw.autoUpgradeSlots[i]);
            const slotAny = this.selectedTowers.some(tw  => tw.autoUpgradeSlots && tw.autoUpgradeSlots[i]);
            autoBtn.classList.toggle('on', slotOn);
            autoBtn.classList.toggle('mixed', slotAny && !slotOn);
            autoBtn.title = slotOn
                ? 'Auto-buy this upgrade is ON — click to turn off'
                : (slotAny ? 'Mixed: some selected towers auto-buy this upgrade — click to turn all on' : 'Auto-buy this upgrade whenever affordable');
            autoBtn.onclick = (e) => {
                e.stopPropagation();
                if (!this.selectedTowers || this.selectedTowers.length === 0) return;
                const anyOff = this.selectedTowers.some(tw => !(tw.autoUpgradeSlots && tw.autoUpgradeSlots[i]));
                for (let tw of this.selectedTowers) {
                    if (!tw.autoUpgradeSlots) tw.autoUpgradeSlots = [false, false, false];
                    tw.autoUpgradeSlots[i] = anyOff;
                }
                this.updateUpgradeMenu();
            };
        }

        let totalSell = this.selectedTowers.reduce((sum, current) => sum + current.getSellValue(), 0);
        let sellVal = document.getElementById('sell-value');
        if (sellVal) sellVal.textContent = totalSell + '¢';

        // Carry-over from a previous design: an old per-tower AUTO ⏶ button
        // may still be in the DOM if the panel was rebuilt mid-session.
        const legacyAuto = document.getElementById('auto-upgrade-btn');
        if (legacyAuto) legacyAuto.remove();
    }

    // Per-slot auto-upgrade: for each tower, walk the slots whose flag is on
    // and buy each one that's affordable this tick. Cheapest-first ordering
    // maximises how many slots fit when the budget is tight. Independent of
    // the global Autopilot — slots can self-upgrade with Autopilot off.
    _runAutoUpgrade() {
        if (!this.towers || this.towers.length === 0) return;
        let bought = false;
        for (let t of this.towers) {
            if (!t.autoUpgradeSlots) continue;
            const slots = [0, 1, 2]
                .filter(i => t.autoUpgradeSlots[i])
                .sort((a, b) => t.getUpgradeCost(a) - t.getUpgradeCost(b));
            for (const i of slots) {
                const cost = Math.floor(t.getUpgradeCost(i) * this.upgradeCostMult);
                if (this.money >= cost) {
                    this.money -= cost;
                    t.upgrade(i);
                    this.addUpgradeEffect(t.x, t.y);
                    bought = true;
                }
            }
        }
        if (bought) {
            this.uiDirty = true;
            SoundFX.upgrade();
        }
    }

    updateUI() {
        document.getElementById('wave-display').textContent = this.wave;
        document.getElementById('health-display').textContent = this.health;
        document.getElementById('money-display').textContent = Math.floor(this.money);
        
        const airInterval = this.ascension.airWaveInterval;
        let nextAir = airInterval - (this.wave % airInterval);
        let airEl = document.getElementById('air-countdown');
        if (nextAir === airInterval && this.wave > 0) {
            airEl.textContent = '✈ ACTIVE';
            airEl.style.color = '#ef4444';
            airEl.style.textShadow = '0 0 5px rgba(239,68,68,0.5)';
        } else {
            airEl.textContent = `✈ IN ${nextAir}`;
            airEl.style.color = '#60a5fa';
            airEl.style.textShadow = 'none';
        }
        
        document.querySelectorAll('.tower-option[data-type]').forEach(el => {
            let type = el.dataset.type;
            if (this.canAfford(type)) {
                el.classList.remove('disabled');
            } else {
                el.classList.add('disabled');
            }
        });

        // Combined SYS button: shows RST early, swaps to RETIRE once the
        // player has earned the right to a retire bonus (wave 30 = clear).
        const restartBtn = document.getElementById('restart-btn');
        const restartDisplay = document.getElementById('restart-display');
        if (restartBtn && restartDisplay) {
            const eligible = this.wave >= 30;
            restartBtn.dataset.action = eligible ? 'retire' : 'restart';
            restartDisplay.textContent = eligible ? 'RETIRE' : 'RST';
            restartDisplay.style.color = eligible ? '#4ade80' : '';
            restartBtn.querySelector('.label').textContent = eligible ? 'RUN' : 'SYS';
        }

        // Potion button
        let potionBtn = document.getElementById('potion-btn');
        let potionCost = this.getPotionCost();
        document.getElementById('potion-cost').textContent = potionCost + '¢';
        let potionDisabled = this.money < potionCost || this.health >= this.maxHealth;
        potionBtn.classList.toggle('disabled', potionDisabled);

        this.updateUpgradeMenu();
    }

    // M2: Returns an array of { wave, type, count } for the next `n` waves.
    // Used by Scan ability and Strategist kit. Pulls from hand-tuned
    // waveData for waves <= 10, computes procedurally for 11+.
    getWavePreview(n) {
        const results = [];
        for (let i = 0; i < n; i++) {
            const w = this.wave + i;
            if (w <= 0) continue;
            if (w % this.ascension.airWaveInterval === 0) {
                results.push({ wave: w, type: 'air', count: '(air wave)' });
                continue;
            }
            const idx = (w - 1) % this.waveData.length;
            const def = this.waveData[idx];
            results.push({ wave: w, type: def.type, count: def.count + '+' });
        }
        return results;
    }

    // M2: Airstrike ability. Deals 200 damage in 80px radius centered at (x, y).
    // Adds a visual ring effect. Caller (main.js) must consume a charge.
    // Damage applied directly via hp -= dmg, matching existing Tower/Projectile pattern.
    airstrike(x, y) {
        const damage = 200;
        const radius = 80;
        const r2 = radius * radius;
        for (const enemy of this.enemies) {
            if (!enemy.active) continue;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            if (dx*dx + dy*dy <= r2) {
                enemy.takeDamage(damage);
                if (enemy.hp <= 0) enemy.active = false;
            }
        }
        // Visual: reuse upgradeEffects structure (expanding ring)
        this.upgradeEffects.push({ x: x, y: y, radius: radius * 0.2, alpha: 1, airstrike: true });
        this.upgradeEffects.push({ x: x, y: y, radius: radius * 0.5, alpha: 0.8, airstrike: true });
        SoundFX.build();
    }

    // M2: Freeze ability. Stops all enemy movement for `frames` (at 60 fps).
    freezeAllEnemies(frames) {
        this.freezeTimer = frames;
        for (const e of this.enemies) {
            if (!e.active) continue;
            e.frozen = true;
            e.frozenFrames = frames;
        }
    }

    gameOver() {
        this.state = 'gameover';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('final-wave').textContent = this.wave;
        document.getElementById('score-entry').style.display = 'flex';
        document.getElementById('player-name').value = '';
        if (window.onRunEnded) window.onRunEnded({ wave: this.wave, tier: this.ascensionTier, retired: false });
        if (window.loadScores) window.loadScores();
    }

    victory() {
        this.state = 'victory';
        document.getElementById('victory').classList.remove('hidden');
        document.getElementById('victory-wave').textContent = this.wave;
        if (window.onRunEnded) window.onRunEnded({ wave: this.wave, tier: this.ascensionTier, retired: true, hpEverLost: this.hpEverLost });
    }
}
