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
        // Every 2000¢ spent = +1.0x difficulty (gentler scaling for early game)
        let investmentFactor = 1 + (totalTowerValue / 2000);

        // Wave-based scaling with MUCH gentler curves
        let baseExpFactor;
        if (this.wave <= 5) {
            // Waves 1-5: Very gentle for new players
            baseExpFactor = 0.7 + this.wave * 0.12; // 0.82, 0.94, 1.06, 1.18, 1.30
        } else if (this.wave <= 10) {
            // Waves 6-10: Gentle transition period
            baseExpFactor = 1.30 * Math.pow(1.05, this.wave - 5); // ~1.30 to ~1.66
        } else if (this.wave <= 20) {
            // Waves 11-20: Moderate exponential growth
            baseExpFactor = 1.66 * Math.pow(1.06, this.wave - 10); // ~1.66 to ~2.97
        } else if (this.wave <= 40) {
            // Waves 21-40: Very smooth transition to late game
            baseExpFactor = 2.97 * Math.pow(1.025, this.wave - 20); // ~2.97 to ~4.82
        } else {
            // Waves 41+: Endless mode - slow logarithmic growth
            // Keeps game challenging but not impossible
            let lateWaves = this.wave - 40;
            baseExpFactor = 4.82 + Math.log(1 + lateWaves) * 0.15; // Slow, steady growth
        }

        // Final HP = base wave difficulty × player investment
        // This keeps difficulty proportional to player power
        let finalHpMult = baseExpFactor * investmentFactor;

        if (this.wave > 0 && this.wave % 5 === 0) {
            // Air waves: more enemies, slightly tankier
            let airCount = 12 + this.wave * 0.45;
            if (this.wave > 20 && this.wave <= 40) {
                airCount += Math.log(this.wave - 19) * 2.5; // Very gentle air scaling 21-40
            } else if (this.wave > 40) {
                // Endless mode: air count grows moderately
                airCount += Math.log(21) * 2.5 + Math.log(this.wave - 39) * 3.5;
            }
            
            this.currentWaveDef = {
                count: Math.floor(airCount),
                type: 'air',
                spawnRate: Math.max(18, 35 - Math.floor(this.wave / 8)),
                hpMult: finalHpMult * 1.08
            };
            this.enemiesSpawned = 0;
            this.spawnTimer = 60;
            return;
        }

        let idx = (this.wave - 1) % this.waveData.length;
        let def = this.waveData[idx];

        let loops = Math.floor((this.wave - 1) / this.waveData.length);
        
        // Count scaling: very gentle growth for endless mode
        let countMult = 1 + loops * 0.15;
        if (this.wave > 20 && this.wave <= 40) {
            countMult += Math.log(this.wave - 19) * 0.12; // Very gentle count scaling waves 21-40
        } else if (this.wave > 40) {
            // Endless mode: count grows slowly to keep game interesting
            countMult += Math.log(21) * 0.12 + Math.log(this.wave - 39) * 0.18;
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
                    this.money += WAVE_CONFIG.endOfWavePayoutBase + this.wave * WAVE_CONFIG.endOfWavePayoutPerWave;
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
