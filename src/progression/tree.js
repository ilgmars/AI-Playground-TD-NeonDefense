// Tech Tree v2 — eligibility, escalating cost, passive summing, respec.
// Reads TECH_TREE / TREE_COST_GROWTH / TREE_RESPEC_REFUND / RESPEC_PROTECTED
// / ASCENSION_AUTO_UNLOCKS from config.js and reads/writes save.unlockedNodes
// + save.metaXP + save.treeSpent via NeonSave. No DOM — main.js renders the
// graph; Game.applyMetaPassives consumes computeStats().

const NeonTree = (function () {

    // Allocatable owned nodes = owned ids that exist in TECH_TREE and aren't
    // RESPEC_PROTECTED. Grant ids (ability.scan, tower.mortar, …) and the
    // protected ascension grants are also pushed into unlockedNodes, but they
    // do NOT count here — only real, refundable tree picks drive escalation.
    function allocatedCount(save) {
        if (!save || !Array.isArray(save.unlockedNodes)) return 0;
        let n = 0;
        for (const id of save.unlockedNodes) {
            if (TECH_TREE[id] && RESPEC_PROTECTED.indexOf(id) === -1) n++;
        }
        return n;
    }

    // Effective XP cost: per-node base × global escalator^(owned allocatable).
    // The escalator is what makes "each skill more expensive than the last".
    // Rounded to a tidy 5 so the label reads cleanly even at huge ranks.
    function effectiveCost(save, nodeId) {
        const node = TECH_TREE[nodeId];
        if (!node) return Infinity;
        const n = allocatedCount(save);
        return Math.round(node.baseCost * Math.pow(TREE_COST_GROWTH, n) / 5) * 5;
    }

    // True if every prerequisite is owned. Roots (requires: []) are always met.
    function prereqsMet(save, nodeId) {
        const node = TECH_TREE[nodeId];
        if (!node) return false;
        const req = node.requires || [];
        return req.every(r => NeonSave.hasUnlocked(save, r));
    }

    // { ok, reason?, cost? } for a purchase attempt. Does not mutate the save.
    function canPurchase(save, nodeId) {
        const node = TECH_TREE[nodeId];
        if (!node) return { ok: false, reason: 'Unknown node' };
        if (NeonSave.hasUnlocked(save, nodeId)) return { ok: false, reason: 'Already owned' };
        if (!prereqsMet(save, nodeId)) return { ok: false, reason: 'Locked — unlock its prerequisites first' };
        const cost = effectiveCost(save, nodeId);
        if (save.metaXP < cost) return { ok: false, reason: 'Not enough XP' };
        return { ok: true, cost };
    }

    // Attempts purchase. Returns true on success. Mutates + persists the save.
    function purchase(save, nodeId) {
        const check = canPurchase(save, nodeId);
        if (!check.ok) return false;
        const node = TECH_TREE[nodeId];
        save.metaXP   -= check.cost;
        save.treeSpent = (save.treeSpent || 0) + check.cost;   // for the 30% respec refund
        save.unlockedNodes.push(nodeId);
        // Push the grant id too, so EXISTING consumers (abilities / heroes /
        // kits / qol / variant.all / tower.* build gate) see it via
        // hasUnlocked with no extra wiring.
        if (node.grants && !NeonSave.hasUnlocked(save, node.grants)) {
            save.unlockedNodes.push(node.grants);
        }
        NeonSave.write(save);
        return true;
    }

    // Sum every owned node's `effect` into one stat object (same keys the
    // backpack uses: damage/fireRate/payout/kill/interest/startMoney/maxHP/
    // regen/towerCost/upgradeCost). Empty when nothing owned → the run hook in
    // Game.applyMetaPassives is a strict no-op (auto-tune / MP stay untouched).
    function computeStats(save) {
        const s = {};
        if (!save || !Array.isArray(save.unlockedNodes)) return s;
        for (const id of save.unlockedNodes) {
            const node = TECH_TREE[id];
            if (!node || !node.effect) continue;
            for (const k of Object.keys(node.effect)) {
                s[k] = (s[k] || 0) + node.effect[k];
            }
        }
        return s;
    }

    // Full respec: refund TREE_RESPEC_REFUND of total XP spent, clear every
    // allocatable node + its grant id (protected ids kept), reset treeSpent
    // (which also resets the escalation counter). Returns { refund, spent,
    // cleared }. Mutates + persists.
    function respec(save) {
        if (!Array.isArray(save.unlockedNodes)) save.unlockedNodes = [];
        const spent  = Math.max(0, Math.floor(save.treeSpent || 0));
        const refund = Math.floor(spent * TREE_RESPEC_REFUND);

        const clearedNodes = save.unlockedNodes.filter(
            id => TECH_TREE[id] && RESPEC_PROTECTED.indexOf(id) === -1);

        // Removal set: each cleared node + its grant (unless that grant id is
        // protected, e.g. kit.economist may also be an ascension auto-grant).
        const remove = new Set();
        for (const id of clearedNodes) {
            remove.add(id);
            const g = TECH_TREE[id].grants;
            if (g && RESPEC_PROTECTED.indexOf(g) === -1) remove.add(g);
        }

        save.unlockedNodes = save.unlockedNodes.filter(id => !remove.has(id));
        save.metaXP   += refund;
        save.treeSpent = 0;
        NeonSave.write(save);
        return { refund, spent, cleared: clearedNodes.length };
    }

    // Called from window.onRunEnded when a new Ascension tier is cleared.
    // Grants a free tree-effect id per ASCENSION_AUTO_UNLOCKS (these ids are
    // RESPEC_PROTECTED, so respec/migration never strips them). Returns the id
    // that was unlocked, or null if already owned / no mapping.
    function autoUnlockOnAscension(save, clearedTier) {
        const nodeId = ASCENSION_AUTO_UNLOCKS[clearedTier];
        if (!nodeId) return null;
        if (NeonSave.hasUnlocked(save, nodeId)) return null;
        save.unlockedNodes.push(nodeId);
        NeonSave.write(save);
        return nodeId;
    }

    // One-time migration from the old 3×5 tree. The new tree starts "from 0":
    // refund the OLD XP cost of any owned old purchasable node and drop it, so
    // the player re-picks in the new tree with the value handed back as metaXP.
    // Pre-unlocks + ascension auto-grants (RESPEC_PROTECTED) are kept. New-tree
    // node ids never appear here, so re-running after allocating is a no-op.
    // Idempotent via save.treeV2Migrated. Returns the XP refunded.
    const OLD_NODE_COST = {
        'hero.engineer': 50, 'ability.scan': 50,
        'hero.warden': 200, 'ability.airstrike': 200, 'kit.medic': 200, 'qol.fastai': 200,
        'ability.freeze': 500, 'kit.strategist': 500, 'qol.ascpreview': 500
    };
    function migrateV2(save) {
        if (!save || save.treeV2Migrated) return 0;
        if (!Array.isArray(save.unlockedNodes)) save.unlockedNodes = [];
        let refund = 0;
        const keep = [];
        for (const id of save.unlockedNodes) {
            if (OLD_NODE_COST[id] !== undefined && RESPEC_PROTECTED.indexOf(id) === -1) {
                refund += OLD_NODE_COST[id];        // refund its old cost + drop it
            } else {
                keep.push(id);                      // protected / unknown / already-new → keep
            }
        }
        save.unlockedNodes = keep;
        save.metaXP    = (save.metaXP || 0) + refund;
        save.treeSpent = 0;
        save.treeV2Migrated = true;
        NeonSave.write(save);
        return refund;
    }

    return {
        allocatedCount,
        effectiveCost,
        prereqsMet,
        canPurchase,
        purchase,
        computeStats,
        respec,
        autoUnlockOnAscension,
        migrateV2
    };
})();

if (typeof window !== 'undefined') window.NeonTree = NeonTree;
if (typeof module !== 'undefined' && module.exports) module.exports = { NeonTree };
