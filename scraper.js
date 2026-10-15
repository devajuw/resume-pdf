const { chromium } = require('playwright');
const fs = require('fs');

const OVERLEAF_URL = process.env.OVERLEAF_URL;
const OUTPUT_FILE = 'resume.pdf';

(async () => {
  if (!OVERLEAF_URL) {
    console.error('OVERLEAF_URL is missing');
    process.exit(1);
  }

  // Use a realistic User-Agent and hide automation flags to reduce Cloudflare blocks
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptDownloads: true
  });

  const page = await context.newPage();
  let pdfBuffer = null;

  // Strategy 1: Automatically capture the PDF response when Overleaf's viewer fetches it
  page.on('response', async (response) => {
    try {
      const contentType = response.headers()['content-type'] || '';
      const url = response.url();
      if (
        response.ok() &&
        (contentType.includes('application/pdf') || url.includes('output.pdf'))
      ) {
        const body = await response.body();
        if (body.subarray(0, 4).toString() === '%PDF') {
          console.log('Intercepted compiled PDF from network stream!');
          pdfBuffer = body;
        }
      }
    } catch (err) {
      // Ignore bodies from redirected/closed requests
    }
  });

  console.log('Opening Overleaf share link...');
  await page.goto(OVERLEAF_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  const title = await page.title();
  console.log(`Page loaded with title: "${title}"`);

  // Check if Cloudflare blocked the GitHub Actions runner
  if (title.includes('Just a moment') || title.includes('Attention Required')) {
    console.error(
      'Blocked by Cloudflare bot protection! Overleaf is blocking headless access from this IP.'
    );
    await browser.close();
    process.exit(1);
  }

  // Wait up to 45 seconds for Overleaf to finish compiling and streaming the PDF
  console.log('Waiting for Overleaf to compile the PDF...');
  for (let i = 0; i < 45; i++) {
    if (pdfBuffer) break;
    await page.waitForTimeout(1000);
  }

  // Strategy 2: Fallback to clicking the Download PDF button in the UI
  if (!pdfBuffer) {
    console.log('Network intercept did not catch PDF. Trying UI download button...');
    try {
      const downloadSelector =
        'a[aria-label="Download PDF"], a[href*="output.pdf"], .fa-download';
      await page.waitForSelector(downloadSelector, { timeout: 15000 });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.locator(downloadSelector).first().click()
      ]);

      await download.saveAs(OUTPUT_FILE);
      console.log(`Saved ${OUTPUT_FILE} via browser download event!`);
      await browser.close();
      return;
    } catch (err) {
      console.warn('UI download button fallback failed:', err.message);
    }
  }

  if (!pdfBuffer) {
    // Save a screenshot so you can inspect what went wrong in GitHub Actions artifacts
    await page.screenshot({ path: 'debug-error.png', fullPage: true });
    console.error('Could not download PDF. Saved debug-error.png for inspection.');
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_FILE, pdfBuffer);
  console.log(`Saved ${OUTPUT_FILE} (${pdfBuffer.length} bytes)`);

  await browser.close();
})();
