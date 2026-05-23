// Lockstep controller — deterministic input exchange.
//
// Every peer simulates the same game from the same seed; only player
// inputs cross the wire. Each input frame contains all inputs for a
// specific tick number. A frame is "complete" once every known peer
// has submitted theirs (including an empty-input heartbeat). The
// game advances tick by tick, draining one complete frame per tick.
//
// Why heartbeats: most ticks have no input. An empty frame is the
// minimum sync packet — it tells the room "I'm at tick F, nothing
// happened". Without it, a quiet peer would stall everyone else.
//
// Pure logic — no DOM, no transport. The wrapping controller (race.js
// for race, coop.js for co-op) handles the wire side.

(function () {
    'use strict';

    const protocol = (typeof require === 'function')
        ? require('./protocol.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.protocol);
    const guardMod = (typeof require === 'function')
        ? require('./guard.js')
        : (typeof window !== 'undefined' && window.NeonMP && window.NeonMP.guard);

    // Tick rate used by Game.update(). We use it only as a divisor for
    // "how many ticks between heartbeats" — see syncEvery option.
    const DEFAULT_HEARTBEAT_TICKS = 30;

    // How many ticks ahead of the slowest peer we let ourselves run
    // before blocking. Bigger window = more latency tolerance but more
    // input lag when a peer stalls. 60 ticks = ~1s at 60fps.
    const DEFAULT_WINDOW = 60;

    // After this many ticks of silence from a peer, they're considered
    // disconnected and dropped from the must-wait set. 600 = ~10s at 60fps.
    const DEFAULT_PEER_TIMEOUT = 600;

    // Cap how many pending frames we'll buffer per peer. A misbehaving
    // peer flooding future frames can't OOM us.
    const DEFAULT_MAX_BUFFER_PER_PEER = 240;

    // opts = {
    //   me:         string nickname (this client's seat)
    //   peers:      string[]      (initial peer set; new peers can join)
    //   send:       (frame) => void
    //   apply:      (frame, fromPeer) => void   (called when frame is committed)
    //   hash:       () => string                (called every syncEvery ticks)
    //   onDesync:   ({tick, mine, others}) => void
    //   onStall:    ({tick, waitingFor:[peer]}) => void  (heartbeat dropped)
    //   window:     number (default 60)
    //   peerTimeout: number (default 600)
    //   syncEvery:  number (default 30)
    //   maxBufferPerPeer: number (default 240)
    //   allowBuildTypes: Set<string> (forwarded to guard)
    //   secret:     string (room HMAC; same as guard)
    // }
    //
    // Returned: { addPeer, removePeer, submitInput, receive, advance,
    //             currentTick, blocked, peers, stop }
    function createLockstep(opts) {
        opts = opts || {};
        const me = String(opts.me || '').slice(0, 32) || 'P0';
        const send = typeof opts.send === 'function' ? opts.send : () => {};
        const apply = typeof opts.apply === 'function' ? opts.apply : () => {};
        const hash = typeof opts.hash === 'function' ? opts.hash : () => '0';
        const onDesync = typeof opts.onDesync === 'function' ? opts.onDesync : null;
        const onStall  = typeof opts.onStall  === 'function' ? opts.onStall  : null;
        const window_ = opts.window != null ? opts.window : DEFAULT_WINDOW;
        const peerTimeout = opts.peerTimeout != null ? opts.peerTimeout : DEFAULT_PEER_TIMEOUT;
        const syncEvery = opts.syncEvery || DEFAULT_HEARTBEAT_TICKS;
        const maxBuffer = opts.maxBufferPerPeer || DEFAULT_MAX_BUFFER_PER_PEER;

        // Guard is local-only — protects against malformed / replayed
        // / out-of-cap frames from the wire. See guard.js.
        const guard = guardMod.createGuard({
            allowBuildTypes: opts.allowBuildTypes,
            secret: opts.secret || null,
            // Frames are lockstep-paced; no token-bucket needed because
            // the rate is naturally bounded by the simulation tick.
            // Tests can override.
            perSec: opts.perSec || 600,
            now: opts.now,
        });

        // peerSet = peers we wait on. Includes us — submitInput() drops
        // ours into the buffer so advance() treats us the same as remotes.
        const peerSet = new Set();
        for (const p of (opts.peers || [])) peerSet.add(String(p));
        peerSet.add(me);

        // pending[peer] = Map<frame, inputs[]>. inputs[] is empty for
        // heartbeats.
        const pending = Object.create(null);
        function pendingFor(peer) {
            if (!pending[peer]) pending[peer] = new Map();
            return pending[peer];
        }
        // Last frame number we've seen from each peer (drives timeouts).
        const lastSeenTick = Object.create(null);
        // hashTable[peer] = Map<tick, hash> — for divergence detection.
        const hashTable = Object.create(null);
        function hashesFor(peer) {
            if (!hashTable[peer]) hashTable[peer] = new Map();
            return hashTable[peer];
        }

        // Local frame counter — the simulation tick we are CURRENTLY at.
        // Inputs submitted apply at currentTick; the room treats them
        // as "what happened this tick".
        let currentTick = 0;
        // My local frame counter going out on the wire. Same value as
        // currentTick at submit-time so peers can drain at the right tick.
        let blocked = false;

        function addPeer(name) {
            const p = String(name);
            if (!peerSet.has(p)) {
                peerSet.add(p);
                // Newcomer starts fresh; they'll heartbeat their own
                // currentTick which we sync to.
            }
        }
        function removePeer(name) {
            const p = String(name);
            peerSet.delete(p);
            delete pending[p];
            delete hashTable[p];
        }

        // submitInput: called by the local UI for each gesture. Inputs
        // are batched into the buffer for currentTick (or just-after if
        // we're already mid-advance). The flush() at advance time sends
        // the whole batch in one frame.
        const localBuffer = [];
        function submitInput(input) {
            const v = protocol.validateInput(input, opts.allowBuildTypes);
            if (!v.ok) return { ok: false, reason: v.reason };
            localBuffer.push(v.input);
            return { ok: true };
        }

        // sendHeartbeat: send my inputs for `tick` (possibly empty). Also
        // includes the snapshot hash on sync ticks for divergence checks.
        function flushFor(tick) {
            const inputs = localBuffer.splice(0, localBuffer.length);
            const frame = { v: protocol.PROTOCOL_VERSION, p: me, f: tick, i: inputs };
            // Record locally so advance() can drain our own input.
            pendingFor(me).set(tick, inputs);
            if (tick % syncEvery === 0) {
                try {
                    const h = hash();
                    if (typeof h === 'string') {
                        frame.hash = h;
                        hashesFor(me).set(tick, h);
                    }
                } catch (_) { /* hash failures shouldn't break sync */ }
            }
            const signed = guard.signFrame ? guard.signFrame(frame) : frame;
            try { send(signed); } catch (_) { /* swallow */ }
            return frame;
        }

        // receive: called by the transport when a peer's frame arrives.
        // We don't apply immediately — we buffer until that tick is
        // ready to commit (advance()).
        function receive(rawFrame, fromId) {
            const r = guard.check(rawFrame);
            if (!r.ok) return r;
            const f = r.frame;
            if (!peerSet.has(f.p)) addPeer(f.p);
            const bucket = pendingFor(f.p);
            // Buffer cap to prevent flood.
            if (bucket.size >= maxBuffer) return { ok: false, reason: 'buffer-full' };
            // Don't accept frames for ticks we've already committed.
            if (f.f < currentTick) return { ok: false, reason: 'past-commit' };
            bucket.set(f.f, f.i);
            lastSeenTick[f.p] = Math.max(lastSeenTick[f.p] || 0, f.f);
            if (typeof f.hash === 'string') {
                hashesFor(f.p).set(f.f, f.hash);
                checkDesyncAt(f.f);
            }
            return { ok: true, frame: f };
        }

        function checkDesyncAt(tick) {
            const mine = hashesFor(me).get(tick);
            if (!mine) return;
            const others = {};
            let mismatch = false;
            for (const peer of peerSet) {
                if (peer === me) continue;
                const h = hashesFor(peer).get(tick);
                if (h == null) continue;
                others[peer] = h;
                if (h !== mine) mismatch = true;
            }
            if (mismatch && onDesync) {
                try { onDesync({ tick, mine, others }); } catch (_) {}
            }
        }

        // advance: try to commit the next tick. Returns true if a tick
        // was committed (apply was called), false if blocked waiting
        // for a peer. The caller (game loop) typically calls this in a
        // while-loop with a max iteration cap so a slow peer doesn't
        // freeze the renderer.
        function advance() {
            // First make sure we've published our own frame for the
            // current tick. flushFor() is idempotent for the local seat:
            // if we already flushed currentTick, pending will already
            // have it and we skip.
            if (!pendingFor(me).has(currentTick)) flushFor(currentTick);

            // Check every required peer for currentTick.
            const missing = [];
            for (const peer of peerSet) {
                if (!pendingFor(peer).has(currentTick)) missing.push(peer);
            }

            if (missing.length > 0) {
                // Garbage-collect any peer that's stale enough to drop.
                const dropped = [];
                for (const peer of missing) {
                    if (peer === me) continue;
                    const last = lastSeenTick[peer] || 0;
                    if (currentTick - last > peerTimeout) dropped.push(peer);
                }
                if (dropped.length > 0) {
                    for (const peer of dropped) removePeer(peer);
                    // Recompute missing without dropped peers and retry once.
                    return advance();
                }
                blocked = true;
                if (onStall) {
                    try { onStall({ tick: currentTick, waitingFor: missing.filter(p => p !== me) }); }
                    catch (_) {}
                }
                return false;
            }

            // All peers present. Drain inputs in a stable peer order so
            // apply() sees the same sequence on every machine.
            const orderedPeers = Array.from(peerSet).sort();
            for (const peer of orderedPeers) {
                const inputs = pendingFor(peer).get(currentTick) || [];
                for (const inp of inputs) {
                    try { apply({ peer, input: inp, tick: currentTick }, peer); }
                    catch (_) { /* swallow; deterministic apply is the caller's contract */ }
                }
                pendingFor(peer).delete(currentTick);
            }

            // Drop hashes for ticks we'll never see again so the table
            // doesn't grow forever.
            for (const peer of orderedPeers) {
                const table = hashesFor(peer);
                if (table.size > 64) {
                    let toDrop = table.size - 64;
                    for (const k of Array.from(table.keys()).sort((a, b) => a - b)) {
                        if (toDrop <= 0) break;
                        table.delete(k); toDrop -= 1;
                    }
                }
            }

            currentTick += 1;
            blocked = false;
            // After advancing, we should publish our next-tick frame so
            // remotes don't stall waiting for us — but only when the
            // localBuffer has something to send OR it's a heartbeat
            // boundary. For low-input games, heartbeating only on
            // sync ticks would mean peers stall for syncEvery between
            // heartbeats; safer to publish every tick.
            flushFor(currentTick);
            return true;
        }

        function stop() {
            // Pending state is per-room; tearing down the room releases
            // GC. Nothing to do here beyond clearing references.
            for (const k in pending) delete pending[k];
            for (const k in hashTable) delete hashTable[k];
            peerSet.clear();
            localBuffer.length = 0;
        }

        return {
            addPeer, removePeer, submitInput, receive, advance, stop,
            flushFor,
            get currentTick() { return currentTick; },
            get blocked() { return blocked; },
            get peers() { return Array.from(peerSet); },
            // Debug-only helpers — exposed for tests.
            _pending: pending,
            _hashes: hashTable,
            _guard: guard,
        };
    }

    const api = {
        createLockstep,
        DEFAULT_HEARTBEAT_TICKS,
        DEFAULT_WINDOW,
        DEFAULT_PEER_TIMEOUT,
    };
    if (typeof window !== 'undefined') {
        window.NeonMP = Object.assign(window.NeonMP || {}, { lockstep: api });
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
