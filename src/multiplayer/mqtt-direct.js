// Direct MQTT transport — bypasses Trystero / WebRTC / TURN.
//
// For the global scoreboard (NEON23) we only need to fan-out small
// JSON messages to everyone in the room. MQTT pub/sub does exactly
// that, runs through any NAT (port 443 WSS), and costs zero TURN
// bandwidth. Latency is a non-issue for a broadcast room that
// updates every 60 s.
//
// We lazy-load mqtt.js from a CDN the first time joinRoom is
// called so the static bundle stays small. The exposed surface
// matches the Trystero wrapper used elsewhere:
//
//   { id, send(msg), onMessage(fn) → unsub, leave(),
//     peerCount(), onPeerJoin(fn), onPeerLeave(fn), strategy }
//
// so the global board can drop this in as the primary transport
// without conditionals at the call site.

(function () {
    'use strict';

    // mqtt.js v5.x ESM build. Pinned for reproducibility. If esm.sh
    // is blocked we surface a clean error from joinRoom so the
    // caller can fall back to Trystero.
    const MQTT_CDN_URLS = [
        'https://esm.sh/mqtt@5.10.1/dist/mqtt.esm.js',
        'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.esm.js/+esm',
    ];
    const LOAD_TIMEOUT_MS = 8000;
    const TOPIC_PREFIX = 'neondef';

    let _mqttModule = null;
    async function loadMqtt() {
        if (_mqttModule) return _mqttModule;
        let lastErr = null;
        for (const url of MQTT_CDN_URLS) {
            try {
                const mod = await Promise.race([
                    import(/* webpackIgnore: true */ url),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('cdn-timeout:' + url)), LOAD_TIMEOUT_MS)),
                ]);
                _mqttModule = mod.default || mod;
                return _mqttModule;
            } catch (e) { lastErr = e; }
        }
        throw new Error('mqtt-direct: all CDNs failed (' + (lastErr && lastErr.message) + ')');
    }

    // Read the configured broker URL — same source the Trystero MQTT
    // strategy uses (window.__neonMqttRelayUrls populated by
    // tools/install-turn-config.sh from .credentials). Falls back to
    // the public EMQX broker on http origins.
    function brokerUrl() {
        if (typeof window !== 'undefined' && Array.isArray(window.__neonMqttRelayUrls)
                && window.__neonMqttRelayUrls.length > 0) {
            return window.__neonMqttRelayUrls[0];
        }
        const httpOrigin = typeof location !== 'undefined' && location.protocol === 'http:';
        return httpOrigin
            ? 'ws://broker.emqx.io:8083/mqtt'
            : 'wss://broker.emqx.io:8084/mqtt';
    }

    // Generate a stable-per-session peer id. We use native Math.random
    // even when the page reseeded Math.random for coop determinism
    // (window.__neonNativeRandom is set by the pre-boot script in
    // index.html for exactly this reason).
    function freshPeerId() {
        const rand = (typeof window !== 'undefined' && window.__neonNativeRandom) || Math.random;
        return 'p-' + Math.floor(rand() * 1e9).toString(36) + Math.floor(rand() * 1e9).toString(36);
    }

    // joinRoom: opens a connection to the broker, subscribes to the
    // room topic, and returns the wrapper. Connection lives for the
    // tab's lifetime; .leave() unsubscribes and disconnects.
    async function joinRoom(roomCode) {
        const mqtt = await loadMqtt();
        const url  = brokerUrl();
        const peerId = freshPeerId();
        const topic  = TOPIC_PREFIX + '/' + roomCode;
        const presenceTopic = TOPIC_PREFIX + '/' + roomCode + '/presence';

        return new Promise((resolve, reject) => {
            let settled = false;
            const client = mqtt.connect(url, {
                reconnectPeriod: 5000,
                keepalive: 60,
                clientId: peerId,
                will: { topic: presenceTopic, payload: JSON.stringify({ k: 'leave', p: peerId }), qos: 0, retain: false },
            });

            const msgListeners  = [];
            const joinListeners = [];
            const leaveListeners = [];
            const peers = new Set();
            let left = false;

            client.on('connect', () => {
                client.subscribe(topic);
                client.subscribe(presenceTopic);
                // Announce ourselves so peers already in the room
                // emit their join callback for us.
                client.publish(presenceTopic, JSON.stringify({ k: 'hello', p: peerId }));
                if (!settled) {
                    settled = true;
                    resolve(wrapper);
                }
            });
            client.on('error', (err) => {
                if (!settled) { settled = true; reject(err); }
                // After settled, mqtt.js auto-reconnects.
            });
            client.on('message', (topicIn, payloadBuf) => {
                if (left) return;
                let payload;
                try { payload = JSON.parse(payloadBuf.toString()); }
                catch (_) { return; }
                if (!payload) return;
                if (topicIn === presenceTopic) {
                    if (payload.k === 'hello' && payload.p && payload.p !== peerId) {
                        // New peer announces. We reply with our own
                        // hello so they count us too.
                        if (!peers.has(payload.p)) {
                            peers.add(payload.p);
                            for (const fn of joinListeners) {
                                try { fn({ id: payload.p }); } catch (_) {}
                            }
                        }
                        client.publish(presenceTopic, JSON.stringify({ k: 'ack', p: peerId, to: payload.p }));
                    } else if (payload.k === 'ack' && payload.p && payload.p !== peerId) {
                        if (!peers.has(payload.p)) {
                            peers.add(payload.p);
                            for (const fn of joinListeners) {
                                try { fn({ id: payload.p }); } catch (_) {}
                            }
                        }
                    } else if (payload.k === 'leave' && payload.p) {
                        if (peers.delete(payload.p)) {
                            for (const fn of leaveListeners) {
                                try { fn({ id: payload.p }); } catch (_) {}
                            }
                        }
                    }
                    return;
                }
                if (topicIn === topic && payload.p !== peerId && payload.msg) {
                    for (const fn of msgListeners) {
                        try { fn(payload.msg, payload.p); } catch (_) {}
                    }
                }
            });

            const wrapper = {
                id: peerId,
                strategy: 'mqtt-direct',
                send(msg) {
                    if (left) return;
                    if (!msg || typeof msg !== 'object') return;
                    try {
                        client.publish(topic, JSON.stringify({ p: peerId, msg }));
                    } catch (_) {}
                },
                onMessage(fn) {
                    msgListeners.push(fn);
                    return () => {
                        const i = msgListeners.indexOf(fn);
                        if (i >= 0) msgListeners.splice(i, 1);
                    };
                },
                onPeerJoin(fn)  { if (typeof fn === 'function') joinListeners.push(fn); },
                onPeerLeave(fn) { if (typeof fn === 'function') leaveListeners.push(fn); },
                peerCount() { return peers.size; },
                leave() {
                    if (left) return;
                    left = true;
                    msgListeners.length  = 0;
                    joinListeners.length = 0;
                    leaveListeners.length = 0;
                    try {
                        client.publish(presenceTopic, JSON.stringify({ k: 'leave', p: peerId }));
                        client.end(true);
                    } catch (_) {}
                },
            };
        });
    }

    const api = { joinRoom, brokerUrl, TOPIC_PREFIX };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { mqttDirect: api });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
