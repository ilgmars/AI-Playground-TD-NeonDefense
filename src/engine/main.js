// Module-level ref so proxy buttons (set up outside init()) can reset the timer.
let _resetOverflowTimer = null;
let game;
let selectedTowerType = null;
let mousePos = { x: 0, y: 0 };
let gameSpeed = 1;

// Load or create persistent save. NeonSave.load handles legacy migration
// (neonDefenseScores_easy|normal|hard → a0/a2/a4, 200 XP welcome grant).
// Aegis boots BEFORE the save load so Math.random / Date.now etc are
// snapshotted from a pristine page. (NeonSave.load() may set the cheater
// flag if it detects a localStorage tamper — that's why we boot first.)
if (typeof NeonAegis !== 'undefined') NeonAegis.boot();
const save = NeonSave.load();
window.save = save;   // M2: expose for Enemy.draw HP-bar check.

// Default tier = highest cleared. First-time players start on A0.
// Ascension is endless so no upper clamp.
let selectedTier = Math.max(0, save.ascensionCleared | 0);

// Visible Ascension tier in the scoreboard view (independent from run tier).
let visibleScoreTier = selectedTier;

// M2: Selected loadout for next run. Initialized from save.lastLoadout if present,
// else default to Pioneer + Standard + None. Always valid (unlocked).
let selectedHero    = (save.lastLoadout && save.lastLoadout.heroId   && NeonSave.hasUnlocked(save, save.lastLoadout.heroId))   ? save.lastLoadout.heroId   : 'hero.' + DEFAULT_HERO;
let selectedKit     = (save.lastLoadout && save.lastLoadout.kitId    && NeonSave.hasUnlocked(save, save.lastLoadout.kitId))    ? save.lastLoadout.kitId    : 'kit.' + DEFAULT_KIT;
let selectedAbility = (save.lastLoadout && save.lastLoadout.abilityId && NeonSave.hasUnlocked(save, save.lastLoadout.abilityId)) ? save.lastLoadout.abilityId : 'ability.none';

// M3: Per-base-type variant selection. Map of baseType → effective tower id.
// Example: { basic: 'basic_cryo', sniper: 'sniper', ... } — 'sniper' means base form.
// Initialized from save.lastLoadout.towerLoadout if present.
let selectedTowerLoadout = (save.lastLoadout && save.lastLoadout.towerLoadout)
    ? { ...save.lastLoadout.towerLoadout }
    : {};

function isTowerVariantUnlocked(baseType) {
    const mastery = save.towerMastery && save.towerMastery[baseType];
    return !!(mastery && mastery.milestones && mastery.milestones.m1);
}

function sanitizeTowerLoadout(loadout) {
    const clean = {};
    const source = (loadout && typeof loadout === 'object') ? loadout : {};
    for (const baseType of NeonSave.TOWER_TYPES) {
        const variantId = TOWER_VARIANTS[baseType];
        const selected = source[baseType];
        if (variantId && selected === variantId && isTowerVariantUnlocked(baseType)) {
            clean[baseType] = variantId;
        } else if (selected === baseType) {
            clean[baseType] = baseType;
        }
    }
    return clean;
}

selectedTowerLoadout = sanitizeTowerLoadout(selectedTowerLoadout);

function setTier(tier) {
    const unlockedMax = (save.ascensionCleared | 0) + 1;   // endless
    if (tier < 0 || tier > unlockedMax) return;
    selectedTier = tier;

    // Re-render all three selector contexts with new selection.
    renderAscensionSelector('start');
    renderAscensionSelector('gameover');
    renderAscensionSelector('restart');

    updateModeDisplay(tier);
}

function updateModeDisplay(tier) {
    const el = document.getElementById('mode-display');
    if (!el) return;
    const t = (typeof tier === 'number') ? tier : (game ? game.ascensionTier : selectedTier);
    el.textContent = 'A' + t;
    el.style.color = 'var(--accent)';
    el.style.textShadow = '0 0 10px rgba(56, 189, 248, 0.45)';
}

// Renders one of the three .ascension-buttons containers. Single
// [−] [A<n>] [+] stepper covering EVERY tier from A0 up to the highest
// unlocked. Tier names + cumulative modifiers go in the preview line
// below so the row stays compact on phones.
function renderAscensionSelector(context) {
    const container = document.querySelector(`.ascension-buttons[data-context="${context}"]`);
    if (!container) return;
    container.innerHTML = '';

    const unlockedMax = (save.ascensionCleared | 0) + 1;     // endless: no upper cap
    const clamped = Math.max(0, Math.min(unlockedMax, selectedTier | 0));
    const spec = getAscensionTierSpec(clamped);

    const stepper = document.createElement('div');
    stepper.className = 'ascension-stepper';

    const minus = document.createElement('button');
    minus.className = 'ascension-step-btn';
    minus.textContent = '−';
    minus.title = 'Step down one tier';
    minus.disabled = clamped <= 0;
    minus.addEventListener('click', () => setTier(clamped - 1));

    const label = document.createElement('button');
    label.className = 'ascension-btn ascension-endless selected';
    label.textContent = spec.label;
    label.title = spec.name;
    // Tapping the label is a no-op (it just shows the current tier);
    // we keep it as a button for layout consistency with named-only
    // styling but disable interaction.
    label.disabled = true;

    const plus = document.createElement('button');
    plus.className = 'ascension-step-btn';
    plus.textContent = '+';
    plus.title = 'Step up one tier';
    plus.disabled = clamped >= unlockedMax;
    plus.addEventListener('click', () => setTier(clamped + 1));

    stepper.appendChild(minus);
    stepper.appendChild(label);
    stepper.appendChild(plus);
    container.appendChild(stepper);

    const preview = document.querySelector(`.ascension-modifiers-preview[data-context="${context}"]`);
    if (preview) {
        if (clamped === 0) {
            preview.textContent = 'Baseline — no modifiers';
        } else {
            const names = [];
            const namedUpper = Math.min(clamped, ASCENSION_NAMED_MAX_TIER);
            for (let i = 1; i <= namedUpper; i++) names.push(getAscensionTierSpec(i).name);
            if (clamped > ASCENSION_NAMED_MAX_TIER) {
                const overshoot = clamped - ASCENSION_NAMED_MAX_TIER;
                const hpPct = Math.round((Math.pow(ASCENSION_ENDLESS_STEP.hpMult, overshoot) - 1) * 100);
                names.push(`Endless ×${overshoot} (+${hpPct}% HP)`);
            }
            preview.textContent = names.join(' · ');
        }
        // QoL: qol.ascpreview reveals the *next* tier's modifier before
        // you've actually cleared the current one. Without this node the
        // next-tier modifier is hidden until first clear — owning the
        // node trades 500 XP for early intel. Append, don't replace, so
        // the current-tier names still read first.
        if (typeof NeonSave !== 'undefined' && NeonSave.hasUnlocked &&
            NeonSave.hasUnlocked(save, 'qol.ascpreview') && clamped === unlockedMax) {
            const nextTier = clamped + 1;
            let nextName;
            if (nextTier <= ASCENSION_NAMED_MAX_TIER) {
                nextName = getAscensionTierSpec(nextTier).name;
            } else {
                const overshoot = nextTier - ASCENSION_NAMED_MAX_TIER;
                const hpPct = Math.round((Math.pow(ASCENSION_ENDLESS_STEP.hpMult, overshoot) - 1) * 100);
                nextName = `Endless ×${overshoot} (+${hpPct}% HP)`;
            }
            preview.textContent += `  ·  next: ${nextName}`;
        }
    }
}


// M2: Populate the three loadout dropdowns based on unlocked tree nodes.
// Called at init and after any tree purchase. Preserves current selection
// if still valid; falls back to default otherwise.
function renderLoadoutDropdowns() {
    selectedTowerLoadout = sanitizeTowerLoadout(selectedTowerLoadout);
    renderOneLoadoutSelect('run-hero-select', 'selectedHero', 'hero.pioneer', HEROES);
    renderOneLoadoutSelect('run-kit-select',  'selectedKit',  'kit.standard', STARTER_KITS);
    renderOneAbilitySelect();
    renderTowerVariantGrid();
    if (typeof refreshSkipsetupRow === 'function') refreshSkipsetupRow();
}

// M3: Populate the tower-variant grid. One row per base tower type;
// row is visible only if the player has unlocked that tower's variant
// (towerMastery[type].milestones.m1). If no variants are unlocked, the
// entire row is hidden.
function renderTowerVariantGrid() {
    const row = document.getElementById('tower-loadout-row');
    const grid = document.getElementById('tower-variant-grid');
    if (!row || !grid) return;
    grid.innerHTML = '';

    let anyUnlocked = false;
    for (const baseType of NeonSave.TOWER_TYPES) {
        const variantId = TOWER_VARIANTS[baseType];
        if (!variantId || !TOWERS[variantId]) continue;   // tree towers have no variant
        const variantUnlocked = isTowerVariantUnlocked(baseType);
        if (!variantUnlocked) continue;
        anyUnlocked = true;

        const cell = document.createElement('div');
        cell.className = 'tower-variant-row';

        const label = document.createElement('span');
        label.className = 'variant-base';
        label.textContent = TOWERS[baseType].displayName;

        const sel = document.createElement('select');
        sel.innerHTML = `
            <option value="${baseType}">${TOWERS[baseType].displayName}</option>
            <option value="${variantId}">${TOWERS[variantId].displayName}</option>
        `;
        const current = selectedTowerLoadout[baseType] || baseType;
        sel.value = current;
        sel.addEventListener('change', e => {
            selectedTowerLoadout[baseType] = e.target.value;
        });

        cell.appendChild(label);
        cell.appendChild(sel);
        grid.appendChild(cell);
    }

    if (anyUnlocked) row.classList.remove('hidden');
    else row.classList.add('hidden');
}

function renderOneLoadoutSelect(elementId, globalName, fallbackId, catalog) {
    const sel = document.getElementById(elementId);
    if (!sel) return;
    sel.innerHTML = '';

    const currentGlobal = (globalName === 'selectedHero') ? selectedHero : selectedKit;

    const entries = Object.values(catalog);
    const unlocked = entries.filter(e => NeonSave.hasUnlocked(save, e.id));
    if (unlocked.length === 0) return;

    for (const entry of unlocked) {
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.name + ' — ' + entry.desc;
        sel.appendChild(opt);
    }

    let validSelection = currentGlobal;
    if (!unlocked.find(e => e.id === validSelection)) validSelection = fallbackId;
    sel.value = validSelection;
    if (globalName === 'selectedHero') selectedHero = validSelection;
    else if (globalName === 'selectedKit') selectedKit = validSelection;
}

// Ability dropdown is special: always includes 'None' even if not in save.
function renderOneAbilitySelect() {
    const sel = document.getElementById('run-ability-select');
    if (!sel) return;
    sel.innerHTML = '';

    // Always-available "None" option
    const noneOpt = document.createElement('option');
    noneOpt.value = 'ability.none';
    noneOpt.textContent = ABILITIES.none.name + ' — ' + ABILITIES.none.desc;
    sel.appendChild(noneOpt);

    // Unlocked abilities
    for (const key of ['scan', 'airstrike', 'freeze']) {
        const ab = ABILITIES[key];
        if (NeonSave.hasUnlocked(save, ab.id)) {
            const opt = document.createElement('option');
            opt.value = ab.id;
            opt.textContent = ab.name + ' — ' + ab.desc + ' (' + ab.charges + ')';
            sel.appendChild(opt);
        }
    }

    if (![...sel.options].find(o => o.value === selectedAbility)) selectedAbility = 'ability.none';
    sel.value = selectedAbility;
}

// M2: Show / hide overlay helpers. All overlays use .hidden to toggle.
function showScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
    updateHudChrome();
}
function hideScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
    updateHudChrome();
}

// The full-screen menu overlays (.overlay) live INSIDE #game-container,
// so they never covered the top bar (above) or the DEFENSES dock
// (beside) — every menu floated over a live-looking game HUD showing
// health/credits that don't apply outside a run. Hide that chrome
// whenever any full-screen overlay is up; the in-game race/boon
// widgets aren't `.overlay`, so the gameplay HUD stays put. Toggling
// the HUD reflows #content, so resize the canvas to match.
let _hudHidden = null;
function updateHudChrome() {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const overlayOpen = !!document.querySelector('.overlay:not(.hidden)');
    if (overlayOpen === _hudHidden) return;        // no change → no reflow
    _hudHidden = overlayOpen;
    document.body.classList.toggle('menu-open', overlayOpen);
    if (typeof resizeCanvas === 'function') {
        try { resizeCanvas(); } catch (_) {}
    }
}

// ── History / back-button integration ────────────────────────────────
// Mobile WebViews fire popstate when the user hits the system Back button.
// We push a sentinel state when leaving the main menu so that Back returns
// the player to the menu instead of unloading the page.
let _subScreenOpen = false;
let _suppressPush = false;
function _enterSubScreen() {
    if (_suppressPush || _subScreenOpen) return;
    _subScreenOpen = true;
    try { history.pushState({ ndSubScreen: true }, ''); } catch (_) {}
}
function _exitSubScreenState() {
    // Called from popstate AND from explicit navigateToMainMenu() so the
    // history stack stays in sync regardless of how the user gets back.
    _subScreenOpen = false;
}
if (typeof window !== 'undefined' && !window.__neonHistoryWired) {
    window.__neonHistoryWired = true;
    window.addEventListener('popstate', () => {
        // System Back during an ACTIVE RUN must NOT drop the run (it used to
        // fall through to navigateToMainMenu and quit the game). Re-arm a
        // history entry so Back is consumed and the run keeps going — the
        // in-game EXIT button is the only intentional way out. Applies on web
        // and in the APK (its hardware Back calls webView.goBack()).
        if (typeof game !== 'undefined' && game &&
            (game.state === 'playing' || game.state === 'paused')) {
            try { history.pushState({ ndRun: true }, ''); } catch (_) {}
            return;
        }
        if (_subScreenOpen) {
            _suppressPush = true;
            navigateToMainMenu();
            _suppressPush = false;
        }
    });
}

// Used by the in-UI "BACK" buttons. Going through history.back() keeps
// the stack in sync — every _enterSubScreen push has a matching pop so
// the device Back button stays predictable. If we somehow aren't in a
// sub-screen (defensive), just show the main menu directly.
function uiGoBack() {
    if (_subScreenOpen) { try { history.back(); return; } catch (_) {} }
    navigateToMainMenu();
}

// Main Menu → Run Setup → Game is the canonical forward path.
function navigateToMainMenu() {
    // If the player leaves the backpack screen with an item still in
    // hand (e.g. via the device Back button, a deep link, or pressing
    // RST while the backpack was open), auto-return it to the stash
    // and persist. Losing a held item to a stray nav tap is the most
    // common "what just happened?" mobile complaint.
    if (typeof bpHeld !== 'undefined' && bpHeld && typeof bpReturnHeldToStash === 'function') {
        bpReturnHeldToStash();
        if (typeof bpPersist === 'function') bpPersist();
    }
    // Tear down any active MP session — race controller, coop
    // controller, room subscription, and race overlay. Skipping
    // this leaves _activeMode set and the race heartbeat repaints
    // the overlay over any later single-player run.
    try {
        if (typeof window.__neonLeaveMP === 'function') window.__neonLeaveMP();
    } catch (_) {}
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('retire-confirm');
    hideScreen('tech-tree');
    hideScreen('tower-mastery');
    hideScreen('backpack');
    hideScreen('save-code-modal');
    hideScreen('options-menu');
    hideScreen('mp-lobby');
    hideScreen('mp-waitroom');
    hideScreen('mp-race-overlay');   // double-belt+suspenders
    showScreen('main-menu');
    // Re-check for a newer deployed build every time we land on the menu
    // (throttled inside refreshVersionInfo) so an update surfaces without
    // relaunching the app. A no-op until the boot IIFE has wired it.
    if (typeof window !== 'undefined' && window.refreshVersionInfo) window.refreshVersionInfo();
    _exitSubScreenState();
    // Halt the in-progress run so update() bails — the menu owns the canvas now.
    if (typeof game !== 'undefined' && (game.state === 'playing' || game.state === 'paused')) {
        game.state = 'paused';
    }
    updateMainMenuState();
}

function navigateToRunSetup() {
    _enterSubScreen();
    hideScreen('main-menu');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('start-screen');
    renderAscensionSelector('start');
    renderLoadoutDropdowns();
}

// Compact large numbers for HUD/menu display: 9 999 stays raw, then
// 12.4k / 3.2m / 1.1b. One decimal, trailing .0 trimmed. Full
// precision stays in the save — this is display-only.
function formatCompact(n) {
    n = Math.floor(Number(n) || 0);
    const abs = Math.abs(n);
    if (abs < 10000) return String(n);
    const units = [[1e9, 'b'], [1e6, 'm'], [1e3, 'k']];
    for (const [div, suffix] of units) {
        if (abs >= div) {
            // Floor to one decimal so 999 949 reads 999.9k, never the
            // unit-overflowing 1000k.
            const v = Math.floor((n / div) * 10) / 10;
            const s = (v % 1 === 0) ? String(v) : v.toFixed(1);
            return s + suffix;
        }
    }
    return String(n);
}
window.formatCompact = formatCompact;

// Keyboard parity for the top-bar controls: the interactive stat-boxes
// are styled divs carrying role="button", so Enter/Space must activate
// them exactly like a click (guideline: interactive elements need
// keyboard handlers). One delegated listener, no per-element wiring.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute('role') === 'button' &&
            el.tagName !== 'BUTTON') {
        e.preventDefault();      // Space must not scroll the page
        el.click();
    }
});

function updateMainMenuState() {
    const bal = document.getElementById('menu-xp-balance');
    if (bal) bal.textContent = formatCompact(save.metaXP) + ' XP';

    const daily = document.getElementById('menu-dailyseed-btn');
    if (daily) {
        if (NeonSave.hasUnlocked(save, 'qol.dailyseed')) daily.classList.remove('hidden');
        else daily.classList.add('hidden');
    }
}

// M2: Tech Tree screen. Renders 3 tier columns of nodes, each styled
// by ownership / eligibility / affordability. Click affordable node to
// purchase; XP is deducted and loadout dropdowns refresh.
function navigateToTechTree() {
    _enterSubScreen();
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    showScreen('tech-tree');
    renderTechTree();
    // Default to a readable zoom: enlarge the fitted tree until it's ~760px
    // wide (legible) on narrow screens; desktops that already fit stay at 1.
    // The player can zoom out to an overview or in for detail from there.
    if (typeof setTreeZoom === 'function') {
        requestAnimationFrame(() => {
            const view = document.getElementById('tech-tree-view');
            const w = view ? view.clientWidth : 0;
            setTreeZoom(w > 0 ? Math.max(1, Math.min(2.4, 760 / w)) : 1);
        });
    }
}

const SVGNS = 'http://www.w3.org/2000/svg';
function _svg(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}
function _treeNodeName(node) {
    return (node.kind === 'hero' && HEROES[node.id.slice(5)]) ? HEROES[node.id.slice(5)].name
        : (node.kind === 'kit'  && STARTER_KITS[node.id.slice(4)]) ? STARTER_KITS[node.id.slice(4)].name
        : (node.kind === 'ability' && ABILITIES[node.id.slice(8)]) ? ABILITIES[node.id.slice(8)].name
        : (node.kind === 'qol' && QOL_NODES[node.id]) ? QOL_NODES[node.id].name
        : node.id;
}
// Glyph per node kind — a quick read of what a node is before reading it.
const TREE_KIND_GLYPH = {
    damage: '⚔', rate: '»', payout: '$', kill: '☠', interest: '%',
    money: '◈', hp: '✛', regen: '✚', cost: '⚒', ability: '✦',
    hero: '☗', kit: '🜲', qol: '⚙', variant: '⎔', tower: '⌖', keystone: '★', mixed: '✸'
};

// Friendly legend: glyph → what the node gives you, so the symbols read at a
// glance. Order roughly groups offense / economy / defense / unlocks.
const TREE_LEGEND = [
    ['⚔', 'Damage'], ['»', 'Fire rate'], ['$', 'Payout'], ['☠', 'Bounty'],
    ['%', 'Interest'], ['✛', 'Max HP'], ['✚', 'Regen'], ['⚒', 'Cheaper'],
    ['⌖', 'New tower'], ['⎔', 'Variant'], ['✦', 'Ability'], ['☗', 'Hero'],
    ['🜲', 'Kit'], ['⚙', 'QoL'], ['★', 'Keystone'], ['✓', 'Owned'],
];

// The tech tree as a wired GRAPH: a central CORE feeds the first ring of
// nodes; each tier connects to the next through a gate junction that
// lights once the prior tier has its 2 unlocks (the real isTierOpen
// rule, shown as structure). Layout is computed from TECH_TREE so adding
// nodes needs no layout edits.
function renderTechTree() {
    const bal = document.getElementById('tree-xp-balance');
    if (bal) bal.textContent = formatCompact(save.metaXP);

    // Glyph legend (built once; the colour of a node = its branch, shown by
    // the lane labels). Lets players read what a node grants at a glance.
    const legend = document.getElementById('tt-legend');
    if (legend && !legend.childElementCount) {
        for (const [gl, label] of TREE_LEGEND) {
            const item = document.createElement('span');
            item.className = 'tt-leg-item';
            item.innerHTML = '<span class="tt-leg-glyph">' + gl + '</span>' + label;
            legend.appendChild(item);
        }
        const note = document.createElement('span');
        note.className = 'tt-leg-item tt-leg-note';
        note.textContent = '· colour = branch';
        legend.appendChild(note);
    }

    const svg = document.getElementById('tech-tree-svg');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Depth = longest prerequisite chain from a root (memoized).
    const depthCache = {};
    function depthOf(id) {
        if (depthCache[id] !== undefined) return depthCache[id];
        const node = TECH_TREE[id];
        const req = (node && node.requires) || [];
        depthCache[id] = req.length === 0 ? 0 : 1 + Math.max(...req.map(depthOf));
        return depthCache[id];
    }

    const branchKeys = Object.keys(TREE_BRANCHES);
    const ids = Object.keys(TECH_TREE);
    let maxDepth = 0;
    for (const id of ids) maxDepth = Math.max(maxDepth, depthOf(id));

    // Bucket nodes by (lane, depth).
    const buckets = {};                       // `${bi}|${depth}` -> [ids]
    for (const id of ids) {
        const bi = branchKeys.indexOf(TECH_TREE[id].branch);
        const d = depthOf(id);
        const key = bi + '|' + d;
        (buckets[key] || (buckets[key] = [])).push(id);
    }

    // ADAPTIVE layout: each lane's height is sized to its busiest depth bucket,
    // so stacked nodes never overlap no matter how many a branch grows to (this
    // is the fix for the "elements overlap" report). The viewBox AND the
    // element's aspect-ratio are sized to the content; the view scrolls on
    // small screens. CORE sits at the far left, vertically centred, a full
    // column clear of every lane node.
    const NODE_VSPACE = 66;     // min vertical gap between stacked nodes
    const LANE_PAD = 32;        // padding above/below a lane's nodes
    const COL_STEP = 168;       // horizontal gap between depth columns
    const laneHeights = branchKeys.map((_, bi) => {
        let maxStack = 1;
        for (let d = 0; d <= maxDepth; d++) {
            const b = buckets[bi + '|' + d];
            if (b && b.length > maxStack) maxStack = b.length;
        }
        return maxStack * NODE_VSPACE + 2 * LANE_PAD;
    });
    const laneTops = [];
    let accY = 0;
    for (let bi = 0; bi < branchKeys.length; bi++) { laneTops[bi] = accY; accY += laneHeights[bi]; }
    const VBH = accY;

    // CORE sits in a left gutter; the branch labels live to its RIGHT (x=84)
    // so the centre lane's label (ARSENAL) no longer sits under the CORE disc.
    const CORE_X = 44;
    const colLeft = 200, colRightPad = 70;
    const VBW = colLeft + maxDepth * COL_STEP + colRightPad;
    const colX = d => colLeft + d * COL_STEP;

    svg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH);
    svg.style.aspectRatio = VBW + ' / ' + VBH;   // element box matches the viewBox (no letterbox / squish)

    // Position nodes: x by depth, y stacked + evenly centred within the lane.
    const pos = {};
    for (const key of Object.keys(buckets)) {
        const [biStr, dStr] = key.split('|');
        const bi = +biStr, d = +dStr;
        const list = buckets[key];
        const top = laneTops[bi], h = laneHeights[bi];
        list.forEach((id, k) => {
            const y = top + h * (k + 1) / (list.length + 1);
            pos[id] = { x: colX(d), y, bi };
        });
    }

    const edgesG = _svg('g', {});  const nodesG = _svg('g', {});
    svg.appendChild(edgesG); svg.appendChild(nodesG);

    const edge = (x1, y1, x2, y2, color, lit) => edgesG.appendChild(_svg('path', {
        d: `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`,
        class: 'tt-edge' + (lit ? ' tt-edge-lit' : ''), fill: 'none',
        stroke: lit ? color : '',
    }));

    const CORE_Y = VBH / 2;

    // Edges: CORE → each root; otherwise prereq → node. Lit when the
    // upstream end is owned (so a path lights up as you buy along it).
    for (const id of ids) {
        const node = TECH_TREE[id];
        const p = pos[id];
        const color = (TREE_BRANCHES[node.branch] || {}).color || '#38bdf8';
        const req = node.requires || [];
        if (req.length === 0) {
            edge(CORE_X, CORE_Y, p.x, p.y, color, NeonSave.hasUnlocked(save, id));
        } else {
            for (const r of req) {
                if (!pos[r]) continue;
                edge(pos[r].x, pos[r].y, p.x, p.y, color, NeonSave.hasUnlocked(save, r));
            }
        }
    }

    // Branch labels at the left edge of each lane.
    branchKeys.forEach((bk, bi) => {
        const t = _svg('text', { x: 84, y: laneTops[bi] + 16, class: 'tt-branch-label' });
        t.setAttribute('fill', TREE_BRANCHES[bk].color);
        t.textContent = TREE_BRANCHES[bk].name;
        nodesG.appendChild(t);
    });

    // CORE node.
    const core = _svg('g', { class: 'tt-core' });
    core.appendChild(_svg('circle', { cx: CORE_X, cy: CORE_Y, r: 24, class: 'tt-core-disc' }));
    const coreLabel = _svg('text', { x: CORE_X, y: CORE_Y + 5, class: 'tt-core-label', 'text-anchor': 'middle' });
    coreLabel.textContent = 'CORE';
    core.appendChild(coreLabel);
    nodesG.appendChild(core);

    // Nodes.
    for (const id of ids) {
        const node = TECH_TREE[id];
        const p = pos[id];
        const owned = NeonSave.hasUnlocked(save, id);
        const reqMet = NeonTree.prereqsMet(save, id);
        const cost = NeonTree.effectiveCost(save, id);
        const afford = save.metaXP >= cost;
        let state = 'locked';
        if (owned) state = 'owned';
        else if (!reqMet) state = 'locked';
        else if (afford) state = 'available';
        else state = 'poor';

        const r = node.keystone ? 16 : 12;
        const g = _svg('g', {
            class: 'tt-node tt-' + state + (node.keystone ? ' tt-keystone' : ''),
            tabindex: '0', role: 'button',
            'aria-label': node.name + ' — ' + (owned ? 'owned' : state === 'available' ? ('costs ' + cost + ' XP') : state),
        });
        const disc = _svg('circle', { cx: p.x, cy: p.y, r, class: 'tt-disc' });
        if (!owned) disc.setAttribute('stroke', (TREE_BRANCHES[node.branch] || {}).color || '#38bdf8');
        g.appendChild(disc);
        const glyph = _svg('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle', class: 'tt-glyph' });
        glyph.textContent = owned ? '✓' : (TREE_KIND_GLYPH[node.kind] || '●');
        g.appendChild(glyph);
        // Node name under the disc — so players see what each node grants
        // without hovering. Truncated; the full name + desc stay in the
        // tooltip and the detail panel.
        const nm = node.name.length > 15 ? node.name.slice(0, 14) + '…' : node.name;
        const nameEl = _svg('text', { x: p.x, y: p.y + r + 12, 'text-anchor': 'middle', class: 'tt-name' });
        nameEl.textContent = nm;
        g.appendChild(nameEl);
        const title = _svg('title', {}); title.textContent = node.name + ' — ' + node.desc;
        g.appendChild(title);

        const showDetail = () => {
            const detail = document.getElementById('tree-node-detail');
            if (!detail) return;
            const status = owned ? 'OWNED'
                : !reqMet ? 'LOCKED — unlock its prerequisites first'
                : afford ? (cost + ' XP — click to unlock')
                : (cost + ' XP — need ' + (cost - save.metaXP) + ' more');
            detail.innerHTML = '<strong>' + node.name + '</strong> <span class="tt-detail-status">' + status + '</span><br>' + node.desc;
        };
        g.addEventListener('pointerenter', showDetail);
        g.addEventListener('focus', showDetail);
        const tryBuy = () => {
            if (NeonSave.hasUnlocked(save, id)) { showDetail(); return; }
            const check = NeonTree.canPurchase(save, id);
            if (!check.ok) { showDetail(); return; }   // locked / too poor — panel explains why
            // Confirm before spending — XP is hard-earned and the escalating
            // cost means a mis-tap is expensive.
            if (!confirm('Unlock "' + node.name + '" for ' + check.cost + ' XP?\n\n' + node.desc)) return;
            if (NeonTree.purchase(save, id)) {
                renderTechTree();
                renderLoadoutDropdowns();
                updateMainMenuState();
            } else { showDetail(); }
        };
        g.addEventListener('click', tryBuy);
        g.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                tryBuy();
            }
        });
        nodesG.appendChild(g);
    }
}

// M3: Tower Mastery screen. Shows 9 tower rows with XP progress bars
// and milestone dots. Reads save.towerMastery; no purchase flow.
// Transient per-base mastery view selection ('base'|'variant'), seeded from
// the last run's loadout each time the lab opens so the player lands on the
// setup they were last using.
let mastSelection = {};

// Seed each row's base/variant toggle from the last loadout — shared
// by navigateToTowerMastery and the UPGRADES tab switch.
function seedMastSelection() {
    mastSelection = {};
    const loadout = (save.lastLoadout && save.lastLoadout.towerLoadout) || {};
    for (const base of NeonSave.TOWER_TYPES) {
        const variantId = (typeof TOWER_VARIANTS !== 'undefined') ? TOWER_VARIANTS[base] : null;
        const variantUnlocked = !!(save.towerMastery && save.towerMastery[base]
            && save.towerMastery[base].milestones && save.towerMastery[base].milestones.m1);
        const chosen = loadout[base];
        mastSelection[base] = (chosen && chosen === variantId && variantUnlocked) ? 'variant' : 'base';
    }
}

function navigateToTowerMastery() {
    _enterSubScreen();
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('tower-mastery');
    seedMastSelection();
    renderTowerMastery();
}

// Press-and-hold "spend" binding for repeatable purchase buttons (Mastery
// perks). A tap buys once; holding keeps buying and ramps up — the interval
// shrinks from 360ms toward 40ms the longer the button is held, so a long
// press dumps a whole pile of XP fast. `attempt()` must return true while it
// still did something and false once it can't (maxed / not enough XP), which
// stops the repeat. `onStop` runs once on release for a full re-render.
function bindHoldToSpend(btn, attempt, onStop) {
    let timer = null;
    let delay = 360;
    let held = false;

    function stop() {
        if (!held) return;
        held = false;
        btn.classList.remove('holding');
        if (timer) { clearTimeout(timer); timer = null; }
        if (onStop) onStop();
    }

    function tick() {
        if (!held) return;
        if (!attempt()) { stop(); return; }
        delay = Math.max(40, delay * 0.78);
        timer = setTimeout(tick, delay);
    }

    function start(e) {
        if (btn.disabled || held) return;
        e.preventDefault();
        held = true;
        delay = 360;
        btn.classList.add('holding');
        if (!attempt()) { stop(); return; }   // single tap = one buy
        timer = setTimeout(tick, delay);
    }

    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    // Holding the spacebar/Enter on a focused button autorepeats keydown —
    // route it through the same accelerating path.
    btn.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !held) start(e);
    });
    btn.addEventListener('keyup', stop);
}

function renderTowerMastery() {
    const grid = document.getElementById('mastery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Mirror the rebalanced diminishing curves in entities.js so the label
    // shows the true effect (damage asymptotes +80%, fire rate → 2x).
    const dmgPct  = r => Math.round(0.8 * (1 - Math.pow(0.97, r)) * 100);
    const rateF   = r => 0.5 + 0.5 * Math.pow(0.97, r);
    const ratePct = r => Math.round((1 / rateF(r) - 1) * 100);
    const bountyPct = r => Math.round(0.4 * (1 - Math.pow(0.97, r)) * 100);
    // `desc` powers the hover/long-press tooltip on each perk row so
    // "what does Bounty do?" is answered in-game, not just a number.
    const perkMeta = {
        damage: { label: 'Damage', value: r => `+${dmgPct(r)}%`,
            desc: 'Permanently raises this tower type’s damage every run. Diminishing, no cap.' },
        fireRate: { label: 'Fire Rate', value: r => `+${ratePct(r)}%`,
            desc: 'This tower type fires faster every run. Diminishing toward 2×, no cap.' },
        efficiency: { label: 'Upgrade Cost', value: r => `-${r * 2}%`,
            desc: 'Cheaper in-run upgrades for this tower type (−2% per rank).' },
        bounty: { label: 'Bounty', value: r => `+${bountyPct(r)}%`,
            desc: 'Enemies killed by this tower type drop extra credits during the run (up to +40%). Stacks the more you invest.' }
    };
    const incomePerkMeta = {
        damage: { label: 'Yield / Aura', value: r => `+${dmgPct(r)}%`,
            desc: 'Raises Relay income / Research Node aura strength every run.' },
        fireRate: { label: 'Fire Rate', value: r => `+${ratePct(r)}%`,
            desc: 'No effect on support towers (they don’t fire).' },
        efficiency: { label: 'Upgrade Cost', value: r => `-${r * 2}%`,
            desc: 'Cheaper in-run upgrades for support towers (−2% per rank, the perk that matters most here).' },
        bounty: { label: 'Bounty', value: r => `+${bountyPct(r)}%`,
            desc: 'No effect on support towers (they don’t get kills).' }
    };
    // Per-tower perk sets (the 2026-06 rework — "some perks are useless
    // or redundant"). Every listed perk demonstrably does something for
    // that tower type:
    //   shooters — Damage / Fire Rate / BOUNTY (kills by this type pay
    //              up to +40% extra credits; replaced the −10%-capped
    //              upgrade discount nobody felt);
    //   laser    — Damage / Bounty (fireRate is already at the engine
    //              floor of 1);
    //   income   — Yield / Upgrade Cost (the discount IS meaningful
    //              here: relay upgrades are the economy engine; cap
    //              doubled to −20%). No bounty — relays don't kill.
    const perksForTower = (towerType) => {
        if (towerType === 'laser') return ['damage', 'bounty'];
        // Support / aura towers (Relay, Research Node, Beacon) don't kill and
        // don't fire — Yield + Upgrade Cost are the only perks that matter.
        if (towerType === 'income' || towerType === 'income_research' || towerType === 'beacon')
            return ['damage', 'efficiency'];
        return ['damage', 'fireRate', 'bounty'];
    };
    if (typeof window !== 'undefined') window.__neonPerksForTower = perksForTower;

    let hiddenLocked = 0;
    for (const type of NeonSave.TOWER_TYPES) {
        // Only show towers the player has actually unlocked; tree-gated towers
        // (Relay + the new tree towers) appear here once their Arsenal node is
        // owned. Locked ones are hidden, with a one-line note below.
        if (typeof isTowerUnlocked === 'function' && !isTowerUnlocked(type)) { hiddenLocked++; continue; }
        // Resolve which entry (base vs unlocked variant) this row is currently
        // viewing — driven by mastSelection (seeded from save.lastLoadout on
        // open). The toggle below lets the player switch live.
        const base = type;
        const variantId = (typeof TOWER_VARIANTS !== 'undefined') ? TOWER_VARIANTS[base] : null;
        const baseEntry = save.towerMastery[base];
        const variantUnlocked = !!(baseEntry && baseEntry.milestones && baseEntry.milestones.m1);
        if (mastSelection[base] === 'variant' && !variantUnlocked) mastSelection[base] = 'base';
        const isVariant = mastSelection[base] === 'variant' && variantId;
        const activeKey = isVariant ? variantId : base;
        const mast = save.towerMastery[activeKey] || { xp: 0, totalXP: 0, milestones: { m1: false, m2: false }, perks: { damage: 0, fireRate: 0, efficiency: 0 } };
        if (!mast.perks) mast.perks = { damage: 0, fireRate: 0, efficiency: 0 };
        const towerDef = TOWERS[activeKey] || TOWERS[base];

        const row = document.createElement('div');
        row.className = 'mastery-row';
        if (mast.milestones.m1 && mast.milestones.m2) row.classList.add('maxed');

        const icon = document.createElement('div');
        icon.className = 'mastery-icon';

        const body = document.createElement('div');
        body.className = 'mastery-body';

        const nameRow = document.createElement('div');
        nameRow.className = 'mastery-name-row';
        const label = document.createElement('span');
        label.textContent = towerDef ? towerDef.displayName : type;
        const xpText = document.createElement('span');
        xpText.className = 'mastery-xp-text';
        const totalXP = mast.totalXP || mast.xp || 0;
        const capXP = mast.milestones.m2 ? 10000 : mast.milestones.m1 ? 10000 : 1000;
        xpText.textContent = `${totalXP} / ${capXP} lifetime`;
        nameRow.appendChild(label);
        nameRow.appendChild(xpText);

        // Variant toggle (BASE | VARIANT). The variant button is disabled
        // until the base hits its m1 unlock at 1K lifetime XP.
        let variantToggle = null;
        if (variantId && TOWERS[variantId]) {
            variantToggle = document.createElement('div');
            variantToggle.className = 'mastery-variant-toggle';
            const baseBtn = document.createElement('button');
            baseBtn.className = 'mvb' + (isVariant ? '' : ' active');
            baseBtn.textContent = (TOWERS[base] && TOWERS[base].displayName) || base;
            baseBtn.addEventListener('click', () => { mastSelection[base] = 'base'; renderTowerMastery(); });
            const varBtn = document.createElement('button');
            varBtn.className = 'mvb' + (isVariant ? ' active' : '') + (variantUnlocked ? '' : ' locked');
            varBtn.textContent = TOWERS[variantId].displayName;
            if (variantUnlocked) {
                varBtn.addEventListener('click', () => { mastSelection[base] = 'variant'; renderTowerMastery(); });
            } else {
                varBtn.disabled = true;
                varBtn.title = `Unlock by reaching 1K lifetime XP on ${TOWERS[base].displayName}.`;
            }
            variantToggle.appendChild(baseBtn);
            variantToggle.appendChild(varBtn);
        }

        const bar = document.createElement('div');
        bar.className = 'mastery-bar';
        const fill = document.createElement('div');
        fill.className = 'mastery-bar-fill';
        const progress = Math.min(1, totalXP / capXP);
        fill.style.width = (progress * 100) + '%';
        if (mast.milestones.m2) fill.classList.add('maxed');
        bar.appendChild(fill);

        const spendable = document.createElement('div');
        spendable.className = 'mastery-spendable';
        spendable.textContent = `Spendable ${formatCompact(mast.xp || 0)} XP`;

        const milestones = document.createElement('div');
        milestones.className = 'mastery-milestones';
        const dot1 = document.createElement('span');
        dot1.className = 'mastery-milestone-dot' + (mast.milestones.m1 ? ' hit' : '');
        // Base track milestones gate VARIANT/SKIN unlocks; variant tracks
        // earn their own MASTERED/APEX marks at 1K / 10K lifetime XP.
        dot1.textContent = (mast.milestones.m1 ? '● ' : '○ ') + (isVariant ? 'MASTERED @ 1K' : 'VARIANT @ 1K');
        const dot2 = document.createElement('span');
        dot2.className = 'mastery-milestone-dot' + (mast.milestones.m2 ? ' hit' : '');
        dot2.textContent = (mast.milestones.m2 ? '● ' : '○ ') + (isVariant ? 'APEX @ 10K' : 'SKIN @ 10K');
        milestones.appendChild(dot1);
        milestones.appendChild(dot2);

        const perks = document.createElement('div');
        perks.className = 'mastery-perks';
        const activePerkMeta = (type === 'income' || type === 'beacon' || activeKey === 'income_research') ? incomePerkMeta : perkMeta;
        // Endless perks have an infinite limit — show "Lv N" instead of "N/∞".
        const fmtLv = (lim, rk) => Number.isFinite(lim) ? `${rk}/${lim}` : `Lv ${rk}`;
        for (const perk of perksForTower(activeKey)) {
            const rank = mast.perks[perk] || 0;
            const limit = NeonSave.MASTERY_PERK_LIMITS[perk];
            const cost = NeonSave.getMasteryPerkCost(save, activeKey, perk);
            const perkRow = document.createElement('div');
            perkRow.className = 'mastery-perk-row';
            // Explain what the perk does on hover (desktop) / long-press
            // (mobile) — answers "what does Bounty do?" in-game.
            if (activePerkMeta[perk].desc) perkRow.title = activePerkMeta[perk].desc;

            const info = document.createElement('div');
            info.className = 'mastery-perk-info';
            const title = document.createElement('span');
            title.className = 'mastery-perk-title';
            title.textContent = activePerkMeta[perk].label;
            const value = document.createElement('span');
            value.className = 'mastery-perk-value';
            value.textContent = `${activePerkMeta[perk].value(rank)} · ${fmtLv(limit, rank)}`;
            info.appendChild(title);
            info.appendChild(value);

            const btn = document.createElement('button');
            btn.className = 'mastery-perk-buy';
            const maxed = rank >= limit;
            const missing = Math.max(0, cost - (mast.xp || 0));
            btn.textContent = maxed ? 'MAX' : missing > 0 ? `NEED ${missing}` : `BUY ${cost}`;
            btn.disabled = maxed || mast.xp < cost;
            // Hold to keep spending — accelerates the longer it's held.
            // We update this row in place during the hold (a full re-render
            // would destroy the button mid-press) and do one full refresh on
            // release so sibling perks' affordability is recomputed.
            const attempt = () => {
                if (!NeonSave.purchaseMasteryPerk(save, activeKey, perk)) return false;
                const m = save.towerMastery[activeKey];
                const newRank = m.perks[perk] || 0;
                const newCost = NeonSave.getMasteryPerkCost(save, activeKey, perk);
                const newMaxed = newRank >= limit;
                const stillAfford = !newMaxed && (m.xp || 0) >= newCost;
                const missingNow = Math.max(0, newCost - (m.xp || 0));
                btn.textContent = newMaxed ? 'MAX' : missingNow > 0 ? `NEED ${missingNow}` : `BUY ${newCost}`;
                btn.disabled = newMaxed || !stillAfford;
                value.textContent = `${activePerkMeta[perk].value(newRank)} · ${fmtLv(limit, newRank)}`;
                spendable.textContent = `Spendable ${formatCompact(m.xp || 0)} XP`;
                return stillAfford;
            };
            bindHoldToSpend(btn, attempt, () => renderTowerMastery());

            perkRow.appendChild(info);
            perkRow.appendChild(btn);
            perks.appendChild(perkRow);
        }

        body.appendChild(nameRow);
        if (variantToggle) body.appendChild(variantToggle);
        body.appendChild(bar);
        body.appendChild(spendable);
        body.appendChild(milestones);
        body.appendChild(perks);

        row.appendChild(icon);
        row.appendChild(body);
        grid.appendChild(row);
    }

    // Tell the player where the missing towers went, so the shorter list
    // doesn't read as a bug.
    if (hiddenLocked > 0) {
        const note = document.createElement('div');
        note.className = 'mastery-locked-note';
        note.textContent = `🔒 ${hiddenLocked} more tower${hiddenLocked > 1 ? 's' : ''} unlock in the Tech Tree — master them here once owned.`;
        grid.appendChild(note);
    }
}

// ── Backpack (spatial inventory) ──────────────────────────────────────────
const BP_RARITY_COLOR = {
    common:    '#94a3b8',   // slate
    uncommon:  '#38bdf8',   // cyan
    rare:      '#c084fc',   // violet
    epic:      '#f472b6',   // hot pink
    legendary: '#fbbf24',   // gold
};
// Single-letter rarity badge ('C', 'U', 'R', 'E', 'L') stamped on
// stash chips and on the anchor cell of placed items so a glance
// tells you the tier without reading the colour key.
const BP_RARITY_LETTER = {
    common: 'C', uncommon: 'U', rare: 'R', epic: 'E', legendary: 'L',
};
// Tag icons + tooltip names. Tag → glyph for the inline pill we draw
// next to the item's name and (compact) on the placed anchor cell.
const BP_TAG_ICON = {
    power: '⚡',
    tech:  '⚙',
    econ:  '¢',
    core:  '♥',
};
const BP_TAG_LABEL = {
    power: 'Power',
    tech:  'Tech',
    econ:  'Econ',
    core:  'Core',
};
// Held item while arranging: { source:'stash'|'placed', id, rot }.
let bpHeld = null;
let bpCellEls = {};   // "x,y" -> grid cell element, for non-destructive ghost
// Last painted ghost cell. While an item is held, the ghost stays visible
// here even when the finger drifts off-grid or releases on an invalid
// drop — so the player can see the chosen item is still in hand.
let bpLastGhost = null;

function bpClearGhost() {
    for (const k in bpCellEls) bpCellEls[k].classList.remove('ghost-ok', 'ghost-bad');
    bpLastGhost = null;
}
// Repaint the ghost at its last known cell, clamped into the current
// grid. Used after renderBackpack rebuilds cells (which wipes ghost
// classes) so a held item never looks like nothing's selected.
function bpRepaintLastGhost() {
    if (!bpHeld || !BACKPACK_ITEMS[bpHeld.id]) return;
    const bp = save.backpack;
    if (!bp) return;
    const size = NeonBackpack.shapeSize(BACKPACK_ITEMS[bpHeld.id].shape, bpHeld.rot || 0);
    let x = bpLastGhost ? bpLastGhost.x : 0;
    let y = bpLastGhost ? bpLastGhost.y : 0;
    x = Math.max(0, Math.min(bp.w - size.w, x));
    y = Math.max(0, Math.min(bp.h - size.h, y));
    bpPaintGhost(x, y);
}
// True iff the held item can be dropped at (x, y). Returns false when
// the target is null OR when the shape can't fit / overlaps an
// existing item.
function bpHeldPlacementValid(target) {
    if (!bpHeld || !target) return false;
    const def = BACKPACK_ITEMS[bpHeld.id];
    if (!def) return false;
    return NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, target.x, target.y, bpHeld.rot || 0);
}
// Paint the placement preview by toggling classes on existing cells — never
// re-renders the grid (a re-render would race the click after a hover).
function bpPaintGhost(x, y) {
    if (!bpHeld || !BACKPACK_ITEMS[bpHeld.id]) return;
    // Clear previous classes inline — we don't want to also reset
    // bpLastGhost here (bpClearGhost does that), since the whole point
    // of this paint is to update lastGhost to the new spot.
    for (const k in bpCellEls) bpCellEls[k].classList.remove('ghost-ok', 'ghost-bad');
    const def = BACKPACK_ITEMS[bpHeld.id];
    const okp = NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, x, y, bpHeld.rot);
    for (const [dx, dy] of NeonBackpack.shapeOffsets(def.shape, bpHeld.rot)) {
        const el = bpCellEls[(x + dx) + ',' + (y + dy)];
        if (el) el.classList.add(okp ? 'ghost-ok' : 'ghost-bad');
    }
    bpLastGhost = { x, y };
}

function navigateToBackpack() {
    _enterSubScreen();
    bpHeld = null; bpLastGhost = null;
    hideScreen('main-menu');
    hideScreen('tower-mastery');
    showScreen('backpack');
    renderBackpack();
}

function bpStatus(msg) {
    const el = document.getElementById('bp-status');
    if (el) el.textContent = msg || '';
}

function bpMiniShape(def, rot, container) {
    container.innerHTML = '';
    if (!def) return;
    const offs = NeonBackpack.shapeOffsets(def.shape, rot);
    const size = NeonBackpack.shapeSize(def.shape, rot);
    container.style.gridTemplateColumns = `repeat(${size.w}, 10px)`;
    const set = new Set(offs.map(o => o[0] + ',' + o[1]));
    for (let y = 0; y < size.h; y++) {
        for (let x = 0; x < size.w; x++) {
            const d = document.createElement('div');
            d.className = 'bp-mini-cell' + (set.has(x + ',' + y) ? ' on' : '');
            container.appendChild(d);
        }
    }
}

function bpPersist() { NeonSave.write(save); }

function bpReturnHeldToStash() {
    if (!bpHeld) return;
    // Stash-picked items never LEFT the stash list (they're shown
    // held-in-place, marked green) — putting them back is just
    // releasing the hold. Only grid-picked items get pushed back.
    if (bpHeld.source !== 'stash') save.backpack.stash.push(bpHeld.id);
    bpHeld = null;
    bpLastGhost = null;
}

// Remove the held STASH item from the stash array — called only when
// the item is actually consumed (placed on the grid or sold). Index
// is re-validated since the stash can shift while holding (salvage).
function bpConsumeHeldFromStash() {
    if (!bpHeld || bpHeld.source !== 'stash') return;
    const bp = save.backpack;
    let i = bpHeld.stashIdx;
    if (bp.stash[i] !== bpHeld.id) i = bp.stash.indexOf(bpHeld.id);
    if (i >= 0) bp.stash.splice(i, 1);
}

function bpPickStash(i) {
    const bp = save.backpack;
    if (i < 0 || i >= bp.stash.length) return;
    // Tapping the chip you're already holding is a no-op (mobile
    // double-taps are common; silently dropping the pick would undo
    // the player's intent). Use TO STASH to put it down.
    if (bpHeld && bpHeld.source === 'stash' && bpHeld.stashIdx === i && bpHeld.id === bp.stash[i]) {
        bpStatus('Already holding — tap a grid cell to place, or TO STASH to put down.');
        return;
    }
    if (bpHeld) bpReturnHeldToStash();
    // The item STAYS in the list while held — the renderer marks it
    // green; it's removed only once it lands on the grid (or is sold).
    const id = bp.stash[i];
    bpHeld = { source: 'stash', id, stashIdx: i, rot: 0 };
    bpStatus('Pick a grid cell (top-left) to place ' + (BACKPACK_ITEMS[id] ? BACKPACK_ITEMS[id].name : id) + '.');
    renderBackpack();
}

function bpPickPlaced(idx) {
    const bp = save.backpack;
    if (idx < 0 || idx >= bp.placed.length) return;
    if (bpHeld) bpReturnHeldToStash();
    const p = bp.placed.splice(idx, 1)[0];
    bpHeld = {
        source: 'placed', id: p.id, rot: p.rot || 0,
        // Remember the spot we came from so a single tap can undo the
        // pickup (RESTORE button). Without this, accidentally tapping a
        // placed item on mobile would force the player into a drop /
        // to-stash / discard decision with no escape.
        origin: { x: p.x | 0, y: p.y | 0, rot: p.rot | 0 },
    };
    bpPersist();
    bpStatus('Re-place ' + (BACKPACK_ITEMS[p.id] ? BACKPACK_ITEMS[p.id].name : p.id) + ', RESTORE, or STASH.');
    renderBackpack();
}

function bpPlaceAt(x, y) {
    if (!bpHeld) return;
    const def = BACKPACK_ITEMS[bpHeld.id];
    if (!def) { bpHeld = null; bpLastGhost = null; renderBackpack(); return; }
    if (NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, x, y, bpHeld.rot)) {
        bpConsumeHeldFromStash();    // NOW it leaves the stash list
        save.backpack.placed.push({ id: bpHeld.id, x, y, rot: bpHeld.rot });
        bpHeld = null; bpLastGhost = null;
        bpPersist();
        bpStatus('Placed.');
        renderBackpack();
    } else {
        // Build a status that points to the exact recovery action so
        // the player isn't stuck wondering why nothing happened. RESTORE
        // is only mentioned when an origin exists (placed-pickup).
        const recovery = bpHeld.origin
            ? "Doesn't fit — try ROTATE, RESTORE, or STASH."
            : "Doesn't fit — try ROTATE or STASH.";
        bpStatus(recovery);
        // Flash the held panel so a player whose eyes were on the grid
        // notices the controls. The shake on the grid stays as well.
        const g = document.getElementById('bp-grid');
        if (g) { g.classList.remove('bp-shake'); void g.offsetWidth; g.classList.add('bp-shake'); }
        const heldEl = document.getElementById('bp-held');
        if (heldEl) {
            heldEl.classList.remove('bp-held-flash');
            void heldEl.offsetWidth;
            heldEl.classList.add('bp-held-flash');
        }
    }
}

function bpRotateHeld() {
    if (!bpHeld) return;
    bpHeld.rot = (bpHeld.rot + 1) % 4;
    renderBackpack();
}

// RESTORE — put the held item back where it came from, preserving
// rotation. Only meaningful when the item was picked up from the grid
// (bpHeld.origin is set). For stash-picked items this falls back to
// bpHeldToStash so the button is never a dead end.
function bpRestoreHeld() {
    if (!bpHeld) return;
    const origin = bpHeld.origin;
    if (!origin) { bpHeldToStash(); return; }
    const def = BACKPACK_ITEMS[bpHeld.id];
    if (!def) { bpHeldToStash(); return; }
    // canPlace against the current grid — origin should be empty since
    // we just picked the item up, but defend against concurrent edits.
    if (NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, origin.x, origin.y, origin.rot)) {
        save.backpack.placed.push({ id: bpHeld.id, x: origin.x, y: origin.y, rot: origin.rot });
        bpHeld = null; bpLastGhost = null;
        bpPersist();
        bpStatus('Restored.');
        renderBackpack();
    } else {
        // Origin is no longer valid (someone filled it). Fall through to
        // stash so the player isn't stuck.
        bpHeldToStash();
        bpStatus('Original spot unavailable — sent to stash.');
    }
}

function bpHeldToStash() {
    if (!bpHeld) return;
    // Stash-sourced items are still IN the list (held-in-place) — just
    // release; grid-sourced items get appended.
    bpReturnHeldToStash();
    bpPersist();
    renderBackpack();
}

function bpSellHeld() {
    if (!bpHeld) return;
    const def = BACKPACK_ITEMS[bpHeld.id];
    const rarity = def && def.rarity;
    bpConsumeHeldFromStash();        // selling consumes the listed copy
    const refund = NeonSave.sellItem(save, rarity);
    bpHeld = null; bpLastGhost = null;
    if (typeof updateMainMenuState === 'function') updateMainMenuState();
    bpStatus(refund > 0
        ? `Sold ${def ? def.name : 'item'} for ${refund} meta-XP.`
        : 'Sold item.');
    renderBackpack();
}

function bpSalvage() {
    const cost = NeonSave.getSalvageCost(save);
    if (save.metaXP < cost) { bpStatus(`Need ${cost - save.metaXP} more meta-XP.`); return; }
    const id = NeonBackpack.salvageRoll(BACKPACK_ITEMS, BACKPACK_RARITY_WEIGHT);
    NeonSave.salvage(save, id);   // deducts XP, pushes to stash, persists
    if (typeof updateMainMenuState === 'function') updateMainMenuState();
    const def = BACKPACK_ITEMS[id];
    const nextCost = NeonSave.getSalvageCost(save);
    bpStatus(`Bought ${def ? def.name : id} (${def ? def.rarity : '?'}) → stash. Next: ${nextCost} XP.`);
    renderBackpack();
}

function bpExpand(axis) {
    const paid = NeonSave.expandBackpack(save, axis);
    if (paid < 0) {
        const expCost = NeonSave.getExpandCost(save);
        bpStatus(save.metaXP < expCost ? `Need ${expCost - save.metaXP} more meta-XP.` : 'Grid already at max size.');
        return;
    }
    if (typeof updateMainMenuState === 'function') updateMainMenuState();
    bpStatus(`Expanded to ${save.backpack.w}×${save.backpack.h} for ${paid} XP.`);
    renderBackpack();
}

function bpBuyLuck() {
    if (!NeonSave.luckBoostUnlocked(save)) {
        bpStatus('Reach wave 20 in any run to unlock the Luck booster.');
        return;
    }
    const paid = NeonSave.buyLuckBoost(save);
    if (paid < 0) {
        const cost = NeonSave.getLuckBoostCost(save);
        bpStatus(`Need ${cost - save.metaXP} more meta-XP.`);
        return;
    }
    if (typeof updateMainMenuState === 'function') updateMainMenuState();
    bpStatus(`Luck +1% (now +${save.backpack.luckBoost}%) for ${paid} XP.`);
    renderBackpack();
}

function renderBackpack() {
    const bp = save.backpack;
    if (!bp) return;
    const xpEl = document.getElementById('bp-xp');
    if (xpEl) xpEl.textContent = 'Meta-XP: ' + save.metaXP;
    // Helper: when a sink button can't be bought, swap its cost label to
    // "NEED N XP MORE" so it's obviously a price issue, not a broken button.
    const setCostLabel = (el, cost, affordable, max = false) => {
        if (!el) return;
        if (max)              el.textContent = 'MAX';
        else if (affordable)  el.textContent = `${cost} XP`;
        else                  el.textContent = `NEED ${cost - save.metaXP} XP MORE`;
    };

    const cost = NeonSave.getSalvageCost(save);
    const canSalvage = save.metaXP >= cost;
    setCostLabel(document.getElementById('bp-salvage-cost'), cost, canSalvage);
    const salvageBtn = document.getElementById('bp-salvage');
    if (salvageBtn) salvageBtn.disabled = !canSalvage;

    // Bag expansion controls
    const expCost = NeonSave.getExpandCost(save);
    const canExpand = save.metaXP >= expCost;
    const ewBtn = document.getElementById('bp-expand-w');
    const ehBtn = document.getElementById('bp-expand-h');
    document.querySelectorAll('.bp-exp-cost').forEach((el) => {
        const owner = el.closest('button');
        const axisMaxed = owner === ewBtn ? bp.w >= 9 : bp.h >= 8;
        setCostLabel(el, expCost, canExpand, axisMaxed);
    });
    if (ewBtn) ewBtn.disabled = bp.w >= 9 || !canExpand;
    if (ehBtn) ehBtn.disabled = bp.h >= 8 || !canExpand;

    // Salvage Luck — small permanent boost to next-run drop chance.
    const luckRank = bp.luckBoost || 0;
    const luckCost = NeonSave.getLuckBoostCost(save);
    const luckUnlocked = NeonSave.luckBoostUnlocked(save);
    const luckBtn  = document.getElementById('bp-luck');
    const luckStat = document.getElementById('bp-luck-stat');
    const luckCostEl = document.getElementById('bp-luck-cost');
    if (luckStat) luckStat.textContent = `+${luckRank}%`;
    if (luckCostEl) {
        if (!luckUnlocked)              luckCostEl.textContent = 'LOCKED';
        else if (save.metaXP >= luckCost) luckCostEl.textContent = `${luckCost} XP`;
        else                            luckCostEl.textContent = `NEED ${luckCost - save.metaXP} XP MORE`;
    }
    if (luckBtn) {
        luckBtn.disabled = !luckUnlocked || save.metaXP < luckCost;
        luckBtn.title = luckUnlocked
            ? `+1% to next end-of-run drop chance (current bonus +${luckRank}%, capped overall at ${Math.round(NeonSave.LUCK_CHANCE_CAP * 100)}%).`
            : 'Reach wave 20 in any run to unlock.';
    }

    // Body class tracks whether an item is held so CSS can disable
    // scroll/pan gestures on every grid cell. Without this, dragging
    // the item downward scrolls the whole page.
    document.body.classList.toggle('bp-holding', !!bpHeld);

    // Held panel — same DOM + layout regardless of state. Toggle
    // is-empty + button disabled flags to swap between placeholder
    // and active. Layout dimensions stay identical so picking an
    // item up doesn't shift the grid below.
    const heldWrap = document.getElementById('bp-held');
    const rotateBtn  = document.getElementById('bp-rotate');
    const stashBtn   = document.getElementById('bp-tostash');
    const discardBtn = document.getElementById('bp-discard');
    const restoreBtn = document.getElementById('bp-restore');
    if (bpHeld && BACKPACK_ITEMS[bpHeld.id]) {
        const def = BACKPACK_ITEMS[bpHeld.id];
        heldWrap.classList.remove('is-empty');
        heldWrap.classList.remove('hidden');     // back-compat with old saves
        document.getElementById('bp-held-name').textContent = def.name;
        bpMiniShape(def, bpHeld.rot, document.getElementById('bp-held-shape'));
        const descEl = document.getElementById('bp-held-desc');
        if (descEl) descEl.textContent = def.desc || '';
        const sellEl = document.getElementById('bp-sell-val');
        if (sellEl) {
            const refund = NeonSave.getSellRefund(def.rarity);
            sellEl.textContent = refund > 0 ? `+${refund}` : '';
        }
        // Enable the action buttons.
        if (rotateBtn)  rotateBtn.disabled  = false;
        if (stashBtn)   stashBtn.disabled   = false;
        if (discardBtn) discardBtn.disabled = false;
        // RESTORE is only meaningful when the held item came from the
        // grid (origin set). Hidden for stash pickups.
        if (restoreBtn) {
            restoreBtn.classList.toggle('hidden', !bpHeld.origin);
            restoreBtn.disabled = !bpHeld.origin;
        }
    } else {
        // Placeholder state — buttons disabled, dimmed via .is-empty.
        // Keep the same children rendered so layout is unchanged.
        heldWrap.classList.add('is-empty');
        heldWrap.classList.remove('hidden');
        document.getElementById('bp-held-name').textContent = '—';
        const d = document.getElementById('bp-held-desc');
        if (d) d.textContent = 'tap an item to pick it up';
        // Render a 1×1 placeholder shape so the mini-shape area is the
        // same size in both states.
        const shapeEl = document.getElementById('bp-held-shape');
        if (shapeEl) bpMiniShape({ shape: [[1]] }, 0, shapeEl);
        const sv = document.getElementById('bp-sell-val'); if (sv) sv.textContent = '';
        if (rotateBtn)  rotateBtn.disabled  = true;
        if (stashBtn)   stashBtn.disabled   = true;
        if (discardBtn) discardBtn.disabled = true;
        if (restoreBtn) { restoreBtn.classList.add('hidden'); restoreBtn.disabled = true; }
    }

    // Grid
    const gridEl = document.getElementById('bp-grid');
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${bp.w}, var(--bp-cell))`;
    const occ = NeonBackpack.occupancy(bp, BACKPACK_ITEMS);
    bpCellEls = {};
    for (let y = 0; y < bp.h; y++) {
        for (let x = 0; x < bp.w; x++) {
            const cell = document.createElement('div');
            cell.className = 'bp-cell';
            const key = x + ',' + y;
            bpCellEls[key] = cell;
            const ownerIdx = occ[key];
            if (ownerIdx !== undefined) {
                const pItem = bp.placed[ownerIdx];
                const def = BACKPACK_ITEMS[pItem.id];
                cell.classList.add('filled');
                if (def && def.rarity) cell.dataset.rarity = def.rarity;
                const color = BP_RARITY_COLOR[def && def.rarity] || '#64748b';
                cell.style.background = color + '33';
                // Shape-aware borders: thick on the outline of the
                // item, transparent on edges shared with another cell
                // of the SAME item. Otherwise T / L / S items melt
                // together in the grid and you can't see where one
                // ends and the next begins.
                const sameOwner = (nx, ny) => occ[nx + ',' + ny] === ownerIdx;
                const thick = `2px solid ${color}`;
                const thin  = `1px solid ${color}55`; // soft interior divider
                cell.style.borderTop    = sameOwner(x, y - 1) ? thin : thick;
                cell.style.borderRight  = sameOwner(x + 1, y) ? thin : thick;
                cell.style.borderBottom = sameOwner(x, y + 1) ? thin : thick;
                cell.style.borderLeft   = sameOwner(x - 1, y) ? thin : thick;
                // ANCHOR-CELL DECORATION ────────────────────────────
                // The top-left cell of every placed item gets:
                //   * the item's first letter (legible, big)
                //   * a small rarity letter badge in the corner
                //   * a tag-icon row above the name letter
                // so rarity + type are obvious without reading the
                // tooltip, even on a crowded grid.
                if (pItem.x === x && pItem.y === y) {
                    cell.classList.add('bp-anchor');
                    if (def) {
                        const rarBadge = document.createElement('span');
                        rarBadge.className = 'bp-rarity-badge';
                        rarBadge.dataset.rarity = def.rarity || 'common';
                        rarBadge.textContent = BP_RARITY_LETTER[def.rarity] || '?';
                        rarBadge.style.color = color;
                        cell.appendChild(rarBadge);

                        const tags = Array.isArray(def.tags) ? def.tags : [];
                        if (tags.length > 0) {
                            const tagRow = document.createElement('span');
                            tagRow.className = 'bp-tag-row';
                            for (const tg of tags) {
                                const ic = document.createElement('span');
                                ic.className = 'bp-tag-icon bp-tag-' + tg;
                                ic.textContent = BP_TAG_ICON[tg] || '·';
                                ic.title = BP_TAG_LABEL[tg] || tg;
                                tagRow.appendChild(ic);
                            }
                            cell.appendChild(tagRow);
                        }

                        const letter = document.createElement('span');
                        letter.className = 'bp-name-letter';
                        letter.textContent = def.name[0];
                        cell.appendChild(letter);
                    } else {
                        cell.textContent = '?';
                    }
                }
                if (def) {
                    const rarityLabel = def.rarity
                        ? def.rarity.charAt(0).toUpperCase() + def.rarity.slice(1)
                        : 'Common';
                    const tagsLabel = Array.isArray(def.tags) && def.tags.length
                        ? def.tags.map(t => BP_TAG_LABEL[t] || t).join(', ')
                        : '—';
                    cell.title =
                        `${def.name}\n${rarityLabel} · ${tagsLabel}\n${def.desc || ''}`;
                }
                cell.dataset.placedIdx = String(ownerIdx);     // needed by the touch-drag handler
                cell.addEventListener('click', () => {
                    // Filled cell tapped while the held item's ghost is
                    // covering it (ghost-bad means the held item's
                    // footprint overlaps THIS cell). Treat as a
                    // place attempt — refused with red feedback —
                    // NOT as a pickup of the underlying item. Otherwise
                    // the player who tried to place an oversized item
                    // on top of an existing one would accidentally
                    // swap the two.
                    if (bpHeld && cell.classList.contains('ghost-bad')) {
                        const at = bpLastGhost || { x, y };
                        bpPlaceAt(at.x, at.y);
                        return;
                    }
                    bpPickPlaced(ownerIdx);
                });
                // Hovering a filled cell while holding — leave the
                // last ghost where it is so the player can still see
                // their choice. Painting here would highlight cells
                // already occupied by another item, which is noisy.
            } else {
                cell.addEventListener('click', () => bpPlaceAt(x, y));
                // Non-destructive hover preview (no re-render → click survives).
                cell.addEventListener('mouseenter', () => { if (bpHeld) bpPaintGhost(x, y); });
            }
            gridEl.appendChild(cell);
        }
    }
    // Note: no mouseleave clear — while an item is held the ghost
    // should persist at its last position so the player can see the
    // chosen item is still in hand.
    if (bpHeld) bpRepaintLastGhost();

    // Stash
    const stashEl = document.getElementById('bp-stash');
    stashEl.innerHTML = '';
    document.getElementById('bp-stash-count').textContent = `(${bp.stash.length})`;
    bp.stash.forEach((id, i) => {
        const def = BACKPACK_ITEMS[id];
        const chip = document.createElement('button');
        chip.className = 'bp-chip';
        chip.dataset.stashIdx = String(i);
        if (def && def.rarity) chip.dataset.rarity = def.rarity;
        chip.style.borderColor = BP_RARITY_COLOR[def && def.rarity] || '#64748b';
        // Held-in-place: a stash pick stays listed, marked green, until
        // it's actually placed on the grid (or sold).
        if (bpHeld && bpHeld.source === 'stash' && bpHeld.stashIdx === i && bpHeld.id === id) {
            chip.classList.add('bp-chip-held');
            chip.style.borderColor = '#34d399';
        }
        const shape = document.createElement('div');
        shape.className = 'bp-mini';
        bpMiniShape(def, 0, shape);
        const text = document.createElement('div');
        text.className = 'bp-chip-text';
        // Header row: name + rarity pill + tag pills. The pills give
        // glanceable category info on every stash item; the old chip
        // only had border colour and inconsistent first-letter cues.
        const head = document.createElement('span');
        head.className = 'bp-chip-head';
        const label = document.createElement('span');
        label.className = 'bp-chip-name';
        label.textContent = def ? def.name : id;
        head.appendChild(label);
        if (def && def.rarity) {
            const rarPill = document.createElement('span');
            rarPill.className = 'bp-pill bp-pill-rarity';
            rarPill.dataset.rarity = def.rarity;
            rarPill.textContent = def.rarity.toUpperCase();
            rarPill.style.color = BP_RARITY_COLOR[def.rarity];
            rarPill.style.borderColor = BP_RARITY_COLOR[def.rarity];
            head.appendChild(rarPill);
        }
        if (def && Array.isArray(def.tags)) {
            for (const tg of def.tags) {
                const tagPill = document.createElement('span');
                tagPill.className = 'bp-pill bp-pill-tag bp-tag-' + tg;
                tagPill.textContent = (BP_TAG_ICON[tg] || '·') + ' ' + (BP_TAG_LABEL[tg] || tg);
                head.appendChild(tagPill);
            }
        }
        const desc = document.createElement('span');
        desc.className = 'bp-chip-desc';
        desc.textContent = def && def.desc ? def.desc : '';
        text.appendChild(head);
        text.appendChild(desc);
        chip.appendChild(shape);
        chip.appendChild(text);
        if (def) {
            const rarityLabel = def.rarity
                ? def.rarity.charAt(0).toUpperCase() + def.rarity.slice(1)
                : 'Common';
            const tagsLabel = Array.isArray(def.tags) && def.tags.length
                ? def.tags.map(t => BP_TAG_LABEL[t] || t).join(', ')
                : '—';
            chip.title = `${def.name}\n${rarityLabel} · ${tagsLabel}\n${def.desc || ''}`;
        }
        chip.addEventListener('click', () => bpPickStash(i));
        stashEl.appendChild(chip);
    });
    if (bp.stash.length === 0 && !bpHeld) bpStatus(bpHeld ? '' : (document.getElementById('bp-status').textContent || ''));
}

// Renders the XP breakdown in the game-over overlay. Called by
// window.onRunEnded after XP has been applied to the save.
function renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults, retired, lootGranted, lootRoll, cheaterReason }) {
    document.querySelectorAll('.xp-breakdown-unlock.mastery-banner, .xp-breakdown-unlock.loot-banner, .xp-breakdown-unlock.aegis-banner').forEach(el => el.remove());

    // Aegis lock — withheld rewards. Show a prominent banner explaining why
    // and skip the rest of the dynamic banners (no mastery/loot when
    // cheating). XP rows still render (all zeros) so the breakdown layout
    // stays consistent.
    if (cheaterReason) {
        const wrap = document.createElement('div');
        wrap.className = 'xp-breakdown-unlock aegis-banner';
        wrap.innerHTML = '⛔ <strong>AEGIS LOCK</strong> — anomaly detected (' + cheaterReason +
                         '). Rewards withheld this session. <em>RESET SAVE</em> to clear.';
        const anchorId = retired ? 'victory-xp-unlock' : 'xp-unlock';
        const anchor = document.getElementById(anchorId);
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);
    }

    if (retired) {
        document.getElementById('victory-xp-wave').textContent    = xp.waveXP;
        document.getElementById('victory-xp-clear').textContent   = xp.clearBonus;
        document.getElementById('victory-xp-first').textContent   = xp.firstBonus;
        document.getElementById('victory-xp-retire').textContent  = xp.retireBonus || 0;
        document.getElementById('victory-xp-total').textContent   = xp.total;
        document.getElementById('victory-xp-balance').textContent = formatCompact(save.metaXP);
        document.getElementById('victory-xp-clear-row').classList.toggle('hidden', xp.clearBonus === 0);
        document.getElementById('victory-xp-first-row').classList.toggle('hidden', xp.firstBonus === 0);
    } else {
        document.getElementById('xp-wave').textContent     = xp.waveXP;
        document.getElementById('xp-clear').textContent    = xp.clearBonus;
        document.getElementById('xp-first').textContent    = xp.firstBonus;
        document.getElementById('xp-total').textContent    = xp.total;
        document.getElementById('xp-balance').textContent  = formatCompact(save.metaXP);
        document.getElementById('xp-clear-row').classList.toggle('hidden', xp.clearBonus === 0);
        document.getElementById('xp-first-row').classList.toggle('hidden', xp.firstBonus === 0);
    }

    const unlockId = retired ? 'victory-xp-unlock' : 'xp-unlock';
    const unlock = document.getElementById(unlockId);
    if (firstClear) {
        const nextTier = tier + 1;            // endless — every clear unlocks the next tier
        const nextSpec = getAscensionTierSpec(nextTier);
        let text = `UNLOCKED: ${nextSpec.label} — ${nextSpec.name}`;
        if (autoUnlockedNodeId) {
            const node = getTreeNode(autoUnlockedNodeId);
            if (node) text += ` · FREE NODE: ${autoUnlockedNodeId}`;
        }
        unlock.textContent = text;
        unlock.classList.remove('hidden');
    } else {
        unlock.classList.add('hidden');
    }

    if (!retired && masteryResults && masteryResults.length > 0) {
        const milestoneHits = masteryResults.filter(r => r.newMilestones && r.newMilestones.length > 0);
        if (milestoneHits.length > 0) {
            const lines = milestoneHits.map(r => {
                const names = r.newMilestones.map(m => m === 'm1' ? 'VARIANT' : 'SKIN').join(' + ');
                return `${TOWERS[r.type]?.displayName || r.type}: ${names}`;
            });
            const wrap = document.createElement('div');
            wrap.className = 'xp-breakdown-unlock mastery-banner';
            wrap.textContent = 'MASTERY: ' + lines.join(' · ');
            const unlockEl = document.getElementById('xp-unlock');
            unlockEl.parentNode.insertBefore(wrap, unlockEl.nextSibling);
        }
    }

    // Loot banner — show both hits and misses so the probability gate
    // (wave ≥ 20, climbing chance, never 100%) reads clearly.
    if (lootRoll) {
        const pct = Math.round(lootRoll.chance * 100);
        const boostPct = Math.round((lootRoll.boost || 0) * 100);
        const boostSuffix = boostPct > 0 ? ` · +${boostPct}% luck` : '';
        const wrap = document.createElement('div');
        wrap.className = 'xp-breakdown-unlock loot-banner';
        if (lootGranted && lootGranted.length > 0) {
            const names = lootGranted.map(id => {
                const def = (typeof BACKPACK_ITEMS !== 'undefined') && BACKPACK_ITEMS[id];
                return def ? def.name : id;
            });
            wrap.textContent = `📦 SALVAGE (${pct}%${boostSuffix}): ${names.join(' · ')} → backpack`;
        } else {
            wrap.textContent = `📦 SALVAGE roll ${pct}%${boostSuffix} — no drop this run`;
            wrap.classList.add('loot-banner-miss');
        }
        const anchorId = retired ? 'victory-xp-unlock' : 'xp-unlock';
        const anchor = document.getElementById(anchorId);
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    }
}

// M2: Wave preview popup. Used by Scan ability and Strategist kit.
// `count` = number of upcoming waves to reveal (3 for Scan; 9999 for Strategist).
function showWavePreview(count) {
    let panel = document.getElementById('wave-preview');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'wave-preview';
        panel.className = 'overlay';
        document.getElementById('game-container').appendChild(panel);
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<h3>WAVE PREVIEW</h3><div id="wave-preview-list"></div><button id="wave-preview-close">CLOSE</button>';

    const list = panel.querySelector('#wave-preview-list');
    list.innerHTML = '';
    const entries = game.getWavePreview(count);
    for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'wave-preview-row';
        row.textContent = `Wave ${entry.wave}: ${entry.count}× ${entry.type}`;
        list.appendChild(row);
    }
    panel.querySelector('#wave-preview-close').addEventListener('click', () => panel.classList.add('hidden'));
}

function resizeCanvas() {
    const canvas = document.getElementById('game-canvas');
    const container = document.getElementById('game-container');
    if (!canvas || !container) return;

    // The CANVAS fills the whole container — no letterbox element, no black
    // bars. The fixed-aspect playfield is drawn CENTRED inside it at contain
    // scale (so the path is always fully on-screen, same shape + size), and the
    // surrounding area is filled by EXTENDING the grass grid past the field
    // edges (Game._drawMapLayer). The extension is the same grid drawn in the
    // same render transform, so it's seamless and zooms with the field — no
    // separate backdrop to keep in sync.
    const canvasCssW = container.clientWidth;
    const canvasCssH = container.clientHeight;
    const containerAspect = canvasCssW / canvasCssH;
    const gameAspect = window.COLS / window.ROWS;

    // Contain-fit the field within the container (preserves board aspect —
    // never stretched or cropped).
    let fieldCssW, fieldCssH;
    if (containerAspect > gameAspect) {
        fieldCssH = canvasCssH;
        fieldCssW = canvasCssH * gameAspect;
    } else {
        fieldCssW = canvasCssW;
        fieldCssH = canvasCssW / gameAspect;
    }

    canvas.style.width = canvasCssW + 'px';
    canvas.style.height = canvasCssH + 'px';

    // High-DPI display scaling — cap at 2× so mobile WebView doesn't render
    // 9× the pixels (3× DPR² = 9×) and tank frame rate.
    const rawDpr = window.devicePixelRatio || 1;
    // "Crisp graphics" OPTION supersamples (2× backing, capped at 4× effective)
    // so the view sharpens even on DPR-1 desktops where raising the cap alone
    // does nothing; off, cap at 2× to protect mobile frame rate.
    let hiQ = false; try { hiQ = localStorage.getItem('neonHiQuality') === '1'; } catch (_) {}
    const dpr = hiQ ? Math.min(rawDpr * 2, 4) : Math.min(rawDpr, 2);
    const newW = Math.round(canvasCssW * dpr);
    const newH = Math.round(canvasCssH * dpr);
    // Assigning canvas.width/height CLEARS and reallocates the bitmap even when
    // the value is unchanged. On mobile web the URL bar collapses during a drag
    // → fires visualViewport/resize with the SAME size → without this guard the
    // canvas was reallocated every frame mid-pan ("web laggy, APK smooth": the
    // APK has no URL bar). Only touch the backing when the size truly changes.
    const backingChanged = canvas.width !== newW || canvas.height !== newH;
    if (backingChanged) {
        canvas.width = newW;
        canvas.height = newH;
    }

    // Expose performance flag: true when the device pixel ratio was capped.
    // Used by draw code to skip expensive shadow/glow effects on low-power paths.
    window.NEON_LOW_PERF = rawDpr > 2;

    const logicalWidth = window.COLS * window.TILE_SIZE;
    // device px per logical unit at zoom 1 — driven by the FIELD size (the
    // field keeps its aspect; only the surround is extended), NOT the canvas.
    window.RENDER_SCALE = (fieldCssW * dpr) / logicalWidth;
    // CSS-px → device-px factor; game.draw uses it to convert the
    // pinch-zoom pan offset (kept in CSS px) into the render transform.
    window.RENDER_DPR = dpr;
    // Field origin offset (CSS px) that centres the field in the full canvas.
    // game.draw adds it to the render transform; getCanvasPos subtracts it.
    window.FIELD_OFFX_CSS = Math.max(0, (canvasCssW - fieldCssW) / 2);
    window.FIELD_OFFY_CSS = Math.max(0, (canvasCssH - fieldCssH) / 2);
    window.FIELD_CSS_W = fieldCssW;
    window.FIELD_CSS_H = fieldCssH;

    // Backing size or scale changed → the cached static map layer no
    // longer matches; force a re-rasterization on the next draw. Unchanged
    // backing → keep the cache (avoids a full vector redraw on no-op resizes).
    if (backingChanged && typeof game !== 'undefined' && game) game._mapLayerKey = null;

    // Force immediate redraw if paused. Guarded: during a FIELD
    // orientation change this can run on a game built for the OLD
    // dimensions — a draw failure here must never abort the caller
    // (restartGame used to die on it, killing the start button).
    if (typeof game !== 'undefined' && game.state !== 'playing') {
        try { game.draw(); } catch (_) {}
    }
}

// True when the device is held in the "secondary" (180°-from-primary)
// orientation — landscape-secondary / portrait-secondary.
function isDeviceSecondaryOrientation() {
    try {
        const t = (screen.orientation && screen.orientation.type) || '';
        if (t) return /secondary/.test(t);
    } catch (_) {}
    const o = window.orientation;            // deprecated fallback
    return o === 180 || o === -90 || o === 270;
}
// Canvas display rotation = the 180° auto-flip only. The portrait/landscape
// "Screen orientation" toggle no longer rotates the canvas — it rotates the
// WHOLE device UI natively via screen.orientation.lock() (see
// applyScreenRotation), so there's nothing to un-rotate in input handling.
function canvasRotationDeg() {
    return window.__neonFlip180 ? 180 : 0;
}
function applyCanvasTransform() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const d = canvasRotationDeg();
    canvas.style.transform = d ? ('rotate(' + d + 'deg)') : '';
}
// "Auto-flip orientation" OPTION (default on): when enabled AND the device is
// upside-down (secondary orientation), rotate the canvas 180° so the field
// stays upright. 180° is pixel-lossless; pointer input is rotated around the
// canvas centre. Pure no-op on desktop / primary orientation.
function applyAutoFlip() {
    let enabled = true;
    try { enabled = localStorage.getItem('neonAutoFlip') !== '0'; } catch (_) {}
    window.__neonFlip180 = enabled && isDeviceSecondaryOrientation();
    applyCanvasTransform();
}
// "Screen orientation" OPTION (Portrait ⇄ Landscape): lock the DEVICE
// orientation so the player can hold the phone whichever way they like and the
// OS rotates the WHOLE UI — top bar, dock, canvas — natively, filling the
// screen. No canvas transform, no input remap. No-op where the platform won't
// lock (desktop browsers outside fullscreen); harmless there.
function applyScreenRotation() {
    let portrait = false;
    try { portrait = localStorage.getItem('neonScreenRotate') === '1'; } catch (_) {}
    window.__neonScreenRotate = portrait;
    // APK: native setRequestedOrientation — overrides the manifest reliably,
    // rotates the whole native UI. This is the load-bearing path on device.
    try {
        if (window.NeonAndroid && typeof window.NeonAndroid.setPortrait === 'function') {
            window.NeonAndroid.setPortrait(portrait);
        }
    } catch (_) {}
    // Web/PWA: screen.orientation.lock (rejects outside fullscreen → ignored).
    try {
        const orient = screen.orientation;
        if (orient && typeof orient.lock === 'function') {
            const p = orient.lock(portrait ? 'portrait' : 'landscape');
            if (p && typeof p.catch === 'function') p.catch(() => {}); // ponytail: desktop rejects; fine
        }
    } catch (_) {}
    if (typeof resizeCanvas === 'function') { try { resizeCanvas(); } catch (_) {} }
}

window.addEventListener('resize', resizeCanvas);
// iOS Safari sometimes fires `orientationchange` without a subsequent
// `resize`, and landscape-portrait switches reshape the layout. Re-run the
// DPR-aware sizing after the browser has committed the new orientation.
window.addEventListener('orientationchange', () => {
    applyAutoFlip();
    setTimeout(resizeCanvas, 50);
    setTimeout(resizeCanvas, 250);
    setTimeout(resizeCanvas, 600); // extra pass after flex layout settles
});
try { if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', applyAutoFlip); } catch (_) {}
applyAutoFlip();         // initial state at load
applyScreenRotation();   // honour the saved Screen-orientation toggle
// Also catch resize events that follow orientation changes on Android
window.addEventListener('resize', () => {
    clearTimeout(window._resizeDebounce);
    window._resizeDebounce = setTimeout(resizeCanvas, 100);
});

// Handle viewport changes when address bar shows/hides on mobile browsers
let lastHeight = window.innerHeight;
window.visualViewport?.addEventListener('resize', () => {
    const currentHeight = window.visualViewport.height;
    // Only resize if the change is significant (more than 50px)
    // to avoid constant redraws during scrolling
    if (Math.abs(currentHeight - lastHeight) > 50) {
        lastHeight = currentHeight;
        resizeCanvas();
    }
});

// Touch vs mouse detection — runs immediately, before init().
// Adds body.touch-ui when a touch device is detected, removes it if the
// user switches to a real mouse (pointer move with no buttons pressed and
// pointerType === 'mouse'). This lets CSS target touch users at any screen
// size without affecting desktop mouse users.
(function detectInputMode() {
    // Start in touch mode if the device reports touch support.
    if (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) {
        document.body.classList.add('touch-ui');
    }

    // Upgrade to mouse mode the first time a real mouse moves.
    window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse') {
            document.body.classList.remove('touch-ui');
        }
    }, { passive: true });

    // Switch back to touch mode on first touch.
    window.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            document.body.classList.add('touch-ui');
        }
    }, { passive: true });
})();

function init() {
    const canvas = document.getElementById('game-canvas');
    // Fixed logical resolution for perfect game balance. 24×16 wide by
    // default; the FIELD: TALL option transposes to 16×24 (portrait,
    // enemies from above) — same tile count, same balance. restartGame
    // re-applies this per run (and forces WIDE in multiplayer).
    const _bootFieldTall = (() => {
        try { return localStorage.getItem('neonFieldTall') === '1'; } catch (_) { return false; }
    })();
    window.COLS = _bootFieldTall ? 16 : 24;
    window.ROWS = _bootFieldTall ? 24 : 16;
    window.TILE_SIZE = 40;

    // Declare speed state early so updateSpeedColor() can reference them
    // regardless of call order within init().
    let speedClickCount = 0;
    let speedClickTimer = null;
    let ultraSpeedUnlocked = false;
    
    resizeCanvas(); // Scale to fit screen and set High-DPI bounds

    // Read seed from URL hash if present
    let urlSeed = null;
    if (window.location.hash) {
        let parsed = parseInt(window.location.hash.slice(1));
        if (!isNaN(parsed)) urlSeed = parsed;
    }

    function updateSeedDisplay() {
        document.getElementById('seed-display').textContent = game.seed;
        history.replaceState(null, '', '#' + game.seed);
    }

    game = new Game(canvas, urlSeed, selectedTier, {
        heroId: selectedHero,
        kitId: selectedKit,
        abilityId: selectedAbility,
        towerLoadout: sanitizeTowerLoadout(selectedTowerLoadout)
    });
    window.game = game;   // cross-script access (minigame / boon picker)
    if (typeof NeonAegis !== 'undefined') NeonAegis.protectGame(game);

    game.draw();
    game.updateUI();
    updateSeedDisplay();
    updateModeDisplay();
    updateSpeedColor();

    // Populate all three Ascension selectors.
    renderAscensionSelector('start');
    renderAscensionSelector('gameover');
    renderAscensionSelector('restart');

    // M2: Populate Run Setup dropdowns + Main Menu state on initial load.
    renderLoadoutDropdowns();
    updateMainMenuState();

    // Ensure Main Menu is visible on initial page load.
    showScreen('main-menu');

    // The "quick launch / skip setup" toggle was removed — START RUN
    // always shows the launch screen with the level choice. (Existing
    // skipRunSetup prefs are force-reset to false in NeonSave.load.)

    // M2: Main Menu wiring — landing screen.
    document.getElementById('menu-start-btn').addEventListener('click', () => {
        // Always show the launch screen so the ASCENSION (level) choice
        // is offered every time — "skip setup" used to launch instantly
        // and removed that choice, which players missed. Skip-setup now
        // just collapses the loadout dropdowns (handled in
        // navigateToRunSetup); the level picker + INITIALIZE stay.
        navigateToRunSetup();
    });
    document.getElementById('menu-tree-btn').addEventListener('click', () => {
        // UPGRADES opens on the MASTERY tab by default (user request —
        // it's the screen players visit every run); TECH TREE is one
        // tab flip away.
        navigateToTowerMastery();
    });
    // UPGRADES tab strip — TECH TREE and MASTERY LAB are one menu now.
    // Switching tabs swaps the overlay in place WITHOUT pushing the
    // back-stack (uiGoBack still exits to wherever UPGRADES was opened
    // from, no matter how many tab flips happened).
    document.querySelectorAll('.upg-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const which = tab.dataset.upgTab;
            const onTree = !document.getElementById('tech-tree').classList.contains('hidden');
            if (which === 'tree' && !onTree) {
                hideScreen('tower-mastery');
                showScreen('tech-tree');
                renderTechTree();
            } else if (which === 'mastery' && onTree) {
                hideScreen('tech-tree');
                showScreen('tower-mastery');
                seedMastSelection();
                renderTowerMastery();
            }
        });
    });
    document.getElementById('mastery-back-btn').addEventListener('click', uiGoBack);
    document.getElementById('menu-backpack-btn').addEventListener('click', navigateToBackpack);
    document.getElementById('backpack-back-btn').addEventListener('click', () => {
        bpReturnHeldToStash(); bpPersist(); uiGoBack();
    });
    document.getElementById('bp-salvage').addEventListener('click', bpSalvage);
    document.getElementById('bp-expand-w').addEventListener('click', () => bpExpand('w'));
    document.getElementById('bp-expand-h').addEventListener('click', () => bpExpand('h'));
    document.getElementById('bp-luck').addEventListener('click', bpBuyLuck);
    document.getElementById('bp-rotate').addEventListener('click', bpRotateHeld);
    document.getElementById('bp-restore').addEventListener('click', bpRestoreHeld);
    document.getElementById('bp-tostash').addEventListener('click', bpHeldToStash);
    // Two-step confirm on SELL (bp-discard). First click arms the
    // button + flips its label to "CONFIRM SELL?". Second click within
    // 3 s commits via bpSellHeld. Idle for 3 s → disarm. Mirrors the
    // in-game sell-btn pattern so the gesture is familiar and the
    // accidental tap doesn't burn an item.
    (function wireDiscardConfirm() {
        const btn = document.getElementById('bp-discard');
        if (!btn) return;
        let armed = false;
        let armTimer = null;
        let originalHTML = btn.innerHTML;
        function disarm() {
            armed = false;
            btn.dataset.confirm = 'false';
            btn.innerHTML = originalHTML;
            // Re-render the sell value in case the held item changed
            // while armed (defensive — usually unchanged).
            const sv = btn.querySelector('#bp-sell-val');
            if (sv && bpHeld && BACKPACK_ITEMS[bpHeld.id]) {
                const def = BACKPACK_ITEMS[bpHeld.id];
                const refund = NeonSave.getSellRefund(def.rarity);
                sv.textContent = refund > 0 ? `+${refund}` : '';
            }
            if (armTimer) { clearTimeout(armTimer); armTimer = null; }
        }
        btn.addEventListener('click', () => {
            if (!bpHeld) return;            // disabled in placeholder; defensive
            if (armed) {
                bpSellHeld();
                disarm();
                return;
            }
            armed = true;
            btn.dataset.confirm = 'true';
            originalHTML = btn.innerHTML;
            btn.innerHTML = '✕ CONFIRM SELL?';
            armTimer = setTimeout(disarm, 3000);
        });
        // If the held item changes (or is dropped) while armed, disarm
        // so the next click on a different item doesn't fire instantly.
        const obs = new MutationObserver(() => {
            if (armed && !bpHeld) disarm();
        });
        obs.observe(document.getElementById('bp-held-name'), { childList: true, characterData: true, subtree: true });
    })();

    // ── Backpack drag-to-place (pointer events) ──────────────────────────
    // Why Pointer Events instead of Touch Events: bpPickStash /
    // bpPickPlaced calls renderBackpack mid-gesture, which destroys the
    // source chip/cell via innerHTML = ''. Touch Events route to the
    // ORIGINAL target for the rest of the gesture — and when that target
    // is detached, browsers diverge (Chrome keeps dispatching to the
    // orphan; iOS Safari and some Android stacks fire touchcancel and
    // end the gesture).
    //
    // Pointer Events route to whatever's under the pointer at each
    // event, NOT to the original target — so when the chip is destroyed
    // by renderBackpack, subsequent events naturally find body or the
    // grid and bubble up to our document.body listeners. No
    // setPointerCapture: that would redirect the click event as well,
    // breaking tap-to-pickup.
    //
    // Drag-target mapping: the attach point on the held item is its
    // BOTTOM-CENTRE — that point follows the finger. The ghost preview
    // then sits half a cell ABOVE the finger so the highlighted cell
    // peeks out from behind the thumb. For multi-cell items this means
    // the whole shape extends upward from the finger, regardless of
    // shape/rotation.
    const BP_DRAG_THRESHOLD_PX = 8;
    let bpTouch = null;     // { source, idx, startX, startY, dragging, pointerId }

    // Given the finger position, return the top-left grid cell where
    // the held item would land. Works for any shape/rotation by
    // reading shapeSize from the held def. Falls back to bpCellAtPoint
    // when nothing is held (e.g. during the pre-threshold window).
    function bpDropTargetCell(fx, fy) {
        const bp = save.backpack;
        if (!bp) return null;
        const grid = document.getElementById('bp-grid');
        if (!grid || !grid.firstElementChild) return null;
        const gr = grid.getBoundingClientRect();
        const cs = grid.firstElementChild.offsetWidth || 40;
        let size = { w: 1, h: 1 };
        if (bpHeld && BACKPACK_ITEMS[bpHeld.id]) {
            size = NeonBackpack.shapeSize(BACKPACK_ITEMS[bpHeld.id].shape, bpHeld.rot || 0);
        }
        // Item is larger than the grid — there's no valid placement.
        if (size.w > bp.w || size.h > bp.h) return null;
        // Always clamp into the grid (no NEAR cutoff) so the ghost
        // tracks the finger's closest grid cell even when the finger
        // drifts well outside the grid — the chosen item should
        // always look like it's "in hand" near where the finger is.
        // Bottom-centre of the item sits half a cell above the finger:
        //   bottom-centre Y = fy - cs/2
        //   top-row centre Y = fy - cs/2 - (size.h - 1) * cs
        // Subtract cs/2 to convert cell centre → cell top, then floor
        // against the grid's top edge.
        const tlx = fx - (size.w - 1) * cs / 2 - cs / 2;
        const tly = fy - size.h * cs;
        const gx = Math.floor((tlx - gr.left) / cs);
        const gy = Math.floor((tly - gr.top)  / cs);
        // Clamp so the ghost always shows a complete shape within the
        // grid, even when the finger is right against an edge.
        const cx = Math.max(0, Math.min(bp.w - size.w, gx));
        const cy = Math.max(0, Math.min(bp.h - size.h, gy));
        return { x: cx, y: cy };
    }

    function bpCellAtPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || !el.closest) return null;
        const cell = el.closest('.bp-cell');
        if (!cell) return null;
        const grid = document.getElementById('bp-grid');
        if (!grid || cell.parentElement !== grid) return null;
        const idx = Array.prototype.indexOf.call(grid.children, cell);
        if (idx < 0 || !save.backpack) return null;
        return { x: idx % save.backpack.w, y: Math.floor(idx / save.backpack.w) };
    }
    function bpBackpackVisible() {
        const bp = document.getElementById('backpack');
        return bp && !bp.classList.contains('hidden');
    }

    function bpOnPointerMove(e) {
        if (!bpTouch || e.pointerId !== bpTouch.pointerId) return;
        // touch-action:none on the chip/cell handles the source. This
        // preventDefault is the backstop for the rest of the gesture
        // path while pointer is bubbling through other elements.
        if (e.cancelable) e.preventDefault();
        if (!bpTouch.dragging) {
            if (Math.hypot(e.clientX - bpTouch.startX, e.clientY - bpTouch.startY) < BP_DRAG_THRESHOLD_PX) return;
            bpTouch.dragging = true;
            if (bpTouch.source === 'stash')       bpPickStash(bpTouch.idx);
            else if (bpTouch.source === 'placed') bpPickPlaced(bpTouch.idx);
            // 'held-move' — no pickup; item is already in hand. We're
            // just letting the player re-aim the ghost via touch.
            // Source chip/cell may be destroyed by renderBackpack here.
            // Subsequent pointer events route to whatever's under the
            // finger and bubble up to document.body — uninterrupted.
        }
        const target = bpDropTargetCell(e.clientX, e.clientY);
        // bpPaintGhost paints ghost-ok / ghost-bad on the underlying
        // grid cells based on canPlace. target is always clamped to a
        // valid in-grid cell while an item is held, so the ghost
        // tracks the finger even when it drifts off-grid.
        if (target) bpPaintGhost(target.x, target.y);
    }
    function bpOnPointerEnd(e) {
        if (!bpTouch || e.pointerId !== bpTouch.pointerId) return;
        const state = bpTouch;
        bpTouch = null;
        if (!state.dragging) return;        // pure tap — let click handlers fire
        // If the finger is over the held panel when it lifts, don't
        // commit a placement — the player almost certainly meant to
        // tap a recovery button (rotate / stash / restore / discard).
        // Check BOTH the element under the finger AND the panel's
        // bounding rect, because the buttons are visibility:hidden
        // when nothing is held and elementFromPoint can skip past
        // them in some layouts.
        const heldEl = document.getElementById('bp-held');
        const heldRect = heldEl && heldEl.getBoundingClientRect();
        const inHeldPanel = heldRect &&
            e.clientX >= heldRect.left && e.clientX <= heldRect.right &&
            e.clientY >= heldRect.top  && e.clientY <= heldRect.bottom;
        const underFinger = document.elementFromPoint(e.clientX, e.clientY);
        const overHeldBtn = underFinger && underFinger.closest && underFinger.closest('#bp-held');
        if (inHeldPanel || overHeldBtn) {
            // Don't preventDefault — we want the click on the button
            // to run normally.
            return;
        }
        // bpDropTargetCell returns null when the finger is more than
        // ~2 cells away from the grid (see the NEAR window inside).
        // If it returned a target AND placement is valid, commit and
        // suppress the synthesised click so we don't double-fire.
        const target = bpDropTargetCell(e.clientX, e.clientY);
        if (target && bpHeldPlacementValid(target)) {
            if (e.cancelable) e.preventDefault();
            bpPlaceAt(target.x, target.y);
            return;
        }
        // No valid target → keep held; let the click fire naturally so
        // the next tap registers without the player having to lift and
        // tap again.
    }
    // Bound ONCE to document.body — pointermove/up route to the element
    // under the finger and bubble up. No setPointerCapture: that would
    // redirect the click event too, breaking tap-to-pickup.
    document.body.addEventListener('pointermove',   bpOnPointerMove, { passive: false });
    document.body.addEventListener('pointerup',     bpOnPointerEnd);
    document.body.addEventListener('pointercancel', bpOnPointerEnd);

    document.getElementById('bp-stash').addEventListener('pointerdown', (e) => {
        if (!bpBackpackVisible() || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (bpTouch) return;
        const chip = e.target.closest && e.target.closest('.bp-chip');
        if (!chip) return;
        const i = parseInt(chip.dataset.stashIdx, 10);
        if (!Number.isFinite(i)) return;
        bpTouch = { source: 'stash', idx: i, startX: e.clientX, startY: e.clientY, dragging: false, pointerId: e.pointerId };
    });

    document.getElementById('bp-grid').addEventListener('pointerdown', (e) => {
        if (!bpBackpackVisible() || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (bpTouch) return;
        const anyCell = e.target.closest && e.target.closest('.bp-cell');
        if (!anyCell) return;
        const isFilled = anyCell.classList.contains('filled');

        // Case 1: touched a filled cell. Standard placed-item pickup
        // UNLESS the cell is also under our held item's ghost-bad
        // footprint — that means the player is aiming a held item AT
        // the existing item, NOT trying to grab it. Skip drag in that
        // case so the click handler routes through bpPlaceAt instead
        // (refused, with red feedback) and we don't accidentally swap.
        if (isFilled) {
            if (bpHeld && anyCell.classList.contains('ghost-bad')) return;
            const idx = parseInt(anyCell.dataset.placedIdx, 10);
            if (!Number.isFinite(idx)) return;
            bpTouch = { source: 'placed', idx, startX: e.clientX, startY: e.clientY, dragging: false, pointerId: e.pointerId };
            return;
        }

        // Case 2: touched an EMPTY cell while holding an item. Engage
        // a "move-held" drag so the player can re-aim the held item by
        // touch — the same gesture that works from the stash. Without
        // this, dragging the red ghost (or any empty cell) on touch
        // was a no-op and the player had to either tap-to-place blind
        // or use STASH to recover.
        if (bpHeld) {
            bpTouch = { source: 'held-move', startX: e.clientX, startY: e.clientY, dragging: false, pointerId: e.pointerId };
        }
    });
    document.getElementById('menu-dailyseed-btn').addEventListener('click', () => {
        if (!NeonSave.hasUnlocked(save, 'qol.dailyseed')) return;
        const today = new Date();
        const dailySeed = parseInt(today.getFullYear().toString() +
            String(today.getMonth() + 1).padStart(2, '0') +
            String(today.getDate()).padStart(2, '0'));
        // Rebuild preview Game on the daily seed and go to Run Setup.
        const canvas = document.getElementById('game-canvas');
        game = new Game(canvas, dailySeed, selectedTier, {
            heroId: selectedHero, kitId: selectedKit, abilityId: selectedAbility,
            towerLoadout: sanitizeTowerLoadout(selectedTowerLoadout)
        });
        window.game = game;
        if (typeof NeonAegis !== 'undefined') NeonAegis.protectGame(game);
        game.draw();
        updateSeedDisplay();
        updateModeDisplay();
        navigateToRunSetup();
    });
    document.getElementById('menu-reset-btn').addEventListener('click', () => {
        // Typed-phrase confirmation — a yes/no confirm() was one
        // mis-tap away from deleting hundreds of hours of progression.
        // The player must type the exact phrase to proceed.
        const PHRASE = 'delete all progress';
        const typed = prompt(
            'This permanently deletes ALL XP, unlocks, items and high scores.\n\n' +
            `Type "${PHRASE}" to confirm:`);
        if (typed === null) return;                          // cancelled
        if (typed.trim().toLowerCase() !== PHRASE) {
            alert('Phrase did not match — nothing was deleted.');
            return;
        }
        // Also wipe the Aegis signature so the fresh save starts clean.
        localStorage.removeItem('neonDefense.save');
        localStorage.removeItem('neonDefense.save.sig');
        location.reload();
    });
    // Test hook: drives the same flow without a real prompt().
    window.__neonResetSavePhrase = 'delete all progress';

    // OPTIONS menu — device + gameplay toggles, both persisted per device.
    //   • Portrait field → portrait board (landscape default), applied at the
    //     start of the NEXT run (see restartGame; MP always WIDE). This is the
    //     ONLY orientation control — device rotation is intentionally not
    //     offered (the playfield switch covers portrait vs landscape).
    const fieldChk = document.getElementById('opt-field-tall');
    if (fieldChk) {
        // State-aware label: spell out the board you'll actually get rather
        // than statically saying "Portrait" even when it's off (the source of
        // the "this toggle is confusing" feedback).
        const syncFieldLabel = () => {
            const lbl = document.getElementById('opt-field-tall-label');
            if (!lbl) return;
            lbl.innerHTML = fieldChk.checked
                ? 'Board shape: <strong>Portrait</strong> (tall) <span class="opt-hint">applied next run · path runs left → right</span>'
                : 'Board shape: <strong>Landscape</strong> (wide) <span class="opt-hint">applied next run · path runs top → down</span>';
        };
        fieldChk.checked = localStorage.getItem('neonFieldTall') === '1';
        syncFieldLabel();
        fieldChk.addEventListener('change', () => {
            try { localStorage.setItem('neonFieldTall', fieldChk.checked ? '1' : '0'); } catch (_) {}
            syncFieldLabel();
        });
    }
    // Screen orientation — lock the device Portrait/Landscape so the whole UI
    // rotates natively to fit how you hold the phone. Applies live.
    const rotChk = document.getElementById('opt-screen-rotate');
    if (rotChk) {
        const syncRotLabel = () => {
            const lbl = document.getElementById('opt-screen-rotate-label');
            if (!lbl) return;
            lbl.innerHTML = 'Screen orientation: <strong>' + (rotChk.checked ? 'Portrait' : 'Landscape') +
                '</strong> <span class="opt-hint">hold the phone vertical or horizontal — the whole screen rotates to match</span>';
        };
        rotChk.checked = localStorage.getItem('neonScreenRotate') === '1';
        syncRotLabel();
        rotChk.addEventListener('change', () => {
            try { localStorage.setItem('neonScreenRotate', rotChk.checked ? '1' : '0'); } catch (_) {}
            syncRotLabel();
            if (typeof applyScreenRotation === 'function') { try { applyScreenRotation(); } catch (_) {} }
        });
    }
    // Crisp graphics — supersample the canvas (sharper, more GPU). Applied live.
    const hiqChk = document.getElementById('opt-hi-quality');
    if (hiqChk) {
        hiqChk.checked = localStorage.getItem('neonHiQuality') === '1';
        hiqChk.addEventListener('change', () => {
            try { localStorage.setItem('neonHiQuality', hiqChk.checked ? '1' : '0'); } catch (_) {}
            if (typeof resizeCanvas === 'function') { try { resizeCanvas(); } catch (_) {} }
        });
    }
    // Auto-flip orientation — rotate 180° when the device is upside-down.
    // Default ON (null treated as enabled).
    const flipChk = document.getElementById('opt-auto-flip');
    if (flipChk) {
        flipChk.checked = localStorage.getItem('neonAutoFlip') !== '0';
        flipChk.addEventListener('change', () => {
            try { localStorage.setItem('neonAutoFlip', flipChk.checked ? '1' : '0'); } catch (_) {}
            if (typeof applyAutoFlip === 'function') { try { applyAutoFlip(); } catch (_) {} }
        });
    }

    const optionsBtn = document.getElementById('menu-options-btn');
    if (optionsBtn) optionsBtn.addEventListener('click', () => {
        _enterSubScreen();
        hideScreen('main-menu');
        showScreen('options-menu');
    });
    const optionsBackBtn = document.getElementById('options-back-btn');
    if (optionsBackBtn) optionsBackBtn.addEventListener('click', uiGoBack);

    // Save / Load code modal — portable string backup of the whole save.
    const scStatus = () => document.getElementById('save-code-status');
    document.getElementById('menu-savecode-btn').addEventListener('click', () => {
        const ta = document.getElementById('save-code-text');
        ta.value = NeonSave.encodeSaveCode(save);
        scStatus().textContent = '';
        scStatus().style.color = 'var(--text-muted)';
        _enterSubScreen();          // make the system Back button dismiss this too
        hideScreen('main-menu');
        showScreen('save-code-modal');
    });
    document.getElementById('save-code-copy').addEventListener('click', () => {
        const ta = document.getElementById('save-code-text');
        ta.select();
        navigator.clipboard.writeText(ta.value).then(
            () => { scStatus().textContent = 'Copied to clipboard.'; scStatus().style.color = '#4ade80'; },
            () => { scStatus().textContent = 'Press Ctrl/Cmd+C to copy.'; scStatus().style.color = '#fbbf24'; }
        );
    });
    document.getElementById('save-code-load').addEventListener('click', () => {
        const code = document.getElementById('save-code-text').value;
        let decoded;
        try {
            decoded = NeonSave.decodeSaveCode(code);
        } catch (err) {
            scStatus().textContent = 'Error: ' + err.message;
            scStatus().style.color = '#fb7185';
            return;
        }
        if (!confirm('Load this code? It overwrites your current save and reloads the game.')) return;
        NeonSave.write(decoded);
        location.reload();
    });
    document.getElementById('save-code-close').addEventListener('click', () => {
        hideScreen('save-code-modal');
        uiGoBack();             // pops the pushed state so history stays balanced
    });

    // ── Multiplayer lobby + race overlay ─────────────────────────────────
    // The lobby screen is purely menu navigation — no network until JOIN.
    // On JOIN we lazy-load Trystero, attach the race controller, and
    // start the run with the room code's hash as the world seed.
    setupMultiplayerLobby();

    // Background global-scoreboard sync. Started lazily after a short
    // delay so the page is fully interactive before we open the MQTT
    // connection. Silent failure — local scoreboard still works if
    // the broker is unreachable. Periodic re-broadcast (every 60s)
    // is handled inside global.js.
    setTimeout(() => {
        try {
            // NOTE: on localhost (Playwright suites) start() refuses to
            // join the live room — the hermetic-test gate lives in
            // global.js so it covers every caller, not just this one.
            if (window.NeonMP && NeonMP.global && NeonMP.global.singleton) {
                // start() returns a Promise — swallow rejection so a
                // sandbox without broker access doesn't fire an
                // unhandled-rejection that pollutes pageerror listeners.
                Promise.resolve(NeonMP.global.singleton().start()).catch(() => {});
            }
        } catch (_) { /* best-effort */ }
    }, 2000);

    // M2: Run Setup BACK button goes to Main Menu.
    document.getElementById('setup-back-btn').addEventListener('click', uiGoBack);
    document.getElementById('tree-back-btn').addEventListener('click',  uiGoBack);

    // ── Tech-tree zoom: buttons + pinch + ctrl/⌘-wheel ───────────────────
    // The SVG width is driven by the --tt-zoom custom property on the view
    // (1 = fit). >1 enlarges + scrolls; <1 shrinks to an overview.
    let ttZoom = 1;
    const TT_ZOOM_MIN = 0.5, TT_ZOOM_MAX = 4;
    function setTreeZoom(z) {
        ttZoom = Math.max(TT_ZOOM_MIN, Math.min(TT_ZOOM_MAX, z));
        const view = document.getElementById('tech-tree-view');
        if (view) view.style.setProperty('--tt-zoom', ttZoom.toFixed(3));
    }
    window.setTreeZoom = setTreeZoom;
    const _zin = document.getElementById('tt-zoom-in');
    const _zout = document.getElementById('tt-zoom-out');
    const _zfit = document.getElementById('tt-zoom-fit');
    if (_zin)  _zin.addEventListener('click',  () => setTreeZoom(ttZoom * 1.25));
    if (_zout) _zout.addEventListener('click', () => setTreeZoom(ttZoom / 1.25));
    if (_zfit) _zfit.addEventListener('click', () => setTreeZoom(1));
    const _ttView = document.getElementById('tech-tree-view');
    if (_ttView) {
        // ctrl/⌘+wheel (and trackpad pinch, delivered as ctrl+wheel) zooms;
        // a plain wheel keeps scrolling the view.
        _ttView.addEventListener('wheel', (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setTreeZoom(ttZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        }, { passive: false });
        // Two-finger pinch.
        let pinchStart = 0, zoomStart = 1;
        const _dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        _ttView.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) { pinchStart = _dist(e.touches); zoomStart = ttZoom; }
        }, { passive: true });
        _ttView.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && pinchStart > 0) {
                e.preventDefault();
                setTreeZoom(zoomStart * (_dist(e.touches) / pinchStart));
            }
        }, { passive: false });
        _ttView.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinchStart = 0; });
    }

    // Tech-tree RESPEC — refunds only TREE_RESPEC_REFUND of XP spent, behind
    // the same typed-phrase guard as RESET SAVE (a yes/no confirm() is one
    // mis-tap away from wiping a hand-built tree). Phrase exposed for the e2e.
    window.__neonRespecPhrase = 'respec tree';
    const respecBtn = document.getElementById('tree-respec-btn');
    if (respecBtn) respecBtn.addEventListener('click', () => {
        const PHRASE = window.__neonRespecPhrase;
        const spent = Math.max(0, Math.floor(save.treeSpent || 0));
        if (spent <= 0) { alert('You have not spent any XP in the tree yet.'); return; }
        const refund = Math.floor(spent * TREE_RESPEC_REFUND);
        const typed = prompt(
            'RESPEC clears every tech-tree skill you bought and refunds only ' +
            Math.round(TREE_RESPEC_REFUND * 100) + '% of the XP spent.\n\n' +
            'You spent ' + spent + ' XP — you would get back ' + refund + ' XP. This cannot be undone.\n\n' +
            'Type "' + PHRASE + '" to confirm:');
        if (typed === null) return;                          // cancelled
        if (typed.trim().toLowerCase() !== PHRASE) {
            alert('Phrase did not match — your tree is unchanged.');
            return;
        }
        const res = NeonTree.respec(save);
        renderTechTree();
        renderLoadoutDropdowns();
        updateMainMenuState();
        alert('Respec complete — refunded ' + res.refund + ' XP and cleared ' + res.cleared + ' skills.');
    });

    // M2: Loadout dropdown change handlers.
    document.getElementById('run-hero-select').addEventListener('change', e => {
        selectedHero = e.target.value;
    });
    document.getElementById('run-kit-select').addEventListener('change', e => {
        selectedKit = e.target.value;
    });
    document.getElementById('run-ability-select').addEventListener('change', e => {
        selectedAbility = e.target.value;
    });

    // ── Player name: required before a run can start, so RST/retire
    //    can auto-save a high score without the player remembering to
    //    click "submit". Names allow A-Z 0-9 + space + dash, 1..16 chars.
    function getPlayerName() {
        try {
            const raw = localStorage.getItem('neonPlayerName') || '';
            return raw.toUpperCase().replace(/[^A-Z0-9 \-]/g, '').slice(0, 16).trim();
        } catch (_) { return ''; }
    }
    function setPlayerName(name) {
        const clean = String(name || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').slice(0, 16).trim();
        if (!clean) return null;
        try { localStorage.setItem('neonPlayerName', clean); } catch (_) {}
        return clean;
    }
    // Prompts the player for a name if none is cached. Returns a
    // Promise<string|null>. Used to gate the start-run flow.
    function ensurePlayerName() {
        return new Promise(resolve => {
            const existing = getPlayerName();
            if (existing) { resolve(existing); return; }
            // Use the browser prompt for simplicity. Could be promoted
            // to a proper overlay later — the requirement is just that
            // we always have a name before the run starts.
            try {
                let nm = '';
                while (!nm) {
                    nm = window.prompt(
                        'Enter your name (A-Z 0-9 -, up to 16 chars) — used on the scoreboard:',
                        '');
                    if (nm === null) { resolve(null); return; }
                    nm = setPlayerName(nm);
                    if (!nm) {
                        // try again — empty / invalid input
                    }
                }
                resolve(nm);
            } catch (_) { resolve(null); }
        });
    }

    // Auto-save a high score using the cached name. Idempotent per
    // (tier, wave, name) triple within one run — calling it from both
    // RST and the game-over flow won't add duplicates.
    let _lastAutoSaveKey = null;
    function autoSaveScore(wave, tier, retired) {
        if (!Number.isFinite(wave) || wave <= 0) return false;
        const name = getPlayerName();
        if (!name) return false;
        const key = name + '|' + tier + '|' + wave + '|' + (retired ? '1' : '0');
        if (key === _lastAutoSaveKey) return false;
        _lastAutoSaveKey = key;
        const cheated = !!(
            (typeof NeonAegis !== 'undefined' && NeonAegis.isRunFlagged && NeonAegis.isRunFlagged()) ||
            (typeof NeonAegis !== 'undefined' && NeonAegis.lastFlag && NeonAegis.lastFlag()) ||
            window.__neonAegisLastFlag
        );
        const usedAutopilot = !!(typeof game !== 'undefined' && game && game._autopilotEverUsed);
        const list = save.highScores['a' + tier] || [];
        list.push({ name, wave, retired: !!retired, cheated, autopilot: usedAutopilot });
        list.sort((a, b) => b.wave - a.wave);
        save.highScores['a' + tier] = list.slice(0, 5);
        NeonSave.write(save);
        if (window.NeonMP && window.NeonMP.global && window.NeonMP.global.publish) {
            try {
                window.NeonMP.global.publish({
                    name, wave, tier, cheated, retired: !!retired,
                    autopilot: usedAutopilot,
                });
            } catch (_) {}
        }
        return true;
    }
    // Expose for the RST handler + tests.
    window.autoSaveScore = autoSaveScore;
    window.restartGame = restartGame;       // tests + console debugging
    window.getPlayerName = getPlayerName;
    window.setPlayerName = setPlayerName;
    function clearAutoSaveKey() { _lastAutoSaveKey = null; }

    document.getElementById('start-btn').addEventListener('click', async () => {
        // Gate the run on having a name. The player can cancel out of
        // the prompt — in that case we just don't start the run.
        const name = await ensurePlayerName();
        if (!name) return;
        clearAutoSaveKey();

        // M2: Persist chosen loadout for next run.
        save.lastLoadout = {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility,
            towerLoadout: sanitizeTowerLoadout(selectedTowerLoadout)
        };
        NeonSave.write(save);

        const seedVal = document.getElementById('start-seed-input').value.trim();
        const parsedSeed = seedVal !== '' ? parseInt(seedVal) : null;
        if (parsedSeed !== null && !isNaN(parsedSeed)) {
            restartGame(parsedSeed);
        } else {
            // Always rebuild — loadout may have changed even if tier/seed didn't.
            restartGame(game.seed);
        }
    });

    // Speed display: white (1x) → orange → red (max). Uses a gradient mapped
    // to log2 of the current speed so each doubling steps the hue evenly.
    function updateSpeedColor() {
        const el = document.getElementById('speed-display');
        const maxSteps = ultraSpeedUnlocked ? 8 : 4; // log2(256)=8, log2(16)=4
        const step = gameSpeed <= 1 ? 0 : Math.log2(gameSpeed);
        const t = Math.min(step / maxSteps, 1);
        // white(255,255,255) → red(239,68,68)
        const r = Math.round(255);
        const g = Math.round(255 * (1 - t));
        const b = Math.round(255 * (1 - t));
        el.style.color = `rgb(${r},${g},${b})`;
        el.style.textShadow = t > 0 ? `0 0 10px rgba(239,68,68,${t * 0.7})` : '';
        // Keep proxy in sync (MutationObserver handles text, but not style)
        const proxy = document.querySelector('#speed-btn-proxy .proxy-value');
        if (proxy) {
            proxy.style.color = el.style.color;
            proxy.style.textShadow = el.style.textShadow;
        }
    }

    // Test hook: lets the regression suite poke the MP-active flag
    // without having to actually join a Trystero room. Only honoured
    // when the page has the dev-mode flag set (so production users
    // can't bypass the lock via console).
    window.__neonMPSetMode = function (mode) {
        if (!window.__neonAegisDev) return false;
        _activeMode = mode || null;
        return true;
    };

    document.getElementById('speed-btn').addEventListener('click', () => {
        // Multiplayer hard-caps speed at 16× and disables the 256× easter
        // egg. In coop the speed is host-set in the lobby and LOCKED for
        // every peer — clicking the SPEED tile is a no-op so a non-host
        // can't desync the run by cycling.
        const mpActive = !!_activeMode;
        if (mpActive) {
            // Subtle visual ping so the click doesn't feel dead.
            const display = document.getElementById('speed-display');
            if (display) {
                display.style.transition = 'opacity 80ms';
                display.style.opacity = '0.4';
                setTimeout(() => { display.style.opacity = '1'; }, 120);
            }
            return;
        }

        if (!mpActive) {
            speedClickCount++;

            // Reset counter after 2 seconds of no clicks
            clearTimeout(speedClickTimer);
            speedClickTimer = setTimeout(() => {
                speedClickCount = 0;
            }, 2000);

            // Easter egg: unlock x256 mode after 15 clicks
            if (speedClickCount >= 15 && !ultraSpeedUnlocked) {
                ultraSpeedUnlocked = true;
                speedClickCount = 0;

                // Visual feedback
                const speedDisplay = document.getElementById('speed-display');
                speedDisplay.style.color = '#fbbf24';
                speedDisplay.style.textShadow = '0 0 20px rgba(251, 191, 36, 0.8)';
                speedDisplay.textContent = 'ULTRA!';

                setTimeout(() => {
                    speedDisplay.textContent = gameSpeed + 'X';
                    updateSpeedColor();
                }, 1500);
            }
        }

        // Speed cycling. Effective cap in multiplayer is always 16×.
        const cap = (!mpActive && ultraSpeedUnlocked) ? 256 : 16;
        gameSpeed *= 2;
        if (gameSpeed > cap) gameSpeed = 1;

        document.getElementById('speed-display').textContent = gameSpeed + 'X';
        updateSpeedColor();
    });
    document.getElementById('pause-btn').addEventListener('click', () => {
        togglePause();
        // Co-op: ANY peer can pause; their state propagates to the
        // partner. Previously this was gated on `getPlayerName() ===
        // _mpHostNick`, but that comparison frequently failed (the
        // pre-saved player name was the unsanitised string while
        // _mpHostNick was the sanitised one), so the broadcast never
        // fired and the partner kept playing. Drop the gate — the
        // receiver path uses __neonMPApplyPause which is idempotent.
        if (_activeMode === 'coop' && _activeRoom) {
            try { _activeRoom.send({ kind: 'pause', paused: game.state === 'paused' }); } catch (_) {}
        }
    });

    function togglePause() {
        if (game.state === 'playing') {
            game.state = 'paused';
            document.getElementById('pause-display').textContent = 'ON';
            document.getElementById('pause-display').classList.add('on');
            document.getElementById('pause-display').classList.remove('paused');
        } else if (game.state === 'paused') {
            game.state = 'playing';
            document.getElementById('pause-display').textContent = 'OFF';
            document.getElementById('pause-display').classList.remove('on');
            document.getElementById('pause-display').classList.remove('paused');
        }
    }
    // Coop desync diagnostics. Each peer periodically broadcasts a
    // small state digest (wave, money, hp, tower count). The other
    // peer compares against its local state and surfaces a drift
    // report via window.__neonMPLastDrift so the UI / debug overlay
    // can show "WAVES OUT OF SYNC" etc. We don't auto-correct (that
    // requires authoritative state); the report is diagnostic.
    let _mpLastSyncSent = 0;
    function maybeSendSync() {
        if (_activeMode !== 'coop' || !_activeRoom || !game) return;
        if (game.state !== 'playing' && game.state !== 'paused') return;
        const now = Date.now();
        // 10 s cadence — this digest is diagnostic only (drift report),
        // so halving the rate is free bandwidth.
        if (now - _mpLastSyncSent < 10000) return;
        _mpLastSyncSent = now;
        try {
            _activeRoom.send({
                kind: 'sync',
                w:  game.wave | 0,
                m:  game.money | 0,
                h:  game.health | 0,
                tc: (game.towers || []).length | 0,
                ec: (game.enemies || []).filter(e => e && e.active).length | 0,
                t:  now,
            });
        } catch (_) {}
    }
    setInterval(maybeSendSync, 1000);
    // Host → clients: enemy digest, DELTA-ENCODED for traffic (coop
    // pays metered TURN when P2P needs relaying). Wire formats:
    //   full:  { kind:'es', w, n, e:[[idx,hpByte]…] }   — legacy shape,
    //          receiver kills anything idx<n that's absent.
    //   delta: { kind:'es', w, n, u:[[idx,hpByte]…], x:[idx…] } — only
    //          enemies whose hpByte CHANGED since the last digest (u)
    //          and deaths since the last digest (x); absence means
    //          "unchanged", so quiet enemies cost zero bytes.
    // A full digest goes out on wave change and every FULL_EVERY_MS as
    // a safety net (covers a client that missed deltas); when nothing
    // changed at all, nothing is sent.
    let _mpLastEstateSent = 0;
    let _mpEsLast = new Map();        // spawnIdx → hpByte at last digest
    let _mpEsLastWave = -1;
    let _mpEsLastFullAt = 0;
    const ES_INTERVAL_MS = 3000;
    const ES_FULL_EVERY_MS = 15000;
    function buildEnemyDigest(force) {
        if (!game) return null;
        const now = Date.now();
        const wave = game.wave | 0;
        const spawned = game.enemiesSpawned | 0;
        const cur = new Map();
        for (const e of (game.enemies || [])) {
            if (!e || !e.active || e._spawnIdx == null) continue;
            const maxHp = e.maxHp || 1;
            cur.set(e._spawnIdx, Math.max(1, Math.min(255, Math.round(255 * (e.hp || 0) / maxHp))));
        }
        const waveChanged = wave !== _mpEsLastWave;
        const fullDue = waveChanged || force || (now - _mpEsLastFullAt > ES_FULL_EVERY_MS);
        let packet = null;
        if (fullDue) {
            if (cur.size > 0 || spawned > 0) {
                packet = { kind: 'es', w: wave, n: spawned, e: Array.from(cur.entries()) };
            }
            _mpEsLastFullAt = now;
        } else {
            const u = [], x = [];
            for (const [idx, hp] of cur) {
                if (_mpEsLast.get(idx) !== hp) u.push([idx, hp]);
            }
            for (const idx of _mpEsLast.keys()) {
                if (!cur.has(idx)) x.push(idx);
            }
            if (u.length || x.length) {
                packet = { kind: 'es', w: wave, n: spawned, u, x };
            }
        }
        _mpEsLast = cur;
        _mpEsLastWave = wave;
        return packet;
    }
    function maybeSendEnemyState() {
        if (_activeMode !== 'coop' || !_activeRoom || !game || !_mpIsHost) return;
        if (game.state !== 'playing') return;
        const now = Date.now();
        if (now - _mpLastEstateSent < ES_INTERVAL_MS) return;
        const packet = buildEnemyDigest(false);
        if (!packet) return;                      // nothing changed → zero bytes
        _mpLastEstateSent = now;
        try { _activeRoom.send(packet); } catch (_) {}
    }
    setInterval(maybeSendEnemyState, 1000);
    // Test hook — build (and optionally inspect) a digest on demand.
    window.__neonMPEnemyDigest = buildEnemyDigest;
    // Host-loss watchdog. A non-host whose partner disappeared would
    // otherwise wait at waveCooldown 0 forever (waves are host-driven).
    // If nothing host-authored ('wave' / 'es' / 'sync' / 'pause')
    // arrives for 20 s, release the hold so the run continues solo.
    let _mpLastHostMsgAt = 0;
    setInterval(() => {
        if (_activeMode !== 'coop' || _mpIsHost || !game || !game._mpHoldWaves) return;
        if (_mpLastHostMsgAt && Date.now() - _mpLastHostMsgAt > 20000) {
            game._mpHoldWaves = false;
        }
    }, 2000);
    // Receiver: compare digest vs local, stash a drift report.
    window.__neonMPLastDrift = null;
    window.__neonMPApplySync = function (snap, fromId) {
        if (!game || !snap) return;
        const localTc = (game.towers || []).length | 0;
        const drift = {
            peer: fromId || '?',
            t: Date.now(),
            wave:    { local: game.wave | 0,  remote: snap.w | 0, diff: (snap.w | 0) - (game.wave | 0) },
            money:   { local: game.money | 0, remote: snap.m | 0, diff: (snap.m | 0) - (game.money | 0) },
            health:  { local: game.health | 0, remote: snap.h | 0, diff: (snap.h | 0) - (game.health | 0) },
            towers:  { local: localTc,         remote: snap.tc | 0, diff: (snap.tc | 0) - localTc },
            enemies: { local: (game.enemies || []).filter(e => e && e.active).length | 0,
                       remote: snap.ec | 0 },
        };
        // Coarse health: wave-mismatch is the loudest signal; tower-
        // count drift means inputs aren't reaching one side.
        drift.severity =
            (drift.wave.diff !== 0)   ? 'wave' :
            (drift.towers.diff !== 0) ? 'towers' :
            'ok';
        window.__neonMPLastDrift = drift;
    };

    // Public hook for the coop transport to push remote pause/resume.
    window.__neonMPApplyPause = function (paused) {
        if (!game || (game.state !== 'playing' && game.state !== 'paused')) return;
        if (paused && game.state !== 'paused') togglePause();
        else if (!paused && game.state === 'paused') togglePause();
    };
    // Public hook for the coop transport to align the wave counter to
    // the host's authoritative wave. We don't re-tick the simulation
    // (that would require host-authoritative enemy state, a larger
    // change); we just snap the counter so the UI stays consistent
    // and wave-bonus logic fires at the same wave on every client.
    window.__neonMPApplyWave = function (w, hp) {
        if (!game || !Number.isInteger(w) || w < 1) return;
        if (game.wave === w) return;
        // The host is authoritative in BOTH directions. The old
        // forward-only gate assumed a client could legitimately run
        // ahead; with _mpHoldWaves the client never self-advances, and
        // if state still disagrees (reload, missed packet) the host's
        // view wins.
        game.wave = w;
        game.uiDirty = true;
        try {
            // Clear any leftover enemies + projectiles from the old
            // wave so the new spawn pattern doesn't double-stack.
            if (Array.isArray(game.enemies))     game.enemies.length = 0;
            if (Array.isArray(game.projectiles)) game.projectiles.length = 0;
            // Spawn with the HOST's HP multiplier, not our own — see
            // the _mpForcedHpMult consumer in Game.startWave.
            if (Number.isFinite(hp) && hp > 0) game._mpForcedHpMult = hp;
            if (typeof game.startWave === 'function') game.startWave();
        } catch (_) {}
    };
    // Digger boss dig broadcast (coop, host-only). The client never
    // commits its own digger's crossing (Game._commitDig checks
    // _mpHoldWaves) — it carves exactly what the host carved.
    window.__neonMPBroadcastDig = function (site) {
        if (_activeMode !== 'coop' || !_activeRoom || !_mpIsHost || !site) return;
        try { _activeRoom.send({ kind: 'dig', f: site.from | 0, t: site.to | 0, m: site.mode === 'branch' ? 'branch' : 'replace' }); } catch (_) {}
    };
    window.__neonMPApplyDig = function (msg) {
        if (!game || !msg) return;
        try { game._applyDig({ from: msg.f | 0, to: msg.t | 0, mode: msg.m === 'branch' ? 'branch' : 'replace' }); } catch (_) {}
    };

    // Host's periodic enemy digest → snap local monsters to match.
    // Matching is by _spawnIdx (deterministic spawn order within a
    // wave). Entries: e = [[spawnIdx, hpByte 1-255], ...] for every
    // enemy still alive on the host; n = how many the host has
    // spawned so far. Anything we hold with idx < n that the host no
    // longer lists is dead on the host → kill it locally WITHOUT
    // loot (split economy: the kill credit already landed on the
    // host's bank). ~6 bytes/enemy every few seconds — cheap enough
    // for metered connections.
    window.__neonMPApplyEnemyState = function (snap) {
        if (!game || !snap) return;
        if ((snap.w | 0) !== (game.wave | 0)) return;   // stale wave digest
        const isFull = Array.isArray(snap.e);
        const isDelta = !isFull && (Array.isArray(snap.u) || Array.isArray(snap.x));
        if (!isFull && !isDelta) return;
        const updates = new Map();
        for (const pair of (isFull ? snap.e : snap.u) || []) {
            if (Array.isArray(pair) && Number.isInteger(pair[0])) {
                updates.set(pair[0], Math.max(1, Math.min(255, pair[1] | 0)));
            }
        }
        const dead = new Set();
        if (isDelta) {
            for (const idx of snap.x || []) {
                if (Number.isInteger(idx)) dead.add(idx);
            }
        }
        const spawned = snap.n | 0;
        let changed = false;
        for (const e of (game.enemies || [])) {
            if (!e || !e.active || e._spawnIdx == null) continue;
            const ratio = updates.get(e._spawnIdx);
            const killByFull  = isFull && ratio == null && e._spawnIdx < spawned;
            const killByDelta = isDelta && dead.has(e._spawnIdx);
            if (ratio != null) {
                const target = Math.max(1, Math.round((e.maxHp || 1) * ratio / 255));
                if (e.hp !== target) { e.hp = target; changed = true; }
            } else if (killByFull || killByDelta) {
                // Host already killed this one — remove without loot
                // (split economy: the credit landed on the host).
                e._noLocalCredit = true;
                e.hp = 0;
                e.active = false;
                changed = true;
            }
            // Delta + absent + not dead → unchanged on the host; leave it.
        }
        if (changed) game.uiDirty = true;
    };
    // Host-side: every wave change emits a 'wave' message. Hook into
    // game.update via a polling watcher (no game.js intrusion).
    let _lastBroadcastWave = 0;
    function maybeBroadcastWave() {
        if (_activeMode !== 'coop' || !_activeRoom || !game) return;
        if (!_mpIsHost) return;
        if (game.wave === _lastBroadcastWave) return;
        _lastBroadcastWave = game.wave;
        // hp = the host's finalHpMult for this wave (game.js records it
        // in startWave). The client forces it so monster HP matches
        // even when the peers' tower spending diverged.
        try {
            _activeRoom.send({
                kind: 'wave', w: game.wave,
                hp: (Number.isFinite(game.lastHpMult) ? game.lastHpMult : null),
            });
        } catch (_) {}
    }
    // Tick the watcher off the RAF loop owner. We don't have direct
    // access here; piggy-back on the existing updateUI cadence by
    // polling every 250 ms — wave changes are far slower than that.
    setInterval(maybeBroadcastWave, 250);

    document.getElementById('autopilot-btn').addEventListener('click', () => {
        // Autopilot is disabled in multiplayer — having one player's AI
        // race ahead while another plays manually would either desync
        // the room (co-op) or unfairly outperform a human opponent
        // (versus / race). The button stays visible but rejects the
        // toggle and forces game.autopilot off.
        if (_activeMode) {
            game.autopilot = false;
            const display = document.getElementById('autopilot-display');
            display.textContent = 'OFF';
            display.classList.remove('on');
            return;
        }
        game.autopilot = !game.autopilot;
        // Sticky run-scoped flag — once a player uses autopilot in a
        // run, the resulting score is permanently tagged. Tagging is
        // for leaderboard transparency, not punishment.
        if (game.autopilot) game._autopilotEverUsed = true;
        const display = document.getElementById('autopilot-display');
        if (game.autopilot) {
            display.textContent = 'ON';
            display.classList.add('on');
        } else {
            display.textContent = 'OFF';
            display.classList.remove('on');
        }
    });

    document.getElementById('seed-btn').addEventListener('click', () => {
        let url = location.href.split('#')[0] + '#' + game.seed;
        navigator.clipboard.writeText(url).catch(() => {});
        let el = document.getElementById('seed-display');
        let prev = el.textContent;
        el.textContent = 'COPIED';
        el.style.color = '#4ade80';
        setTimeout(() => { el.textContent = prev; el.style.color = 'var(--text-muted)'; }, 1200);
    });

    document.getElementById('sound-btn').addEventListener('click', () => {
        const isOn = SoundFX.toggle();
        const display = document.getElementById('sound-display');
        if (isOn) {
            display.textContent = 'ON';
            display.classList.add('on');
        } else {
            display.textContent = 'OFF';
            display.classList.remove('on');
        }
    });

    // M2: Ability button. Behavior depends on ability kind:
    //   - 'reveal' (Scan): show wave preview immediately, consume 1 charge
    //   - 'target' (Airstrike): enter targeting mode; next canvas click strikes
    //   - 'instant' (Freeze): consume 1 charge, apply effect immediately
    document.getElementById('ability-btn').addEventListener('click', () => {
        if (!game || !game.ability || !game.ability.isUsable()) return;
        if (game.state !== 'playing' && game.state !== 'paused') return;

        const kind = game.ability.kind;
        if (kind === 'reveal') {
            if (game.ability.tryUse()) {
                showWavePreview(3);
                refreshAbilityUI();
            }
        } else if (kind === 'target') {
            game.abilityTargetMode = !game.abilityTargetMode;
            document.getElementById('ability-btn').classList.toggle('armed', game.abilityTargetMode);
        } else if (kind === 'instant') {
            if (game.ability.tryUse()) {
                // Only Freeze currently uses 'instant' — call into game.
                game.freezeAllEnemies(180); // 3 seconds at 60 fps
                refreshAbilityUI();
            }
        }
    });

    function refreshAbilityUI() {
        const btn = document.getElementById('ability-btn');
        const disp = document.getElementById('ability-display');
        const label = document.getElementById('ability-label');
        if (!btn || !disp || !game || !game.ability) return;

        if (game.ability.id === 'ability.none') {
            btn.classList.add('hidden');
            return;
        }
        btn.classList.remove('hidden');

        const shortName = game.ability.name.toUpperCase().slice(0, 8);
        label.textContent = shortName;
        disp.textContent = game.ability.charges > 0 ? `${game.ability.charges}×` : '—';
        btn.classList.toggle('no-charges', game.ability.charges === 0);
        btn.classList.toggle('armed', game.abilityTargetMode === true);
    }

    window.refreshAbilityUI = refreshAbilityUI;

    function maybeShowStrategistPreview() {
        if (game && game.showAllWavesPreview) {
            showWavePreview(20);  // reveal first 20 waves
        }
    }
    window.maybeShowStrategistPreview = maybeShowStrategistPreview;

    document.getElementById('restart-btn').addEventListener('click', () => {
        if (game.state !== 'playing' && game.state !== 'paused') return;
        game.state = 'paused';
        // Combined SYS button: swap target overlay based on current label.
        const action = document.getElementById('restart-btn').dataset.action;
        if (action === 'retire') {
            // Surface flawless-retire eligibility right where the player decides.
            const flawless = !game.hpEverLost;
            const status = document.getElementById('retire-flawless-status');
            if (status) {
                status.textContent = flawless
                    ? '✓ Flawless — bonus available.'
                    : '✗ HP already lost — bonus forfeited.';
                status.style.color = flawless ? '#4ade80' : '#f87171';
            }
            document.getElementById('retire-confirm').classList.remove('hidden');
        } else {
            document.getElementById('restart-confirm').classList.remove('hidden');
        }
    });

    // EXIT TO MENU buttons live inside several overlays (restart-confirm,
    // retire-confirm, game-over, victory) so the player can always bail to
    // the main menu without having to start a new run first. Each button
    // carries data-from so we know which overlay to close.
    const EXIT_OVERLAY_FROM = {
        restart:  'restart-confirm',
        retire:   'retire-confirm',
        gameover: 'game-over',
        victory:  'victory',
    };
    document.querySelectorAll('.exit-to-menu-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = EXIT_OVERLAY_FROM[btn.dataset.from];
            if (id) document.getElementById(id).classList.add('hidden');
            document.getElementById('upgrade-menu').classList.add('hidden');
            navigateToMainMenu();
        });
    });
    document.getElementById('retire-confirm-yes').addEventListener('click', () => {
        // Persist the high-score entry up front so a player who closes
        // the victory overlay without clicking "submit" still keeps
        // their result on the local board.
        try { autoSaveScore(game.wave, game.ascensionTier, true); } catch (_) {}
        document.getElementById('retire-confirm').classList.add('hidden');
        renderAscensionSelector('victory');
        game.victory();
    });
    document.getElementById('retire-confirm-no').addEventListener('click', () => {
        document.getElementById('retire-confirm').classList.add('hidden');
        if (game.state === 'paused') game.state = 'playing';
    });

    // Mobile overflow popover — auto-closes after 2 s of inactivity.
    // Any interaction inside resets the countdown. A shrinking progress bar
    // gives visual feedback of the remaining time.
    const overflowBtn   = document.getElementById('overflow-btn');
    const overflowPanel = document.getElementById('top-bar-overflow');
    if (overflowBtn && overflowPanel) {
        let overflowTimer = null;
        const OVERFLOW_TTL = 5000; // ms — long enough that a brief glance + tap survives

        function openOverflow() {
            overflowPanel.classList.add('open');
            resetOverflowTimer();
        }

        function closeOverflow() {
            overflowPanel.classList.remove('open');
            clearTimeout(overflowTimer);
            overflowTimer = null;
            // Reset the CSS progress bar
            overflowPanel.style.setProperty('--overflow-progress', '100%');
        }

        function resetOverflowTimer() {
            clearTimeout(overflowTimer);
            overflowPanel.classList.remove('overflow-counting');
            void overflowPanel.offsetWidth;
            overflowPanel.classList.add('overflow-counting');
            overflowTimer = setTimeout(closeOverflow, OVERFLOW_TTL);
        }
        // Expose so proxy buttons outside init() can call it
        _resetOverflowTimer = resetOverflowTimer;

        overflowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (overflowPanel.classList.contains('open')) {
                closeOverflow();
            } else {
                openOverflow();
            }
        });

        // Any interaction inside the popover resets the countdown (but keeps it open)
        overflowPanel.addEventListener('click', (e) => {
            e.stopPropagation();
            resetOverflowTimer();
        });

        // Click outside closes immediately
        document.addEventListener('click', (e) => {
            if (!overflowPanel.contains(e.target) && e.target !== overflowBtn && !overflowBtn.contains(e.target)) {
                closeOverflow();
            }
        });
    }

    function restartGame(seed) {
        // Field orientation (Trello: "rotate field −90°, enemies come
        // from above"). TALL boards transpose the grid to 16×24 and
        // the map walker runs top→bottom — the whole render/input
        // pipeline follows the COLS/ROWS globals, so nothing else
        // changes. Applied per RUN (mid-run toggling would invalidate
        // tower positions). Multiplayer always forces WIDE: both peers
        // must simulate the identical world.
        const fieldTall = !_activeMode && localStorage.getItem('neonFieldTall') === '1';
        window.COLS = fieldTall ? 16 : 24;
        window.ROWS = fieldTall ? 24 : 16;
        resizeCanvas();

        document.getElementById('restart-confirm').classList.add('hidden');
        document.getElementById('retire-confirm').classList.add('hidden');
        document.getElementById('victory').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('upgrade-menu').classList.add('hidden');

        // Remove targeting-mode element so it gets recreated fresh for new game
        let tm = document.getElementById('targeting-mode');
        if (tm) tm.remove();

        const canvas = document.getElementById('game-canvas');
        resizeCanvas();

        let useSeed = (typeof seed === 'number') ? seed : null;
        // Multiplayer fair-play: in MP mode everyone runs the SAME
        // base configuration regardless of their tech-tree unlocks —
        // default hero/kit, no ability, no tower variants. The
        // ascension tier comes from the host (set in waitroom; falls
        // back to local selectedTier for non-coordinated modes like
        // race). Avoids the case where ALICE's +25 % money kit
        // outclasses BOB before the first wave spawns.
        const mpActive = !!_activeMode;
        // FAIR-PLAY FLAG. Set BEFORE constructing Game so the tower
        // constructor reads it and skips mastery-perk bonuses. Also
        // gates applyBackpack and tower-cost mastery discount. Each
        // peer in a coop room thus places identical towers, has
        // identical economy, and the only variable left is player
        // skill. Cleared when the run ends (see leaveActiveMultiplayer
        // and restartGame in SP).
        if (typeof window !== 'undefined') {
            window.__neonMPFairPlay = mpActive;
        }
        // Coop has its OWN ascension track, separate from SP. Until
        // there's a real coop-progression mechanic, we hard-pin coop
        // to tier 0 so a host with SP-cleared A11 doesn't drag a
        // partner who only has A2 unlocked into an effects table the
        // partner has never seen. `save.mpAscensionCleared` exists
        // for future expansion. See COOP_FAIR_TIER constant below.
        const COOP_FAIR_TIER = 0;
        const tierToUse = mpActive ? COOP_FAIR_TIER : selectedTier;
        const loadoutToUse = mpActive
            ? {
                heroId: 'hero.' + DEFAULT_HERO,
                kitId:  'kit.'  + DEFAULT_KIT,
                abilityId: 'ability.none',
                towerLoadout: {},
            }
            : {
                heroId: selectedHero,
                kitId: selectedKit,
                abilityId: selectedAbility,
                towerLoadout: sanitizeTowerLoadout(selectedTowerLoadout),
            };
        game = new Game(canvas, useSeed, tierToUse, loadoutToUse);
        window.game = game;
        // Reset pinch zoom on every new run so the next game starts at
        // 1× regardless of how the previous run left the canvas.
        if (typeof window.__neonResetZoom === 'function') window.__neonResetZoom();
        if (typeof NeonAegis !== 'undefined') {
            if (NeonAegis.clearRunFlag) NeonAegis.clearRunFlag();
            NeonAegis.protectGame(game);
        }
        game.start();
        updateSeedDisplay();
        updateModeDisplay();
        updateBuildMenuForLoadout(game.towerLoadout);

        gameSpeed = 1;
        document.getElementById('speed-display').textContent = '1X';
        updateSpeedColor();

        const pauseEl = document.getElementById('pause-display');
        pauseEl.textContent = 'OFF';
        pauseEl.classList.remove('on', 'paused');

        const autoEl = document.getElementById('autopilot-display');
        autoEl.textContent = 'OFF';
        autoEl.classList.remove('on');

        hideScreen('main-menu');
        hideScreen('start-screen');
        hideScreen('game-over');
        hideScreen('restart-confirm');

        // M2: qol.fastai halves autopilot tick interval.
        if (NeonSave.hasUnlocked(save, 'qol.fastai')) {
            game.autopilotTickInterval = 15;
        }
        if (typeof refreshAbilityUI === 'function') refreshAbilityUI();
        if (typeof maybeShowStrategistPreview === 'function') maybeShowStrategistPreview();
    }

    document.getElementById('confirm-yes').addEventListener('click', () => {
        // Save the in-progress run's score BEFORE restarting — otherwise
        // RST would silently throw away the result. Uses the cached
        // player name (set at start-btn time).
        try {
            if (game && (game.state === 'playing' || game.state === 'paused')) {
                autoSaveScore(game.wave, game.ascensionTier, false);
            }
        } catch (_) {}
        const seedVal = document.getElementById('restart-seed-input').value.trim();
        const parsed = seedVal !== '' ? parseInt(seedVal) : null;
        clearAutoSaveKey();
        restartGame(!isNaN(parsed) && parsed !== null ? parsed : null);
    });
    document.getElementById('game-over-restart').addEventListener('click', () => {
        const seedVal = document.getElementById('gameover-seed-input').value.trim();
        const parsed = seedVal !== '' ? parseInt(seedVal) : null;
        restartGame(!isNaN(parsed) && parsed !== null ? parsed : null);
    });

    document.getElementById('victory-restart').addEventListener('click', () => {
        const seedVal = document.getElementById('victory-seed-input').value.trim();
        const parsed = seedVal !== '' ? parseInt(seedVal) : null;
        restartGame(!isNaN(parsed) && parsed !== null ? parsed : null);
    });

    const scoresList = document.getElementById('scores-list');
    const playerNameInput = document.getElementById('player-name');
    const submitScoreBtn = document.getElementById('submit-score');

    // Populate the score-tabs container with one tab per Ascension tier (0..M1 max).
    function renderScoreTabs() {
        const tabs = document.getElementById('score-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        // Endless ascension — cap the tabs at the highest tier the player
        // has actually unlocked + 1. Rendering an unbounded tab strip
        // would explode after a few endless clears.
        const maxVisible = (save.ascensionCleared | 0) + 1;
        for (let t = 0; t <= maxVisible; t++) {
            const btn = document.createElement('button');
            btn.className = 'score-tab';
            btn.textContent = 'A' + t;
            btn.dataset.tier = String(t);
            if (t === visibleScoreTier) btn.classList.add('selected');
            btn.addEventListener('click', () => setScoreTab(t));
            tabs.appendChild(btn);
        }
    }

    // Game-over scoreboard is now GLOBAL-ONLY. Same renderer + same
    // pair of filters (autopilot + cheated) the dedicated scoreboard
    // overlay uses. Local entries still surface because the renderer
    // merges them in if they haven't been published to NEON23 yet
    // (mirror of _sbScoresForTier). Defaults match the HTML
    // checkbox states: cheated HIDDEN, autopilot SHOWN.
    let _showCheats = false;
    let _hideAutopilot = false;
    const _esc = s => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    try {
        if (localStorage.getItem('neonSbHideCheated') === '0') _showCheats = true;
        else if (localStorage.getItem('neonSbHideCheated') === '1') _showCheats = false;
        if (localStorage.getItem('neonSbHideAuto') === '1') _hideAutopilot = true;
    } catch (_) {}

    function _renderScoreRow(idx, s) {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.padding = '4px 0';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        const cheatedClass = s.cheated ? ' class="score-cheated"' : '';
        const cheatTag = s.cheated ? '<span class="score-cheated-tag" title="Aegis flagged this run">CHEATED</span>' : '';
        const autoTag  = s.autopilot ? '<span class="score-autopilot-tag" title="Autopilot was used">AUTO</span>' : '';
        div.innerHTML =
            `<span${cheatedClass} style="color:#fff;">#${idx+1} ${_esc(s.name)}${cheatTag}${autoTag}</span>` +
            `<span${cheatedClass} style="color:#22d3ee;">WAVE ${s.wave}</span>`;
        return div;
    }

    function _gameOverScoresForTier(tier) {
        // Same three-source merge as _sbScoresForTier — see comment
        // there. Cached entries fill in for peers who are offline
        // right now but were online at some point.
        const remote = (window.NeonMP && NeonMP.global && NeonMP.global.snapshot)
            ? NeonMP.global.snapshot().filter(e => (e.tier | 0) === (tier | 0))
            : [];
        const cached = (save && save.globalCache && Array.isArray(save.globalCache['a' + tier]))
            ? save.globalCache['a' + tier]
            : [];
        const localList = (save.highScores['a' + tier] || []).slice();
        const byKey = new Map();
        for (const e of cached)    byKey.set(e.name + '|' + e.wave, e);
        for (const e of localList) byKey.set(e.name + '|' + e.wave, e);
        for (const e of remote)    byKey.set(e.name + '|' + e.wave, e);
        return Array.from(byKey.values()).sort((a, b) => b.wave - a.wave);
    }

    function renderScores(tier) {
        scoresList.innerHTML = '';
        const all = _gameOverScoresForTier(tier);
        const visible = all.filter(s => {
            if (!_showCheats && s.cheated) return false;
            if (_hideAutopilot && s.autopilot) return false;
            return true;
        });
        if (visible.length === 0) {
            const isOnline = !!(window.NeonMP && NeonMP.global);
            scoresList.innerHTML = `<div style="text-align:center; color:#64748b; font-size:0.9rem;">${
                isOnline ? 'NO RUNS YET — SYNCING…' : 'GLOBAL OFFLINE'
            }</div>`;
            return;
        }
        visible.slice(0, 5).forEach((s, i) => scoresList.appendChild(_renderScoreRow(i, s)));
    }

    // Filter toggles in the game-over scoreboard. Share the same
    // localStorage keys as the dedicated scoreboard overlay so a pref
    // change in one place stays applied in the other.
    const goHideAuto = document.getElementById('go-hide-autopilot');
    const goHideCheat = document.getElementById('go-hide-cheated');
    if (goHideAuto) {
        goHideAuto.checked = _hideAutopilot;
        goHideAuto.addEventListener('change', () => {
            _hideAutopilot = !!goHideAuto.checked;
            try { localStorage.setItem('neonSbHideAuto', _hideAutopilot ? '1' : '0'); } catch (_) {}
            renderScores(visibleScoreTier);
        });
    }
    if (goHideCheat) {
        goHideCheat.checked = !_showCheats;
        goHideCheat.addEventListener('change', () => {
            _showCheats = !goHideCheat.checked;
            try { localStorage.setItem('neonSbHideCheated', _showCheats ? '0' : '1'); } catch (_) {}
            renderScores(visibleScoreTier);
        });
    }

    // Subscribe to global board updates so live entries refresh while
    // the gameover screen is open. Also persists the merged snapshot
    // into save.globalCache so a reloaded device keeps relaying
    // other players' scores even if those players go offline. This is
    // what the user means by "scores keep propagating": each device
    // is a relay node, not just a leaf.
    if (window.NeonMP && NeonMP.global) {
        try {
            NeonMP.global.singleton().onUpdate((snap) => {
                renderScores(visibleScoreTier);
                try { _persistGlobalSnapshot(snap); } catch (_) {}
            });
        } catch (_) {}
    }
    // Per-tier mirror of the global board. Saved to localStorage on
    // every update. Capped per tier so a busy room doesn't grow the
    // save unbounded.
    const _GLOBAL_CACHE_PER_TIER = 50;
    let _persistGlobalThrottle = 0;
    function _persistGlobalSnapshot(snap) {
        if (!save) return;
        if (!save.globalCache || typeof save.globalCache !== 'object') save.globalCache = {};
        // Throttle persistence — onUpdate fires often during a burst.
        const now = Date.now();
        if (now - _persistGlobalThrottle < 500) return;
        _persistGlobalThrottle = now;
        const byTier = new Map();
        for (const e of snap) {
            const t = e.tier | 0;
            if (!byTier.has(t)) byTier.set(t, []);
            byTier.get(t).push(e);
        }
        for (const [t, entries] of byTier) {
            entries.sort((a, b) => b.wave - a.wave);
            save.globalCache['a' + t] = entries.slice(0, _GLOBAL_CACHE_PER_TIER);
        }
        try { NeonSave.write(save); } catch (_) {}
    }
    // On boot, push what this device already knows into the live board:
    //   1. save.globalCache — other players' entries we relayed before.
    //   2. save.highScores — OUR OWN historical runs, including ones
    //      recorded before the global board existed (or while offline).
    //      Without this, a player's old personal bests never reach the
    //      global board at all.
    // Bandwidth: merging is local. The board broadcasts these only if
    // the room's retained snapshot turns out not to know them already
    // (novelty gate in global.js), so a fully-synced device sends
    // nothing.
    setTimeout(() => {
        try {
            if (!window.NeonMP || !NeonMP.global || !save) return;
            const board = NeonMP.global.singleton();
            const mergeRaw = (raw) => {
                try {
                    const v = board._validateEntry ? board._validateEntry(raw) : null;
                    if (v && board._mergeEntry) board._mergeEntry(v);
                } catch (_) {}
            };
            if (save.globalCache && typeof save.globalCache === 'object') {
                for (const k of Object.keys(save.globalCache)) {
                    const arr = save.globalCache[k];
                    if (!Array.isArray(arr)) continue;
                    for (const entry of arr) mergeRaw(entry);
                }
            }
            if (save.highScores && typeof save.highScores === 'object') {
                for (const k of Object.keys(save.highScores)) {
                    const arr = save.highScores[k];
                    if (!Array.isArray(arr)) continue;
                    const tier = parseInt(String(k).replace(/^a/, ''), 10);
                    if (!Number.isInteger(tier)) continue;
                    for (const entry of arr) {
                        if (!entry || typeof entry !== 'object') continue;
                        mergeRaw({
                            name: entry.name, wave: entry.wave, tier,
                            cheated: !!entry.cheated,
                            autopilot: !!entry.autopilot,
                            retired: !!entry.retired,
                        });
                    }
                }
            }
        } catch (_) {}
    }, 1200);

    function setScoreTab(tier) {
        visibleScoreTier = tier;
        document.querySelectorAll('.score-tab').forEach(b => {
            b.classList.toggle('selected', parseInt(b.dataset.tier) === tier);
        });
        renderScores(tier);
    }

    renderScoreTabs();

    // ── Dedicated scoreboard overlay (main menu + setup screen) ──────
    // The game-over scores list shows the top 5; this overlay shows the
    // SAME data but rendered as "your row ±3" so a long-running player
    // sees their current standing relative to neighbours rather than a
    // top-5 they can't break into.
    const SB_TABS_EL = document.getElementById('sb-tabs');
    const SB_LIST_EL = document.getElementById('sb-list');
    let _sbTier = 0;
    // Filter toggles. Default: hide cheated runs; show autopilot runs
    // (just tagged). Both persist in localStorage so the player's
    // chosen view sticks across sessions.
    let _sbHideAuto = false;
    let _sbHideCheated = true;
    try {
        if (localStorage.getItem('neonSbHideAuto') === '1') _sbHideAuto = true;
        if (localStorage.getItem('neonSbHideCheated') === '0') _sbHideCheated = false;
    } catch (_) {}

    // Global-only scoreboard. Pulls from NeonMP.global which auto-syncs
    // over MQTT in the background (every 60s, with a 5s rebroadcast
    // throttle per peer). If the global module isn't loaded yet OR
    // the snapshot is empty (e.g. fresh tab before the first sync),
    // we fall back to the local save's history so the player isn't
    // staring at "WAITING FOR PEERS…" for their own runs.
    function _sbScoresForTier(tier) {
        // Three sources merged into one view:
        //   1. live remote snapshot (NeonMP.global.snapshot)
        //   2. cached remote from the last session (save.globalCache)
        //   3. local personal runs (save.highScores)
        // Live wins on (name, wave) collision; cached fills in any
        // entries the live board hasn't refreshed yet (e.g. peers
        // currently offline); local makes sure the player sees their
        // own runs even before the next publish.
        const remote = (window.NeonMP && NeonMP.global && NeonMP.global.snapshot)
            ? NeonMP.global.snapshot().filter(e => (e.tier | 0) === (tier | 0))
            : [];
        const cached = (save && save.globalCache && Array.isArray(save.globalCache['a' + tier]))
            ? save.globalCache['a' + tier]
            : [];
        const localList = (save.highScores['a' + tier] || []).slice();
        const byKey = new Map();
        // Order matters: weakest source first, strongest last (Map.set
        // overwrites).
        for (const e of cached)    byKey.set(e.name + '|' + e.wave, e);
        for (const e of localList) byKey.set(e.name + '|' + e.wave, e);
        for (const e of remote)    byKey.set(e.name + '|' + e.wave, e);
        return Array.from(byKey.values()).sort((a, b) => b.wave - a.wave);
    }

    function _renderSbRow(idx, s, isMe) {
        const div = document.createElement('div');
        div.className = 'sb-row' + (isMe ? ' is-me' : '');
        const cheatTag = s.cheated ? '<span class="score-cheated-tag" title="Aegis flagged this run">CHEATED</span>' : '';
        const autoTag  = s.autopilot ? '<span class="score-autopilot-tag" title="Autopilot was used in this run">AUTO</span>' : '';
        const retired  = s.retired ? '<span class="score-retired-tag">RETIRED</span>' : '';
        div.innerHTML =
            `<span class="sb-rank">#${idx + 1}</span>` +
            `<span class="sb-name">${_esc(s.name)}${retired}${autoTag}${cheatTag}</span>` +
            `<span class="sb-wave">W${s.wave}</span>`;
        return div;
    }

    function renderScoreboardOverlay() {
        if (!SB_LIST_EL) return;
        const meName = (typeof getPlayerName === 'function') ? getPlayerName() : '';
        const all = _sbScoresForTier(_sbTier);
        const visible = all.filter(s => {
            if (_sbHideCheated && s.cheated) return false;
            if (_sbHideAuto    && s.autopilot) return false;
            return true;
        });
        SB_LIST_EL.innerHTML = '';
        if (visible.length === 0) {
            SB_LIST_EL.innerHTML =
                '<div style="text-align:center; color:#64748b; font-size:0.9rem;">NO RUNS YET — SYNCING…</div>';
            return;
        }
        // Find OUR best rank in the (already sorted-desc) list.
        let myRank = -1;
        for (let i = 0; i < visible.length; i++) {
            if (visible[i].name === meName) { myRank = i; break; }
        }
        // Window: 3 above + me + 3 below. If we're not in the list,
        // just show top 7 (so the player can still see what they're
        // chasing).
        let start, end;
        if (myRank < 0) { start = 0; end = Math.min(visible.length, 7); }
        else {
            start = Math.max(0, myRank - 3);
            end   = Math.min(visible.length, myRank + 4);
            // If we're near the top, extend downward so we always show 7.
            const span = end - start;
            if (span < 7) end = Math.min(visible.length, start + 7);
        }
        for (let i = start; i < end; i++) {
            const isMe = (i === myRank);
            SB_LIST_EL.appendChild(_renderSbRow(i, visible[i], isMe));
        }
    }

    function renderScoreboardTabs() {
        if (!SB_TABS_EL) return;
        SB_TABS_EL.innerHTML = '';
        const maxVisible = (save.ascensionCleared | 0) + 1;
        for (let t = 0; t <= maxVisible; t++) {
            const btn = document.createElement('button');
            btn.className = 'score-tab';
            btn.textContent = 'A' + t;
            if (t === _sbTier) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                _sbTier = t;
                renderScoreboardTabs();
                renderScoreboardOverlay();
            });
            SB_TABS_EL.appendChild(btn);
        }
    }

    // Remember which screen launched the scoreboard so BACK returns
    // there (main-menu vs start-screen vs game-over). Without this,
    // BACK always dropped the player to the main menu — confusing
    // when they were mid-setup picking a tier and just wanted to
    // glance at the board.
    let _sbOrigin = 'main-menu';
    function openScoreboard() {
        _sbTier = (game && Number.isFinite(game.ascensionTier))
            ? game.ascensionTier : (selectedTier | 0);
        // Nudge the global sync: open the global room if it isn't
        // already up, and force a broadcast so peers send us their
        // boards right now rather than wait for the next 60-s tick.
        if (window.NeonMP && NeonMP.global) {
            try {
                const board = NeonMP.global.singleton();
                Promise.resolve(board.start()).then(() => {
                    try { board.broadcastNow(); } catch (_) {}
                }).catch(() => {});
            } catch (_) {}
        }
        renderScoreboardTabs();
        renderScoreboardOverlay();
        // Record current visible screen as the return target.
        _sbOrigin = 'main-menu';
        for (const id of ['start-screen', 'game-over']) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) { _sbOrigin = id; break; }
        }
        // Mirror navigateToTechTree: push history + hide the screen
        // we came from so the overlay isn't fighting for layout. The
        // fact that the SCOREBOARD button "did nothing" for some
        // players was the main-menu still being clickable through the
        // overlay on smaller viewports.
        _enterSubScreen();
        hideScreen('main-menu');
        hideScreen('start-screen');
        hideScreen('game-over');
        showScreen('scoreboard-screen');
    }
    function closeScoreboard() {
        hideScreen('scoreboard-screen');
        // Pop history so the device Back button stack stays in sync,
        // then re-show whichever screen launched the scoreboard.
        _exitSubScreenState();
        showScreen(_sbOrigin);
    }
    window.openScoreboard = openScoreboard;
    window.closeScoreboard = closeScoreboard;

    const sbBackBtn = document.getElementById('sb-back-btn');
    if (sbBackBtn) sbBackBtn.addEventListener('click', closeScoreboard);
    // Filter toggles. Persist on change so the player's preference
    // sticks across sessions.
    const sbHideAuto = document.getElementById('sb-hide-autopilot');
    const sbHideCheat = document.getElementById('sb-hide-cheated');
    if (sbHideAuto) {
        sbHideAuto.checked = _sbHideAuto;
        sbHideAuto.addEventListener('change', () => {
            _sbHideAuto = !!sbHideAuto.checked;
            try { localStorage.setItem('neonSbHideAuto', _sbHideAuto ? '1' : '0'); } catch (_) {}
            renderScoreboardOverlay();
        });
    }
    if (sbHideCheat) {
        sbHideCheat.checked = _sbHideCheated;
        sbHideCheat.addEventListener('change', () => {
            _sbHideCheated = !!sbHideCheat.checked;
            try { localStorage.setItem('neonSbHideCheated', _sbHideCheated ? '1' : '0'); } catch (_) {}
            renderScoreboardOverlay();
        });
    }
    const menuScoresBtn = document.getElementById('menu-scores-btn');
    if (menuScoresBtn) menuScoresBtn.addEventListener('click', openScoreboard);
    const setupScoresBtn = document.getElementById('setup-scores-btn');
    if (setupScoresBtn) setupScoresBtn.addEventListener('click', openScoreboard);

    // Refresh scoreboard overlay when the global board updates so new
    // entries appear without the player closing and re-opening.
    if (window.NeonMP && NeonMP.global && NeonMP.global.singleton) {
        try {
            NeonMP.global.singleton().onUpdate(() => {
                if (document.getElementById('scoreboard-screen').classList.contains('hidden')) return;
                renderScoreboardOverlay();
            });
        } catch (_) {}
    }

    // Pre-fill the player name input from the persisted localStorage
    // value so the player doesn't retype it every run.
    try {
        const savedName = localStorage.getItem('neonPlayerName');
        if (savedName) playerNameInput.value = savedName;
    } catch (_) {}

    window.loadScores = function() {
        // Default the visible tab to the current run's tier on each game-over.
        setScoreTab(game ? game.ascensionTier : selectedTier);
    };

    // Name submission — appends to per-tier high-score list. Does NOT
    // re-award XP; that happens in onRunEnded immediately after death.
    // Names allow A-Z 0-9 + space + dash, up to 16 chars. Old saves with
    // 3-char names continue to render unchanged.
    submitScoreBtn.addEventListener('click', () => {
        const raw = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9 \-]/g, '').trim();
        const name = raw.slice(0, 16);
        if (name.length > 0 && game.state === 'gameover') {
            const tier = game.ascensionTier;
            // Cheated flag — true if Aegis flagged this save OR if any
            // sensor tripped during the run. We tag the score so honest
            // peers can hide it (off by default in the scoreboard UI).
            const cheated = !!(
                (typeof NeonAegis !== 'undefined' && NeonAegis.isFlagged && NeonAegis.isFlagged(save)) ||
                (typeof NeonAegis !== 'undefined' && NeonAegis.lastFlag && NeonAegis.lastFlag()) ||
                (window.__neonAegisLastFlag)
            );
            const list = save.highScores['a' + tier] || [];
            list.push({ name, wave: game.wave, cheated });
            list.sort((a, b) => b.wave - a.wave);
            save.highScores['a' + tier] = list.slice(0, 5);
            NeonSave.write(save);
            // Remember the name for the global leaderboard publisher and
            // for next-run convenience.
            try { localStorage.setItem('neonPlayerName', name); } catch (_) {}
            // Broadcast to the global leaderboard if available.
            if (window.NeonMP && window.NeonMP.global && window.NeonMP.global.publish) {
                window.NeonMP.global.publish({ name, wave: game.wave, tier, cheated });
            }
            document.getElementById('score-entry').style.display = 'none';
            renderScoreTabs();
            setScoreTab(tier);
        }
    });

    // Called by Game.gameOver() the instant a run ends. Always awards XP
    // (whether or not the player submits a name) and updates ascensionCleared.
    // Exposes the XP breakdown to renderRunResultXP for the overlay.
    window.onRunEnded = function (result) {
        const { wave, tier, retired, hpEverLost } = result;
        // The run ended through the front door — drop the crash-recovery
        // checkpoint so the boot reconciler doesn't double-award.
        try {
            if (save && save.pendingRun) { delete save.pendingRun; NeonSave.write(save); }
        } catch (_) {}
        // Auto-save the score immediately. Uses the cached name set at
        // start-btn time. Idempotent — RST/retire callers also trigger
        // this and the dedupe key prevents double entries.
        try { autoSaveScore(wave, tier, retired); } catch (_) {}
        // Flawless retire: the +50% bonus only fires if no enemy ever
        // reached the base this run. Take damage even once and the
        // retire still ends the run normally, but without the kicker.
        const flawlessRetire = retired && !hpEverLost;

        // ── AEGIS LOCK ────────────────────────────────────────────────────
        // If Aegis flagged the save (signed-save tamper, RNG override,
        // console money/HP spike, etc.) we withhold ALL meta progression:
        // metaXP gain, mastery, maxWaveReached, loot. The render function
        // shows a red banner explaining the situation. RESET SAVE clears
        // the flag.
        // Aegis flag is now RUN-SCOPED — the persistent save is never
        // corrupted. The flag zeros this run's rewards, then clears so
        // the next run starts fresh.
        const runFlagged = (typeof NeonAegis !== 'undefined' && NeonAegis.isRunFlagged && NeonAegis.isRunFlagged())
            || save.cheaterDetected; // legacy paths
        if (runFlagged) {
            const flagReason = (typeof NeonAegis !== 'undefined' && NeonAegis.runFlagReason && NeonAegis.runFlagReason())
                || save.cheaterReason || 'anomaly';
            const zeroXP = { waveXP: 0, clearBonus: 0, firstBonus: 0, total: 0, retireBonus: 0 };
            if (typeof renderRunResultXP === 'function') {
                renderRunResultXP({
                    wave, tier, xp: zeroXP, firstClear: false,
                    autoUnlockedNodeId: null, masteryResults: [],
                    retired, lootGranted: [], lootRoll: null,
                    cheaterReason: flagReason
                });
            }
            if (typeof NeonAegis !== 'undefined' && NeonAegis.clearRunFlag) NeonAegis.clearRunFlag();
            return;
        }

        // "First clear at this tier" — fires when wave >= 30 AND the
        // player hasn't already cleared THIS exact tier. Was `tier >
        // save.ascensionCleared` which meant clearing tier N only
        // bumped the counter if you were on a HIGHER tier than your
        // record. So clearing tier 0 (the very first achievement)
        // never bumped to 1, leaving the player permanently at the
        // tier-0 default. Changed to `>=` so each tier you've ever
        // cleared advances the counter at least once.
        const firstClear = wave >= 30 && tier >= save.ascensionCleared;

        const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
        const retireBonus = flawlessRetire ? Math.floor(xp.total * 0.5) : 0;
        xp.retireBonus = retireBonus;
        xp.total += retireBonus;
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        let autoUnlockedNodeId = null;
        if (firstClear) {
            // Bump to at least tier+1 so the next-tier button is
            // unlocked. ascensionCleared = MAX(existing, tier+1)
            // captures both "first time clearing tier N" and "the
            // player jumped straight to a higher tier".
            save.ascensionCleared = Math.max(save.ascensionCleared, tier + 1);
            // Auto-advance the selector so the next run defaults to
            // the newly-unlocked tier, not the one we just cleared.
            try { if (typeof selectedTier !== 'undefined') selectedTier = save.ascensionCleared; } catch (_) {}
            autoUnlockedNodeId = NeonTree.autoUnlockOnAscension(save, tier);
        }
        NeonSave.write(save);

        if (firstClear) {
            renderAscensionSelector('start');
            renderAscensionSelector('gameover');
            renderAscensionSelector('restart');
            renderAscensionSelector('victory');
            renderLoadoutDropdowns();
            updateMainMenuState();
        }

        const masteryResults = NeonSave.tallyMastery(save, game.towers);
        save.maxWaveReached = Math.max(save.maxWaveReached || 0, wave);

        // End-of-run loot — see the rebalance commit for the chance curve.
        const lootGranted = [];
        let lootRoll = null;
        if (window.NeonBackpack && typeof BACKPACK_ITEMS !== 'undefined' && wave >= 20) {
            const luckRanks = (save.backpack && save.backpack.luckBoost) || 0;
            const boost = luckRanks * NeonSave.LUCK_PER_RANK;
            const baseChance = 0.2 + 0.7 * (1 - Math.pow(0.97, wave - 20));
            const chance = Math.min(NeonSave.LUCK_CHANCE_CAP, baseChance + boost);
            const roll = Math.random();
            lootRoll = { chance, boost, hit: roll < chance };
            if (lootRoll.hit) {
                const id = NeonBackpack.lootRoll(BACKPACK_ITEMS, tier, Math.random);
                if (NeonSave.grantItem(save, id)) lootGranted.push(id);
            }
        }

        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults, retired, lootGranted, lootRoll });
        }
    };

    // ── Mobile-safe run termination ──────────────────────────────────
    // Mobile browsers (especially iOS Safari and Android Chrome) freeze
    // and then kill backgrounded tabs aggressively. If the player paused,
    // closed the browser, and reopened it, the page reloads from scratch
    // and the run vanishes — no XP awarded. We catch `pagehide` (fires
    // when the page is being torn down for real, including bfcache evict
    // on mobile) and treat it as an implicit retire so XP is awarded and
    // the score lands in the leaderboard. Multiplayer runs are NEVER
    // auto-terminated this way: MP scoring is host-coordinated and a
    // unilateral end on one peer would corrupt the other's view.
    let _runEndedOnHide = false;
    const _maybeEndRunOnHide = () => {
        if (_runEndedOnHide) return;
        if (!game || (game.state !== 'playing' && game.state !== 'paused')) return;
        if (window.__neonMPFairPlay === true) return;          // coop/race in progress
        _runEndedOnHide = true;
        try {
            window.onRunEnded({
                wave: game.wave | 0,
                tier: game.ascensionTier | 0,
                retired: true,
                hpEverLost: true,    // no flawless bonus on implicit end
            });
        } catch (_) {}
    };
    window.addEventListener('pagehide', _maybeEndRunOnHide);
    // visibilitychange → hidden is the earlier signal on iOS Safari,
    // where `pagehide` sometimes doesn't fire when the user swipes the
    // tab away. Fire on both; the _runEndedOnHide latch dedupes.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') _maybeEndRunOnHide();
    });
    // Test hook for the regression suite — lets a headless playwright
    // verify the handler is wired without having to actually destroy
    // the page mid-run.
    if (typeof window !== 'undefined') window.__neonEndRunOnHide = _maybeEndRunOnHide;

    // ── Crash-recovery checkpoint ────────────────────────────────────
    // pagehide/visibilitychange are best-effort: Android (and the APK
    // WebView) can kill a backgrounded page with NO event at all —
    // that's the "paused, closed the browser, reopened: main menu and
    // no XP" report. So every SP run also checkpoints {wave, tier} to
    // the save whenever the wave advances; onRunEnded clears it, and
    // the boot reconciler below awards XP for any checkpoint that
    // survived (= the process died mid-run).
    setInterval(() => {
        try {
            if (!game || game.state !== 'playing') return;
            if (_activeMode || window.__neonMPFairPlay === true) return;   // SP only
            if (!save) return;
            const w = game.wave | 0;
            if (w < 1) return;
            if (save.pendingRun && save.pendingRun.wave === w) return;     // unchanged
            save.pendingRun = {
                wave: w,
                tier: game.ascensionTier | 0,
                ap: !!game._autopilotEverUsed,
                t: Date.now(),
            };
            NeonSave.write(save);
        } catch (_) {}
    }, 5000);
    // Boot reconciler: a surviving checkpoint means the last run died
    // without onRunEnded (process killed). Award the wave XP + score
    // now. No loot or mastery — those need the dead run's tower state,
    // which is gone; XP and the leaderboard entry are what the player
    // actually missed.
    (function recoverInterruptedRun() {
        try {
            const p = save && save.pendingRun;
            if (!p || !Number.isInteger(p.wave) || p.wave < 1) return;
            delete save.pendingRun;
            const wave = p.wave | 0, tier = p.tier | 0;
            const firstClear = wave >= 30 && tier >= save.ascensionCleared;
            const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
            save.metaXP        += xp.total;
            save.totalXPEarned += xp.total;
            if (firstClear) {
                save.ascensionCleared = Math.max(save.ascensionCleared, tier + 1);
                try { NeonTree.autoUnlockOnAscension(save, tier); } catch (_) {}
            }
            save.maxWaveReached = Math.max(save.maxWaveReached || 0, wave);
            // Leaderboard entry for the interrupted run (not retired,
            // no flawless bonus — we can't verify either).
            const name = getPlayerName();
            if (name) {
                const list = save.highScores['a' + tier] || [];
                list.push({ name, wave, retired: false, cheated: false, autopilot: !!p.ap });
                list.sort((a, b) => b.wave - a.wave);
                save.highScores['a' + tier] = list.slice(0, 5);
                if (window.NeonMP && window.NeonMP.global && window.NeonMP.global.publish) {
                    try {
                        window.NeonMP.global.publish({ name, wave, tier, autopilot: !!p.ap });
                    } catch (_) {}
                }
            }
            NeonSave.write(save);
            try { updateMainMenuState(); } catch (_) {}
            // Tell the player their progress survived.
            const menu = document.getElementById('main-menu');
            if (menu) {
                const note = document.createElement('div');
                note.id = 'recovered-run-note';
                note.style.cssText = 'margin:8px auto;padding:6px 12px;max-width:340px;' +
                    'border:1px solid #34d399;border-radius:6px;color:#34d399;' +
                    'font-size:0.8rem;text-align:center;';
                note.textContent = `Interrupted run recovered — wave ${wave} (A${tier}), +${xp.total} XP banked.`;
                menu.insertBefore(note, menu.firstChild ? menu.firstChild.nextSibling : null);
                setTimeout(() => { try { note.remove(); } catch (_) {} }, 30000);
            }
        } catch (_) { /* recovery is best-effort */ }
    })();

    document.getElementById('confirm-no').addEventListener('click', () => {
        document.getElementById('restart-confirm').classList.add('hidden');
        game.state = 'playing';
    });

    let sellTimeout = null;
    document.getElementById('sell-btn').addEventListener('click', (e) => {
        if (!game.selectedTowers || game.selectedTowers.length === 0) return;
        let btn = e.currentTarget;
        
        if (btn.dataset.confirm === 'true') {
            let totalSell = 0;
            // Capture references to broadcast BEFORE we mutate game.towers,
            // so mpBroadcastSell can look up the index correctly.
            const toSell = game.selectedTowers.slice();
            for (let t of toSell) {
                if (window.__neonMPBroadcast) window.__neonMPBroadcast.sell(t);
                totalSell += t.getSellValue();
                game.towers = game.towers.filter(tower => tower !== t);
            }
            game.money += totalSell;
            game.selectPlacedTower(null);
            game.updateUI();
            
            btn.dataset.confirm = 'false';
            clearTimeout(sellTimeout);
        } else {
            btn.dataset.confirm = 'true';
            btn.innerHTML = 'CONFIRM SELL?';
            clearTimeout(sellTimeout);
            sellTimeout = setTimeout(() => {
                btn.dataset.confirm = 'false';
                if (game.selectedTowers && game.selectedTowers.length > 0) {
                    let totalSell = game.selectedTowers.reduce((sum, current) => sum + current.getSellValue(), 0);
                    btn.innerHTML = `SELL <span class="cost" id="sell-value">${totalSell}¢</span>`;
                }
            }, 3000);
        }
    });

    window.addEventListener('keydown', (e) => {
        // Don't intercept keystrokes the user is typing into seed/name inputs.
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // Space to pause/unpause
        if (e.code === 'Space' && (game.state === 'playing' || game.state === 'paused')) {
            e.preventDefault();
            togglePause();
            return;
        }

        // ESC to close menus or cancel building
        if (e.key === 'Escape') {
            // Close upgrade menu
            document.getElementById('upgrade-menu').classList.add('hidden');
            // Cancel tower building
            if (selectedTowerType) {
                selectTower(null);
            }
            return;
        }

        // Allow hotkeys during pause too — pre-selecting builds while
        // paused is exactly when fast-placement matters.
        if (game.state !== 'playing' && game.state !== 'paused') return;

        // Upgrades 1-3 (only when a tower is selected)
        if (e.key >= '1' && e.key <= '3' && game.selectedTowers && game.selectedTowers.length > 0) {
            let idx = parseInt(e.key) - 1;
            const selBefore = game.selectedTowers.slice();
            const moneyBefore = game.money;
            game.buyUpgrade(idx);
            if (window.__neonMPBroadcast && game.money < moneyBefore) {
                for (const t of selBefore) window.__neonMPBroadcast.upgrade(t, idx);
            }
        }
        // Build 1-9 — Relay (income) maps to 9. Order matches the build menu.
        else if (e.key >= '1' && e.key <= '9') {
            const towers = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];
            let idx = parseInt(e.key) - 1;
            selectTower(towers[idx]);
        }
    });

    // When auto-flip has rotated the canvas 180° (device held upside-down), a
    // screen point maps to the un-rotated frame by negating around the canvas
    // centre (180° is its own inverse; the bounding rect is unchanged). One
    // helper used by every game-canvas pointer read.
    // Un-rotate a client point around the canvas centre by the current display
    // rotation (0/90/180/270), returning a point in the SAME client-space frame
    // as before — so the pinch/pan handlers that call this keep working
    // unchanged; only getCanvasPos needs the rotated-dimension fix-up below.
    function flipClient(clientX, clientY) {
        const deg = canvasRotationDeg();
        if (!deg) return { x: clientX, y: clientY };
        const r = canvas.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const rad = -deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = clientX - cx, dy = clientY - cy;
        return { x: cx + (dx * cos - dy * sin), y: cy + (dx * sin + dy * cos) };
    }

    function getCanvasPos(e) {
        const rect = canvas.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const p = flipClient(e.clientX, e.clientY);
        // Use the UN-rotated canvas CSS size: when rotated 90°/270° the
        // bounding rect's width/height are swapped, so rect.* would mis-scale.
        const cssW = parseFloat(canvas.style.width)  || rect.width;
        const cssH = parseFloat(canvas.style.height) || rect.height;
        const localX = p.x - cx + cssW / 2;       // 0..cssW in the un-rotated canvas
        const localY = p.y - cy + cssH / 2;
        // The canvas now fills the container; the field is drawn centred inside
        // it (offset FIELD_OFF*_CSS) at its own size (FIELD_CSS_*). Map into the
        // FIELD's coordinate space, mirroring game.draw's transform exactly.
        const fieldW = window.FIELD_CSS_W || cssW;
        const fieldH = window.FIELD_CSS_H || cssH;
        const offX = window.FIELD_OFFX_CSS || 0;
        const offY = window.FIELD_OFFY_CSS || 0;
        const scaleX = (window.COLS * window.TILE_SIZE) / fieldW;
        const scaleY = (window.ROWS * window.TILE_SIZE) / fieldH;
        // Invert the pinch-zoom view transform. Zoom lives in the
        // render transform now (not on the element), so the bounding
        // rect no longer reflects it — undo field-offset + translate-then-scale
        // explicitly before mapping CSS px to logical units.
        const Z = window.__neonZoom || { scale: 1, tx: 0, ty: 0 };
        return {
            x: ((localX - offX - Z.tx) / Z.scale) * scaleX,
            y: ((localY - offY - Z.ty) / Z.scale) * scaleY
        };
    }

    canvas.addEventListener('pointermove', (e) => {
        const pos = getCanvasPos(e);
        mousePos.x = pos.x;
        mousePos.y = pos.y;
    });

    // ── Canvas pinch-zoom + 2-finger pan ────────────────────────────────
    // Small-screen players couldn't read the field clearly. The zoom
    // state lives in window.__neonZoom and is consumed by the RENDER
    // TRANSFORM inside Game.draw — every vector path re-rasterizes at
    // the zoomed resolution, so the field stays crisp at any zoom on
    // any screen. (The previous implementation CSS-scaled the canvas
    // element, which stretches the rendered bitmap: blurry at 2×+,
    // plus a compositing-layer hairline bug on some mobile browsers.
    // Both go away with no element transform at all.)
    // tx/ty semantics are unchanged: CSS-px translate applied before
    // scale, origin 0 0 — the pinch/clamp math below is identical.
    //
    // Single-finger touches pass through to the existing build/place
    // logic. Only 2-finger touchmove triggers a zoom/pan.
    const _zoom = { scale: 1, tx: 0, ty: 0 };
    window.__neonZoom = _zoom;
    const ZOOM_MIN = 1;       // never zoom out below natural size
    const ZOOM_MAX = 4;
    function applyZoom() {
        // The render loop picks the new state up on its next frame.
        // While paused / on overlays the loop doesn't tick, so force
        // one draw to commit the new view immediately.
        if (typeof game !== 'undefined' && game && game.state !== 'playing') {
            try { game.draw(); } catch (_) {}
        }
    }
    function resetZoom() {
        _zoom.scale = 1; _zoom.tx = 0; _zoom.ty = 0;
        applyZoom();
    }
    window.__neonResetZoom = resetZoom;

    let _pinch = null;  // {d0, cx0, cy0, scale0, tx0, ty0}
    // Single-finger pan state — only kicks in when scale > 1, so taps
    // at the base zoom still place towers normally. Activated after
    // the finger has moved past PAN_THRESHOLD without lifting.
    let _spanPan = null;
    const PAN_THRESHOLD_PX = 12;
    function clampPan() {
        // No CSS transform on the canvas any more, so the bounding
        // rect is the layout size directly (it used to be the SCALED
        // rect, hence the old `/ _zoom.scale`).
        const rect = canvas.getBoundingClientRect();
        const canvasW = rect.width;
        const canvasH = rect.height;
        const maxTx = canvasW * (_zoom.scale - 1);
        const maxTy = canvasH * (_zoom.scale - 1);
        if (_zoom.tx > 0) _zoom.tx = 0;
        if (_zoom.ty > 0) _zoom.ty = 0;
        if (_zoom.tx < -maxTx) _zoom.tx = -maxTx;
        if (_zoom.ty < -maxTy) _zoom.ty = -maxTy;
    }
    function touchCentroid(touches) {
        let x = 0, y = 0;
        for (let i = 0; i < touches.length; i++) {
            const p = flipClient(touches[i].clientX, touches[i].clientY);   // 180°-aware
            x += p.x;
            y += p.y;
        }
        return { x: x / touches.length, y: y / touches.length };
    }
    function touchDistance(t0, t1) {
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        return Math.hypot(dx, dy);
    }

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            const d0 = touchDistance(e.touches[0], e.touches[1]);
            const c0 = touchCentroid(e.touches);
            _pinch = {
                d0, cx0: c0.x, cy0: c0.y,
                scale0: _zoom.scale, tx0: _zoom.tx, ty0: _zoom.ty,
            };
            // 2-finger pinch supersedes any single-finger pan we
            // might have just started.
            _spanPan = null;
            e.preventDefault();
            if (typeof clearTimeout === 'function' && window.__touchState_clearLP) {
                window.__touchState_clearLP();
            }
            return;
        }
        // Single-finger touchstart on the canvas. Don't commit to
        // pan yet — wait until the user drags past PAN_THRESHOLD_PX.
        // Until then, a quick tap fires the existing pointerdown
        // tower-place / select logic. Pan is only meaningful while
        // zoomed in (otherwise the canvas already fits the screen).
        if (e.touches.length === 1 && _zoom.scale > 1) {
            const t = e.touches[0];
            const sp = flipClient(t.clientX, t.clientY);   // 180°-aware
            _spanPan = {
                startX: sp.x, startY: sp.y,
                tx0: _zoom.tx, ty0: _zoom.ty,
                active: false,
            };
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (_pinch && e.touches.length >= 2) {
            const d1 = touchDistance(e.touches[0], e.touches[1]);
            const c1 = touchCentroid(e.touches);
            if (d1 <= 0) return;
            const ratio = d1 / _pinch.d0;
            let newScale = _pinch.scale0 * ratio;
            if (newScale < ZOOM_MIN) newScale = ZOOM_MIN;
            if (newScale > ZOOM_MAX) newScale = ZOOM_MAX;
            const k = newScale / _pinch.scale0;
            _zoom.scale = newScale;
            _zoom.tx = c1.x - (_pinch.cx0 - _pinch.tx0) * k;
            _zoom.ty = c1.y - (_pinch.cy0 - _pinch.ty0) * k;
            // Gesture in flight: Game._drawMapLayer blits the stale
            // map raster warped to the new transform instead of
            // re-rasterizing 300 tiles per touchmove. Cleared on
            // touchend → first still frame re-renders crisp.
            window.__neonZoomGesture = true;
            clampPan();
            applyZoom();
            e.preventDefault();
            return;
        }
        // Single-finger drag while zoomed in → pan the field. Activate
        // only after the user has moved past PAN_THRESHOLD so a
        // tap-with-jitter still registers as a tap (and places a
        // tower / selects, per the existing pointerdown handler).
        if (_spanPan && e.touches.length === 1 && _zoom.scale > 1) {
            const t = e.touches[0];
            const cp = flipClient(t.clientX, t.clientY);   // 180°-aware; startX/Y are stored flipped too
            const dx = cp.x - _spanPan.startX;
            const dy = cp.y - _spanPan.startY;
            if (!_spanPan.active && Math.hypot(dx, dy) >= PAN_THRESHOLD_PX) {
                _spanPan.active = true;
            }
            if (_spanPan.active) {
                _zoom.tx = _spanPan.tx0 + dx;
                _zoom.ty = _spanPan.ty0 + dy;
                window.__neonZoomGesture = true;
                clampPan();
                applyZoom();
                e.preventDefault();
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length < 2 && _pinch) {
            _pinch = null;
            window.__neonPinchCooldownUntil = Date.now() + 250;
        }
        if (_spanPan && e.touches.length === 0) {
            const wasActive = _spanPan.active;
            _spanPan = null;
            // If we actually panned, suppress the lingering tap so
            // the finger lift doesn't place a tower at the wrong cell.
            if (wasActive) {
                window.__neonPinchCooldownUntil = Date.now() + 200;
            }
        }
        if (e.touches.length === 0) {
            // Fingers lifted → next frame re-rasterizes the map layer
            // at the settled transform (crisp).
            window.__neonZoomGesture = false;
            applyZoom();
        }
    });
    canvas.addEventListener('touchcancel', () => {
        window.__neonZoomGesture = false;
        if (_pinch) {
            _pinch = null;
            window.__neonPinchCooldownUntil = Date.now() + 250;
        }
        if (_spanPan) {
            if (_spanPan.active) window.__neonPinchCooldownUntil = Date.now() + 200;
            _spanPan = null;
        }
    });

    // --- Mobile touch handling: tap + drag-threshold + long-press tooltip ---
    // Replaces the old unconditional-drag-on-touchstart logic, which broke
    // horizontal scrolling of the tower dock and had no tooltip on touch.
    function isMobile() {
        return document.body.classList.contains('touch-ui') || window.innerWidth <= 768;
    }

    // Shared with the older hover path; this hash is (re)declared further
    // down in init() — via closure it's available by the time any callback
    // runs, so we capture a reference lazily inside handlers.
    const DRAG_THRESHOLD_PX = 10;
    const LONG_PRESS_MS     = 450;
    let touchState = null; // { type, el, startX, startY, dragging, longPressFired, longPressTimer, canDrag }

    function getTowerTypeFromEl(el) {
        if (el.dataset && el.dataset.type) return el.dataset.type;
        if (el.id === 'potion-btn') return 'potion';
        return null;
    }

    function showLongPressTooltip(type, anchorEl) {
        const info = (typeof window.getTooltipInfo === 'function') ? window.getTooltipInfo(type) : null;
        if (!info) return;
        const tip = document.getElementById('tower-tooltip');
        document.getElementById('tt-name').textContent = info.name;
        document.getElementById('tt-desc').textContent = info.desc;
        document.getElementById('tt-stats').innerHTML =
            `<span>DMG <b>${info.dmg}</b></span>` +
            `<span>RNG <b>${info.rng}</b></span>` +
            `<span>SPD <b>${info.spd}</b></span>` +
            (info.special ? `<span>FX <b>${info.special}</b></span>` : '');
        tip.classList.remove('hidden');
        // Position above the anchor so finger isn't covering the text.
        const r = anchorEl.getBoundingClientRect();
        requestAnimationFrame(() => {
            const tipR = tip.getBoundingClientRect();
            let left = r.left + r.width / 2 - tipR.width / 2;
            let top  = r.top - tipR.height - 10;
            if (left < 4) left = 4;
            if (left + tipR.width > window.innerWidth - 4) left = window.innerWidth - tipR.width - 4;
            if (top < 4) top = r.bottom + 10;
            tip.style.left = left + 'px';
            tip.style.top  = top + 'px';
        });
    }

    function hideLongPressTooltip() {
        const tip = document.getElementById('tower-tooltip');
        if (tip) tip.classList.add('hidden');
    }

    document.querySelectorAll('.tower-option').forEach(el => {
        el.addEventListener('touchstart', (e) => {
            if (!isMobile()) return;
            if (game.state !== 'playing' && game.state !== 'paused') return;
            const type = getTowerTypeFromEl(el);
            if (!type) return;

            const t = e.touches[0];
            // Clear any previous state cleanly.
            if (touchState) {
                clearTimeout(touchState.longPressTimer);
                if (touchState.el) touchState.el.classList.remove('dragging');
            }
            touchState = {
                type, el,
                startX: t.clientX, startY: t.clientY,
                dragging: false,
                longPressFired: false,
                // Potion is tap-only; towers support drag-to-place.
                canDrag: type !== 'potion',
                longPressTimer: setTimeout(() => {
                    if (!touchState || touchState.dragging) return;
                    touchState.longPressFired = true;
                    showLongPressTooltip(type, el);
                }, LONG_PRESS_MS),
            };
            // Deliberately do not preventDefault — lets the browser handle
            // horizontal scroll of the dock if the user pans sideways.
        }, { passive: true });
    });

    document.addEventListener('touchmove', (e) => {
        if (!touchState) return;
        const t = e.touches[0];
        const dx = t.clientX - touchState.startX;
        const dy = t.clientY - touchState.startY;

        if (!touchState.dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

            // Beyond threshold — a gesture is committing. Kill long-press.
            clearTimeout(touchState.longPressTimer);
            hideLongPressTooltip();

            // Detect scroll intent based on build menu orientation:
            // Portrait: menu scrolls horizontally (bottom bar) - block horizontal drags
            // Landscape: menu scrolls vertically (side bar) - block vertical drags
            const isLandscape = window.innerWidth > window.innerHeight;
            let isScrollIntent = false;
            
            if (isLandscape) {
                // In landscape, only block if moving vertically along the side menu
                // Allow horizontal and diagonal movements for tower placement
                isScrollIntent = Math.abs(dy) > Math.abs(dx) * 1.5;
            } else {
                // In portrait, only block if moving horizontally along the bottom menu
                // Allow vertical and diagonal movements for tower placement
                isScrollIntent = Math.abs(dx) > Math.abs(dy) * 1.5;
            }
            
            if (isScrollIntent || !touchState.canDrag) {
                touchState = null;
                return;
            }

            // Can't afford? Abort drag; let the user notice via disabled state.
            if (!game.canAfford(touchState.type)) {
                touchState = null;
                return;
            }

            touchState.dragging = true;
            touchState.el.classList.add('dragging');
            selectedTowerType = touchState.type;
        }

        // Actively dragging — suppress scroll and update canvas preview.
        // Offset the ghost UP so the finger doesn't obscure it.
        // Use a thumb-sized offset (~80-100px) that adapts to orientation.
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        // The field is drawn centred inside the full-container canvas (offset
        // FIELD_OFF*_CSS, size FIELD_CSS_*) — map into FIELD space like getCanvasPos.
        const fieldW = window.FIELD_CSS_W || rect.width;
        const fieldH = window.FIELD_CSS_H || rect.height;
        const offX = window.FIELD_OFFX_CSS || 0;
        const offY = window.FIELD_OFFY_CSS || 0;
        const scaleX = (window.COLS * window.TILE_SIZE) / fieldW;
        const scaleY = (window.ROWS * window.TILE_SIZE) / fieldH;

        // Thumb offset: larger in portrait (more vertical space), smaller in landscape
        const isLandscape = window.innerWidth > window.innerHeight;
        const GHOST_OFFSET_PX = isLandscape ? 70 : 100;

        // Apply offset in screen space, undo the field offset + pinch-zoom view
        // transform (it lives in the render transform now, not on the
        // element), then scale to logical coordinates.
        const Zg = window.__neonZoom || { scale: 1, tx: 0, ty: 0 };
        mousePos.x = ((t.clientX - rect.left - offX - Zg.tx) / Zg.scale) * scaleX;
        mousePos.y = (((t.clientY - GHOST_OFFSET_PX) - rect.top - offY - Zg.ty) / Zg.scale) * scaleY;
    }, { passive: false });

    // Pending placement state: set when finger lifts over canvas, cleared on confirm/cancel.
    let pendingPlacement = null; // { col, row, type, screenX, screenY }

    function showPlaceConfirm(col, row, type, screenX, screenY) {
        pendingPlacement = { col, row, type };
        const el = document.getElementById('place-confirm');
        el.classList.remove('hidden');
        // Position the buttons at the ghost tile centre on screen
        el.style.left = screenX + 'px';
        el.style.top  = screenY + 'px';
    }

    function hidePlaceConfirm() {
        pendingPlacement = null;
        document.getElementById('place-confirm').classList.add('hidden');
        selectedTowerType = null;
        document.querySelectorAll('.tower-option').forEach(el => el.classList.remove('selected', 'dragging'));
    }

    document.getElementById('place-confirm-yes').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!pendingPlacement) return;
        const built = game.buildTower(pendingPlacement.col, pendingPlacement.row, pendingPlacement.type);
        if (built && window.__neonMPBroadcast) {
            window.__neonMPBroadcast.build(pendingPlacement.col, pendingPlacement.row, pendingPlacement.type);
        }
        hidePlaceConfirm();
    });

    document.getElementById('place-confirm-no').addEventListener('click', (e) => {
        e.stopPropagation();
        hidePlaceConfirm();
    });

    document.addEventListener('touchend', (e) => {
        if (!touchState) return;
        const state = touchState;
        touchState = null;
        clearTimeout(state.longPressTimer);

        if (state.longPressFired) {
            setTimeout(hideLongPressTooltip, 1200);
            e.preventDefault();
            state.el.classList.remove('dragging');
            return;
        }

        if (state.dragging) {
            state.el.classList.remove('dragging');
            const t = e.changedTouches[0];
            const rect = canvas.getBoundingClientRect();

            const fieldW = window.FIELD_CSS_W || rect.width;
            const fieldH = window.FIELD_CSS_H || rect.height;
            const offX = window.FIELD_OFFX_CSS || 0;
            const offY = window.FIELD_OFFY_CSS || 0;
            const scaleX = (window.COLS * window.TILE_SIZE) / fieldW;
            const scaleY = (window.ROWS * window.TILE_SIZE) / fieldH;

            // Same thumb offset as touchmove so the ghost the user sees is
            // also the position we test for placement on release.
            const isLandscape = window.innerWidth > window.innerHeight;
            const GHOST_OFFSET_PX = isLandscape ? 70 : 100;

            // Same field-offset + zoom-inverse as the touchmove ghost above.
            const Zd = window.__neonZoom || { scale: 1, tx: 0, ty: 0 };
            const lx = ((t.clientX - rect.left - offX - Zd.tx) / Zd.scale) * scaleX;
            const ly = (((t.clientY - GHOST_OFFSET_PX) - rect.top - offY - Zd.ty) / Zd.scale) * scaleY;
            const col = Math.floor(lx / window.TILE_SIZE);
            const row = Math.floor(ly / window.TILE_SIZE);

            // Bounds check on the GHOST tile (col/row), not the finger position.
            // The finger sits ~100px below the ghost, so for a placement near the
            // bottom of the canvas the finger lands in the build dock — the old
            // raw-finger bounds check failed there even though the ghost was on
            // a valid tile (e.g. a U-bend in the path).
            const ghostOnMap = (col >= 0 && col < window.COLS && row >= 0 && row < window.ROWS);

            if (ghostOnMap && game.map.isBuildable(col, row) && game.canAfford(state.type)) {
                // Convert ghost tile centre back to screen coords for
                // button positioning (forward zoom view transform).
                const tileCentreLogX = col * window.TILE_SIZE + window.TILE_SIZE / 2;
                const tileCentreLogY = row * window.TILE_SIZE + window.TILE_SIZE / 2;
                const sx = rect.left + offX + Zd.tx + (tileCentreLogX / scaleX) * Zd.scale;
                const sy = rect.top  + offY + Zd.ty + (tileCentreLogY / scaleY) * Zd.scale;
                showPlaceConfirm(col, row, state.type, sx, sy);
            } else {
                // Not buildable, off the map, or can't afford — cancel silently.
                hidePlaceConfirm();
            }
            e.preventDefault();
            return;
        }

        // Pure tap — fall through to synthetic click.
    }, { passive: false });

    document.addEventListener('touchcancel', () => {
        if (!touchState) return;
        clearTimeout(touchState.longPressTimer);
        hideLongPressTooltip();
        if (touchState.el) touchState.el.classList.remove('dragging');
        touchState = null;
        hidePlaceConfirm();
    });
    // --- End mobile touch handling ---

    let lastClickTime = 0;
    let lastClickedType = null;
    let lastClickedC = -1;
    let lastClickedR = -1;

    canvas.addEventListener('pointerdown', (e) => {
        if (game.state !== 'playing' && game.state !== 'paused') return;
        // Suppress single-tap behaviour while a pinch is happening or
        // immediately after one ends — otherwise the first finger of a
        // pinch can place a tower or close menus before the second
        // finger arrives and the gesture is recognised.
        if (_pinch || (window.__neonPinchCooldownUntil && Date.now() < window.__neonPinchCooldownUntil)) {
            return;
        }

        // Close menus when clicking on canvas
        document.getElementById('upgrade-menu').classList.add('hidden');

        const pos = getCanvasPos(e);
        const c = Math.floor(pos.x / TILE_SIZE);
        const r = Math.floor(pos.y / TILE_SIZE);

        // M2: Airstrike targeting mode — canvas click triggers the strike.
        if (game.abilityTargetMode && game.ability && game.ability.isUsable()) {
            if (game.ability.tryUse()) {
                game.airstrike(pos.x, pos.y);
                game.abilityTargetMode = false;
                refreshAbilityUI();
            }
            return;
        }

        if (selectedTowerType) {
            if (game.buildTower(c, r, selectedTowerType)) {
                if (window.__neonMPBroadcast) window.__neonMPBroadcast.build(c, r, selectedTowerType);
                // Hold Shift to keep the same tower selected for chain
                // placement; otherwise deselect after a single placement.
                if (!e.shiftKey) selectTower(selectedTowerType);
            }
        } else {
            // Select placed tower
            let clicked = game.towers.find(t => t.c === c && t.r === r);
            let now = Date.now();
            let isDouble = (now - lastClickTime < 300 && clicked && lastClickedType === clicked.type && lastClickedC === c && lastClickedR === r);
            
            lastClickTime = now;
            
            if (clicked) {
                lastClickedType = clicked.type;
                lastClickedC = c;
                lastClickedR = r;
                
                if (isDouble) {
                    game.selectAllTowersOfType(clicked.type);
                } else {
                    game.selectPlacedTower(clicked);
                }
            } else {
                game.selectPlacedTower(null);
                lastClickedType = null;
            }
        }
    });

    let lastTime = 0;
    function loop(time) {
        requestAnimationFrame(loop);

        if (time - lastTime < 16) return;
        lastTime = time;

        for (let i = 0; i < gameSpeed; i++) {
            game.update();
        }
        // Sample the wall clock ONCE per rendered frame for time-based
        // animation (the path-outline pulse). Reading it inside draw() would
        // make two draws of the same frame differ (shimmer); sampling here
        // keeps draw() deterministic and the pulse speed independent of
        // gameSpeed.
        game._animClock = time;
        game.draw();

        // Roguelike boon pick — frequency now once per ascension tier.
        if (game.pendingBoon && window.NeonBoons && !window.NeonBoons.isActive()) {
            game.pendingBoon = false;
            window.NeonBoons.open();   // auto-resolves silently under autopilot
        }

        // M2: Airstrike targeting crosshair.
        if ((game.state === 'playing' || game.state === 'paused') && game.abilityTargetMode && game.ability && game.ability.isUsable()) {
            const ctx = game.ctx;
            ctx.save();
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(mousePos.x, mousePos.y, 80, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
            ctx.beginPath();
            ctx.arc(mousePos.x, mousePos.y, 80 * 1.3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if ((game.state === 'playing' || game.state === 'paused') && selectedTowerType) {
            // During pending confirmation, lock ghost to the confirmed tile
            const ghostX = (pendingPlacement && pendingPlacement.type === selectedTowerType)
                ? pendingPlacement.col * window.TILE_SIZE + window.TILE_SIZE / 2
                : mousePos.x;
            const ghostY = (pendingPlacement && pendingPlacement.type === selectedTowerType)
                ? pendingPlacement.row * window.TILE_SIZE + window.TILE_SIZE / 2
                : mousePos.y;

            const c = Math.floor(ghostX / TILE_SIZE);
            const r = Math.floor(ghostY / TILE_SIZE);
            
            const ctx = game.ctx;
            const px = c * TILE_SIZE;
            const py = r * TILE_SIZE;

            if (game.map.isBuildable(c, r)) {
                const ranges = { basic: 100, sniper: 250, rapid: 80, laser: 150, rocket: 200, flak: 250, electric: 120, silo: 100, income: 0 };
                ctx.beginPath();
                ctx.arc(px + TILE_SIZE/2, py + TILE_SIZE/2, ranges[selectedTowerType], 0, Math.PI*2);
                ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.globalAlpha = 0.5;
                drawTower(ctx, px, py, selectedTowerType, TILE_SIZE, 0, 1);
                ctx.globalAlpha = 1.0;
            } else {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    requestAnimationFrame(loop);

    // Per-base flavour text + special-line. dmg/rng/spd are read from TOWERS
    // at lookup time so the tooltip always matches the active variant.
    const TOWER_INFO = {
        basic:   { desc: 'Reliable all-rounder. Good DPS at medium range.',                     special: null },
        sniper:  { desc: 'Extreme range, high single-target damage. Slow fire rate.',           special: 'Piercing' },
        rapid:   { desc: 'Fires a spread of piercing pellets. Great vs groups.',                special: 'Pierce ×2' },
        laser:   { desc: 'Continuous beam that slows enemies. Weak vs air.',                    special: 'Slows 20%' },
        rocket:  { desc: 'Homing splash damage. Less effective vs air.',                        special: 'Splash 70' },
        flak:    { desc: 'Anti-air specialist. 4× damage vs air, air-only targeting.',          special: 'Air only' },
        electric:{ desc: 'Chains lightning between nearby enemies.',                            special: 'Chains ×3' },
        silo:    { desc: 'Builds hovering rockets that auto-launch at enemies.',                special: 'Splash 40' },
        income:  { desc: 'Generates ¢ at the end of every wave. Passive.',                      special: '+20¢/wave' },
        potion:  { name: 'Repair', desc: 'Restores 5 HP instantly. Cost increases each use.',
                   dmg: '—', rng: '—', spd: '—', special: '+5 HP' },
    };

    // Per-variant overrides (desc + special). dmg/rng/spd still come from TOWERS.
    const VARIANT_INFO = {
        basic_cryo:      { desc: 'Slows enemies on hit. Lower damage but cryo stacks pressure.',         special: 'Slow + Cryo DoT' },
        sniper_scatter:  { desc: 'Fires multiple shots per cycle, mid range, still pierces.',            special: 'Multi-shot ×2' },
        rapid_flame:     { desc: 'Cone-of-fire flamethrower with burn DoT — chews up groups.',           special: 'Cone + Burn DoT' },
        laser_pulse:     { desc: 'Discrete high-damage plasma bolts instead of a continuous beam.',      special: 'Burst projectiles' },
        rocket_cluster:  { desc: 'Main rocket splits into sub-rockets on impact for layered splash.',    special: 'Cluster ×4' },
        flak_emp:        { desc: 'EMP rounds stun air units on hit, lower raw damage but strong CC.',    special: 'Air stun 1s' },
        electric_plasma: { desc: 'Chain lightning that ignites enemies — direct hit + burn DoT.',        special: 'Chain + Burn DoT' },
        silo_orbital:    { desc: 'One huge orbital strike. Slow orbit, wide splash, long cooldown.',     special: 'Orbital splash 90' },
        income_research: { desc: 'No income — boosts damage of nearby towers (+2% per stack).',          special: 'Aura +2% DMG' },
    };

    function getTooltipInfo(baseOrPotion) {
        if (baseOrPotion === 'potion') return TOWER_INFO.potion;
        const effective = (game && game.getEffectiveTowerType)
            ? game.getEffectiveTowerType(baseOrPotion) : baseOrPotion;
        const cfg = TOWERS[effective] || TOWERS[baseOrPotion];
        if (!cfg) return null;
        const baseInfo    = TOWER_INFO[baseOrPotion] || {};
        const variantInfo = (effective !== baseOrPotion) ? (VARIANT_INFO[effective] || {}) : {};
        const isIncome = baseOrPotion === 'income';
        return {
            name:    cfg.displayName,
            desc:    variantInfo.desc    || baseInfo.desc    || '',
            dmg:     isIncome ? '—' : cfg.damage,
            rng:     isIncome ? '—' : cfg.range,
            spd:     isIncome ? '—' : (cfg.fireRate || '—'),
            special: variantInfo.special || baseInfo.special || null,
        };
    }
    // Expose so the touch long-press path uses the same resolver.
    window.getTooltipInfo = getTooltipInfo;

    const tooltip = document.getElementById('tower-tooltip');
    document.querySelectorAll('.tower-option').forEach(el => {
        const type = el.dataset.type || (el.id === 'potion-btn' ? 'potion' : null);
        if (!type) return;
        el.addEventListener('mouseenter', (e) => {
            const info = getTooltipInfo(type);
            if (!info) return;
            document.getElementById('tt-name').textContent = info.name;
            document.getElementById('tt-desc').textContent = info.desc;
            document.getElementById('tt-stats').innerHTML =
                `<span>DMG <b>${info.dmg}</b></span>` +
                `<span>RNG <b>${info.rng}</b></span>` +
                `<span>SPD <b>${info.spd}</b></span>` +
                (info.special ? `<span>FX <b>${info.special}</b></span>` : '');
            tooltip.classList.remove('hidden');
            positionTooltip(e);
        });
        el.addEventListener('mousemove', positionTooltip);
        el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
    });

    function positionTooltip(e) {
        const pad = 12;
        let x = e.clientX - tooltip.offsetWidth - pad;
        let y = e.clientY + pad;
        if (x < 4) x = e.clientX + pad;
        if (y + tooltip.offsetHeight > window.innerHeight - 4) y = e.clientY - tooltip.offsetHeight - pad;
        tooltip.style.left = x + 'px';
        tooltip.style.top  = y + 'px';
    }

    // After init() finishes wiring the menu + lobby, check whether the
    // page was reloaded via the multiplayer pre-boot hook (coop/versus).
    // If so, auto-resume the JOIN with the persisted nick/code/mode.
    setTimeout(resumeMultiplayerIfPending, 50);

    // ── Multiplayer lobby wiring ────────────────────────────────────────
    // Lazy: nothing here touches the network until JOIN is clicked. Once
    // a room is live, the race controller polls window.game once per
    // second and broadcasts a small heartbeat; other peers' heartbeats
    // populate the leaderboard overlay. The race overlay is display-
    // only — Aegis is naive (see multiplayer/anti-cheat.md).
    let _activeRace = null;     // race controller instance
    let _activeRoom = null;     // transport peer
    let _raceUnsub  = null;     // unsubscribe from onUpdate
    let _activeRoomCode = null;
    let _activeCoop = null;     // co-op controller (build/upgrade/sell sync)
    let _activeMode = null;     // 'race' | 'coop'
    // Host election state. The peer in the room with the EARLIEST
    // wr-announce timestamp is the host; their ascension tier wins
    // for everyone in the room. Updated as wr packets arrive.
    let _mpHostNick = null;
    let _mpHostTier = null;     // host's selectedTier; null = use local
    let _mpHostSpeed = null;    // host's startSpeed; null = use local
    // Computed ONCE when the waitroom resolves, from the same
    // sanitised nick the election ran on. Never compare
    // getPlayerName() against _mpHostNick at runtime — the saved
    // player name is unsanitised and that comparison silently fails
    // (it's the bug that used to keep pause from propagating).
    let _mpIsHost = false;

    function setStatus(el, text, color) {
        el.textContent = text;
        el.style.color = color || 'var(--text-muted)';
    }

    // Populate the multiplayer lobby's build/version line. Both peers should
    // be on the same build for co-op to stay in sync, so we surface it where
    // people are about to connect. Prefers ./version.json (bundled in the
    // APK, deployed on web); falls back to the ?v= cache-bust token that's
    // always present on the script tags so it shows *something* offline.
    let _mpVersionCache = null;
    async function renderMpVersion() {
        const el = document.getElementById('mp-version');
        if (!el) return;
        // Cache-token fallback, derived from this very script's URL.
        const fromCacheToken = () => {
            const s = document.querySelector('script[src*="engine/main.js"]');
            const m = s && s.src.match(/[?&]v=([0-9A-Za-z]{6,})/);
            return m ? m[1] : null;
        };
        const paint = (version, build) => {
            const v = version ? 'v' + version : '';
            const b = build ? 'build ' + build : '';
            el.textContent = ['NEON DEFENSE', v, b].filter(Boolean).join(' · ');
        };
        if (_mpVersionCache) { paint(_mpVersionCache.version, _mpVersionCache.build); return; }
        // Show the fallback immediately so there's no blank flash, then
        // upgrade to the full manifest if the fetch succeeds.
        paint(null, fromCacheToken());
        try {
            const res = await fetch('./version.json', { cache: 'no-store' });
            if (res && res.ok) {
                const data = await res.json();
                _mpVersionCache = { version: data && data.version, build: data && data.build };
                paint(_mpVersionCache.version, _mpVersionCache.build);
            }
        } catch (_) { /* offline / blocked — keep the cache-token fallback */ }
    }

    function setupMultiplayerLobby() {
        if (typeof NeonMP === 'undefined' || !NeonMP.lobby || !NeonMP.race) {
            // Scripts didn't load (e.g. broken cache); hide the button so
            // the menu doesn't dangle a non-functional entry point.
            const btn = document.getElementById('menu-multiplayer-btn');
            if (btn) btn.classList.add('hidden');
            return;
        }
        const lobby = NeonMP.lobby;
        const race  = NeonMP.race;

        const openBtn  = document.getElementById('menu-multiplayer-btn');
        const backBtn  = document.getElementById('mp-back-btn');
        const joinBtn  = document.getElementById('mp-join-btn');
        const newBtn   = document.getElementById('mp-room-new-btn');
        const nickIn   = document.getElementById('mp-nick-input');
        const roomIn   = document.getElementById('mp-room-input');
        const modeSel  = document.getElementById('mp-mode-select');
        const status   = document.getElementById('mp-status');

        // Restore persisted nick + last room so a quick re-join is one click.
        nickIn.value = lobby.loadNick();
        const lastRoom = lobby.loadLastRoom();
        if (lastRoom) roomIn.value = lastRoom;

        openBtn.addEventListener('click', () => {
            _enterSubScreen();
            hideScreen('main-menu');
            showScreen('mp-lobby');
            setStatus(status, 'Pick a mode and room code, then JOIN.', 'var(--text-muted)');
            renderMpVersion();
        });
        backBtn.addEventListener('click', uiGoBack);

        // NEW CODE generates a fresh 6-char code into the input.
        newBtn.addEventListener('click', () => {
            roomIn.value = lobby.generateRoomCode();
        });

        // TEST CONNECTION — runs the connectivity probe and shows a
        // human-readable summary in the diagnostics panel. Doesn't
        // actually try to join a room; safe to click repeatedly.
        const testBtn = document.getElementById('mp-test-btn');
        const diagEl  = document.getElementById('mp-diagnostics');
        function showDiagnostics(text, severity) {
            if (!diagEl) return;
            diagEl.classList.remove('hidden', 'is-ok', 'is-bad');
            if (severity === 'ok')  diagEl.classList.add('is-ok');
            if (severity === 'bad') diagEl.classList.add('is-bad');
            diagEl.textContent = text;
        }
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                if (!NeonMP || !NeonMP.connectivity) {
                    showDiagnostics('Connectivity module not loaded — refresh the page.', 'bad');
                    return;
                }
                testBtn.disabled = true;
                showDiagnostics('Probing CDN / trackers / WebRTC…', null);
                try {
                    const report = await NeonMP.connectivity.probe();
                    showDiagnostics(NeonMP.connectivity.summarise(report),
                                    report.verdict === 'ok' ? 'ok' : 'bad');
                } catch (e) {
                    showDiagnostics('Probe failed: ' + (e && e.message || e), 'bad');
                } finally {
                    testBtn.disabled = false;
                }
            });
        }

        // Normalise as the player types so they see the canonical form.
        roomIn.addEventListener('input', () => {
            const raw = roomIn.value;
            roomIn.value = raw.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
        });

        joinBtn.addEventListener('click', async () => {
            // Force coop. Race was removed (2026-05-25). Any stale
            // cached HTML that still shows a 'race' option is coerced
            // here so the user can't accidentally launch a non-coop
            // run that the rest of the code no longer handles.
            const mode = 'coop';
            if (!lobby.isValidMode(mode)) {
                setStatus(status, mode.toUpperCase() + ' is not a known mode.', '#fb7185');
                return;
            }
            const parsed = lobby.parseRoomCode(roomIn.value);
            if (!parsed.ok) {
                setStatus(status, 'Room code must be 6 chars (A–Z, 2–9, no I/O).', '#fb7185');
                return;
            }
            const nick = lobby.sanitiseNick(nickIn.value);
            lobby.saveNick(nick);
            lobby.saveLastRoom(parsed.code);
            nickIn.value = nick;
            roomIn.value = parsed.code;

            // Lobby speed pick. Clamp to the 16× MP cap and to powers of 2
            // (1/2/4/8/16) so a tampered <option> can't smuggle in 256.
            const speedSel = document.getElementById('mp-speed-select');
            const rawSpeed = parseInt(speedSel && speedSel.value, 10);
            const startSpeed = [1, 2, 4, 8, 16].indexOf(rawSpeed) >= 0 ? rawSpeed : 1;

            // Coop is the only mode. Persist intent and reload so the
            // pre-boot inline script can install the seeded RNG BEFORE
            // aegis.js captures the snapshot. main.js re-runs init()
            // on reload and detects window.__neonMPPending to
            // auto-resume the join (see resumeMultiplayerIfPending).
            // The seed stored here is the room-derived seed — same on
            // every peer so both run the identical world.
            const seed = NeonMP.protocol.roomCodeToSeed(parsed.code);
            const cfg = { mode, roomCode: parsed.code, nick, seed, startSpeed, ts: Date.now() };
            try {
                // Write to BOTH stores. Some Capacitor / Cordova WebView
                // builds wipe sessionStorage on location.reload() (they
                // treat reload as a fresh "session"), which dropped the
                // JOIN intent and bounced the player back to the main
                // menu. localStorage is reload-safe. The reload-side
                // hook tries sessionStorage first and falls back to
                // localStorage with a 30-s freshness gate so we don't
                // re-trigger an old JOIN on the next cold launch.
                sessionStorage.setItem('neonMP', JSON.stringify(cfg));
                try { localStorage.setItem('neonMP', JSON.stringify(cfg)); } catch (_) {}
                setStatus(status, 'Re-launching with deterministic RNG…', 'var(--accent)');
                joinBtn.disabled = true;
                // Reload triggers neonMPBoot (in index.html <body>)
                // which sets __neonAegisDev + seeded Math.random before
                // any game scripts run.
                setTimeout(() => location.reload(), 250);
            } catch (e) {
                setStatus(status, 'Could not start: ' + (e && e.message ? e.message : e), '#fb7185');
                joinBtn.disabled = false;
            }
        });

        // Leave button on the race overlay.
        const leaveBtn = document.getElementById('mp-race-leave');
        if (leaveBtn) leaveBtn.addEventListener('click', () => {
            leaveActiveMultiplayer();
            hideScreen('mp-race-overlay');
        });

        // Un-disable co-op and pick it as the default mode now that the
        // controllers exist. Race stays as the safety-net fallback.
        if (NeonMP.coop) {
            const coopOpt = modeSel.querySelector('option[value="coop"]');
            if (coopOpt) {
                coopOpt.removeAttribute('disabled');
                coopOpt.textContent = 'CO-OP — shared map + economy';
                modeSel.value = 'coop';
            }
        }
    }

    // Called once after init() to honour the pre-boot hook. If
    // sessionStorage 'neonMP' was set, the reload landed us here with
    // a seeded Math.random and Aegis dev mode on — finish the JOIN.
    async function resumeMultiplayerIfPending() {
        const cfg = window.__neonMPPending;
        if (!cfg || typeof cfg !== 'object') return;
        // Single-shot: clear BOTH stores (sessionStorage on web,
        // localStorage on Capacitor APK) so a manual reload doesn't
        // keep re-joining.
        try { sessionStorage.removeItem('neonMP'); } catch (_) {}
        try { localStorage.removeItem('neonMP'); } catch (_) {}
        window.__neonMPPending = null;
        if (!NeonMP || !NeonMP.lobby) return;
        const lobby = NeonMP.lobby;
        const nick = lobby.sanitiseNick(cfg.nick);
        const parsed = lobby.parseRoomCode(cfg.roomCode);
        if (!parsed.ok) return;

        // Start the run with the room-derived seed so map.js draws an
        // identical world for every peer in the room.
        try {
            if (cfg.mode === 'coop') {
                await joinCoop(parsed.code, nick);
                // Show the waiting room instead of jumping straight to
                // the run — players coordinate via READY before the
                // map appears. openCoopWaitroom resolves once everyone
                // is ready (or returns null if the player leaves).
                const ready = await openCoopWaitroom(parsed.code, nick, cfg.startSpeed);
                if (!ready) {
                    leaveActiveMultiplayer();
                    showScreen('main-menu');
                    return;
                }
                // Host role settles when the waitroom resolves —
                // compare against the SAME sanitised nick the election
                // ran on (never getPlayerName(), see _mpIsHost decl).
                _mpIsHost = (_mpHostNick != null && _mpHostNick === nick);
                restartGame(cfg.seed);
                // Non-host never self-advances waves; it follows the
                // host's 'wave' broadcasts (game.js holds at
                // waveCooldown 0 while this flag is set).
                if (typeof game !== 'undefined' && game) {
                    game._mpHoldWaves = !_mpIsHost;
                }
                _lastBroadcastWave = 0;
                _mpLastHostMsgAt = Date.now();
                // Host's startSpeed wins for everyone (set in the
                // waitroom via wr broadcasts); falls back to the local
                // pick if we never heard one.
                applyMultiplayerSpeed(
                    (_mpHostSpeed != null) ? _mpHostSpeed : cfg.startSpeed);
                showScreen('mp-race-overlay');
                const roomBadge = document.getElementById('mp-race-room');
                if (roomBadge) roomBadge.textContent = parsed.code + ' (co-op)';
            }
        } catch (err) {
            console.warn('[MP] resume failed:', err);
            leaveActiveMultiplayer();
        }
    }

    async function joinCoop(roomCode, nick) {
        if (!NeonMP || !NeonMP.trystero || !NeonMP.coop) {
            throw new Error('co-op scripts missing');
        }
        leaveActiveMultiplayer();
        // Coop is the only flow that needs reliable P2P (gameplay
        // state has to actually flow between the two devices). Pay
        // for TURN here.
        const room = await NeonMP.trystero.joinRoom(roomCode, nick, { useTurn: true });
        _activeRoom = room;
        _activeRoomCode = roomCode;
        _activeMode = 'coop';

        // Race controller still drives the leaderboard overlay — it's
        // pure display, no game effect, and gives players a quick read
        // of "is my partner alive". Co-op controller carries the inputs.
        _activeRace = NeonMP.race.createRace({
            peer: nick, transport: room,
            getGame: () => (typeof game !== 'undefined' ? game : {}),
            // HUD-only leaderboard inside coop — 2 s refresh is plenty
            // and halves the heartbeat traffic vs the 1 s default.
            heartbeatMs: 2000,
        });
        _raceUnsub = _activeRace.onUpdate(renderRaceOverlay);
        _activeRace.start();

        const secret = NeonMP.guard
            ? NeonMP.guard.deriveSecret(roomCode, 'coop')
            : null;
        const allowBuild = (typeof TOWERS === 'object')
            ? new Set(Object.keys(TOWERS))
            : null;
        _activeCoop = NeonMP.coop.createCoop({
            peer: nick, transport: room,
            getGame: () => (typeof game !== 'undefined' ? game : null),
            allowBuildTypes: allowBuild,
            secret,
            // Mirror remote state into UI: close the boon chooser when
            // the peer picks one, render remote cursors, etc.
            onApply: ({ peer, input }) => {
                if (input.k === 'boon' && window.NeonBoons && window.NeonBoons.isActive()) {
                    // Both peers reached the boon screen; whoever's
                    // input lands first wins. close() drops the local
                    // overlay so the partner's pick takes effect.
                    try { window.NeonBoons.close(); } catch (_) {}
                }
            },
        });
        _activeCoop.start();

        // Cursor overlay: a separate listener on the same transport
        // routes 'cursor' messages to the cursor renderer.
        room.onMessage((msg, fromId) => {
            if (msg && msg.kind === 'cursor' && msg.p && msg.p !== nick) {
                onRemoteCursor(msg);
            }
            // Host-broadcast pause/resume — only the host sends these,
            // every peer mirrors locally.
            if (msg && msg.kind === 'pause' && typeof msg.paused === 'boolean') {
                if (typeof window.__neonMPApplyPause === 'function') {
                    window.__neonMPApplyPause(msg.paused);
                }
            }
            // Host-broadcast wave alignment — receivers snap their
            // game.wave to match so the UI / wave-bonus logic stays
            // consistent across peers even if the local sim drifted a
            // wave behind.
            if (msg && msg.kind === 'wave' && Number.isInteger(msg.w)) {
                _mpLastHostMsgAt = Date.now();   // host-authored — feeds the watchdog
                if (typeof window.__neonMPApplyWave === 'function') {
                    window.__neonMPApplyWave(msg.w, msg.hp);
                }
            }
            // Host's periodic enemy digest — snap monster HP / deaths.
            if (msg && msg.kind === 'es') {
                _mpLastHostMsgAt = Date.now();
                if (typeof window.__neonMPApplyEnemyState === 'function') {
                    window.__neonMPApplyEnemyState(msg);
                }
            }
            // Host's digger committed a dig — carve the same road.
            if (msg && msg.kind === 'dig') {
                _mpLastHostMsgAt = Date.now();
                if (typeof window.__neonMPApplyDig === 'function') {
                    window.__neonMPApplyDig(msg);
                }
            }
            // Periodic state digest from the partner — populate the
            // window.__neonMPLastDrift report for diagnostics.
            if (msg && msg.kind === 'sync') {
                if (typeof window.__neonMPApplySync === 'function') {
                    window.__neonMPApplySync(msg, fromId);
                }
            }
        });

        // Send our own cursor at ~10 Hz from the canvas mousemove.
        attachCursorBroadcast();
    }

    function leaveActiveMultiplayer() {
        if (typeof _raceUnsub === 'function') {
            try { _raceUnsub(); } catch (_) {}
            _raceUnsub = null;
        }
        if (_activeRace) { try { _activeRace.stop(); } catch (_) {} _activeRace = null; }
        if (_activeCoop) { try { _activeCoop.stop(); } catch (_) {} _activeCoop = null; }
        // Force the race-overlay hidden too — _activeRace heartbeats
        // toggle visibility while running but stop() doesn't clear
        // the .hidden class on its own.
        try { hideScreen('mp-race-overlay'); } catch (_) {}
        if (_activeRoom) { try { _activeRoom.leave(); } catch (_) {} _activeRoom = null; }
        _activeRoomCode = null;
        _activeMode = null;
        // Clear the fair-play flag so the next SP run gets its
        // mastery perks + backpack bonuses back.
        try { if (typeof window !== 'undefined') window.__neonMPFairPlay = false; } catch (_) {}
        _mpHostNick = null;
        _mpHostTier = null;
        _mpHostSpeed = null;
        _mpIsHost = false;
        if (typeof game !== 'undefined' && game) game._mpHoldWaves = false;
        // Stale-state guard: hide the race overlay and clear its list so
        // a subsequent single-player run doesn't see a leftover panel.
        hideScreen('mp-race-overlay');
        const list = document.getElementById('mp-race-list');
        if (list) list.innerHTML = '';
        // Drop remote cursors and clear the overlay so it doesn't show
        // stale dots after the room ends.
        _remoteCursors.clear();
        const overlay = document.getElementById('mp-cursor-overlay');
        if (overlay) {
            const ctx = overlay.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
    }

    // joinRace removed (2026-05-25) — race mode no longer exists as a
    // run path. The race controller is still used INSIDE coop as a
    // HUD leaderboard widget; see joinCoop for that wiring.

    // Expose to the top-level navigateToMainMenu helper so leaving
    // back to the main menu always tears down MP state. Without
    // this, an SP run started AFTER an unclosed MP session would
    // see the race overlay drift back in (the race controller's
    // heartbeat keeps painting it as long as _activeMode is set).
    window.__neonLeaveMP = leaveActiveMultiplayer;

    // Force the lobby-selected speed onto the freshly-restarted game.
    // Called once per JOIN, AFTER restartGame() (which always resets
    // gameSpeed to 1). Also forces autopilot off — MP runs are
    // human-only by policy (see autopilot-btn handler).
    function applyMultiplayerSpeed(startSpeed) {
        const allowed = [1, 2, 4, 8, 16];
        const s = allowed.indexOf(startSpeed | 0) >= 0 ? (startSpeed | 0) : 1;
        gameSpeed = s;
        const sd = document.getElementById('speed-display');
        if (sd) sd.textContent = gameSpeed + 'X';
        if (typeof updateSpeedColor === 'function') {
            try { updateSpeedColor(); } catch (_) {}
        }
        // Autopilot off, always, in multiplayer.
        if (typeof game !== 'undefined' && game) game.autopilot = false;
        const ad = document.getElementById('autopilot-display');
        if (ad) { ad.textContent = 'OFF'; ad.classList.remove('on'); }
    }

    // Broadcast helpers — invoked by the input call sites AFTER the
    // local action has been applied to the local game. They're no-ops
    // when no co-op room is active.
    function mpBroadcastBuild(c, r, type) {
        if (!_activeCoop) return;
        const allow = (typeof TOWERS === 'object') ? new Set(Object.keys(TOWERS)) : null;
        const effective = (typeof game !== 'undefined' && typeof game.getEffectiveTowerType === 'function')
            ? game.getEffectiveTowerType(type) : type;
        const t = (allow && allow.has(effective)) ? effective : type;
        _activeCoop.broadcast({ k: 'build', c, r, t });
    }
    function mpBroadcastUpgrade(tower, slot) {
        if (!_activeCoop || !game || !Array.isArray(game.towers)) return;
        const idx = game.towers.indexOf(tower);
        if (idx < 0) return;
        _activeCoop.broadcast({ k: 'upgrade', tower: idx, slot });
    }
    function mpBroadcastSell(tower) {
        if (!_activeCoop || !game || !Array.isArray(game.towers)) return;
        const idx = game.towers.indexOf(tower);
        if (idx < 0) return;
        _activeCoop.broadcast({ k: 'sell', tower: idx });
    }
    function mpBroadcastPotion() {
        if (!_activeCoop) return;
        _activeCoop.broadcast({ k: 'potion' });
    }
    function mpBroadcastBoon(boonId) {
        if (!_activeCoop) return;
        if (typeof boonId !== 'string' || boonId.length === 0) return;
        _activeCoop.broadcast({ k: 'boon', id: boonId });
    }
    // Throttle cursor frames so we don't flood the data channel. 10 Hz
    // gives smooth motion without saturating the budget; mouse moves
    // come in much faster than that on desktop. Additionally skip
    // sends when the cursor barely moved — an idle or hovering mouse
    // costs ZERO bytes instead of a steady 10 Hz drip. (Traffic is
    // metered: coop pays for TURN relay when P2P needs it.)
    let _mpLastCursorSentAt = 0;
    let _mpLastCursorX = -1, _mpLastCursorY = -1;
    function mpBroadcastCursor(x, y) {
        if (!_activeCoop || !_activeRoom) return;
        const now = Date.now();
        if (now - _mpLastCursorSentAt < 100) return;
        const qx = Math.round(x), qy = Math.round(y);
        if (Math.abs(qx - _mpLastCursorX) < 3 && Math.abs(qy - _mpLastCursorY) < 3) return;
        _mpLastCursorSentAt = now;
        _mpLastCursorX = qx; _mpLastCursorY = qy;
        try {
            // No timestamp on the wire — the receiver stamps arrival
            // time (row.lastSeen) itself.
            _activeRoom.send({ kind: 'cursor', p: _activeCoop.me, x: qx, y: qy });
        } catch (_) { /* swallow */ }
    }
    // Expose globally so the input handlers scattered through init()
    // can call them without piping the reference through every closure.
    window.__neonMPBroadcast = {
        build: mpBroadcastBuild,
        upgrade: mpBroadcastUpgrade,
        sell: mpBroadcastSell,
        potion: mpBroadcastPotion,
        boon: mpBroadcastBoon,
        cursor: mpBroadcastCursor,
    };

    // Remote-cursor state. Each row: { peer, x, y, lastSeen }. We
    // render via a transparent <canvas> overlay sized to the game
    // canvas so the cursors visually live above towers / enemies.
    const _remoteCursors = new Map(); // peer -> { x, y, lastSeen, color }
    const REMOTE_CURSOR_TTL_MS = 2000;
    const REMOTE_CURSOR_PALETTE = ['#22d3ee', '#fbbf24', '#a78bfa', '#fb7185', '#4ade80', '#f97316'];

    function pickCursorColor(peer) {
        // Stable hash → palette index so the same peer keeps the same
        // colour across reconnects.
        let h = 0;
        for (let i = 0; i < peer.length; i++) h = (h * 31 + peer.charCodeAt(i)) | 0;
        return REMOTE_CURSOR_PALETTE[Math.abs(h) % REMOTE_CURSOR_PALETTE.length];
    }

    function onRemoteCursor(msg) {
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
        const peer = String(msg.p).slice(0, 32);
        let row = _remoteCursors.get(peer);
        if (!row) {
            row = { x: 0, y: 0, lastSeen: 0, color: pickCursorColor(peer) };
            _remoteCursors.set(peer, row);
        }
        row.x = msg.x;
        row.y = msg.y;
        row.lastSeen = Date.now();
        scheduleCursorRender();
    }

    let _cursorOverlay = null;
    let _cursorRenderQueued = false;
    function scheduleCursorRender() {
        if (_cursorRenderQueued) return;
        _cursorRenderQueued = true;
        requestAnimationFrame(() => {
            _cursorRenderQueued = false;
            renderRemoteCursors();
        });
    }
    function ensureCursorOverlay() {
        if (_cursorOverlay) return _cursorOverlay;
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return null;
        const overlay = document.createElement('canvas');
        overlay.id = 'mp-cursor-overlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '5';
        canvas.parentElement.appendChild(overlay);
        _cursorOverlay = overlay;
        return overlay;
    }
    function renderRemoteCursors() {
        const overlay = ensureCursorOverlay();
        if (!overlay) return;
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return;
        // Match the canvas pixel rect.
        const rect = canvas.getBoundingClientRect();
        if (overlay.width !== rect.width || overlay.height !== rect.height) {
            overlay.width = rect.width;
            overlay.height = rect.height;
            overlay.style.width = rect.width + 'px';
            overlay.style.height = rect.height + 'px';
        }
        const ctx = overlay.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        // Track the game canvas's pinch-zoom view so remote cursors
        // stay glued to the tile they point at while zoomed/panned.
        // Identity at base zoom.
        const Z = window.__neonZoom || { scale: 1, tx: 0, ty: 0 };
        ctx.setTransform(Z.scale, 0, 0, Z.scale, Z.tx, Z.ty);
        const now = Date.now();
        let alive = false;
        for (const [peer, row] of _remoteCursors) {
            if (now - row.lastSeen > REMOTE_CURSOR_TTL_MS) {
                _remoteCursors.delete(peer);
                continue;
            }
            alive = true;
            const age = (now - row.lastSeen) / REMOTE_CURSOR_TTL_MS;
            const alpha = Math.max(0.25, 1 - age);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = row.color;
            ctx.shadowColor = row.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(row.x, row.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.font = 'bold 10px monospace';
            const label = peer;
            const w = ctx.measureText(label).width;
            ctx.fillRect(row.x + 10, row.y - 8, w + 6, 14);
            ctx.fillStyle = row.color;
            ctx.fillText(label, row.x + 13, row.y + 2);
            ctx.restore();
        }
        // Keep the loop alive while any cursor is still in TTL window.
        if (alive) scheduleCursorRender();
    }

    // Open the co-op waiting room. Peers exchange {kind:'wr', nick,
    // ready} heartbeats so each side renders a live roster. The
    // returned promise resolves true once every known peer (including
    // us) is ready, or false if the player hit LEAVE.
    function openCoopWaitroom(roomCode, nick, myStartSpeed) {
        const overlay = document.getElementById('mp-waitroom');
        const peersEl = document.getElementById('mp-waitroom-peers');
        const codeEl  = document.getElementById('mp-waitroom-code');
        const statusEl = document.getElementById('mp-waitroom-status');
        const readyBtn = document.getElementById('mp-waitroom-ready');
        const leaveBtn = document.getElementById('mp-waitroom-leave');
        const copyBtn  = document.getElementById('mp-waitroom-copy');
        if (!overlay || !_activeRoom) return Promise.resolve(false);

        codeEl.textContent = roomCode;
        statusEl.textContent = 'Share the room code with a friend, then both click READY.';
        showScreen('mp-waitroom');

        // Peer table: nick → ready. Includes us.
        const peers = new Map();
        peers.set(nick, false);
        let meReady = false;

        function render() {
            peersEl.innerHTML = '';
            const sorted = Array.from(peers.entries()).sort();
            for (const [peer, ready] of sorted) {
                const row = document.createElement('div');
                const isHost = (peer === _mpHostNick);
                row.className = 'mp-waitroom-peer' +
                    (peer === nick ? ' is-me' : '') +
                    (ready ? ' is-ready' : '') +
                    (isHost ? ' is-host' : '');
                const safe = String(peer || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
                const hostTag = isHost ? '<span class="mp-waitroom-peer-host">★ HOST</span>' : '';
                row.innerHTML =
                    `<span class="mp-waitroom-peer-name">${safe}</span>` +
                    hostTag +
                    `<span class="mp-waitroom-peer-status">${ready ? 'READY' : 'waiting…'}</span>`;
                peersEl.appendChild(row);
            }
            const allReady = sorted.length >= 2 && sorted.every(([, r]) => r);
            const hostLine = _mpHostNick
                ? ` · Host: ${_mpHostNick} (A${_mpHostTier ?? 0})`
                : '';
            statusEl.textContent = (sorted.length < 2
                ? 'Waiting for another player to join…'
                : allReady
                    ? 'All ready — starting…'
                    : 'Click READY when you\'re set.') + hostLine;
        }

        // Monotonic seq on every wr broadcast — important because the
        // multi-strategy adapter dedupes incoming messages by
        // (peer + JSON.stringify(msg)) within a short window. Without
        // a unique seq, the 2 s re-announce loop emits IDENTICAL
        // content every time and the dedupe silently swallows it,
        // which is exactly how the waitroom got stuck with one peer
        // ready and the other never learning about it.
        // Each peer broadcasts their FIRST-JOIN timestamp (joinedAt)
        // every wr. The peer with the smallest joinedAt is the room
        // HOST. Their selectedTier propagates to clients; clients'
        // local selectedTier is overridden when the run starts. If
        // joinedAt ties (clock skew), the lexicographically smallest
        // nick wins — same comparator on every client → no split.
        const joinedAt = Date.now();
        const myStartSpeedInt = Number.isFinite(myStartSpeed) ? (myStartSpeed | 0) : null;
        const peerInfo = new Map(); // peer → { ready, joinedAt, tier, speed }
        peerInfo.set(nick, { ready: false, joinedAt, tier: selectedTier, speed: myStartSpeedInt });

        let wrSeq = 0;
        function announce() {
            wrSeq += 1;
            try {
                _activeRoom.send({
                    kind: 'wr', p: nick, ready: meReady,
                    seq: wrSeq, t: Date.now(),
                    joinedAt, tier: selectedTier,
                    speed: myStartSpeedInt,
                });
            } catch (_) {}
        }
        // Forward-declared handles the message listener uses to fire
        // start/finish without having to live inside the Promise
        // closure scope where finish/tryStart are actually declared.
        // The Promise body assigns these as its first action.
        let _finish    = () => {};
        let _tryStart  = () => {};

        function electHost() {
            // Lowest joinedAt wins; nick lex order breaks ties.
            const sorted = Array.from(peerInfo.entries())
                .sort((a, b) =>
                    (a[1].joinedAt - b[1].joinedAt) ||
                    (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
            const hostNick = sorted[0] && sorted[0][0];
            const hostInfo = sorted[0] && sorted[0][1];
            _mpHostNick  = hostNick;
            _mpHostTier  = (hostInfo && hostInfo.tier != null) ? (hostInfo.tier | 0) : null;
            _mpHostSpeed = (hostInfo && hostInfo.speed != null) ? (hostInfo.speed | 0) : null;
        }

        const offMsg = _activeRoom.onMessage((msg) => {
            if (!msg) return;
            // Explicit "start" gate from the other peer. If we missed
            // their final READY announce but they think we're both
            // ready and have already moved to the run, this snap is
            // what gets us out of the waitroom. See tryStart() for
            // the sender side.
            if (msg.kind === 'go') {
                // Mark all known peers as ready for the local-view
                // tryStart that follows — defensive in case our
                // peers map is missing the partner's ready bit.
                for (const k of peers.keys()) peers.set(k, true);
                _finish(true);
                return;
            }
            if (msg.kind !== 'wr') return;
            if (typeof msg.p !== 'string' || msg.p === nick) return;
            const peer = msg.p.slice(0, 32);
            peers.set(peer, !!msg.ready);
            const info = peerInfo.get(peer) || {};
            info.ready = !!msg.ready;
            if (typeof msg.joinedAt === 'number') info.joinedAt = msg.joinedAt;
            if (Number.isInteger(msg.tier)) info.tier = msg.tier;
            if (Number.isInteger(msg.speed)) info.speed = msg.speed;
            peerInfo.set(peer, info);
            electHost();
            announce();
            render();
            _tryStart();
        });

        // Local-only host election on entry (in case we're the
        // first/only peer).
        electHost();

        // Re-announce on every new Trystero peer connection — and again
        // a few times right after, because the data channel can take
        // 100-500 ms to actually carry the first message reliably on
        // some networks. We send three spaced bursts on each peer-join.
        try {
            _activeRoom.onPeerJoin && _activeRoom.onPeerJoin(() => {
                announce();
                setTimeout(announce, 200);
                setTimeout(announce, 600);
                setTimeout(announce, 1500);
            });
        } catch (_) {}

        // Steady heartbeat. With Trystero pairing now reliable (peers
        // get unique IDs — see transport-trystero.js), 1 Hz is plenty.
        // Higher cadence saturates the event loop during the burst
        // window without adding pairing speed.
        const heartbeatTimer = setInterval(announce, 1000);

        // Light RAF loop keeps the tab marked active so the 1 Hz
        // heartbeat doesn't get throttled to a stop on a parked page.
        let rafAlive = true;
        function rafTick() {
            if (!rafAlive) return;
            try { requestAnimationFrame(rafTick); } catch (_) {}
        }
        rafTick();

        // Any user gesture or visibility change → flush state. This is
        // the "clicking around helps it pair" behaviour, made
        // deterministic. Pointer / keydown / focus / visibilitychange
        // all kick an announce so resumed-from-throttled tabs catch
        // up immediately.
        const wakeAnnounce = () => announce();
        const visChange = () => {
            if (document.visibilityState === 'visible') announce();
        };
        document.addEventListener('pointerdown',   wakeAnnounce, { passive: true });
        document.addEventListener('keydown',       wakeAnnounce, true);
        document.addEventListener('visibilitychange', visChange);
        window.addEventListener('focus',           wakeAnnounce);

        // Initial announce — first to flush, plus a 50 ms follow-up so
        // anyone whose onPeerJoin already fired on the other side
        // before we hooked our listener still hears from us.
        announce();
        setTimeout(announce, 50);
        setTimeout(announce, 400);
        render();

        return new Promise(resolve => {
            let done = false;
            // Bind the forward-declared handles so the onMessage
            // listener (defined above this Promise) can drive
            // tryStart / finish without scope tricks.
            _tryStart = () => tryStart();
            _finish   = (r) => finish(r);

            function finish(result) {
                if (done) return;
                done = true;
                clearInterval(heartbeatTimer);
                rafAlive = false;
                document.removeEventListener('pointerdown', wakeAnnounce);
                document.removeEventListener('keydown',     wakeAnnounce, true);
                document.removeEventListener('visibilitychange', visChange);
                window.removeEventListener('focus',         wakeAnnounce);
                try { offMsg(); } catch (_) {}
                readyBtn.removeEventListener('click', onReady);
                leaveBtn.removeEventListener('click', onLeave);
                copyBtn.removeEventListener('click', onCopy);
                hideScreen('mp-waitroom');
                resolve(result);
            }
            function onReady() {
                meReady = !meReady;
                peers.set(nick, meReady);
                // Burst the READY state several times so the OTHER peer
                // definitely receives it. Without this, if we're the
                // second to ready, tryStart() fires finish() in the same
                // turn and tears down the heartbeat — the partner may
                // miss the single "ready" announce on a flaky channel
                // and get stuck waiting in the room. (Race condition
                // surfaced once Trystero pairing got fast enough.)
                announce();
                setTimeout(announce, 80);
                setTimeout(announce, 220);
                setTimeout(announce, 500);
                readyBtn.textContent = meReady ? 'UN-READY' : 'READY';
                render();
                // Delay tryStart a beat so the partner's tryStart can
                // also fire on the burst above before either of us
                // pulls the plug on the room.
                setTimeout(tryStart, 800);
            }
            function onLeave() { finish(false); }
            function onCopy() {
                try {
                    navigator.clipboard.writeText(roomCode).then(
                        () => { copyBtn.textContent = 'COPIED'; setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500); },
                        () => { /* ignore — clipboard permission denied */ }
                    );
                } catch (_) {}
            }
            function tryStart() {
                const sorted = Array.from(peers.entries());
                if (sorted.length >= 2 && sorted.every(([, r]) => r)) {
                    // Broadcast an explicit "start" gate so the OTHER
                    // peer can't get stuck in the waitroom if their
                    // local "all ready" detection missed our READY
                    // announce (rare on flaky channels). The receiver
                    // path also fires finish(true) the moment it
                    // sees a start packet — see the 'go' handler in
                    // the wr onMessage listener above.
                    try {
                        _activeRoom.send({ kind: 'go', t: Date.now() });
                        // Send 3 redundant copies spaced over ~500ms
                        // so packet loss can't strand the partner.
                        setTimeout(() => { try { _activeRoom.send({ kind: 'go', t: Date.now() }); } catch (_) {} }, 120);
                        setTimeout(() => { try { _activeRoom.send({ kind: 'go', t: Date.now() }); } catch (_) {} }, 350);
                    } catch (_) {}
                    finish(true);
                }
            }
            readyBtn.addEventListener('click', onReady);
            leaveBtn.addEventListener('click', onLeave);
            copyBtn.addEventListener('click', onCopy);
        });
    }

    // Attach a mousemove listener on the canvas that throttles cursor
    // broadcasts to ~10 Hz. Bound once per coop join; the handler is
    // a no-op when the broadcast helper is missing (i.e. left coop).
    let _cursorMoveAttached = false;
    function attachCursorBroadcast() {
        if (_cursorMoveAttached) return;
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return;
        canvas.addEventListener('mousemove', (e) => {
            if (!window.__neonMPBroadcast || !window.__neonMPBroadcast.cursor) return;
            const rect = canvas.getBoundingClientRect();
            // Send zoom-independent (base-view CSS px) coordinates;
            // the receiving overlay applies ITS OWN zoom transform.
            const Z = window.__neonZoom || { scale: 1, tx: 0, ty: 0 };
            window.__neonMPBroadcast.cursor(
                (e.clientX - rect.left - Z.tx) / Z.scale,
                (e.clientY - rect.top  - Z.ty) / Z.scale);
        });
        _cursorMoveAttached = true;
    }

    function renderRaceOverlay(snap) {
        const list = document.getElementById('mp-race-list');
        if (!list) return;
        const peers = snap.peers || [];
        // Build markup imperatively so we control class state per row.
        // The list is small (≤ 16) so this is cheap per second.
        const frag = document.createDocumentFragment();
        for (const p of peers) {
            const row = document.createElement('div');
            row.className = 'mp-race-row' +
                (p.peer === snap.me ? ' is-me' : '') +
                (p.stale ? ' is-stale' : '') +
                (!p.alive ? ' is-dead' : '');
            const hpPct = p.mh > 0 ? Math.max(0, Math.min(1, p.h / p.mh)) : 0;
            row.innerHTML =
                '<span class="mp-race-name">' + escapeHTML(p.peer) + '</span>' +
                '<span class="mp-race-wave">w' + p.w + '</span>' +
                '<span class="mp-race-hp">' +
                    '<span class="mp-race-hp-bar" style="width:' + Math.round(hpPct * 100) + '%"></span>' +
                    '<span class="mp-race-hp-text">' + (p.alive ? (p.h + '/' + p.mh) : 'OUT') + '</span>' +
                '</span>';
            frag.appendChild(row);
        }
        list.innerHTML = '';
        list.appendChild(frag);
    }
    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
        }[c]));
    }
}

// Single source of truth for "is this base tower available to build/master".
// Only Blaster, Sniper and Flak are free; every other tower needs its Arsenal
// node owned. Reused by the build menu, the selectTower hotkey guard, and the
// Mastery Lab roster. (Autopilot builds via the ungated game.buildTower, so
// headless balance/auto-tune still exercise the full tower mix.)
function isTowerUnlocked(type) {
    if (typeof TREE_GATED_TOWERS !== 'undefined' && TREE_GATED_TOWERS.indexOf(type) !== -1) {
        return NeonSave.hasUnlocked(save, 'tower.' + type);
    }
    return true;
}
if (typeof window !== 'undefined') window.isTowerUnlocked = isTowerUnlocked;

// When a run starts with variant towers active (tower loadout), update the build
// menu so names and costs reflect the variant rather than the base tower.
// data-type stays as the base type (canonical build key); only the display changes.
function updateBuildMenuForLoadout(towerLoadout) {
    document.querySelectorAll('.tower-option[data-type]').forEach(el => {
        const baseType = el.dataset.type;
        // Tree-gated towers stay hidden until their Arsenal node is owned.
        // Only Blaster, Sniper and Flak are free; the rest are unlocked here.
        if (TREE_GATED_TOWERS.indexOf(baseType) !== -1) {
            const unlocked = isTowerUnlocked(baseType);
            el.classList.toggle('tt-tower-locked', !unlocked);   // CSS hide, no inline style
            if (!unlocked) return;
        }
        const variantId = towerLoadout && towerLoadout[baseType];
        const effectiveType = (variantId && TOWERS[variantId]) ? variantId : baseType;
        const cfg = TOWERS[effectiveType];
        if (!cfg) return;
        const nameEl = el.querySelector('.tower-info .name');
        const costEl = el.querySelector('.tower-info .cost');
        if (nameEl) nameEl.textContent = cfg.displayName;
        const displayCost = game && typeof game.getTowerBuildCost === 'function'
            ? game.getTowerBuildCost(baseType)
            : cfg.cost;
        if (costEl) costEl.textContent = displayCost + '¢';
    });
}

window.buyPotion = function() {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    const hpBefore = game.health;
    const ok = game.buyPotion();
    // game.buyPotion returns undefined; infer success by HP change.
    if (window.__neonMPBroadcast && game.health > hpBefore) {
        window.__neonMPBroadcast.potion();
    }
}

window.selectTower = function(type) {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    // Tree-gated towers can't be selected/built until their node is owned
    // (guards the hotkey path too, not just the hidden build button).
    if (typeof isTowerUnlocked === 'function' && !isTowerUnlocked(type)) return;

    document.querySelectorAll('.tower-option').forEach(el => el.classList.remove('selected'));
    
    if (selectedTowerType === type) {
        selectedTowerType = null; 
    } else {
        selectedTowerType = type;
        const el = document.querySelector(`.tower-option[data-type="${type}"]`);
        if (el) el.classList.add('selected');
        game.selectPlacedTower(null); // Deselect any clicked tower
    }
}

// Close menus when clicking outside of them
document.addEventListener('click', (e) => {
    const upgradeMenu = document.getElementById('upgrade-menu');
    const buildMenu = document.getElementById('build-menu');
    const canvas = document.getElementById('game-canvas');
    
    // If upgrade menu is open and click is outside of it, close it
    if (!upgradeMenu.classList.contains('hidden')) {
        if (!upgradeMenu.contains(e.target) && !canvas.contains(e.target)) {
            upgradeMenu.classList.add('hidden');
        }
    }
});

document.addEventListener('DOMContentLoaded', init);

// Mobile overflow proxy buttons — inline the real action so clicks stay
// inside the panel's event boundary, then reset the auto-close timer.
(function setupOverflowProxies() {
    document.addEventListener('DOMContentLoaded', () => {
        // SPEED proxy
        const speedProxy = document.getElementById('speed-btn-proxy');
        if (speedProxy) {
            speedProxy.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('speed-btn').dispatchEvent(new MouseEvent('click', { bubbles: false }));
                if (_resetOverflowTimer) _resetOverflowTimer();
            });
        }

        // AUTO proxy
        const autoProxy = document.getElementById('auto-btn-proxy');
        if (autoProxy) {
            autoProxy.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('autopilot-btn').dispatchEvent(new MouseEvent('click', { bubbles: false }));
                if (_resetOverflowTimer) _resetOverflowTimer();
            });
        }

        // Keep proxy display values in sync via MutationObserver
        const proxyMap = [
            { proxyId: 'speed-btn-proxy',  displayId: 'speed-display'     },
            { proxyId: 'auto-btn-proxy',   displayId: 'autopilot-display' },
        ];
        proxyMap.forEach(({ proxyId, displayId }) => {
            const proxy   = document.getElementById(proxyId);
            const display = document.getElementById(displayId);
            if (!proxy || !display) return;
            const proxyValue = proxy.querySelector('.proxy-value');
            if (!proxyValue) return;

            const sync = () => {
                proxyValue.textContent  = display.textContent;
                // Copy classes (carries .on etc) but keep proxy-value class
                proxyValue.className    = display.className + ' proxy-value';
                // Copy inline colour set by updateSpeedColor()
                proxyValue.style.color      = display.style.color;
                proxyValue.style.textShadow = display.style.textShadow;
            };
            sync();
            new MutationObserver(sync).observe(display, {
                childList: true, characterData: true, subtree: true, attributes: true
            });
            // Also watch inline style changes (not covered by MutationObserver attributes on style)
            new MutationObserver(sync).observe(display, { attributeFilter: ['style'] });
        });
    });
})();

// ---------------------------------------------------------------------------
// App distribution: mobile-web download link + APK in-app update notice.
//
// Two distinct surfaces, gated by where the page is running:
//   • mobile web (a phone browser on github.io)  → a tiny, subtle "Get the
//     Android app" link in the bottom corner.
//   • inside the APK (host appassets.androidplatform.net) → an update banner
//     when the live build token is newer than the one bundled in the APK.
//
// The decision logic is split into pure functions (appDistShouldShowLink,
// appDistIsNewerBuild) so it can be unit-tested without a real device or
// network; the DOM wiring below just feeds them the live environment.
// ---------------------------------------------------------------------------
(function setupAppDistribution() {
    const APK_HOST = 'appassets.androidplatform.net';
    const APK_URL = 'https://github.com/ilgmars/AI-Playground-TD-NeonDefense/releases/download/Games/NeonDefense.apk';
    // The APK WebView blocks arbitrary external fetches, but its request
    // interceptor explicitly lets raw.githubusercontent.com through so this
    // one manifest can be read to detect a newer release.
    const LIVE_VERSION_URL = 'https://raw.githubusercontent.com/ilgmars/AI-Playground-TD-NeonDefense/main/version.json';
    const DISMISS_KEY = 'neonApkUpdateDismissed';

    // Show the mobile-web download link only on a touch/mobile browser that
    // is NOT already the installed app. Desktop and the APK never see it.
    function appDistShouldShowLink({ hostname, ua, coarse }) {
        if (hostname === APK_HOST) return false;            // inside the app
        const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua || '');
        return mobileUA || !!coarse;
    }

    // Compare two build tokens (UTC YYYYMMDDHHMMSS strings). True iff `live`
    // is strictly newer than `local`. Tolerates missing/garbage input.
    function appDistIsNewerBuild(local, live) {
        const a = String(local == null ? '' : local).replace(/\D/g, '');
        const b = String(live == null ? '' : live).replace(/\D/g, '');
        if (!a || !b) return false;
        if (a.length !== b.length) return b.length > a.length;
        return b > a; // equal length → lexical compare == numeric compare
    }

    function isApk() { return location.hostname === APK_HOST; }


    async function fetchBuildToken(url, fetchImpl) {
        const f = fetchImpl || window.fetch;
        // Hard cap via AbortController so the update probe can never linger on a
        // slow/captive network. Fire-and-forget (never awaited by boot), so the
        // game stays fully playable offline regardless. 8s tolerates a cold TLS
        // handshake to the CDN on mobile.
        let signal, timer;
        try {
            if (typeof AbortController === 'function') {
                const ac = new AbortController();
                signal = ac.signal;
                timer = setTimeout(() => ac.abort(), 8000);
            }
            const res = await f(url, { cache: 'no-store', signal });
            if (!res || !res.ok) throw new Error('version fetch failed: ' + url);
            const data = await res.json();
            return data && data.build;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // The LIVE build token (main's version.json). Order of trust:
    //  1) window.__neonNativeLiveBuild — fetched by the native APK shell, which
    //     has unrestricted network (no WebView cross-origin/cache quirks; the
    //     WebView's own fetch to raw.githubusercontent proved unreliable on
    //     some devices, so the update never surfaced).
    //  2) a cache-BUSTED JS fetch (unique ?t= defeats the CDN/WebView cache).
    async function fetchLiveBuild(fetchImpl) {
        const nat = (typeof window !== 'undefined') && window.__neonNativeLiveBuild;
        if (nat && /^\d{6,}$/.test(String(nat))) return String(nat);
        const bust = LIVE_VERSION_URL + (LIVE_VERSION_URL.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
        return fetchBuildToken(bust, fetchImpl);
    }

    // Pure decision: given the bundled + live build tokens and any prior
    // dismissal, should the update banner show? Returns { show, liveBuild }.
    function appDistEvaluateUpdate({ local, live, dismissed }) {
        if (!appDistIsNewerBuild(local, live)) return { show: false, liveBuild: String(live) };
        if (dismissed != null && String(dismissed) === String(live)) {
            return { show: false, liveBuild: String(live) };
        }
        return { show: true, liveBuild: String(live) };
    }

    // Apply an update decision to the DOM (reveal/hide the banner, point the
    // link at the latest APK). Split out from the IO so it's testable without
    // a real APK host or network.
    function applyUpdateDecision(decision, inApk) {
        const show = !!(decision && decision.show);
        const banner = document.getElementById('app-update-banner');
        if (banner) {
            if (show) {
                const linkEl = document.getElementById('app-update-link');
                if (linkEl) linkEl.href = APK_URL;
                banner.dataset.liveBuild = String(decision.liveBuild);
                banner.classList.remove('hidden');
            } else {
                banner.classList.add('hidden');
            }
        }
        // (The persistent download path now lives in the main-menu footer —
        // populateMainMenuVersion — so there's no separate corner link here.)
        return show;
    }

    // APK only: read bundled ./version.json + live manifest and reveal the
    // banner if a newer build exists (and wasn't already dismissed). Returns
    // a boolean for tests; never throws (offline/blocked → silently skip).
    async function checkForApkUpdate(fetchImpl) {
        if (!isApk()) return false;
        // The live manifest is the one thing we must read to know whether a
        // newer build exists. If it's unreachable (offline/blocked), stay quiet.
        let live;
        try {
            live = await fetchLiveBuild(fetchImpl);
        } catch (_) {
            return false;
        }
        if (!live) return false;
        // The bundled token is missing on APKs built before version.json was
        // bundled. A missing local token means this install predates current
        // main and is therefore behind it, so treat it as the oldest possible
        // build ('0') rather than bailing — that bail was why old installs were
        // never prompted to update.
        let local = null;
        try { local = await fetchBuildToken('./version.json', fetchImpl); } catch (_) {}
        let dismissed = null;
        try { dismissed = localStorage.getItem(DISMISS_KEY); } catch (_) {}
        const decision = appDistEvaluateUpdate({
            local: local == null ? '0' : local, live, dismissed,
        });
        return applyUpdateDecision(decision, true);
    }

    // "20260614093629" → "260614.093629" (yymmdd.hhmmss). Falls back to the
    // raw token if it isn't the expected YYYYMMDDHHMMSS shape.
    function formatBuild(b) {
        const s = String(b == null ? '' : b).replace(/\D/g, '');
        if (s.length < 14) return s ? 'build ' + s : 'build unknown';
        return s.slice(2, 8) + '.' + s.slice(8, 14);
    }

    // Build a cache-busted copy of a URL: a fresh `u=` query makes the browser
    // re-fetch index.html (GitHub Pages caches it ~10 min) instead of reusing
    // the stale copy that still references the OLD ?v= asset tokens. Preserves
    // the hash (the run seed).
    function freshReloadUrl(href) {
        try {
            const u = new URL(href, location.href);
            u.searchParams.set('u', Date.now().toString(36));
            return u.toString();
        } catch (_) {
            const base = String(href).split('#')[0], hash = String(href).indexOf('#') !== -1 ? '#' + String(href).split('#')[1] : '';
            return base + (base.indexOf('?') === -1 ? '?' : '&') + 'u=' + Date.now().toString(36) + hash;
        }
    }
    // A reload that actually pulls the LATEST deploy: plain location.reload()
    // can reuse the cached HTML (→ old assets), so clear any Cache Storage and
    // navigate to a cache-busted URL.
    async function hardReload() {
        try {
            if (window.caches && caches.keys) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (_) {}
        try { location.replace(freshReloadUrl(location.href)); }
        catch (_) { location.reload(); }
    }
    if (typeof window !== 'undefined') { window.__neonFreshReloadUrl = freshReloadUrl; window.__neonHardReload = hardReload; }

    // Main-menu footer: show the current build (bottom-left) + an APK download
    // link (bottom-right) that lights green when a newer build exists on main.
    // Runs on web AND in the APK — `local` is the page's bundled version.json,
    // `live` is main's. Never throws (offline/blocked → just shows the version).
    async function populateMainMenuVersion(fetchImpl) {
        const verEl = document.getElementById('mm-version');
        const dlEl = document.getElementById('mm-download');
        let local = null;
        try {
            const f = fetchImpl || window.fetch;
            const res = await f('./version.json', { cache: 'no-store' });
            if (res && res.ok) local = await res.json();
        } catch (_) {}
        const localBuild = local && local.build;
        let live = null;
        try { live = await fetchLiveBuild(fetchImpl); } catch (_) {}
        const newer = !!live && appDistIsNewerBuild(localBuild, live);
        if (verEl) {
            verEl.textContent = formatBuild(localBuild) + (newer ? ' • update available' : '');
            verEl.classList.toggle('update', newer);
        }
        if (dlEl) {
            const apk = isApk();
            if (!apk && newer) {
                // WEB: a newer build is a new DEPLOY, not a new APK — reloading
                // fetches it (the ?v= cache-bust pulls the fresh JS/CSS). So
                // show a Reload button instead of an APK download link.
                dlEl.textContent = 'Reload for update ▸';
                dlEl.removeAttribute('href');
                dlEl.classList.add('update');
                dlEl.onclick = (e) => { if (e) e.preventDefault(); hardReload(); };
            } else {
                // No update (or the APK download path): a plain link. Without
                // `.update` it renders gray/muted — the "no update" state the
                // footer should show on web.
                dlEl.href = APK_URL;
                dlEl.onclick = null;
                dlEl.textContent = (apk && newer) ? 'Download latest ▸' : 'Get the app ▸';
                dlEl.classList.toggle('update', apk && newer);
            }
        }
        return { localBuild: String(localBuild), live: String(live), newer };
    }

    // Expose the pure logic (and the wired entry points) for regression tests.
    window.appDistShouldShowLink = appDistShouldShowLink;
    window.appDistIsNewerBuild = appDistIsNewerBuild;
    window.appDistEvaluateUpdate = appDistEvaluateUpdate;
    window.applyUpdateDecision = applyUpdateDecision;
    window.checkForApkUpdate = checkForApkUpdate;
    window.populateMainMenuVersion = populateMainMenuVersion;

    // One entry point that refreshes both the footer build line and the APK
    // update banner. Called at boot, every time the main menu opens, and once
    // an hour while the app stays open. Throttled so bouncing in/out of the
    // menu doesn't hammer GitHub's raw endpoint; the hourly tick forces past
    // the throttle. (window.__neonVersionCheckThrottleMs overrides for tests.)
    let _verBusy = false, _verLast = 0;
    async function refreshVersionInfo(force) {
        const throttle = (typeof window.__neonVersionCheckThrottleMs === 'number')
            ? window.__neonVersionCheckThrottleMs : 30000;
        const now = Date.now();
        if (!force && (_verBusy || now - _verLast < throttle)) return;
        _verBusy = true; _verLast = now;
        try { await populateMainMenuVersion(); await checkForApkUpdate(); }
        catch (_) {}
        finally { _verBusy = false; }
    }
    window.refreshVersionInfo = refreshVersionInfo;

    document.addEventListener('DOMContentLoaded', () => {
        refreshVersionInfo();
        // Catch a deploy that lands while the player just sits on the menu.
        setInterval(() => refreshVersionInfo(true), 60 * 60 * 1000);

        const dismiss = document.getElementById('app-update-dismiss');
        const banner = document.getElementById('app-update-banner');
        if (dismiss && banner) {
            dismiss.addEventListener('click', () => {
                banner.classList.add('hidden');
                try {
                    if (banner.dataset.liveBuild) {
                        localStorage.setItem(DISMISS_KEY, banner.dataset.liveBuild);
                    }
                } catch (_) {}
            });
        }
    });
})();

// ── Ambient main-menu backdrop ───────────────────────────────────────────
// A faint, self-contained vignette behind the menu: ONE real Tower defending
// against real Enemies that converge on it from random directions. It uses the
// ACTUAL game classes (Tower / Enemy / Projectile / particles) — same combat,
// same art, same projectile types (a rocket tower really fires rockets) — so
// it matches the game exactly. It never touches the global `game`, runs its own
// canvas + rAF only while the menu is visible, re-seeds on each menu open, and
// is silenced (soundEnabled) + hidden under prefers-reduced-motion.
(function setupMenuDemo() {
    if (typeof document === 'undefined') return;
    const canvas = document.getElementById('menu-demo');
    if (!canvas || !canvas.getContext) return;
    if (typeof Tower === 'undefined' || typeof Enemy === 'undefined') return;   // need the real entities
    const ctx = canvas.getContext('2d');
    const GROUND = ['normal', 'fast', 'tank'];
    const DEMO_ENEMY_SPEED = 0.5;     // monsters move at half speed in the demo
    const DEMO_FIRE_MULT = 2;         // tower shoots twice as fast in the demo
    const SWARM_BREACHES = 6;         // mobs that reach the tower before it's overwhelmed
    const SWARM_COUNT = 11;           // …or this many alive at once → swarmed
    // Tower pool = every base COMBAT tower, derived from the canonical
    // NeonSave.TOWER_TYPES so it stays in sync as towers are added. Utility
    // towers that don't attack (income / beacon: range 0, damage 0) are excluded.
    function combatPool() {
        const all = (typeof NeonSave !== 'undefined' && NeonSave.TOWER_TYPES && NeonSave.TOWER_TYPES.length)
            ? NeonSave.TOWER_TYPES : ['basic', 'sniper', 'rapid', 'rocket', 'flak'];
        const list = all.filter(t => (typeof TOWERS !== 'undefined') && TOWERS[t] &&
            (TOWERS[t].range || 0) > 0 && (TOWERS[t].damage || 0) > 0);
        return list.length ? list : ['basic'];
    }
    const TILE = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 40;
    let W = 0, H = 0, dpr = 1;
    let tower = null, type = 'basic', isAir = false;
    let enemies = [], projectiles = [], particles = [], frames = 0, spawnT = 0;
    let breaches = 0, towerSerial = 0;
    let lastVisible = false, lastTs = 0, acc = 0;

    function reducedMotion() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
        catch (_) { return false; }
    }
    function resize() {
        const r = canvas.getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = r.width || canvas.clientWidth; H = r.height || canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
    }
    // Tower centred just ABOVE the title; monsters approach from a ring around
    // it. Measured each tick so it tracks the title as the menu scrolls
    // (landscape menus are taller than the viewport).
    function center() {
        let titleTop = H * 0.2;
        try {
            const tEl = document.querySelector('#main-menu .neon-logo');
            const cr = canvas.getBoundingClientRect();
            if (tEl) titleTop = tEl.getBoundingClientRect().top - cr.top;
        } catch (_) {}
        const cy = Math.max(64, Math.min(titleTop - 56, H * 0.32));
        return { cx: W * 0.5, cy, R: Math.min(Math.max(W, H) * 0.46, 138) };
    }
    function placeTower() { const c = center(); if (tower) { tower.x = c.cx - TILE / 2; tower.y = c.cy - TILE / 2; } return c; }
    const toCell = (px, py) => ({ c: (px - TILE / 2) / TILE, r: (py - TILE / 2) / TILE });

    // A fresh RANDOM tower each time the menu (re)opens (seed runs on open).
    function makeTower(t) {
        try {
            const tw = new Tower(0, 0, t);
            tw.targetMode = 'closest';                              // always shoot the NEAREST monster
            if (tw.fireRate > 0) tw.fireRate = Math.max(1, Math.round(tw.fireRate / DEMO_FIRE_MULT));  // ×2 fire rate
            towerSerial++;
            return tw;
        } catch (_) { return null; }
    }
    function pickType() {
        const pool = combatPool();
        type = pool[Math.floor(Math.random() * pool.length)];
        isAir = (type === 'flak');
    }
    function seed() {
        resize();
        pickType();
        tower = makeTower(type);
        enemies = []; projectiles = []; particles = []; frames = 0; spawnT = 0; breaches = 0;
        placeTower();
    }
    // The tower is overwhelmed: a big blast kills every mob, then a NEW random
    // tower takes its place. Keeps the particle explosions playing through.
    function explode() {
        const c = center();
        try {
            if (typeof Explosion !== 'undefined') {
                particles.push(new Explosion(c.cx, c.cy, 64));               // tower blast
                for (const e of enemies) particles.push(new Explosion(e.x, e.y, (e.radius || 12) * 1.6));
            }
        } catch (_) {}
        enemies = []; projectiles = []; breaches = 0;
        pickType();
        tower = makeTower(type);                                             // a new tower appears in its place
        placeTower();
        spawnT = 36;                                                         // brief lull before the next wave
    }
    function spawnEnemy() {
        const c = center();
        const t = isAir ? 'air' : GROUND[Math.floor(Math.random() * GROUND.length)];
        const ang = Math.random() * Math.PI * 2;                 // RANDOM direction
        const sx = c.cx + Math.cos(ang) * c.R, sy = c.cy + Math.sin(ang) * c.R;
        let e;
        try { e = new Enemy([toCell(sx, sy), toCell(c.cx, c.cy)], t, 0.8); }   // modest hp → live long enough to be seen converging
        catch (_) { return; }
        e.x = sx; e.y = sy;
        e.speed *= DEMO_ENEMY_SPEED;                             // half speed — calmer approach
        if (e.isAir) {
            e.followsPath = false; e.endX = c.cx; e.endY = c.cy;
            const dx = c.cx - sx, dy = c.cy - sy, d = Math.hypot(dx, dy) || 1;
            e.vx = dx / d * e.speed; e.vy = dy / d * e.speed;
        } else {
            e.pathIndex = 1;                                     // head straight at the tower
        }
        enemies.push(e);
    }
    function step() {
        if (!tower) { seed(); if (!tower) return; }
        placeTower();
        frames++;
        if (--spawnT <= 0 && enemies.length < 14) { spawnEnemy(); spawnT = 20; }
        const savedSound = soundEnabled; soundEnabled = false;   // the demo never beeps
        try {
            for (const e of enemies) e.update();
            tower.update(enemies, projectiles, particles);
            for (const p of projectiles) p.update(enemies, particles, projectiles);
            for (const pa of particles) pa.update();
        } catch (_) {} finally { soundEnabled = savedSound; }
        for (const e of enemies) if (e.reachedEnd) breaches++;   // a mob got to the tower
        enemies = enemies.filter(e => e.active && !e.reachedEnd);
        projectiles = projectiles.filter(p => p.active);
        particles = particles.filter(p => p.active);
        if (particles.length > 160) particles.length = 160;
        // Swarmed → the tower explodes, wipes the mobs, and a new one appears.
        if (breaches >= SWARM_BREACHES || enemies.length >= SWARM_COUNT) explode();
    }
    function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        // The entities' draw() blit cached sprites positioned/sized via the
        // GAME's render state (__neonRenderT zoom+pan, RENDER_SCALE×zoom). Pin
        // all three to the menu's own display (plain dpr) so sprites are crisp,
        // correctly sized, and not displaced; restore so the game is untouched.
        const sT = window.__neonRenderT, sRS = window.RENDER_SCALE, sZ = window.__neonZoom;
        window.__neonRenderT = { a: dpr, ox: 0, oy: 0 };
        window.RENDER_SCALE = dpr;
        window.__neonZoom = { scale: 1, tx: 0, ty: 0 };
        try {
            for (const pa of particles) pa.draw(ctx);
            for (const e of enemies) e.draw(ctx);
            for (const p of projectiles) p.draw(ctx);
            if (tower) tower.draw(ctx);
        } catch (_) {}
        window.__neonRenderT = sT; window.RENDER_SCALE = sRS; window.__neonZoom = sZ;
        // Dissolve below the tower so the scene never bleeds onto the title/buttons.
        if (tower) {
            const cy = tower.y + TILE / 2;
            const fy0 = cy + TILE / 2 + 10, fy1 = cy + TILE / 2 + 94;
            ctx.globalCompositeOperation = 'destination-out';
            const g = ctx.createLinearGradient(0, fy0, 0, fy1);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g; ctx.fillRect(0, fy0, W, fy1 - fy0);
            ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(0, fy1, W, Math.max(0, H - fy1));
            ctx.globalCompositeOperation = 'source-over';
        }
    }
    function visible() {
        const m = document.getElementById('main-menu');
        return !!(m && !m.classList.contains('hidden') && canvas.offsetParent !== null);
    }
    function frame(ts) {
        requestAnimationFrame(frame);
        const vis = visible();
        if (vis && !lastVisible) { seed(); lastTs = ts; acc = 0; }   // (re)opened → fresh scene
        lastVisible = vis;
        if (!vis || reducedMotion()) return;
        let dt = (ts - lastTs) / 1000; lastTs = ts;
        if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
        // Fixed 60Hz steps so entity cooldowns (counted in ticks) behave exactly
        // as they do in the game.
        acc += dt;
        let n = 0;
        while (acc >= 1 / 60 && n < 4) { step(); acc -= 1 / 60; n++; }
        draw();
    }
    window.addEventListener('resize', () => { if (visible()) resize(); });
    requestAnimationFrame(frame);

    // Test / diagnostic hooks.
    window.__neonMenuDemo = {
        restart: seed,
        _tick: () => { if (!tower) seed(); step(); draw(); },
        _setType: (t) => { type = t; isAir = (t === 'flak'); tower = makeTower(t); enemies = []; projectiles = []; particles = []; spawnT = 0; placeTower(); },
        // Spawn n enemies and return their approach angles (radians) for the
        // "from random directions" assertion; leaves no enemies behind.
        _sampleDirections: (n) => {
            if (!tower) seed();
            const out = [];
            for (let i = 0; i < n; i++) { spawnEnemy(); const e = enemies[enemies.length - 1]; const c = center(); if (e) out.push(Math.atan2(e.y - c.cy, e.x - c.cx)); }
            enemies = [];
            return out;
        },
        // Drive a swarm: send a wave of mobs that all reach the tower, then step
        // → triggers the overwhelmed explosion + new tower.
        _swarm: () => {
            if (!tower) seed();
            const serial0 = towerSerial, partBefore = particles.length;
            for (let i = 0; i < SWARM_BREACHES + 2; i++) { spawnEnemy(); const e = enemies[enemies.length - 1]; if (e) { e.active = false; e.reachedEnd = true; } }
            step();
            return { exploded: towerSerial > serial0, enemies: enemies.length, boom: particles.length > partBefore };
        },
        get state() {
            const cx = tower ? tower.x + TILE / 2 : 0, cy = tower ? tower.y + TILE / 2 : 0;
            return { type, isAir, towerX: cx, towerY: cy, W, H, pool: combatPool(),
                targetMode: tower && tower.targetMode, towerFireRate: tower && tower.fireRate, towerSerial,
                enemies: enemies.length, enemyTypes: enemies.map(e => e.type),
                enemySpeeds: enemies.map(e => e.speed),
                projectiles: projectiles.length, frames };
        },
    };
})();
