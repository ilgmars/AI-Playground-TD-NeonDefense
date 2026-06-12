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
        this.defense = cfg.defense || 0;

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
                const dealt = this.takeDamage(d);
                if (this.burnSource) this.burnSource.damageDealt += dealt;
                if (this.hp <= 0) this.active = false;
            }
        }

        // M3: Cryo slow ticks down to 1 after slowExpireFrame frames.
        if (this.slowExpireFrame && this.slowExpireFrame > 0) {
            this.slowExpireFrame--;
            if (this.slowExpireFrame === 0) this.currentSlow = 1;
        }

        if (this.isAir) {
            if (!this.followsPath) {
                const mapW = window.COLS * window.TILE_SIZE;
                const mapH = window.ROWS * window.TILE_SIZE;
                if (this.x < -200 || this.x > mapW + 200 || this.y < -200 || this.y > mapH + 200) {
                    this.reachedEnd = true;
                    this.active = false;
                    return;
                }
            }
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
        drawEnemy(ctx, this.x, this.y, this.radius, this.type, this.hp / this.maxHp, this.currentSlow < 1, this.burnFrames > 0, this.shielded && !this.shieldBroken, this.splitterGeneration === 1, this.isBoss);

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

    takeDamage(dmg) {
        const eff = Math.max(1, dmg * (1 - this.defense));
        this.hp -= eff;
        return eff;
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

        // Optional per-type extras. Without these copies the variants'
        // config values get silently shadowed by `this.X || <default>`
        // fallbacks scattered through the combat code — fine for fields
        // whose default happens to equal the config (Flamethrower's
        // burnDamage: 2 matches the `|| 2` fallback) but a hidden trap
        // when the variant wants a different value (e.g. Plasma Coil).
        if (cfg.pelletCount !== undefined)   this.pelletCount = cfg.pelletCount;
        if (cfg.spread !== undefined)        this.spread = cfg.spread;
        if (cfg.incomePerWave !== undefined) this.incomePerWave = cfg.incomePerWave;
        if (cfg.burnDamage !== undefined)    this.burnDamage = cfg.burnDamage;
        if (cfg.burnDuration !== undefined)  this.burnDuration = cfg.burnDuration;
        if (cfg.slowDuration !== undefined)  this.slowDuration = cfg.slowDuration;
        if (cfg.stunDuration !== undefined)  this.stunDuration = cfg.stunDuration;
        if (cfg.coneAngle !== undefined)     this.coneAngle = cfg.coneAngle;
        if (cfg.clusterCount !== undefined)  this.clusterCount = cfg.clusterCount;
        if (cfg.auraBonus !== undefined)     this.auraBonus = cfg.auraBonus;
        if (cfg.auraRange !== undefined)     this.auraRange = cfg.auraRange;

        // Variants own their own mastery track (e.g. 'basic_cryo' is separate
        // from 'basic'). Read perks for the EXACT type built — a fresh variant
        // entry that doesn't exist yet falls back to all-zeros below.
        //
        // Coop fair-play: when window.__neonMPFairPlay is true (set by
        // restartGame for MP runs), ignore mastery perks entirely so a
        // veteran and a newbie place towers with identical stats. The
        // veteran's progression still lives in save.towerMastery — it
        // just doesn't bleed into the coop sim.
        const fairPlay = typeof window !== 'undefined' && window.__neonMPFairPlay === true;
        const mastery = (!fairPlay) && window.save && window.save.towerMastery && window.save.towerMastery[type];
        this.masteryPerks = (mastery && mastery.perks) ? mastery.perks : { damage: 0, fireRate: 0, efficiency: 0 };
        const damageRank = this.masteryPerks.damage || 0;
        const fireRateRank = this.masteryPerks.fireRate || 0;
        // Endless perks use DIMINISHING returns that asymptote, so the cost
        // (geometric) outruns the benefit forever — a genuine XP sink that
        // can't trivialise the difficulty curve. Damage caps at +80%, fire
        // rate at 2x. Early ranks ≈ the old +2%/+1.5% per-rank feel.
        const outputMult = 1 + 0.8 * (1 - Math.pow(0.97, damageRank));
        this.damage *= outputMult;
        if (this.burnDamage !== undefined) this.burnDamage *= outputMult;
        if (this.incomePerWave !== undefined) this.incomePerWave *= outputMult;
        if (this.auraBonus !== undefined) this.auraBonus *= outputMult;
        if (this.fireRate > 0) {
            const rateFactor = 0.5 + 0.5 * Math.pow(0.97, fireRateRank);
            this.fireRate = Math.max(1, Math.round(this.fireRate * rateFactor));
        }
        this.masteryUpgradeCostMult = Math.max(0.5, 1 - ((this.masteryPerks.efficiency || 0) * 0.02));

        // Per-type runtime state (not config). Variants share their base's
        // runtime fields — laser_pulse needs laserTarget, silo_orbital needs
        // hoverRockets — so check both forms.
        if (type === 'laser' || type === 'laser_pulse') this.laserTarget = null;
        if (type === 'silo'  || type === 'silo_orbital') this.hoverRockets = [];

        this.totalSpent = this.baseCost;
        // M3: Mastery XP attribution — incremented by every projectile hit
        // and every frame of laser/tesla direct damage sourced from this tower.
        this.damageDealt = 0;

        // Per-upgrade-slot auto-upgrade flags. Each entry, when true, lets
        // Game._runAutoUpgrade buy that specific upgrade whenever money
        // allows. Toggled from the small ⏶ button on each upgrade row.
        this.autoUpgradeSlots = [false, false, false];
    }

    get level() {
        return 1 + this.upgrades[0] + this.upgrades[1] + this.upgrades[2];
    }

    getUpgradeCost(index) {
        let def = TOWER_UPGRADES[this.type][index];
        return Math.floor(def.baseCost * Math.pow(def.costMult, this.upgrades[index]) * (this.masteryUpgradeCostMult || 1));
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

        if (this.type === 'silo' || this.type === 'silo_orbital') {
            if (this.cooldown === 0 && this.hoverRockets.length < (this.maxHover || 3)) {
                SoundFX.build();
                // Orbital rockets hover further out and orbit more slowly
                const isOrbital = this.type === 'silo_orbital';
                this.hoverRockets.push({
                    range: this.range,
                    angle: Math.random() * Math.PI * 2,
                    dist: isOrbital ? (Math.random() * 20 + 28) : (Math.random() * 10 + 15)
                });
                this.cooldown = this.fireRate;
            }

            // Seeker range grows the longer a rocket hovers, capped so
            // it stays visually plausible (uncapped growth was the old
            // "fires at an enemy half a screen away" bug).
            //   Base silo:  fast growth to 1.5× — rockets are ammo,
            //               they should engage promptly.
            //   Orbital:    SLOW growth to 2.0× — its identity is the
            //               long hover, so banking rockets longer
            //               meaningfully widens their strike radius
            //               (~35 s of hover to reach the cap).
            const isOrbitalSilo = this.type === 'silo_orbital';
            const seekerCap = this.range * (isOrbitalSilo ? 2.0 : 1.5);
            const seekerGrowth = isOrbitalSilo ? 0.06 : 0.5;
            for (let i = this.hoverRockets.length - 1; i >= 0; i--) {
                let r = this.hoverRockets[i];
                r.angle += isOrbitalSilo ? 0.007 : 0.02;
                if (r.range < seekerCap) r.range += seekerGrowth;

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

        // Idle-scan throttle. Targeting is O(enemies) PER TOWER and ran
        // every frame for every tower — profiled as the dominant
        // long-game CPU cost (frame time tracks tower count, ~17× from
        // wave 20→300; multiplied by gameSpeed on mobile = "APK laggy
        // after 300 waves"). While the cooldown is ticking, the scan
        // only feeds cosmetic barrel tracking — so run it every 5th
        // frame (deterministically staggered by tile so towers don't
        // spike in lockstep). Firing frames (cooldown ≤ 1) and the
        // continuous-beam laser still scan every frame, so combat
        // behaviour is bit-identical.
        if (this.type !== 'laser' && this.cooldown > 1) {
            this._scanTick = ((this._scanTick === undefined
                ? (this.c * 7 + this.r * 13) : this._scanTick) + 1) % 5;
            if (this._scanTick !== 0) return;
        }

        let target = null;
        let bestScore = -999999;

        for (let enemy of enemies) {
            if (!enemy.active) continue;
            
            // Flak (and EMP Flak variant) strictly cannot target ground enemies.
            if ((this.type === 'flak' || this.type === 'flak_emp') && !enemy.isAir) continue;
            
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

                const isAA = (this.type === 'flak' || this.type === 'flak_emp');
                if (isAA && enemy.isAir) score += 1000000; // Flak strictly prioritizes Air
                if (!isAA && enemy.isAir) score -= 500;    // Other towers prefer ground but can target air
                
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
                if (target.isAir) dmg *= 0.4;
                const laserDealt = target.takeDamage(dmg);
                this.damageDealt += laserDealt;
                if (this.slowEffect && this.slowEffect > 0) {
                    target.currentSlow = Math.max(0.1, 1 - this.slowEffect);
                }
                if (target.hp <= 0) {
                    target.active = false;
                    SoundFX.explosion();
                }
                this.laserTarget = {x: target.x, y: target.y};
            } else if (this.type === 'electric' || this.type === 'electric_plasma') {
                if (this.cooldown === 0) {
                    SoundFX.shootElectric();
                    const effectiveDamage     = this.damage * (1 + (this.auraDamageBonus || 0));
                    const effectiveBurnDamage = (this.burnDamage || 0) * (1 + (this.auraDamageBonus || 0));
                    let points = [{x: this.x + TILE_SIZE/2, y: this.y + TILE_SIZE/2}];
                    let currentTarget = target;
                    let hitCount = 0;
                    let alreadyHit = new Set();

                    while (currentTarget && hitCount < (this.chainCount || 3)) {
                        let dmg = effectiveDamage;
                        if (currentTarget.isAir) dmg *= 0.4; // Electric less effective vs air
                        if (currentTarget.shielded && !currentTarget.shieldBroken) {
                            currentTarget.shieldBroken = true;
                        } else {
                            const teslaDealt = currentTarget.takeDamage(dmg);
                            this.damageDealt += teslaDealt;
                            if (currentTarget.hp <= 0) {
                                currentTarget.active = false;
                                SoundFX.explosion();
                            }
                            // M3: Plasma Coil burn DoT — applied to every chained
                            // enemy that takes a direct hit (skipped on a shield
                            // soak, matching how Flamethrower handles burn).
                            if (effectiveBurnDamage > 0 && currentTarget.active) {
                                currentTarget.burnFrames = Math.max(currentTarget.burnFrames || 0, this.burnDuration || 90);
                                currentTarget.burnDamage = effectiveBurnDamage;
                                currentTarget.burnSource = this;
                            }
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
                // Variants fall back to their base type's firing sound
                // (basic_cryo → basic, sniper_scatter → sniper, etc.)
                const soundBase = this.type.includes('_') ? this.type.split('_')[0] : this.type;
                if (soundBase === 'basic')      SoundFX.shootBasic();
                else if (soundBase === 'rapid') SoundFX.shootBasic();
                else if (soundBase === 'sniper') SoundFX.shootSniper();
                else if (soundBase === 'rocket') SoundFX.shootRocket();
                else if (soundBase === 'flak')  SoundFX.shootFlak();
                
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
                            const flameDealt = e.takeDamage(effectiveDamage);
                            this.damageDealt += flameDealt;
                            if (e.hp <= 0) e.active = false;
                            // Start/refresh burn DoT
                            e.burnFrames = Math.max(e.burnFrames || 0, this.burnDuration || 120);
                            e.burnDamage = effectiveBurnDamage;
                            e.burnSource = this;
                        }
                    }
                    // Cone visual: show for next 8 draw-frames
                    this._flameConeFrames = 8;
                    this._flameConeAngle = this.angle;
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
                    // Variants use their base type's projectile rendering + physics:
                    // rocket_cluster → 'rocket', sniper_scatter → 'sniper', flak_emp → 'flak', etc.
                    // Without this the variant projectile fell into the default branch
                    // in drawProjectile and rendered as a generic cyan ball.
                    const projType = this.type.includes('_') ? this.type.split('_')[0] : this.type;
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
                            projType,
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

        // Flamethrower cone visual — fades out over 8 draw-frames after a burst.
        if (this.type === 'rapid_flame' && this._flameConeFrames > 0) {
            this._flameConeFrames--;
            const alpha = this._flameConeFrames / 8;
            const tx = this.x + TILE_SIZE / 2;
            const ty = this.y + TILE_SIZE / 2;
            const cone = this.coneAngle || 0.6;
            ctx.save();
            ctx.globalAlpha = alpha * 0.45;
            const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, this.range || 70);
            grad.addColorStop(0, 'rgba(251,191,36,0.9)');
            grad.addColorStop(0.5, 'rgba(249,115,22,0.7)');
            grad.addColorStop(1, 'rgba(239,68,68,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.arc(tx, ty, this.range || 70, this._flameConeAngle - cone / 2, this._flameConeAngle + cone / 2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // Hover rockets: drawn for both Silo and Orbital Strike.
        if (this.type === 'silo' || this.type === 'silo_orbital') {
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
            // Seed fallback target now so a same-frame sibling kill (e.g. another
            // silo's rocket exploded earlier in the projectile loop) doesn't
            // vanish this rocket on its first update with savedTx===undefined.
            this.savedTx = target.x;
            this.savedTy = target.y;
        }
    }

    // Swap a (dead) target for the nearest live enemy within reach.
    // Used when a sibling rocket already killed our target — homing
    // continues to the new mark instead of the rocket vanishing.
    retargetNearest(enemies) {
        const RETARGET_RADIUS = 300;
        let best = null, bestD = RETARGET_RADIUS;
        for (const e of enemies || []) {
            if (!e || !e.active) continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        if (best) {
            this.target = best;
            this.savedTx = best.x;
            this.savedTy = best.y;
        }
        // No candidate → keep flying to savedTx/savedTy and explode
        // there (the dead-target homing path handles it).
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
                const dumbIsAA = (this.type === 'flak' || this.type === 'flak_emp');
                if (dumbIsAA && !e.isAir) continue;
                if (!dumbIsAA && e.isAir) continue;

                let dist = Math.hypot(e.x - this.x, e.y - this.y);
                if (dist < e.radius + 5 && !this.hitEnemies.has(e)) {
                    this.hitEnemies.add(e);

                    // Deal damage. Base Flak's identity is the 4× air burst;
                    // EMP Flak trades that for stun, so it stays at 1×.
                    let dmg = this.damage;
                    if (this.type === 'flak' && e.isAir) dmg *= 4;
                    else if (!dumbIsAA && e.isAir)       dmg *= 0.4;

                    // M3: Shielded enemy absorbs first projectile hit — no damage, no XP.
                    if (e.shielded && !e.shieldBroken) {
                        e.shieldBroken = true;
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                    } else {
                        const dumbDealt = e.takeDamage(dmg);
                        if (this.sourceTower) this.sourceTower.damageDealt += dumbDealt;
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
                // Particle budget: a 40-rocket barrage at late waves
                // pushed 130+ live trail particles (profiled) — past
                // 150 the visual is saturated anyway, so stop adding.
                if (particles.length < 150) {
                    particles.push(new TrailParticle(this.x - Math.cos(this.angle)*5, this.y - Math.sin(this.angle)*5));
                }
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
            // Other rockets FROM THE SAME SILO chasing the same enemy
            // RETARGET to the nearest live enemy instead of being
            // silently deactivated. The old `p.active = false` was the
            // "rockets disappear into the air" report: a 3-rocket
            // salvo's first hit made the rest blink out mid-flight
            // with no explosion. If no other enemy is around, the
            // rocket keeps flying to its last-known coords and
            // explodes there (splash still lands).
            if (this.type === 'rocket' && projectiles && !this.isClusterChild) {
                for (let p of projectiles) {
                    if (p !== this && p.active && p.type === 'rocket' &&
                        p.target === this.target && p.sourceTower === this.sourceTower) {
                        p.retargetNearest(enemies);
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
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
                        if (this.sourceTower && this.sourceTower.stunDuration && e.isAir) {
                            e.stunned = true;
                            e.stunFrames = this.sourceTower.stunDuration;
                        }
                    } else {
                        const splashDealt = e.takeDamage(dmg);
                        if (this.sourceTower) this.sourceTower.damageDealt += splashDealt;
                        if (this.sourceTower && this.sourceTower.slowEffect) {
                            const newSlow = 1 - this.sourceTower.slowEffect;
                            e.currentSlow = Math.min(e.currentSlow, newSlow);
                            e.slowExpireFrame = this.sourceTower.slowDuration || 60;
                        }
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
                const SEARCH_R  = 200;                 // limit sub-rocket reach so they don't fly across the map
                const SEARCH_R2 = SEARCH_R * SEARCH_R;
                const claimed = new Set();             // distinct target per sub-rocket
                const N = this.sourceTower.clusterCount;
                // Random base offset so consecutive cluster volleys don't all spawn the same fan pattern.
                const baseRot = Math.random() * Math.PI * 2;
                for (let i = 0; i < N; i++) {
                    const angle = baseRot + (Math.PI * 2 / N) * i;
                    // Spawn further out than before (radius*0.7) so the sub-rockets
                    // are visually distinct immediately instead of starting in a pile.
                    const sx = this.x + Math.cos(angle) * subRadius * 0.7;
                    const sy = this.y + Math.sin(angle) * subRadius * 0.7;
                    // Pick the closest UNCLAIMED enemy within SEARCH_R; bail if none.
                    let nearest = null;
                    let bestD = SEARCH_R2;
                    for (const en of enemies) {
                        if (!en.active || claimed.has(en)) continue;
                        const dx = en.x - sx, dy = en.y - sy;
                        const d2 = dx*dx + dy*dy;
                        if (d2 < bestD) { bestD = d2; nearest = en; }
                    }
                    // Fallback: if every nearby enemy is already claimed, allow re-picking.
                    if (!nearest) {
                        bestD = SEARCH_R2;
                        for (const en of enemies) {
                            if (!en.active) continue;
                            const dx = en.x - sx, dy = en.y - sy;
                            const d2 = dx*dx + dy*dy;
                            if (d2 < bestD) { bestD = d2; nearest = en; }
                        }
                    }
                    if (!nearest) continue;            // no enemy in range → skip the sub entirely
                    claimed.add(nearest);

                    const sub = new Projectile(sx, sy, nearest, subDamage, 'rocket', 1, subRadius, this.sourceTower);
                    sub.isClusterChild = true;
                    // Spread comes from spawn POSITIONS (sx,sy) being radial out
                    // from the burst. Angle aims directly at the chosen target so
                    // the sub doesn't have to spin around. Skip the 1→8 ramp for
                    // a snappy fan instead of a floaty one.
                    sub.angle = Math.atan2(nearest.y - sy, nearest.x - sx);
                    // Cluster subs are SUPER agile: high speed cap, snappy homing,
                    // already at speed when they spawn so the fan reads instantly.
                    sub.speed = 9;                      // max ~12 (speed+3) vs primary 5/max 8
                    sub.currentSpeed = 8;
                    sub.turnSpeed = 0.32;               // 4× primary turnSpeed (0.08)
                    projectiles.push(sub);
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
                    if (this.sourceTower && this.sourceTower.slowEffect) {
                        const newSlow = 1 - this.sourceTower.slowEffect;
                        this.target.currentSlow = Math.min(this.target.currentSlow, newSlow);
                        this.target.slowExpireFrame = this.sourceTower.slowDuration || 60;
                    }
                } else {
                    const directDealt = this.target.takeDamage(dmg);
                    if (this.sourceTower) this.sourceTower.damageDealt += directDealt;
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
