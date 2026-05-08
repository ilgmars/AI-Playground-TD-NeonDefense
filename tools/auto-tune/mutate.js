// Parameter mutation: generates variants of the winner params for next iteration.

function gaussian() {
    // Box-Muller transform
    let u1 = Math.random();
    let u2 = Math.random();
    let mag = Math.sqrt(-2 * Math.log(u1));
    return mag * Math.cos(2 * Math.PI * u2);
}

function mutate(value, stddev = 0.1) {
    if (typeof value === 'number') {
        return Math.max(0, value * (1 + gaussian() * stddev));
    }
    return value;
}

function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Generate 6 param sets: 1 control (exact winner) + 5 mutations
function generateNextParamSets(winnerParams) {
    const sets = [];

    // Control: exact winner
    sets.push(deepCopy(winnerParams));

    // 5 mutations
    for (let i = 0; i < 5; i++) {
        const variant = deepCopy(winnerParams);

        // Mutate key knobs
        if ('laserSynergyScore' in variant) {
            variant.laserSynergyScore = mutate(variant.laserSynergyScore, 0.15);
        }
        if ('mustBuildMinTowers' in variant) {
            variant.mustBuildMinTowers = Math.round(mutate(variant.mustBuildMinTowers, 0.2));
        }
        if ('laserSynergyRange' in variant) {
            variant.laserSynergyRange = Math.round(mutate(variant.laserSynergyRange, 0.15));
        }
        if ('potionHealthThreshold' in variant) {
            variant.potionHealthThreshold = Math.round(mutate(variant.potionHealthThreshold, 0.15));
        }
        if ('saveBufferFlakUrgent' in variant) {
            variant.saveBufferFlakUrgent = Math.round(mutate(variant.saveBufferFlakUrgent, 0.2));
        }
        if ('saveBufferFlakNeeded' in variant) {
            variant.saveBufferFlakNeeded = Math.round(mutate(variant.saveBufferFlakNeeded, 0.2));
        }
        if ('upgradeAlongsideBuild' in variant) {
            variant.upgradeAlongsideBuild = Math.round(mutate(variant.upgradeAlongsideBuild, 0.2));
        }

        // Mutate wantedCount cap multipliers
        if ('wantedCountCapMult' in variant && typeof variant.wantedCountCapMult === 'object') {
            const newMults = deepCopy(variant.wantedCountCapMult);
            for (const type of Object.keys(newMults)) {
                newMults[type] = Math.max(0.5, Math.min(2.0, mutate(newMults[type], 0.15)));
            }
            variant.wantedCountCapMult = newMults;
        }

        // Mutate upgradeValue weights
        if ('upgradeValue' in variant && typeof variant.upgradeValue === 'object') {
            const newValues = deepCopy(variant.upgradeValue);
            for (const [type, val] of Object.entries(newValues)) {
                newValues[type] = Math.round(mutate(val, 0.15));
            }
            variant.upgradeValue = newValues;
        }

        sets.push(variant);
    }

    return sets;
}

module.exports = { generateNextParamSets };
