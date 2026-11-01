// Real browser acceptance suite for phone (390px), tablet (820px), desktop and review UX
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const reportDir = path.join(process.cwd(), 'test-results');
fs.mkdirSync(reportDir, { recursive: true });

const report = {
  status: 'PENDING',
  checks: [],
  screenshots: [],
  viewports: {},
  startedAt: new Date().toISOString(),
  target: 'http://127.0.0.1:3124',
};

async function runBrowserAcceptance() {
  let access;
  try {
    const accessJson = execSync('docker exec babytracker-ocr-staging cat /app/env/ocr-staging-access.json', { encoding: 'utf8' });
    access = JSON.parse(accessJson);
  } catch (err) {
    throw new Error(`Failed to read staging credentials from babytracker-ocr-staging container: ${err.message}`);
  }

  const base = 'http://127.0.0.1:3124';
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    // Pre-seed authentication and selected family/baby in localStorage (synthetic credentials only)
    await context.addInitScript(({ token, access }) => {
      localStorage.setItem('authToken', token);
      localStorage.setItem('unlockTime', String(Date.now()));
      localStorage.setItem('caretakerId', access.caretakerId);
      localStorage.setItem('isAdmin', 'true');
      localStorage.setItem('selectedFamily', JSON.stringify({
        id: access.familyId,
        slug: access.familySlug,
        name: 'Synthetic OCR staging',
      }));
      localStorage.setItem(`selectedBaby_${access.familyId}`, JSON.stringify({
        id: access.babyId,
        firstName: 'Synthetic',
        lastName: 'Fixture',
      }));
    }, { token: access.token, access });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const targetUrl = `${base}/${access.familySlug}/ocr-import?babyId=${access.babyId}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // 1. Heading verification
    await page.getByRole('heading', { name: 'Document import', exact: true }).waitFor({ timeout: 10000 });
    report.checks.push('Page rendered "Document import" heading');

    // 2. Workflow stages verification
    const workflow = page.locator('.ocr-workflow');
    await workflow.waitFor({ timeout: 5000 });
    const stageText = await workflow.textContent();
    if (!stageText.includes('Upload source') || !stageText.includes('Review and correct')) {
      throw new Error('Workflow stages (Upload source / Review and correct) missing from DOM');
    }
    report.checks.push('Workflow stages 1-3 visible');

    // 3. Document history dropdown and load saved synthetic fixture
    const historySelect = page.getByRole('combobox', { name: 'Document history' });
    await historySelect.waitFor({ timeout: 5000 });
    report.checks.push('Document history selector available');

    // Select the synthetic document from the history dropdown
    await historySelect.selectOption({ label: 'synthetic-staging-care-log.png · Imported · 10/27/2026' });

    // Verify review heading for saved import
    await page.getByRole('heading', { name: 'Saved import review', exact: true }).waitFor({ timeout: 10000 });
    report.checks.push('Opened saved import review from history');

    // 4. Verify review rows and values
    const event1 = page.locator('article[aria-label="Draft event 1"]');
    await event1.waitFor({ timeout: 5000 });
    const event1Amount = await event1.getByLabel('Feeding amount').inputValue();
    if (event1Amount !== '95') throw new Error(`Expected feed amount 95, got ${event1Amount}`);
    report.checks.push('Row 1 (feed corrected to 95 mL) verified in review list');

    const event2 = page.locator('article[aria-label="Draft event 2"]');
    await event2.waitFor({ timeout: 5000 });
    const event2Diaper = await event2.getByLabel('Diaper type').inputValue();
    if (event2Diaper !== 'WET') throw new Error(`Expected diaper type WET, got ${event2Diaper}`);
    report.checks.push('Row 2 (diaper type WET) verified in review list');

    // Desktop full-page screenshot
    const desktopScreenshot = path.join(reportDir, 'acceptance-desktop.png');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    report.screenshots.push(desktopScreenshot);

    // 5. Tablet Viewport Validation (iPad 820px x 1180px)
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForTimeout(300);

    const tabletScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const tabletInnerWidth = await page.evaluate(() => window.innerWidth);
    const tabletFits = tabletScrollWidth <= tabletInnerWidth + 1;
    report.viewports.tablet = { width: 820, height: 1180, scrollWidth: tabletScrollWidth, innerWidth: tabletInnerWidth, fits: tabletFits };

    if (!tabletFits) {
      throw new Error(`Tablet (820px) horizontally overflows: scrollWidth ${tabletScrollWidth} > innerWidth ${tabletInnerWidth}`);
    }

    // Keyboard focus check on tablet
    await page.keyboard.press('Tab');
    const tabletFocusValid = await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null);
    if (!tabletFocusValid) throw new Error('Keyboard focus unreachable on tablet viewport');

    report.checks.push('Tablet viewport (width 820px) fits without horizontal overflow and keyboard focus is reachable');
    const tabletScreenshot = path.join(reportDir, 'acceptance-tablet.png');
    await page.screenshot({ path: tabletScreenshot, fullPage: true });
    report.screenshots.push(tabletScreenshot);

    // 6. Phone Viewport Validation (iPhone 390px x 844px)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const phoneScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const phoneInnerWidth = await page.evaluate(() => window.innerWidth);
    const phoneFits = phoneScrollWidth <= phoneInnerWidth + 1;
    report.viewports.phone = { width: 390, height: 844, scrollWidth: phoneScrollWidth, innerWidth: phoneInnerWidth, fits: phoneFits };

    if (!phoneFits) {
      throw new Error(`Phone (390px) horizontally overflows: scrollWidth ${phoneScrollWidth} > innerWidth ${phoneInnerWidth}`);
    }

    // Verify touch controls and fields remain accessible in 390px phone layout
    const phoneAmountInput = await event1.getByLabel('Feeding amount');
    await phoneAmountInput.waitFor({ timeout: 5000 });
    const isAmountVisible = await phoneAmountInput.isVisible();
    if (!isAmountVisible) throw new Error('Feeding amount input not visible in phone viewport');

    // Keyboard focus check on phone
    await page.keyboard.press('Tab');
    const phoneFocusValid = await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null);
    if (!phoneFocusValid) throw new Error('Keyboard focus unreachable on phone viewport');

    report.checks.push('Phone viewport (width 390px) fits without horizontal overflow and interactive controls remain accessible');
    const phoneScreenshot = path.join(reportDir, 'acceptance-phone.png');
    await page.screenshot({ path: phoneScreenshot, fullPage: true });
    report.screenshots.push(phoneScreenshot);

    // 7. Verify zero client-side JavaScript errors
    if (pageErrors.length > 0) {
      throw new Error(`Client-side JavaScript exceptions detected: ${pageErrors.join('; ')}`);
    }
    report.checks.push('Zero page/client-side JavaScript exceptions');

    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
  } finally {
    await browser.close();
  }

  const reportFile = path.join(reportDir, 'acceptance-browser-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 'PASS') {
    process.exit(1);
  }
}

runBrowserAcceptance().catch(err => {
  report.status = 'FAIL';
  report.error = err.message;
  report.completedAt = new Date().toISOString();
  const reportFile = path.join(reportDir, 'acceptance-browser-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
