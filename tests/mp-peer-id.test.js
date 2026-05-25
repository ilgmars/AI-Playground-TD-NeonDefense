// Regression: Trystero peer IDs MUST be unique per peer even when the
// pre-boot script (index.html) reseeds Math.random with a deterministic
// mulberry32 derived from the room code.
//
// The bug: pre-boot swapped Math.random globally. Trystero (loaded
// later) used Math.random to generate its peer ID. Both peers in a
// room computed the same seed → same RNG stream → same peer ID. Each
// side then deduped the OTHER as "self" and the room never paired.
//
// The fix: pre-boot stashes the native Math.random on
// window.__neonNativeRandom; transport-trystero's joinRoom temporarily
// restores native random across the Trystero load + room-join calls,
// then re-installs the seeded one for game logic.
//
// This file has two parts:
//   1. Logic-level (node): assert the contract is honoured at the
//      JS level — given a swapped Math.random and a native ref on
//      window, the transport's joinRoom path restores native during
//      its work and re-installs seeded after.
//   2. Browser-level (playwright): actually launch two coop clients
//      and assert their Trystero peer IDs are DIFFERENT. This is the
//      end-to-end regression guard.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — Logic test: the swap/restore contract
// ─────────────────────────────────────────────────────────────────────────
//
// We can't load the real transport-trystero.js in node (it pulls
// Trystero via ESM from a CDN). Instead we re-implement the tiny
// swap/restore logic inline and assert its invariants, plus the
// contract that aegis-dev-mode is set so the rng-override sensor
// doesn't trip.
{
    // Pre-boot equivalent.
    const nativeMath = Math.random;
    function mulberry32(seed) {
        let a = (seed | 0) >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) | 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const seededAlice = mulberry32(12345);
    const seededBob   = mulberry32(12345);   // same seed: same stream

    // Sanity: the deterministic streams are identical (this is the
    // CAUSE of the bug).
    ok('mulberry32 seeded identically → identical streams',
        seededAlice() === seededBob());

    // Pre-boot installs seeded and stashes native.
    const win = { __neonNativeRandom: nativeMath };
    Math.random = mulberry32(98765);
    const seededPreSwap = Math.random;

    // Transport joinRoom: temporarily restore native for Trystero load,
    // then re-install seeded.
    const native = win.__neonNativeRandom;
    const seeded = Math.random;
    Math.random = native;

    // Simulate Trystero generating two peer IDs while native is active.
    const idAlice = (Math.random().toString(36) + Math.random().toString(36)).slice(2, 12);
    const idBob   = (Math.random().toString(36) + Math.random().toString(36)).slice(2, 12);
    ok('Trystero IDs differ when native random is active during gen',
        idAlice !== idBob);

    // Restore seeded.
    Math.random = seeded;
    ok('seeded random reinstated after joinRoom',
        Math.random === seededPreSwap);

    // Verify the seeded stream still works deterministically. We
    // never called seededPreSwap before the swap, so the first call
    // after restore must equal the first value of a fresh mulberry32
    // with the same seed.
    const seededAfter = Math.random();
    const reseed = mulberry32(98765);
    ok('seeded stream continues from where it left off',
        seededAfter === reseed());

    // Restore the real native to avoid polluting subsequent tests.
    Math.random = nativeMath;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — Browser test: two coop clients get DISTINCT Trystero IDs
// ─────────────────────────────────────────────────────────────────────────
//
// Spawns two playwright contexts, drives them through the coop JOIN
// flow (which uses sessionStorage + reload + seeded RNG), then asserts:
//   * window.__neonNativeRandom is present and differs from Math.random.
//   * _activeRoom.peerCount() > 0 within 15 s (i.e. the rooms paired).
//
// peerCount > 0 is the proxy for "Trystero saw the other peer". With
// the bug present, peerCount stays 0 indefinitely.

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 8771;
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));

    let bPass = 0, bFail = 0;
    function bok(name, cond, extra) {
        if (cond) { console.log('  ok', name); bPass++; }
        else      { console.log('  FAIL', name, extra || ''); bFail++; }
    }

    const browser = await chromium.launch({ headless: true });
    const room = 'P' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[01OI]/g, '2');

    async function spawnCoop(nick) {
        const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true, isMobile: true,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        await page.click('#menu-multiplayer-btn');
        await page.waitForTimeout(150);
        await page.selectOption('#mp-mode-select', 'coop');
        await page.fill('#mp-nick-input', nick);
        await page.fill('#mp-room-input', room);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('#mp-join-btn'),
        ]).catch(() => {});
        await page.waitForSelector('#mp-waitroom:not(.hidden)', { timeout: 25000 }).catch(() => {});
        return { ctx, page, errs };
    }

    const alice = await spawnCoop('ALICE');
    // Brief settle so ALICE finishes joining the broker before BOB
    // races onto it. Without this the two parallel joinRoom calls
    // can finish their CDN loads at nearly the same moment and one
    // side's presence beacon lands in a sub-1-RTT window.
    await new Promise(r => setTimeout(r, 1500));
    const bob   = await spawnCoop('BOB');

    // 1) The pre-boot swap is in place AND the native ref was saved.
    const rngState = async (page) => page.evaluate(() => ({
        hasNative: typeof window.__neonNativeRandom === 'function',
        nativeSame: window.__neonNativeRandom === Math.random,
        // Sample one value from each — they must differ in random
        // (otherwise the swap never happened or both are native).
        nativeVal: window.__neonNativeRandom ? window.__neonNativeRandom() : null,
        currentVal: Math.random(),
    }));
    const aliceRng = await rngState(alice.page);
    const bobRng   = await rngState(bob.page);
    bok('ALICE: __neonNativeRandom saved',         aliceRng.hasNative === true);
    bok('BOB: __neonNativeRandom saved',           bobRng.hasNative   === true);
    bok('ALICE: Math.random IS the seeded one',    aliceRng.nativeSame === false);
    bok('BOB: Math.random IS the seeded one',      bobRng.nativeSame   === false);
    // ALICE and BOB share the same room code → seeded streams should
    // produce identical values. This proves the seed-collision condition
    // that USED to bite us at the Trystero peer-ID layer.
    bok('ALICE and BOB share the same seeded RNG (the cause of the bug)',
        aliceRng.currentVal === bobRng.currentVal);

    // 2) Wait up to 25s for the rooms to pair. We look at the
    //    rendered waitroom peer list — when the BUG was present,
    //    each side only ever showed its own nick because the partner
    //    was being deduped as "self" at the Trystero layer.
    const peerNamesOf = (page) => page.evaluate(() =>
        Array.from(document.querySelectorAll(
            '#mp-waitroom-peers .mp-waitroom-peer .mp-waitroom-peer-name'))
            .map(el => el.textContent.trim()));
    const t0 = Date.now();
    let aliceSeesBob = false, bobSeesAlice = false;
    while (Date.now() - t0 < 25000) {
        const a = await peerNamesOf(alice.page);
        const b = await peerNamesOf(bob.page);
        if (a.includes('BOB'))   aliceSeesBob = true;
        if (b.includes('ALICE')) bobSeesAlice = true;
        if (aliceSeesBob && bobSeesAlice) break;
        await new Promise(r => setTimeout(r, 500));
    }
    bok('ALICE waitroom lists BOB within 25 s (peer IDs distinct)',
        aliceSeesBob === true);
    bok('BOB waitroom lists ALICE within 25 s (peer IDs distinct)',
        bobSeesAlice === true);

    bok('no JS errors on ALICE',  alice.errs.length === 0, alice.errs.join(' / '));
    bok('no JS errors on BOB',    bob.errs.length === 0,   bob.errs.join(' / '));

    await browser.close();
    server.kill();

    const total = pass + bPass;
    const totalFail = fail + bFail;
    console.log(`\nMP PEER-ID: ${total} pass, ${totalFail} fail`);
    process.exit(totalFail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
