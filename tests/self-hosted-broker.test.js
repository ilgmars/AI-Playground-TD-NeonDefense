// Regression: when a self-hosted MQTT broker is configured (its wss:// URL in
// window.__neonMqttRelayUrls, baked from the NEON_TURN_CONFIG secret), the
// game must talk to ONLY that broker and drop the public trackers — no public
// EMQX fallback (scoreboard transport) and no public Nostr fallback (Trystero
// coop signaling). With NO broker configured (local dev / CI empty bundle) the
// public fallbacks stay so peers can still find each other.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9760 + Math.floor(Math.random() * 40);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    let pass = 0, fail = 0;
    const ok = (n, c, x) => { if (c) { console.log('ok', n); pass++; } else { console.log('FAIL', n, x || ''); fail++; } };

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Collect which Trystero strategies joinRoom *attempts* (the 'try-strategy'
    // status fires before any CDN load, so this works offline).
    const probe = async (relayUrls) => page.evaluate(async (relayUrls) => {
        window.__neonMqttRelayUrls = relayUrls;
        const D = window.NeonMP.mqttDirect;
        const brokers = D.brokerUrls();
        const strategies = [];
        try {
            const p = window.NeonMP.trystero.joinRoom('TESTRM', 'peer-' + Math.random(), {
                onStatus: (e) => { if (e && e.kind === 'try-strategy') strategies.push(e.strategy); },
            });
            // Don't await fully — CDN may be blocked; try-strategy already fired.
            await Promise.race([p.catch(() => {}), new Promise(r => setTimeout(r, 1200))]);
        } catch (_) { /* ignore */ }
        return { brokers, strategies };
    }, relayUrls);

    // 1) Self-hosted broker configured → ONLY it.
    const self = await probe(['wss://broker.example.test:443/mqtt']);
    ok('scoreboard broker = self-hosted only (no public EMQX appended)',
        self.brokers.length === 1 && self.brokers[0] === 'wss://broker.example.test:443/mqtt',
        JSON.stringify(self.brokers));
    ok('no public EMQX in broker list', !self.brokers.some(u => /emqx/i.test(u)), JSON.stringify(self.brokers));
    ok('coop signaling uses mqtt only (Nostr tracker dropped)',
        self.strategies.length > 0 && self.strategies.every(s => s === 'mqtt') && !self.strategies.includes('nostr'),
        JSON.stringify(self.strategies));

    // 2) No broker configured → public fallbacks remain (dev/CI safety net).
    const none = await probe([]);
    ok('empty config falls back to public EMQX', none.brokers.some(u => /emqx/i.test(u)), JSON.stringify(none.brokers));
    ok('empty config keeps Nostr fallback strategy', none.strategies.includes('nostr'), JSON.stringify(none.strategies));

    ok('no JS errors', errs.length === 0, errs.join(' / '));
    await browser.close();
    server.kill();
    console.log(`\nSELF-HOSTED BROKER: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
