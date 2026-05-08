import type { CheckReport, CheckOptions, CheckCategory, CheckItem, PageDetail, Lang, SiteType } from './types.js';
import { BrowserManager, fetchPage, fetchSitemapUrls } from './browser.js';
import { checkContentQuality } from './checks/content.js';
import { checkRequiredPages } from './checks/pages.js';
import { checkSiteStructure } from './checks/structure.js';
import { checkPerformance } from './checks/performance.js';
import { checkPolicyCompliance } from './checks/policy.js';
import { analyzeWithAI, type PageAiAnalysis } from './ai/analyzer.js';
import { detectSiteType, type PageSignals } from './detector.js';
import { classifyPage } from './classifier.js';
import { scorePage, scoreCategory, computeCompositeScore } from './scorer.js';
import { t } from './i18n.js';

function extractMainContent(text: string, allPageTexts: string[]): string {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (allPageTexts.length <= 1) return paragraphs.join('\n\n');
  const otherTexts = allPageTexts.filter(t => t !== text);
  const threshold = Math.ceil(otherTexts.length * 0.6);
  return paragraphs.filter(para => {
    if (para.length < 20) return true;
    const normalized = para.replace(/\s+/g, ' ').slice(0, 100);
    const count = otherTexts.filter(o => o.replace(/\s+/g, ' ').includes(normalized)).length;
    return count < threshold;
  }).join('\n\n');
}

function buildPageDetails(pages: Array<{ url: string; text: string; title: string }>, aiAnalyses: PageAiAnalysis[], siteType: SiteType): PageDetail[] {
  const allTexts = pages.map(p => p.text);
  const aiMap = new Map(aiAnalyses.map(a => [a.url, a]));
  return pages.map(page => {
    const totalChars = page.text.replace(/\s+/g, '').length;
    const mainContent = extractMainContent(page.text, allTexts);
    const contentChars = mainContent.replace(/\s+/g, '').length;
    const contentRatio = totalChars > 0 ? Math.round((contentChars / totalChars) * 100) : 0;
    const issues: string[] = [];
    let contentStatus: 'pass' | 'warn' | 'fail' = 'pass';
    if (siteType === 'content') {
      if (contentRatio < 30 && totalChars > 200) { issues.push(`Content ratio only ${contentRatio}%, mostly boilerplate`); contentStatus = 'fail'; }
      if (contentChars < 300) { issues.push(`Thin content (${contentChars} chars)`); contentStatus = contentStatus === 'fail' ? 'fail' : 'warn'; }
    }
    const pageType = classifyPage(page.url);
    const ai = aiMap.get(page.url);
    const aiStatus = ai?.status;
    const { score } = scorePage(pageType, contentChars, contentRatio, issues, siteType, aiStatus);
    const detail: PageDetail = { url: page.url, title: page.title, pageType, totalChars, contentChars, contentRatio, contentStatus, issues, score };
    if (ai) detail.ai = { status: ai.status, assessment: ai.assessment, suggestions: ai.suggestions };
    return detail;
  });
}

// Detect if a page is a listing page and find child content links
function discoverChildLinks(
  pageUrl: string,
  pageLinks: string[],
  origin: string,
  maxPerListing: number
): string[] {
  const pagePath = (() => { try { return new URL(pageUrl).pathname; } catch { return ''; } })();
  if (!pagePath || pagePath === '/') return [];

  // Find links that are children of this page path
  const childLinks = pageLinks.filter(link => {
    try {
      const linkUrl = new URL(link);
      if (linkUrl.origin !== origin) return false;
      const linkPath = linkUrl.pathname;
      // Child path must start with page path and be deeper
      if (!linkPath.startsWith(pagePath)) return false;
      if (linkPath === pagePath || linkPath === pagePath.replace(/\/$/, '') + '/') return false;
      // Must be a content page (has a slug after the listing path)
      const suffix = linkPath.slice(pagePath.replace(/\/$/, '').length).replace(/^\//, '');
      return suffix.includes('/') || suffix.length > 0;
    } catch { return false; }
  });

  return childLinks.slice(0, maxPerListing);
}

export async function check(options: CheckOptions): Promise<CheckReport> {
  const { url, maxPages = 10, skipAi = false, timeout = 30000, apiKey, lang = 'en', siteType: manualType } = options;
  const origin = new URL(url).origin;
  const browser = new BrowserManager();

  try {
    const homepage = await browser.newPage();
    const homeData = await fetchPage(homepage, url, timeout);
    const h1Count = await homepage.evaluate(() => document.querySelectorAll('h1').length);
    const sitemapUrls = await fetchSitemapUrls(origin);

    const pages: Array<{ url: string; text: string; title: string; links: string[] }> = [
      { url: homeData.url, text: homeData.text, title: homeData.title, links: homeData.links },
    ];
    const allSignals: PageSignals[] = [homeData.signals];

    const internalLinks = homeData.links.filter(l => { try { return new URL(l).origin === origin; } catch { return false; } });
    const sitemapInternal = sitemapUrls.filter(u => { try { return new URL(u).origin === origin; } catch { return false; } });
    const allInternal = [...new Set([...internalLinks, ...sitemapInternal])];
    const uniqueLinks = allInternal.slice(0, maxPages);

    const deadLinks: string[] = [];
    const crawledUrls = new Set([url.replace(/\/+$/, '')]);

    async function crawlPage(link: string) {
      const norm = link.replace(/\/+$/, '');
      if (crawledUrls.has(norm)) return;
      crawledUrls.add(norm);
      try {
        const pg = await browser.newPage();
        const resp = await pg.goto(link, { waitUntil: 'domcontentloaded', timeout });
        const status = resp?.status() ?? 0;
        if (status >= 400) { deadLinks.push(`${link} (${status})`); }
        else {
          const data = await fetchPage(pg, link, timeout);
          pages.push({ url: link, text: data.text, title: data.title, links: data.links });
          allSignals.push(data.signals);
        }
        await pg.close();
      } catch { deadLinks.push(`${link} (timeout)`); }
    }

    // Phase 1: Crawl initial batch
    for (const link of uniqueLinks) {
      await crawlPage(link);
    }

    // Phase 2: Discover child content pages from listing pages
    const CHILDREN_PER_LISTING = 8;
    const discoveredContent = new Set<string>();
    const discoveredListing = new Set<string>();
    for (const page of pages) {
      const children = discoverChildLinks(page.url, page.links, origin, CHILDREN_PER_LISTING);
      for (const child of children) {
        const norm = child.replace(/\/+$/, '');
        if (!crawledUrls.has(norm)) {
          const pt = classifyPage(child);
          if (pt === 'listing' || pt === 'unknown') discoveredListing.add(child);
          else discoveredContent.add(child);
        }
      }
    }

    // Also add sitemap content pages that weren't crawled yet
    for (const smUrl of sitemapInternal) {
      const norm = smUrl.replace(/\/+$/, '');
      if (!crawledUrls.has(norm)) {
        const pt = classifyPage(smUrl);
        if (pt === 'listing' || pt === 'unknown') discoveredListing.add(smUrl);
        else discoveredContent.add(smUrl);
      }
    }

    // Crawl content pages first, then listing pages (up to maxPages additional)
    const prioritized = [...discoveredContent, ...discoveredListing];
    const toCrawl = prioritized.slice(0, maxPages);
    for (const link of toCrawl) {
      await crawlPage(link);
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniquePages = pages.filter(p => {
      const norm = p.url.replace(/\/+$/, '').split('#')[0];
      if (seen.has(norm)) return false; seen.add(norm); return true;
    });

    // Detect site type
    const typeResult = detectSiteType(allSignals, homeData.navText + ' ' + homeData.footerText, manualType);
    const siteType = typeResult.type;

    // Checks - build categories with group assignments
    const allCategories: CheckCategory[] = [];

    // Content quality → soft
    const contentCat = checkContentQuality(uniquePages, allInternal.length, lang, siteType, allSignals);
    // Extract site scale → hard (it's a hard requirement: min 10 pages)
    const scaleItem = contentCat.items.find(i => i.name === t('item.content.scale', lang));
    const contentItems = scaleItem ? contentCat.items.filter(i => i !== scaleItem) : contentCat.items;
    allCategories.push({ name: contentCat.name, items: contentItems, group: 'soft' });
    if (scaleItem) {
      allCategories.push({ name: t('group.site_scale', lang), items: [scaleItem], group: 'hard' });
    }

    // Required pages → hard
    const pagesCat = await checkRequiredPages({ allLinks: homeData.linkDetails, navText: homeData.navText, footerText: homeData.footerText, sitemapUrls }, lang);
    allCategories.push({ ...pagesCat, group: 'hard' });

    // Structure → hard
    const structCat = await checkSiteStructure(origin, homeData.links, h1Count, deadLinks, lang);
    allCategories.push({ ...structCat, group: 'hard' });

    // Performance → split: hard (speed, viewport, overflow) + soft (font, popup)
    const playBrowser = await browser.launch();
    const perfPage = await browser.newPage();
    const perfCat = await checkPerformance(perfPage, url, playBrowser, lang);
    await perfPage.close();
    const hardPerfNames = [t('item.perf.speed', lang), 'Viewport', t('item.perf.overflow', lang)];
    const hardPerfItems = perfCat.items.filter(i => hardPerfNames.includes(i.name));
    const softPerfItems = perfCat.items.filter(i => !hardPerfNames.includes(i.name));
    if (hardPerfItems.length > 0) allCategories.push({ name: t('group.performance_min', lang), items: hardPerfItems, group: 'hard' });
    if (softPerfItems.length > 0) allCategories.push({ name: t('group.user_experience', lang), items: softPerfItems, group: 'soft' });

    // Policy → hard
    const policyCat = checkPolicyCompliance(uniquePages, lang);
    allCategories.push({ ...policyCat, group: 'hard' });

    // AI → soft
    let pageAnalyses: PageAiAnalysis[] = [];
    if (!skipAi) {
      try {
        const aiResult = await analyzeWithAI(uniquePages, lang, apiKey);
        pageAnalyses = aiResult.pageAnalyses;
        const aiItems: CheckItem[] = [
          { name: t('item.ai.quality', lang), status: aiResult.contentQuality.status, message: aiResult.contentQuality.detail.slice(0, 200) },
          { name: t('item.ai.originality', lang), status: aiResult.originality.status, message: aiResult.originality.detail.slice(0, 200) },
          { name: t('item.ai.compliance', lang), status: aiResult.compliance.status, message: aiResult.compliance.detail.slice(0, 200) },
        ];
        if (aiResult.suggestions.length > 0) {
          aiItems.push({ name: t('item.ai.suggestions', lang), status: 'warn', message: t('ai.suggestion_count', lang, { count: aiResult.suggestions.length }), detail: aiResult.suggestions.join('; ') });
        }
        allCategories.push({ name: t('group.ai_analysis', lang), items: aiItems, group: 'soft' });
      } catch (err) {
        allCategories.push({ name: t('group.ai_analysis', lang), items: [{ name: 'AI', status: 'skip', message: t('ai.fail', lang, { error: err instanceof Error ? err.message : String(err) }) }], group: 'soft' });
      }
    }

    const pageDetails = buildPageDetails(uniquePages, pageAnalyses, siteType);

    // Separate hard/soft categories
    const hardCategories = allCategories.filter(c => c.group === 'hard');
    const softCategories = allCategories.filter(c => c.group === 'soft');
    const allItems = allCategories.flatMap(c => c.items);

    // Compute composite score with new two-group system
    const pageScoresForComposite = pageDetails.map(p => ({ pageType: p.pageType, score: p.score }));
    const { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty } = computeCompositeScore(pageScoresForComposite, hardCategories, softCategories);

    return {
      url, timestamp: new Date().toISOString(), lang, siteType,
      siteTypeConfidence: typeResult.confidence,
      categories: allCategories,
      hardCategories,
      softCategories,
      score: allItems.filter(i => i.status === 'pass').length,
      totalChecks: allItems.length,
      passed: allItems.filter(i => i.status === 'pass').length,
      warned: allItems.filter(i => i.status === 'warn').length,
      failed: allItems.filter(i => i.status === 'fail').length,
      skipped: allItems.filter(i => i.status === 'skip').length,
      pages: pageDetails,
      compositeScore,
      categoryScores,
      hardStatus,
      softScore,
      warningRatio,
      warningPenalty,
    };
  } finally {
    await browser.close();
  }
}
