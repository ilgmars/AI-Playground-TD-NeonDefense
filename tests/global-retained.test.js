// Regression: the global scoreboard must survive NON-OVERLAPPING
// sessions. Player A plays at 10:00 and closes the tab; player B
// opens the game at 11:00 and must still see A's score.
//
// Mechanism under test: mqtt-direct publishes the board to a
// broker-RETAINED topic (neondef/<room>/board, retain: true). The
// broker stores the last snapshot and hands it to every future
// subscriber, so the board outlives its publisher. Before this,
// scores only propagated between peers online at the same moment —
// the exact "scoreboard isn't syncing" failure users reported.
//
// Same fake-broker + vm approach as mqtt-direct.test.js, extended
// with retained-message storage.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// ── Fake mqtt.js with RETAINED support ─────────────────────────────
function makeFakeBroker() {
    return {
        clients: [],
        retained: new Map(),          // topic → payload (last wins)
        publish(fromClient, topic, payload, opts) {
            if (opts && opts.retain) this.retained.set(topic, payload);
            for (const c of this.clients) {
                if (c.subscribed.has(topic) && c !== fromClient && c.connected) {
                    queueMicrotask(() => c.fireMessage(topic, payload));
                }
            }
        },
        register(client) { this.clients.push(client); },
    };
}

function makeFakeClient(broker, clientId) {
    const handlers = new Map();
    const subscribed = new Set();
    const client = {
        clientId, subscribed, connected: false,
        on(ev, fn) {
            const arr = handlers.get(ev) || [];
            arr.push(fn);
            handlers.set(ev, arr);
        },
        subscribe(topic) {
            subscribed.add(topic);
            // Real brokers deliver the retained message on subscribe.
            const kept = broker.retained.get(topic);
            if (kept !== undefined) queueMicrotask(() => client.fireMessage(topic, kept));
        },
        publish(topic, payload, opts) { broker.publish(client, topic, payload, opts); },
        fireMessage(topic, payload) {
            if (!client.connected) return;
            for (const fn of handlers.get('message') || []) {
                try { fn(topic, Buffer.from(String(payload))); } catch (_) {}
            }
        },
        end(_force) {
            client.connected = false;
            for (const fn of handlers.get('close') || []) try { fn(); } catch (_) {}
        },
    };
    broker.register(client);
    queueMicrotask(() => {
        client.connected = true;
        for (const fn of handlers.get('connect') || []) try { fn(); } catch (_) {}
    });
    return client;
}

// ── Load mqtt-direct with the fake injected (same trick as
//    mqtt-direct.test.js) ─────────────────────────────────────────
const fs = require('fs');
const vm = require('vm');
const broker = makeFakeBroker();
const fakeMqtt = {
    connect(url, opts) {
        return makeFakeClient(broker, (opts && opts.clientId) || 'anon-' + Math.random());
    },
};
const src = fs.readFileSync(require.resolve('../src/multiplayer/mqtt-direct.js'), 'utf8');
const patched = src.replace(/import\(\s*\/\*[^*]*\*\/\s*url\s*\)/, 'Promise.resolve({ default: __fakeMqtt })');
const sandbox = {
    window: { __neonMqttRelayUrls: ['wss://broker.example.test:8884/mqtt'] },
    location: { protocol: 'https:' },
    Math, Date, JSON, Buffer, Promise, setTimeout, clearTimeout, queueMicrotask,
    __fakeMqtt: fakeMqtt,
    console,
};
vm.createContext(sandbox);
vm.runInContext(patched, sandbox);
const adapter = sandbox.window.NeonMP.mqttDirect;

const globalMod = require('../src/multiplayer/global.js');

(async () => {
    // ── 1) Adapter level: retained snapshot reaches a LATER joiner ──
    const A = await adapter.joinRoom('NEON23');
    ok('wrapper exposes sendRetained', typeof A.sendRetained === 'function');
    A.sendRetained({ kind: 'gl', entries: [{ n: 'GHOST', w: 99, r: 0, t: Date.now() }] });
    await new Promise(r => setTimeout(r, 20));
    A.leave();                                  // A is GONE before B joins

    const B = await adapter.joinRoom('NEON23');
    const seenB = [];
    B.onMessage(msg => seenB.push(msg));
    await new Promise(r => setTimeout(r, 20));
    ok('late joiner receives the retained board after publisher left',
        seenB.some(m => m && m.kind === 'gl' && Array.isArray(m.entries)
            && m.entries.some(e => e.n === 'GHOST')));
    B.leave();

    // ── 2) Board level: publish → stop → fresh board sees the entry ──
    const board1 = globalMod.createGlobalBoard({
        transportFactory: () => adapter.joinRoom('NEONGB'),
    });
    await board1.start();
    const res = board1.publish({ name: 'OFFLINE ACE', wave: 123, tier: 2, t: Date.now() });
    ok('publish accepted', res.ok === true);
    await new Promise(r => setTimeout(r, 20));
    board1.stop();                              // player closes the tab

    const board2 = globalMod.createGlobalBoard({
        transportFactory: () => adapter.joinRoom('NEONGB'),
    });
    await board2.start();
    await new Promise(r => setTimeout(r, 50));
    const snap = board2.snapshot();
    ok('fresh session sees the offline player\'s score via retained snapshot',
        snap.some(e => e.name === 'OFFLINE ACE' && e.wave === 123 && e.tier === 2),
        JSON.stringify(snap));
    board2.stop();

    // ── 3) Trystero-style rooms (no sendRetained) stay harmless ─────
    const transport = require('../src/multiplayer/transport.js');
    const hub = transport.createMockHub();
    const board3 = globalMod.createGlobalBoard({
        transportFactory: (room, id) => hub.join(room, id),
    });
    await board3.start();
    const res3 = board3.publish({ name: 'NO RETAIN', wave: 5, tier: 0, t: Date.now() });
    ok('publish still works on a transport without sendRetained', res3.ok === true);
    board3.stop();

    console.log(`\nGLOBAL RETAINED: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
