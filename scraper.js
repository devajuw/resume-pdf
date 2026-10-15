const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OVERLEAF_URL = process.env.OVERLEAF_URL; // we will set this later
const OUTPUT_FILE = 'resume.pdf';

(async () => {
  if (!OVERLEAF_URL) {
    console.error('OVERLEAF_URL is missing');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening Overleaf share link...');
  await page.goto(OVERLEAF_URL, {
    waitUntil: 'networkidle',
    timeout: 90000
  });

  // Wait briefly for dynamically rendered download links to appear.
  try {
    await page.waitForFunction(() => {
      const elements = Array.from(document.querySelectorAll('[href], [data-href]'));
      return elements.some(element => {
        const raw =
          element.getAttribute('href') ||
          element.getAttribute('data-href') ||
          '';
        const value = raw.toLowerCase();
        return (
          value.includes('output.pdf') ||
          value.includes('/download/project') ||
          (value.includes('/download') && value.includes('pdf'))
        );
      });
    }, undefined, { timeout: 30000 });
  } catch {
    // Continue with fallback URL even if no page link appears in time.
  }

  // Get the download URL from the page if available.
  const pagePdfUrl = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('[href], [data-href]'));
    const pdfLink = elements.find(element => {
      const raw =
        element.getAttribute('href') ||
        element.getAttribute('data-href') ||
        '';
      const href = raw.toLowerCase();
      const text = (element.textContent || '').toLowerCase();
      return (
        href.includes('output.pdf') ||
        href.includes('/download/project') ||
        href.includes('.pdf') ||
        (href.includes('/download') && (href.includes('pdf') || text.includes('pdf')))
      );
    });
    if (!pdfLink) return null;

    const raw =
      pdfLink.getAttribute('href') ||
      pdfLink.getAttribute('data-href') ||
      '';
    return new URL(raw, window.location.origin).href;
  });

  const fallbackPdfUrl = `${OVERLEAF_URL.replace(/\/$/, '')}.pdf`;
  const candidateUrls = [...new Set([pagePdfUrl, fallbackPdfUrl].filter(Boolean))];

  let buffer = null;
  for (const candidateUrl of candidateUrls) {
    const response = await page.request.get(candidateUrl);
    const body = await response.body();
    const contentType = response.headers()['content-type'] || '';
    const isPdf = contentType.includes('application/pdf') || body.subarray(0, 4).toString() === '%PDF';

    if (response.ok() && isPdf) {
      buffer = body;
      break;
    }
  }

  if (!buffer) {
    console.error('Could not download PDF from any known URL');
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_FILE, buffer);
  console.log(`Saved ${OUTPUT_FILE}`);

  await browser.close();
})();
