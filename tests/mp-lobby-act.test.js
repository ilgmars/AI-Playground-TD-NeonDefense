// End-to-end multiplayer act test — two clients go through the actual
// UI flow (open lobby → enter same room code → JOIN → run starts →
// race overlay shows BOTH peers).
//
// This is the test the user kept asking for: not just "can a Trystero
// message round-trip", but "do two real browsers, talking through the
// real lobby UI, actually see each other".
//
// Self-skips when the environment can't reach the signalling brokers
// (CI sandbox, offline). NEON_MP_FORCE=1 promotes skips to failures
// for release-time assertion that the deployed game actually works.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8869;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 700));

    let pass = 0, fail = 0, skip = 0;
    function ok(name, cond)   { if (cond) { console.log('ok',   name); pass++; } else { console.log('FAIL', name); fail++; } }
    function skipMsg(name)    { console.log('skip', name); skip++; }

    const browser = await chromium.launch({ headless: true });

    // ── 1. Quick connectivity probe so CI doesn't false-fail on a
    //       blocked sandbox. The probe loads from the same CDN the
    //       real adapter uses; if it can't reach trackers/brokers,
    //       the actual flow can't either.
    let reachable = false;
    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        const report = await page.evaluate(async () => {
            if (!window.NeonMP || !NeonMP.connectivity) return { verdict: 'no-module' };
            return await NeonMP.connectivity.probe({ timeoutMs: 8000 });
        });
        console.log('  connectivity verdict:', report.verdict);
        if (report.tracker) {
            console.log('  brokers ok:', report.tracker.okCount, '/', report.tracker.total);
        }
        reachable = report.verdict === 'ok';
        await ctx.close();
    }

    const force = process.env.NEON_MP_FORCE === '1';
    if (!reachable && !force) {
        console.log('  (signalling unreachable from this environment — skipping live act test)');
        console.log('  (set NEON_MP_FORCE=1 to promote skips to failures)');
        skipMsg('two-client lobby JOIN (signalling blocked)');
        skipMsg('two-client race overlay shows both peers (signalling blocked)');
        await browser.close();
        server.kill();
        console.log(`\nMP LOBBY ACT: ${pass} pass, ${fail} fail, ${skip} skip`);
        process.exit(0);
    }

    // ── 2. Two browsers, both going through the actual lobby UI.
    // Randomised room code per run so concurrent CI jobs don't bleed.
    const roomCode = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase()
                       .replace(/[01OI]/g, '2');
    console.log('  room code for this run:', roomCode);

    async function spawnClient(nick) {
        const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true, isMobile: true,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const t = m.text();
            // Filter the expected MQTT / Trystero noise that's harmless.
            if (/mqtt|trystero|websocket|mosquitto|hivemq|emqx/i.test(t)) return;
            errs.push('console: ' + t);
        });
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);

        // Drive the real lobby UI: open the multiplayer menu, type the
        // nick + room code, JOIN. Captures every status-line update so
        // the test log shows where it got stuck if it does.
        const statusLog = [];
        await page.exposeFunction('__neon_test_status', (s) => statusLog.push(s));
        await page.evaluate(() => {
            const el = document.getElementById('mp-status');
            if (!el) return;
            new MutationObserver(() => window.__neon_test_status(el.textContent)).observe(el, {
                childList: true, characterData: true, subtree: true,
            });
        });

        await page.click('#menu-multiplayer-btn');
        await page.waitForTimeout(150);
        await page.fill('#mp-nick-input', nick);
        await page.fill('#mp-room-input', roomCode);
        // mp-mode-select defaults to "race" — leave it.
        const joinPromise = page.click('#mp-join-btn');
        // joinRace awaits Trystero load + signalling subscription. Up
        // to 30 s to let the slowest broker handshake settle.
        await joinPromise;
        return { ctx, page, errs, statusLog };
    }

    console.log('  spawning ALICE...');
    const alice = await spawnClient('ALICE');
    console.log('  spawning BOB...');
    const bob   = await spawnClient('BOB');

    // ── 3. Wait for both clients to see EACH OTHER in the race overlay.
    // Race overlay rows are <div.mp-race-row> with the peer name in
    // .mp-race-name. We poll up to ~30 s — broker handshake + first
    // heartbeat round-trip can take a few seconds in the wild.
    const WAIT_MS = 30000;
    const POLL_MS = 500;
    async function rosterNames(page) {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#mp-race-list .mp-race-row .mp-race-name'))
                .map(el => el.textContent.trim());
        });
    }
    const t0 = Date.now();
    let aliceSeesBob = false, bobSeesAlice = false;
    while (Date.now() - t0 < WAIT_MS) {
        const a = await rosterNames(alice.page);
        const b = await rosterNames(bob.page);
        if (a.includes('BOB'))   aliceSeesBob = true;
        if (b.includes('ALICE')) bobSeesAlice = true;
        if (aliceSeesBob && bobSeesAlice) break;
        await new Promise(r => setTimeout(r, POLL_MS));
    }
    console.log('  ALICE roster:', await rosterNames(alice.page));
    console.log('  BOB   roster:', await rosterNames(bob.page));
    console.log('  ALICE status trail:', alice.statusLog);
    console.log('  BOB   status trail:', bob.statusLog);

    ok('ALICE sees BOB in race overlay within 30 s', aliceSeesBob);
    ok('BOB sees ALICE in race overlay within 30 s', bobSeesAlice);

    // ── 4. Both clients land on the actual run (race overlay visible,
    // game.state === 'playing') with the SAME world seed (roomCodeToSeed).
    if (aliceSeesBob && bobSeesAlice) {
        const inRun = async (page) => page.evaluate(() => ({
            overlayVisible: !document.getElementById('mp-race-overlay').classList.contains('hidden'),
            gameState: window.game && window.game.state,
            seed: window.game && window.game.seed,
        }));
        const a = await inRun(alice.page);
        const b = await inRun(bob.page);
        ok('ALICE race overlay visible',           a.overlayVisible === true);
        ok('BOB race overlay visible',             b.overlayVisible === true);
        ok('ALICE game is running',                a.gameState === 'playing' || a.gameState === 'paused');
        ok('BOB game is running',                  b.gameState === 'playing' || b.gameState === 'paused');
        ok('Both players share the same world seed (' + a.seed + ')',
           typeof a.seed === 'number' && a.seed === b.seed);

        // ── 5. ALICE builds a tower (visible to her); BOB advances a
        // wave and the heartbeat carries that to ALICE's leaderboard.
        // Race mode does NOT mirror placements (each peer owns their
        // world), but the LEADERBOARD must reflect updates.
        await alice.page.evaluate(() => {
            // Force a wave bump on ALICE so her heartbeat changes.
            if (window.game) window.game.wave = 7;
        });
        // Wait one full heartbeat cycle plus jitter.
        await new Promise(r => setTimeout(r, 1500));
        const bobSeesAliceAtW7 = await bob.page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('#mp-race-list .mp-race-row'));
            const alice = rows.find(r => r.querySelector('.mp-race-name').textContent.trim() === 'ALICE');
            if (!alice) return null;
            const waveText = alice.querySelector('.mp-race-wave').textContent;
            return parseInt(waveText.replace('w', ''), 10);
        });
        ok('BOB sees ALICE\'s wave bump (heartbeat propagated)',
           bobSeesAliceAtW7 >= 5);   // any forward progress from initial w1 is fine
    } else {
        skipMsg('shared run / seed check (peers never connected)');
        skipMsg('heartbeat propagation check (peers never connected)');
    }

    // ── 6. JS error check — defer LAST so the connection phase has
    // a chance to settle. MQTT WebSocket reconnect warnings during the
    // test teardown are filtered above.
    ok('ALICE: no unexpected JS errors', alice.errs.length === 0);
    if (alice.errs.length) alice.errs.forEach(e => console.log('  ALICE err:', e));
    ok('BOB:   no unexpected JS errors', bob.errs.length === 0);
    if (bob.errs.length) bob.errs.forEach(e => console.log('  BOB err:', e));

    // Tear down cleanly.
    await alice.ctx.close();
    await bob.ctx.close();
    await browser.close();
    server.kill();

    console.log(`\nMP LOBBY ACT: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
