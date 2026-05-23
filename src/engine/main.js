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
        if (selected === variantId && isTowerVariantUnlocked(baseType)) {
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

// Renders one of the three .ascension-buttons containers. Shows A0-A7,
// greys/locks tiers above save.ascensionCleared + 1. Also populates the
// corresponding .ascension-modifiers-preview line with cumulative modifiers.
function renderAscensionSelector(context) {
    const container = document.querySelector(`.ascension-buttons[data-context="${context}"]`);
    if (!container) return;
    container.innerHTML = '';

    const unlockedMax = (save.ascensionCleared | 0) + 1;     // endless: no upper cap
    const namedTop    = Math.min(unlockedMax, ASCENSION_NAMED_MAX_TIER);

    // Named tiers: always one button each, up to the highest unlocked
    // named tier (capped at A10).
    for (let t = 0; t <= namedTop; t++) {
        const spec = getAscensionTierSpec(t);
        const btn = document.createElement('button');
        btn.className = 'ascension-btn';
        btn.textContent = spec.label;
        btn.title = spec.name;
        if (t === selectedTier) btn.classList.add('selected');
        btn.addEventListener('click', () => setTier(t));
        container.appendChild(btn);
    }

    // Endless stepper: only shown once the player has cleared past A10.
    // Renders [-] [A<n>] [+] where n is the currently-selected endless
    // tier (clamps to A11 if we're still inside the named range).
    if (unlockedMax > ASCENSION_NAMED_MAX_TIER) {
        const stepper = document.createElement('div');
        stepper.className = 'ascension-stepper';
        const currentEndless = selectedTier > ASCENSION_NAMED_MAX_TIER
            ? selectedTier
            : ASCENSION_NAMED_MAX_TIER + 1;

        const minus = document.createElement('button');
        minus.className = 'ascension-step-btn';
        minus.textContent = '−';
        minus.title = 'Step down one tier';
        minus.disabled = currentEndless <= ASCENSION_NAMED_MAX_TIER + 1;
        minus.addEventListener('click', () => setTier(currentEndless - 1));

        const label = document.createElement('button');
        label.className = 'ascension-btn ascension-endless';
        label.textContent = 'A' + currentEndless;
        label.title = 'Endless +' + (currentEndless - ASCENSION_NAMED_MAX_TIER);
        if (selectedTier === currentEndless) label.classList.add('selected');
        label.addEventListener('click', () => setTier(currentEndless));

        const plus = document.createElement('button');
        plus.className = 'ascension-step-btn';
        plus.textContent = '+';
        plus.title = 'Step up one tier';
        plus.disabled = currentEndless >= unlockedMax;
        plus.addEventListener('click', () => setTier(currentEndless + 1));

        stepper.appendChild(minus);
        stepper.appendChild(label);
        stepper.appendChild(plus);
        container.appendChild(stepper);
    }

    const preview = document.querySelector(`.ascension-modifiers-preview[data-context="${context}"]`);
    if (preview) {
        if (selectedTier === 0) {
            preview.textContent = 'Baseline — no modifiers';
        } else {
            const names = [];
            const namedUpper = Math.min(selectedTier, ASCENSION_NAMED_MAX_TIER);
            for (let i = 1; i <= namedUpper; i++) names.push(getAscensionTierSpec(i).name);
            if (selectedTier > ASCENSION_NAMED_MAX_TIER) {
                const overshoot = selectedTier - ASCENSION_NAMED_MAX_TIER;
                names.push(`Endless ×${overshoot} (+${Math.round((Math.pow(1.05, overshoot) - 1) * 100)}% HP)`);
            }
            preview.textContent = names.join(' · ');
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
}
function hideScreen(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
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
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('retire-confirm');
    hideScreen('tech-tree');
    hideScreen('tower-mastery');
    hideScreen('backpack');
    hideScreen('save-code-modal');
    showScreen('main-menu');
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

function updateMainMenuState() {
    const bal = document.getElementById('menu-xp-balance');
    if (bal) bal.textContent = save.metaXP + ' XP';

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
}

function renderTechTree() {
    const bal = document.getElementById('tree-xp-balance');
    if (bal) bal.textContent = save.metaXP;

    for (const tierKey of ['tier1', 'tier2', 'tier3']) {
        const tierEl = document.querySelector(`.tree-tier[data-tier="${tierKey}"]`);
        const body   = document.querySelector(`.tree-nodes[data-tier-body="${tierKey}"]`);
        if (!tierEl || !body) continue;

        const open = NeonTree.isTierOpen(save, tierKey);
        tierEl.classList.toggle('locked', !open);

        body.innerHTML = '';
        for (const node of TECH_TREE[tierKey].nodes) {
            body.appendChild(buildTreeNodeEl(node, tierKey, open));
        }
    }
}

function buildTreeNodeEl(node, tierKey, tierOpen) {
    const el = document.createElement('div');
    el.className = 'tree-node';

    const owned     = NeonSave.hasUnlocked(save, node.id);
    const cost      = TECH_TREE[tierKey].cost;
    const canAfford = save.metaXP >= cost;
    let status = cost + ' XP';
    if (owned) { el.classList.add('owned'); status = 'OWNED'; }
    else if (!tierOpen) { el.classList.add('locked'); status = 'LOCKED'; }
    else if (!canAfford) { el.classList.add('too-expensive'); status = cost + ' XP (need more)'; }

    const nameRow = document.createElement('div');
    nameRow.className = 'tree-node-name';
    const displayName = (node.kind === 'hero' && HEROES[node.id.slice(5)]) ? HEROES[node.id.slice(5)].name
                      : (node.kind === 'kit'  && STARTER_KITS[node.id.slice(4)]) ? STARTER_KITS[node.id.slice(4)].name
                      : (node.kind === 'ability' && ABILITIES[node.id.slice(8)]) ? ABILITIES[node.id.slice(8)].name
                      : (node.kind === 'qol' && QOL_NODES[node.id]) ? QOL_NODES[node.id].name
                      : node.id;
    nameRow.innerHTML = `<span>${displayName}</span><span class="node-status">${status}</span>`;

    const desc = document.createElement('div');
    desc.className = 'tree-node-desc';
    desc.textContent = node.desc;

    el.appendChild(nameRow);
    el.appendChild(desc);

    if (!owned && tierOpen && canAfford) {
        el.addEventListener('click', () => {
            if (NeonTree.purchase(save, node.id)) {
                renderTechTree();
                renderLoadoutDropdowns();
                updateMainMenuState();
            }
        });
    }

    return el;
}

// M3: Tower Mastery screen. Shows 9 tower rows with XP progress bars
// and milestone dots. Reads save.towerMastery; no purchase flow.
// Transient per-base mastery view selection ('base'|'variant'), seeded from
// the last run's loadout each time the lab opens so the player lands on the
// setup they were last using.
let mastSelection = {};

function navigateToTowerMastery() {
    _enterSubScreen();
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('tower-mastery');
    mastSelection = {};
    const loadout = (save.lastLoadout && save.lastLoadout.towerLoadout) || {};
    for (const base of NeonSave.TOWER_TYPES) {
        const variantId = (typeof TOWER_VARIANTS !== 'undefined') ? TOWER_VARIANTS[base] : null;
        const variantUnlocked = !!(save.towerMastery && save.towerMastery[base]
            && save.towerMastery[base].milestones && save.towerMastery[base].milestones.m1);
        const chosen = loadout[base];
        mastSelection[base] = (chosen && chosen === variantId && variantUnlocked) ? 'variant' : 'base';
    }
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
    const perkMeta = {
        damage: { label: 'Damage', value: r => `+${dmgPct(r)}%` },
        fireRate: { label: 'Fire Rate', value: r => `+${ratePct(r)}%` },
        efficiency: { label: 'Upgrade Cost', value: r => `-${r * 2}%` }
    };
    const incomePerkMeta = {
        damage: { label: 'Yield / Aura', value: r => `+${dmgPct(r)}%` },
        fireRate: { label: 'Fire Rate', value: r => `+${ratePct(r)}%` },
        efficiency: { label: 'Upgrade Cost', value: r => `-${r * 2}%` }
    };

    for (const type of NeonSave.TOWER_TYPES) {
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
        spendable.textContent = `Spendable ${Math.floor(mast.xp || 0)} XP`;

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
        const activePerkMeta = type === 'income' ? incomePerkMeta : perkMeta;
        // Endless perks have an infinite limit — show "Lv N" instead of "N/∞".
        const fmtLv = (lim, rk) => Number.isFinite(lim) ? `${rk}/${lim}` : `Lv ${rk}`;
        for (const perk of ['damage', 'fireRate', 'efficiency']) {
            const rank = mast.perks[perk] || 0;
            const limit = NeonSave.MASTERY_PERK_LIMITS[perk];
            const cost = NeonSave.getMasteryPerkCost(save, activeKey, perk);
            const perkRow = document.createElement('div');
            perkRow.className = 'mastery-perk-row';

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
                spendable.textContent = `Spendable ${Math.floor(m.xp || 0)} XP`;
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
}

// ── Backpack (spatial inventory) ──────────────────────────────────────────
const BP_RARITY_COLOR = {
    common:    '#94a3b8',   // slate
    uncommon:  '#38bdf8',   // cyan
    rare:      '#c084fc',   // violet
    epic:      '#f472b6',   // hot pink
    legendary: '#fbbf24',   // gold
};
// Held item while arranging: { source:'stash'|'placed', id, rot }.
let bpHeld = null;
let bpCellEls = {};   // "x,y" -> grid cell element, for non-destructive ghost

function bpClearGhost() {
    for (const k in bpCellEls) bpCellEls[k].classList.remove('ghost-ok', 'ghost-bad');
}
// Paint the placement preview by toggling classes on existing cells — never
// re-renders the grid (a re-render would race the click after a hover).
function bpPaintGhost(x, y) {
    if (!bpHeld || !BACKPACK_ITEMS[bpHeld.id]) return;
    bpClearGhost();
    const def = BACKPACK_ITEMS[bpHeld.id];
    const okp = NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, x, y, bpHeld.rot);
    for (const [dx, dy] of NeonBackpack.shapeOffsets(def.shape, bpHeld.rot)) {
        const el = bpCellEls[(x + dx) + ',' + (y + dy)];
        if (el) el.classList.add(okp ? 'ghost-ok' : 'ghost-bad');
    }
}

function navigateToBackpack() {
    _enterSubScreen();
    bpHeld = null;
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
    if (bpHeld) { save.backpack.stash.push(bpHeld.id); bpHeld = null; }
}

function bpPickStash(i) {
    const bp = save.backpack;
    if (i < 0 || i >= bp.stash.length) return;
    if (bpHeld) bpReturnHeldToStash();
    const id = bp.stash.splice(i, 1)[0];
    bpHeld = { source: 'stash', id, rot: 0 };
    bpStatus('Pick a grid cell (top-left) to place ' + (BACKPACK_ITEMS[id] ? BACKPACK_ITEMS[id].name : id) + '.');
    renderBackpack();
}

function bpPickPlaced(idx) {
    const bp = save.backpack;
    if (idx < 0 || idx >= bp.placed.length) return;
    if (bpHeld) bpReturnHeldToStash();
    const p = bp.placed.splice(idx, 1)[0];
    bpHeld = { source: 'placed', id: p.id, rot: p.rot || 0 };
    bpPersist();
    bpStatus('Re-place ' + (BACKPACK_ITEMS[p.id] ? BACKPACK_ITEMS[p.id].name : p.id) + ', or send it TO STASH.');
    renderBackpack();
}

function bpPlaceAt(x, y) {
    if (!bpHeld) return;
    const def = BACKPACK_ITEMS[bpHeld.id];
    if (!def) { bpHeld = null; renderBackpack(); return; }
    if (NeonBackpack.canPlace(save.backpack, BACKPACK_ITEMS, def, x, y, bpHeld.rot)) {
        save.backpack.placed.push({ id: bpHeld.id, x, y, rot: bpHeld.rot });
        bpHeld = null;
        bpPersist();
        bpStatus('Placed.');
        renderBackpack();
    } else {
        bpStatus("Doesn't fit there — rotate or pick another cell.");
        const g = document.getElementById('bp-grid');
        if (g) { g.classList.remove('bp-shake'); void g.offsetWidth; g.classList.add('bp-shake'); }
    }
}

function bpRotateHeld() {
    if (!bpHeld) return;
    bpHeld.rot = (bpHeld.rot + 1) % 4;
    renderBackpack();
}

function bpHeldToStash() {
    if (!bpHeld) return;
    save.backpack.stash.push(bpHeld.id);
    bpHeld = null;
    bpPersist();
    renderBackpack();
}

function bpSellHeld() {
    if (!bpHeld) return;
    const def = BACKPACK_ITEMS[bpHeld.id];
    const rarity = def && def.rarity;
    const refund = NeonSave.sellItem(save, rarity);
    bpHeld = null;
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
    bpStatus(`Salvaged ${def ? def.name : id} (${def ? def.rarity : '?'}) → stash. Next salvage: ${nextCost} XP.`);
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
    bpStatus(`Salvage Luck +1% (now +${save.backpack.luckBoost}%) for ${paid} XP.`);
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

    // Held panel
    const heldWrap = document.getElementById('bp-held');
    if (bpHeld && BACKPACK_ITEMS[bpHeld.id]) {
        const def = BACKPACK_ITEMS[bpHeld.id];
        heldWrap.classList.remove('hidden');
        document.getElementById('bp-held-name').textContent = def.name;
        bpMiniShape(def, bpHeld.rot, document.getElementById('bp-held-shape'));
        const descEl = document.getElementById('bp-held-desc');
        if (descEl) descEl.textContent = def.desc || '';
        const sellEl = document.getElementById('bp-sell-val');
        if (sellEl) {
            const refund = NeonSave.getSellRefund(def.rarity);
            sellEl.textContent = refund > 0 ? `+${refund}` : '';
        }
    } else {
        heldWrap.classList.add('hidden');
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
                cell.style.background = (BP_RARITY_COLOR[def && def.rarity] || '#64748b') + '33';
                cell.style.borderColor = BP_RARITY_COLOR[def && def.rarity] || '#64748b';
                if (pItem.x === x && pItem.y === y) cell.textContent = (def ? def.name[0] : '?');
                if (def) cell.title = `${def.name}\n${def.desc || ''}`;
                cell.dataset.placedIdx = String(ownerIdx);     // needed by the touch-drag handler
                cell.addEventListener('click', () => bpPickPlaced(ownerIdx));
                cell.addEventListener('mouseenter', () => { if (bpHeld) bpClearGhost(); });
            } else {
                cell.addEventListener('click', () => bpPlaceAt(x, y));
                // Non-destructive hover preview (no re-render → click survives).
                cell.addEventListener('mouseenter', () => { if (bpHeld) bpPaintGhost(x, y); });
            }
            gridEl.appendChild(cell);
        }
    }
    gridEl.addEventListener('mouseleave', bpClearGhost);

    // Stash
    const stashEl = document.getElementById('bp-stash');
    stashEl.innerHTML = '';
    document.getElementById('bp-stash-count').textContent = `(${bp.stash.length})`;
    bp.stash.forEach((id, i) => {
        const def = BACKPACK_ITEMS[id];
        const chip = document.createElement('button');
        chip.className = 'bp-chip';
        chip.dataset.stashIdx = String(i);     // needed by the touch-drag handler
        chip.style.borderColor = BP_RARITY_COLOR[def && def.rarity] || '#64748b';
        const shape = document.createElement('div');
        shape.className = 'bp-mini';
        bpMiniShape(def, 0, shape);
        const text = document.createElement('div');
        text.className = 'bp-chip-text';
        const label = document.createElement('span');
        label.className = 'bp-chip-name';
        label.textContent = def ? def.name : id;
        const desc = document.createElement('span');
        desc.className = 'bp-chip-desc';
        desc.textContent = def && def.desc ? def.desc : '';
        text.appendChild(label);
        text.appendChild(desc);
        chip.appendChild(shape);
        chip.appendChild(text);
        if (def) chip.title = `${def.name}\n${def.desc || ''}`;
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
        document.getElementById('victory-xp-balance').textContent = save.metaXP;
        document.getElementById('victory-xp-clear-row').classList.toggle('hidden', xp.clearBonus === 0);
        document.getElementById('victory-xp-first-row').classList.toggle('hidden', xp.firstBonus === 0);
    } else {
        document.getElementById('xp-wave').textContent     = xp.waveXP;
        document.getElementById('xp-clear').textContent    = xp.clearBonus;
        document.getElementById('xp-first').textContent    = xp.firstBonus;
        document.getElementById('xp-total').textContent    = xp.total;
        document.getElementById('xp-balance').textContent  = save.metaXP;
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

    const containerAspect = container.clientWidth / container.clientHeight;
    const gameAspect = window.COLS / window.ROWS;

    let cssWidth, cssHeight;

    if (containerAspect > gameAspect) {
        cssHeight = container.clientHeight;
        cssWidth = container.clientHeight * gameAspect;
    } else {
        cssWidth = container.clientWidth;
        cssHeight = container.clientWidth / gameAspect;
    }

    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';

    // High-DPI display scaling — cap at 2× so mobile WebView doesn't render
    // 9× the pixels (3× DPR² = 9×) and tank frame rate.
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(rawDpr, 2);
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

    // Expose performance flag: true when the device pixel ratio was capped.
    // Used by draw code to skip expensive shadow/glow effects on low-power paths.
    window.NEON_LOW_PERF = rawDpr > 2;

    const logicalWidth = window.COLS * window.TILE_SIZE;
    window.RENDER_SCALE = (cssWidth * dpr) / logicalWidth;
    
    // Force immediate redraw if paused
    if (typeof game !== 'undefined' && game.state !== 'playing') {
        game.draw();
    }
}

window.addEventListener('resize', resizeCanvas);
// iOS Safari sometimes fires `orientationchange` without a subsequent
// `resize`, and landscape-portrait switches reshape the layout. Re-run the
// DPR-aware sizing after the browser has committed the new orientation.
window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 50);
    setTimeout(resizeCanvas, 250);
    setTimeout(resizeCanvas, 600); // extra pass after flex layout settles
});
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
    // Fixed logical resolution for perfect game balance
    window.COLS = 24;
    window.ROWS = 16;
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

    // M2: qol.skipsetup — show toggle only when unlocked, persist state.
    function refreshSkipsetupRow() {
        const row = document.getElementById('skipsetup-row');
        const toggle = document.getElementById('skipsetup-toggle');
        if (!row || !toggle) return;
        if (NeonSave.hasUnlocked(save, 'qol.skipsetup')) {
            row.classList.remove('hidden');
            toggle.checked = !!save.settings.skipRunSetup;
        } else {
            row.classList.add('hidden');
        }
    }
    document.getElementById('skipsetup-toggle').addEventListener('change', e => {
        save.settings.skipRunSetup = !!e.target.checked;
        NeonSave.write(save);
    });
    refreshSkipsetupRow();

    // M2: Main Menu wiring — landing screen.
    document.getElementById('menu-start-btn').addEventListener('click', () => {
        if (save.settings.skipRunSetup && save.lastLoadout) {
            // Skip Run Setup: restart with last loadout immediately.
            restartGame(null);
        } else {
            navigateToRunSetup();
        }
    });
    document.getElementById('menu-tree-btn').addEventListener('click', () => {
        navigateToTechTree();
    });
    document.getElementById('menu-mastery-btn').addEventListener('click', () => {
        navigateToTowerMastery();
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
    document.getElementById('bp-tostash').addEventListener('click', bpHeldToStash);
    document.getElementById('bp-discard').addEventListener('click', bpSellHeld);

    // ── Backpack drag-to-place (touch) ────────────────────────────────────
    // Mobile drag is modelled after the tower-dock pattern: touchstart on a
    // stash chip or placed cell records the start; once the gesture passes
    // the drag threshold we pick the item up; ghost preview tracks an
    // OFFSET point (~100 px above the finger in portrait, 70 px in
    // landscape) so the player can see what they're dropping onto. Release
    // commits placement at the ghost cell.
    const BP_DRAG_THRESHOLD_PX = 8;
    let bpTouch = null;     // { source, idx, startX, startY, dragging }

    function bpGhostOffsetPx() {
        return (window.innerWidth > window.innerHeight) ? 70 : 100;
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

    document.getElementById('bp-stash').addEventListener('touchstart', (e) => {
        if (!bpBackpackVisible() || e.touches.length !== 1) return;
        const chip = e.target.closest && e.target.closest('.bp-chip');
        if (!chip) return;
        const i = parseInt(chip.dataset.stashIdx, 10);
        if (!Number.isFinite(i)) return;
        const t = e.touches[0];
        bpTouch = { source: 'stash', idx: i, startX: t.clientX, startY: t.clientY, dragging: false };
    }, { passive: true });

    document.getElementById('bp-grid').addEventListener('touchstart', (e) => {
        if (!bpBackpackVisible() || e.touches.length !== 1) return;
        const cell = e.target.closest && e.target.closest('.bp-cell.filled');
        if (!cell) return;
        const idx = parseInt(cell.dataset.placedIdx, 10);
        if (!Number.isFinite(idx)) return;
        const t = e.touches[0];
        bpTouch = { source: 'placed', idx, startX: t.clientX, startY: t.clientY, dragging: false };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!bpTouch) return;
        const t = e.touches[0];
        if (!bpTouch.dragging) {
            if (Math.hypot(t.clientX - bpTouch.startX, t.clientY - bpTouch.startY) < BP_DRAG_THRESHOLD_PX) return;
            bpTouch.dragging = true;
            if (bpTouch.source === 'stash')  bpPickStash(bpTouch.idx);
            else                              bpPickPlaced(bpTouch.idx);
            // After a render we lost the grid cell map — reacquire below.
        }
        // Drag committed — suppress scroll + paint ghost at offset point.
        e.preventDefault();
        const target = bpCellAtPoint(t.clientX, t.clientY - bpGhostOffsetPx());
        if (target) bpPaintGhost(target.x, target.y);
        else        bpClearGhost();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (!bpTouch) return;
        const state = bpTouch;
        bpTouch = null;
        if (!state.dragging) return;        // pure tap — let click handlers fire
        e.preventDefault();
        const t = e.changedTouches[0];
        const target = bpCellAtPoint(t.clientX, t.clientY - bpGhostOffsetPx());
        if (target) bpPlaceAt(target.x, target.y);
        // No target → keep held so the user can still tap-to-place.
    }, { passive: false });
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
        if (confirm('Reset save? This deletes XP, unlocks, and high scores. Cannot be undone.')) {
            // Also wipe the Aegis signature so the fresh save starts clean.
            localStorage.removeItem('neonDefense.save');
            localStorage.removeItem('neonDefense.save.sig');
            location.reload();
        }
    });

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

    // M2: Run Setup BACK button goes to Main Menu.
    document.getElementById('setup-back-btn').addEventListener('click', uiGoBack);
    document.getElementById('tree-back-btn').addEventListener('click',  uiGoBack);

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

    document.getElementById('start-btn').addEventListener('click', () => {
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

    document.getElementById('speed-btn').addEventListener('click', () => {
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
            const originalColor = speedDisplay.style.color;
            speedDisplay.style.color = '#fbbf24';
            speedDisplay.style.textShadow = '0 0 20px rgba(251, 191, 36, 0.8)';
            speedDisplay.textContent = 'ULTRA!';
            
            setTimeout(() => {
                speedDisplay.textContent = gameSpeed + 'X';
                updateSpeedColor();
            }, 1500);
        }
        
        // Normal speed cycling
        if (ultraSpeedUnlocked) {
            gameSpeed *= 2;
            if (gameSpeed > 256) gameSpeed = 1;
        } else {
            gameSpeed *= 2;
            if (gameSpeed > 16) gameSpeed = 1;
        }
        
        document.getElementById('speed-display').textContent = gameSpeed + 'X';
        updateSpeedColor();
    });
    document.getElementById('pause-btn').addEventListener('click', () => {
        togglePause();
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

    document.getElementById('autopilot-btn').addEventListener('click', () => {
        game.autopilot = !game.autopilot;
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
        const OVERFLOW_TTL = 2000; // ms

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
        game = new Game(canvas, useSeed, selectedTier, {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility,
            towerLoadout: sanitizeTowerLoadout(selectedTowerLoadout)
        });
        window.game = game;
        if (typeof NeonAegis !== 'undefined') NeonAegis.protectGame(game);
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
        const seedVal = document.getElementById('restart-seed-input').value.trim();
        const parsed = seedVal !== '' ? parseInt(seedVal) : null;
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

    function renderScores(tier) {
        const scores = (save.highScores['a' + tier] || []).slice().sort((a, b) => b.wave - a.wave);
        scoresList.innerHTML = '';
        if (scores.length === 0) {
            scoresList.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.9rem;">NO DATA YET</div>';
            return;
        }
        scores.slice(0, 5).forEach((s, i) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.padding = '4px 0';
            div.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
            div.innerHTML = `<span style="color:#fff;">#${i+1} ${s.name}</span> <span style="color:#a3e635;">WAVE ${s.wave}</span>`;
            scoresList.appendChild(div);
        });
    }

    function setScoreTab(tier) {
        visibleScoreTier = tier;
        document.querySelectorAll('.score-tab').forEach(b => {
            b.classList.toggle('selected', parseInt(b.dataset.tier) === tier);
        });
        renderScores(tier);
    }

    renderScoreTabs();

    window.loadScores = function() {
        // Default the visible tab to the current run's tier on each game-over.
        setScoreTab(game ? game.ascensionTier : selectedTier);
    };

    // Name submission — appends to per-tier high-score list. Does NOT
    // re-award XP; that happens in onRunEnded immediately after death.
    submitScoreBtn.addEventListener('click', () => {
        const name = playerNameInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (name.length > 0 && name.length <= 3 && game.state === 'gameover') {
            const tier = game.ascensionTier;
            const list = save.highScores['a' + tier] || [];
            list.push({ name: name.slice(0, 3), wave: game.wave });
            list.sort((a, b) => b.wave - a.wave);
            save.highScores['a' + tier] = list.slice(0, 5);
            NeonSave.write(save);
            document.getElementById('score-entry').style.display = 'none';
            renderScoreTabs();
            setScoreTab(tier);
        }
    });

    // Called by Game.gameOver() the instant a run ends. Always awards XP
    // (whether or not the player submits a name) and updates ascensionCleared.
    // Exposes the XP breakdown to renderRunResultXP for the overlay.
    window.onRunEnded = function (result) {
        const { wave, tier, retired } = result;

        // ── AEGIS LOCK ────────────────────────────────────────────────────
        // If Aegis flagged the save (signed-save tamper, RNG override,
        // console money/HP spike, etc.) we withhold ALL meta progression:
        // metaXP gain, mastery, maxWaveReached, loot. The render function
        // shows a red banner explaining the situation. RESET SAVE clears
        // the flag.
        if (save.cheaterDetected) {
            const zeroXP = { waveXP: 0, clearBonus: 0, firstBonus: 0, total: 0, retireBonus: 0 };
            if (typeof renderRunResultXP === 'function') {
                renderRunResultXP({
                    wave, tier, xp: zeroXP, firstClear: false,
                    autoUnlockedNodeId: null, masteryResults: [],
                    retired, lootGranted: [], lootRoll: null,
                    cheaterReason: save.cheaterReason || 'anomaly'
                });
            }
            return;
        }

        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
        const retireBonus = retired ? Math.floor(xp.total * 0.5) : 0;
        xp.retireBonus = retireBonus;
        xp.total += retireBonus;
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        let autoUnlockedNodeId = null;
        if (firstClear) {
            save.ascensionCleared = tier;
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
            for (let t of game.selectedTowers) {
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
            game.buyUpgrade(idx);
        }
        // Build 1-9 — Relay (income) maps to 9. Order matches the build menu.
        else if (e.key >= '1' && e.key <= '9') {
            const towers = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo', 'income'];
            let idx = parseInt(e.key) - 1;
            selectTower(towers[idx]);
        }
    });

    function getCanvasPos(e) {
        const rect = canvas.getBoundingClientRect();
        const logicalWidth = window.COLS * window.TILE_SIZE;
        const logicalHeight = window.ROWS * window.TILE_SIZE;
        
        const scaleX = logicalWidth / rect.width;
        const scaleY = logicalHeight / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    canvas.addEventListener('pointermove', (e) => {
        const pos = getCanvasPos(e);
        mousePos.x = pos.x;
        mousePos.y = pos.y;
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
        const logicalWidth  = window.COLS * window.TILE_SIZE;
        const logicalHeight = window.ROWS * window.TILE_SIZE;
        const scaleX = logicalWidth / rect.width;
        const scaleY = logicalHeight / rect.height;
        
        // Thumb offset: larger in portrait (more vertical space), smaller in landscape
        const isLandscape = window.innerWidth > window.innerHeight;
        const GHOST_OFFSET_PX = isLandscape ? 70 : 100;
        
        // Apply offset in screen space, then scale to logical coordinates
        mousePos.x = (t.clientX - rect.left) * scaleX;
        mousePos.y = ((t.clientY - GHOST_OFFSET_PX) - rect.top) * scaleY;
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
        game.buildTower(pendingPlacement.col, pendingPlacement.row, pendingPlacement.type);
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

            const logicalWidth  = window.COLS * window.TILE_SIZE;
            const logicalHeight = window.ROWS * window.TILE_SIZE;
            const scaleX = logicalWidth / rect.width;
            const scaleY = logicalHeight / rect.height;

            // Same thumb offset as touchmove so the ghost the user sees is
            // also the position we test for placement on release.
            const isLandscape = window.innerWidth > window.innerHeight;
            const GHOST_OFFSET_PX = isLandscape ? 70 : 100;

            const lx = (t.clientX - rect.left) * scaleX;
            const ly = ((t.clientY - GHOST_OFFSET_PX) - rect.top) * scaleY;
            const col = Math.floor(lx / window.TILE_SIZE);
            const row = Math.floor(ly / window.TILE_SIZE);

            // Bounds check on the GHOST tile (col/row), not the finger position.
            // The finger sits ~100px below the ghost, so for a placement near the
            // bottom of the canvas the finger lands in the build dock — the old
            // raw-finger bounds check failed there even though the ghost was on
            // a valid tile (e.g. a U-bend in the path).
            const ghostOnMap = (col >= 0 && col < window.COLS && row >= 0 && row < window.ROWS);

            if (ghostOnMap && game.map.isBuildable(col, row) && game.canAfford(state.type)) {
                // Convert ghost tile centre back to screen coords for button positioning
                const tileCentreLogX = col * window.TILE_SIZE + window.TILE_SIZE / 2;
                const tileCentreLogY = row * window.TILE_SIZE + window.TILE_SIZE / 2;
                const sx = rect.left + tileCentreLogX / scaleX;
                const sy = rect.top  + tileCentreLogY / scaleY;
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
        game.draw();

        // Bonus minigame hooks. Game.update() sets these flags at wave-start
        // (alert) and wave-end (trigger) on every 15th-wave boundary; both are
        // skipped when autopilot is enabled per spec.
        if (game.pendingMinigameAlert) {
            game.pendingMinigameAlert = false;
            if (!game.autopilot) {
                const toast = document.getElementById('minigame-toast');
                if (toast) {
                    toast.classList.remove('hidden');
                    // Restart the fade animation if a previous toast is still on screen.
                    toast.style.animation = 'none';
                    void toast.offsetWidth;
                    toast.style.animation = '';
                    setTimeout(() => toast.classList.add('hidden'), 5000);
                }
            }
        }
        // Roguelike boon pick (every 10 waves). Drains before the minigame
        // so when both land on the same wave (e.g. 30, 60) the boon chooser
        // resolves first; the minigame flag is held until it's clear.
        if (game.pendingBoon && window.NeonBoons && !window.NeonBoons.isActive()
            && !(window.NeonMinigame && window.NeonMinigame.isActive())) {
            game.pendingBoon = false;
            window.NeonBoons.open();   // auto-resolves silently under autopilot
        }
        if (game.pendingMinigame && !(window.NeonBoons && window.NeonBoons.isActive())) {
            game.pendingMinigame = false;
            if (!game.autopilot && window.NeonMinigame) {
                window.NeonMinigame.open();
            }
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
}

// When a run starts with variant towers active (tower loadout), update the build
// menu so names and costs reflect the variant rather than the base tower.
// data-type stays as the base type (canonical build key); only the display changes.
function updateBuildMenuForLoadout(towerLoadout) {
    document.querySelectorAll('.tower-option[data-type]').forEach(el => {
        const baseType = el.dataset.type;
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
    game.buyPotion();
}

window.selectTower = function(type) {
    if (game.state !== 'playing' && game.state !== 'paused') return;
    
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
