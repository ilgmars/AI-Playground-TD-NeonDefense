class Game {
    constructor(canvas, seed) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        this.map = new GameMap(seed);
        this.seed = this.map.seed;
        this.enemies = [];
        this.towers = [];
        this.projectiles = [];
        this.particles = []; 
        this.upgradeEffects = []; 
        
        this.money = 125;  // Better starting money for early game
        this.health = 20;
        this.maxHealth = 20;
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

    start() {
        this.state = 'playing';
        this.startWave();
        this.updateUI();
    }

    startWave() {
        // Calculate total tower power for dynamic difficulty
        let totalTowerValue = 0;
        for (let t of this.towers) {
            totalTowerValue += t.totalSpent;
        }
        
        // Investment-based scaling: enemies scale with player power
        // This creates dynamic difficulty that responds to player strategy
        // Uses soft caps to prevent death spiral while maintaining challenge
        let investmentFactor;
        if (this.wave <= 20) {
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

        if (this.wave > 0 && this.wave % 5 === 0) {
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
                count: Math.floor(airCount),
                type: 'air',
                spawnRate: Math.max(20, 50 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 0.98 // Slightly weaker than ground
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
            count: Math.floor(def.count * countMult),
            type: def.type,
            spawnRate: Math.max(12, def.spawnRate - loops * 2),
            hpMult: def.hpMult * finalHpMult // HP scales with wave + investment
        };

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

        if (this.autopilot) {
            this.autopilotTimer++;
            if (this.autopilotTimer >= AUTOPILOT_CONFIG.tickInterval) {
                this.autopilotTimer = 0;
                this.runAutopilot();
            }
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

        if (this.currentWaveDef) {
            if (this.enemiesSpawned < this.currentWaveDef.count) {
                if (this.spawnTimer > 0) {
                    this.spawnTimer--;
                } else {
                    this.enemies.push(new Enemy(this.map.path, this.currentWaveDef.type, this.currentWaveDef.hpMult));
                    this.enemiesSpawned++;
                    this.spawnTimer = this.currentWaveDef.spawnRate;
                }
            } else {
                let aliveEnemies = this.enemies.filter(e => e.active);
                if (aliveEnemies.length === 0) {
                    this.currentWaveDef = null;
                    this.waveCooldown = ((this.wave + 1) % 5 === 0) ? WAVE_CONFIG.airWaveCooldown : WAVE_CONFIG.normalCooldown;
                    
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
                    
                    this.money += waveBonus;
                    
                    // Income tower payout
                    let incomeTowers = this.towers.filter(t => t.type === 'income');
                    let relayCount = incomeTowers.length;
                    for (let t of incomeTowers) {
                        let bonus = t.incomePerWave + (t.networkBonus || 0) * 5 * (relayCount - 1);
                        this.money += bonus;
                    }
                    
                    if ((this.wave + 1) % 5 === 0) {
                        SoundFX.siren();
                    }
                }
            }
        } else {
            if (this.waveCooldown > 0) {
                this.waveCooldown--;
                if ((this.wave + 1) % 5 === 0) {
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
                this.enemies.splice(i, 1);
                this.uiDirty = true;
                if (this.health <= 0) {
                    this.gameOver();
                }
            } else if (!e.active) {
                // Base reward with late-game scaling
                let reward = e.reward;
                if (this.wave > 35) {
                    // Boost rewards in late game to help economy
                    reward = Math.floor(reward * (1 + (this.wave - 35) * 0.025));
                }
                this.money += reward;
                this.enemies.splice(i, 1);
                this.uiDirty = true;
            }
        }

        for (let t of this.towers) {
            t.update(this.enemies, this.projectiles, this.particles);
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            let p = this.projectiles[i];
            p.update(this.enemies, this.particles, this.projectiles);
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
                
                if (t.type === 'silo') {
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
        return POTION_CONFIG.baseCost + this.potionCount * POTION_CONFIG.costPerUse;
    }

    buyPotion() {
        let cost = this.getPotionCost();
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        this.health = Math.min(this.maxHealth, this.health + POTION_CONFIG.healAmount);
        this.potionCount++;
        this.uiDirty = true;
        SoundFX.upgrade();
        return true;
    }

    canAfford(type) {
        return this.money >= TOWERS[type].cost;
    }

    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;

        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        let cost = TOWERS[type].cost;

        if (this.money >= cost) {
            this.money -= cost;
            this.towers.push(new Tower(c, r, type));
            this.uiDirty = true;
            SoundFX.build();
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

    buyUpgrade(index) {
        if (!this.selectedTowers || this.selectedTowers.length === 0) return;
        let upgradedAny = false;
        for (let t of this.selectedTowers) {
            let cost = t.getUpgradeCost(index);
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
        document.getElementById('tower-dmg').textContent = t.type === 'income' ? (t.incomePerWave + '¢') : Math.floor(t.damage);
        document.getElementById('tower-rng').textContent = t.type === 'income' ? 'passive' : Math.floor(t.range);
        document.getElementById('tower-spd').textContent = t.type === 'income' ? '/wave' : t.fireRate;
        
        // Targeting mode selector (not shown for income towers)
        let targetingEl = document.getElementById('targeting-mode');
        if (t.type === 'income') {
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
                `;
                list.appendChild(div);
            }
        }
        
        for (let i = 0; i < 3; i++) {
            let def = defs[i];
            let cost = t.getUpgradeCost(i);
            let lvl = t.upgrades[i];
            
            let div = list.children[i];
            div.className = 'upgrade-item' + (this.money >= cost ? '' : ' disabled');
            div.querySelector('.upg-name').textContent = def.name;
            div.querySelector('.upg-level').textContent = this.selectedTowers.length > 1 ? 'Bulk' : ('Lvl ' + lvl);
            div.querySelector('.upg-desc').textContent = def.desc;
            div.querySelector('.upg-cost').textContent = cost + '¢' + (this.selectedTowers.length > 1 ? '+' : '');
            
            div.onclick = () => {
                this.buyUpgrade(i);
            };
        }
        
        let totalSell = this.selectedTowers.reduce((sum, current) => sum + current.getSellValue(), 0);
        let sellVal = document.getElementById('sell-value');
        if (sellVal) sellVal.textContent = totalSell + '¢';
    }

    updateUI() {
        document.getElementById('wave-display').textContent = this.wave;
        document.getElementById('health-display').textContent = this.health;
        document.getElementById('money-display').textContent = this.money;
        
        let nextAir = 5 - (this.wave % 5);
        let airEl = document.getElementById('air-countdown');
        if (nextAir === 5 && this.wave > 0) {
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

        // Potion button
        let potionBtn = document.getElementById('potion-btn');
        let potionCost = this.getPotionCost();
        document.getElementById('potion-cost').textContent = potionCost + '¢';
        let potionDisabled = this.money < potionCost || this.health >= this.maxHealth;
        potionBtn.classList.toggle('disabled', potionDisabled);

        this.updateUpgradeMenu();
    }

    gameOver() {
        this.state = 'gameover';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('final-wave').textContent = this.wave;
        document.getElementById('score-entry').style.display = 'flex';
        document.getElementById('player-name').value = '';
        if (window.loadScores) window.loadScores();
    }
}
