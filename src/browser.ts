import { chromium, type Browser, type Page } from 'playwright';
import type { PageSignals } from './detector.js';

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
  const linkDetails = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .filter(a => (a as HTMLAnchorElement).href.startsWith('http'))
      .map(a => ({
        href: (a as HTMLAnchorElement).href,
        text: a.innerText.trim(),
      }))
  );
  const navText = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    return nav?.innerText ?? '';
  });
  const footerText = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    return footer?.innerText ?? '';
  });
  const title = await page.title();

  const signals: PageSignals = await page.evaluate(() => {
    const AD_DOMAINS = /googlesyndication|doubleclick|adservice|adsense|pagead|adnxs|amazon-adsystem|facebook\.com\/plugins/i;

    const iframes = Array.from(document.querySelectorAll('iframe'));
    const visibleIframes = iframes.filter(f => {
      const rect = f.getBoundingClientRect();
      const style = getComputedStyle(f);
      if (rect.width <= 50 || rect.height <= 50) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const src = f.src || f.getAttribute('data-src') || f.getAttribute('data-lazy-src') || '';
      if (AD_DOMAINS.test(src)) return false;
      return true;
    });
    const iframeSrcs = visibleIframes.map(f =>
      f.src || f.getAttribute('data-src') || f.getAttribute('data-lazy-src') || f.getAttribute('data-lazyloaded-src') || ''
    ).filter(Boolean);

    // Game link patterns (for listing pages without iframes)
    const gameLinkPatterns = /\/(game|play|games)\//i;
    const gameLinks = Array.from(document.querySelectorAll('a[href]')).filter(a =>
      gameLinkPatterns.test((a as HTMLAnchorElement).href)
    ).length;

    return {
      iframeCount: visibleIframes.length,
      iframeSrcs,
      canvasCount: document.querySelectorAll('canvas').length,
      articleCount: document.querySelectorAll('article').length,
      textLength: (document.body?.innerText ?? '').replace(/\s+/g, '').length,
      gameLinks,
    };
  });

  return { status, content, text, links, linkDetails, navText, footerText, title, url, signals };
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

export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  try {
    const resp = await fetch(`${origin}/sitemap.xml`);
    if (!resp.ok) return [];
    const text = await resp.text();
    const matches = text.match(/<loc>(.*?)<\/loc>/g);
    if (!matches) return [];
    return matches
      .map(m => m.replace(/<\/?loc>/g, ''))
      .filter(u => u.startsWith('http'));
  } catch {
    return [];
  }
}
