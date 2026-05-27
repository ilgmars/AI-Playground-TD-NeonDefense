// Regression: the global scoreboard PREFERS mqtt-direct over
// Trystero. Trystero is the fallback for environments where the
// mqtt.js CDN is blocked or the broker is unreachable.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

const globalMod = require('../src/multiplayer/global.js');
const transport = require('../src/multiplayer/transport.js');

// Build a fake mqttDirect and a fake trystero, expose both on
// window.NeonMP, then start() and watch which was called.
let mqttCalls = 0, trysteroCalls = 0;
global.window = global.window || {};
const mockHub = transport.createMockHub();
window.NeonMP = {
    mqttDirect: {
        joinRoom: async (room) => {
            mqttCalls++;
            // Return the MockHub peer so the rest of the global
            // board's logic works.
            return mockHub.join(room, 'self-mqtt');
        },
    },
    trystero: {
        joinRoom: async (room, id) => {
            trysteroCalls++;
            return mockHub.join(room, id || 'self-trys');
        },
    },
};

// ── 1) Happy path: mqtt-direct succeeds → trystero NOT called ───────
(async () => {
    mqttCalls = trysteroCalls = 0;
    const board = globalMod.createGlobalBoard();
    await board.start();
    ok('mqtt-direct called for primary path',  mqttCalls === 1);
    ok('Trystero NOT called when mqtt-direct works', trysteroCalls === 0);
    board.stop();

    // ── 2) Failure path: mqtt-direct throws → Trystero used as fallback
    window.NeonMP.mqttDirect.joinRoom = async () => { throw new Error('cdn-blocked'); };
    mqttCalls = trysteroCalls = 0;
    const board2 = globalMod.createGlobalBoard();
    await board2.start();
    ok('Trystero used as fallback when mqtt-direct fails',
        trysteroCalls === 1);
    board2.stop();

    // ── 3) No mqtt-direct on the page → Trystero used directly ──────
    delete window.NeonMP.mqttDirect;
    trysteroCalls = 0;
    const board3 = globalMod.createGlobalBoard();
    await board3.start();
    ok('Trystero used when mqtt-direct module missing',
        trysteroCalls === 1);
    board3.stop();

    // ── 4) Source check: the preference order in global.js ──────────
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../src/multiplayer/global.js'), 'utf8');
    ok('global.js references mqttDirect',  /mqttDirect/.test(src));
    ok('global.js references trystero as fallback',  /trystero/.test(src));
    // Crude ordering check: mqttDirect should appear FIRST in start().
    const startBlock = src.match(/async function start\(\)\s*\{[\s\S]*?\n        \}/);
    if (startBlock) {
        const mqIdx = startBlock[0].indexOf('mqttDirect');
        const trIdx = startBlock[0].indexOf('trystero');
        ok('mqttDirect check appears BEFORE trystero in start()',
            mqIdx > 0 && trIdx > 0 && mqIdx < trIdx);
    } else {
        ok('start() function found',  false);
    }

    console.log(`\nGLOBAL PREFERS MQTT: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
