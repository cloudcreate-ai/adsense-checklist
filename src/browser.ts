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
  // Wait for full render: domcontentloaded + networkidle covers SSR and SPA navigation
  // including client-side querystring-based routing (e.g. search results pages)
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const status = response?.status() ?? 0;

  // Always wait for network idle to ensure SPA has finished rendering,
  // then extra time for any remaining JS updates
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {}

  const urlAfterRender = page.url();

  // Small buffer after networkidle to let any final JS settle
  await page.waitForTimeout(500);

  let text = await page.evaluate(() => document.body?.innerText ?? '');

  const content = await page.content();
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
        text: (a as HTMLAnchorElement).innerText?.trim() ?? '',
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

  const metaInfo = await page.evaluate(() => ({
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
    h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim() ?? '').join(' '),
  }));

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
      videoElementCount: document.querySelectorAll('video').length,
    };
  });

  return { status, content, text, links, linkDetails, navText, footerText, title, url: urlAfterRender, signals, metaInfo };
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

// Technical/non-content URL patterns to exclude from crawling
const NON_CONTENT_EXTENSIONS = /\.(xml|txt|json|pdf|zip|tar|gz|rar|exe|dmg|apk|css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i;
const NON_CONTENT_PATHS = /^(\/(ads\.txt|robots\.txt|sitemap\.xml|favicon\.ico|manifest\.json|sw\.js|service-worker\.js|humans\.txt|security\.txt|\.well-known))/i;

export function isContentUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    if (NON_CONTENT_EXTENSIONS.test(pathname)) return false;
    if (NON_CONTENT_PATHS.test(pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

const MAX_SITEMAP_DEPTH = 3;

async function fetchSitemapRecursive(
  sitemapUrl: string,
  seen: Set<string>,
  depth: number
): Promise<string[]> {
  if (depth > MAX_SITEMAP_DEPTH) return [];
  const norm = sitemapUrl.replace(/\/+$/, '');
  if (seen.has(norm)) return [];
  seen.add(norm);

  try {
    const resp = await fetch(sitemapUrl);
    if (!resp.ok) return [];
    const text = await resp.text();

    // Check if this is a sitemap index (contains <sitemap> tags)
    const sitemapRefs = text.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
    if (sitemapRefs && depth < MAX_SITEMAP_DEPTH) {
      const childUrls: string[] = [];
      for (const ref of sitemapRefs) {
        const locMatch = ref.match(/<loc>(.*?)<\/loc>/);
        if (locMatch && locMatch[1].startsWith('http')) {
          childUrls.push(locMatch[1]);
        }
      }
      const results = await Promise.all(
        childUrls.map(u => fetchSitemapRecursive(u, seen, depth + 1))
      );
      return results.flat();
    }

    // Regular sitemap: extract <loc> entries
    const matches = text.match(/<loc>(.*?)<\/loc>/g);
    if (!matches) return [];
    return matches
      .map(m => m.replace(/<\/?loc>/g, ''))
      .filter(u => u.startsWith('http'));
  } catch {
    return [];
  }
}

export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const seen = new Set<string>();
  const urls = await fetchSitemapRecursive(`${origin}/sitemap.xml`, seen, 0);
  return [...new Set(urls)];
}
