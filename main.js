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

    document.getElementById('sell-btn').addEventListener('click', () => {
        if (game.selectedTower) {
            game.money += game.selectedTower.getSellValue();
            game.towers = game.towers.filter(t => t !== game.selectedTower);
            game.selectPlacedTower(null);
            game.updateUI();
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

    canvas.addEventListener('pointerdown', (e) => {
        if (game.state !== 'playing') return;

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
            game.selectPlacedTower(clicked || null);
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

        if (game.state === 'playing' && selectedTowerType) {
            const c = Math.floor(mousePos.x / TILE_SIZE);
            const r = Math.floor(mousePos.y / TILE_SIZE);
            
            const ctx = game.ctx;
            const px = c * TILE_SIZE;
            const py = r * TILE_SIZE;

            if (game.map.isBuildable(c, r)) {
                const ranges = { basic: 100, sniper: 250, rapid: 80, laser: 150, rocket: 200, electric: 120, silo: 100 };
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

window.selectTower = function(type) {
    if (game.state !== 'playing') return;
    
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

document.addEventListener('DOMContentLoaded', init);
