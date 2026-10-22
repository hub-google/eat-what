/* Real Chromium smoke test for deployed eat-what. No mock restaurant data. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900},locale:'zh-TW'});
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  try {
    await page.goto('https://hub-google.github.io/eat-what/?smoke=' + Date.now(), {waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('.restaurant-card').first().waitFor({timeout:80000});
    const count = await page.locator('.restaurant-card').count();
    assert(count > 0, 'No real FoodRadar restaurants appeared on eat-what');
    const title = await page.locator('#resultCount').innerText();
    assert(Number(title.replace(/,/g,'')) > 0, 'Restaurant count did not render');
    await page.locator('[data-action="details"]').first().click();
    await page.locator('#modal:not([hidden])').waitFor({timeout:12000});
    await page.waitForFunction(() => {
      const el = document.getElementById('menuView');
      return el && !el.textContent.includes('菜單載入中');
    },null,{timeout:60000});
    const description = await page.locator('#menuView').innerText();
    assert(!description.includes('菜單讀取失敗'), 'Live FoodRadar menu failed: ' + description.slice(0,240));
    await page.locator('#modalClose').click();
    await page.locator('#shuffleBtn').click();
    await page.locator('#modal:not([hidden])').waitFor({timeout:10000});
    assert.equal(pageErrors.length, 0, 'Browser JavaScript errors: ' + pageErrors.join('; ').slice(0,500));
    console.log('PASS: live Chromium rendered ' + count + ' restaurant cards, opened live menu, random selection works.');
  } finally {
    await browser.close();
  }
})().catch(err => {console.error('FAIL:',err.message);process.exitCode=1;});
