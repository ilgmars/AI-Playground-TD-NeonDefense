// Regression: full menu-layout walkthrough.
//
// Walks EVERY full-screen menu/overlay the player can reach from the main
// menu and asserts, for every visible interactive control (and every
// tech-tree node), that it is:
//   1. clickable        — elementFromPoint(centre) hits the element itself,
//                         a descendant, or a wrapping ancestor. If something
//                         ELSE sits on top, the control can't be tapped.
//   2. in horizontal bounds — never clipped past the left/right edge. Menus
//                         scroll vertically, so vertical overflow is fine;
//                         horizontal overflow means a broken layout.
//   3. not overlapping a sibling — two non-nested controls must not sit on
//                         top of each other; tech-tree node circles must not
//                         collide (the "nodes pile up near CORE" bug).
//
// This is run across a MATRIX of viewports: phone / tablet / desktop, in
// both portrait and landscape, at the most common screen sizes — because
// the layout bugs that prompted this test (tech-tree node overlap, edge
// clipping) only showed up at specific sizes/orientations.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

// device type × orientation × common size. Phones/tablets get the touch +
// isMobile flags so responsive CSS media queries fire the same way they
// would on the real device.
const VIEWPORTS = [
    { name: 'phone-sm portrait',   w: 360,  h: 640,  mobile: true },   // small Android
    { name: 'phone portrait',      w: 390,  h: 844,  mobile: true },   // iPhone 12–15
    { name: 'phone-sm landscape',  w: 640,  h: 360,  mobile: true },
    { name: 'phone landscape',     w: 844,  h: 390,  mobile: true },   // iPhone landscape
    { name: 'tablet portrait',     w: 768,  h: 1024, mobile: true },   // iPad
    { name: 'tablet landscape',    w: 1024, h: 768,  mobile: true },
    { name: 'desktop',             w: 1280, h: 800,  mobile: false },
    { name: 'desktop-wide',        w: 1920, h: 1080, mobile: false },
];

// How to open each menu from the main menu, and the overlay id that should
// become visible. Globals (navigateTo*) where they exist; otherwise click
// the real menu button (which also exercises that the button works).
const SCREENS = [
    { id: 'main-menu',         open: null },                                  // shown at boot
    { id: 'options-menu',      open: `document.getElementById('menu-options-btn').click()` },
    { id: 'tech-tree',         open: `navigateToTechTree()` },
    { id: 'tower-mastery',     open: `navigateToTowerMastery()` },
    { id: 'backpack',          open: `navigateToBackpack()` },
    { id: 'scoreboard-screen', open: `document.getElementById('menu-scores-btn').click()` },
    { id: 'save-code-modal',   open: `document.getElementById('menu-savecode-btn').click()` },
    { id: 'start-screen',      open: `navigateToRunSetup()` },
    { id: 'mp-lobby',          open: `document.getElementById('menu-multiplayer-btn').click()`, optional: true },
];

// Runs inside the page. Returns { issues: [...] } for the given overlay.
function AUDIT_FN() {
    return function audit(rootId) {
        const root = document.getElementById(rootId);
        if (!root) return { error: 'no-root' };
        if (root.classList.contains('hidden')) return { error: 'not-visible' };
        const vw = window.innerWidth, vh = window.innerHeight;
        const TOL = 1.5;
        const issues = [];

        const desc = (el) => {
            if (!el) return 'null';
            let s = el.tagName.toLowerCase();
            if (el.id) s += '#' + el.id;
            const cls = (el.getAttribute && el.getAttribute('class')) || '';
            if (cls) s += '.' + cls.trim().split(/\s+/).join('.');
            const t = (el.textContent || '').trim().slice(0, 24);
            if (t) s += ` "${t}"`;
            return s;
        };
        const visible = (el) => {
            if (!el.getClientRects || el.getClientRects().length === 0) return false; // self or ancestor display:none
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') return false;
            if (parseFloat(cs.opacity || '1') < 0.02) return false;
            return true;
        };

        // Scrollable ancestors: content scrolled out of these (or past the
        // viewport) is reachable by scrolling — NOT a layout bug. We clip
        // every element's rect to them so a node scrolled below the tree
        // viewport isn't mistaken for "covered by the action bar" sitting
        // there, and a wide tree that scrolls horizontally isn't "overflow".
        // NB: we stop BEFORE the root overlay. A dedicated INNER pane (e.g.
        // #tech-tree-view) may scroll; the menu overlay itself scrolling
        // sideways is the bug, not an excuse for it.
        const scrollParents = (el) => {
            const arr = [];
            for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) {
                const cs = getComputedStyle(p);
                if (/(auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) arr.push(p);
            }
            return arr;
        };
        const scrollableX = (el) => {
            for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) {
                if (p.scrollWidth > p.clientWidth + 2 &&
                    /(auto|scroll)/.test(getComputedStyle(p).overflowX + getComputedStyle(p).overflow)) return true;
            }
            return false;
        };
        // Element rect clipped to its scroll viewports + the screen.
        const clip = (el) => {
            const r = el.getBoundingClientRect();
            let l = r.left, t = r.top, rt = r.right, b = r.bottom;
            for (const p of scrollParents(el)) {
                const pr = p.getBoundingClientRect();
                l = Math.max(l, pr.left); t = Math.max(t, pr.top);
                rt = Math.min(rt, pr.right); b = Math.min(b, pr.bottom);
            }
            l = Math.max(l, 0); t = Math.max(t, 0); rt = Math.min(rt, vw); b = Math.min(b, vh);
            const w = rt - l, h = b - t;
            return { left: l, top: t, right: rt, bottom: b, width: w, height: h, empty: w < 1 || h < 1 };
        };

        // Real, tappable controls. Tech-tree nodes are SVG <g class=tt-node>.
        const controls = Array.from(root.querySelectorAll(
            'button:not([disabled]), a[href], input:not([type=hidden]), select, textarea, .upg-tab, [role=button]'
        )).filter(visible);
        const nodes = Array.from(root.querySelectorAll('.tt-node')).filter(visible);

        // ── 1) clickability + 2) horizontal bounds ────────────────────────
        for (const el of controls) {
            const r = el.getBoundingClientRect();
            // Horizontal overflow is only a bug when there's no horizontal
            // scroll container to reach it through.
            if (!scrollableX(el) && (r.left < -TOL || r.right > vw + TOL)) {
                issues.push(`OVERFLOW-X ${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)} vw=${vw}]`);
            }
            const c = clip(el);
            if (c.empty) continue;                       // scrolled out of view — reachable
            const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            const okHit = hit && (hit === el || el.contains(hit) || hit.contains(el));
            if (!okHit) issues.push(`COVERED ${desc(el)} ← by ${desc(hit)}`);
        }

        // ── 3a) generic control overlap (non-nested pairs), clipped to view
        for (let i = 0; i < controls.length; i++) {
            const ca = clip(controls[i]);
            if (ca.empty) continue;
            for (let j = i + 1; j < controls.length; j++) {
                const a = controls[i], b = controls[j];
                if (a.contains(b) || b.contains(a)) continue;          // nested → intended
                const cb = clip(b);
                if (cb.empty) continue;
                const ox = Math.min(ca.right, cb.right) - Math.max(ca.left, cb.left);
                const oy = Math.min(ca.bottom, cb.bottom) - Math.max(ca.top, cb.top);
                if (ox <= 0 || oy <= 0) continue;
                const overlap = ox * oy;
                const minArea = Math.min(ca.width * ca.height, cb.width * cb.height);
                if (overlap > 0.25 * minArea) {
                    issues.push(`OVERLAP ${desc(a)} ⨯ ${desc(b)} (${Math.round(100 * overlap / minArea)}%)`);
                }
            }
        }

        // ── 3b) tech-tree node circles must not pile up (both on screen) ──
        for (let i = 0; i < nodes.length; i++) {
            if (clip(nodes[i]).empty) continue;
            for (let j = i + 1; j < nodes.length; j++) {
                if (clip(nodes[j]).empty) continue;
                const ra = nodes[i].getBoundingClientRect(), rb = nodes[j].getBoundingClientRect();
                const dx = (ra.left + ra.width / 2) - (rb.left + rb.width / 2);
                const dy = (ra.top + ra.height / 2) - (rb.top + rb.height / 2);
                const dist = Math.hypot(dx, dy);
                const rad = ra.width / 2 + rb.width / 2;
                // Bodies clearly intersecting (centres closer than 60% of the
                // summed radii) is the overlap bug; touching glow rings is OK.
                if (dist < 0.6 * rad) {
                    issues.push(`NODE-OVERLAP ${desc(nodes[i])} ⨯ ${desc(nodes[j])} (d=${Math.round(dist)} r=${Math.round(rad)})`);
                }
            }
        }

        return { issues, controls: controls.length, nodes: nodes.length };
    };
}

(async () => {
    const PORT = 9700 + Math.floor(Math.random() * 50);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({
            viewport: { width: vp.w, height: vp.h },
            hasTouch: vp.mobile, isMobile: vp.mobile,
        });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', e => errs.push(e.message));
        await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);

        // Seed a save with enough progress that every menu has real content:
        // XP to spend in the tree, mastery towers unlocked, a backpack grid.
        await page.evaluate(() => {
            const s = NeonSave.load();
            s.metaXP = 200000;
            s.maxWaveReached = 40;
            s.ascensionLevel = 2;
            s.backpack = { w: 5, h: 4, placed: [], stash: ['plasma_cell', 'plasma_cell', 'overclock'], luckBoost: 1 };
            NeonSave.write(s);
            location.reload();
        });
        await page.waitForTimeout(700);

        // Install the audit helper once per page.
        await page.evaluate(`window.__audit = (${AUDIT_FN().toString()})`);

        for (const sc of SCREENS) {
            // Return to a clean main menu, then open the target screen.
            await page.evaluate(() => { try { navigateToMainMenu(); } catch (_) {} });
            await page.waitForTimeout(120);
            if (sc.open) {
                const opened = await page.evaluate((js) => {
                    try { eval(js); return true; } catch (e) { return e.message; }
                }, sc.open);
                if (opened !== true && sc.optional) continue;     // e.g. MP disabled
            }
            await page.waitForTimeout(sc.id === 'mp-lobby' ? 500 : 250);

            const res = await page.evaluate((id) => window.__audit(id), sc.id);
            if (res.error === 'not-visible' && sc.optional) continue;  // MP button hidden

            const label = `[${vp.name}] ${sc.id}`;
            if (res.error) { ok(`${label} opened`, false, res.error); continue; }
            ok(`${label} — ${res.controls} controls, ${res.nodes} nodes, no layout issues`,
                res.issues.length === 0,
                res.issues.slice(0, 6).join('  |  '));
        }

        ok(`[${vp.name}] no uncaught JS errors during walkthrough`, errs.length === 0,
            errs.slice(0, 3).join(' / '));
        await ctx.close();
    }

    await browser.close();
    server.kill();
    console.log(`\nMENU LAYOUT AUDIT: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
