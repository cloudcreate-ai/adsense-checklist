import { chromium, type Browser, type Page } from 'playwright';
import type { PageSignals } from './detector.js';

export class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Set<import('playwright').BrowserContext> = new Set();

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
    this.contexts.add(context);
    context.on('close', () => this.contexts.delete(context));
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
    this.contexts.add(context);
    context.on('close', () => this.contexts.delete(context));
    return context.newPage();
  }

  async close(): Promise<void> {
    // Close all contexts first to clean up pages
    const contexts = [...this.contexts];
    this.contexts.clear();
    await Promise.all(contexts.map(c => c.close().catch(() => {})));
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

  // Game providers (instgame, gamedistribution, etc.) inject iframe src
  // via JS after domcontentloaded. Wait up to 3s for any visible iframe
  // to populate its src attribute. Returns immediately if already set.
  try {
    await page.waitForFunction(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const f of iframes) {
        const rect = f.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          const src = f.src || f.getAttribute('data-src') || f.getAttribute('data-lazy-src') || '';
          if (src.length > 0) return true;
        }
      }
      return iframes.length === 0; // no iframes, nothing to wait for
    }, { timeout: 3000 });
  } catch {}

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

  const pageInfo = await page.evaluate(() => ({
    description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
    h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim() ?? '').join(' '),
    lang: document.documentElement.getAttribute('lang') ??
          document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content') ??
          'en',
  }));

  const signals: PageSignals = await page.evaluate(() => {
    const AD_DOMAINS = /googlesyndication|doubleclick|adservice|adsense|pagead|adnxs|amazon-adsystem|facebook\.com\/plugins|google\.com\/ads|googletagmanager|googletagservices/i;

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

    // ── Listing page structure signals ──
    // List items: count article, figure, or common card containers
    const listItems = document.querySelectorAll('article, figure, .card, .item, .entry, .post, .game-card, .video-card, .list-item, .result-item').length
      || document.querySelectorAll('ul > li, ol > li').length;

    // Pagination: next/prev links, page numbers, or rel="next"/"prev"
    const hasPagination = !!document.querySelector(
      'a[rel="next"], a[rel="prev"], .pagination, .page-nav, nav[aria-label*="page"], nav[aria-label*="Page"]'
    ) || Array.from(document.querySelectorAll('a')).some(a => {
      const text = a.textContent?.trim().toLowerCase() ?? '';
      return /^(next|previous|prev|page\s*\d+|\d+\s*of\s*\d+|»|‹|›|«)$/.test(text);
    });

    // Categories: section/nav elements with category-like class names
    const hasCategories = !!document.querySelector(
      '.categories, .category-list, .tags, .tag-list, .genres, .genre-list, [class*="category"], [class*="filter"], [class*="sort"]'
    );

    // Search: form elements with search type or search inputs
    const hasSearch = !!document.querySelector(
      'input[type="search"], [role="search"], form[action*="search"], .search-form, .search-box, input[name="q"], input[name="search"], input[name="query"]'
    );

    return {
      iframeCount: visibleIframes.length,
      iframeSrcs,
      canvasCount: document.querySelectorAll('canvas').length,
      articleCount: document.querySelectorAll('article').length,
      textLength: (document.body?.innerText ?? '').replace(/\s+/g, '').length,
      gameLinks,
      videoElementCount: document.querySelectorAll('video').length,
      listItems,
      hasPagination,
      hasCategories,
      hasSearch,
    };
  });

  return { status, content, text, links, linkDetails, navText, footerText, title, url: urlAfterRender, signals, pageInfo };
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

export async function getSitemapFromRobots(origin: string): Promise<string[]> {
  try {
    const resp = await fetch(`${origin}/robots.txt`);
    if (!resp.ok) return [];
    const text = await resp.text();
    const sitemaps: string[] = [];
    for (const line of text.split('\n')) {
      const m = line.trim().match(/^sitemap:\s*(\S+)/i);
      if (m) sitemaps.push(m[1]);
    }
    return sitemaps;
  } catch {
    return [];
  }
}

export async function checkSitemap(origin: string): Promise<boolean> {
  try {
    const resp = await fetch(`${origin}/sitemap.xml`);
    if (resp.ok) return true;
  } catch {}
  const robotsSitemaps = await getSitemapFromRobots(origin);
  return robotsSitemaps.length > 0;
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
  // Try default sitemap location first
  let urls = await fetchSitemapRecursive(`${origin}/sitemap.xml`, seen, 0);
  // Fallback: check robots.txt for Sitemap: directives
  if (urls.length === 0) {
    const robotsSitemaps = await getSitemapFromRobots(origin);
    for (const smUrl of robotsSitemaps) {
      urls.push(...await fetchSitemapRecursive(smUrl, seen, 0));
    }
  }
  return [...new Set(urls)];
}
