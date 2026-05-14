import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';
import { checkRobotsTxt, checkSitemap, getSitemapFromRobots } from '../browser.js';

export async function checkSiteStructure(
  origin: string, links: string[], h1Count: number, deadLinks: string[] = [], lang: Lang
): Promise<CheckCategory> {
  const items: CheckItem[] = [];

  if (h1Count === 1) items.push({ name: 'H1', status: 'pass', message: t('structure.h1.pass', lang) });
  else if (h1Count === 0) items.push({ name: 'H1', status: 'warn', message: t('structure.h1.warn_none', lang) });
  else items.push({ name: 'H1', status: 'warn', message: t('structure.h1.warn_multi', lang, { count: h1Count }) });

  const hasRobots = await checkRobotsTxt(origin);
  items.push({ name: 'robots.txt', status: hasRobots ? 'pass' : 'warn', message: t(hasRobots ? 'structure.robots.pass' : 'structure.robots.warn', lang) });

  // Sitemap: try /sitemap.xml first, then fallback to robots.txt
  const hasSitemap = await checkSitemap(origin);
  const robotsSitemaps = await getSitemapFromRobots(origin);
  const sitemapViaRobots = robotsSitemaps.length > 0;
  if (hasSitemap && !sitemapViaRobots) {
    items.push({ name: 'sitemap.xml', status: 'pass', message: t('structure.sitemap.pass', lang) });
  } else if (hasSitemap && sitemapViaRobots) {
    items.push({ name: 'sitemap.xml', status: 'pass', message: t('structure.sitemap.pass_via_robots', lang, { count: robotsSitemaps.length }) });
  } else {
    items.push({ name: 'sitemap.xml', status: 'warn', message: t('structure.sitemap.warn', lang) });
  }

  const internal = links.filter(l => { try { return new URL(l).origin === origin; } catch { return false; } });
  items.push({ name: t('item.structure.internal', lang), status: internal.length >= 5 ? 'pass' : 'warn', message: t(internal.length >= 5 ? 'structure.links.pass' : 'structure.links.warn', lang, { count: internal.length }) });

  items.push({ name: t('item.structure.deadlinks', lang), status: deadLinks.length > 3 ? 'fail' : deadLinks.length > 0 ? 'warn' : 'pass', message: t(deadLinks.length > 3 ? 'structure.deadlinks.fail' : deadLinks.length > 0 ? 'structure.deadlinks.warn' : 'structure.deadlinks.pass', lang, { count: deadLinks.length }), detailList: deadLinks.length > 0 ? deadLinks : undefined });

  return { name: t('cat.structure', lang), items };
}
