// Regression: RESET SAVE requires typing "delete all progress".
// A yes/no confirm() was one mis-tap away from wiping hundreds of
// hours of progression; the typed phrase makes destruction deliberate.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
    const PORT = 9420 + Math.floor(Math.random() * 60);
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

    // Seed recognizable progress.
    await page.evaluate(() => { save.metaXP = 54321; NeonSave.write(save); });

    // 1) Cancelled prompt → nothing deleted.
    page.once('dialog', d => d.dismiss());
    await page.click('#menu-reset-btn');
    await page.waitForTimeout(200);
    const afterCancel = await page.evaluate(() => save.metaXP);
    ok('cancelling the prompt deletes nothing', afterCancel === 54321, afterCancel);

    // 2) Wrong phrase → nothing deleted (an alert explains).
    const dialogs = [];
    const onDialog = d => {
        dialogs.push(d.type());
        if (d.type() === 'prompt') d.accept('delete everything');   // wrong words
        else d.accept();                                            // the alert
    };
    page.on('dialog', onDialog);
    await page.click('#menu-reset-btn');
    await page.waitForTimeout(300);
    page.off('dialog', onDialog);
    const afterWrong = await page.evaluate(() => save.metaXP);
    ok('wrong phrase deletes nothing', afterWrong === 54321, afterWrong);
    ok('wrong phrase shows an explanatory alert', dialogs.includes('alert'), dialogs.join(','));

    // 3) Correct phrase (case/space tolerant) → save wiped + fresh boot.
    page.on('dialog', d => d.accept('  Delete ALL Progress  '));
    await page.click('#menu-reset-btn');
    await page.waitForTimeout(1200);                 // location.reload()
    const afterReset = await page.evaluate(() =>
        (typeof save !== 'undefined') ? save.metaXP : null);
    ok('correct phrase resets the save (fresh metaXP, not 54321)',
        afterReset !== null && afterReset !== 54321, afterReset);

    ok('no JS errors', errs.length === 0, errs.join(' / '));

    await browser.close();
    server.kill();
    console.log(`\nRESET SAVE CONFIRM: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
