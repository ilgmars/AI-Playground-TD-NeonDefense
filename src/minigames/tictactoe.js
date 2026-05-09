// Bonus tic-tac-toe minigame. Triggered every 15 waves (skipped if autopilot is on).
// Win = +300¢. 10-second timer. Pauses the game while open; restores state on close.
(function () {
    const WIN_LINES = [
        [0,1,2],[3,4,5],[6,7,8],
        [0,3,6],[1,4,7],[2,5,8],
        [0,4,8],[2,4,6]
    ];

    let board = null;
    let timerId = null;
    let active = false;
    let prevState = null;

    function checkWin(b, p) { return WIN_LINES.some(line => line.every(idx => b[idx] === p)); }
    function isFull(b)      { return b.every(c => c !== ''); }

    function findWinningMove(b, p) {
        for (let i = 0; i < 9; i++) {
            if (b[i] !== '') continue;
            const t = b.slice();
            t[i] = p;
            if (checkWin(t, p)) return i;
        }
        return -1;
    }

    // Strong-but-beatable AI: win > block > center > corner > side.
    function aiMove() {
        let m = findWinningMove(board, 'O');
        if (m === -1) m = findWinningMove(board, 'X');
        if (m === -1 && board[4] === '') m = 4;
        if (m === -1) for (const c of [0, 2, 6, 8]) if (board[c] === '') { m = c; break; }
        if (m === -1) for (let i = 0; i < 9; i++) if (board[i] === '') { m = i; break; }
        if (m !== -1) board[m] = 'O';
    }

    function render() {
        const cells = document.querySelectorAll('#mg-board .mg-cell');
        for (let i = 0; i < 9; i++) {
            cells[i].textContent = board[i] || '';
            cells[i].className = 'mg-cell' +
                (board[i] === 'X' ? ' x' : board[i] === 'O' ? ' o' : '') +
                (board[i] !== '' ? ' filled' : '');
        }
    }

    function setStatus(text) { document.getElementById('mg-status').textContent = text; }

    function buildBoardEls() {
        const root = document.getElementById('mg-board');
        root.innerHTML = '';
        for (let i = 0; i < 9; i++) {
            const cell = document.createElement('div');
            cell.className = 'mg-cell';
            cell.dataset.idx = String(i);
            cell.addEventListener('click', () => onCellClick(i));
            root.appendChild(cell);
        }
    }

    function onCellClick(i) {
        if (!active) return;
        if (board[i] !== '') return;
        board[i] = 'X';
        render();
        if (checkWin(board, 'X')) return finish('win');
        if (isFull(board))        return finish('draw');
        // AI takes a brief beat so the player sees their move land first.
        setTimeout(() => {
            if (!active) return;
            aiMove();
            render();
            if (checkWin(board, 'O')) return finish('lose');
            if (isFull(board))        return finish('draw');
            setStatus('Your turn');
        }, 220);
    }

    function finish(result) {
        if (!active) return;
        active = false;
        if (timerId) { clearInterval(timerId); timerId = null; }
        let msg;
        if (result === 'win') {
            msg = '✔ YOU WIN — +300¢';
            if (window.game) {
                window.game.money += 300;
                window.game.uiDirty = true;
            }
        } else if (result === 'lose')   msg = '✖ AI WINS';
        else if (result === 'draw')     msg = '— DRAW';
        else                            msg = '⏱ TIME UP';
        setStatus(msg);
        // Close button visible after the round ends so the player can dismiss
        // before auto-close.
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.classList.remove('hidden');
        setTimeout(close, 1600);
    }

    function open() {
        if (active) return;
        active = true;
        board = ['', '', '', '', '', '', '', '', ''];
        const overlay = document.getElementById('minigame');
        overlay.classList.remove('hidden');
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.classList.add('hidden');
        buildBoardEls();
        render();
        setStatus('Your turn — you are X');

        // Pause the underlying run while the minigame is open.
        if (window.game && window.game.state === 'playing') {
            prevState = window.game.state;
            window.game.state = 'paused';
        } else { prevState = null; }

        let remaining = 10;
        document.getElementById('mg-timer').textContent = String(remaining);
        timerId = setInterval(() => {
            remaining--;
            document.getElementById('mg-timer').textContent = String(Math.max(0, remaining));
            if (remaining <= 0) finish('timeout');
        }, 1000);
    }

    function close() {
        if (timerId) { clearInterval(timerId); timerId = null; }
        active = false;
        document.getElementById('minigame').classList.add('hidden');
        if (prevState && window.game && window.game.state === 'paused') {
            window.game.state = prevState;
        }
        prevState = null;
        if (window.game) window.game.uiDirty = true;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const closeBtn = document.getElementById('mg-close');
        if (closeBtn) closeBtn.addEventListener('click', close);
        const skipBtn  = document.getElementById('mg-skip');
        if (skipBtn)  skipBtn.addEventListener('click', () => finish('timeout'));
    });

    window.NeonMinigame = { open, close, isActive: () => active };
})();
