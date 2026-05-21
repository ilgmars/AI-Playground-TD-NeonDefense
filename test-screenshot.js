const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const path = require('path');

async function screenshot(url, outputPath, waitMs = 2000) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: outputPath });
  await browser.close();
  console.log(`Screenshot saved: ${outputPath}`);
}

async function main() {
  // Start local server
  const server = spawn('node', ['tools/test-http-server.js', '8765'], {
    cwd: path.join(__dirname),
    stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 500));

  try {
    await screenshot('http://localhost:8765', '/tmp/game-start.png', 1000);
    console.log('Playwright + local server working correctly.');
  } finally {
    server.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
