// Bonus minigame: OVERCLOCK — a press-your-luck reactor.
// Triggered every 15 waves (skipped if autopilot is on). Pauses the run
// while open; restores state on close. Same NeonMinigame API as before so
// main.js wiring is unchanged.
//
// Rules: a strip of cells, 2 of them hidden SURGE cells. Tap a cell to
// charge — a safe cell adds an escalating amount to the pot; the reward
// grows the deeper you push. BANK any time to keep the pot. Hit a SURGE
// and the pot is lost. Clear every safe cell for a MAX OVERCLOCK bonus.
// Pure chance + one decision (push vs bank) — short and tense.
(function () {
    const CELLS   = 6;
    const SURGES  = 2;
    // Cumulative reward for the 1st..4th safe reveal. Bank early for a
    // little, ride it out for a lot. Max possible pot = 1000 (+250 bonus).
    const STEP    = [100, 175, 275, 450];
    const MAX_BONUS = 250;
    const TIME_SEC = 12;

    let surge = [];        // boolean[CELLS]
    let revealed = [];     // boolean[CELLS]
    let safeFound = 0;
    let pot = 0;
    let timerId = null;
    let active = false;
    let ended = false;
    let prevState = null;

    function setStatus(t) { const e = document.getElementById('mg-status'); if (e) e.textContent = t; }
    function setPot(v) { const e = document.getElementById('mg-pot-val'); if (e) e.textContent = String(v); }

    function buildCells() {
        const root = document.getElementById('mg-board');
        root.innerHTML = '';
        for (let i = 0; i < CELLS; i++) {
            const cell = document.createElement('div');
            cell.className = 'mg-cell';
            cell.dataset.idx = String(i);
            cell.textContent = '?';
            cell.addEventListener('click', () => onPick(i));
            root.appendChild(cell);
        }
    }

    function paint(revealAll) {
        const cells = document.querySelectorAll('#mg-board .mg-cell');
        for (let i = 0; i < CELLS; i++) {
            const c = cells[i];
            const show = revealAll || revealed[i];
            c.className = 'mg-cell' + (show ? (surge[i] ? ' surge' : ' safe') : '');
            c.textContent = !show ? '?' : (surge[i] ? '⚡' : '✓');
        }
    }

    function onPick(i) {
        if (!active || ended || revealed[i]) return;
        revealed[i] = true;

        if (surge[i]) {
            pot = 0;
            return finish('bust');
        }

        pot += STEP[Math.min(safeFound, STEP.length - 1)];
        safeFound++;
        setPot(pot);
        paint(false);

        if (safeFound >= CELLS - SURGES) {
            pot += MAX_BONUS;
            setPot(pot);
            return finish('max');
        }
        setStatus(`Charged ${pot}¢ — push your luck or BANK it.`);
    }

    function bank() {
        if (!active || ended) return;
        if (pot <= 0) { setStatus('Nothing banked yet — tap a cell.'); return; }
        finish('bank');
    }

    function finish(result) {
        if (ended) return;
        ended = true;
        active = false;
        if (timerId) { clearInterval(timerId); timerId = null; }
        paint(true);

        let msg;
        if (result === 'bust') {
            msg = '⚡ SURGE! Reactor blew — pot lost.';
        } else {
            const won = pot;
            if (won > 0 && window.game) {
                window.game.money += won;
                window.game.uiDirty = true;
            }
            msg = result === 'max'
                ? `★ MAX OVERCLOCK — banked ${won}¢`
                : `✔ Banked ${won}¢`;
        }
        setStatus(msg);

        const bankBtn = document.getElementById('mg-bank');
        if (bankBtn) bankBtn.disabled = true;
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.classList.remove('hidden');
        setTimeout(close, 1700);
    }

    function open() {
        if (active) return;
        active = true;
        ended = false;
        pot = 0;
        safeFound = 0;
        revealed = new Array(CELLS).fill(false);
        surge = new Array(CELLS).fill(false);
        // Place SURGES at distinct random positions.
        let placed = 0;
        while (placed < SURGES) {
            const idx = Math.floor(Math.random() * CELLS);
            if (!surge[idx]) { surge[idx] = true; placed++; }
        }

        document.getElementById('minigame').classList.remove('hidden');
        const bankBtn = document.getElementById('mg-bank');
        if (bankBtn) bankBtn.disabled = false;
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.classList.add('hidden');
        buildCells();
        paint(false);
        setPot(0);
        setStatus('Tap a cell to start charging…');

        if (window.game && window.game.state === 'playing') {
            prevState = window.game.state;
            window.game.state = 'paused';
        } else { prevState = null; }

        let remaining = TIME_SEC;
        document.getElementById('mg-timer').textContent = String(remaining);
        timerId = setInterval(() => {
            remaining--;
            document.getElementById('mg-timer').textContent = String(Math.max(0, remaining));
            // Time up: auto-bank whatever is safe (a small mercy — still
            // chance-y because you may have banked too cautiously, or not yet).
            if (remaining <= 0) finish(pot > 0 ? 'bank' : 'bust');
        }, 1000);
    }

    function close() {
        if (timerId) { clearInterval(timerId); timerId = null; }
        active = false;
        ended = false;
        document.getElementById('minigame').classList.add('hidden');
        if (prevState && window.game && window.game.state === 'paused') {
            window.game.state = prevState;
        }
        prevState = null;
        if (window.game) window.game.uiDirty = true;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const bankBtn = document.getElementById('mg-bank');
        if (bankBtn) bankBtn.addEventListener('click', bank);
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        const skipBtn = document.getElementById('mg-skip');
        if (skipBtn) skipBtn.addEventListener('click', () => finish(pot > 0 ? 'bank' : 'bust'));
    });

    window.NeonMinigame = { open, close, isActive: () => active };
})();
