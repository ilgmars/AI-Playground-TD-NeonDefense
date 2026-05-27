// Regression: mqtt-direct adapter contract.
//
// Why: TURN bandwidth is metered. The global scoreboard is a pure
// broadcast room — pub/sub over MQTT covers it 100% without WebRTC,
// which means zero TURN cost AND it works through any NAT (port 443
// WSS). mqtt-direct exposes the SAME { send, onMessage, leave,
// onPeerJoin, onPeerLeave, peerCount, id, strategy } surface as the
// Trystero adapter so callers can drop it in without conditionals.
//
// We don't load mqtt.js or hit a real broker in this test — too
// flaky for CI. Instead we mock mqtt.connect to return a fake
// client we drive synchronously, and verify the adapter wires
// publish / subscribe / presence correctly.

'use strict';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Build a fake mqtt.js v5 client. Just enough surface to drive the
// adapter through its happy paths.
function makeFakeBroker() {
    const broker = {
        clients: [],
        publishedOnTopic: new Map(),
        publish(fromClient, topic, payload) {
            // Deliver to every OTHER client subscribed to the topic.
            const arr = this.publishedOnTopic.get(topic) || [];
            arr.push({ from: fromClient.clientId, payload });
            this.publishedOnTopic.set(topic, arr);
            for (const c of this.clients) {
                if (c.subscribed.has(topic) && c !== fromClient) {
                    queueMicrotask(() => c.fireMessage(topic, payload));
                }
            }
        },
        register(client) { this.clients.push(client); },
    };
    return broker;
}

function makeFakeClient(broker, clientId) {
    const handlers = new Map();   // event → [fn]
    const subscribed = new Set();
    const client = {
        clientId,
        subscribed,
        connected: false,
        on(ev, fn) {
            const arr = handlers.get(ev) || [];
            arr.push(fn);
            handlers.set(ev, arr);
        },
        subscribe(topic) { subscribed.add(topic); },
        publish(topic, payload) { broker.publish(client, topic, payload); },
        fireMessage(topic, payload) {
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
    // Simulate async connect.
    queueMicrotask(() => {
        client.connected = true;
        for (const fn of handlers.get('connect') || []) try { fn(); } catch (_) {}
    });
    return client;
}

// Stub the global window + mqtt module BEFORE requiring mqtt-direct.
global.window = {};
global.location = { protocol: 'https:' };
const broker = makeFakeBroker();
const fakeMqtt = {
    connect(url, opts) {
        const clientId = (opts && opts.clientId) || 'anon-' + Math.random();
        return makeFakeClient(broker, clientId);
    },
};

// mqtt-direct uses dynamic import() — patch it via the global
// import.meta hook. Cleanest path: pre-set the loaded module.
const mqttDirect = require('../src/multiplayer/mqtt-direct.js');
// Reach into the module's cached loader. The file exposes joinRoom
// via window.NeonMP.mqttDirect; loadMqtt() is the private CDN
// loader. Replace its return value by setting an internal cache —
// since the module IIFE has no exposed test hook, we monkey-patch
// the dynamic import via the function source.
//
// Pragmatic: re-load the source with import() stubbed.
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../src/multiplayer/mqtt-direct.js'), 'utf8');
// Replace the dynamic import with a hardcoded resolved promise of
// our fake. Targets the single import(...) call site.
const patched = src.replace(/import\(\s*\/\*[^*]*\*\/\s*url\s*\)/, 'Promise.resolve({ default: __fakeMqtt })');
const sandbox = {
    window: global.window,
    location: global.location,
    Math, Date, JSON, Buffer, Promise, setTimeout, queueMicrotask,
    __fakeMqtt: fakeMqtt,
    console,
};
sandbox.window.__neonMqttRelayUrls = ['wss://broker.example.test:8884/mqtt'];
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(patched, sandbox);
const adapter = sandbox.window.NeonMP.mqttDirect;
ok('mqtt-direct API exposed on window.NeonMP', !!adapter && typeof adapter.joinRoom === 'function');

// ── 1) joinRoom resolves after connect; wrapper has the right shape
(async () => {
    const room = await adapter.joinRoom('NEON23');
    ok('joinRoom resolves a wrapper',          !!room);
    ok('wrapper has id',                        typeof room.id === 'string' && room.id.length > 0);
    ok('wrapper strategy = mqtt-direct',        room.strategy === 'mqtt-direct');
    ok('wrapper.send is a function',            typeof room.send === 'function');
    ok('wrapper.onMessage is a function',       typeof room.onMessage === 'function');
    ok('wrapper.onPeerJoin is a function',      typeof room.onPeerJoin === 'function');
    ok('wrapper.leave is a function',           typeof room.leave === 'function');
    ok('wrapper.peerCount starts at 0',         room.peerCount() === 0);

    // ── 2) Two clients in the same room see each other's messages ──
    const A = await adapter.joinRoom('NEON23');
    const B = await adapter.joinRoom('NEON23');
    const seenA = []; const seenB = [];
    A.onMessage(msg => seenA.push(msg));
    B.onMessage(msg => seenB.push(msg));
    // Wait for presence handshake (queueMicrotask scheduling).
    await new Promise(r => setTimeout(r, 20));
    B.send({ hello: 'from B' });
    await new Promise(r => setTimeout(r, 20));
    ok('A receives a message published by B',
        seenA.some(m => m && m.hello === 'from B'));
    ok('B does NOT see its own echo',
        !seenB.some(m => m && m.hello === 'from B'));

    // ── 3) Presence: A sees B as a joined peer ──────────────────────
    ok('A.peerCount sees ≥1 peer after B joined',
        A.peerCount() >= 1);

    // ── 4) Leave: B's leave fires onPeerLeave on A ──────────────────
    let leftEvent = null;
    A.onPeerLeave(({ id }) => { leftEvent = id; });
    B.leave();
    await new Promise(r => setTimeout(r, 20));
    ok('A sees onPeerLeave fire when B leaves',
        leftEvent !== null);

    // ── 5) leave() makes further sends no-op (defensive) ────────────
    let bGotAfterLeave = null;
    A.onMessage(m => { bGotAfterLeave = m; });
    B.send({ should: 'not arrive' });
    await new Promise(r => setTimeout(r, 20));
    ok('messages sent after leave() do NOT propagate',
        bGotAfterLeave === null);

    console.log(`\nMQTT DIRECT: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
