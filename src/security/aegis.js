// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ AEGIS — Neon Defense anti-tamper module                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// > Public-source notice (read this first, future hacker):
// > This file lives on a public GitHub repo and so do all of the keys in
// > it. Aegis is honor-system armour, not cryptography. A determined
// > attacker with the DevTools console can defeat any single check; the
// > point is layered friction with visible consequences. Three independent
// > defences run in parallel:
// >
// >   1. SIGNED SAVES — every localStorage write carries a three-pass
// >      FNV-1a signature in a sibling key. Hand-editing localStorage
// >      without re-signing is flagged on the next load.
// >
// >   2. BEHAVIOUR SENSORS — at boot we snapshot the identities of
// >      Math.random, Date.now, setInterval and a few `Math.*` natives.
// >      A periodic timer notices when any of them gets replaced.
// >
// >   3. STATE AUDIT — Game.money and Game.health are converted to
// >      getter/setter accessors right after construction. A single-write
// >      delta over the legitimate-jump bound is treated as a console
// >      assignment (`game.money = 1e9`).
// >
// > Detection sets `save.cheaterDetected = true`, which onRunEnded reads
// > to withhold meta-XP, mastery XP, loot, and to mark the high-score
// > entry. The flag is sticky (re-signed so it survives reload), but
// > RESET SAVE clears it. If you're reading this trying to crack it:
// > start with sign() below — the layered FNV passes are the easy half;
// > beating the behavioural sensors is the puzzle.

const NeonAegis = (function () {
    // ── Pristine native captures — taken at IIFE eval time. Aegis loads
    //    immediately after config.js (and before save.js), so these are
    //    snapshotted before any later script could swap them out.
    const _imul   = Math.imul;
    const _random = Math.random;
    const _now    = Date.now;
    const _perfNow = (typeof performance !== 'undefined' && performance.now)
        ? performance.now.bind(performance) : null;
    const _setInt = setInterval;
    const _setTimeout = setTimeout;
    const _queueMicrotask = (typeof queueMicrotask === 'function')
        ? queueMicrotask
        : (cb) => Promise.resolve().then(cb);

    let booted = false;
    let lastFlagReason = null;

    // ── Dev-mode capture (anti-bypass) ────────────────────────────────────
    // The dev-mode flag MUST be present in `window.__neonAegisDev === true`
    // at the moment this module's IIFE runs. After that, it's frozen — a
    // player typing `window.__neonAegisDev = true` in the console after the
    // page has loaded changes the property but NOT this captured boolean,
    // so all sensors remain active. The auto-tune harness sets it via
    // `page.addInitScript`, which runs at document-start (before any page
    // script), so the harness path is unaffected.
    const _injectedDev = (typeof window !== 'undefined' && window.__neonAegisDev === true);
    // A small grace window: `enableDevMode()` accepted only while still
    // pre-boot. boot() locks it. Tests / harnesses that load aegis.js then
    // immediately call enableDevMode() are honoured; console users post-
    // boot are not.
    let _laterDev = false;
    let _devLocked = false;

    function isDev() {
        return _injectedDev || _laterDev;
    }
    function enableDevMode() {
        if (_devLocked) return false;
        _laterDev = true;
        return true;
    }

    // ── Signature ──────────────────────────────────────────────────────────
    // FNV-1a — well-distributed 32-bit hash. Three independent passes are
    // folded together to require a non-trivial replication effort.
    function fnv1a(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = _imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }
    function sign(payload) {
        const KA = 'neon|aegis|v2|alpha';
        const KB = 'neon|aegis|v2|beta';
        const KC = 'neon|aegis|v2|gamma';
        const len = payload.length;
        const inner  = fnv1a(KC + payload + KC).toString(36);
        const middle = fnv1a(KA + payload + ':' + inner + ':' + len).toString(36);
        const outer  = fnv1a(KB + middle + ':' + payload + ':' + len + ':' + inner).toString(36);
        return outer + '.' + middle + '.' + inner;
    }
    function verify(payload, sig) {
        if (typeof sig !== 'string' || sig.length === 0) return false;
        return sign(payload) === sig;
    }

    // ── Flag handling ──────────────────────────────────────────────────────
    function flag(reason) {
        if (isDev()) return false;
        if (typeof window === 'undefined') return false;
        lastFlagReason = reason;
        window.__neonAegisLastFlag = reason;
        const save = window.save;
        if (!save || save.cheaterDetected) return false;
        save.cheaterDetected = true;
        save.cheaterReason = reason;
        // Re-sign on a microtask to avoid recursion if we're inside a write.
        _queueMicrotask(() => {
            try { if (typeof NeonSave !== 'undefined') NeonSave.write(save); } catch (_) {}
            try {
                if (typeof game !== 'undefined' && game && typeof updateUI === 'function') game.uiDirty = true;
            } catch (_) {}
        });
        return true;
    }
    function isFlagged(save) {
        return !!(save && save.cheaterDetected);
    }
    function lastFlag() { return lastFlagReason; }

    // ── Behaviour sensors ──────────────────────────────────────────────────
    // We replace Math.random with a wrapper of the SAME native — the
    // identity of the wrapper is unique to this module, so subsequent
    // overrides change `Math.random` to something that isn't us.
    const wrappedRandom = function () { return _random.call(Math); };
    if (typeof Math !== 'undefined') Math.random = wrappedRandom;

    function tickSentinels() {
        if (isDev()) return;
        try {
            if (Math.random !== wrappedRandom) {
                flag('rng-override');
                Math.random = wrappedRandom;    // restore so the cheat stops working
            }
            if (Date.now !== _now) {
                flag('time-override');
                Date.now = _now;
            }
            if (Math.imul !== _imul) {
                flag('imul-override');
                Math.imul = _imul;
            }
        } catch (_) { /* defensive: never throw from a sentinel */ }
    }

    // ── State audit (Game.money / Game.health) ─────────────────────────────
    // `Object.defineProperty` converts the field into an accessor right
    // after the Game constructor finishes. Internal `+=` writes continue
    // to work; any single write with a delta over MAX_DELTA looks like a
    // console assignment and is flagged.
    const MAX_MONEY_DELTA  = 500000;   // single-write spike (1e9 catches; legit waveBonus stays well under)
    const MAX_HEALTH_OVER  = 5;        // small slack for floored arithmetic

    function protectGame(game) {
        if (!game || game.__aegisProtected) return;
        Object.defineProperty(game, '__aegisProtected', { value: true });

        let _money = game.money;
        Object.defineProperty(game, 'money', {
            configurable: true, enumerable: true,
            get() { return _money; },
            set(v) {
                if (!isDev() && typeof v === 'number' && (v - _money) > MAX_MONEY_DELTA) {
                    flag('money-spike');
                }
                _money = v;
            }
        });

        let _health = game.health;
        Object.defineProperty(game, 'health', {
            configurable: true, enumerable: true,
            get() { return _health; },
            set(v) {
                _health = v;
                if (!isDev() && typeof v === 'number' && typeof game.maxHealth === 'number'
                    && v > game.maxHealth + MAX_HEALTH_OVER) {
                    flag('hp-overflow');
                }
            }
        });
    }

    // ── Bootstrap ──────────────────────────────────────────────────────────
    function boot() {
        if (booted) return;
        booted = true;
        _devLocked = true;     // freeze the dev-mode toggle from this point on
        _setInt(tickSentinels, 1200);
    }

    // For tests / inspectability.
    function _internals() { return { _random, _now, _imul, wrappedRandom, MAX_MONEY_DELTA, MAX_HEALTH_OVER }; }

    return {
        boot, sign, verify, flag, isFlagged, lastFlag,
        protectGame, enableDevMode, fnv1a, _internals
    };
})();

if (typeof window !== 'undefined') window.NeonAegis = NeonAegis;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonAegis };
