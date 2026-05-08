// Inject utilities: runs scripts before page loads to set up determinism and no-retire.
const fs = require('fs');
const path = require('path');

const SEED_INJECT = fs.readFileSync(path.join(__dirname, 'seed-inject.js'), 'utf8');
const NO_RETIRE_INJECT = fs.readFileSync(path.join(__dirname, 'no-retire.js'), 'utf8');

async function injectSetup(page, seed) {
    // Set the seed on window object before any scripts run
    await page.addInitScript((seedValue) => {
        window._SEED = seedValue;
    }, seed);

    // Inject seeded PRNG
    await page.addInitScript(SEED_INJECT);

    // Inject no-retire
    await page.addInitScript(NO_RETIRE_INJECT);
}

module.exports = { injectSetup };
