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
        // Default mode is now coop. This scenario tests race, so
        // pick race explicitly.
        await page.selectOption('#mp-mode-select', 'race');
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

    // ── 7. CO-OP waitroom act test ────────────────────────────────────
    // Coop mode uses a sessionStorage + reload handshake so the
    // pre-boot RNG can install before aegis.js runs. The flow:
    //   1. fill nick + room + select 'coop' → click JOIN ROOM
    //   2. page reloads
    //   3. waitroom overlay appears, broadcasts {kind:'wr', p:nick}
    //   4. OTHER player must show up in #mp-waitroom-peers
    //   5. both click READY → run starts
    //
    // The historical bug: waitroom announced ONCE at entry, before the
    // WebRTC data channel was open, so the message went into the void
    // and the other player never appeared. Now there's a 2 s
    // re-announce loop + onPeerJoin re-announce, both of which this
    // test exercises.
    const coopRoom = 'C' + Math.random().toString(36).slice(2, 7).toUpperCase()
                          .replace(/[01OI]/g, '2');
    console.log('\n  coop room code:', coopRoom);

    async function spawnCoopClient(nick) {
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
            if (/mqtt|trystero|websocket|mosquitto|hivemq|emqx/i.test(t)) return;
            errs.push('console: ' + t);
        });
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.click('#menu-multiplayer-btn');
        await page.waitForTimeout(150);
        // Explicitly select coop in case the default selection logic
        // hasn't fired by the time we get here.
        await page.selectOption('#mp-mode-select', 'coop');
        await page.fill('#mp-nick-input', nick);
        await page.fill('#mp-room-input', coopRoom);
        // Coop JOIN persists sessionStorage and reloads. We catch the
        // navigation so we can keep working with the same page.
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('#mp-join-btn'),
        ]).catch(() => { /* in some flows reload is instant; ignore */ });
        // After reload, init runs, resumeMultiplayerIfPending detects
        // sessionStorage, calls joinCoop + openCoopWaitroom. Wait for
        // the waitroom overlay to appear.
        try {
            await page.waitForSelector('#mp-waitroom:not(.hidden)', { timeout: 20000 });
        } catch (_) { /* surface in the assertions below */ }
        return { ctx, page, errs };
    }

    console.log('  spawning ALICE (coop)...');
    const aliceCoop = await spawnCoopClient('ALICE');
    console.log('  spawning BOB (coop)...');
    const bobCoop   = await spawnCoopClient('BOB');

    async function waitroomNames(page) {
        return await page.evaluate(() => {
            return Array.from(document.querySelectorAll('#mp-waitroom-peers .mp-waitroom-peer .mp-waitroom-peer-name'))
                .map(el => el.textContent.trim());
        });
    }

    // Poll for up to 25 s — periodic 2 s re-announce + a few WebRTC
    // handshake seconds means the other peer should land in well
    // under that.
    const t1 = Date.now();
    let aliceSeesBobCoop = false, bobSeesAliceCoop = false;
    while (Date.now() - t1 < 25000) {
        const a = await waitroomNames(aliceCoop.page);
        const b = await waitroomNames(bobCoop.page);
        if (a.includes('BOB'))   aliceSeesBobCoop = true;
        if (b.includes('ALICE')) bobSeesAliceCoop = true;
        if (aliceSeesBobCoop && bobSeesAliceCoop) break;
        await new Promise(r => setTimeout(r, 500));
    }
    console.log('  coop ALICE waitroom names:', await waitroomNames(aliceCoop.page));
    console.log('  coop BOB   waitroom names:', await waitroomNames(bobCoop.page));
    ok('coop: ALICE waitroom shows BOB within 25 s', aliceSeesBobCoop);
    ok('coop: BOB   waitroom shows ALICE within 25 s', bobSeesAliceCoop);

    // ── 8. Both clients click READY → BOTH runs start. ────────────────
    // Regression: pre-fix only ONE side started. The multi-strategy
    // adapter's 3 s identical-payload dedupe was eating the periodic
    // wr re-announce, so if a single MQTT delivery was missed the
    // late peer never learned the other was ready. Fixed by adding a
    // monotonic seq + timestamp to every wr broadcast so successive
    // announces have unique content.
    if (aliceSeesBobCoop && bobSeesAliceCoop) {
        await aliceCoop.page.click('#mp-waitroom-ready');
        await bobCoop.page.click('#mp-waitroom-ready');
        // Wait UP TO 15 s for BOTH waitrooms to hide. If one side
        // hangs we want the diagnostic to tell us WHICH side, not
        // just "one of them" — Promise.all + individual catches
        // preserves per-peer error info.
        const waitForWaitroomHidden = (page, who) =>
            page.waitForSelector('#mp-waitroom.hidden', { timeout: 15000 })
                .then(() => ({ who, ok: true }))
                .catch(e => ({ who, ok: false, err: e.message }));
        const closeResults = await Promise.all([
            waitForWaitroomHidden(aliceCoop.page, 'ALICE'),
            waitForWaitroomHidden(bobCoop.page,   'BOB'),
        ]);
        for (const r of closeResults) {
            if (!r.ok) console.log(`  ${r.who} waitroom did NOT close: ${r.err}`);
        }
        const aliceClosed = closeResults.find(r => r.who === 'ALICE').ok;
        const bobClosed   = closeResults.find(r => r.who === 'BOB').ok;
        ok('coop: ALICE waitroom closed within 15 s', aliceClosed === true);
        ok('coop: BOB   waitroom closed within 15 s', bobClosed === true);

        // game.state should be 'playing' or 'paused' on both.
        const stateOf = (page) => page.evaluate(() =>
            window.game ? window.game.state : null);
        const aliceState = await stateOf(aliceCoop.page);
        const bobState   = await stateOf(bobCoop.page);
        console.log('  coop final state: ALICE=', aliceState, 'BOB=', bobState);
        ok('coop: ALICE run started after both READY',
           aliceState === 'playing' || aliceState === 'paused');
        ok('coop: BOB   run started after both READY',
           bobState === 'playing' || bobState === 'paused');

        // Both peers should land on the SAME world seed (coop is
        // a SHARED room; race-mode behaviour already tested above).
        if (aliceClosed && bobClosed) {
            const seeds = await Promise.all([
                aliceCoop.page.evaluate(() => window.game && window.game.seed),
                bobCoop.page.evaluate(() => window.game && window.game.seed),
            ]);
            ok('coop: both peers share the same world seed',
               typeof seeds[0] === 'number' && seeds[0] === seeds[1]);
        }
    } else {
        skipMsg('coop READY → run start (waitroom never paired peers)');
    }

    ok('coop ALICE: no unexpected JS errors', aliceCoop.errs.length === 0);
    if (aliceCoop.errs.length) aliceCoop.errs.forEach(e => console.log('  COOP ALICE err:', e));
    ok('coop BOB:   no unexpected JS errors', bobCoop.errs.length === 0);
    if (bobCoop.errs.length) bobCoop.errs.forEach(e => console.log('  COOP BOB err:', e));

    await aliceCoop.ctx.close();
    await bobCoop.ctx.close();
    await browser.close();
    server.kill();

    console.log(`\nMP LOBBY ACT: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
