// Module-level ref so proxy buttons (set up outside init()) can reset the timer.
let _resetOverflowTimer = null;
let game;
let selectedTowerType = null;
let mousePos = { x: 0, y: 0 };
let gameSpeed = 1;

// Load or create persistent save. NeonSave.load handles legacy migration
// (neonDefenseScores_easy|normal|hard → a0/a2/a4, 200 XP welcome grant).
const save = NeonSave.load();
window.save = save;   // M2: expose for Enemy.draw HP-bar check.

// Default tier = highest cleared. First-time players start on A0.
// Clamp to M1 ceiling in case a hand-edited save has ascensionCleared > 7.
let selectedTier = Math.min(save.ascensionCleared, ASCENSION_MAX_TIER);

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

function setTier(tier) {
    const unlockedMax = Math.min(save.ascensionCleared + 1, ASCENSION_MAX_TIER);
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

    const unlockedMax = Math.min(save.ascensionCleared + 1, ASCENSION_MAX_TIER);

    for (let t = 0; t <= ASCENSION_MAX_TIER; t++) {
        const spec = ASCENSION_TIERS[t];
        const btn = document.createElement('button');
        btn.className = 'ascension-btn';
        btn.textContent = spec.label; // "A0", "A1", ...
        btn.title = spec.name;
        if (t === selectedTier) btn.classList.add('selected');
        if (t > unlockedMax) {
            btn.classList.add('locked');
            btn.disabled = true;
            const showPreview = NeonSave.hasUnlocked(save, 'qol.ascpreview') && t === unlockedMax + 1;
            btn.title = spec.name
                + (showPreview ? ' (preview: ' + spec.name + ')' : '')
                + ' (locked — clear A' + (t - 1) + ' to unlock)';
        } else {
            btn.addEventListener('click', () => setTier(t));
        }
        container.appendChild(btn);
    }

    const preview = document.querySelector(`.ascension-modifiers-preview[data-context="${context}"]`);
    if (preview) {
        if (selectedTier === 0) {
            preview.textContent = 'Baseline — no modifiers';
        } else {
            const names = [];
            for (let i = 1; i <= selectedTier; i++) names.push(ASCENSION_TIERS[i].name);
            preview.textContent = names.join(' · ');
        }
    }
}


// M2: Populate the three loadout dropdowns based on unlocked tree nodes.
// Called at init and after any tree purchase. Preserves current selection
// if still valid; falls back to default otherwise.
function renderLoadoutDropdowns() {
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
        const variantUnlocked = save.towerMastery[baseType] && save.towerMastery[baseType].milestones && save.towerMastery[baseType].milestones.m1;
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

// Main Menu → Run Setup → Game is the canonical forward path.
function navigateToMainMenu() {
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('restart-confirm');
    hideScreen('tech-tree');
    hideScreen('tower-mastery');
    showScreen('main-menu');
    updateMainMenuState();
}

function navigateToRunSetup() {
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
function navigateToTowerMastery() {
    hideScreen('main-menu');
    hideScreen('start-screen');
    hideScreen('game-over');
    hideScreen('tech-tree');
    showScreen('tower-mastery');
    renderTowerMastery();
}

function renderTowerMastery() {
    const grid = document.getElementById('mastery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const type of NeonSave.TOWER_TYPES) {
        const mast = save.towerMastery[type] || { xp: 0, milestones: { m1: false, m2: false } };
        const towerDef = TOWERS[type];

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
        const capXP = mast.milestones.m2 ? 10000 : mast.milestones.m1 ? 10000 : 1000;
        xpText.textContent = `${mast.xp} / ${capXP} XP`;
        nameRow.appendChild(label);
        nameRow.appendChild(xpText);

        const bar = document.createElement('div');
        bar.className = 'mastery-bar';
        const fill = document.createElement('div');
        fill.className = 'mastery-bar-fill';
        const progress = Math.min(1, mast.xp / capXP);
        fill.style.width = (progress * 100) + '%';
        if (mast.milestones.m2) fill.classList.add('maxed');
        bar.appendChild(fill);

        const milestones = document.createElement('div');
        milestones.className = 'mastery-milestones';
        const dot1 = document.createElement('span');
        dot1.className = 'mastery-milestone-dot' + (mast.milestones.m1 ? ' hit' : '');
        dot1.textContent = (mast.milestones.m1 ? '● ' : '○ ') + 'VARIANT @ 1K';
        const dot2 = document.createElement('span');
        dot2.className = 'mastery-milestone-dot' + (mast.milestones.m2 ? ' hit' : '');
        dot2.textContent = (mast.milestones.m2 ? '● ' : '○ ') + 'SKIN @ 10K';
        milestones.appendChild(dot1);
        milestones.appendChild(dot2);

        body.appendChild(nameRow);
        body.appendChild(bar);
        body.appendChild(milestones);

        row.appendChild(icon);
        row.appendChild(body);
        grid.appendChild(row);
    }
}

// Renders the XP breakdown in the game-over overlay. Called by
// window.onRunEnded after XP has been applied to the save.
function renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults }) {
    // M3: Clear any stale mastery banners from prior runs.
    document.querySelectorAll('.xp-breakdown-unlock.mastery-banner').forEach(el => el.remove());
    document.getElementById('xp-wave').textContent     = xp.waveXP;
    document.getElementById('xp-clear').textContent    = xp.clearBonus;
    document.getElementById('xp-first').textContent    = xp.firstBonus;
    document.getElementById('xp-total').textContent    = xp.total;
    document.getElementById('xp-balance').textContent  = save.metaXP;

    // Hide the clear-bonus row when no clear, first-bonus row when no first clear.
    document.getElementById('xp-clear-row').classList.toggle('hidden', xp.clearBonus === 0);
    document.getElementById('xp-first-row').classList.toggle('hidden', xp.firstBonus === 0);

    const unlock = document.getElementById('xp-unlock');
    if (firstClear) {
        const nextTier = Math.min(tier + 1, ASCENSION_MAX_TIER);
        const nextSpec = ASCENSION_TIERS[nextTier];
        let text = nextTier > tier
            ? `UNLOCKED: ${nextSpec.label} — ${nextSpec.name}`
            : `MAXED`;
        if (autoUnlockedNodeId) {
            const node = getTreeNode(autoUnlockedNodeId);
            if (node) text += ` · FREE NODE: ${autoUnlockedNodeId}`;
        }
        unlock.textContent = text;
        unlock.classList.remove('hidden');
    } else {
        unlock.classList.add('hidden');
    }

    // M3: Mastery milestone banner — only appended if at least one milestone fired.
    if (masteryResults && masteryResults.length > 0) {
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

    // High-DPI display scaling
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

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
    // Small delay: some browsers report dimensions before the new orientation
    // has actually been applied to the layout.
    setTimeout(resizeCanvas, 50);
    setTimeout(resizeCanvas, 250);
});

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
        towerLoadout: { ...selectedTowerLoadout }
    });

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
    document.getElementById('mastery-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
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
            towerLoadout: { ...selectedTowerLoadout }
        });
        game.draw();
        updateSeedDisplay();
        updateModeDisplay();
        navigateToRunSetup();
    });
    document.getElementById('menu-reset-btn').addEventListener('click', () => {
        if (confirm('Reset save? This deletes XP, unlocks, and high scores. Cannot be undone.')) {
            localStorage.removeItem('neonDefense.save');
            location.reload();
        }
    });

    // M2: Run Setup BACK button goes to Main Menu.
    document.getElementById('setup-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
    });

    document.getElementById('tree-back-btn').addEventListener('click', () => {
        navigateToMainMenu();
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

    document.getElementById('start-btn').addEventListener('click', () => {
        // M2: Persist chosen loadout for next run.
        save.lastLoadout = {
            heroId: selectedHero,
            kitId: selectedKit,
            abilityId: selectedAbility,
            towerLoadout: { ...selectedTowerLoadout }
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
        if (game.state === 'playing' || game.state === 'paused') {
            game.state = 'paused';
            document.getElementById('restart-confirm').classList.remove('hidden');
        }
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
            towerLoadout: { ...selectedTowerLoadout }
        });
        game.start();
        updateSeedDisplay();
        updateModeDisplay();

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

    const scoresList = document.getElementById('scores-list');
    const playerNameInput = document.getElementById('player-name');
    const submitScoreBtn = document.getElementById('submit-score');

    // Populate the score-tabs container with one tab per Ascension tier (0..M1 max).
    function renderScoreTabs() {
        const tabs = document.getElementById('score-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        for (let t = 0; t <= ASCENSION_MAX_TIER; t++) {
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
        const { wave, tier } = result;
        const firstClear = wave >= 30 && tier > save.ascensionCleared;

        const xp = NeonSave.calculateRunXP(wave, tier, firstClear);
        save.metaXP        += xp.total;
        save.totalXPEarned += xp.total;

        let autoUnlockedNodeId = null;
        if (firstClear) {
            save.ascensionCleared = tier;
            // M2: Grant a free tree node for the cleared tier.
            autoUnlockedNodeId = NeonTree.autoUnlockOnAscension(save, tier);
        }
        NeonSave.write(save);

        if (firstClear) {
            renderAscensionSelector('start');
            renderAscensionSelector('gameover');
            renderAscensionSelector('restart');
            renderLoadoutDropdowns();
            updateMainMenuState();
        }

        // M3: Mastery XP from damage dealt this run.
        const masteryResults = NeonSave.tallyMastery(save, game.towers);

        if (typeof renderRunResultXP === 'function') {
            renderRunResultXP({ wave, tier, xp, firstClear, autoUnlockedNodeId, masteryResults });
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
        
        if (game.state !== 'playing') return;
        
        // Upgrades 1-3
        if (e.key >= '1' && e.key <= '3' && game.selectedTowers && game.selectedTowers.length > 0) {
            let idx = parseInt(e.key) - 1;
            game.buyUpgrade(idx);
        } 
        // Build 1-8
        else if (e.key >= '1' && e.key <= '8') {
            const towers = ['basic', 'sniper', 'rapid', 'laser', 'rocket', 'flak', 'electric', 'silo'];
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
        return window.innerWidth <= 768;
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
        const info = (typeof TOWER_INFO !== 'undefined') ? TOWER_INFO[type] : null;
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

            // Horizontal-leaning movement = scroll intent; release to browser.
            if (Math.abs(dx) > Math.abs(dy) * 1.2 || !touchState.canDrag) {
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
        // Offset the ghost UP by 1.5 tiles so the finger doesn't obscure it.
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const logicalWidth  = window.COLS * window.TILE_SIZE;
        const logicalHeight = window.ROWS * window.TILE_SIZE;
        const scaleY = logicalHeight / rect.height;
        const GHOST_OFFSET_PX = 72; // ~thumb size in screen pixels
        mousePos.x = (t.clientX - rect.left) * (logicalWidth  / rect.width);
        mousePos.y = (t.clientY - rect.top - GHOST_OFFSET_PX) * scaleY;
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

            if (t.clientX >= rect.left && t.clientX <= rect.right &&
                t.clientY >= rect.top  && t.clientY <= rect.bottom) {

                const logicalWidth  = window.COLS * window.TILE_SIZE;
                const logicalHeight = window.ROWS * window.TILE_SIZE;
                const GHOST_OFFSET_PX = 72;
                const scaleY = logicalHeight / rect.height;
                // Use the same offset as the ghost so confirm appears at the ghost tile
                const lx = (t.clientX - rect.left) * (logicalWidth  / rect.width);
                const ly = (t.clientY - rect.top - GHOST_OFFSET_PX) * scaleY;
                const col = Math.floor(lx / window.TILE_SIZE);
                const row = Math.floor(ly / window.TILE_SIZE);

                if (game.map.isBuildable(col, row) && game.canAfford(state.type)) {
                    // Convert ghost tile centre back to screen coords for button positioning
                    const tileCentreLogX = col * window.TILE_SIZE + window.TILE_SIZE / 2;
                    const tileCentreLogY = row * window.TILE_SIZE + window.TILE_SIZE / 2;
                    const sx = rect.left + tileCentreLogX / (logicalWidth  / rect.width);
                    const sy = rect.top  + tileCentreLogY / (logicalHeight / rect.height);
                    showPlaceConfirm(col, row, state.type, sx, sy);
                } else {
                    // Not buildable or can't afford — cancel silently
                    hidePlaceConfirm();
                }
            } else {
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
                // Success, deselect tower
                selectTower(selectedTowerType); 
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

    // Tower tooltip on build menu hover
    const TOWER_INFO = {
        basic:   { name: 'Blaster',   desc: 'Reliable all-rounder. Good DPS at medium range.',         dmg: 10,   rng: 100, spd: 40,  special: null },
        sniper:  { name: 'Sniper',    desc: 'Extreme range, high single-target damage. Slow fire rate.', dmg: 40,   rng: 250, spd: 100, special: 'Piercing' },
        rapid:   { name: 'Shotgun',   desc: 'Fires a spread of piercing pellets. Great vs groups.',     dmg: '8×5', rng: 80,  spd: 60,  special: 'Pierce ×2' },
        laser:   { name: 'Laser',     desc: 'Continuous beam that slows enemies. Weak vs air.',          dmg: '1.5/f', rng: 150, spd: '—', special: 'Slows 20%' },
        rocket:  { name: 'Rocket',    desc: 'Homing splash damage. Less effective vs air.',              dmg: 30,   rng: 200, spd: 90,  special: 'Splash 70' },
        flak:    { name: 'Flak (AA)', desc: 'Anti-air specialist. 4× damage vs air, air-only targeting.',dmg: 15,   rng: 250, spd: 35,  special: 'Air only' },
        electric:{ name: 'Tesla',     desc: 'Chains lightning between nearby enemies.',                   dmg: 25,   rng: 120, spd: 60,  special: 'Chains ×3' },
        silo:    { name: 'Silo',      desc: 'Builds hovering rockets that auto-launch at enemies.',       dmg: 120,  rng: 100, spd: 80,  special: 'Splash 40' },
        income:  { name: 'Relay',     desc: 'Generates +20¢ at the end of every wave. Passive.',         dmg: '—',  rng: '—', spd: '—', special: '+20¢/wave' },
        potion:  { name: 'Repair',    desc: 'Restores 5 HP instantly. Cost increases each use.',         dmg: '—',  rng: '—', spd: '—', special: '+5 HP' },
    };

    const tooltip = document.getElementById('tower-tooltip');
    document.querySelectorAll('.tower-option').forEach(el => {
        const type = el.dataset.type || (el.id === 'potion-btn' ? 'potion' : null);
        if (!type || !TOWER_INFO[type]) return;
        el.addEventListener('mouseenter', (e) => {
            const info = TOWER_INFO[type];
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


