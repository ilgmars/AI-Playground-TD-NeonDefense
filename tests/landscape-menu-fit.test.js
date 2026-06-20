// Regression: on a mobile-browser LANDSCAPE viewport (short height) the main
// menu is taller than the screen. It must top-align + scroll so the primary
// START RUN button is visible at the top — it used to be centred and clipped
// ABOVE the viewport (unreachable), while the APK (fullscreen, more height)
// was fine. The menu-layout audit missed it because it assumed an overflow
// container is always scroll-reachable; flex `justify-content: center`
// overflow clips the TOP, which is not.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9680 + Math.floor(Math.random() * 40);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    // Short landscape phones (the address bar leaves little height).
    for (const vp of [{ name: 'phone landscape', w: 844, h: 390 }, { name: 'small landscape', w: 640, h: 360 }]) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => {
            const btn = document.getElementById('menu-start-btn');
            const b = btn.getBoundingClientRect();
            // Is the button's centre actually the topmost interactive element
            // there (not covered)?
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight,
                covered: !(hit === btn || btn.contains(hit)) };
        });
        ok(`[${vp.name}] START RUN is fully on-screen (not clipped above)`, r.top >= 0 && r.bottom <= r.vh, JSON.stringify(r));
        ok(`[${vp.name}] START RUN is clickable (not covered)`, r.covered === false, JSON.stringify(r));
        ok(`[${vp.name}] no JS errors`, errs.length === 0, errs.join(' / '));
        await ctx.close();
    }

    await browser.close();
    server.kill();
    console.log(`\nLANDSCAPE MENU FIT: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
