import type { CheckReport, CheckOptions, CheckCategory, CheckItem, PageDetail, Lang, SiteType, SiteTheme } from './types.js';
import { BrowserManager, fetchPage, fetchSitemapUrls } from './browser.js';
import { checkContentQuality } from './checks/content.js';
import { checkRequiredPages } from './checks/pages.js';
import { checkSiteStructure } from './checks/structure.js';
import { checkPerformance } from './checks/performance.js';
import { checkPolicyCompliance } from './checks/policy.js';
import { analyzeWithAI, type PageAiAnalysis } from './ai/analyzer.js';
import { analyzeSiteTheme } from './ai/theme.js';
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
    const relevance = ai?.relevance;
    const { score } = scorePage(pageType, contentChars, contentRatio, issues, siteType, aiStatus);
    const detail: PageDetail = { url: page.url, title: page.title, pageType, totalChars, contentChars, contentRatio, contentStatus, issues, score };
    if (relevance) detail.relevance = relevance;
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

// Score URL freshness: higher = fresher. Prefers URLs with date patterns.
function freshnessScore(url: string): number {
  try {
    const path = new URL(url).pathname;
    // Match /2024/, /2025/01/, /2025-01-15/ patterns in URL
    const m = path.match(/\/(20[12]\d)(?:[\/\-](0?[1-9]|1[0-2])(?:[\/\-](0?[1-9]|[12]\d|3[01]))?)?/);
    if (m) {
      const year = parseInt(m[1]);
      const month = m[2] ? parseInt(m[2]) : 6;
      const day = m[3] ? parseInt(m[3]) : 15;
      return new Date(year, month - 1, day).getTime();
    }
  } catch {}
  return 0;
}

// Sort URLs by freshness (newest first), stable for equal scores
function sortByFreshness(urls: string[]): string[] {
  const scored = urls.map((u, i) => ({ url: u, score: freshnessScore(u), index: i }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(s => s.url);
}

export async function check(options: CheckOptions): Promise<CheckReport> {
  const { url, maxPages = 50, maxContent = 20, sampleMin = 20, sampleRatio = 0.2, skipAi = false, timeout = 30000, apiKey, lang = 'en', siteType: manualType, onProgress } = options;
  const origin = new URL(url).origin;
  const browser = new BrowserManager();
  const progress = onProgress ?? (() => {});

  try {
    progress('Launching browser...');
    const homepage = await browser.newPage();
    progress(`Fetching ${url}...`);
    const homeData = await fetchPage(homepage, url, timeout);
    const h1Count = await homepage.evaluate(() => document.querySelectorAll('h1').length);
    progress('Fetching sitemap...');
    const sitemapUrls = await fetchSitemapUrls(origin);

    // AI theme analysis (runs early, after homepage is fetched)
    let siteTheme: SiteTheme | undefined;
    if (!skipAi) {
      try {
        const apiKeyResolved = apiKey || process.env.AI_API_KEY;
        if (apiKeyResolved) {
          progress('AI: analyzing site theme...');
          siteTheme = await analyzeSiteTheme(
            { title: homeData.title, text: homeData.text, navText: homeData.navText + ' ' + homeData.footerText },
            lang,
            apiKeyResolved
          );
          progress(`AI: site type = ${siteTheme.type}, topic = ${siteTheme.topic}`);
        }
      } catch {}
    }

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
        const data = await fetchPage(pg, link, timeout);
        if (data.status >= 400) { deadLinks.push(`${link} (${data.status})`); }
        else {
          pages.push({ url: link, text: data.text, title: data.title, links: data.links });
          allSignals.push(data.signals);
        }
        await pg.close();
      } catch { deadLinks.push(`${link} (timeout)`); }
    }

    // Phase 1: Crawl initial batch
    progress(`Phase 1: Crawling ${uniqueLinks.length} pages...`);
    for (let i = 0; i < uniqueLinks.length; i++) {
      const link = uniqueLinks[i];
      progress(`Phase 1: [${i + 1}/${uniqueLinks.length}] ${new URL(link).pathname}`);
      await crawlPage(link);
    }

    // Phase 2: Discover content pages (recursively through listing pages)
    const CHILDREN_PER_LISTING = 10;
    const MAX_DISCOVERY_DEPTH = 3;
    const discoveredContent = new Set<string>();

    // BFS discovery: follow listing pages up to MAX_DISCOVERY_DEPTH
    const discoveryQueue: Array<{ url: string; links: string[]; depth: number }> =
      pages.map(p => ({ url: p.url, links: p.links, depth: 0 }));
    const seenInDiscovery = new Set<string>([...crawledUrls].map(u => u.replace(/\/+$/, '')));

    while (discoveryQueue.length > 0) {
      const current = discoveryQueue.shift()!;
      if (current.depth > MAX_DISCOVERY_DEPTH) continue;
      const children = discoverChildLinks(current.url, current.links, origin, CHILDREN_PER_LISTING);
      for (const child of children) {
        const norm = child.replace(/\/+$/, '');
        if (seenInDiscovery.has(norm)) continue;
        seenInDiscovery.add(norm);
        const pt = classifyPage(child);
        if (pt === 'listing' || pt === 'unknown') {
          // Listing pages: will need to crawl to find their children, queue for deeper discovery
          if (current.depth < MAX_DISCOVERY_DEPTH) {
            // We'll discover their links when we crawl them in Phase 2
          }
        } else {
          discoveredContent.add(child);
        }
      }
    }

    // Also add sitemap content pages that weren't crawled yet
    for (const smUrl of sitemapInternal) {
      const norm = smUrl.replace(/\/+$/, '');
      if (!crawledUrls.has(norm) && !discoveredContent.has(norm)) {
        const pt = classifyPage(smUrl);
        if (pt !== 'listing' && pt !== 'unknown') {
          discoveredContent.add(smUrl);
        }
      }
    }

    // Sort by freshness (newest first) then take maxContent
    const sortedContent = sortByFreshness([...discoveredContent]);
    const toCrawl = sortedContent.slice(0, maxContent);
    if (toCrawl.length > 0) progress(`Phase 2: Crawling ${toCrawl.length} content pages (from ${discoveredContent.size} discovered)...`);
    for (let i = 0; i < toCrawl.length; i++) {
      const link = toCrawl[i];
      progress(`Phase 2: [${i + 1}/${toCrawl.length}] ${new URL(link).pathname}`);
      await crawlPage(link);

      // After crawling a page, check if it has deeper content links we missed
      const crawledPage = pages[pages.length - 1];
      if (crawledPage && crawledPage.url === link) {
        const deeperChildren = discoverChildLinks(link, crawledPage.links, origin, CHILDREN_PER_LISTING);
        for (const dc of deeperChildren) {
          const dnorm = dc.replace(/\/+$/, '');
          if (!crawledUrls.has(dnorm) && !discoveredContent.has(dnorm) && classifyPage(dc) !== 'listing' && classifyPage(dc) !== 'unknown') {
            // Found deeper content page, add to queue if we have room
            if (i + discoveredContent.size < maxContent * 2) {
              discoveredContent.add(dc);
            }
          }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniquePages = pages.filter(p => {
      const norm = p.url.replace(/\/+$/, '').split('#')[0];
      if (seen.has(norm)) return false; seen.add(norm); return true;
    });

    // Detect site type: prefer AI theme, fallback to DOM signals
    progress('Detecting site type...');
    const domResult = detectSiteType(allSignals, homeData.navText + ' ' + homeData.footerText, manualType);
    let siteType: SiteType;
    let siteTypeConfidence: 'high' | 'medium' | 'low';

    if (siteTheme && siteTheme.type !== 'unsupported') {
      // AI detected a valid type — use it
      siteType = siteTheme.type;
      siteTypeConfidence = siteTheme.confidence;
    } else if (siteTheme?.type === 'unsupported') {
      // AI confirmed unsupported — use it
      siteType = 'unsupported';
      siteTypeConfidence = siteTheme.confidence;
    } else {
      // Fallback to DOM detection
      siteType = domResult.type;
      siteTypeConfidence = domResult.confidence;
    }

    // Checks - build categories with group assignments
    progress('Running checks...');
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
        progress(`AI analysis: ${uniquePages.length} pages...`);
        const aiResult = await analyzeWithAI(uniquePages, lang, apiKey, progress, siteTheme);
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

    // Content relevance check (based on AI per-page relevance)
    if (pageAnalyses.length > 0) {
      const withRelevance = pageAnalyses.filter(a => a.relevance);
      if (withRelevance.length > 0) {
        const offTopic = withRelevance.filter(a => a.relevance === 'off-topic').length;
        const tangential = withRelevance.filter(a => a.relevance === 'tangential').length;
        const offTopicRatio = offTopic / withRelevance.length;
        const relevanceStatus = offTopicRatio > 0.3 ? 'fail' : offTopicRatio > 0.1 ? 'warn' : 'pass';
        const msg = offTopic > 0 || tangential > 0
          ? `${offTopic} off-topic, ${tangential} tangential out of ${withRelevance.length} pages`
          : `All ${withRelevance.length} pages relevant to site theme`;
        allCategories.push({
          name: t('group.content_relevance', lang),
          items: [{ name: t('item.relevance.theme', lang), status: relevanceStatus, message: msg }],
          group: 'soft',
        });
      }
    }

    // Separate hard/soft categories
    const hardCategories = allCategories.filter(c => c.group === 'hard');
    const softCategories = allCategories.filter(c => c.group === 'soft');
    const allItems = allCategories.flatMap(c => c.items);

    // Compute composite score with new two-group system
    const pageScoresForComposite = pageDetails.map(p => ({ pageType: p.pageType, score: p.score }));
    const { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty } = computeCompositeScore(pageScoresForComposite, hardCategories, softCategories);

    return {
      url, timestamp: new Date().toISOString(), lang, siteType,
      siteTypeConfidence,
      siteTheme,
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
