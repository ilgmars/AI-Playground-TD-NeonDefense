// Regression: the APK WebView blocks all external requests except an
// allowlist in MainActivity.java. Multiplayer loads its transport libraries
// (Trystero + mqtt.js) via dynamic import() from CDNs — if those CDN hosts
// aren't on the allowlist, co-op can't load at all inside the APK (the exact
// "apk mp is not functional" failure: "Trystero library blocked … Failed to
// fetch"). This test fails if a transport CDN host drifts out of the
// allowlist, OR if the interceptor's default-deny shape regresses.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { console.log('ok', name); pass++; }
    else      { console.log('FAIL', name, extra || ''); fail++; }
}

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 1) Hosts the transports load libraries from (https URLs in import()).
const transportSrc =
    read('src/multiplayer/transport-trystero.js') + '\n' +
    read('src/multiplayer/mqtt-direct.js');
const cdnHosts = new Set();
for (const m of transportSrc.matchAll(/https:\/\/([a-zA-Z0-9.-]+)\//g)) {
    cdnHosts.add(m[1].toLowerCase());
}
ok('found the transport CDN hosts', cdnHosts.size >= 2, [...cdnHosts].join(','));

// 2) The APK allowlist (string literals in isAllowedExternalHost()).
const java = read('android/app/src/main/java/com/neondefense/game/MainActivity.java');
const allowMatch = java.match(/isAllowedExternalHost[\s\S]*?String\[\]\s*allow\s*=\s*\{([\s\S]*?)\}/);
ok('isAllowedExternalHost defines an allowlist array', !!allowMatch);
const allow = new Set(
    (allowMatch ? allowMatch[1] : '')
        .split(',')
        .map(s => (s.match(/"([^"]+)"/) || [])[1])
        .filter(Boolean)
        .map(s => s.toLowerCase())
);

// 3) Every transport CDN host must be reachable (exact or sub-domain).
function isAllowed(host) {
    for (const a of allow) {
        if (host === a || host.endsWith('.' + a)) return true;
    }
    return false;
}
for (const h of cdnHosts) {
    ok(`APK allows the MP library CDN: ${h}`, isAllowed(h), `allow={${[...allow].join(',')}}`);
}

// 4) The update manifest host stays allowlisted too.
ok('APK allows the update manifest host (raw.githubusercontent.com)',
    isAllowed('raw.githubusercontent.com'));

// 5) The interceptor keeps its default-deny shape (empty body for other
//    external http/https), so the allowlist is meaningful and we didn't
//    accidentally open the WebView wide.
ok('interceptor still default-denies other external requests',
    /new WebResourceResponse\("text\/plain"[\s\S]*?new byte\[0\]/.test(java));

// 6) appassets (the bundled game) is still served by the asset loader.
ok('appassets still routed to the WebViewAssetLoader',
    /appassets\.androidplatform\.net"\.equals\(host\)[\s\S]*?assetLoader\.shouldInterceptRequest/.test(java));

// 7) The APK build must bundle version.json into assets/www, or the in-app
//    update check's local fetch (./version.json) 404s and the banner can
//    never appear. Guards the exact "it never prompts for update" gap.
const buildYml = read('.github/workflows/build-apk.yml');
ok('build-apk bundles version.json into assets/www',
    /cp\s+version\.json\s+android\/app\/src\/main\/assets\/www\/version\.json/.test(buildYml));

console.log(`\nAPK MP ALLOWLIST: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
