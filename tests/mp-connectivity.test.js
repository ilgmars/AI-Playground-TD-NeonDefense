// Real end-to-end multiplayer connectivity test.
//
// Spins up TWO Playwright browser contexts, points each at the live
// game, joins the same Trystero room from both, and verifies that
// messages sent from one peer actually reach the other across the
// real BitTorrent-tracker handshake.
//
// Unlike the unit tests in tests/multiplayer.test.js (mocked
// WebSocket / fetch / RTCPeerConnection), this test uses the actual
// network. It will fail in environments that block:
//   * esm.sh / jsdelivr CDNs
//   * WebTorrent tracker WSS endpoints
//   * outbound UDP needed for WebRTC ICE
//
// To keep CI green under network blackouts we run the connectivity
// PROBE first; if the probe declares the environment unreachable, the
// test SKIPS the live half (logs "skip" and exits 0) instead of
// false-failing.
//
// Usage: `node tests/mp-connectivity.test.js`
// Optional env: NEON_MP_FORCE=1 — fail (instead of skip) when probe
// says network is blocked. Use locally to assert real reachability.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8867;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    let pass = 0, fail = 0, skip = 0;
    function ok(name, cond)   { if (cond) { console.log('ok',   name); pass++; } else { console.log('FAIL', name); fail++; } }
    function skipMsg(name)    { console.log('skip', name); skip++; }

    const browser = await chromium.launch({ headless: true });

    // ── 1. Connectivity probe in a single page ────────────────────────
    // Catches the "CDN blocked / trackers blocked / no WebRTC" cases
    // BEFORE we try the two-client exchange. This is exactly what the
    // lobby's TEST CONNECTION button would tell the player.
    let probeReport;
    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        probeReport = await page.evaluate(async () => {
            if (!window.NeonMP || !NeonMP.connectivity) return { verdict: 'no-module' };
            return await NeonMP.connectivity.probe({ timeoutMs: 8000 });
        });
        await ctx.close();
    }
    console.log('  probe verdict:', probeReport.verdict);
    if (probeReport.cdn)     console.log('  probe cdn:', probeReport.cdn.anyOk, '(', probeReport.cdn.results.map(r => r.ok).join(',') ,')');
    if (probeReport.tracker) console.log('  probe trackers:', probeReport.tracker.okCount, '/', probeReport.tracker.total);
    if (probeReport.webrtc)  console.log('  probe webrtc:', probeReport.webrtc.ok, 'stun:', probeReport.webrtc.stunWorks);

    ok('probe module is available', probeReport.verdict !== 'no-module');
    ok('probe returns a verdict',   typeof probeReport.verdict === 'string');

    const reachable = probeReport.verdict === 'ok';
    const force = process.env.NEON_MP_FORCE === '1';

    if (!reachable && !force) {
        console.log('  (network unreachable — skipping live two-client test; set NEON_MP_FORCE=1 to fail instead)');
        skipMsg('two-client message exchange (network blocked)');
        skipMsg('two-client peer-join callback fires (network blocked)');
    } else {
        if (!reachable && force) {
            ok('NEON_MP_FORCE: probe says reachable', reachable);
        }

        // ── 2. Two-client end-to-end exchange ─────────────────────────
        // Each context joins the SAME room and sends one message; the
        // other context should receive it within a timeout window.
        // Room code is randomised per run so concurrent CI runs don't
        // bleed into each other.
        const roomCode = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[01OI]/g, '2');

        async function makeClient(nick) {
            const ctx = await browser.newContext();
            const page = await ctx.newPage();
            const errs = [];
            page.on('pageerror', e => errs.push(e.message));
            await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(500);
            // Use the real Trystero adapter — joinRoom() does the actual
            // WebTorrent handshake. We collect messages + peer-join
            // events on window so the test can poll for them.
            await page.evaluate(async ({ code, nick }) => {
                window.__test_msgs   = [];
                window.__test_joins  = [];
                window.__test_status = [];
                const room = await NeonMP.trystero.joinRoom(code, nick, {
                    onStatus: (s) => window.__test_status.push(s),
                });
                window.__test_room = room;
                room.onMessage((msg, from) => {
                    window.__test_msgs.push({ msg, from });
                });
                room.onPeerJoin((info) => {
                    window.__test_joins.push(info);
                });
            }, { code: roomCode, nick });
            return { ctx, page, errs };
        }

        console.log('  joining room:', roomCode);
        const alice = await makeClient('ALICE');
        const bob   = await makeClient('BOB');

        // Tracker handshake takes a few seconds in the wild — wait up
        // to 25s for at least one peer-join event on either side.
        const WAIT_FOR_PEER_MS = 25000;
        const t0 = Date.now();
        let connected = false;
        while (Date.now() - t0 < WAIT_FOR_PEER_MS) {
            const a = await alice.page.evaluate(() => window.__test_joins.length);
            const b = await bob.page.evaluate(() => window.__test_joins.length);
            if (a >= 1 && b >= 1) { connected = true; break; }
            await new Promise(r => setTimeout(r, 500));
        }
        ok('two-client peer-join callback fires within 25s', connected);

        if (connected) {
            // Alice sends → Bob receives.
            await alice.page.evaluate(() => window.__test_room.send({ kind: 'probe', body: 'hello-bob' }));
            // Wait up to 5s for the message to land.
            let bobGot = null;
            for (let i = 0; i < 50; i++) {
                const m = await bob.page.evaluate(() => window.__test_msgs.find(x => x.msg && x.msg.body === 'hello-bob'));
                if (m) { bobGot = m; break; }
                await new Promise(r => setTimeout(r, 100));
            }
            ok('two-client: BOB received ALICE\'s message', !!bobGot);

            // Bob → Alice, opposite direction.
            await bob.page.evaluate(() => window.__test_room.send({ kind: 'probe', body: 'hello-alice' }));
            let aliceGot = null;
            for (let i = 0; i < 50; i++) {
                const m = await alice.page.evaluate(() => window.__test_msgs.find(x => x.msg && x.msg.body === 'hello-alice'));
                if (m) { aliceGot = m; break; }
                await new Promise(r => setTimeout(r, 100));
            }
            ok('two-client: ALICE received BOB\'s message', !!aliceGot);
        } else {
            skipMsg('two-client message round-trip (no peer connection)');
        }

        // Clean up: leave the room before context close so the tracker
        // doesn't hold the slot.
        try { await alice.page.evaluate(() => window.__test_room.leave()); } catch (_) {}
        try { await bob.page.evaluate(() => window.__test_room.leave()); } catch (_) {}
        await alice.ctx.close();
        await bob.ctx.close();
    }

    await browser.close();
    server.kill();

    console.log(`\nMP CONNECTIVITY: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
