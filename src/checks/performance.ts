import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';
import type { Page, Browser } from 'playwright';

export async function checkPerformance(page: Page, url: string, browser: Browser, lang: Lang): Promise<CheckCategory> {
  const items: CheckItem[] = [];

  // Load speed
  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ms = Date.now() - start;
    const sec = (ms / 1000).toFixed(1);
    if (ms < 3000) items.push({ name: t('item.perf.speed', lang), status: 'pass', message: t('perf.speed.pass', lang, { time: sec }) });
    else if (ms < 6000) items.push({ name: t('item.perf.speed', lang), status: 'warn', message: t('perf.speed.warn', lang, { time: sec }) });
    else items.push({ name: t('item.perf.speed', lang), status: 'fail', message: t('perf.speed.fail', lang, { time: sec }) });
  } catch {
    items.push({ name: t('item.perf.speed', lang), status: 'fail', message: t('perf.speed.timeout', lang) });
  }

  // Viewport
  const hasViewport = await page.evaluate(() => !!document.querySelector('meta[name="viewport"]'));
  items.push({ name: 'Viewport', status: hasViewport ? 'pass' : 'warn', message: t(hasViewport ? 'perf.viewport.pass' : 'perf.viewport.warn', lang) });

  // Mobile test
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await ctx.newPage();
    await mp.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const mobile = await mp.evaluate(() => ({
      overflow: document.body.scrollWidth > window.innerWidth,
      smallFont: Array.from(document.querySelectorAll('p,span,a,li')).some(el => { const s = parseFloat(getComputedStyle(el).fontSize); return s > 0 && s < 12; }),
    }));
    items.push({ name: t('item.perf.overflow', lang), status: mobile.overflow ? 'warn' : 'pass', message: t(mobile.overflow ? 'perf.overflow.warn' : 'perf.overflow.pass', lang) });
    items.push({ name: t('item.perf.font', lang), status: mobile.smallFont ? 'warn' : 'pass', message: t(mobile.smallFont ? 'perf.font.warn' : 'perf.font.pass', lang) });
    await ctx.close();
  } catch {
    // skip mobile test on failure
  }

  // Popups
  const popups = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="modal"],[class*="popup"],[class*="overlay"],[id*="modal"],[id*="popup"]')).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }).length;
  });
  items.push({ name: t('item.perf.popup', lang), status: popups > 0 ? 'warn' : 'pass', message: t(popups > 0 ? 'perf.popup.warn' : 'perf.popup.pass', lang, { count: popups }) });

  return { name: t('cat.performance', lang), items };
}
