// Tech Tree purchase + eligibility + auto-unlock logic (M2).
// Reads/writes save.unlockedNodes and save.metaXP via NeonSave.
// No DOM — rendering is done by main.js's renderTechTree, which
// consumes canPurchase/isTierOpen to style nodes.

const NeonTree = (function () {

    // Returns true if the tier is "open" — player owns >= 2 nodes in the
    // immediately prior tier. Tier 1 is always open.
    function isTierOpen(save, tierKey) {
        if (tierKey === 'tier1') return true;
        const priorKey = (tierKey === 'tier2') ? 'tier1' : 'tier2';
        const priorNodes = TECH_TREE[priorKey].nodes.map(n => n.id);
        const owned = priorNodes.filter(id => NeonSave.hasUnlocked(save, id));
        return owned.length >= 2;
    }

    // Returns { ok: boolean, reason?: string } for a purchase attempt.
    // Does not mutate the save.
    function canPurchase(save, nodeId) {
        const node = getTreeNode(nodeId);
        if (!node) return { ok: false, reason: 'Unknown node' };
        if (NeonSave.hasUnlocked(save, nodeId)) return { ok: false, reason: 'Already owned' };
        if (!isTierOpen(save, node.tier)) return { ok: false, reason: 'Tier locked — unlock 2 nodes in prior tier' };
        if (save.metaXP < node.cost) return { ok: false, reason: 'Not enough XP' };
        return { ok: true };
    }

    // Attempts purchase. Returns true on success. Mutates save.
    function purchase(save, nodeId) {
        const check = canPurchase(save, nodeId);
        if (!check.ok) return false;
        const node = getTreeNode(nodeId);
        save.metaXP -= node.cost;
        save.unlockedNodes.push(nodeId);
        NeonSave.write(save);
        return true;
    }

    // Called from window.onRunEnded when a new Ascension tier is cleared.
    // Grants a free tree node per ASCENSION_AUTO_UNLOCKS. Returns the
    // nodeId that was unlocked (or null if already owned / no mapping).
    function autoUnlockOnAscension(save, clearedTier) {
        const nodeId = ASCENSION_AUTO_UNLOCKS[clearedTier];
        if (!nodeId) return null;
        if (NeonSave.hasUnlocked(save, nodeId)) return null;
        save.unlockedNodes.push(nodeId);
        NeonSave.write(save);
        return nodeId;
    }

    return {
        isTierOpen,
        canPurchase,
        purchase,
        autoUnlockOnAscension
    };
})();
