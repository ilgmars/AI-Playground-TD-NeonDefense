// Ability instance + in-run charges (M2). Game creates one instance at
// construction via NeonAbilities.createInstance(abilityId). Instance
// tracks remaining charges and exposes tryUse() which returns true if
// the charge was consumed. Actual per-ability effects are implemented
// by the caller (main.js for UI + game.js for in-world).

const NeonAbilities = (function () {

    // Creates the per-run state for an ability. For 'ability.none' returns
    // a no-op instance.
    function createInstance(abilityId) {
        if (!abilityId || abilityId === 'ability.none') {
            return {
                id: 'ability.none',
                charges: 0,
                kind: 'none',
                tryUse: () => false,
                isUsable: () => false
            };
        }
        const key = abilityId.replace(/^ability\./, '');
        const def = ABILITIES[key];
        if (!def) return createInstance('ability.none');
        let remaining = def.charges;
        return {
            id: abilityId,
            kind: def.kind,
            name: def.name,
            get charges() { return remaining; },
            isUsable: () => remaining > 0,
            tryUse: () => {
                if (remaining <= 0) return false;
                remaining--;
                return true;
            }
        };
    }

    return { createInstance };
})();
