// Feature: the Tech Tree v2 is a branched SVG skill GRAPH (CORE → six
// branches wired by prerequisite edges), with escalating cost, a 30%
// respec behind a typed phrase, and tree-unlocked extra towers. Drives the
// real renderTechTree / NeonTree.purchase / respec / applyMetaPassives paths:
//   * one SVG node per TECH_TREE entry (>=50), wired by edges, with a CORE;
//   * node state matches logic (owned / available / locked);
//   * clicking an available node buys it (XP spent, owned, re-render) and the
//     NEXT skill costs more (global escalation);
//   * a prereq-locked node can't be bought by clicking;
//   * a tree-unlocked extra tower stays hidden in the build menu until owned;
//   * an owned passive node feeds a real Game via applyMetaPassives;
//   * RESPEC: wrong phrase = no change; correct phrase = 30% refund + cleared.
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
        else      { console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
        localStorage.setItem('neonPlayerName', 'TT');
        save.metaXP = 5000;                         // roots affordable; deep nodes still prereq-locked
        save.treeSpent = 0;
        save.unlockedNodes = ['hero.pioneer', 'kit.standard'];
        NeonSave.write(save);
    });
    // Open UPGRADES (lands on MASTERY), flip to the visible TECH TREE tab so
    // the overlay + RESPEC button are actionable.
    await page.click('#menu-tree-btn'); await page.waitForTimeout(150);
    await page.click('#tower-mastery .upg-tab[data-upg-tab="tree"]'); await page.waitForTimeout(300);

    // ── Shape ────────────────────────────────────────────────────────────
    const shape = await page.evaluate(() => {
        const svg = document.getElementById('tech-tree-svg');
        return {
            present: !!svg,
            nodes: svg.querySelectorAll('.tt-node').length,
            expected: Object.keys(TECH_TREE).length,
            edges: svg.querySelectorAll('.tt-edge').length,
            core: svg.querySelectorAll('.tt-core').length,
        };
    });
    ok('tech tree renders as an SVG graph', shape.present);
    ok('one SVG node per TECH_TREE entry (>=50)',
        shape.nodes === shape.expected && shape.nodes >= 50, shape);
    ok('nodes are wired by edges', shape.edges >= shape.nodes, shape);
    ok('a single CORE root is present', shape.core === 1, shape);

    // ── State ────────────────────────────────────────────────────────────
    const states = await page.evaluate(() => {
        const svg = document.getElementById('tech-tree-svg');
        return {
            owned: svg.querySelectorAll('.tt-owned').length,
            available: svg.querySelectorAll('.tt-available').length,
            locked: svg.querySelectorAll('.tt-locked').length,
        };
    });
    ok('no tree nodes owned on a fresh tree', states.owned === 0, states);
    ok('affordable roots show available state', states.available >= 1, states);
    ok('prereq-gated nodes show locked state', states.locked >= 1, states);

    // ── Purchase + escalating cost ─────────────────────────────────────────
    // Declining the purchase confirm must spend nothing.
    const declined = await page.evaluate(() => {
        window.confirm = () => false;
        const xpBefore = save.metaXP, ownBefore = save.unlockedNodes.length;
        document.querySelector('#tech-tree-svg .tt-available').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { unchanged: save.metaXP === xpBefore && save.unlockedNodes.length === ownBefore };
    });
    ok('declining the purchase confirm spends nothing', declined.unchanged, declined);

    // Confirming spends XP, owns the node, re-renders, and the next skill costs more.
    const buy = await page.evaluate(() => {
        window.confirm = () => true;                                          // accept the spend
        const costBefore = NeonTree.effectiveCost(save, 'asc_singularity');   // deep node, 0 owned
        const xpBefore = save.metaXP, ownBefore = save.unlockedNodes.length;
        const node = [...document.querySelectorAll('#tech-tree-svg .tt-node.tt-available')]
            .find(n => /Calibrated Barrels/.test(n.getAttribute('aria-label')))
            || document.querySelector('#tech-tree-svg .tt-available');
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return {
            xpDropped: save.metaXP < xpBefore,
            ownGrew: save.unlockedNodes.length > ownBefore,
            ownedNow: document.querySelectorAll('#tech-tree-svg .tt-owned').length,
            costBefore,
            costAfter: NeonTree.effectiveCost(save, 'asc_singularity'),       // 1 owned → pricier
        };
    });
    ok('confirming an available node spends XP', buy.xpDropped, buy);
    ok('purchase adds the node to unlocks', buy.ownGrew, buy);
    ok('graph re-renders with the new node owned', buy.ownedNow >= 1, buy);
    ok('each skill makes the next more expensive (escalation)', buy.costAfter > buy.costBefore, buy);

    // ── Locked node can't be bought by clicking ────────────────────────────
    const lockedClick = await page.evaluate(() => {
        const before = save.unlockedNodes.length;
        const locked = document.querySelector('#tech-tree-svg .tt-locked');
        if (locked) locked.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { had: !!locked, changed: save.unlockedNodes.length !== before };
    });
    ok('prereq-locked node cannot be bought by clicking',
        lockedClick.had && !lockedClick.changed, lockedClick);

    // ── Tree-unlocked extra tower is gated in the build menu ───────────────
    const gate = await page.evaluate(() => {
        const el = document.querySelector('.tower-option[data-type="mortar"]');
        save.unlockedNodes = save.unlockedNodes.filter(n => n !== 'tower.mortar');
        updateBuildMenuForLoadout({});
        const hidden = el.classList.contains('tt-tower-locked');
        save.unlockedNodes.push('tower.mortar');
        updateBuildMenuForLoadout({});
        const shown = !el.classList.contains('tt-tower-locked');
        return { hidden, shown };
    });
    ok('extra tower hidden until its node is owned', gate.hidden, gate);
    ok('extra tower appears once its node is owned', gate.shown, gate);

    // ── Owned passive node feeds a real Game via applyMetaPassives ─────────
    const passive = await page.evaluate(() => {
        save.unlockedNodes = ['hero.pioneer', 'kit.standard', 'off_dmg1'];   // +5% damage
        NeonSave.write(save);
        try {
            const g = new Game(document.getElementById('game-canvas'), 12345, 0,
                { heroId: 'hero.pioneer', kitId: 'kit.standard', abilityId: 'ability.none', towerLoadout: null });
            return { dmgMult: g.boonDamageMult };
        } catch (e) { return { error: String(e) }; }
    });
    ok('owned passive node raises Game.boonDamageMult', passive.dmgMult > 1, passive);

    // ── RESPEC: typed-phrase guard + 30% refund ────────────────────────────
    await page.evaluate(() => {
        save.metaXP = 5000; save.treeSpent = 0;
        save.unlockedNodes = ['hero.pioneer', 'kit.standard'];
        NeonSave.write(save);
        NeonTree.purchase(save, 'off_dmg1');
        NeonTree.purchase(save, 'off_dmg2');
        renderTechTree();
    });
    const spentBefore = await page.evaluate(() => save.treeSpent);

    const onWrong = d => { if (d.type() === 'prompt') d.accept('nope'); else d.accept(); };
    page.on('dialog', onWrong);
    await page.click('#tree-respec-btn'); await page.waitForTimeout(200);
    page.off('dialog', onWrong);
    const afterWrong = await page.evaluate(() => ({ spent: save.treeSpent, owned: NeonSave.hasUnlocked(save, 'off_dmg1') }));
    ok('wrong respec phrase changes nothing', afterWrong.spent === spentBefore && afterWrong.owned === true, afterWrong);

    const before = await page.evaluate(() => ({ xp: save.metaXP, spent: save.treeSpent }));
    const onRight = d => { if (d.type() === 'prompt') d.accept('respec tree'); else d.accept(); };
    page.on('dialog', onRight);
    await page.click('#tree-respec-btn'); await page.waitForTimeout(300);
    page.off('dialog', onRight);
    const afterRespec = await page.evaluate(() => ({ xp: save.metaXP, spent: save.treeSpent, owned: NeonSave.hasUnlocked(save, 'off_dmg1') }));
    ok('correct respec phrase refunds 30% and clears nodes',
        afterRespec.spent === 0 && !afterRespec.owned &&
        afterRespec.xp === before.xp + Math.floor(before.spent * 0.30), { before, afterRespec });

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nTECH TREE GRAPH: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
