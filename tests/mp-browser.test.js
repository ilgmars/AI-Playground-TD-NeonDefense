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
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

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
    await page.click('#menu-multiplayer-btn');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
        // Replace the Trystero loader with a mock that joins the same
        // in-process hub the controller uses. End-to-end JOIN runs but
        // doesn't touch the network.
        const hub = NeonMP.transport.createMockHub();
        NeonMP.trystero.joinRoom = async (code, nick) => {
            const peer = hub.join(code, nick);
            return Object.assign(peer, { peerCount: () => 1, onPeerJoin(){}, onPeerLeave(){} });
        };
    });
    await page.fill('#mp-room-input', 'NEAN42');
    await page.fill('#mp-nick-input', 'ALICE');
    await page.click('#mp-join-btn');
    await page.waitForTimeout(500);
    const joinState = await page.evaluate(() => ({
        seed: window.game && window.game.seed,
        expectedSeed: NeonMP.protocol.roomCodeToSeed('NEAN42'),
        overlayVisible: !document.getElementById('mp-race-overlay').classList.contains('hidden'),
        roomBadge: document.getElementById('mp-race-room').textContent,
    }));
    ok('JOIN seeded game from room code', joinState.seed === joinState.expectedSeed);
    ok('JOIN shows race overlay',         joinState.overlayVisible === true);
    ok('JOIN sets room badge',            joinState.roomBadge === 'NEAN42');

    // After ≥1 heartbeat tick, the local player row should be visible.
    await page.waitForTimeout(1100);
    const rowCount = await page.$$eval('#mp-race-list .mp-race-row', els => els.length);
    ok('race overlay renders local row', rowCount >= 1);

    // Leave: overlay hides, race controller cleared.
    await page.click('#mp-race-leave');
    await page.waitForTimeout(150);
    const afterLeave = await page.evaluate(() =>
        document.getElementById('mp-race-overlay').classList.contains('hidden'));
    ok('LEAVE hides race overlay', afterLeave === true);

    // No JS errors anywhere
    ok('no JS errors', errs.length === 0);
    if (errs.length) errs.forEach(e => console.log('  err:', e));

    await ctx.close();
    await browser.close();
    server.kill();
    console.log(`\nMP SMOKE: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
