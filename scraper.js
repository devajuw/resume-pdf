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

  // Wait for the PDF link to appear (Overleaf link formats can vary)
  await page.waitForFunction(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.some(a =>
      a.href.includes('output.pdf') || a.href.includes('/download/project')
    );
  }, undefined, { timeout: 90000 });

  // Get the download URL
  const pdfUrl = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const pdfLink =
      links.find(a => a.href.includes('output.pdf')) ||
      links.find(a => a.href.includes('/download/project'));
    return pdfLink ? pdfLink.href : null;
  });

  if (!pdfUrl) {
    console.error('Could not find PDF download link');
    await browser.close();
    process.exit(1);
  }

  console.log('Downloading PDF...');
  const response = await page.request.get(pdfUrl);
  const buffer = await response.body();

  fs.writeFileSync(OUTPUT_FILE, buffer);
  console.log(`Saved ${OUTPUT_FILE}`);

  await browser.close();
})();
