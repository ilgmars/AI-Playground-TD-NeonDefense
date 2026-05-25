// Smoke test: lobby opens, menu button exists, scripts loaded.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', '8861'],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    function ok(name, cond) { if (cond) { console.log('ok', name); pass++; } else { console.log('FAIL', name); fail++; } }

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // Filter out external infrastructure noise: the pre-boot reload
        // triggers the resume flow, which lazy-loads Trystero — its
        // BitTorrent tracker WebSockets fail in headless CI (no cert
        // bundle / blocked network). That noise is unrelated to the
        // game code we're testing.
        if (/tracker\.|trystero|WebSocket connection|esm\.sh|jsdelivr/i.test(t)) return;
        errs.push('console: ' + t);
    });

    await page.goto('http://127.0.0.1:8861/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // NeonMP globals present
    const mp = await page.evaluate(() => {
        return {
            protocol: typeof NeonMP !== 'undefined' && !!NeonMP.protocol,
            race:     typeof NeonMP !== 'undefined' && !!NeonMP.race,
            lobby:    typeof NeonMP !== 'undefined' && !!NeonMP.lobby,
            transport:typeof NeonMP !== 'undefined' && !!NeonMP.transport,
            guard:    typeof NeonMP !== 'undefined' && !!NeonMP.guard,
            trystero: typeof NeonMP !== 'undefined' && !!NeonMP.trystero,
        };
    });
    ok('protocol loaded', mp.protocol);
    ok('race loaded',     mp.race);
    ok('lobby loaded',    mp.lobby);
    ok('transport loaded', mp.transport);
    ok('guard loaded',    mp.guard);
    ok('trystero adapter loaded', mp.trystero);

    // Click MULTIPLAYER button and verify lobby opens
    await page.click('#menu-multiplayer-btn');
    await page.waitForTimeout(150);
    const lobbyVisible = await page.evaluate(() => !document.getElementById('mp-lobby').classList.contains('hidden'));
    ok('lobby overlay opens on click', lobbyVisible === true);

    // NEW CODE produces a code in the room alphabet
    await page.click('#mp-room-new-btn');
    const newCodeOk = await page.evaluate(() =>
        NeonMP.protocol.isValidRoomCode(document.getElementById('mp-room-input').value));
    ok('NEW CODE fills valid room code', newCodeOk === true);

    // BACK returns to main menu
    await page.click('#mp-back-btn');
    await page.waitForTimeout(150);
    const mainBack = await page.evaluate(() => !document.getElementById('main-menu').classList.contains('hidden'));
    ok('BACK returns to main menu', mainBack === true);

    // Race controller wires up against a mocked transport (no real network)
    const raceTest = await page.evaluate(async () => {
        const hub = NeonMP.transport.createMockHub();
        const a = hub.join('NEAN42', 'A');
        const b = hub.join('NEAN42', 'B');
        const updates = [];
        const rB = NeonMP.race.createRace({
            peer: 'BOB', transport: b,
            getGame: () => ({ wave: 1, health: 20, maxHealth: 20, money: 0, score: 0 }),
            heartbeatMs: 9999, // disable timer; we'll tick manually
            now: () => Date.now(),
        });
        rB.onUpdate(s => updates.push(s));
        const rA = NeonMP.race.createRace({
            peer: 'ALICE', transport: a,
            getGame: () => ({ wave: 7, health: 18, maxHealth: 20, money: 333, score: 99 }),
            heartbeatMs: 9999,
            now: () => Date.now(),
        });
        rB.start(); rA.start();
        // Make sure A's first tick reached B.
        const last = updates[updates.length - 1] || { peers: [] };
        const alice = last.peers.find(p => p.peer === 'ALICE');
        rA.stop(); rB.stop();
        return { aliceWave: alice ? alice.w : null, peerCount: last.peers.length };
    });
    ok('browser race ctrl: B sees ALICE w7', raceTest.aliceWave === 7);
    ok('browser race ctrl: two peers in roster', raceTest.peerCount === 2);

    // Re-open lobby, type a known code, hijack joinRoom to skip Trystero,
    // and verify JOIN seeds the world from the code and shows the overlay.
    // Race mode was removed (2026-05-25) — coop is the only run mode.
    // The race CONTROLLER (Phase 5 above) is still used INSIDE coop
    // for the leaderboard HUD, hence kept. But the immediate race
    // JOIN path no longer exists, so the old JOIN end-to-end here is
    // gone. We just verify coop is enabled and selected by default.

    // ── Coop scripts present + dropdown un-disabled ─────────────────
    const coopAvail = await page.evaluate(() => ({
        coopMod:   !!(NeonMP && NeonMP.coop && typeof NeonMP.coop.createCoop === 'function'),
    }));
    ok('NeonMP.coop loaded',   coopAvail.coopMod);
    await page.click('#menu-multiplayer-btn');
    await page.waitForTimeout(150);
    const dropdownState = await page.evaluate(() => {
        const opts = document.querySelectorAll('#mp-mode-select option');
        const out = {};
        opts.forEach(o => out[o.value] = !o.disabled);
        return out;
    });
    ok('coop option un-disabled',   dropdownState.coop === true);
    ok('versus option no longer in lobby', dropdownState.versus === undefined);
    ok('race option no longer in lobby',   dropdownState.race   === undefined);

    // ── Coop in-browser end-to-end ─────────────────────────────────
    const coopE2E = await page.evaluate(() => {
        const hub = NeonMP.transport.createMockHub();
        const a = hub.join('COOP1', 'A');
        const b = hub.join('COOP1', 'B');
        function fakeGame() {
            return {
                money: 1000, health: 20,
                towers: [{ c: 0, r: 0, type: 'basic', level: 0, sold: false }],
                log: [],
                buildTower(c, r, t, opts) {
                    this.money -= 50;
                    this.towers.push({ c, r, type: t });
                    this.log.push({ k: 'build', src: opts && opts.source });
                    return true;
                },
                upgradeTower() { return true; },
                sellTower() { return true; },
                buyPotion(opts) { this.log.push({ k: 'potion', src: opts && opts.source }); return true; },
            };
        }
        const gA = fakeGame();
        const gB = fakeGame();
        const A = NeonMP.coop.createCoop({ peer: 'A', transport: a, getGame: () => gA });
        const B = NeonMP.coop.createCoop({ peer: 'B', transport: b, getGame: () => gB });
        A.start(); B.start();
        A.broadcast({ k: 'build', c: 5, r: 5, t: 'sniper' });
        const res = {
            bTowers: gB.towers.length,
            bMoney:  gB.money,
            bRemoteTag: gB.log[gB.log.length - 1].src,
        };
        A.stop(); B.stop();
        return res;
    });
    ok('browser coop: B saw A\'s build', coopE2E.bTowers === 2);
    ok('browser coop: B money deducted', coopE2E.bMoney === 950);
    ok('browser coop: tagged remote',    coopE2E.bRemoteTag === 'remote');

    // ── Pre-boot hook: reload with sessionStorage primed; the inline
    // <script> in <body> must swap Math.random + set __neonAegisDev.
    await page.evaluate(() => sessionStorage.setItem('neonMP', JSON.stringify({
        mode: 'coop', roomCode: 'NEAN42', nick: 'ALICE', seed: 12345,
    })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const preBoot = await page.evaluate(() => ({
        aegisDev: window.__neonAegisDev === true,
        sessionCleared: sessionStorage.getItem('neonMP') === null,
    }));
    ok('pre-boot set __neonAegisDev=true', preBoot.aegisDev === true);
    ok('resume cleared sessionStorage',    preBoot.sessionCleared === true);

    // No JS errors anywhere
    ok('no JS errors', errs.length === 0);
    if (errs.length) errs.forEach(e => console.log('  err:', e));

    await ctx.close();
    await browser.close();
    server.kill();
    console.log(`\nMP SMOKE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
