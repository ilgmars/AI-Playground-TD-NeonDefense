// Procedural assets drawing

// On high-DPR mobile devices (DPR > 2) NEON_LOW_PERF is set in main.js.
// Shadow/glow calls are wrapped in setGlow/clearGlow so they can be skipped.
function setGlow(ctx, color, blur) {
    if (window.NEON_LOW_PERF) return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
}
function clearGlow(ctx) {
    if (window.NEON_LOW_PERF) return;
    ctx.shadowBlur = 0;
}

// ── Sprite cache ─────────────────────────────────────────────────────
// shadowBlur is a per-draw-call Gaussian blur — the single most
// expensive Canvas2D operation, and we were paying it for EVERY tower,
// enemy and projectile EVERY frame. Bodies are static per (type,
// state), so we rasterize each one once (glow included) into a small
// offscreen canvas at the live device scale and blit it per frame.
// Dynamic content (health bars, status rings, rotation, level stars)
// stays live vector on top.
//
// Crispness invariant: sprites are rasterized at RENDER_SCALE × zoom
// device pixels and blitted at exactly logical-size/scale, i.e. 1:1
// device pixels — the same vector-crisp guarantee as direct drawing.
// The whole cache flushes when that scale changes (resize / zoom
// settle); during an active pinch gesture the stale-scale sprites keep
// being used (smoothly rescaled by the world transform, like the map
// layer) and re-rasterize crisp on the first frame after release.
const _spriteCache = new Map();
let _spriteCacheScale = 0;
function _spriteLiveScale() {
    const z = (typeof window !== 'undefined' && window.__neonZoom) ? window.__neonZoom.scale : 1;
    return (window.RENDER_SCALE || 1) * z;
}
function getSprite(key, logicalW, logicalH, painter) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const gesture = (typeof window !== 'undefined') && window.__neonZoomGesture === true;
    const live = _spriteLiveScale();
    if (_spriteCacheScale !== live && !(gesture && _spriteCacheScale !== 0)) {
        _spriteCache.clear();
        _spriteCacheScale = live;
    }
    let s = _spriteCache.get(key);
    if (!s) {
        const scale = _spriteCacheScale || live;
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.ceil(logicalW * scale));
        c.height = Math.max(1, Math.ceil(logicalH * scale));
        const sctx = c.getContext('2d');
        sctx.scale(scale, scale);
        sctx.translate(logicalW / 2, logicalH / 2);   // painter draws around (0,0)
        painter(sctx);
        // `scale` is recorded so blitSprite can detect exact 1:1
        // (live transform == raster scale) and snap to device pixels.
        s = { canvas: c, w: logicalW, h: logicalH, scale };
        _spriteCache.set(key, s);
    }
    return s;
}
// Test/diagnostic hook — cache size for churn assertions.
if (typeof window !== 'undefined') {
    window.__neonSpriteCacheSize = () => _spriteCache.size;
}
// Blit a cached sprite centred on (x, y) in logical units, optionally
// rotated.
//
// The blit happens in DEVICE space with the centre snapped to a whole
// device pixel. Sub-pixel bitmap placement resamples the sprite with a
// different bilinear phase every frame, which reads as shimmer/jitter
// on anything that moves (the "mobs look jittery" report). Snapping
// quantizes motion to device pixels — at DPR 2 that's half a logical
// pixel, spatially invisible — and when the live scale matches the
// raster scale the draw is an exact 1:1 pixel copy, zero resampling.
function blitSprite(ctx, s, x, y, angle, smooth) {
    const T = (typeof window !== 'undefined') && window.__neonRenderT;
    if (!T) {
        // No live transform published (non-Game callers) — legacy
        // logical-space blit.
        ctx.drawImage(s.canvas, x - s.w / 2, y - s.h / 2, s.w, s.h);
        return;
    }
    const c = s.canvas;
    // k = device px per sprite px. Exactly 1 when the cache is fresh;
    // ≠ 1 only mid-gesture (stale-scale sprites smoothly rescaled).
    const k = T.a / s.scale;
    const dw = c.width * k, dh = c.height * k;
    const devX = T.a * x + T.ox;
    const devY = T.a * y + T.oy;
    if (angle) {
        // Rotated draws resample regardless; snap only the pivot.
        ctx.save();
        ctx.translate((Math.round(devX) - T.ox) / T.a, (Math.round(devY) - T.oy) / T.a);
        ctx.rotate(angle);
        ctx.drawImage(c, -dw / (2 * T.a), -dh / (2 * T.a), dw / T.a, dh / T.a);
        ctx.restore();
    } else {
        // Snap the CORNER (odd sprite sizes would put a snapped centre
        // back on a half pixel), expressed back in WORLD units so the
        // draw runs under the existing transform — no setTransform
        // round-trip per sprite, which costs real time at 1000+
        // entities. World→device→world maps the corner onto an exact
        // integer device pixel (fp error ~1e-7 px, below the
        // rasterizer's fixed-point sampling grid).
        //
        // smooth=true skips the snap: snapping a SLOW-MOVING sprite makes it
        // hop a whole device pixel at a time (visible jitter/vibration), so
        // moving entities (enemies) blit at sub-pixel for fluid motion at a
        // hair of softness. Static sprites (towers) keep the crisp snap.
        const cornerX = devX - dw / 2, cornerY = devY - dh / 2;
        const wx = ((smooth ? cornerX : Math.round(cornerX)) - T.ox) / T.a;
        const wy = ((smooth ? cornerY : Math.round(cornerY)) - T.oy) / T.a;
        ctx.drawImage(c, wx, wy, dw / T.a, dh / T.a);
    }
}

function drawGridTile(ctx, x, y, size) {
    ctx.fillStyle = '#0f172a'; // dark background
    ctx.fillRect(x, y, size, size);
    
    // Subtle grid lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, size, size);
    
    // Tiny decorative dots
    if ((x/size + y/size) % 3 === 0) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, 1, 0, Math.PI*2);
        ctx.fill();
    }
}

function drawPathTile(ctx, x, y, size) {
    ctx.fillStyle = '#1e293b'; // slightly lighter path
    ctx.fillRect(x, y, size, size);
    
    // Path inner glowing border — per-tile randomized intensity (stable per coord, so no shimmer on redraw)
    const n = Math.sin((x * 12.9898 + y * 78.233)) * 43758.5453;
    const a = 0.03 + (n - Math.floor(n)) * 0.14; // ~0.03–0.17
    ctx.strokeStyle = `rgba(148, 163, 184, ${a.toFixed(3)})`;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x+2, y+2, size-4, size-4);
}

function drawBaseTile(ctx, x, y, size) {
    drawPathTile(ctx, x, y, size);
    
    // Core structure
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/2 - 4, 0, Math.PI*2);
    ctx.fill();

    // Inner core
    ctx.fillStyle = '#fb7185';
    setGlow(ctx, '#fb7185', 15);
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/4, 0, Math.PI*2);
    ctx.fill();
    clearGlow(ctx);
}

function drawSpawnerTile(ctx, x, y, size) {
    drawPathTile(ctx, x, y, size);
    
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;
    setGlow(ctx, '#c084fc', 10);

    // Draw a portal/spawner
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/3, 0, Math.PI*2);
    ctx.stroke();

    // Inner pulse
    ctx.fillStyle = 'rgba(192, 132, 252, 0.3)';
    ctx.fill();
    clearGlow(ctx);
}

// Entity drawing

// Body painter — everything static per (type, radius, color), glow
// included. Draws around (0,0); used both by the sprite raster and
// the no-DOM fallback.
function _paintEnemyBody(ctx, type, radius, color) {
    setGlow(ctx, color, 10);

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (type === 'air') {
        clearGlow(ctx);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(0, 20, radius/2, 0, Math.PI*2);
        ctx.fill();
        setGlow(ctx, color, 10);
        ctx.fillStyle = '#0f172a';

        ctx.beginPath();
        ctx.moveTo(0, -radius*1.5);
        ctx.lineTo(radius, 0);
        ctx.lineTo(0, radius*1.5);
        ctx.lineTo(-radius, 0);
        ctx.closePath();
    } else if (type === 'fast') {
        // Triangle
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(-radius, radius);
        ctx.lineTo(-radius, -radius);
        ctx.closePath();
    } else if (type === 'tank') {
        // Square
        ctx.fillRect(-radius, -radius, radius*2, radius*2);
        ctx.strokeRect(-radius, -radius, radius*2, radius*2);
    } else if (type === 'cutter') {
        // Diamond with a tread bar — the off-road shortcut crawler.
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius, 0);
        ctx.lineTo(0, -radius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(-radius * 0.6, -2, radius * 1.2, 4);
    } else {
        // Circle
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI*2);
    }

    // tank and cutter fill/stroke inside their own branches.
    if (type !== 'tank' && type !== 'cutter') {
        ctx.fill();
        ctx.stroke();
    }

    clearGlow(ctx);
}

// Persistent enemy markers (shield ring / splitter dot / boss glow ring),
// painted at the origin so they can be BAKED into the cached sprite alongside
// the body. Drawn live each frame, these vector strokes re-antialiased at
// sub-pixel positions and shimmered as the enemy moved — special mobs looked
// jittery even after the body went sub-pixel-smooth. Baked = blit-smooth.
function _paintEnemyMarkers(ctx, radius, shielded, splitter, isBoss) {
    if (shielded) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#60e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    if (splitter) {
        ctx.save();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    if (isBoss) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        setGlow(ctx, '#a855f7', 14);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        clearGlow(ctx);
        ctx.restore();
    }
}

function drawEnemy(ctx, x, y, radius, type, healthRatio, isSlowed = false, burning = false, shielded = false, splitter = false, isBoss = false) {
    // Neon glow
    let color = type === 'fast' ? '#fde047' : type === 'tank' ? '#f87171' : type === 'air' ? '#60a5fa' : type === 'cutter' ? '#fb923c' : '#a7f3d0';
    if (isSlowed) color = '#38bdf8'; // Override glow to light blue when frozen

    // Static body+glow via the sprite cache; one drawImage instead of
    // a shadowBlur'd path per enemy per frame. Box is sized to cover
    // the air silhouette (±1.5r) + ground shadow (y≈20) + glow bleed.
    const side = radius * 3 + 44;
    // Bake the persistent markers into the cached sprite (keyed by their flags)
    // so they blit sub-pixel-smooth with the body instead of shimmering as
    // live per-frame vector strokes.
    const flags = (shielded ? 'S' : '') + (splitter ? 'P' : '') + (isBoss ? 'B' : '');
    const sprite = getSprite('e|' + type + '|' + color + '|' + radius + '|' + flags, side, side,
        (sctx) => { _paintEnemyBody(sctx, type, radius, color); _paintEnemyMarkers(sctx, radius, shielded, splitter, isBoss); });
    if (sprite) {
        blitSprite(ctx, sprite, x, y, 0, true);   // smooth=true: enemies move, so blit sub-pixel (no jitter)
    } else {
        ctx.save();
        ctx.translate(x, y);
        _paintEnemyBody(ctx, type, radius, color);
        _paintEnemyMarkers(ctx, radius, shielded, splitter, isBoss);
        ctx.restore();
    }

    // Health bar — dynamic, stays live (two rects, no glow).
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-radius, -radius - 8, radius*2, 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(-radius, -radius - 8, radius*2 * healthRatio, 4);
    ctx.restore();

    // M3: Flamethrower burn overlay — orange translucent aura.
    if (burning) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(251, 146, 60, 0.6)';
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Shield / splitter / boss markers are now BAKED into the cached sprite
    // (see _paintEnemyMarkers) so they move sub-pixel-smooth with the body.
}

// Variant types share their base's silhouette but get a different accent
// colour and a small marker ring so they're visually distinct on the field.
const TOWER_VARIANT_RENDER = {
    basic_cryo:      { base: 'basic',    accent: '#67e8f9' },  // icy cyan
    sniper_scatter:  { base: 'sniper',   accent: '#fbbf24' },  // amber
    rapid_flame:     { base: 'rapid',    accent: '#f97316' },  // ember orange
    laser_pulse:     { base: 'laser',    accent: '#d8b4fe' },  // light violet
    rocket_cluster:  { base: 'rocket',   accent: '#facc15' },  // yellow tip
    flak_emp:        { base: 'flak',     accent: '#22d3ee' },  // emp teal
    electric_plasma: { base: 'electric', accent: '#a855f7' },  // plasma purple
    silo_orbital:    { base: 'silo',     accent: '#fde68a' },  // orbital glow
    income_research: { base: 'income',   accent: '#34d399' },  // research green
};

function _paintTowerBase(ctx, size) {
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size/2 - 4, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
}

// Turret painter — type-specific silhouette with glow, drawn around
// (0,0) UNROTATED (rotation is applied at blit time, where it's a
// cheap bitmap rotate instead of a re-blurred path).
function _paintTurret(ctx, renderType, color, size) {
    setGlow(ctx, color, 8);
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    if (renderType === 'basic') {
        // Round body, one barrel
        ctx.beginPath();
        ctx.arc(0, 0, size/4, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -3, size/2, 6);
    } else if (renderType === 'sniper') {
        // Square body, long barrel
        ctx.fillRect(-size/4, -size/4, size/2, size/2);
        ctx.strokeRect(-size/4, -size/4, size/2, size/2);
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -2, size/2 + 8, 4);
    } else if (renderType === 'rapid') {
        ctx.beginPath();
        ctx.moveTo(size/2, 0);
        ctx.lineTo(-size/4, size/3);
        ctx.lineTo(-size/4, -size/3);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fill();
    } else if (renderType === 'laser') {
        ctx.beginPath();
        ctx.moveTo(size/2.5, 0);
        ctx.lineTo(0, size/3.5);
        ctx.lineTo(-size/2.5, 0);
        ctx.lineTo(0, -size/3.5);
        ctx.closePath();
        ctx.stroke();
    } else if (renderType === 'rocket') {
        ctx.fillRect(-size/3, -size/4, size/1.5, size/2);
        ctx.strokeRect(-size/3, -size/4, size/1.5, size/2);

        ctx.fillStyle = color;
        ctx.fillRect(-size/2, -size/6, size/4, size/8);
        ctx.fillRect(-size/2, size/12, size/4, size/8);
    } else if (renderType === 'flak') {
        ctx.beginPath();
        ctx.arc(0, 0, size/3, 0, Math.PI*2);
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -size/6, size/2, size/8); 
        ctx.fillRect(0, size/16, size/2, size/8);
    } else if (renderType === 'electric') {
        // Static type — drawTower blits it with angle 0.
        ctx.beginPath();
        ctx.arc(0, 0, size/3, 0, Math.PI*2);
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, size/4, 0, Math.PI*2);
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, size/10, 0, Math.PI*2);
        ctx.fill();
    } else if (renderType === 'silo') {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            let a = i * Math.PI / 3;
            if (i === 0) ctx.moveTo(Math.cos(a) * size/2, Math.sin(a) * size/2);
            else ctx.lineTo(Math.cos(a) * size/2, Math.sin(a) * size/2);
        }
        ctx.closePath();
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, size/4, 0, Math.PI*2);
        ctx.fill();
        
        ctx.fillStyle = '#000';
        for (let i = 0; i < 3; i++) {
            let a = i * Math.PI * 2 / 3;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * size/6, Math.sin(a) * size/6, 2, 0, Math.PI*2);
            ctx.fill();
        }
    } else if (renderType === 'income') {
        // Static type — drawTower blits it with angle 0.
        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(0, -size/2.5);
        ctx.lineTo(size/2.5, 0);
        ctx.lineTo(0, size/2.5);
        ctx.lineTo(-size/2.5, 0);
        ctx.closePath();
        ctx.stroke();
        // ¢ symbol inside
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.floor(size/2.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        clearGlow(ctx);
        ctx.fillText('¢', 0, 1);
    }

    clearGlow(ctx);
}

function drawTower(ctx, x, y, type, size, angle, level = 1) {
    // Resolve variant → base type so the existing per-shape renderers
    // (basic / sniper / …) light up for variants too. Without this,
    // anything ending in _cryo / _scatter / _flame / etc. fell through
    // every branch and rendered as just the empty base ring.
    // Tech-tree extra towers reuse an existing turret SHAPE (no new painter)
    // but get their own accent COLOR so they read as distinct towers.
    const SHAPE_ALIAS = { mortar: 'silo', disruptor: 'electric', railgun: 'sniper', beacon: 'income' };
    const ALT_COLOR   = { mortar: '#fb923c', disruptor: '#2dd4bf', railgun: '#93c5fd', beacon: '#fde68a' };
    const variant = TOWER_VARIANT_RENDER[type];
    const renderType = variant ? variant.base : (SHAPE_ALIAS[type] || type);
    const baseColor = renderType === 'sniper' ? '#f472b6' : renderType === 'rapid' ? '#a3e635' : renderType === 'laser' ? '#8b5cf6' : renderType === 'rocket' ? '#f97316' : renderType === 'electric' ? '#0ea5e9' : renderType === 'flak' ? '#60a5fa' : renderType === 'silo' ? '#ef4444' : renderType === 'income' ? '#fbbf24' : '#38bdf8';
    const color = variant ? variant.accent : (ALT_COLOR[type] || baseColor);
    const cx = x + size / 2, cy = y + size / 2;
    // electric / income don't track targets — their sprite is blitted
    // unrotated (the old code rotated then counter-rotated).
    const turretAngle = (renderType === 'electric' || renderType === 'income') ? 0 : angle;

    // Base plate (shared by every tower) + per-type turret, both from
    // the sprite cache. Turret box pads for the longest barrel
    // (sniper: size/2 + 8) plus glow bleed.
    const basePlate = getSprite('twr-base|' + size, size + 8, size + 8,
        (sctx) => _paintTowerBase(sctx, size));
    const turret = getSprite('twr|' + type + '|' + size, size + 40, size + 40,
        (sctx) => _paintTurret(sctx, renderType, color, size));
    if (basePlate && turret) {
        blitSprite(ctx, basePlate, cx, cy);
        blitSprite(ctx, turret, cx, cy, turretAngle);
    } else {
        // No-DOM fallback: paint directly (node test stubs).
        ctx.save();
        ctx.translate(cx, cy);
        _paintTowerBase(ctx, size);
        if (turretAngle) ctx.rotate(turretAngle);
        _paintTurret(ctx, renderType, color, size);
        ctx.restore();
    }

    const baseType = variant ? variant.base : type;
    const mastery = window.save && window.save.towerMastery && window.save.towerMastery[baseType];
    if (mastery && mastery.milestones && mastery.milestones.m2) {
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        setGlow(ctx, '#fbbf24', 8);
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
        ctx.stroke();
        clearGlow(ctx);
        ctx.restore();
    }

    // Draw level indicator
    if (level > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        setGlow(ctx, 'black', 2);
        ctx.fillText('★' + level, x + size/2, y + size - 2);
        clearGlow(ctx);
    }
}

function _paintProjectile(ctx, type, color, size) {
    setGlow(ctx, color, 10);
    ctx.fillStyle = color;

    if (type === 'rocket') {
        ctx.beginPath();
        ctx.moveTo(size*1.5, 0);
        ctx.lineTo(-size, size/1.5);
        ctx.lineTo(-size, -size/1.5);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.moveTo(-size, size/3);
        ctx.lineTo(-size - size*1.2, 0);
        ctx.lineTo(-size, -size/3);
        ctx.closePath();
        ctx.fill();
    } else if (type === 'laser-pulse') {
        // Fat glowing plasma bolt with white hot core
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.4, 0, Math.PI*2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI*2);
        ctx.fill();
    }

    clearGlow(ctx);
}

function drawProjectile(ctx, x, y, type, angle = 0) {
    const color = type === 'sniper' ? '#f472b6' : type === 'rapid' ? '#a3e635' : type === 'rocket' ? '#f97316' : type === 'flak' ? '#60a5fa' : type === 'laser-pulse' ? '#d8b4fe' : '#38bdf8';
    const size = type === 'sniper' ? 4 : type === 'rapid' ? 2 : type === 'rocket' ? 5 : type === 'flak' ? 3 : type === 'laser-pulse' ? 6 : 3;

    // Tiny glow-heavy shapes at potentially hundreds per frame — the
    // textbook sprite-cache case. Rocket tail extends ~2.2× size
    // backwards; box pads for that plus glow bleed.
    const side = size * 6 + 24;
    const sprite = getSprite('p|' + type, side, side,
        (sctx) => _paintProjectile(sctx, type, color, size));
    if (sprite) {
        blitSprite(ctx, sprite, x, y, type === 'rocket' ? angle : 0);
    } else {
        ctx.save();
        ctx.translate(x, y);
        if (type === 'rocket') ctx.rotate(angle);
        _paintProjectile(ctx, type, color, size);
        ctx.restore();
    }
}
