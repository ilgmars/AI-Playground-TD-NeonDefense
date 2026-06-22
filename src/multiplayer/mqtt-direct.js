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

    // Broker candidates, in order: every configured relay URL (same
    // source the Trystero MQTT strategy uses — window.__neonMqttRelayUrls
    // populated by tools/install-turn-config.sh from .credentials),
    // then the public EMQX broker as a last resort. joinRoom walks the
    // list so a single broker outage degrades to the public broker
    // instead of dumping the peer onto the Trystero fallback — which
    // is a SEPARATE network that mqtt-direct peers can't see
    // (split-brain: that peer's scores become invisible to everyone
    // on MQTT and vice versa).
    function brokerUrls() {
        const urls = [];
        if (typeof window !== 'undefined' && Array.isArray(window.__neonMqttRelayUrls)) {
            for (const u of window.__neonMqttRelayUrls) {
                if (typeof u === 'string' && u) urls.push(u);
            }
        }
        // Self-hosted broker configured → use ONLY it (drop the public trackers).
        // The public EMQX broker remains the fallback ONLY when no self-hosted
        // relay URL is set, i.e. local dev / CI with an empty config bundle.
        if (urls.length === 0) {
            const httpOrigin = typeof location !== 'undefined' && location.protocol === 'http:';
            urls.push(httpOrigin
                ? 'ws://broker.emqx.io:8083/mqtt'
                : 'wss://broker.emqx.io:8084/mqtt');
        }
        return urls;
    }
    function brokerUrl() { return brokerUrls()[0]; }

    // Generate a stable-per-session peer id. We use native Math.random
    // even when the page reseeded Math.random for coop determinism
    // (window.__neonNativeRandom is set by the pre-boot script in
    // index.html for exactly this reason).
    function freshPeerId() {
        const rand = (typeof window !== 'undefined' && window.__neonNativeRandom) || Math.random;
        return 'p-' + Math.floor(rand() * 1e9).toString(36) + Math.floor(rand() * 1e9).toString(36);
    }

    // Per-broker connect timeout. mqtt.js retries forever on its own
    // (reconnectPeriod); this bounds how long we wait before moving
    // to the next broker in the candidate list.
    const CONNECT_TIMEOUT_MS = 7000;

    // joinRoom: opens a connection to the broker, subscribes to the
    // room topic, and returns the wrapper. Connection lives for the
    // tab's lifetime; .leave() unsubscribes and disconnects.
    // Walks the brokerUrls() candidates; rejects only when ALL fail.
    async function joinRoom(roomCode) {
        const mqtt = await loadMqtt();
        let lastErr = null;
        for (const url of brokerUrls()) {
            try {
                return await connectTo(mqtt, url, roomCode);
            } catch (e) { lastErr = e; }
        }
        throw (lastErr || new Error('mqtt-direct: no broker reachable'));
    }

    function connectTo(mqtt, url, roomCode) {
        const peerId = freshPeerId();
        const topic  = TOPIC_PREFIX + '/' + roomCode;
        const presenceTopic = TOPIC_PREFIX + '/' + roomCode + '/presence';
        // Retained board topic — the broker stores the LAST message
        // published here (retain: true) and hands it to every new
        // subscriber immediately. That's what lets a player see scores
        // from peers who are no longer online: the last board snapshot
        // outlives its publisher.
        const retainedTopic = TOPIC_PREFIX + '/' + roomCode + '/board';

        return new Promise((resolve, reject) => {
            let settled = false;
            const connectTimer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { client.end(true); } catch (_) {}
                    reject(new Error('mqtt-direct: connect timeout ' + url));
                }
            }, CONNECT_TIMEOUT_MS);
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
            // Messages that arrive before the caller registers its
            // first onMessage listener. The broker delivers RETAINED
            // messages immediately on subscribe — i.e. before joinRoom
            // even resolves — so without this buffer the retained board
            // snapshot lands in a listenerless room and is silently
            // dropped. Bounded so a flood can't grow it unchecked.
            const preListenerBuf = [];
            const PRE_LISTENER_BUF_MAX = 32;
            function deliver(msg, fromId) {
                if (msgListeners.length === 0) {
                    if (preListenerBuf.length < PRE_LISTENER_BUF_MAX) {
                        preListenerBuf.push({ msg, fromId });
                    }
                    return;
                }
                for (const fn of msgListeners) {
                    try { fn(msg, fromId); } catch (_) {}
                }
            }

            client.on('connect', () => {
                client.subscribe(topic);
                client.subscribe(presenceTopic);
                client.subscribe(retainedTopic);
                // Announce ourselves so peers already in the room
                // emit their join callback for us.
                client.publish(presenceTopic, JSON.stringify({ k: 'hello', p: peerId }));
                if (!settled) {
                    settled = true;
                    clearTimeout(connectTimer);
                    resolve(wrapper);
                }
            });
            client.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(connectTimer);
                    try { client.end(true); } catch (_) {}
                    reject(err);
                }
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
                if ((topicIn === topic || topicIn === retainedTopic)
                        && payload.p !== peerId && payload.msg) {
                    // Retained-topic deliveries look like ordinary
                    // messages from the original publisher's peer id —
                    // a retained board from a previous session carries
                    // that session's id, which is fine: receivers merge
                    // idempotently.
                    deliver(payload.msg, payload.p);
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
                // Publish msg as the room's RETAINED board snapshot.
                // The broker keeps only the latest; every future
                // subscriber receives it on join even if no other
                // peer is online. Callers must send a merged superset
                // (the global board does — it merges inbound retained
                // state before its first broadcast).
                sendRetained(msg) {
                    if (left) return;
                    if (!msg || typeof msg !== 'object') return;
                    try {
                        client.publish(retainedTopic,
                            JSON.stringify({ p: peerId, msg }),
                            { retain: true, qos: 0 });
                    } catch (_) {}
                },
                onMessage(fn) {
                    msgListeners.push(fn);
                    // Flush anything that arrived before the first
                    // listener (typically the retained board snapshot).
                    // Async so the caller finishes wiring before the
                    // backlog replays.
                    if (preListenerBuf.length > 0) {
                        const backlog = preListenerBuf.splice(0);
                        queueMicrotask(() => {
                            for (const item of backlog) deliver(item.msg, item.fromId);
                        });
                    }
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

    const api = { joinRoom, brokerUrl, brokerUrls, TOPIC_PREFIX };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { mqttDirect: api });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
