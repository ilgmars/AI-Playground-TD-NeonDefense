// TOWER_UPGRADES moved to config.js — it's balance/content, not game logic.

class Enemy {
    constructor(path, type, hpMultiplier) {
        this.path = path;
        this.pathIndex = 0;

        const start = path[0];
        this.x = start.c * TILE_SIZE + TILE_SIZE / 2;
        this.y = start.r * TILE_SIZE + TILE_SIZE / 2;

        this.type = type;
        this.isAir = type === 'air';

        const cfg = ENEMIES[type] || ENEMIES.normal;
        this.hp = cfg.hp * hpMultiplier;
        this.maxHp = this.hp;
        this.speed = cfg.speed;
        this.reward = cfg.reward;
        this.radius = cfg.radius;

        this.active = true;
        this.reachedEnd = false;
        this.currentSlow = 1;

        if (this.isAir) {
            this.followsPath = Math.random() < WAVE_CONFIG.airPathFollowChance;

            if (this.followsPath) {
                // These air enemies follow the ground path
                this.pathIndex = 0;
            } else {
                // 80% fly straight to the end
                let endP = path[path.length - 1];
                this.endX = endP.c * TILE_SIZE + TILE_SIZE / 2;
                this.endY = endP.r * TILE_SIZE + TILE_SIZE / 2;
                
                // Random offset for a wide formation approach
                let offX = (Math.random() - 0.5) * 200;
                let offY = (Math.random() - 0.5) * 200;
                this.x += offX;
                this.y += offY;
                
                // Add slight randomness to destination too so they swarm
                this.endX += (Math.random() - 0.5) * 50;
                this.endY += (Math.random() - 0.5) * 50;
                
                let dx = this.endX - this.x;
                let dy = this.endY - this.y;
                let dist = Math.hypot(dx, dy);
                this.vx = (dx / dist) * this.speed;
                this.vy = (dy / dist) * this.speed;
            }
        }
    }

    update() {
        if (!this.active) return;

        // M2: Freeze ability halts movement while frozenFrames > 0.
        if (this.frozen && this.frozenFrames > 0) {
            this.frozenFrames--;
            if (this.frozenFrames === 0) this.frozen = false;
            return;
        }

        // M3: Stun effect — halts this enemy for stunFrames frames.
        if (this.stunned && this.stunFrames > 0) {
            this.stunFrames--;
            if (this.stunFrames === 0) this.stunned = false;
            return;
        }

        // M3: Flamethrower burn DoT — ticks every 10 frames.
        if (this.burnFrames && this.burnFrames > 0) {
            this.burnFrames--;
            if (this.burnFrames % 10 === 0) {
                const d = this.burnDamage || 1;
                this.hp -= d;
                if (this.burnSource) this.burnSource.damageDealt += d;
                if (this.hp <= 0) this.active = false;
            }
        }

        // M3: Cryo slow ticks down to 1 after slowExpireFrame frames.
        if (this.slowExpireFrame && this.slowExpireFrame > 0) {
            this.slowExpireFrame--;
            if (this.slowExpireFrame === 0) this.currentSlow = 1;
        }

        if (this.isAir) {
            if (this.followsPath) {
                // Air enemy following the path
                let target = this.path[this.pathIndex];
                let targetX = target.c * TILE_SIZE + TILE_SIZE / 2;
                let targetY = target.r * TILE_SIZE + TILE_SIZE / 2;

                let dx = targetX - this.x;
                let dy = targetY - this.y;
                let dist = Math.hypot(dx, dy);

                let currentSpeed = this.speed * this.currentSlow;
                // M3: Only auto-recover slow if not held by cryo duration.
                if (this.currentSlow < 1 && (!this.slowExpireFrame || this.slowExpireFrame === 0)) this.currentSlow = Math.min(1, this.currentSlow + 0.01);

                if (dist < currentSpeed) {
                    this.x = targetX;
                    this.y = targetY;
                    this.pathIndex++;
                    if (this.pathIndex >= this.path.length) {
                        this.active = false;
                        this.reachedEnd = true;
                    }
                } else {
                    this.x += (dx / dist) * currentSpeed;
                    this.y += (dy / dist) * currentSpeed;
                }
            } else {
                // Air enemy flying straight
                this.x += this.vx * this.currentSlow;
                this.y += this.vy * this.currentSlow;
                
                if (Math.hypot(this.endX - this.x, this.endY - this.y) <= this.speed) {
                    this.reachedEnd = true;
                    this.active = false;
                }
                // M3: Only auto-recover slow if not held by cryo duration.
                if (this.currentSlow < 1 && (!this.slowExpireFrame || this.slowExpireFrame === 0)) this.currentSlow = Math.min(1, this.currentSlow + 0.01);
            }
            return;
        }

        let target = this.path[this.pathIndex];
        let targetX = target.c * TILE_SIZE + TILE_SIZE / 2;
        let targetY = target.r * TILE_SIZE + TILE_SIZE / 2;

        let dx = targetX - this.x;
        let dy = targetY - this.y;
        let dist = Math.hypot(dx, dy);

        let currentSpeed = this.speed * this.currentSlow;
        // M3: Only reset slow to 1 if there's no active cryo/slow duration — otherwise cryo holds.
        if (!this.slowExpireFrame || this.slowExpireFrame === 0) this.currentSlow = 1;

        if (dist < currentSpeed) {
            this.x = targetX;
            this.y = targetY;
            this.pathIndex++;
            if (this.pathIndex >= this.path.length) {
                this.active = false;
                this.reachedEnd = true;
            }
        } else {
            this.x += (dx / dist) * currentSpeed;
            this.y += (dy / dist) * currentSpeed;
        }
    }

    draw(ctx) {
        if (!this.active) return;
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1, this.burnFrames > 0, this.shielded && !this.shieldBroken, this.splitterGeneration === 1);

        // M2: Freeze ability — blue glow ring overlay.
        if (this.frozen) {
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
            ctx.fill();
            ctx.restore();
        }

        // M2 QoL: HP bar above enemies when qol.hpbars is owned.
        if (window.save && NeonSave.hasUnlocked(window.save, 'qol.hpbars')) {
            const barW = 20;
            const barH = 3;
            const frac = Math.max(0, this.hp / this.maxHp);
            const bx = this.x - barW / 2;
            const by = this.y - this.radius - 8;
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle = frac > 0.4 ? '#a3e635' : frac > 0.15 ? '#fbbf24' : '#ef4444';
            ctx.fillRect(bx, by, barW * frac, barH);
            ctx.restore();
        }
    }
}

class Tower {
    constructor(c, r, type) {
        this.c = c;
        this.r = r;
        this.x = c * TILE_SIZE;
        this.y = r * TILE_SIZE;
        this.type = type;

        this.angle = 0;
        this.cooldown = 0;
        this.upgrades = [0, 0, 0];

        // Core stats come from config (see config.js: TOWERS).
        const cfg = TOWERS[type];
        this.baseCost = cfg.cost;
        this.range = cfg.range;
        this.damage = cfg.damage;
        this.fireRate = cfg.fireRate;
        this.targetMode = cfg.defaultTargetMode;

        // Combat modifiers: start with neutral defaults, then let config override.
        this.pierce     = cfg.pierce     ?? 1;
        this.splash     = cfg.splash     ?? 0;
        this.multiShot  = cfg.multiShot  ?? 1;
        this.slowEffect = cfg.slowEffect ?? 0;
        this.chainCount = cfg.chainCount ?? 0;
        this.maxHover   = cfg.maxHover   ?? 0;

        // Optional per-type extras.
        if (cfg.pelletCount !== undefined)   this.pelletCount = cfg.pelletCount;
        if (cfg.spread !== undefined)        this.spread = cfg.spread;
        if (cfg.incomePerWave !== undefined) this.incomePerWave = cfg.incomePerWave;

        // Per-type runtime state (not config).
        if (type === 'laser') this.laserTarget = null;
        if (type === 'silo')  this.hoverRockets = [];

        this.totalSpent = this.baseCost;
        // M3: Mastery XP attribution — incremented by every projectile hit
        // and every frame of laser/tesla direct damage sourced from this tower.
        this.damageDealt = 0;
    }

    get level() {
        return 1 + this.upgrades[0] + this.upgrades[1] + this.upgrades[2];
    }

    getUpgradeCost(index) {
        let def = TOWER_UPGRADES[this.type][index];
        return Math.floor(def.baseCost * Math.pow(def.costMult, this.upgrades[index]));
    }

    getSellValue() {
        return Math.floor(this.totalSpent * 0.5);
    }

    upgrade(index) {
        let cost = this.getUpgradeCost(index);
        this.totalSpent += cost;
        this.upgrades[index]++;
        TOWER_UPGRADES[this.type][index].apply(this);
    }

    update(enemies, projectiles, particles) {
        if (this.type === 'income' || this.type === 'income_research') return; // passive tower, no combat logic
        if (this.cooldown > 0) this.cooldown--;

        if (this.type === 'silo') {
            if (this.cooldown === 0 && this.hoverRockets.length < (this.maxHover || 3)) {
                SoundFX.build();
                this.hoverRockets.push({
                    range: this.range,
                    angle: Math.random() * Math.PI * 2,
                    dist: Math.random() * 10 + 15
                });
                this.cooldown = this.fireRate;
            }
            
            for (let i = this.hoverRockets.length - 1; i >= 0; i--) {
                let r = this.hoverRockets[i];
                r.angle += 0.02;
                r.range += 0.5; 
                
                let rx = this.x + TILE_SIZE/2 + Math.cos(r.angle) * r.dist;
                let ry = this.y + TILE_SIZE/2 + Math.sin(r.angle) * r.dist;
                
                let target = null;
                let minDist = r.range;
                for (let e of enemies) {
                    if (!e.active) continue;
                    let dist = Math.hypot(e.x - rx, e.y - ry);
                    if (dist <= minDist) {
                        minDist = dist;
                        target = e;
                    }
                }
                
                if (target) {
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    projectiles.push(new Projectile(rx, ry, target, effectiveDamage, 'rocket', this.pierce, this.splash, this));
                    this.hoverRockets.splice(i, 1);
                }
            }
            return;
        }

        let target = null;
        let bestScore = -999999;

        for (let enemy of enemies) {
            if (!enemy.active) continue;
            
            // Flak strictly cannot target ground enemies
            if (this.type === 'flak' && !enemy.isAir) continue;
            
            let ex = enemy.x;
            let ey = enemy.y;
            let dist = Math.hypot(ex - (this.x + TILE_SIZE/2), ey - (this.y + TILE_SIZE/2));
            
            if (dist <= this.range) {
                // Base score by targeting mode
                let score;
                if (this.targetMode === 'mostHp') {
                    score = enemy.hp;
                } else if (this.targetMode === 'leastHp') {
                    score = -enemy.hp;
                } else if (this.targetMode === 'first') {
                    if (enemy.isAir) {
                        if (enemy.followsPath) {
                            // Air enemy following path - use pathIndex like ground enemies
                            score = enemy.pathIndex * 1000 - dist;
                        } else {
                            // Air enemy flying straight - use distance to destination
                            score = -Math.hypot(enemy.endX - enemy.x, enemy.endY - enemy.y);
                        }
                    } else {
                        score = enemy.pathIndex * 1000 - dist;
                    }
                } else { // 'closest'
                    score = -dist;
                }

                if (this.type === 'flak' && enemy.isAir) score += 1000000; // Flak strictly prioritizes Air
                if (this.type !== 'flak' && enemy.isAir) score -= 500; // Normal towers prefer ground but can target air
                
                // Laser should prefer enemies NOT already slowed by another laser
                if (this.type === 'laser' && enemy.currentSlow < 1) {
                    score += 500000; // Heavily prefer un-slowed targets
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    target = enemy;
                }
            }
        }

        if (target) {
            this.angle = Math.atan2(target.y - (this.y + TILE_SIZE/2), target.x - (this.x + TILE_SIZE/2));
            
            if (this.type === 'laser_pulse') {
                // M3: Pulse Laser — fires high-damage projectiles at fireRate cadence.
                if (this.cooldown <= 0) {
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    const proj = new Projectile(
                        this.x + TILE_SIZE / 2,
                        this.y + TILE_SIZE / 2,
                        target,
                        effectiveDamage,
                        'laser-pulse',
                        this.pierce || 1,
                        0,
                        this
                    );
                    projectiles.push(proj);
                    this.cooldown = this.fireRate;
                }
            } else if (this.type === 'laser') {
                const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                let dmg = effectiveDamage;
                if (target.isAir) dmg *= 0.4; // Ground towers are less effective vs air
                target.hp -= dmg;
                this.damageDealt += dmg;
                if (this.slowEffect && this.slowEffect > 0) {
                    target.currentSlow = Math.max(0.1, 1 - this.slowEffect);
                }
                if (target.hp <= 0) {
                    target.active = false;
                    SoundFX.explosion();
                }
                this.laserTarget = {x: target.x, y: target.y};
            } else if (this.type === 'electric_plasma') {
                // M3: Plasma Coil — continuous AoE damage to all enemies in range per frame.
                if (this.cooldown <= 0) {
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    const tx = this.x + TILE_SIZE / 2;
                    const ty = this.y + TILE_SIZE / 2;
                    const r2 = this.range * this.range;
                    for (const e of enemies) {
                        if (!e.active) continue;
                        const dx = e.x - tx;
                        const dy = e.y - ty;
                        if (dx*dx + dy*dy > r2) continue;
                        e.hp -= effectiveDamage;
                        this.damageDealt += effectiveDamage;
                        if (e.hp <= 0) e.active = false;
                    }
                    this.cooldown = 1; // effectively every frame (fireRate=1)
                }
            } else if (this.type === 'electric') {
                if (this.cooldown === 0) {
                    SoundFX.shootElectric();
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    let points = [{x: this.x + TILE_SIZE/2, y: this.y + TILE_SIZE/2}];
                    let currentTarget = target;
                    let hitCount = 0;
                    let alreadyHit = new Set();

                    while (currentTarget && hitCount < (this.chainCount || 3)) {
                        let dmg = effectiveDamage;
                        if (currentTarget.isAir) dmg *= 0.4; // Electric less effective vs air
                        currentTarget.hp -= dmg;
                        this.damageDealt += dmg;
                        if (currentTarget.hp <= 0) {
                            currentTarget.active = false;
                            SoundFX.explosion();
                        }
                        
                        points.push({x: currentTarget.x, y: currentTarget.y});
                        alreadyHit.add(currentTarget);
                        hitCount++;
                        
                        let nextTarget = null;
                        let minJumpDist = 100;
                        for (let e of enemies) {
                            if (!e.active || alreadyHit.has(e)) continue;
                            let d = Math.hypot(e.x - currentTarget.x, e.y - currentTarget.y);
                            if (d < minJumpDist) {
                                minJumpDist = d;
                                nextTarget = e;
                            }
                        }
                        currentTarget = nextTarget;
                    }
                    particles.push(new LightningBolt(points));
                    this.cooldown = this.fireRate;
                }
            } else if (this.cooldown === 0) {
                if (this.type === 'basic') SoundFX.shootBasic();
                else if (this.type === 'rapid') SoundFX.shootBasic(); 
                else if (this.type === 'sniper') SoundFX.shootSniper();
                else if (this.type === 'rocket') SoundFX.shootRocket();
                else if (this.type === 'flak') SoundFX.shootFlak();
                
                if (this.type === 'rapid_flame') {
                    // M3: Flamethrower cone damage
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    const effectiveBurnDamage = (this.burnDamage || 2) * (1 + (this.auraDamageBonus || 0));
                    const coneAngle = this.coneAngle || 0.6;
                    const aimAngle = this.angle; // updated above: angle to current target
                    const tx = this.x + TILE_SIZE / 2;
                    const ty = this.y + TILE_SIZE / 2;
                    for (const e of enemies) {
                        if (!e.active) continue;
                        const dx = e.x - tx;
                        const dy = e.y - ty;
                        const d = Math.hypot(dx, dy);
                        if (d > this.range) continue;
                        const enemyAngle = Math.atan2(dy, dx);
                        let diff = enemyAngle - aimAngle;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        if (Math.abs(diff) <= coneAngle / 2) {
                            e.hp -= effectiveDamage;
                            this.damageDealt += effectiveDamage;
                            if (e.hp <= 0) e.active = false;
                            // Start/refresh burn DoT
                            e.burnFrames = Math.max(e.burnFrames || 0, this.burnDuration || 120);
                            e.burnDamage = effectiveBurnDamage;
                            e.burnSource = this;
                        }
                    }
                    this.cooldown = this.fireRate;
                } else if (this.type === 'rapid') {
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    let pc = this.pelletCount || 5;
                    let baseAngle = Math.atan2(target.y - (this.y + TILE_SIZE/2), target.x - (this.x + TILE_SIZE/2));
                    let spread = this.spread || 0.4;
                    for (let i = 0; i < pc; i++) {
                        let offset = -spread/2 + (spread / Math.max(1, pc - 1)) * i;
                        if (pc === 1) offset = 0;
                        let proj = new Projectile(
                            this.x + TILE_SIZE/2,
                            this.y + TILE_SIZE/2,
                            null,
                            effectiveDamage,
                            this.type,
                            this.pierce,
                            this.splash,
                            this
                        );
                        proj.isDumbFire = true;
                        proj.angle = baseAngle + offset;
                        proj.maxRange = this.range + 30;
                        proj.travelled = 0;
                        projectiles.push(proj);
                    }
                } else {
                    const effectiveDamage = this.damage * (1 + (this.auraDamageBonus || 0));
                    let ms = this.multiShot || 1;
                    for (let i = 0; i < ms; i++) {
                        let finalTarget = target;
                        if (i > 0) {
                            let altTarget = null;
                            for (let e of enemies) {
                                if (e.active && e !== target) {
                                    altTarget = e;
                                    break;
                                }
                            }
                            if (altTarget) finalTarget = altTarget;
                        }
                        projectiles.push(new Projectile(
                            this.x + TILE_SIZE/2,
                            this.y + TILE_SIZE/2,
                            finalTarget,
                            effectiveDamage,
                            this.type,
                            this.pierce,
                            this.splash,
                            this
                        ));
                    }
                }
                this.cooldown = this.fireRate;
            }
        } else {
            if (this.type === 'laser') this.laserTarget = null;
        }
    }

    draw(ctx) {
        if (this.type === 'laser' && this.laserTarget) {
            let pulse = Math.sin(Date.now() / 60) * 0.5 + 0.5;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(this.x + TILE_SIZE/2, this.y + TILE_SIZE/2);
            ctx.lineTo(this.laserTarget.x, this.laserTarget.y);
            
            ctx.strokeStyle = '#8b5cf6';
            ctx.lineWidth = 2 + pulse * 4;
            ctx.shadowColor = '#8b5cf6';
            ctx.shadowBlur = 8 + pulse * 12;
            ctx.stroke();
            
            ctx.lineWidth = 1 + pulse;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            ctx.restore();
        }
        drawTower(ctx, this.x, this.y, this.type, TILE_SIZE, this.angle, this.level);
        
        if (this.type === 'silo') {
            for (let r of this.hoverRockets) {
                let rx = this.x + TILE_SIZE/2 + Math.cos(r.angle) * r.dist;
                let ry = this.y + TILE_SIZE/2 + Math.sin(r.angle) * r.dist;
                drawProjectile(ctx, rx, ry, 'rocket', r.angle + Math.PI/2);
            }
        }
    }
}

class Projectile {
    constructor(x, y, target, damage, type, pierce = 1, splash = 0, tower) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = damage;
        this.type = type;
        this.pierce = pierce;
        this.splash = splash;
        this.hitEnemies = new Set();
        this.sourceTower = tower || null;
        
        this.speed = type === 'sniper' ? 12 : type === 'rapid' ? 8 : type === 'rocket' ? 5 : type === 'flak' ? 14 : 8;
        this.active = true;
        
        if (type === 'rocket') {
            let directAngle = Math.atan2(target.y - y, target.x - x);
            this.angle = directAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 0.8 + 0.4);
            this.turnSpeed = 0.08;
            this.currentSpeed = 1;
            this.trailTimer = 0;
        }
    }

    update(enemies, particles, projectiles) {
        if (!this.active) return;
        
        if (this.x < -200 || this.x > 2000 || this.y < -200 || this.y > 1500) {
            this.active = false;
            return;
        }

        if (this.isDumbFire) {
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;
            this.travelled += this.speed;
            if (this.travelled > this.maxRange) {
                this.active = false;
                return;
            }
            for (let e of enemies) {
                if (!e.active) continue;
                if (this.type === 'flak' && !e.isAir) continue; 
                if (this.type !== 'flak' && e.isAir) continue; 
                
                let dist = Math.hypot(e.x - this.x, e.y - this.y);
                if (dist < e.radius + 5 && !this.hitEnemies.has(e)) {
                    this.hitEnemies.add(e);
                    
                    // Deal damage
                    let dmg = this.damage;
                    if (this.type === 'flak' && e.isAir) dmg *= 4;
                    else if (this.type !== 'flak' && e.isAir) dmg *= 0.4;

                    // M3: Shielded enemy absorbs first projectile hit — no damage, no XP.
                    if (e.shielded && !e.shieldBroken) {
                        e.shieldBroken = true;
                        // Cryo slow still applies — shield absorbs damage but not effects.
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                    } else {
                        e.hp -= dmg;
                        if (this.sourceTower) this.sourceTower.damageDealt += dmg;
                        // M3: Cryo Blaster slow effect — applied if the source tower defines slowEffect.
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                        SoundFX.hit();
                        if (e.hp <= 0) {
                            e.active = false;
                            SoundFX.explosion();
                        }
                    }

                    // Check pierce
                    this.pierce--;
                    if (this.pierce <= 0) {
                        this.active = false;
                        break;
                    }
                }
            }
            return;
        }

        let tx = this.target.x;
        let ty = this.target.y;

        if (!this.target.active) {
            if (this.type === 'rocket') {
                if (this.savedTx === undefined) {
                    this.active = false;
                    return;
                }
                tx = this.savedTx;
                ty = this.savedTy;
            } else {
                this.active = false;
                return;
            }
        } else {
            this.savedTx = tx;
            this.savedTy = ty;
        }

        let dist = Math.hypot(tx - this.x, ty - this.y);

        if (this.type === 'rocket') {
            let currentTurnSpeed = this.target.active ? this.turnSpeed : 0.2;
            let desiredAngle = Math.atan2(ty - this.y, tx - this.x);
            let diff = desiredAngle - this.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            
            this.angle += Math.sign(diff) * Math.min(Math.abs(diff), currentTurnSpeed);
            if (this.currentSpeed < this.speed + 3) this.currentSpeed += 0.2;
            
            this.x += Math.cos(this.angle) * this.currentSpeed;
            this.y += Math.sin(this.angle) * this.currentSpeed;
            
            this.trailTimer++;
            if (this.trailTimer >= 2) {
                this.trailTimer = 0;
                particles.push(new TrailParticle(this.x - Math.cos(this.angle)*5, this.y - Math.sin(this.angle)*5));
            }
            
            let triggerDist = this.target.active ? this.currentSpeed + 5 : 45;
            if (dist < triggerDist) {
                this.explode(enemies, particles, projectiles);
            }
        } else {
            if (dist < this.speed) {
                this.explode(enemies, particles, projectiles);
            } else {
                let dx = tx - this.x;
                let dy = ty - this.y;
                this.x += (dx / dist) * this.speed;
                this.y += (dy / dist) * this.speed;
            }
        }
    }

    explode(enemies, particles, projectiles) {
        if (this.splash > 0) {
            SoundFX.explosion();
            particles.push(new Explosion(this.x, this.y, this.splash));
            // If this is a rocket (silo), cancel all other rockets targeting the same enemy
            if (this.type === 'rocket' && projectiles) {
                for (let p of projectiles) {
                    if (p !== this && p.active && p.type === 'rocket' && p.target === this.target) {
                        p.active = false;
                    }
                }
            }
            for (let e of enemies) {
                if (!e.active) continue;
                let d = Math.hypot(e.x - this.x, e.y - this.y);
                if (d <= this.splash) {
                    let dmg = this.damage;
                    if (this.type === 'flak' && e.isAir) dmg *= 4; // Flak deals 400% damage to Air
                    else if (this.type !== 'flak' && e.isAir) dmg *= 0.4; // Ground towers less effective vs air

                    // M3: Shielded enemy absorbs first projectile hit — no damage, no XP.
                    if (e.shielded && !e.shieldBroken) {
                        e.shieldBroken = true;
                        // Cryo slow still applies — shield absorbs damage but not effects.
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                        // M3: EMP Flak stun still applies through shield.
                        if (this.sourceTower && this.sourceTower.stunDuration && e.isAir) {
                            e.stunned = true;
                            e.stunFrames = this.sourceTower.stunDuration;
                        }
                    } else {
                        e.hp -= dmg;
                        if (this.sourceTower) this.sourceTower.damageDealt += dmg;
                        // M3: Cryo Blaster slow effect — applied if the source tower defines slowEffect.
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                        // M3: EMP Flak stuns air targets on hit.
                        if (this.sourceTower && this.sourceTower.stunDuration && e.isAir) {
                            e.stunned = true;
                            e.stunFrames = this.sourceTower.stunDuration;
                        }
                        if (e.hp <= 0) {
                            e.active = false;
                            SoundFX.explosion();
                        }
                    }
                }
            }
            // M3: Cluster Rocket — spawn sub-rockets at impact site. Uses the
            // enemies and projectiles arrays passed to Projectile.update /
            // explode so no global game reference is needed.
            if (this.sourceTower && this.sourceTower.clusterCount && !this.isClusterChild) {
                const subRadius = (this.sourceTower.splash || 45) * 0.6;
                const subDamage = (this.sourceTower.damage || 18) * 0.5;
                for (let i = 0; i < this.sourceTower.clusterCount; i++) {
                    const angle = (Math.PI * 2 / this.sourceTower.clusterCount) * i;
                    const sx = this.x + Math.cos(angle) * subRadius * 0.3;
                    const sy = this.y + Math.sin(angle) * subRadius * 0.3;
                    let nearest = null;
                    let bestD = Infinity;
                    for (const en of enemies) {
                        if (!en.active) continue;
                        const dx = en.x - sx, dy = en.y - sy;
                        const d2 = dx*dx + dy*dy;
                        if (d2 < bestD) { bestD = d2; nearest = en; }
                    }
                    if (nearest) {
                        const sub = new Projectile(sx, sy, nearest, subDamage, 'rocket', 1, subRadius, this.sourceTower);
                        sub.isClusterChild = true;
                        projectiles.push(sub);
                    }
                }
            }
            this.active = false;
        } else {
            if (this.target.active) {
                let dmg = this.damage;
                if (this.type === 'flak' && this.target.isAir) dmg *= 4;
                else if (this.type !== 'flak' && this.target.isAir) dmg *= 0.4; // Ground towers less effective vs air

                // M3: Shielded enemy absorbs first projectile hit — no damage, no XP.
                if (this.target.shielded && !this.target.shieldBroken) {
                    this.target.shieldBroken = true;
                    // Cryo slow still applies — shield absorbs damage but not effects.
                    if (this.sourceTower && this.sourceTower.slowEffect) {
                        const newSlow = 1 - this.sourceTower.slowEffect;
                        this.target.currentSlow = Math.min(this.target.currentSlow, newSlow);
                        this.target.slowExpireFrame = this.sourceTower.slowDuration || 60;
                    }
                } else {
                    this.target.hp -= dmg;
                    if (this.sourceTower) this.sourceTower.damageDealt += dmg;
                    // M3: Cryo Blaster slow effect — applied if the source tower defines slowEffect.
                    if (this.sourceTower && this.sourceTower.slowEffect) {
                        const newSlow = 1 - this.sourceTower.slowEffect;
                        this.target.currentSlow = Math.min(this.target.currentSlow, newSlow);
                        this.target.slowExpireFrame = this.sourceTower.slowDuration || 60;
                    }
                    SoundFX.hit();
                    if (this.target.hp <= 0) {
                        this.target.active = false;
                        SoundFX.explosion();
                    }
                }
            }

            this.pierce--;
            if (this.pierce <= 0 || !this.target.active) {
                this.active = false;
            } else {
                let nextTarget = null;
                let minDist = 200; 
                for (let e of enemies) {
                    if (!e.active || e === this.target) continue;
                    let d = Math.hypot(e.x - this.x, e.y - this.y);
                    if (d < minDist) {
                        minDist = d;
                        nextTarget = e;
                    }
                }
                if (nextTarget) {
                    this.target = nextTarget;
                } else {
                    this.active = false;
                }
            }
        }
    }

    draw(ctx) {
        if (!this.active) return;
        drawProjectile(ctx, this.x, this.y, this.type, this.angle || 0);
    }
}

class Explosion {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.maxRadius = radius;
        this.radius = 0;
        this.alpha = 1;
        this.active = true;
    }
    update() {
        this.radius += this.maxRadius / 15;
        this.alpha -= 0.05;
        if (this.alpha <= 0) this.active = false;
    }
    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fillStyle = `rgba(249, 115, 22, ${this.alpha * 0.4})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(251, 191, 36, ${this.alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

class TrailParticle {
    constructor(x, y) {
        this.x = x + (Math.random() - 0.5) * 4;
        this.y = y + (Math.random() - 0.5) * 4;
        this.radius = Math.random() * 2 + 2;
        this.alpha = 1;
        this.active = true;
    }
    update() {
        this.radius -= 0.1;
        this.alpha -= 0.05;
        if (this.alpha <= 0 || this.radius <= 0) this.active = false;
    }
    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fillStyle = `rgba(251, 146, 60, ${this.alpha})`;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 5;
        ctx.fill();
        ctx.restore();
    }
}

class LightningBolt {
    constructor(points) {
        this.points = points;
        this.alpha = 1;
        this.active = true;
        this.segments = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            let p1 = points[i];
            let p2 = points[i+1];
            let dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            let steps = Math.max(1, Math.floor(dist / 15));
            let dx = (p2.x - p1.x) / steps;
            let dy = (p2.y - p1.y) / steps;
            
            let segs = [p1];
            for (let j = 1; j < steps; j++) {
                let nx = p1.x + dx * j + (Math.random() - 0.5) * 20;
                let ny = p1.y + dy * j + (Math.random() - 0.5) * 20;
                segs.push({x: nx, y: ny});
            }
            segs.push(p2);
            this.segments.push(segs);
        }
    }
    update() {
        this.alpha -= 0.15;
        if (this.alpha <= 0) this.active = false;
    }
    draw(ctx) {
        ctx.save();
        ctx.beginPath();
        for (let seg of this.segments) {
            ctx.moveTo(seg[0].x, seg[0].y);
            for (let j = 1; j < seg.length; j++) {
                ctx.lineTo(seg[j].x, seg[j].y);
            }
        }
        ctx.strokeStyle = `rgba(14, 165, 233, ${this.alpha})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = '#0ea5e9';
        ctx.shadowBlur = 10;
        ctx.stroke();
        
        ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }
}
