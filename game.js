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
        
        this.money = 100;
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
        // Every 1500¢ spent = +1.0x difficulty (was 2000, now scales faster)
        let investmentFactor = 1 + (totalTowerValue / 1500);

        // Wave-based scaling with MUCH gentler curves
        let baseExpFactor;
        if (this.wave <= 5) {
            // Waves 1-5: Very gentle for new players
            baseExpFactor = 0.8 + this.wave * 0.15; // 0.95, 1.1, 1.25, 1.4, 1.55
        } else if (this.wave <= 10) {
            // Waves 6-10: Gentle transition period
            baseExpFactor = 1.55 * Math.pow(1.06, this.wave - 5); // ~1.55 to ~2.07
        } else if (this.wave <= 20) {
            // Waves 11-20: Moderate exponential growth
            baseExpFactor = 2.07 * Math.pow(1.08, this.wave - 10); // ~2.07 to ~4.47
        } else {
            // Waves 21+: Capped logarithmic growth for infinite scaling
            // HP grows slowly, count grows instead
            let cap = 5.0; // Maximum base multiplier
            let lateWaves = this.wave - 20;
            baseExpFactor = Math.min(cap, 4.47 + Math.log(1 + lateWaves) * 0.3);
        }

        // Final HP = base wave difficulty × player investment
        // This keeps difficulty proportional to player power
        let finalHpMult = baseExpFactor * investmentFactor;

        if (this.wave > 0 && this.wave % 5 === 0) {
            // Air waves: more enemies, slightly tankier
            let airCount = 15 + this.wave * 0.6; // Slower count growth
            if (this.wave > 20) airCount += Math.log(this.wave - 19) * 8; // Log scaling after wave 20
            
            this.currentWaveDef = {
                count: Math.floor(airCount),
                type: 'air',
                spawnRate: Math.max(18, 35 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 1.2 // Air slightly tankier
            };
            this.enemiesSpawned = 0;
            this.spawnTimer = 60;
            return;
        }

        let idx = (this.wave - 1) % this.waveData.length;
        let def = this.waveData[idx];

        let loops = Math.floor((this.wave - 1) / this.waveData.length);
        
        // Count scaling: after wave 20, grow count more aggressively instead of HP
        let countMult = 1 + loops * 0.2;
        if (this.wave > 20) {
            countMult += Math.log(this.wave - 19) * 0.4; // Extra count scaling
        }

        this.currentWaveDef = {
            count: Math.floor(def.count * countMult),
            type: def.type,
            spawnRate: Math.max(12, def.spawnRate - loops * 2),
            hpMult: def.hpMult * finalHpMult // No extra loop multiplier - HP is capped
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
        let counts = { basic: 0, sniper: 0, rapid: 0, laser: 0, rocket: 0, flak: 0, electric: 0, silo: 0, income: 0 };
        for (let t of this.towers) counts[t.type]++;

        let spots = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (this.map.isBuildable(c, r) && !this.towers.find(t => t.c === c && t.r === r)) {
                    let pathNeighbors = 0;
                    let orthoNeighbors = 0;
                    const ns = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]];
                    for (let i = 0; i < 8; i++) {
                        let nc = c + ns[i][0];
                        let nr = r + ns[i][1];
                        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
                            let cell = this.map.grid[nr][nc];
                            if (cell === 1 || cell === 2 || cell === 3) {
                                pathNeighbors++;
                                if (i < 4) orthoNeighbors++;
                            }
                        }
                    }
                    if (pathNeighbors > 0) spots.push({ c, r, pathNeighbors, orthoNeighbors });
                }
            }
        }

        const costs  = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400, income: 200 };
        const ranges = { basic: 100, sniper: 250, rapid: 80, laser: 150, rocket: 200, flak: 250, electric: 120, silo: 100, income: 0 };

        let isAirWave = this.currentWaveDef && this.currentWaveDef.type === 'air';
        let isAirImminent = isAirWave || (this.wave % 5 >= 3) || (this.wave % 5 === 0);

        // Target composition: how many of each type we want by this wave.
        // Designed to diversify steadily — each tier unlocks naturally as waves progress.
        let w = this.wave;
        let wanted = {
            basic:    Math.max(2, Math.ceil(w / 3.5)),           // Start with 2, grow slower
            rapid:    w >= 2  ? Math.ceil(w / 6)  : 0,           // 1@2, 2@6, 3@12... (slower)
            laser:    w >= 3  ? Math.ceil(w / 4)  : 0,           // 1@3, 2@7, 3@11... (lasers are key)
            flak:     w >= 4  ? (w >= 10 ? Math.min(3, 2 + Math.floor((w-10)/15)) : 1) : 0, // 1@4, 2@10, 3@25
            sniper:   w >= 5  ? Math.ceil(w / 8)  : 0,           // 1@5, 2@13... (slower, high value)
            rocket:   w >= 6  ? Math.ceil(w / 9)  : 0,           // 1@6, 2@15... (slower)
            electric: w >= 8  ? Math.ceil(w / 12) : 0,           // 1@8, 2@20... (slower)
            silo:     w >= 12 ? Math.ceil(w / 16) : 0,           // 1@12, 2@28... (very slow, expensive)
            income:   w >= 10 ? Math.floor(w / 10) : 0,          // 1@10, 2@20... (later, slower)
        };

        // Find the highest-priority type we're short on.
        // Priority order: flak (if air soon) > laser > sniper > rocket > basic > rapid > electric > silo > income
        const buildOrder = ['flak', 'laser', 'sniper', 'rocket', 'basic', 'rapid', 'electric', 'silo', 'income'];

        let targetType = null;
        for (let type of buildOrder) {
            if (counts[type] < wanted[type]) {
                // Prioritize flak heavily when air is coming (wave 4+)
                if (type === 'flak' && !isAirImminent && counts['flak'] >= 1) continue;
                targetType = type;
                break;
            }
        }
        // Nothing specifically needed — pick the type we're most behind on
        if (!targetType) {
            let best = null, bestDeficit = -1;
            for (let type of buildOrder) {
                let deficit = wanted[type] - counts[type];
                if (deficit > bestDeficit) { bestDeficit = deficit; best = type; }
            }
            targetType = best || 'basic';
        }

        let totalTowers = this.towers.length;
        // Force build when short on critical towers or have very few towers
        let mustBuild = (counts['flak'] < wanted['flak'] && isAirImminent) || 
                        (counts['laser'] < wanted['laser']) ||
                        totalTowers < 4;
        
        // After wave 15, prefer upgrading over building
        let buildThreshold = w < 15 ? 12 : (w < 25 ? 15 : 18);
        let preferBuild = mustBuild || totalTowers < buildThreshold || Math.random() < (w < 15 ? 0.6 : 0.35);

        if (preferBuild && spots.length > 0) {
            if (this.money >= costs[targetType]) {
                let bestSpot = null, bestScore = -999;
                let laserTowers = this.towers.filter(t => t.type === 'laser');

                for (let spot of spots) {
                    let score = Math.random() * 2;
                    let pathCoverage = 0;
                    const range = ranges[targetType];
                    for (let pr = 0; pr < ROWS; pr++) {
                        for (let pc = 0; pc < COLS; pc++) {
                            let cell = this.map.grid[pr][pc];
                            if (cell === 1 || cell === 2 || cell === 3) {
                                if (Math.hypot(pc - spot.c, pr - spot.r) * TILE_SIZE <= range) pathCoverage++;
                            }
                        }
                    }
                    score += pathCoverage * 0.5;

                    if (targetType === 'flak') {
                        // Flak should be placed along the air path (between start and end)
                        // Calculate distance along the path from start to end
                        let startP = this.map.path[0];
                        let endP = this.map.path[this.map.path.length - 1];
                        let midC = (startP.c + endP.c) / 2;
                        let midR = (startP.r + endP.r) / 2;
                        
                        // Prefer spots near the middle of the air path (straight line from start to end)
                        let distToMid = Math.hypot(spot.c - midC, spot.r - midR);
                        score += Math.max(0, (15 - distToMid)) * 8; // Closer to middle = much better
                        
                        // Also prefer spots that have good coverage of the path
                        score += pathCoverage * 4;
                        
                        // Prefer spots not too close to edges
                        let edgeDist = Math.min(spot.c, COLS - spot.c, spot.r, ROWS - spot.r);
                        score += edgeDist * 3;
                        
                        // Add large base score to ensure flak gets built
                        score += 100;
                    } else if (targetType === 'rapid' || targetType === 'basic') {
                        score += spot.orthoNeighbors * 5 + spot.pathNeighbors * 2;
                    } else if (targetType === 'sniper') {
                        score -= spot.orthoNeighbors * 3;
                    } else if (targetType === 'rocket' || targetType === 'silo') {
                        score -= (Math.abs(spot.c - COLS/2) + Math.abs(spot.r - ROWS/2)) * 0.4;
                        score -= spot.orthoNeighbors * 2;
                    } else if (targetType === 'laser' || targetType === 'electric') {
                        score += spot.orthoNeighbors * 2;
                    }

                    // Synergy: near a laser = slowed enemies = more DPS
                    if (targetType !== 'flak' && laserTowers.length > 0) {
                        for (let laser of laserTowers) {
                            if (Math.hypot(laser.c - spot.c, laser.r - spot.r) <= 4) { score += 80; break; }
                        }
                    }

                    if (score > bestScore) { bestScore = score; bestSpot = spot; }
                }

                if (bestSpot) { this.buildTower(bestSpot.c, bestSpot.r, targetType); return; }

            } else {
                // Can't afford target — save up unless we're desperate for early towers
                if (totalTowers < 2) {
                    let affordable = buildOrder.filter(t => this.money >= costs[t]);
                    if (affordable.length > 0) {
                        let spot = spots.reduce((b, s) => s.orthoNeighbors > b.orthoNeighbors ? s : b, spots[0]);
                        this.buildTower(spot.c, spot.r, affordable[0]);
                    }
                }
                return;
            }
        }

        // Upgrade logic — spread evenly, prioritise high-value towers
        const upgradeValue = { silo: 10, rocket: 9, sniper: 8, electric: 7, laser: 6, flak: 5, rapid: 4, basic: 3, income: 2 };
        let upgradableTowers = [];
        for (let t of this.towers) {
            for (let i = 0; i < 3; i++) {
                let cost = t.getUpgradeCost(i);
                if (this.money >= cost) upgradableTowers.push({ t, i, cost });
            }
        }

        if (upgradableTowers.length > 0) {
            upgradableTowers.sort((a, b) => {
                // Prioritize flak upgrades when air is imminent
                if (isAirImminent) {
                    if (a.t.type === 'flak' && b.t.type !== 'flak') return -1;
                    if (b.t.type === 'flak' && a.t.type !== 'flak') return 1;
                }
                
                // Prioritize laser upgrades (slow effect is crucial)
                if (a.t.type === 'laser' && b.t.type !== 'laser') return -1;
                if (b.t.type === 'laser' && a.t.type !== 'laser') return 1;
                
                // Spread upgrades evenly across paths
                let lvlDiff = a.t.upgrades[a.i] - b.t.upgrades[b.i];
                if (lvlDiff !== 0) return lvlDiff;
                
                // Then by tower value
                return (upgradeValue[b.t.type] || 0) - (upgradeValue[a.t.type] || 0);
            });
            let pick = upgradableTowers[0];
            this.money -= pick.cost;
            pick.t.upgrade(pick.i);
            this.addUpgradeEffect(pick.t.x, pick.t.y);
            this.uiDirty = true;
        }

        // Buy a potion if health is critical
        let potionCost = this.getPotionCost();
        if (this.health <= 3 && this.money >= potionCost && this.health < this.maxHealth) {
            this.buyPotion();
        }
    }

    update() {
        if (this.state !== 'playing') return;

        if (this.autopilot) {
            this.autopilotTimer++;
            if (this.autopilotTimer >= 30) {
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
                    this.waveCooldown = ((this.wave + 1) % 5 === 0) ? 300 : 180; 
                    this.money += 20 + this.wave * 5;
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
                this.money += e.reward;
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
        return 150 + this.potionCount * 75;
    }

    buyPotion() {
        let cost = this.getPotionCost();
        if (this.money < cost) { SoundFX.error(); return false; }
        if (this.health >= this.maxHealth) { SoundFX.error(); return false; }
        this.money -= cost;
        this.health = Math.min(this.maxHealth, this.health + 5);
        this.potionCount++;
        this.uiDirty = true;
        SoundFX.upgrade();
        return true;
    }

    canAfford(type) {
        const costs = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400, income: 200 };
        return this.money >= costs[type];
    }

    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;
        
        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        const costs = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400, income: 200 };
        let cost = costs[type];

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
        
        const names = { basic: 'Blaster', sniper: 'Sniper', rapid: 'Shotgun', flak: 'Flak (AA)', laser: 'Laser', rocket: 'Rocket', electric: 'Tesla', silo: 'Silo', income: 'Relay' };
        document.getElementById('upgrade-type-name').textContent = names[t.type] + (this.selectedTowers.length > 1 ? ` (${this.selectedTowers.length})` : '');
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
