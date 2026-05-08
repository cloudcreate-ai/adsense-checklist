import { chromium, type Browser, type Page } from 'playwright';

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async newPage(): Promise<Page> {
    const browser = await this.launch();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    return context.newPage();
  }

  async newMobilePage(): Promise<Page> {
    const browser = await this.launch();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    return context.newPage();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export async function fetchPage(page: Page, url: string, timeout: number = 30000) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const status = response?.status() ?? 0;
  const content = await page.content();
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => (a as HTMLAnchorElement).href)
      .filter(href => href.startsWith('http'))
  );
  const title = await page.title();

  return { status, content, text, links, title, url };
}

export async function extractLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => (a as HTMLAnchorElement).href)
      .filter(href => href.startsWith('http'))
  );
}

export async function checkRobotsTxt(origin: string): Promise<boolean> {
  try {
    const resp = await fetch(`${origin}/robots.txt`);
    return resp.ok;
  } catch {
    return false;
  }
}

export async function checkSitemap(origin: string): Promise<boolean> {
  try {
    const resp = await fetch(`${origin}/sitemap.xml`);
    return resp.ok;
  } catch {
    return false;
  }
}
