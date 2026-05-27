// Regression: explicit 'go' start broadcast ensures BOTH coop peers
// exit the waitroom even if one missed the partner's final READY.
//
// User report: "MP failed to start together". The earlier handshake
// relied on each peer's local "all ready" detection. On a flaky
// channel, one peer's final wr might be lost — partner stayed
// stuck in the waitroom while the first peer moved to the run.
//
// Fix: when local tryStart sees all peers ready, broadcast a 'go'
// packet (3 redundant copies). The receiver of 'go' immediately
// closes the waitroom regardless of their local view.
//
// This is a node-level logic test of the contract.

'use strict';

const transport = require('../src/multiplayer/transport.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

// Tiny simulator: each peer has a `peers` map + a `finish` flag.
// onMessage handles 'go' by setting all peers ready + flipping
// finish=true (mirror of the production handler).
function makePeer(roomPeer, nick) {
    const ctx = {
        nick,
        peers: new Map([[nick, false]]),
        finished: false,
        meReady: false,
    };
    roomPeer.onMessage((msg) => {
        if (!msg) return;
        if (msg.kind === 'go') {
            for (const k of ctx.peers.keys()) ctx.peers.set(k, true);
            ctx.finished = true;
            return;
        }
        if (msg.kind !== 'wr') return;
        if (typeof msg.p !== 'string' || msg.p === nick) return;
        ctx.peers.set(msg.p, !!msg.ready);
        // Local tryStart: if all peers ready, broadcast 'go' + finish.
        const all = Array.from(ctx.peers.values()).every(v => v) &&
                    ctx.peers.size >= 2;
        if (all) {
            roomPeer.send({ kind: 'go', t: Date.now() });
            ctx.finished = true;
        }
    });
    ctx.ready = () => {
        ctx.meReady = true;
        ctx.peers.set(nick, true);
        roomPeer.send({ kind: 'wr', p: nick, ready: true });
        // Local tryStart after our own ready (covers the "we're both
        // already ready when our wr arrives" case).
        const all = Array.from(ctx.peers.values()).every(v => v) &&
                    ctx.peers.size >= 2;
        if (all) {
            roomPeer.send({ kind: 'go', t: Date.now() });
            ctx.finished = true;
        }
    };
    return ctx;
}

// ── 1) Happy path: both peers ready in order, both finish ───────────
{
    const hub = transport.createMockHub();
    const aPeer = hub.join('R1', 'A');
    const bPeer = hub.join('R1', 'B');
    const A = makePeer(aPeer, 'A');
    const B = makePeer(bPeer, 'B');
    // Each peer learns about the other before clicking ready.
    aPeer.send({ kind: 'wr', p: 'A', ready: false });
    bPeer.send({ kind: 'wr', p: 'B', ready: false });
    // Click ready in order.
    A.ready();
    B.ready();
    ok('happy: A finished', A.finished === true);
    ok('happy: B finished', B.finished === true);
}

// ── 2) B's final wr is dropped, but A's 'go' rescues them ───────────
{
    const hub = transport.createMockHub();
    const aPeer = hub.join('R2', 'A');
    const bPeer = hub.join('R2', 'B');
    const A = makePeer(aPeer, 'A');
    const B = makePeer(bPeer, 'B');
    // Both discover each other.
    aPeer.send({ kind: 'wr', p: 'A', ready: false });
    bPeer.send({ kind: 'wr', p: 'B', ready: false });
    // A clicks ready first.
    A.ready();
    // Simulate B's wr being dropped on the wire — patch send.
    const origSend = bPeer.send.bind(bPeer);
    let blockNext = true;
    bPeer.send = (msg) => {
        if (blockNext && msg.kind === 'wr') {
            blockNext = false;
            return;  // dropped
        }
        origSend(msg);
    };
    // B clicks ready — wr packet is dropped. Local tryStart on B
    // STILL fires because B's own peer map has A=true and B=true
    // (set synchronously in ready()). So B finishes + broadcasts 'go'.
    B.ready();
    ok('B finished locally despite lost wr',  B.finished === true);
    // B.ready() broadcasts wr (dropped) then a 'go' (not dropped).
    // A receives 'go' synchronously and also finishes.
    ok('A finishes from B\'s go broadcast after wr was dropped',
       A.finished === true);
    bPeer.send = origSend;
}

// ── 3) 'go' broadcast received before any wr — defensive ────────────
{
    const hub = transport.createMockHub();
    const aPeer = hub.join('R3', 'A');
    const bPeer = hub.join('R3', 'B');
    const B = makePeer(bPeer, 'B');
    // B receives a 'go' out of the blue. Should still finish.
    aPeer.send({ kind: 'go', t: Date.now() });
    ok('B finishes on bare go even without prior wr',
       B.finished === true);
}

console.log(`\nCOOP START HANDSHAKE: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
