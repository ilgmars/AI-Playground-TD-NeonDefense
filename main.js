let game;
let selectedTowerType = null;
let mousePos = { x: 0, y: 0 };
let gameSpeed = 1;

function resizeCanvas() {
    const canvas = document.getElementById('game-canvas');
    const container = document.getElementById('game-container');
    if (!canvas || !container) return;

    const containerAspect = container.clientWidth / container.clientHeight;
    const gameAspect = window.COLS / window.ROWS;

    let cssWidth, cssHeight;

    if (containerAspect > gameAspect) {
        cssHeight = container.clientHeight;
        cssWidth = container.clientHeight * gameAspect;
    } else {
        cssWidth = container.clientWidth;
        cssHeight = container.clientWidth / gameAspect;
    }

    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    // High-DPI display scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

    const logicalWidth = window.COLS * window.TILE_SIZE;
    window.RENDER_SCALE = (cssWidth * dpr) / logicalWidth;
    
    // Force immediate redraw if paused
    if (typeof game !== 'undefined' && game.state !== 'playing') {
        game.draw();
    }
}

window.addEventListener('resize', resizeCanvas);

function init() {
    const canvas = document.getElementById('game-canvas');
    
    // Fixed logical resolution for perfect game balance
    window.COLS = 24;
    window.ROWS = 16;
    window.TILE_SIZE = 40;
    
    resizeCanvas(); // Scale to fit screen and set High-DPI bounds

    game = new Game(canvas);

    game.draw();
    game.updateUI();

    document.getElementById('start-btn').addEventListener('click', () => {
        document.getElementById('start-screen').classList.add('hidden');
        game.start();
    });

    document.getElementById('speed-btn').addEventListener('click', () => {
        gameSpeed *= 2;
        if (gameSpeed > 16) gameSpeed = 1;
        document.getElementById('speed-display').textContent = gameSpeed + 'X';
    });
    document.getElementById('pause-btn').addEventListener('click', () => {
        togglePause();
    });

    function togglePause() {
        if (game.state === 'playing') {
            game.state = 'paused';
            document.getElementById('pause-display').textContent = 'ON';
            document.getElementById('pause-display').style.color = '#ef4444';
            document.getElementById('pause-display').style.textShadow = '0 0 10px rgba(239,68,68,0.4)';
        } else if (game.state === 'paused') {
            game.state = 'playing';
            document.getElementById('pause-display').textContent = 'OFF';
            document.getElementById('pause-display').style.color = 'var(--text-muted)';
            document.getElementById('pause-display').style.textShadow = 'none';
        }
    }

    document.getElementById('autopilot-btn').addEventListener('click', () => {
        game.autopilot = !game.autopilot;
        const display = document.getElementById('autopilot-display');
        if (game.autopilot) {
            display.textContent = 'ON';
            display.classList.add('on');
        } else {
            display.textContent = 'OFF';
            display.classList.remove('on');
        }
    });

    document.getElementById('sound-btn').addEventListener('click', () => {
        const isOn = SoundFX.toggle();
        const display = document.getElementById('sound-display');
        if (isOn) {
            display.textContent = 'ON';
            display.classList.add('on');
        } else {
            display.textContent = 'OFF';
            display.classList.remove('on');
        }
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
        if (game.state === 'playing') {
            game.state = 'paused';
            document.getElementById('restart-confirm').classList.remove('hidden');
        }
    });

    function restartGame() {
        document.getElementById('restart-confirm').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('upgrade-menu').classList.add('hidden');
        
        const canvas = document.getElementById('game-canvas');
        resizeCanvas();

        game = new Game(canvas);
        game.start();
        
        gameSpeed = 1;
        document.getElementById('speed-display').textContent = '1X';
        
        const autoEl = document.getElementById('autopilot-display');
        autoEl.textContent = 'OFF';
        autoEl.classList.remove('on');
    }

    document.getElementById('confirm-yes').addEventListener('click', restartGame);
    document.getElementById('game-over-restart').addEventListener('click', restartGame);

    const scoresList = document.getElementById('scores-list');
    const playerNameInput = document.getElementById('player-name');
    const submitScoreBtn = document.getElementById('submit-score');

    window.loadScores = function() {
        let scores = JSON.parse(localStorage.getItem('neonDefenseScores') || '[]');
        scores.sort((a, b) => b.wave - a.wave);
        scoresList.innerHTML = '';
        if (scores.length === 0) {
            scoresList.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.9rem;">NO DATA YET</div>';
        }
        scores.slice(0, 5).forEach((s, i) => {
            let div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '4px 0';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            div.innerHTML = `<span style="color:#fff;">#${i+1} ${s.name}</span> <span style="color:#a3e635;">WAVE ${s.wave}</span>`;
            scoresList.appendChild(div);
        });
    }

    submitScoreBtn.addEventListener('click', () => {
        let name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            let scores = JSON.parse(localStorage.getItem('neonDefenseScores') || '[]');
            scores.push({ name: name, wave: game.wave });
            localStorage.setItem('neonDefenseScores', JSON.stringify(scores));
            document.getElementById('score-entry').style.display = 'none';
            window.loadScores();
        }
    });

    document.getElementById('confirm-no').addEventListener('click', () => {
        document.getElementById('restart-confirm').classList.add('hidden');
        game.state = 'playing';
    });

    let sellTimeout = null;
    document.getElementById('sell-btn').addEventListener('click', (e) => {
        if (!game.selectedTowers || game.selectedTowers.length === 0) return;
        let btn = e.currentTarget;
        
        if (btn.dataset.confirm === 'true') {
            let totalSell = 0;
            for (let t of game.selectedTowers) {
                totalSell += t.getSellValue();
                game.towers = game.towers.filter(tower => tower !== t);
            }
            game.money += totalSell;
            game.selectPlacedTower(null);
            game.updateUI();
            
            btn.dataset.confirm = 'false';
            clearTimeout(sellTimeout);
        } else {
            btn.dataset.confirm = 'true';
            btn.innerHTML = 'CONFIRM SELL?';
            clearTimeout(sellTimeout);
            sellTimeout = setTimeout(() => {
                btn.dataset.confirm = 'false';
                if (game.selectedTowers && game.selectedTowers.length > 0) {
                    let totalSell = game.selectedTowers.reduce((sum, current) => sum + current.getSellValue(), 0);
                    btn.innerHTML = `SELL <span class="cost" id="sell-value">${totalSell}¢</span>`;
                }
            }, 3000);
        }
    });

    window.addEventListener('keydown', (e) => {
        // Space to pause/unpause
        if (e.code === 'Space' && (game.state === 'playing' || game.state === 'paused')) {
            e.preventDefault();
            togglePause();
            return;
        }
        
        // ESC to close menus or cancel building
        if (e.key === 'Escape') {
            // Close upgrade menu
            document.getElementById('upgrade-menu').classList.add('hidden');
            // Cancel tower building
            if (selectedTowerType) {
                selectTower(null);
            }
            return;
        }
        
        if (game.state !== 'playing') return;
        
        // Upgrades 1-3
        if (e.key >= '1' && e.key <= '3' && game.selectedTowers && game.selectedTowers.length > 0) {
            let idx = parseInt(e.key) - 1;
            game.buyUpgrade(idx);
        } 
        // Build 1-8
        else if (e.key >= '1' && e.key <= '8') {
            const towers = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo'];
            let idx = parseInt(e.key) - 1;
            selectTower(towers[idx]);
        }
    });

    function getCanvasPos(e) {
        const rect = canvas.getBoundingClientRect();
        const logicalWidth = window.COLS * window.TILE_SIZE;
        const logicalHeight = window.ROWS * window.TILE_SIZE;
        
        const scaleX = logicalWidth / rect.width;
        const scaleY = logicalHeight / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    canvas.addEventListener('pointermove', (e) => {
        const pos = getCanvasPos(e);
        mousePos.x = pos.x;
        mousePos.y = pos.y;
    });

    let lastClickTime = 0;
    let lastClickedType = null;
    let lastClickedC = -1;
    let lastClickedR = -1;

    canvas.addEventListener('pointerdown', (e) => {
        if (game.state !== 'playing' && game.state !== 'paused') return;

        // Close menus when clicking on canvas
        document.getElementById('upgrade-menu').classList.add('hidden');

        const pos = getCanvasPos(e);
        const c = Math.floor(pos.x / TILE_SIZE);
        const r = Math.floor(pos.y / TILE_SIZE);

        if (selectedTowerType) {
            if (game.buildTower(c, r, selectedTowerType)) {
                // Success, deselect tower
                selectTower(selectedTowerType); 
            }
        } else {
            // Select placed tower
            let clicked = game.towers.find(t => t.c === c && t.r === r);
            let now = Date.now();
            let isDouble = (now - lastClickTime < 300 && clicked && lastClickedType === clicked.type && lastClickedC === c && lastClickedR === r);
            
            lastClickTime = now;
            
            if (clicked) {
                lastClickedType = clicked.type;
                lastClickedC = c;
                lastClickedR = r;
                
                if (isDouble) {
                    game.selectAllTowersOfType(clicked.type);
                } else {
                    game.selectPlacedTower(clicked);
                }
            } else {
                game.selectPlacedTower(null);
                lastClickedType = null;
            }
        }
    });

    let lastTime = 0;
    function loop(time) {
        requestAnimationFrame(loop);
        
        if (time - lastTime < 16) return;
        lastTime = time;

        for (let i = 0; i < gameSpeed; i++) {
            game.update();
        }
        game.draw();

        if ((game.state === 'playing' || game.state === 'paused') && selectedTowerType) {
            const c = Math.floor(mousePos.x / TILE_SIZE);
            const r = Math.floor(mousePos.y / TILE_SIZE);
            
            const ctx = game.ctx;
            const px = c * TILE_SIZE;
            const py = r * TILE_SIZE;

            if (game.map.isBuildable(c, r)) {
                const ranges = { basic: 100, sniper: 250, rapid: 80, laser: 150, rocket: 200, electric: 120, silo: 100, income: 0 };
                ctx.beginPath();
                ctx.arc(px + TILE_SIZE/2, py + TILE_SIZE/2, ranges[selectedTowerType], 0, Math.PI*2);
                ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.globalAlpha = 0.5;
                drawTower(ctx, px, py, selectedTowerType, TILE_SIZE, 0, 1);
                ctx.globalAlpha = 1.0;
            } else {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    requestAnimationFrame(loop);
}

window.buyPotion = function() {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    game.buyPotion();
}

window.selectTower = function(type) {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    
    document.querySelectorAll('.tower-option').forEach(el => el.classList.remove('selected'));
    
    if (selectedTowerType === type) {
        selectedTowerType = null; 
    } else {
        selectedTowerType = type;
        const el = document.querySelector(`.tower-option[data-type="${type}"]`);
        if (el) el.classList.add('selected');
        game.selectPlacedTower(null); // Deselect any clicked tower
    }
}

// Close menus when clicking outside of them
document.addEventListener('click', (e) => {
    const upgradeMenu = document.getElementById('upgrade-menu');
    const buildMenu = document.getElementById('build-menu');
    const canvas = document.getElementById('game-canvas');
    
    // If upgrade menu is open and click is outside of it, close it
    if (!upgradeMenu.classList.contains('hidden')) {
        if (!upgradeMenu.contains(e.target) && !canvas.contains(e.target)) {
            upgradeMenu.classList.add('hidden');
        }
    }
});

document.addEventListener('DOMContentLoaded', init);



