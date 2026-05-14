import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';
import type { Page, Browser } from 'playwright';

export async function checkPerformance(page: Page, url: string, browser: Browser, lang: Lang): Promise<CheckCategory> {
  const items: CheckItem[] = [];

  // Load speed (CWV-aligned: ≤2.5s pass, ≤4s warn, >4s fail)
  const start = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ms = Date.now() - start;
    const sec = (ms / 1000).toFixed(1);
    if (ms <= 2500) items.push({ name: t('item.perf.speed', lang), status: 'pass', message: t('perf.speed.pass', lang, { time: sec }) });
    else if (ms <= 4000) items.push({ name: t('item.perf.speed', lang), status: 'warn', message: t('perf.speed.warn', lang, { time: sec }) });
    else items.push({ name: t('item.perf.speed', lang), status: 'fail', message: t('perf.speed.fail', lang, { time: sec }) });
  } catch {
    items.push({ name: t('item.perf.speed', lang), status: 'fail', message: t('perf.speed.timeout', lang) });
  }

  // Viewport
  let hasViewport = false;
  try {
    hasViewport = await page.evaluate(() => !!document.querySelector('meta[name="viewport"]'));
  } catch { /* page may have navigated */ }
  items.push({ name: t('item.perf.viewport', lang), status: hasViewport ? 'pass' : 'warn', message: t(hasViewport ? 'perf.viewport.pass' : 'perf.viewport.warn', lang) });

  // Mobile test (overflow, small font, heading hierarchy, navigation, touch targets)
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await ctx.newPage();
    await mp.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const mobile = await mp.evaluate(() => {
      // Overflow
      const overflow = document.body.scrollWidth > window.innerWidth;

      // Small font
      const smallFont = Array.from(document.querySelectorAll('p,span,a,li')).some(el => {
        const s = parseFloat(getComputedStyle(el).fontSize);
        return s > 0 && s < 12;
      });

      // Heading hierarchy — detect skipping (e.g., h1 → h4)
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      const headingLevels = headings.map(h => parseInt(h.tagName[1]));
      let headingSkip = false;
      for (let i = 1; i < headingLevels.length; i++) {
        if (headingLevels[i] < headingLevels[i - 1] && headingLevels[i - 1] - headingLevels[i] > 1) {
          headingSkip = true;
          break;
        }
      }

      // Navigation elements
      const hasNav = !!(document.querySelector('nav,[role="navigation"],[class*="nav"],[id*="nav"],[class*="menu"],[id*="menu"]'));

      // Touch target size — count interactive elements < 48px
      const touchTargets = Array.from(document.querySelectorAll('a,button,input,select,[role="button"]'));
      const smallTargets = touchTargets.filter(el => {
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.width < 48) || (r.height > 0 && r.height < 48);
      }).length;
      const smallTargetRatio = touchTargets.length > 0 ? smallTargets / touchTargets.length : 0;

      return { overflow, smallFont, headingSkip, hasNav, smallTargetRatio };
    });

    items.push({ name: t('item.perf.overflow', lang), status: mobile.overflow ? 'warn' : 'pass', message: t(mobile.overflow ? 'perf.overflow.warn' : 'perf.overflow.pass', lang) });
    items.push({ name: t('item.perf.font', lang), status: mobile.smallFont ? 'warn' : 'pass', message: t(mobile.smallFont ? 'perf.font.warn' : 'perf.font.pass', lang) });

    // Heading hierarchy
    items.push({ name: t('item.perf.heading', lang), status: mobile.headingSkip ? 'warn' : 'pass', message: t(mobile.headingSkip ? 'perf.heading.warn' : 'perf.heading.pass', lang) });

    // Navigation
    items.push({ name: t('item.perf.nav', lang), status: mobile.hasNav ? 'pass' : 'warn', message: t(mobile.hasNav ? 'perf.nav.pass' : 'perf.nav.warn', lang) });

    // Touch targets
    items.push({ name: t('item.perf.touch', lang), status: mobile.smallTargetRatio > 0.3 ? 'warn' : 'pass', message: t(mobile.smallTargetRatio > 0.3 ? 'perf.touch.warn' : 'perf.touch.pass', lang, { pct: Math.round(mobile.smallTargetRatio * 100) }) });

    await ctx.close();
  } catch {
    // skip mobile test on failure
  }

  // Popups
  let popups = 0;
  try {
    popups = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="modal"],[class*="popup"],[class*="overlay"],[id*="modal"],[id*="popup"]')).filter(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      }).length;
    });
  } catch {
    // page may have navigated, skip popup detection
  }
  items.push({ name: t('item.perf.popup', lang), status: popups > 0 ? 'warn' : 'pass', message: t(popups > 0 ? 'perf.popup.warn' : 'perf.popup.pass', lang, { count: popups }) });

  return { name: t('cat.performance', lang), items };
}
