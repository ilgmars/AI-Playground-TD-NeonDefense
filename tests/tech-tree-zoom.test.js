// Feature: the tech tree is zoomable (buttons + pinch + ctrl-wheel) and
// carries a glyph legend so the node symbols read at a glance.
//
//   • A legend lists the node-kind glyphs with friendly labels.
//   • Zoom in/out buttons change the SVG's rendered width; FIT resets to 1×;
//     zoom is clamped to a sane range.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9610 + Math.floor(Math.random() * 30);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    let pass = 0, fail = 0;
    const ok = (name, cond, extra) => {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    };

    await page.evaluate(() => navigateToTechTree());
    await page.waitForTimeout(400);

    // ── Legend ────────────────────────────────────────────────────────
    const legend = await page.evaluate(() => {
        const items = [...document.querySelectorAll('#tt-legend .tt-leg-item')].map(e => e.textContent);
        return { count: items.length, joined: items.join(' ') };
    });
    ok('legend lists the node glyphs (>=12 items)', legend.count >= 12, JSON.stringify(legend));
    ok('legend decodes key kinds (Damage / New tower / Keystone)',
        /Damage/.test(legend.joined) && /New tower/.test(legend.joined) && /Keystone/.test(legend.joined),
        legend.joined);

    // ── Zoom ──────────────────────────────────────────────────────────
    const svgW = () => page.evaluate(() => Math.round(document.getElementById('tech-tree-svg').getBoundingClientRect().width));
    const w0 = await svgW();
    await page.click('#tt-zoom-in');
    await page.waitForTimeout(80);
    const wIn = await svgW();
    ok('zoom-in widens the tree', wIn > w0, JSON.stringify({ w0, wIn }));

    await page.click('#tt-zoom-out');
    await page.click('#tt-zoom-out');
    await page.waitForTimeout(80);
    const wOut = await svgW();
    ok('zoom-out shrinks the tree', wOut < wIn, JSON.stringify({ wIn, wOut }));

    await page.click('#tt-zoom-fit');
    await page.waitForTimeout(80);
    const fitZoom = await page.evaluate(() =>
        getComputedStyle(document.getElementById('tech-tree-view')).getPropertyValue('--tt-zoom').trim());
    ok('FIT resets zoom to 1', parseFloat(fitZoom) === 1, fitZoom);

    // Clamp: hammering zoom-out never goes below the 0.5 floor.
    const clamped = await page.evaluate(() => {
        for (let i = 0; i < 30; i++) window.setTreeZoom(0.0001);
        return parseFloat(getComputedStyle(document.getElementById('tech-tree-view')).getPropertyValue('--tt-zoom'));
    });
    ok('zoom is clamped at the 0.5 minimum', clamped === 0.5, String(clamped));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nTECH TREE ZOOM: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
