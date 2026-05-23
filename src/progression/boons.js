// Roguelike boon picker (endless). Every 10 waves Game sets
// game.pendingBoon; main.js drains it and calls NeonBoons.open(). Pauses
// the run while open and restores state on pick — same contract as
// NeonMinigame so the two never fight over the game state machine.
const NeonBoons = (function () {
    let active = false;
    let prevState = null;

    function close() {
        active = false;
        const overlay = document.getElementById('boon-overlay');
        if (overlay) overlay.classList.add('hidden');
        if (prevState && window.game && window.game.state === 'paused') {
            window.game.state = prevState;
        }
        prevState = null;
        if (window.game) window.game.uiDirty = true;
        if (typeof updateUI === 'function') try { updateUI(); } catch (_) {}
    }

    function pick(boonId) {
        if (!active) return;
        if (window.game) window.game.chooseBoon(boonId);
        // Multiplayer co-op: broadcast the local pick so the peer's
        // simulation applies the same boon. apply() on the remote side
        // also closes their overlay because their chooseBoon path
        // increments game.boons; their pendingBoon/open() check next
        // tick is a no-op. (Mock & race transports both no-op.)
        if (window.__neonMPBroadcast && window.__neonMPBroadcast.boon) {
            try { window.__neonMPBroadcast.boon(boonId); } catch (_) {}
        }
        close();
    }
    // Apply a boon that arrived from a remote co-op peer. Closes any
    // open chooser overlay on the local side so both peers progress
    // out of the boon screen in lockstep.
    function applyRemote(boonId) {
        if (window.game && typeof window.game.boons !== 'undefined') {
            // Don't double-apply if we already picked the same boon.
            if (window.game.boons.indexOf(boonId) >= 0) {
                if (active) close();
                return;
            }
            window.game.chooseBoon(boonId);
        }
        if (active) close();
    }

    function render(choices) {
        const wrap = document.getElementById('boon-choices');
        if (!wrap) return;
        wrap.innerHTML = '';
        for (const b of choices) {
            const card = document.createElement('button');
            card.className = 'boon-card';
            card.innerHTML =
                `<span class="boon-icon">${b.icon || '✦'}</span>` +
                `<span class="boon-name">${b.name}</span>` +
                `<span class="boon-desc">${b.desc}</span>`;
            card.addEventListener('click', () => pick(b.id));
            wrap.appendChild(card);
        }
    }

    // Returns true if a chooser was shown. When the autopilot is driving
    // (or no human is watching) we auto-take the first rolled boon so
    // endless/headless runs keep progressing without blocking.
    function open() {
        if (active) return false;
        const g = window.game;
        if (!g) return false;

        const choices = g.getBoonChoices();
        if (!choices || !choices.length) return false;

        if (g.autopilot) {
            g.chooseBoon(choices[0].id);
            return false;
        }

        active = true;
        if (g.state === 'playing') { prevState = g.state; g.state = 'paused'; }
        else { prevState = null; }

        const sub = document.getElementById('boon-subtitle');
        if (sub) sub.textContent = `Wave ${g.wave} cleared — choose a permanent upgrade`;
        render(choices);
        const overlay = document.getElementById('boon-overlay');
        if (overlay) overlay.classList.remove('hidden');
        return true;
    }

    return { open, close, applyRemote, isActive: () => active };
})();

if (typeof window !== 'undefined') window.NeonBoons = NeonBoons;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonBoons };
