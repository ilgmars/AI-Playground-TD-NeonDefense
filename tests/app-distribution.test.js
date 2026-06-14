// Regression: app-distribution surfaces.
//   1. The backpack "buy" action is labelled BUY ITEM, not the old ominous
//      SALVAGE (button + tooltip + hint).
//   2. The mobile-web "Get the Android app" link shows only in a mobile
//      browser that is NOT the installed APK (pure appDistShouldShowLink).
//   3. The APK in-app update banner reveals only when the live build token
//      is newer than the bundled one and the user hasn't dismissed it
//      (pure appDistIsNewerBuild + appDistEvaluateUpdate), and the DOM
//      wiring (applyUpdateDecision + the dismiss button) behaves.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9760 + Math.floor(Math.random() * 30);
    const server = spawn(process.execPath, ['tests/helpers/http-server.js', String(PORT)],
        { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 600));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
        if (cond) { console.log('ok', name); pass++; }
        else      { console.log('FAIL', name, extra || ''); fail++; }
    }

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);

    // ---- 1) SALVAGE → BUY ITEM rename ----------------------------------
    const rename = await page.evaluate(() => {
        const btn = document.getElementById('bp-salvage');
        return {
            btnText: btn ? btn.textContent.trim() : null,
            title: btn ? (btn.getAttribute('title') || '') : '',
            hint: document.body.innerHTML,
        };
    });
    ok('buy button reads BUY ITEM (not SALVAGE)',
        /BUY ITEM/i.test(rename.btnText) && !/SALVAGE/i.test(rename.btnText),
        JSON.stringify({ t: rename.btnText }));

    // ---- 2) Mobile-web download link visibility ------------------------
    const link = await page.evaluate(() => {
        const el = document.getElementById('get-app-link');
        const f = window.appDistShouldShowLink;
        return {
            exists: !!el,
            hiddenOnDesktop: el ? el.classList.contains('hidden') : null,
            hrefIsApk: el ? /NeonDefense\.apk$/.test(el.getAttribute('href') || '') : false,
            desktop: f({ hostname: 'ilgmars.github.io', ua: 'Mozilla/5.0 (X11; Linux x86_64)', coarse: false }),
            mobileWeb: f({ hostname: 'ilgmars.github.io', ua: 'Mozilla/5.0 (Linux; Android 13) Mobile', coarse: true }),
            insideApk: f({ hostname: 'appassets.androidplatform.net', ua: 'Mozilla/5.0 (Linux; Android 13) Mobile', coarse: true }),
        };
    });
    ok('get-app link element exists with the APK href', link.exists && link.hrefIsApk, JSON.stringify(link));
    ok('link hidden on this (desktop) test browser', link.hiddenOnDesktop === true);
    ok('shouldShowLink: false on desktop', link.desktop === false);
    ok('shouldShowLink: true on mobile web', link.mobileWeb === true);
    ok('shouldShowLink: false inside the APK', link.insideApk === false);

    // ---- 3a) Build-token comparison (pure) -----------------------------
    const cmp = await page.evaluate(() => {
        const n = window.appDistIsNewerBuild;
        return {
            newer: n('20260101000000', '20260601000000'),
            older: n('20260601000000', '20260101000000'),
            equal: n('20260601000000', '20260601000000'),
            missingLocal: n(null, '20260601000000'),
            missingLive: n('20260601000000', undefined),
            garbage: n('abc', 'xyz'),
            zeroLocal: n('0', '20260601000000'),
        };
    });
    ok('isNewerBuild: live newer → true', cmp.newer === true);
    ok('isNewerBuild: live older → false', cmp.older === false);
    ok('isNewerBuild: equal → false', cmp.equal === false);
    ok('isNewerBuild: missing tokens → false', cmp.missingLocal === false && cmp.missingLive === false);
    ok('isNewerBuild: non-numeric → false', cmp.garbage === false);
    // Old APK with no bundled version.json → checkForApkUpdate substitutes '0'
    // for the local token so the update still surfaces.
    ok('isNewerBuild: "0" local (old APK) → true', cmp.zeroLocal === true);

    // ---- 3b) Update decision + banner DOM ------------------------------
    const upd = await page.evaluate(() => {
        const ev = window.appDistEvaluateUpdate;
        const apply = window.applyUpdateDecision;
        const banner = document.getElementById('app-update-banner');

        const hiddenInitially = banner.classList.contains('hidden');

        // Newer, not dismissed → show.
        const dShow = ev({ local: '20260101000000', live: '20260601000000', dismissed: null });
        apply(dShow);
        const shownAfterApply = !banner.classList.contains('hidden');
        const linkHref = document.getElementById('app-update-link').getAttribute('href') || '';

        // Dismiss button hides it and records the live token.
        document.getElementById('app-update-dismiss').click();
        const hiddenAfterDismiss = banner.classList.contains('hidden');
        const stored = localStorage.getItem('neonApkUpdateDismissed');

        // Same version already dismissed → no show.
        const dDismissed = ev({ local: '20260101000000', live: '20260601000000', dismissed: '20260601000000' });

        // Not newer → no show.
        const dSame = ev({ local: '20260601000000', live: '20260601000000', dismissed: null });

        return {
            hiddenInitially, shownAfterApply,
            linkIsApk: /NeonDefense\.apk$/.test(linkHref),
            hiddenAfterDismiss, stored,
            dShow: dShow.show, dDismissed: dDismissed.show, dSame: dSame.show,
        };
    });
    ok('update banner hidden by default', upd.hiddenInitially === true);
    ok('evaluateUpdate: newer & undismissed → show', upd.dShow === true);
    ok('applyUpdateDecision reveals the banner', upd.shownAfterApply === true);
    ok('update link points at the APK', upd.linkIsApk === true);
    ok('dismiss hides the banner', upd.hiddenAfterDismiss === true);
    ok('dismiss records the live build token', upd.stored === '20260601000000', upd.stored);
    ok('evaluateUpdate: already-dismissed version → no show', upd.dDismissed === false);
    ok('evaluateUpdate: same version → no show', upd.dSame === false);

    // ---- 3b2) APK "Download latest" corner link ------------------------
    // In the APK, applyUpdateDecision(decision, inApk=true) also reveals the
    // shared corner link, re-labelled "Download latest", and hides it again
    // when nothing newer exists. inApk is passed explicitly so this is
    // exercisable off-device.
    const dl = await page.evaluate(() => {
        const apply = window.applyUpdateDecision;
        const el = document.getElementById('get-app-link');
        apply({ show: true, liveBuild: '20260601000000' }, true);
        const shown = {
            visible: !el.classList.contains('hidden'),
            text: el.textContent.trim(),
            href: el.getAttribute('href') || '',
        };
        apply({ show: false, liveBuild: '20260601000000' }, true);
        return { shown, hidden: el.classList.contains('hidden') };
    });
    ok('APK update reveals a "Download latest" corner link',
        dl.shown.visible && /download latest/i.test(dl.shown.text) && /NeonDefense\.apk$/.test(dl.shown.href),
        JSON.stringify(dl.shown));
    ok('no newer build → corner link hidden', dl.hidden === true);

    // ---- 3c) checkForApkUpdate is a no-op outside the APK --------------
    const guard = await page.evaluate(async () => {
        const stubFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ build: '29990101000000' }) });
        // On this test host (127.0.0.1) we are NOT the APK → must return false
        // and never reveal the banner, even though the stub reports a newer build.
        document.getElementById('app-update-banner').classList.add('hidden');
        const result = await window.checkForApkUpdate(stubFetch);
        return { result, hidden: document.getElementById('app-update-banner').classList.contains('hidden') };
    });
    ok('checkForApkUpdate: no-op when not running as the APK', guard.result === false && guard.hidden === true,
        JSON.stringify(guard));

    // ---- 4) Multiplayer lobby shows the build/version line -------------
    const mpVer = await page.evaluate(async () => {
        const btn = document.getElementById('menu-multiplayer-btn');
        if (!btn || btn.classList.contains('hidden')) return { skipped: true };
        btn.click();
        // renderMpVersion paints a fallback synchronously then upgrades from
        // version.json — wait for the fetch to resolve.
        await new Promise(r => setTimeout(r, 400));
        return { text: (document.getElementById('mp-version') || {}).textContent || '' };
    });
    ok('MP lobby shows a build/version line',
        !mpVer.skipped && /NEON DEFENSE/.test(mpVer.text) && /v1\.1/.test(mpVer.text) && /build\s+\d{8}/.test(mpVer.text),
        JSON.stringify(mpVer));

    // 4. Main-menu footer: current version + a download link that lights green
    //    when a newer build exists on main (populateMainMenuVersion).
    const mmNew = await page.evaluate(async () => {
        const make = (o) => ({ ok: true, json: async () => o });
        const stub = (url) => String(url).indexOf('raw.githubusercontent') !== -1
            ? Promise.resolve(make({ build: '20990101000000' }))            // live = far future (newer)
            : Promise.resolve(make({ version: '1.1', build: '20000101000000' })); // local = old
        const r = await window.populateMainMenuVersion(stub);
        return { newer: r.newer,
            ver: document.getElementById('mm-version').textContent,
            dlGreen: document.getElementById('mm-download').classList.contains('update') };
    });
    ok('main-menu shows the build as a yymmdd.hhmmss timestamp', /000101\.000000/.test(mmNew.ver), JSON.stringify(mmNew));
    ok('newer build → "update available" + green download link',
        mmNew.newer === true && /update available/.test(mmNew.ver) && mmNew.dlGreen === true, JSON.stringify(mmNew));

    const mmCur = await page.evaluate(async () => {
        const make = (o) => ({ ok: true, json: async () => o });
        const stub = (url) => String(url).indexOf('raw.githubusercontent') !== -1
            ? Promise.resolve(make({ build: '20000101000000' }))            // live == local
            : Promise.resolve(make({ version: '1.1', build: '20000101000000' }));
        const r = await window.populateMainMenuVersion(stub);
        return { newer: r.newer, dlGreen: document.getElementById('mm-download').classList.contains('update') };
    });
    ok('up-to-date build → no update, neutral link', mmCur.newer === false && mmCur.dlGreen === false, JSON.stringify(mmCur));

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nAPP DISTRIBUTION: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
