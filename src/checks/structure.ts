import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';
import { checkRobotsTxt, checkSitemap, getSitemapFromRobots } from '../browser.js';

export async function checkSiteStructure(
  origin: string, links: string[], h1Count: number,
  deadLinks: Array<{ url: string; status: string }> = [], lang: Lang
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

  // Dead links: ratio-based — ≥20% of total links → warn
  const totalLinks = links.length;
  const deadCount = deadLinks.length;
  const deadRatio = totalLinks > 0 ? deadCount / totalLinks : 0;
  const status4xx = deadLinks.filter(d => d.status.startsWith('4'));
  const status5xx = deadLinks.filter(d => d.status.startsWith('5'));
  const statusTimeout = deadLinks.filter(d => d.status === 'timeout');
  const allDetailList = deadLinks.map(d => `${d.url} (${d.status})`);

  // Combined navigation check: internal link count + dead link status
  if (deadCount > 0) {
    items.push({
      name: t('item.structure.internal', lang),
      status: deadRatio >= 0.2 ? 'warn' : internal.length >= 5 ? 'pass' : 'warn',
      message: t(internal.length >= 5 ? 'structure.links.pass' : 'structure.links.warn', lang, { count: internal.length }),
      detailList: [`${deadCount} dead links detected (${deadRatio >= 0.2 ? 'excessive' : 'acceptable'}): ${deadCount}×4xx=${status4xx.length}, 5xx=${status5xx.length}, timeout=${statusTimeout.length}`],
    });
  } else {
    items.push({
      name: t('item.structure.internal', lang),
      status: internal.length >= 5 ? 'pass' : 'warn',
      message: t(internal.length >= 5 ? 'structure.links.pass' : 'structure.links.warn', lang, { count: internal.length }),
    });
  }

  // Dead links check (only show details, not duplicate count)
  if (deadRatio >= 0.2) {
    items.push({
      name: t('item.structure.deadlinks', lang),
      status: 'warn',
      message: t('structure.deadlinks.warn', lang, { count: deadCount, total: totalLinks, pct: Math.round(deadRatio * 100), c4xx: status4xx.length, c5xx: status5xx.length, ctimeout: statusTimeout.length }),
      detailList: allDetailList,
    });
  } else if (deadCount > 0) {
    items.push({
      name: t('item.structure.deadlinks', lang),
      status: 'pass',
      message: t('structure.deadlinks.pass', lang, { count: deadCount, c4xx: status4xx.length, c5xx: status5xx.length, ctimeout: statusTimeout.length }),
      detailList: allDetailList,
    });
  }

  // ads.txt check
  try {
    const resp = await fetch(`${origin}/ads.txt`);
    items.push(resp.ok
      ? { name: 'ads.txt', status: 'pass', message: t('structure.ads.pass', lang) }
      : { name: 'ads.txt', status: 'warn', message: t('structure.ads.warn', lang) }
    );
  } catch {
    items.push({ name: 'ads.txt', status: 'warn', message: t('structure.ads.warn', lang) });
  }

  return { name: t('cat.structure', lang), items };
}
