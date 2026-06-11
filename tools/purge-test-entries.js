#!/usr/bin/env node
// One-off maintenance: remove test-suite junk names from the LIVE
// NEON23 retained scoreboard snapshot, keeping every real entry.
//
//   node tools/purge-test-entries.js
//
// Why this exists: before the hermetic-test gate in global.js, the
// Playwright suites ran against the real broker and published their
// fixture entries (HUMAN / BOT / TEST) into the retained snapshot
// that real players receive. This script republishes the snapshot
// without them, plus self-expiring kill-overrides (31-day-old
// timestamps, +1 wave) so clients that already merged the junk sweep
// it on their next render.
//
// NOTE: this WRITES shared production state — run deliberately.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const JUNK_NAMES = ['HUMAN', 'BOT', 'TEST'];

(async () => {
    const PORT = 8799;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    const res = await page.evaluate(async (junkList) => {
        const JUNK = new Set(junkList);
        const room = await NeonMP.mqttDirect.joinRoom('NEON23');
        const seen = new Map();
        room.onMessage((msg) => {
            if (msg && msg.kind === 'gl' && Array.isArray(msg.entries)) {
                for (const e of msg.entries) {
                    const k = e.n + '|' + (e.r || 0);
                    const prev = seen.get(k);
                    if (!prev || e.w > prev.w) seen.set(k, e);
                }
            }
        });
        await new Promise(r => setTimeout(r, 6000));   // collect retained + live
        const all = Array.from(seen.values());
        const clean = all.filter(e => !JUNK.has(e.n));
        const oldT = Date.now() - 31 * 24 * 60 * 60 * 1000;
        const killers = all.filter(e => JUNK.has(e.n))
            .map(e => ({ n: e.n, w: Math.min(e.w + 1, 9999), r: e.r || 0, t: oldT }));
        const packet = { kind: 'gl', entries: clean.concat(killers).slice(0, 50) };
        room.send(packet);          // live clients replace junk → sweep on render
        room.sendRetained(packet);  // future joiners get the clean snapshot
        await new Promise(r => setTimeout(r, 1500));
        room.leave();

        // Verify with a brand-new connection.
        const check = await NeonMP.mqttDirect.joinRoom('NEON23');
        const after = [];
        check.onMessage((msg) => {
            if (msg && msg.kind === 'gl' && Array.isArray(msg.entries)) after.push(...msg.entries);
        });
        await new Promise(r => setTimeout(r, 5000));
        check.leave();
        const junkLeft = after.filter(e => JUNK.has(e.n) && e.t > Date.now() - 30 * 864e5);
        return { kept: clean.map(e => e.n + ':' + e.w + ':a' + (e.r || 0)), killed: killers.map(e => e.n), junkLeft };
    }, JUNK_NAMES);
    console.log(JSON.stringify(res, null, 1));
    await browser.close();
    server.kill();
    process.exit(res.junkLeft.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
