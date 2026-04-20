const TOWER_UPGRADES = {
    basic: [
        { name: 'Damage', desc: 'Increases bullet damage', baseCost: 40, costMult: 1.5, apply: (t) => { t.damage += 8; } },
        { name: 'Speed', desc: 'Shoots faster', baseCost: 30, costMult: 1.4, apply: (t) => { t.fireRate = Math.max(5, Math.floor(t.fireRate * 0.8)); } },
        { name: 'Range', desc: 'Increases targeting range', baseCost: 30, costMult: 1.3, apply: (t) => { t.range += 15; } }
    ],
    sniper: [
        { name: 'Caliber', desc: 'Huge damage boost', baseCost: 80, costMult: 1.6, apply: (t) => { t.damage += 30; } },
        { name: 'Scope', desc: 'Increases range', baseCost: 60, costMult: 1.4, apply: (t) => { t.range += 40; } },
        { name: 'Ricochet', desc: 'Bullets bounce to next enemy', baseCost: 120, costMult: 1.8, apply: (t) => { t.pierce = (t.pierce || 1) + 1; } }
    ],
    rapid: [
        { name: 'Damage', desc: 'More bullet damage', baseCost: 100, costMult: 1.5, apply: (t) => { t.damage += 3; } },
        { name: 'Overclock', desc: 'Insane fire rate', baseCost: 80, costMult: 1.6, apply: (t) => { t.fireRate = Math.max(3, Math.floor(t.fireRate * 0.7)); } },
        { name: 'Range', desc: 'Increases targeting range', baseCost: 70, costMult: 1.4, apply: (t) => { t.range += 10; } }
    ],
    laser: [
        { name: 'Intensity', desc: 'More continuous damage', baseCost: 150, costMult: 1.5, apply: (t) => { t.damage += 1; } },
        { name: 'Range', desc: 'Increases targeting range', baseCost: 100, costMult: 1.4, apply: (t) => { t.range += 20; } },
        { name: 'Cryo Beam', desc: 'Slows down enemies', baseCost: 200, costMult: 2.0, apply: (t) => { t.slowEffect = Math.min(0.8, (t.slowEffect || 0) + 0.15); } }
    ],
    rocket: [
        { name: 'Payload', desc: 'More dmg & explosion size', baseCost: 200, costMult: 1.6, apply: (t) => { t.damage += 20; t.splash = (t.splash || 70) + 15; } },
        { name: 'Multi-Shot', desc: 'Fires extra rockets', baseCost: 300, costMult: 2.0, apply: (t) => { t.multiShot = (t.multiShot || 1) + 1; } },
        { name: 'Range', desc: 'Increases targeting range', baseCost: 150, costMult: 1.4, apply: (t) => { t.range += 25; } }
    ],
    flak: [
        { name: 'Shrapnel', desc: 'Larger flak explosions', baseCost: 150, costMult: 1.5, apply: (t) => { t.splash += 20; } },
        { name: 'Radar', desc: 'Increases AA range', baseCost: 100, costMult: 1.4, apply: (t) => { t.range += 50; } },
        { name: 'Autoloader', desc: 'Fires shells faster', baseCost: 200, costMult: 1.6, apply: (t) => { t.fireRate = Math.max(15, Math.floor(t.fireRate * 0.75)); } }
    ],
    electric: [
        { name: 'Voltage', desc: 'More chain damage', baseCost: 200, costMult: 1.6, apply: (t) => { t.damage += 15; } },
        { name: 'Conductor', desc: 'Jumps to more enemies', baseCost: 250, costMult: 1.8, apply: (t) => { t.chainCount = (t.chainCount || 3) + 1; } },
        { name: 'Range', desc: 'Increases targeting range', baseCost: 150, costMult: 1.4, apply: (t) => { t.range += 20; } }
    ],
    silo: [
        { name: 'Warhead', desc: 'More hover rocket dmg', baseCost: 300, costMult: 1.6, apply: (t) => { t.damage += 30; } },
        { name: 'Capacity', desc: 'More max hovering rockets', baseCost: 400, costMult: 2.0, apply: (t) => { t.maxHover = (t.maxHover || 3) + 1; } },
        { name: 'Assembly', desc: 'Builds rockets faster', baseCost: 250, costMult: 1.5, apply: (t) => { t.fireRate = Math.max(30, Math.floor(t.fireRate * 0.8)); } }
    ]
};

class Enemy {
    constructor(path, type, hpMultiplier) {
        this.path = path;
        this.pathIndex = 0;
        
        const start = path[0];
        this.x = start.c * TILE_SIZE + TILE_SIZE / 2;
        this.y = start.r * TILE_SIZE + TILE_SIZE / 2;
        
        this.type = type; 
        this.isAir = type === 'air';
        this.radius = 12;
        
        let baseHp = 20;
        let baseSpeed = 1;
        let baseReward = 5;

        if (type === 'fast') {
            baseHp = 10;
            baseSpeed = 1.8;
            baseReward = 3;
            this.radius = 10;
        } else if (type === 'tank') {
            baseHp = 60;
            baseSpeed = 0.6;
            baseReward = 10;
            this.radius = 15;
        } else if (type === 'air') {
            baseHp = 25;
            baseSpeed = 0.6; // Much slower
            baseReward = 8;
            this.radius = 14;
        }

        this.hp = baseHp * hpMultiplier;
        this.maxHp = this.hp;
        this.speed = baseSpeed;
        this.reward = baseReward;
        
        this.active = true;
        this.reachedEnd = false;
        
        this.currentSlow = 1;
        
        if (this.isAir) {
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

    update() {
        if (!this.active) return;
        
        if (this.isAir) {
            this.x += this.vx * this.currentSlow;
            this.y += this.vy * this.currentSlow;
            
            if (Math.hypot(this.endX - this.x, this.endY - this.y) <= this.speed) {
                this.reachedEnd = true;
                this.active = false;
            }
            if (this.currentSlow < 1) this.currentSlow = Math.min(1, this.currentSlow + 0.01);
            return;
        }

        let target = this.path[this.pathIndex];
        let targetX = target.c * TILE_SIZE + TILE_SIZE / 2;
        let targetY = target.r * TILE_SIZE + TILE_SIZE / 2;

        let dx = targetX - this.x;
        let dy = targetY - this.y;
        let dist = Math.hypot(dx, dy);

        let currentSpeed = this.speed * this.currentSlow;
        this.currentSlow = 1;

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
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp);
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
        
        this.pierce = 1;
        this.splash = type === 'rocket' ? 70 : 0;
        this.multiShot = 1;
        this.slowEffect = 0;
        this.chainCount = type === 'electric' ? 3 : 0;
        this.maxHover = type === 'silo' ? 3 : 0;

        if (type === 'basic') {
            this.baseCost = 50;
            this.range = 100;
            this.damage = 10;
            this.fireRate = 40; 
        } else if (type === 'sniper') {
            this.baseCost = 100;
            this.range = 250;
            this.damage = 40;
            this.fireRate = 100;
        } else if (type === 'rapid') {
            this.baseCost = 150;
            this.range = 80;
            this.damage = 4;
            this.fireRate = 10;
        } else if (type === 'laser') {
            this.baseCost = 200;
            this.range = 150;
            this.damage = 1.5; 
            this.fireRate = 1; 
            this.laserTarget = null;
        } else if (type === 'rocket') {
            this.baseCost = 250;
            this.range = 200;
            this.damage = 30; 
            this.fireRate = 90; 
        } else if (type === 'flak') {
            this.baseCost = 150;
            this.range = 200;
            this.damage = 15;
            this.fireRate = 35;
            this.splash = 50;
        } else if (type === 'electric') {
            this.baseCost = 300;
            this.range = 120;
            this.damage = 25; 
            this.fireRate = 60; 
        } else if (type === 'silo') {
            this.baseCost = 400;
            this.range = 100;
            this.damage = 60;
            this.fireRate = 120;
            this.hoverRockets = [];
        }
        
        this.totalSpent = this.baseCost;
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
                    projectiles.push(new Projectile(rx, ry, target, this.damage, 'rocket', this.pierce, this.splash));
                    this.hoverRockets.splice(i, 1);
                }
            }
            return;
        }

        let target = null;
        let bestScore = -999999;

        for (let enemy of enemies) {
            if (!enemy.active) continue;
            
            let ex = enemy.x;
            let ey = enemy.y;
            let dist = Math.hypot(ex - (this.x + TILE_SIZE/2), ey - (this.y + TILE_SIZE/2));
            
            if (dist <= this.range) {
                let score = -dist; // Closer is better
                if (this.type === 'flak' && enemy.isAir) score += 1000; // Flak strictly prioritizes Air
                if (this.type !== 'flak' && enemy.isAir) score -= 1000; // Normal towers strictly prioritize Ground
                
                if (score > bestScore) {
                    bestScore = score;
                    target = enemy;
                }
            }
        }

        if (target) {
            this.angle = Math.atan2(target.y - (this.y + TILE_SIZE/2), target.x - (this.x + TILE_SIZE/2));
            
            if (this.type === 'laser') {
                target.hp -= this.damage;
                if (this.slowEffect && this.slowEffect > 0) {
                    target.currentSlow = Math.max(0.1, 1 - this.slowEffect);
                }
                if (target.hp <= 0) {
                    target.active = false;
                    SoundFX.explosion();
                }
                this.laserTarget = {x: target.x, y: target.y};
            } else if (this.type === 'electric') {
                if (this.cooldown === 0) {
                    SoundFX.shootElectric();
                    let points = [{x: this.x + TILE_SIZE/2, y: this.y + TILE_SIZE/2}];
                    let currentTarget = target;
                    let hitCount = 0;
                    let alreadyHit = new Set();
                    
                    while (currentTarget && hitCount < (this.chainCount || 3)) {
                        currentTarget.hp -= this.damage;
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
                if (this.type === 'basic' || this.type === 'rapid') SoundFX.shootBasic();
                else if (this.type === 'sniper') SoundFX.shootSniper();
                else if (this.type === 'rocket') SoundFX.shootRocket();
                else if (this.type === 'flak') SoundFX.shootFlak();
                
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
                        this.damage, 
                        this.type,
                        this.pierce,
                        this.splash
                    ));
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
    constructor(x, y, target, damage, type, pierce = 1, splash = 0) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = damage;
        this.type = type;
        this.pierce = pierce;
        this.splash = splash;
        
        this.speed = type === 'sniper' ? 12 : type === 'rapid' ? 6 : type === 'rocket' ? 5 : type === 'flak' ? 14 : 8;
        this.active = true;
        
        if (type === 'rocket') {
            let directAngle = Math.atan2(target.y - y, target.x - x);
            this.angle = directAngle + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 0.8 + 0.4);
            this.turnSpeed = 0.08;
            this.currentSpeed = 1;
            this.trailTimer = 0;
        }
    }

    update(enemies, particles) {
        if (!this.active) return;
        
        if (this.x < -200 || this.x > 2000 || this.y < -200 || this.y > 1500) {
            this.active = false;
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
                this.explode(enemies, particles);
            }
        } else {
            if (dist < this.speed) {
                this.explode(enemies, particles);
            } else {
                let dx = tx - this.x;
                let dy = ty - this.y;
                this.x += (dx / dist) * this.speed;
                this.y += (dy / dist) * this.speed;
            }
        }
    }

    explode(enemies, particles) {
        if (this.splash > 0) {
            SoundFX.explosion();
            particles.push(new Explosion(this.x, this.y, this.splash));
            for (let e of enemies) {
                if (!e.active) continue;
                let d = Math.hypot(e.x - this.x, e.y - this.y);
                if (d <= this.splash) {
                    let dmg = this.damage;
                    if (this.type === 'flak' && e.isAir) dmg *= 4; // Flak deals 400% damage to Air
                    
                    e.hp -= dmg;
                    if (e.hp <= 0) {
                        e.active = false;
                        SoundFX.explosion();
                    }
                }
            }
            this.active = false;
        } else {
            if (this.target.active) {
                let dmg = this.damage;
                if (this.type === 'flak' && this.target.isAir) dmg *= 4;
                
                this.target.hp -= dmg;
                SoundFX.hit();
                if (this.target.hp <= 0) {
                    this.target.active = false;
                    SoundFX.explosion();
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
