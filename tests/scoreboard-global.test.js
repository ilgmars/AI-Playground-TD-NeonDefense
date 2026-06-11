// Regression: scoreboard is global-only with an autopilot filter,
// reachable from the main menu, and the global board re-syncs in the
// background once a minute over MQTT.
//
// Three concerns covered:
//   1. menu button — clicking #menu-scores-btn opens #scoreboard-screen.
//      Earlier revision wired it but the click sometimes did nothing
//      because of layout interactions on small viewports; this test
//      asserts the DOM-level open works.
//   2. global-only rendering — there is NO local/global toggle in the
//      overlay any more. Both autopilot and cheated filter checkboxes
//      exist and gate the rendered rows.
//   3. minute-cadence sync — the global board fires a periodic
//      broadcast (setInterval 60000) so any peer that joined after
//      our last publish gets caught up. We can't wait 60 s in a unit
//      test, so we exercise the broadcastNow() hook to prove the
//      mechanism delivers and the listener side merges as expected.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8782;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 1 — Node logic: minute-cadence sync via broadcastNow.
    // ─────────────────────────────────────────────────────────────────
    // Two GlobalBoard instances connected through the mock hub. Peer A
    // publishes a run; the periodic broadcast is what catches Peer B up
    // (publish() itself is throttled per-peer). We assert:
    //   * the periodic broadcast (broadcastNow) carries the full local
    //     board (not just the last publish);
    //   * Peer B's onUpdate fires with the new entry.
    {
        const transport = require('../src/multiplayer/transport.js');
        const globalMod = require('../src/multiplayer/global.js');
        const hub = transport.createMockHub();
        const A = globalMod.createGlobalBoard();
        const B = globalMod.createGlobalBoard();
        A.attach(hub.join('NEON23', 'A'));
        B.attach(hub.join('NEON23', 'B'));
        let bSeen = null;
        let bUpdates = 0;
        B.onUpdate(snap => { bSeen = snap; bUpdates++; });

        A.publish({ name: 'ALICE', wave: 12, tier: 2, autopilot: false });
        ok('Peer B receives Peer A\'s entry via publish path',
            bSeen && bSeen.some(e => e.name === 'ALICE'));

        // Add a second entry to A's local board (publish() throttle
        // would normally drop it). The periodic background broadcast
        // delivers the FULL set so B catches up next tick.
        bSeen = null;
        A.publish({ name: 'A2', wave: 50, tier: 2 });    // throttled
        // (publish returned {ok:false,reason:'throttled'} but the
        // local merge already ran, so A.snapshot() has both entries.)
        const aBoard = A.snapshot();
        ok('local merge happens even when wire publish is throttled',
            aBoard.length >= 2);

        // Force the periodic broadcast. The receiver-side anti-flood
        // ignores back-to-back messages from the same peer within
        // 100 ms — sleep past that window so the catch-up actually
        // lands. In production the periodic interval is 60 s, so this
        // is never an issue at runtime.
        await new Promise(r => setTimeout(r, 130));
        const sent = A.broadcastNow();
        ok('broadcastNow delivers the full local board',  sent >= 2);
        const bSnap = B.snapshot();
        ok('Peer B board has 2 entries after catch-up',  bSnap.length >= 2);
        ok('Peer B onUpdate fired on catch-up',          bUpdates >= 2);
        const seenName = bSnap.map(e => e.name);
        ok('Peer B has both ALICE and A2 after catch-up',
            seenName.indexOf('ALICE') >= 0 && seenName.indexOf('A2') >= 0);

        // Verify the cadence is exactly 60 s in production (we set the
        // setInterval). The constant lives in the module body; pull
        // it via the start() interval observation through a clock
        // monkey-patch.
        const PUBLISH_THROTTLE_MS = globalMod.PUBLISH_THROTTLE_MS;
        ok('PUBLISH_THROTTLE_MS = 5 s (per-peer publish throttle)',
            PUBLISH_THROTTLE_MS === 5000);

        A.stop(); B.stop();
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 2 — Setinterval cadence: 60 s exactly.
    // ─────────────────────────────────────────────────────────────────
    {
        const transport = require('../src/multiplayer/transport.js');
        const globalMod = require('../src/multiplayer/global.js');
        // Stub setInterval so we can see what interval the board sets.
        const origSetInterval = global.setInterval;
        let observedInterval = null;
        global.setInterval = (fn, ms) => {
            if (observedInterval === null) observedInterval = ms;
            return origSetInterval(fn, ms);
        };
        const board = globalMod.createGlobalBoard({
            transportFactory: (room, id) => {
                const hub = transport.createMockHub();
                return hub.join(room, id);
            },
        });
        // start() is async — await it.
        return (async () => {
            await board.start();
            global.setInterval = origSetInterval;
            // Bandwidth: the heartbeat slowed from 60 s to 10 min and
            // became novelty-gated (see global-sync-triggers.test.js)
            // once the broker-retained snapshot took over newcomer
            // catch-up. Assert the configured cadence so an accidental
            // return to chatty sync fails loudly.
            ok('periodic broadcast cadence matches HEARTBEAT_MS (10 min, novelty-gated)',
                observedInterval === globalMod.HEARTBEAT_MS && globalMod.HEARTBEAT_MS === 600000,
                observedInterval);
            board.stop();
            return runBrowserPhase();
        })();
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 3 — Browser: menu button + filter UI.
    // ─────────────────────────────────────────────────────────────────
    async function runBrowserPhase() {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const t = m.text();
            if (/mqtt|websocket|nostr|hivemq|emqx|relay\.verified-nostr/i.test(t)) return;
            errs.push('console: ' + t);
        });
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        await page.evaluate(() => { localStorage.setItem('neonPlayerName', 'ME'); });

        // ── Button position: after the daily-challenge button ─────────
        const order = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('#main-menu .menu-buttons button'));
            return buttons.map(b => b.id);
        });
        const dailyIdx  = order.indexOf('menu-dailyseed-btn');
        const scoresIdx = order.indexOf('menu-scores-btn');
        ok('SCOREBOARD button is in main menu',  scoresIdx >= 0);
        ok('SCOREBOARD button is AFTER daily-challenge button',
            dailyIdx >= 0 && scoresIdx > dailyIdx);

        // ── Button click opens the overlay ───────────────────────────
        await page.evaluate(() => document.getElementById('menu-scores-btn').click());
        await page.waitForTimeout(150);
        const open = await page.evaluate(() =>
            !document.getElementById('scoreboard-screen').classList.contains('hidden'));
        ok('SCOREBOARD button click OPENS the overlay', open === true);

        // ── No local/global toggle in the markup ─────────────────────
        const hasToggle = await page.evaluate(() =>
            !!document.getElementById('sb-source-local')
            || !!document.getElementById('sb-source-global'));
        ok('local/global toggle is gone',  hasToggle === false);

        // ── Filter checkboxes are visible and choosable ──────────────
        const filters = await page.evaluate(() => ({
            autoChecked:   document.getElementById('sb-hide-autopilot').checked,
            cheatChecked:  document.getElementById('sb-hide-cheated').checked,
            autoVisible:   document.getElementById('sb-hide-autopilot').offsetParent !== null,
            cheatVisible:  document.getElementById('sb-hide-cheated').offsetParent !== null,
        }));
        ok('autopilot filter checkbox is visible',    filters.autoVisible === true);
        ok('cheated filter checkbox is visible',      filters.cheatVisible === true);
        ok('autopilot filter unchecked by default',   filters.autoChecked === false);
        ok('cheated filter CHECKED by default',       filters.cheatChecked === true);

        // ── Filter behaviour: toggling Hide Autopilot hides AUTO runs.
        await page.evaluate(() => {
            save.highScores['a0'] = [
                { name: 'HUMAN', wave: 50, tier: 0, autopilot: false },
                { name: 'BOT',   wave: 90, tier: 0, autopilot: true  },
            ];
            NeonSave.write(save);
            window.openScoreboard();
        });
        await page.waitForTimeout(150);
        const allShown = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#sb-list .sb-row'));
            return rows.map(r => r.querySelector('.sb-name').textContent.trim());
        });
        ok('both runs visible with filter OFF',
            allShown.some(n => n.includes('HUMAN')) &&
            allShown.some(n => n.includes('BOT')));

        await page.evaluate(() => {
            const cb = document.getElementById('sb-hide-autopilot');
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
        });
        await page.waitForTimeout(80);
        const hiddenAuto = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#sb-list .sb-row'));
            return rows.map(r => r.querySelector('.sb-name').textContent.trim());
        });
        ok('toggling Hide Autopilot removes BOT row',
            hiddenAuto.some(n => n.includes('HUMAN')) &&
            !hiddenAuto.some(n => n.includes('BOT')));

        // Persisted to localStorage so it sticks across reloads.
        const persisted = await page.evaluate(() =>
            localStorage.getItem('neonSbHideAuto'));
        ok('autopilot filter choice persisted in localStorage',
            persisted === '1');

        ok('no JS errors', errs.length === 0, errs.join(' / '));

        await browser.close();
        server.kill();
        console.log(`\nSCOREBOARD GLOBAL: ${pass} pass, ${fail} fail`);
        process.exit(fail === 0 ? 0 : 1);
    }
})().catch(e => { console.error(e); process.exit(1); });
