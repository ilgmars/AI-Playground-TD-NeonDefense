#!/usr/bin/env node
// Diagnostic: REAL two-browser global-scoreboard sync over the REAL
// broker (whatever mqtt-config.js / fallback resolves to). Not part of
// the test suite — run by hand when "scores don't sync" is reported.
//
//   node tools/diag-global-sync.js
//
// Prints: which transport each page picked, broker URL, peer counts,
// and whether a score published on page A lands on page B.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8791;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    const browser = await chromium.launch();
    const pages = [];
    for (const tag of ['A', 'B']) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        page.on('console', m => {
            const t = m.text();
            if (/mqtt|trystero|global|broker/i.test(t)) console.log(`[${tag} console]`, t.slice(0, 200));
        });
        page.on('pageerror', e => console.log(`[${tag} pageerror]`, String(e).slice(0, 200)));
        await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        // Instrument BEFORE the 2 s lazy global start fires: wrap both
        // joinRoom paths to record which transport wins and stash the room.
        await page.evaluate(() => {
            // Localhost pages skip the auto global-sync start (hermetic
            // tests) — this diagnostic explicitly wants the LIVE room.
            window.__neonForceGlobalSync = true;
            window.__diag = { mqttTried: 0, mqttErr: null, trysteroTried: 0, trysteroErr: null, strategy: null };
            const wrap = (obj, key, label) => {
                if (!obj || typeof obj[key] !== 'function') return;
                const orig = obj[key].bind(obj);
                obj[key] = async (...args) => {
                    window.__diag[label + 'Tried']++;
                    try {
                        const room = await orig(...args);
                        if (args[0] === 'NEON23') {
                            window.__diag.strategy = (room && room.strategy) || label;
                            window.__diagRoom = room;
                        }
                        return room;
                    } catch (e) {
                        window.__diag[label + 'Err'] = String(e && e.message || e).slice(0, 300);
                        throw e;
                    }
                };
            };
            wrap(window.NeonMP && NeonMP.mqttDirect, 'joinRoom', 'mqtt');
            wrap(window.NeonMP && NeonMP.trystero,   'joinRoom', 'trystero');
            console.log('relay urls:', JSON.stringify(window.__neonMqttRelayUrls || null));
        });
        pages.push(page);
    }

    // Wait past the 2 s lazy start + connect time.
    await new Promise(r => setTimeout(r, 12000));

    for (let i = 0; i < 2; i++) {
        const d = await pages[i].evaluate(() => window.__diag);
        console.log(`page ${i === 0 ? 'A' : 'B'} transport:`, JSON.stringify(d));
        const pc = await pages[i].evaluate(() =>
            window.__diagRoom && window.__diagRoom.peerCount ? window.__diagRoom.peerCount() : 'n/a');
        console.log(`page ${i === 0 ? 'A' : 'B'} peerCount:`, pc);
    }

    // Live-sync phases run on a THROWAWAY room, never the production
    // NEON23 board — test entries on the real board linger for the
    // full TTL (30 days) and pollute what players see. The transport
    // check above already exercised the real NEON23 join (joining
    // publishes nothing).
    const DIAG_ROOM = 'DIAGRM';
    for (const page of pages) {
        await page.evaluate(async (room) => {
            window.__diagBoard = NeonMP.global.createGlobalBoard({
                transportFactory: () => NeonMP.mqttDirect.joinRoom(room),
            });
            await window.__diagBoard.start();
        }, DIAG_ROOM);
    }

    // Page A publishes a distinctive score.
    const stamp = Date.now();
    const pub = await pages[0].evaluate((t) =>
        window.__diagBoard.publish({ name: 'PROBE SYNC', wave: 777, tier: 0, t }), stamp);
    console.log('A publish result:', JSON.stringify(pub));

    // Poll B for up to 20 s.
    let found = null;
    for (let i = 0; i < 20 && !found; i++) {
        await new Promise(r => setTimeout(r, 1000));
        found = await pages[1].evaluate(() =>
            (window.__diagBoard.snapshot() || []).find(e => e.name === 'PROBE SYNC') || null);
    }
    console.log('B sees PROBE SYNC:', JSON.stringify(found));

    // Also try the reverse direction with broadcastNow (bypasses throttle).
    await pages[1].evaluate((t) =>
        window.__diagBoard.publish({ name: 'PROBE REVERSE', wave: 555, tier: 0, t }), stamp);
    let found2 = null;
    for (let i = 0; i < 15 && !found2; i++) {
        await new Promise(r => setTimeout(r, 1000));
        found2 = await pages[0].evaluate(() =>
            (window.__diagBoard.snapshot() || []).find(e => e.name === 'PROBE REVERSE') || null);
    }
    console.log('A sees PROBE REVERSE:', JSON.stringify(found2));

    // ── Phase 3: NON-OVERLAPPING sessions via the retained snapshot ──
    // Player C publishes and CLOSES THE TAB. Player D opens the game
    // afterwards and must still see C's score. Uses a throwaway room
    // so the production NEON23 retained snapshot isn't polluted with
    // test entries.
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    const pubC = await pageC.evaluate(async (room) => {
        const board = NeonMP.global.createGlobalBoard({
            transportFactory: () => NeonMP.mqttDirect.joinRoom(room),
        });
        await board.start();
        const r = board.publish({ name: 'GHOST RUN', wave: 314, tier: 1, t: Date.now() });
        await new Promise(res => setTimeout(res, 1500));   // let publish hit the broker
        board.stop();
        return r;
    }, DIAG_ROOM);
    console.log('C publish result:', JSON.stringify(pubC));
    await ctxC.close();                                    // C is fully gone
    await new Promise(r => setTimeout(r, 2000));

    const ctxD = await browser.newContext();
    const pageD = await ctxD.newPage();
    await pageD.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    const seenByD = await pageD.evaluate(async (room) => {
        const board = NeonMP.global.createGlobalBoard({
            transportFactory: () => NeonMP.mqttDirect.joinRoom(room),
        });
        await board.start();
        for (let i = 0; i < 15; i++) {
            await new Promise(res => setTimeout(res, 1000));
            const hit = board.snapshot().find(e => e.name === 'GHOST RUN');
            if (hit) { board.stop(); return hit; }
        }
        board.stop();
        return null;
    }, DIAG_ROOM);
    console.log('D (fresh session, C offline) sees GHOST RUN:', JSON.stringify(seenByD));
    await ctxD.close();

    await browser.close();
    server.kill();
    const okFwd = !!found, okRev = !!found2, okRetained = !!seenByD;
    console.log(`\nRESULT: A→B ${okFwd ? 'OK' : 'FAILED'}, B→A ${okRev ? 'OK' : 'FAILED'}, offline-retained ${okRetained ? 'OK' : 'FAILED'}`);
    process.exit(okFwd && okRev && okRetained ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
