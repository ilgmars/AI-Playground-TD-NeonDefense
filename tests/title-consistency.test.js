// Regression: every sub-screen menu title shares ONE scheme — same
// font-size, letter-spacing and glow — so the menus read as a system,
// not a pile of one-off headers. Measures computed styles live.
//
//   * all sub-screen <h2> titles: identical font-size, letter-spacing,
//     text-transform, and a non-empty text-shadow (glow);
//   * the regular menu titles share the neon-magenta colour; the two
//     SEMANTIC end-states (game-over red, victory gold) may recolour
//     but must keep the SAME SIZE;
//   * the main-menu logo (h1.neon-logo) is the brand mark and is
//     intentionally larger — it's exempt, asserted separately.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9680 + Math.floor(Math.random() * 60);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // Measure the first <h2> of every overlay (titles), unhiding each so
    // computed styles are real. Regular vs end-state split for colour.
    const data = await page.evaluate(() => {
        const ids = ['scoreboard-screen', 'mp-lobby', 'mp-waitroom', 'save-code-modal',
            'start-screen', 'tech-tree', 'tower-mastery', 'backpack', 'game-over', 'victory'];
        const out = {};
        for (const id of ids) {
            const ov = document.getElementById(id);
            if (!ov) continue;
            const wasHidden = ov.classList.contains('hidden');
            ov.classList.remove('hidden');
            const h = ov.querySelector('h2');
            if (h) {
                const cs = getComputedStyle(h);
                out[id] = {
                    fontSize: cs.fontSize,
                    letterSpacing: cs.letterSpacing,
                    textTransform: cs.textTransform,
                    color: cs.color,
                    hasGlow: cs.textShadow && cs.textShadow !== 'none',
                    inlineStyle: h.getAttribute('style') || '',
                };
            }
            if (wasHidden) ov.classList.add('hidden');
        }
        // Logo (exempt) for the separate assertion.
        const logo = document.querySelector('#main-menu h1.neon-logo');
        out._logo = logo ? { fontSize: getComputedStyle(logo).fontSize } : null;
        return out;
    });

    const END_STATES = new Set(['game-over', 'victory']);
    const regular = Object.entries(data).filter(([k]) => !k.startsWith('_') && !END_STATES.has(k));
    const all = Object.entries(data).filter(([k]) => !k.startsWith('_'));

    ok('found all sub-screen titles', regular.length >= 7, Object.keys(data).join(','));

    // Size + spacing + transform + glow identical across ALL titles.
    const ref = all[0][1];
    const sizeConsistent = all.every(([, v]) => v.fontSize === ref.fontSize);
    const spacingConsistent = all.every(([, v]) => v.letterSpacing === ref.letterSpacing);
    const transformConsistent = all.every(([, v]) => v.textTransform === ref.textTransform);
    const allGlow = all.every(([, v]) => v.hasGlow);
    ok('every title has the same font-size', sizeConsistent,
        JSON.stringify(all.map(([k, v]) => k + ':' + v.fontSize)));
    ok('every title has the same letter-spacing', spacingConsistent,
        JSON.stringify(all.map(([k, v]) => k + ':' + v.letterSpacing)));
    ok('every title uses the same text-transform', transformConsistent,
        JSON.stringify(all.map(([k, v]) => k + ':' + v.textTransform)));
    ok('every title has a glow (text-shadow)', allGlow,
        JSON.stringify(all.map(([k, v]) => k + ':' + v.hasGlow)));

    // Regular titles share one colour (the magenta scheme).
    const refColor = regular[0][1].color;
    const colorConsistent = regular.every(([, v]) => v.color === refColor);
    ok('regular menu titles share one colour scheme', colorConsistent,
        JSON.stringify(regular.map(([k, v]) => k + ':' + v.color)));

    // End-states keep the SAME SIZE (consistency) but are allowed their
    // own semantic colour.
    if (data['game-over'] && data['victory']) {
        ok('end-state titles keep the shared size',
            data['game-over'].fontSize === ref.fontSize && data['victory'].fontSize === ref.fontSize);
        ok('game-over and victory use distinct semantic colours',
            data['game-over'].color !== refColor && data['victory'].color !== refColor &&
            data['game-over'].color !== data['victory'].color,
            JSON.stringify({ go: data['game-over'].color, win: data['victory'].color, menu: refColor }));
    }

    // Logo is intentionally larger than the sub-screen titles.
    ok('main-menu logo is larger than the sub-screen titles (brand mark)',
        data._logo && parseFloat(data._logo.fontSize) > parseFloat(ref.fontSize),
        JSON.stringify({ logo: data._logo && data._logo.fontSize, title: ref.fontSize }));

    // No inline style overrides left on the audited sub-screen titles
    // (inline overrides were the source of the old drift).
    const inlined = all.filter(([, v]) => v.inlineStyle.trim() !== '').map(([k]) => k);
    ok('no audited sub-screen title carries an inline style override',
        inlined.length === 0, inlined.join(','));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nTITLE CONSISTENCY: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
