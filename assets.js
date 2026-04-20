// Procedural assets drawing

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
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/4, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0; // reset
}

function drawSpawnerTile(ctx, x, y, size) {
    drawPathTile(ctx, x, y, size);
    
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#c084fc';
    ctx.shadowBlur = 10;
    
    // Draw a portal/spawner
    ctx.beginPath();
    ctx.arc(x + size/2, y + size/2, size/3, 0, Math.PI*2);
    ctx.stroke();
    
    // Inner pulse
    ctx.fillStyle = 'rgba(192, 132, 252, 0.3)';
    ctx.fill();
    ctx.shadowBlur = 0;
}

// Entity drawing

function drawEnemy(ctx, x, y, radius, type, healthRatio) {
    ctx.save();
    ctx.translate(x, y);
    
    // Neon glow
    let color = type === 'fast' ? '#fde047' : type === 'tank' ? '#f87171' : type === 'air' ? '#60a5fa' : '#a7f3d0';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    
    // Body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    if (type === 'air') {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(0, 20, radius/2, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 10;
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
    
    ctx.shadowBlur = 0;
    
    // Health bar
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-radius, -radius - 8, radius*2, 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(-radius, -radius - 8, radius*2 * healthRatio, 4);
    
    ctx.restore();
}

function drawTower(ctx, x, y, type, size, angle, level = 1) {
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

    let color = type === 'sniper' ? '#f472b6' : type === 'rapid' ? '#a3e635' : type === 'laser' ? '#8b5cf6' : type === 'rocket' ? '#f97316' : type === 'electric' ? '#0ea5e9' : type === 'flak' ? '#60a5fa' : type === 'silo' ? '#ef4444' : '#38bdf8';
    
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    
    if (type === 'basic') {
        // Round body, one barrel
        ctx.beginPath();
        ctx.arc(0, 0, size/4, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -3, size/2, 6);
    } else if (type === 'sniper') {
        // Square body, long barrel
        ctx.fillRect(-size/4, -size/4, size/2, size/2);
        ctx.strokeRect(-size/4, -size/4, size/2, size/2);
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -2, size/2 + 8, 4);
    } else if (type === 'rapid') {
        ctx.beginPath();
        ctx.moveTo(size/2, 0);
        ctx.lineTo(-size/4, size/3);
        ctx.lineTo(-size/4, -size/3);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fill();
    } else if (type === 'laser') {
        ctx.beginPath();
        ctx.moveTo(size/2.5, 0);
        ctx.lineTo(0, size/3.5);
        ctx.lineTo(-size/2.5, 0);
        ctx.lineTo(0, -size/3.5);
        ctx.closePath();
        ctx.stroke();
    } else if (type === 'rocket') {
        ctx.fillRect(-size/3, -size/4, size/1.5, size/2);
        ctx.strokeRect(-size/3, -size/4, size/1.5, size/2);
        
        ctx.fillStyle = color;
        ctx.fillRect(-size/2, -size/6, size/4, size/8);
        ctx.fillRect(-size/2, size/12, size/4, size/8);
    } else if (type === 'flak') {
        ctx.beginPath();
        ctx.arc(0, 0, size/3, 0, Math.PI*2);
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.fillRect(0, -size/6, size/2, size/8); 
        ctx.fillRect(0, size/16, size/2, size/8);
    } else if (type === 'electric') {
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
    } else if (type === 'silo') {
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
    }
    
    ctx.restore();

    // Draw level indicator
    if (level > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 2;
        ctx.fillText('★' + level, x + size/2, y + size - 2);
        ctx.shadowBlur = 0;
    }
}

function drawProjectile(ctx, x, y, type, angle = 0) {
    let color = type === 'sniper' ? '#f472b6' : type === 'rapid' ? '#a3e635' : type === 'rocket' ? '#f97316' : type === 'flak' ? '#60a5fa' : '#38bdf8';
    let size = type === 'sniper' ? 4 : type === 'rapid' ? 2 : type === 'rocket' ? 5 : type === 'flak' ? 3 : 3;
    
    ctx.save();
    ctx.translate(x, y);
    if (type === 'rocket') ctx.rotate(angle);
    
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
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
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI*2);
        ctx.fill();
    }
    
    ctx.restore();
}
