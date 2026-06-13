// Feature: the Tech Tree is a wired SVG skill GRAPH (CORE → gated
// tiers → branched nodes), not a flat column list. Drives the real
// renderTechTree + purchase path.
//
//   * SVG renders one node per TECH_TREE entry, plus CORE and the two
//     tier gates, wired by edges;
//   * node visual state matches logic (owned / available / poor /
//     locked) and edges light from owned nodes / open gates;
//   * clicking an AVAILABLE node purchases it (XP spent, node owned,
//     its edge lights) and the graph re-renders in place;
//   * a locked-tier node can't be bought by clicking;
//   * hovering a node fills the detail panel.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9660 + Math.floor(Math.random() * 60);
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
    await page.evaluate(() => {
        localStorage.setItem('neonPlayerName', 'TT');
        save.metaXP = 600;                 // enough for several tier-1 buys
        NeonSave.write(save);
    });
    // Open UPGRADES, switch to the visible TECH TREE tab.
    await page.click('#menu-tree-btn'); await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#tower-mastery .upg-tab[data-upg-tab="tree"]').click());
    await page.waitForTimeout(300);

    const shape = await page.evaluate(() => {
        const svg = document.getElementById('tech-tree-svg');
        const total = Object.values(TECH_TREE).reduce((n, t) => n + t.nodes.length, 0);
        return {
            present: !!svg,
            nodes: svg.querySelectorAll('.tt-node').length,
            expectedNodes: total,
            edges: svg.querySelectorAll('.tt-edge').length,
            core: svg.querySelectorAll('.tt-core').length,
            gates: svg.querySelectorAll('.tt-gate').length,
        };
    });
    ok('tech tree renders as an SVG graph', shape.present);
    ok('one SVG node per TECH_TREE entry',
        shape.nodes === shape.expectedNodes && shape.nodes === 15, JSON.stringify(shape));
    ok('nodes are wired by edges', shape.edges > shape.nodes, JSON.stringify(shape));
    ok('CORE root + two tier gates present',
        shape.core === 1 && shape.gates === 2, JSON.stringify(shape));

    // State: with 600 XP and a fresh save, tier-1 nodes are available
    // (magenta), tier-3 nodes are locked (tier shut). pioneer/standard
    // are pre-owned on a fresh save.
    const states = await page.evaluate(() => {
        const svg = document.getElementById('tech-tree-svg');
        return {
            owned: svg.querySelectorAll('.tt-owned').length,
            available: svg.querySelectorAll('.tt-available').length,
            locked: svg.querySelectorAll('.tt-locked').length,
            litEdges: svg.querySelectorAll('.tt-edge-lit').length,
        };
    });
    ok('pre-owned starter nodes show owned state', states.owned >= 2, JSON.stringify(states));
    ok('affordable open-tier nodes show available state', states.available >= 1, JSON.stringify(states));
    ok('shut-tier nodes show locked state', states.locked >= 1, JSON.stringify(states));
    ok('owned nodes light their edges', states.litEdges >= 1, JSON.stringify(states));

    // Hover → detail panel.
    const detail = await page.evaluate(() => {
        const n = document.querySelector('#tech-tree-svg .tt-available');
        n.dispatchEvent(new Event('pointerenter'));
        return document.getElementById('tree-node-detail').textContent;
    });
    ok('hovering a node fills the detail panel', /XP|unlock/i.test(detail), detail);

    // Click an available node → purchase.
    const buy = await page.evaluate(() => {
        const before = { xp: save.metaXP, owned: save.unlockedNodes.length };
        const node = document.querySelector('#tech-tree-svg .tt-available');
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const svg = document.getElementById('tech-tree-svg');
        return {
            xpDropped: save.metaXP < before.xp,
            ownedGrew: save.unlockedNodes.length === before.owned + 1,
            ownedNodesNow: svg.querySelectorAll('.tt-owned').length,
        };
    });
    ok('clicking an available node spends XP', buy.xpDropped, JSON.stringify(buy));
    ok('purchase adds the node to unlocks', buy.ownedGrew, JSON.stringify(buy));
    ok('graph re-renders with the new node owned', buy.ownedNodesNow >= 3, JSON.stringify(buy));

    // A locked node can't be purchased by clicking.
    const lockedClick = await page.evaluate(() => {
        const before = save.unlockedNodes.length;
        const locked = document.querySelector('#tech-tree-svg .tt-locked');
        if (locked) locked.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { changed: save.unlockedNodes.length !== before, had: !!locked };
    });
    ok('locked-tier node cannot be bought by clicking',
        lockedClick.had && !lockedClick.changed, JSON.stringify(lockedClick));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nTECH TREE GRAPH: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
