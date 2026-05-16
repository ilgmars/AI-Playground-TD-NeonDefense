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
    
    // Path inner glowing border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
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

function drawEnemy(ctx, x, y, radius, type, healthRatio, isSlowed = false, burning = false, shielded = false, splitter = false, isBoss = false) {
    ctx.save();
    ctx.translate(x, y);
    
    // Neon glow
    let color = type === 'fast' ? '#fde047' : type === 'tank' ? '#f87171' : type === 'air' ? '#60a5fa' : '#a7f3d0';
    if (isSlowed) color = '#38bdf8'; // Override glow to light blue when frozen
    
    setGlow(ctx, color, 10);

    // Body
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
    } else {
        // Circle
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI*2);
    }
    
    if (type !== 'tank') {
        ctx.fill();
        ctx.stroke();
    }
    
    clearGlow(ctx);

    // Health bar
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

    // M3: Shielded enemy — cyan ring overlay when shield is intact.
    if (shielded) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#60e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // M3: Splitter marker — orange inner dot.
    if (splitter) {
        ctx.save();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // M3: Boss enemy — purple glow ring overlay.
    if (isBoss) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        setGlow(ctx, '#a855f7', 14);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
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

function drawTower(ctx, x, y, type, size, angle, level = 1) {
    // Resolve variant → base type so the existing per-shape renderers
    // (basic / sniper / …) light up for variants too. Without this,
    // anything ending in _cryo / _scatter / _flame / etc. fell through
    // every branch and rendered as just the empty base ring.
    const variant = TOWER_VARIANT_RENDER[type];
    const renderType = variant ? variant.base : type;

    ctx.save();
    ctx.translate(x + size/2, y + size/2);

    // Base
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, size/2 - 4, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // Turret rotation
    ctx.rotate(angle);

    const baseColor = renderType === 'sniper' ? '#f472b6' : renderType === 'rapid' ? '#a3e635' : renderType === 'laser' ? '#8b5cf6' : renderType === 'rocket' ? '#f97316' : renderType === 'electric' ? '#0ea5e9' : renderType === 'flak' ? '#60a5fa' : renderType === 'silo' ? '#ef4444' : renderType === 'income' ? '#fbbf24' : '#38bdf8';
    const color = variant ? variant.accent : baseColor;

    setGlow(ctx, color, 8);
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;

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
        ctx.rotate(-angle); // Make it static, no rotation
        
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
        ctx.rotate(-angle); // static, no rotation
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
    
    ctx.restore();

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

function drawProjectile(ctx, x, y, type, angle = 0) {
    let color = type === 'sniper' ? '#f472b6' : type === 'rapid' ? '#a3e635' : type === 'rocket' ? '#f97316' : type === 'flak' ? '#60a5fa' : type === 'laser-pulse' ? '#d8b4fe' : '#38bdf8';
    let size = type === 'sniper' ? 4 : type === 'rapid' ? 2 : type === 'rocket' ? 5 : type === 'flak' ? 3 : type === 'laser-pulse' ? 6 : 3;
    
    ctx.save();
    ctx.translate(x, y);
    if (type === 'rocket') ctx.rotate(angle);
    
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
    
    ctx.restore();
}
