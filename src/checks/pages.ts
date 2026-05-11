import type { CheckCategory, CheckItem, Lang } from '../types.js';
import { t } from '../i18n.js';

interface PageMatch {
  nameKey: string;
  required: boolean;
  urlPatterns: RegExp[];
  textPatterns: RegExp[];
}

const REQUIRED_PAGES: PageMatch[] = [
  { nameKey: 'page.about', required: true, urlPatterns: [/\/about/i], textPatterns: [/about/i, /关于我们/, /关于/] },
  { nameKey: 'page.privacy', required: true, urlPatterns: [/\/privacy/i], textPatterns: [/privacy/i, /隐私/] },
  { nameKey: 'page.contact', required: true, urlPatterns: [/\/contact/i], textPatterns: [/contact/i, /联系/] },
  { nameKey: 'page.terms', required: false, urlPatterns: [/\/terms/i, /\/legal/i], textPatterns: [/terms/i, /legal/i, /条款/] },
];

interface LinkInfo { href: string; text: string; }

export async function checkRequiredPages(
  input: { allLinks: LinkInfo[]; navText: string; footerText: string; sitemapUrls: string[] },
  lang: Lang
): Promise<CheckCategory> {
  const items: CheckItem[] = [];
  const { allLinks, sitemapUrls } = input;

  for (const page of REQUIRED_PAGES) {
    const displayName = t(page.nameKey, lang);
    let found = false, foundUrl = '';

    for (const p of page.urlPatterns) {
      const link = allLinks.find(l => p.test(l.href));
      if (link) { found = true; foundUrl = link.href; break; }
      const sm = sitemapUrls.find(u => p.test(u));
      if (sm) { found = true; foundUrl = sm; break; }
    }
    if (!found) {
      for (const p of page.textPatterns) {
        const link = allLinks.find(l => p.test(l.text));
        if (link) { found = true; foundUrl = link.href; break; }
      }
    }

    const path = foundUrl ? (() => { try { return new URL(foundUrl).pathname; } catch { return ''; } })() : '';
    items.push(found
      ? { name: displayName, status: 'pass', message: t('pages.found', lang, { name: displayName, path }) }
      : { name: displayName, status: 'warn', message: t('pages.missing_recommended', lang, { name: displayName }) }
    );
  }

  return { name: t('cat.pages', lang), items };
}
