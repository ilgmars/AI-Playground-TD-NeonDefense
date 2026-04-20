class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        this.map = new GameMap();
        this.enemies = [];
        this.towers = [];
        this.projectiles = [];
        this.particles = []; 
        this.upgradeEffects = []; 
        
        this.money = 100;
        this.health = 20;
        this.wave = 1;
        this.selectedTower = null;
        this.autopilot = false;
        this.autopilotTimer = 0;
        this.state = 'start'; 
        this.uiDirty = false;
        
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
        if (this.wave > 0 && this.wave % 5 === 0) {
            this.currentWaveDef = {
                count: 15 + this.wave,
                type: 'air',
                spawnRate: 40,
                hpMult: 1.0 + (this.wave / 10)
            };
            this.enemiesSpawned = 0;
            this.spawnTimer = 60;
            return;
        }

        let idx = (this.wave - 1) % this.waveData.length;
        let def = this.waveData[idx];
        
        let loops = Math.floor((this.wave - 1) / this.waveData.length);
        let extraMult = 1 + loops * 2;
        
        this.currentWaveDef = {
            count: def.count,
            type: def.type,
            spawnRate: Math.max(10, def.spawnRate - loops * 5),
            hpMult: def.hpMult * extraMult
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
        let counts = { basic: 0, sniper: 0, rapid: 0, laser: 0, rocket: 0, flak: 0, electric: 0, silo: 0 };
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
                    if (pathNeighbors > 0) {
                        spots.push({ c, r, pathNeighbors, orthoNeighbors });
                    }
                }
            }
        }

        const options = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo'];
        const costs = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400 };
        
        // Anticipate air wave during the entire wave prior (e.g. wave 4, 9, 14) as well as during the cooldown and the air wave itself
        let isAirImminent = (this.wave % 5 === 4) || (this.waveCooldown > 0 && (this.wave + 1) % 5 === 0) || (this.currentWaveDef && this.currentWaveDef.type === 'air');
        
        let targetType;
        if (isAirImminent && counts['flak'] < Math.floor(this.wave / 3) + 1) {
            targetType = 'flak';
        } else {
            let minCount = Math.min(...options.map(t => counts[t]));
            let neededTypes = options.filter(t => counts[t] === minCount);
            neededTypes.sort((a, b) => costs[a] - costs[b]); 
            targetType = neededTypes[0];
        }
        
        let preferBuild = this.towers.length < 5 || Math.random() < 0.6;

        if (preferBuild && spots.length > 0) {
            if (this.money >= costs[targetType]) {
                let bestSpot = null;
                let bestScore = -999;
                
                for (let spot of spots) {
                    let score = Math.random() * 2; 
                    
                    if (targetType === 'rapid' || targetType === 'basic') {
                        score += spot.orthoNeighbors * 5 + spot.pathNeighbors * 2;
                    } else if (targetType === 'sniper') {
                        let distToCenter = Math.abs(spot.c - COLS/2) + Math.abs(spot.r - ROWS/2);
                        score -= spot.orthoNeighbors * 5; 
                        score -= distToCenter * 0.5; 
                    } else if (targetType === 'rocket') {
                        let distToCenter = Math.abs(spot.c - COLS/2) + Math.abs(spot.r - ROWS/2);
                        score -= distToCenter * 1;
                        score -= spot.orthoNeighbors * 2; 
                    } else if (targetType === 'flak') {
                        let distToCenter = Math.abs(spot.c - COLS/2) + Math.abs(spot.r - ROWS/2);
                        score -= distToCenter * 0.5; // Central is better
                        score += 3;
                    } else if (targetType === 'laser' || targetType === 'electric') {
                        score += spot.orthoNeighbors * 2;
                    }
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestSpot = spot;
                    }
                }
                
                if (bestSpot) {
                    this.buildTower(bestSpot.c, bestSpot.r, targetType);
                    return;
                }
            } else {
                if (this.towers.length < 3) {
                    let affordable = options.filter(t => this.money >= costs[t]).sort((a,b) => costs[b] - costs[a]);
                    if (affordable.length > 0 && spots.length > 0) {
                        this.buildTower(spots[0].c, spots[0].r, affordable[0]);
                    }
                }
                return;
            }
        }

        // Upgrade logic based on 3 paths
        let upgradableTowers = [];
        for (let t of this.towers) {
            for (let i = 0; i < 3; i++) {
                let cost = t.getUpgradeCost(i);
                if (this.money >= cost) {
                    upgradableTowers.push({ t, i, cost });
                }
            }
        }
        
        if (upgradableTowers.length > 0) {
            upgradableTowers.sort((a, b) => {
                if (isAirImminent && a.t.type === 'flak' && b.t.type !== 'flak') return -1;
                if (isAirImminent && b.t.type === 'flak' && a.t.type !== 'flak') return 1;
                let lvlA = a.t.upgrades[a.i];
                let lvlB = b.t.upgrades[b.i];
                if (lvlA !== lvlB) return lvlA - lvlB;
                return b.t.baseCost - a.t.baseCost; 
            });
            let target = upgradableTowers[0];
            this.money -= target.cost;
            target.t.upgrade(target.i);
            this.addUpgradeEffect(target.t.x, target.t.y);
            this.uiDirty = true;
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
            p.update(this.enemies, this.particles);
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

        if (this.selectedTower) {
            this.ctx.beginPath();
            this.ctx.arc(this.selectedTower.x + TILE_SIZE/2, this.selectedTower.y + TILE_SIZE/2, this.selectedTower.range, 0, Math.PI*2);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            this.ctx.fill();
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            if (this.selectedTower.type === 'silo') {
                for (let r of this.selectedTower.hoverRockets) {
                    let rx = this.selectedTower.x + TILE_SIZE/2 + Math.cos(r.angle) * r.dist;
                    let ry = this.selectedTower.y + TILE_SIZE/2 + Math.sin(r.angle) * r.dist;
                    this.ctx.beginPath();
                    this.ctx.arc(rx, ry, r.range, 0, Math.PI*2);
                    this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; 
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
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

    canAfford(type) {
        const costs = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400 };
        return this.money >= costs[type];
    }

    buildTower(c, r, type) {
        if (!this.map.isBuildable(c, r)) return false;
        
        for (let t of this.towers) {
            if (t.c === c && t.r === r) return false;
        }

        const costs = { basic: 50, sniper: 100, rapid: 150, flak: 150, laser: 200, rocket: 250, electric: 300, silo: 400 };
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
        this.selectedTower = tower;
        if (tower) {
            document.getElementById('upgrade-menu').classList.remove('hidden');
            this.updateUpgradeMenu();
        } else {
            document.getElementById('upgrade-menu').classList.add('hidden');
        }
    }

    updateUpgradeMenu() {
        if (!this.selectedTower) return;
        let t = this.selectedTower;
        
        const names = { basic: 'Blaster', sniper: 'Sniper', rapid: 'Pulse', flak: 'Flak (AA)', laser: 'Laser', rocket: 'Rocket', electric: 'Tesla', silo: 'Silo' };
        document.getElementById('upgrade-type-name').textContent = names[t.type];
        document.getElementById('tower-dmg').textContent = Math.floor(t.damage);
        document.getElementById('tower-rng').textContent = Math.floor(t.range);
        document.getElementById('tower-spd').textContent = t.fireRate;
        
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
            div.querySelector('.upg-level').textContent = 'Lvl ' + lvl;
            div.querySelector('.upg-desc').textContent = def.desc;
            div.querySelector('.upg-cost').textContent = cost + '¢';
            
            div.onclick = () => {
                let currentCost = this.selectedTower.getUpgradeCost(i);
                if (this.money >= currentCost) {
                    this.money -= currentCost;
                    this.selectedTower.upgrade(i);
                    this.addUpgradeEffect(this.selectedTower.x, this.selectedTower.y);
                    this.uiDirty = true;
                    SoundFX.upgrade();
                } else {
                    SoundFX.error();
                }
            };
        }
        
        document.getElementById('sell-value').textContent = t.getSellValue() + '¢';
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
        
        document.querySelectorAll('.tower-option').forEach(el => {
            let type = el.dataset.type;
            if (this.canAfford(type)) {
                el.classList.remove('disabled');
            } else {
                el.classList.add('disabled');
            }
        });

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
