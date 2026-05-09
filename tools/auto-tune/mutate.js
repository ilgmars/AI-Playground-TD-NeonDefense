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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function paramsOnly(candidate) {
    if (!candidate || typeof candidate !== 'object') return {};
    let params = candidate;
    while (params.params && typeof params.params === 'object') params = params.params;
    return params;
}

// Generate N param sets: 1 control (exact winner) + mutations
function generateNextParamSets(winnerParams, count = 6) {
    const sets = [];
    const base = paramsOnly(winnerParams);

    // Control: exact winner
    sets.push(deepCopy(base));

    for (let i = 1; i < count; i++) {
        const variant = deepCopy(base);

        // Mutate key knobs
        if ('tickInterval' in variant) {
            variant.tickInterval = Math.round(clamp(mutate(variant.tickInterval, 0.15), 10, 45));
        }
        if ('laserSynergyScore' in variant) {
            variant.laserSynergyScore = Math.round(clamp(mutate(variant.laserSynergyScore, 0.25), 0, 120));
        }
        if ('mustBuildMinTowers' in variant) {
            variant.mustBuildMinTowers = Math.round(clamp(mutate(variant.mustBuildMinTowers, 0.25), 3, 12));
        }
        if ('laserSynergyRange' in variant) {
            variant.laserSynergyRange = Math.round(clamp(mutate(variant.laserSynergyRange, 0.2), 1, 8));
        }
        if ('potionHealthThreshold' in variant) {
            variant.potionHealthThreshold = Math.round(clamp(mutate(variant.potionHealthThreshold, 0.2), 4, 18));
        }
        if ('saveBufferFlakUrgent' in variant) {
            variant.saveBufferFlakUrgent = Math.round(clamp(mutate(variant.saveBufferFlakUrgent, 0.35), 0, 200));
        }
        if ('saveBufferFlakNeeded' in variant) {
            variant.saveBufferFlakNeeded = Math.round(clamp(mutate(variant.saveBufferFlakNeeded, 0.35), 0, 150));
        }
        if ('saveCommitFraction' in variant) {
            variant.saveCommitFraction = clamp(mutate(variant.saveCommitFraction, 0.2), 0.45, 0.95);
        }
        if ('upgradeAlongsideBuild' in variant) {
            variant.upgradeAlongsideBuild = Math.round(clamp(mutate(variant.upgradeAlongsideBuild, 0.25), 50, 500));
        }
        if ('mustBuildWantedFraction' in variant) {
            variant.mustBuildWantedFraction = clamp(mutate(variant.mustBuildWantedFraction, 0.2), 0.35, 0.95);
        }
        if ('airImminentWindow' in variant) {
            variant.airImminentWindow = Math.round(clamp(mutate(variant.airImminentWindow, 0.35), 1, 4));
        }

        // Mutate wantedCount cap multipliers
        if ('wantedCountCapMult' in variant && typeof variant.wantedCountCapMult === 'object') {
            const newMults = deepCopy(variant.wantedCountCapMult);
            for (const type of Object.keys(newMults)) {
                newMults[type] = clamp(mutate(newMults[type], 0.25), 0.35, 2.25);
            }
            variant.wantedCountCapMult = newMults;
        }

        // Mutate upgradeValue weights
        if ('upgradeValue' in variant && typeof variant.upgradeValue === 'object') {
            const newValues = deepCopy(variant.upgradeValue);
            for (const [type, val] of Object.entries(newValues)) {
                newValues[type] = Math.round(clamp(mutate(val, 0.25), 1, 20));
            }
            variant.upgradeValue = newValues;
        }

        sets.push(variant);
    }

    return sets;
}

module.exports = { generateNextParamSets, paramsOnly };
