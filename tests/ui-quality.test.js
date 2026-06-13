// UI quality baseline (web-design-guidelines / web-accessibility pass).
// Locks in the interaction & accessibility floor so regressions fail
// loudly:
//   * keyboard focus: :focus-visible ring exists; no bare
//     outline:none without a focus-visible replacement nearby
//   * no `transition: all` anywhere (explicit property lists only)
//   * prefers-reduced-motion honored
//   * top-bar controls (styled divs) carry button semantics AND
//     actually activate from the keyboard (Enter toggles pause)
//   * inline-style budget in index.html (repeated patterns belong in
//     classes; budget stops the count creeping back up)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

(async () => {
    const PORT = 9620 + Math.floor(Math.random() * 60);
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

    // ── Static stylesheet checks ─────────────────────────────────────
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    ok('no `transition: all` in the stylesheet', !/transition:\s*all/.test(css));
    ok(':focus-visible ring defined', /:focus-visible\s*\{[^}]*outline:/.test(css));
    ok('prefers-reduced-motion honored', /prefers-reduced-motion/.test(css));
    ok('tap affordances set intentionally', /-webkit-tap-highlight-color/.test(css));

    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const inlineCount = (html.match(/style="/g) || []).length;
    ok(`inline-style budget held (${inlineCount} ≤ 37)`, inlineCount <= 37, inlineCount);

    // ── Palette is OFF the generic AI dark-mode defaults ─────────────
    const root = (css.match(/:root\s*\{[\s\S]*?\}/) || [''])[0];
    // Check the DECLARED values, not any mention (the comment names the
    // old colours it's deliberately avoiding).
    ok('bg is not Tailwind slate-900 (#0f172a)', !/--bg-color:\s*#0f172a/i.test(root),
        (root.match(/--bg-color:[^;]*/) || [''])[0]);
    ok('accent is not Tailwind sky-400 (#38bdf8)', !/--accent:\s*#38bdf8/i.test(root));
    ok('primary accent is GREEN, not a blue/cyan', /--accent:\s*#2bff88/i.test(root),
        (root.match(/--accent:[^;]*/) || [''])[0]);
    ok('no leftover cyan accent anywhere in the stylesheet',
        !/#2ce0ff|44, 224, 255/.test(css));
    ok('a SECOND neon accent exists (multi-colour, not monochrome)',
        /--accent-2:/.test(root));
    ok('logo is a multi-colour neon-tube treatment (green + magenta words)',
        /\.neon-green\s*\{/.test(css) && /\.neon-magenta\s*\{/.test(css));
    ok('glow present on key chrome (drop/box/text shadow in accent)',
        /drop-shadow\(/.test(css) && /menu-open/.test(css));

    // ── Menu transitions ─────────────────────────────────────────────
    ok('overlays animate in (menu transition)',
        /@keyframes overlay-in/.test(css) && /\.overlay\s*\{[^}]*animation:\s*overlay-in/.test(css));

    // ── Tooltips up to date ──────────────────────────────────────────
    ok('no stale "Leave race" tooltip (race mode was removed)',
        !/Leave race/i.test(html));
    ok('no stale "RACE" overlay label', !/>RACE</.test(html));

    // ── Logo is a THIN neon-tube treatment, not flat/bold text ───────
    ok('logo split into green + magenta neon words',
        /neon-green/.test(html) && /neon-magenta/.test(html));
    ok('logo letters are THIN tubes (light font weight)',
        /\.neon-logo\s*\{[^}]*font-weight:\s*300/.test(css));
    ok('logo has a flickering word', /neon-flicker/.test(html));
    ok('neon flicker keyframes defined', /@keyframes neon-flicker/.test(css));
    ok('slow strobe on the EF letters of DEFENSE',
        /D<span class="neon-strobe">EF<\/span>ENSE/.test(html) &&
        /@keyframes neon-strobe/.test(css));
    ok('neon words use layered tube glow (stacked text-shadow)',
        /\.neon-green\s*\{[^}]*text-shadow:[^}]*0 0 26px/.test(css));

    // ── Live keyboard behaviour ──────────────────────────────────────
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => localStorage.setItem('neonPlayerName', 'UIQ'));

    const semantics = await page.evaluate(() => {
        const ids = ['speed-btn', 'pause-btn', 'autopilot-btn', 'sound-btn', 'seed-btn', 'restart-btn'];
        return ids.map(id => {
            const el = document.getElementById(id);
            return {
                id,
                role: el && el.getAttribute('role'),
                tab: el && el.getAttribute('tabindex'),
                named: !!(el && (el.getAttribute('aria-label') || el.getAttribute('title'))),
            };
        });
    });
    ok('all top-bar controls have role="button" + tabindex',
        semantics.every(s => s.role === 'button' && s.tab === '0'),
        JSON.stringify(semantics));
    ok('all top-bar controls are named (aria-label or title)',
        semantics.every(s => s.named), JSON.stringify(semantics));

    // Enter on the focused PAUSE control must toggle pause, same as a
    // click — proves the delegated keyboard activation end to end.
    await page.click('#menu-start-btn'); await page.waitForTimeout(200);
    await page.click('#start-btn');     await page.waitForTimeout(700);
    const pauseToggled = await page.evaluate(() => {
        const el = document.getElementById('pause-btn');
        el.focus();
        const before = window.game.state;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        const mid = window.game.state;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return { before, mid, after: window.game.state };
    });
    ok('Enter on focused PAUSE toggles pause (keyboard parity)',
        pauseToggled.before === 'playing' && pauseToggled.mid === 'paused' &&
        pauseToggled.after === 'playing', JSON.stringify(pauseToggled));

    // Focus ring is actually visible on KEYBOARD focus. Programmatic
    // focus() never matches :focus-visible, so navigate with real Tab
    // presses until a top-bar control holds focus.
    await page.evaluate(() => document.body.focus());
    let ring = null;
    for (let i = 0; i < 25 && !ring; i++) {
        await page.keyboard.press('Tab');
        ring = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el.getAttribute('role') !== 'button') return null;
            const st = getComputedStyle(el);
            return { id: el.id, width: st.outlineWidth, style: st.outlineStyle };
        });
    }
    ok('keyboard (Tab) focus shows an outline ring on the controls',
        !!ring && ring.style !== 'none' && parseFloat(ring.width) >= 2,
        JSON.stringify(ring));

    // ── HUD chrome hides behind full-screen menus, shows in-run ──────
    // (we're on the main menu now after the focus checks navigated home)
    const onMenu = await page.evaluate(() => {
        if (typeof navigateToMainMenu === 'function') navigateToMainMenu();
        const cs = id => getComputedStyle(document.getElementById(id)).display;
        return { body: document.body.classList.contains('menu-open'),
                 topBar: cs('top-bar'), dock: cs('build-menu') };
    });
    ok('main menu hides the game HUD (top bar + dock)',
        onMenu.body && onMenu.topBar === 'none' && onMenu.dock === 'none',
        JSON.stringify(onMenu));

    const inRun = await page.evaluate(() => {
        document.getElementById('menu-start-btn').click();
        return new Promise(res => setTimeout(() => {
            document.getElementById('start-btn').click();
            setTimeout(() => {
                const cs = id => getComputedStyle(document.getElementById(id)).display;
                res({ body: document.body.classList.contains('menu-open'),
                      topBar: cs('top-bar'), dock: cs('build-menu') });
            }, 700);
        }, 250));
    });
    ok('in-run shows the game HUD again',
        !inRun.body && inRun.topBar !== 'none' && inRun.dock !== 'none',
        JSON.stringify(inRun));

    // ── Bounty (and every perk) explains itself via a tooltip ────────
    const perkTip = await page.evaluate(() => {
        navigateToMainMenu();
        document.getElementById('menu-tree-btn').click();   // opens on MASTERY tab
        const rows = Array.from(document.querySelectorAll('#mastery-grid .mastery-perk-row'));
        const bountyRow = rows.find(r => /bounty/i.test(r.textContent));
        return { found: !!bountyRow, tip: bountyRow ? bountyRow.title : '' };
    });
    ok('Bounty perk row has an explanatory tooltip',
        perkTip.found && /credit/i.test(perkTip.tip), JSON.stringify(perkTip));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nUI QUALITY: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
