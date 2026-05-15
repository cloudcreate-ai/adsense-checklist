import type { CheckReport, CheckOptions, CheckCategory, CheckItem, PageDetail, Lang, SiteType, SiteTopic, PageType } from './types.js';
import { t } from './i18n.js';
import { BrowserManager, fetchPage, fetchSitemapUrls, getSitemapFromRobots, isContentUrl } from './browser.js';
import { checkContentQuality } from './checks/content.js';
import { checkRequiredPages } from './checks/pages.js';
import { checkSiteStructure } from './checks/structure.js';
import { checkPerformance } from './checks/performance.js';
import { checkPolicyCompliance } from './checks/policy.js';
import { analyzeWithAI, analyzeBatch, analyzeOverall, type PageAiAnalysis } from './ai/analyzer.js';
import { estimateByRules, summarizeFinal } from './ai/approval.js';
import { analyzeSiteTopic } from './ai/topic.js';
import { detectSiteType, type PageSignals } from './detector.js';

function embedTypeFromSignals(sig: PageSignals): 'game' | 'video' | 'none' {
  if (sig.iframeCount > 0 || sig.canvasCount > 0) return 'game';
  if (sig.videoElementCount > 0) return 'video';
  return 'none';
}
import { classifyPage, PAGE_TYPE_WEIGHTS } from './classifier.js';
import { scorePage, scoreCategory, computeCompositeScore } from './scorer.js';

// ── Timing tracker ──────────────────────────────────────────────────────
interface TimingPhase {
  phase: string;
  ms: number;
  detail?: string;
}

class TimingTracker {
  phases: TimingPhase[] = [];
  start(phase: string) { this._start = Date.now(); this._phase = phase; }
  end(detail?: string) {
    if (this._start) {
      this.phases.push({ phase: this._phase!, ms: Date.now() - this._start, detail });
    }
  }
  print() {
    const total = this.phases.reduce((s, p) => s + p.ms, 0);
    console.error('\n─── Timing breakdown ───');
    for (const p of this.phases) {
      const detail = p.detail ? ` (${p.detail})` : '';
      console.error(`  ${String(p.ms).padStart(6)}ms  ${p.phase}${detail}`);
    }
    console.error(`  ${String(total).padStart(6)}ms  TOTAL`);
    console.error('────────────────────────────────');
  }
  private _start: number | null = null;
  private _phase: string | null = null;
}

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

function buildPageDetails(pages: Array<{ url: string; text: string; title: string; lang: string }>, aiAnalyses: PageAiAnalysis[], siteType: SiteType, lang: string, signals?: PageSignals[]): PageDetail[] {
  const allTexts = pages.map(p => p.text);
  const aiMap = new Map(aiAnalyses.map(a => [a.url, a]));
  const sigMap = signals ? new Map(pages.map((p, i) => [p.url, signals[i]])) : new Map<string, PageSignals>();
  return pages.map(page => {
    const totalChars = page.text.replace(/\s+/g, '').length;
    const mainContent = extractMainContent(page.text, allTexts);
    const contentChars = mainContent.replace(/\s+/g, '').length;
    const contentRatio = totalChars > 0 ? Math.round((contentChars / totalChars) * 100) : 0;
    const issues: string[] = [];
    let contentStatus: 'pass' | 'warn' | 'fail' = 'pass';
    const ai = aiMap.get(page.url);
    const aiStatus = ai?.status;
    const relevance = ai?.relevance;
    const pageType = ai?.inferredPageType ?? classifyPage(page.url);
    const embed = sigMap.has(page.url) ? embedTypeFromSignals(sigMap.get(page.url)!) : 'none';

    // Warn for game/video detail pages with embeds — AI can't verify embed functionality
    // Skip warning for listing/homepage/content pages — they may have non-game iframes (ads, etc.)
    if (embed === 'game' && pageType === 'game_detail') issues.push(t('embed.game_verify_warning', lang));
    else if (embed === 'video' && pageType === 'video_detail') issues.push(t('embed.video_verify_warning', lang));

    // Skip content depth checks for required/utility pages — they don't need 300+ chars of editorial content
    const isFunctional = pageType === 'required' || pageType === 'utility';
    if (siteType === 'content' && !isFunctional) {
      if (contentChars < 300) { issues.push(`Thin content (${contentChars} chars)`); contentStatus = 'warn'; }
    }
    const { score } = scorePage(pageType, contentChars, contentRatio, issues, siteType, aiStatus);
    const detail: PageDetail = { url: page.url, title: page.title, pageType, pageLanguage: page.lang, totalChars, contentChars, contentRatio, contentStatus, issues, score };
    if (relevance) detail.relevance = relevance;
    if (ai) detail.ai = {
      status: ai.status,
      valueScore: ai.valueScore,
      originalityScore: ai.originalityScore,
      relevanceScore: ai.relevanceScore,
      complianceScore: ai.complianceScore,
      translationScore: ai.translationScore,
      assessment: ai.assessment,
      suggestions: ai.suggestions,
    };
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
      if (!isContentUrl(link)) return false;
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
  const { url, maxCrawl = 50, maxPages = 50, maxContent = 20, sampleMin = 20, sampleRatio = 0.2, skipAi = false, timeout = 30000, apiKey, lang = 'en', siteType: manualType, expert = false, concurrency = 5, onProgress } = options;
  const apiKeyResolved = apiKey || process.env.AI_API_KEY;
  const timing = new TimingTracker();

  // Phase 1 URL collection: gather up to maxCrawl candidates for stratified sampling
  // (the actual crawl count is still capped by maxCrawl)
  const phase1Limit = Math.max(maxPages, maxCrawl);
  const origin = new URL(url).origin;
  const browser = new BrowserManager();
  const progress = onProgress ?? (() => {});

  try {
    timing.start('launch');
    progress('Launching browser...');
    const homepage = await browser.newPage();
    timing.end();

    timing.start('homepage');
    progress(`Fetching ${url}...`);
    const homeData = await fetchPage(homepage, url, timeout);
    timing.end();

    timing.start('h1');
    const h1Count = await homepage.evaluate(() => document.querySelectorAll('h1').length);
    timing.end();

    timing.start('sitemap');
    progress('Fetching sitemap...');
    const sitemapUrls = await fetchSitemapUrls(origin);
    timing.end();

    // AI topic analysis (runs early, after homepage is fetched)
    let siteTopic: SiteTopic | undefined;
    if (!skipAi) {
      try {
        if (apiKeyResolved) {
          timing.start('ai-topic');
          progress('AI: analyzing site topic...');
          siteTopic = await analyzeSiteTopic(
            { title: homeData.title, text: homeData.text, navText: homeData.navText + ' ' + homeData.footerText, metaInfo: homeData.pageInfo },
            lang,
            apiKeyResolved
          );
          timing.end(siteTopic.topic);
          progress(`AI: site type = ${siteTopic.type}, topic = ${siteTopic.topic}`);
        }
      } catch {}
    }

    const pages: Array<{ url: string; text: string; title: string; links: string[]; lang: string; signals: PageSignals }> = [
      { url: homeData.url, text: homeData.text, title: homeData.title, links: homeData.links, lang: homeData.pageInfo?.lang ?? 'en', signals: homeData.signals },
    ];

    const internalLinks = homeData.links.filter(l => {
      try {
        const u = new URL(l);
        if (u.origin !== origin) return false;
        if (!isContentUrl(l)) return false;
        // Skip root-path querystring URLs — SPA search pages all resolve to the same /
        if (u.pathname === '/' && u.search.length > 0) return false;
        return true;
      } catch { return false; }
    });
    const sitemapInternal = sitemapUrls.filter(u => { try { const url = new URL(u); if (url.origin !== origin) return false; if (!isContentUrl(u)) return false; if (url.pathname === '/' && url.search.length > 0) return false; return true; } catch { return false; } });
    const allInternal = [...new Set([...internalLinks, ...sitemapInternal])];

    // Normalize URLs before dedup (strip trailing slash, hash) to avoid
    // different URL strings resolving to the same page during concurrent crawl
    const normalizeUrl = (u: string) => u.split('#')[0].replace(/\/+$/, '');
    const dedupedMap = new Map<string, string>();
    for (const link of allInternal) {
      const norm = normalizeUrl(link);
      if (!dedupedMap.has(norm)) dedupedMap.set(norm, link);
    }
    const uniqueLinks = [...dedupedMap.values()].slice(0, phase1Limit);

    const deadLinks: Array<{ url: string; status: string }> = [];
    const crawledUrls = new Set([homeData.url.split('#')[0].replace(/\/+$/, '')]);

    async function crawlPage(link: string): Promise<{ url: string; text: string; title: string; links: string[]; lang: string; signals: PageSignals } | null> {
      const norm = link.replace(/\/+$/, '').split('#')[0];
      if (crawledUrls.has(norm)) return null;
      crawledUrls.add(norm);
      const pg = await browser.newPage();
      try {
        const data = await fetchPage(pg, link, timeout);
        const postNorm = data.url.replace(/\/+$/, '').split('#')[0];
        if (crawledUrls.has(postNorm) && postNorm !== norm) return null;
        crawledUrls.add(postNorm);
        if (data.status >= 400) { deadLinks.push({ url: link, status: String(data.status) }); return null; }
        return { url: data.url, text: data.text, title: data.title, links: data.links, lang: data.pageInfo?.lang ?? 'en', signals: data.signals };
      } catch {
        deadLinks.push({ url: link, status: 'timeout' });
        return null;
      } finally {
        await pg.close();
      }
    }

    // ── Pipeline: crawl + AI overlap ──
    const aiAnalyses: PageAiAnalysis[] = [];
    const aiPromises: Promise<void>[] = [];
    let totalCrawled = 0;
    let crawlBatchNum = 0;

    async function launchAIBatch(batchPages: Array<{ url: string; text: string; title: string; links: string[]; lang: string; signals: PageSignals }>) {
      if (skipAi || !apiKeyResolved || batchPages.length === 0) return;
      const p = analyzeBatch(
        batchPages.map(bp => {
          const et: 'game' | 'video' | 'none' = embedTypeFromSignals(bp.signals);
          const listingSignals = { listItems: bp.signals.listItems, hasPagination: bp.signals.hasPagination, hasCategories: bp.signals.hasCategories, hasSearch: bp.signals.hasSearch };
          return { url: bp.url, text: bp.text, lang: bp.lang, embedType: et, listingSignals };
        }),
        lang, apiKeyResolved, siteTopic, progress
      );
      aiPromises.push(p.then(results => { aiAnalyses.push(...results); }));
    }

    function chunkArray<T>(arr: T[], size: number): T[][] {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
      return chunks;
    }

    // Crawl initial batch in concurrent chunks, feeding pages to AI as they complete
    const phase1Chunks = chunkArray(uniqueLinks, concurrency);
    let phase1Crawled = 0;
    progress(`Crawling ${uniqueLinks.length} pages (${phase1Chunks.length} batches, ${concurrency} concurrent)...`);

    // Send homepage (already in pages) to AI before crawl loop
    await launchAIBatch([pages[0]]);

    timing.start('phase1-crawl');
    for (const chunk of phase1Chunks) {
      crawlBatchNum++;
      // Crawl chunk concurrently
      const results = await Promise.all(chunk.map(link => {
        return crawlPage(link).then(r => {
          if (r) phase1Crawled++;
          progress(`Crawling: [${phase1Crawled}/${uniqueLinks.length}] ${new URL(link).pathname}${new URL(link).search}`);
          return r;
        });
      }));
      const newPages = results.filter((r): r is NonNullable<typeof r> => r !== null);
      pages.push(...newPages);
      // Launch AI for this chunk while we crawl the next one
      await launchAIBatch(newPages);
    }
    timing.end();

    // Pages already successfully crawled (non-null results)
    const uniquePagesForSampling = pages.map(p => p.url.split('#')[0].replace(/\/+$/, ''));

    // Stratified sampling: classify all URLs, pick required pages first, then distribute remaining budget by type
    const classifiedUrls = allInternal.map(u => ({ url: u, type: classifyPage(u) }));

    // Always-crawl: homepage + required pages
    const requiredTypes = new Set<PageType>(['required']);
    const alwaysUrls = new Set<string>();
    alwaysUrls.add(homeData.url.replace(/\/+$/, '')); // homepage
    for (const c of classifiedUrls) {
      if (requiredTypes.has(c.type)) alwaysUrls.add(normalizeUrl(c.url));
    }

    // Group remaining URLs by type
    const typeGroups = new Map<string, string[]>();
    for (const c of classifiedUrls) {
      const norm = normalizeUrl(c.url);
      if (alwaysUrls.has(norm)) continue;
      if (c.type === 'utility') continue; // skip low-value types
      const group = typeGroups.get(c.type) ?? [];
      group.push(c.url);
      typeGroups.set(c.type, group);
    }

    // Distribute remaining budget proportionally by weight × count
    const alwaysCount = Math.min(alwaysUrls.size, uniqueLinks.length); // some may already be in pages
    const remainingBudget = Math.max(0, maxCrawl - Math.max(uniquePagesForSampling.length, alwaysCount));

    const weightedTypes = [...typeGroups.entries()]
      .map(([type, urls]) => ({ type, urls, weight: PAGE_TYPE_WEIGHTS[type as keyof typeof PAGE_TYPE_WEIGHTS] ?? 3 }))
      .sort((a, b) => b.weight - a.weight);

    const totalWeight = weightedTypes.reduce((s, t) => s + t.weight * t.urls.length, 0);
    const sampledFromTypes = new Set<string>();
    if (totalWeight > 0 && remainingBudget > 0) {
      for (const t of weightedTypes) {
        const budgetShare = Math.max(1, Math.round((t.weight * t.urls.length / totalWeight) * remainingBudget));
        const sorted = sortByFreshness(t.urls);
        const toTake = Math.min(budgetShare, sorted.length);
        for (const u of sorted.slice(0, toTake)) sampledFromTypes.add(normalizeUrl(u));
      }
    }

    // Build final URL list: always-crawl + sampled, deduplicated, capped
    const finalUrlSet = new Set<string>();
    for (const u of alwaysUrls) finalUrlSet.add(u);
    for (const u of sampledFromTypes) finalUrlSet.add(u);
    const finalUrls = [...finalUrlSet].slice(0, maxCrawl);

    // Crawl remaining URLs that haven't been crawled yet
    const toCrawl = finalUrls.filter(u => !crawledUrls.has(u));
    if (toCrawl.length > 0) {
      const crawlChunks = chunkArray(toCrawl, concurrency);
      timing.start('phase2-crawl');
      progress(`Crawling ${toCrawl.length} additional pages (${crawlChunks.length} batches)...`);
      for (const chunk of crawlChunks) {
        const results = await Promise.all(chunk.map(link => crawlPage(link).then(r => {
          if (r) progress(`Crawling: ${new URL(link).pathname}`);
          return r;
        })));
        const newPages = results.filter((r): r is NonNullable<typeof r> => r !== null);
        pages.push(...newPages);
        await launchAIBatch(newPages);
      }
      timing.end();
    }

    // Wait for all AI analyses to complete
    if (aiPromises.length > 0) {
      timing.start('ai-wait');
      progress(`AI: waiting for ${aiPromises.length} batch(es) to complete...`);
      await Promise.all(aiPromises);
      timing.end();
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniquePages = pages.filter(p => {
      const norm = p.url.split('#')[0].replace(/\/+$/, '');
      if (seen.has(norm)) return false; seen.add(norm); return true;
    });

    // Progress info
    progress(`Pages: ${uniquePages.length} crawled, ${aiAnalyses.length} AI-analyzed`);

    // Detect site type: prefer AI topic, fallback to DOM signals
    progress('Detecting site type...');
    const domResult = detectSiteType(pages.map(p => p.signals), homeData.navText + ' ' + homeData.footerText, manualType);
    let siteType: SiteType;
    let siteTypeConfidence: 'high' | 'medium' | 'low';

    if (siteTopic && siteTopic.type !== 'unsupported') {
      // AI detected a valid type — use it
      siteType = siteTopic.type;
      siteTypeConfidence = siteTopic.confidence;
    } else if (siteTopic?.type === 'unsupported') {
      // AI confirmed unsupported — use it
      siteType = 'unsupported';
      siteTypeConfidence = siteTopic.confidence;
    } else {
      // Fallback to DOM detection
      siteType = domResult.type;
      siteTypeConfidence = domResult.confidence;
    }

    // Checks - build categories with group assignments
    progress('Running checks...');
    const allCategories: CheckCategory[] = [];

    // Content quality → soft
    const contentResult = checkContentQuality(uniquePages, allInternal.length, lang, siteType, pages.map(p => p.signals));
    const contentCat = contentResult.category;
    const contentDuplicationScore = contentResult.contentDuplicationScore;
    // Extract site scale → hard (it's a hard requirement: min 10 pages)
    const scaleItem = contentCat.items.find(i => i.name === t('item.content.scale', lang));
    const contentItems = scaleItem ? contentCat.items.filter(i => i !== scaleItem) : contentCat.items;

    // Extract landing page items from content (homepage content only — content ratio removed)
    const landingContentNames = [t('item.content.home', lang)];
    const landingContentItems = contentItems.filter(i => landingContentNames.includes(i.name));
    const siteContentItems = contentItems.filter(i => !landingContentNames.includes(i.name));
    allCategories.push({ name: t('group.content_quality', lang), items: siteContentItems, group: 'soft' });
    if (landingContentItems.length > 0) {
      allCategories.push({ name: t('group.landing_page', lang), items: landingContentItems, group: 'soft' });
    }
    if (scaleItem) {
      allCategories.push({ name: t('group.site_scale', lang), items: [scaleItem], group: 'hard' });
    }

    // Required pages → hard
    const pagesCat = await checkRequiredPages({ allLinks: homeData.linkDetails, navText: homeData.navText, footerText: homeData.footerText, sitemapUrls }, lang);
    allCategories.push({ ...pagesCat, group: 'hard' });

    // Structure → hard: split into landing page items (H1, internal links) and site-wide (robots, sitemap, dead links, ads.txt)
    const structCat = await checkSiteStructure(origin, homeData.links, h1Count, deadLinks, lang);
    const landingStructNames = ['H1', t('item.structure.internal', lang)];
    const landingStructItems = structCat.items.filter(i => landingStructNames.includes(i.name));
    const siteStructItems = structCat.items.filter(i => !landingStructNames.includes(i.name));
    if (landingStructItems.length > 0) {
      // Add to existing landing page category or create new one
      const existingLanding = allCategories.find(c => c.name === t('group.landing_page', lang));
      if (existingLanding) {
        existingLanding.items.push(...landingStructItems);
      } else {
        allCategories.push({ name: t('group.landing_page', lang), items: landingStructItems, group: 'soft' });
      }
    }
    allCategories.push({ name: t('group.site_structure', lang), items: siteStructItems, group: 'hard' });

    // Performance → split: landing page (speed, viewport, overflow) + site-wide UX (font, popup, heading, nav, touch)
    timing.start('perf');
    const playBrowser = await browser.launch();
    const perfPage = await browser.newPage();
    timing.start('perf');
    const perfCat = await checkPerformance(perfPage, url, playBrowser, lang);
    await perfPage.close();
    timing.end();

    const landingPerfNames = [t('item.perf.speed', lang), 'Viewport', t('item.perf.overflow', lang)];
    const landingPerfItems = perfCat.items.filter(i => landingPerfNames.includes(i.name));
    const uxItems = perfCat.items.filter(i => !landingPerfNames.includes(i.name));
    if (landingPerfItems.length > 0) {
      // Merge into existing landing page category
      const existingLanding = allCategories.find(c => c.name === t('group.landing_page', lang));
      if (existingLanding) {
        existingLanding.items.push(...landingPerfItems);
      } else {
        allCategories.push({ name: t('group.landing_page', lang), items: landingPerfItems, group: 'soft' });
      }
    }
    if (uxItems.length > 0) allCategories.push({ name: t('group.user_experience', lang), items: uxItems, group: 'soft' });

    // Policy → hard
    const policyCat = checkPolicyCompliance(uniquePages, lang);
    allCategories.push({ ...policyCat, group: 'hard' });

    // AI → soft (value analysis with four-dimension scoring)
    // In pipeline mode, per-page analysis is already done. Just need overall suggestions.
    let pageAnalyses: PageAiAnalysis[] = aiAnalyses;
    if (!skipAi) {
      try {
        if (pageAnalyses.length === 0 && apiKeyResolved) {
          // Fallback: if pipeline didn't produce results, run analyzeWithAI
          progress(`AI analysis: ${uniquePages.length} pages...`);
          const aiResult = await analyzeWithAI(
            uniquePages.map((p, i) => {
              const sig = pages[i]?.signals ?? null;
              const et: 'game' | 'video' | 'none' = sig ? embedTypeFromSignals(sig) : 'none';
              const listingSignals = sig ? { listItems: sig.listItems, hasPagination: sig.hasPagination, hasCategories: sig.hasCategories, hasSearch: sig.hasSearch } : undefined;
              return { url: p.url, text: p.text, lang: (p as any).lang, embedType: et, listingSignals };
            }),
            lang, apiKey, progress, siteTopic, concurrency
          );
          pageAnalyses = aiResult.pageAnalyses;

          // AI value analysis category (displayed in report)
          const aiItems: CheckItem[] = [];
          if (aiResult.suggestions.length > 0) {
            aiItems.push({ name: t('item.ai.suggestions', lang), status: 'warn', message: t('ai.suggestion_count', lang, { count: aiResult.suggestions.length }), detailList: aiResult.suggestions });
          }
          allCategories.push({ name: t('group.ai_value', lang), items: aiItems, group: 'soft' });
        } else if (apiKeyResolved && pageAnalyses.length > 0) {
          // Pipeline already ran — just generate overall suggestions
          const langName = ['en', 'zh'].includes(lang) ? lang : 'en';
          const dateStr = new Date().toISOString().slice(0, 10);
          const overall = await analyzeOverall(pageAnalyses, langName, dateStr);
          if (overall.suggestions.length > 0) {
            allCategories.push({ name: t('group.ai_value', lang), items: [{ name: t('item.ai.suggestions', lang), status: 'warn', message: t('ai.suggestion_count', lang, { count: overall.suggestions.length }), detailList: overall.suggestions }], group: 'soft' });
          }
        }

        // Compliance hard check: flag pages with serious violations
        // Single-pass — AI prompt already handles false positive filtering
        const suspiciousPages = pageAnalyses.filter(a => {
          const c = a.complianceScore ?? 5;
          return c > 2 && c <= 5;
        });

        const seriousViolations = pageAnalyses.filter(a => (a.complianceScore ?? 5) <= 2);
        const complianceItems: CheckItem[] = [];
        if (seriousViolations.length > 0) {
          complianceItems.push({
            name: t('item.ai.compliance_serious', lang),
            status: 'fail',
            message: t('ai.compliance_serious', lang, { count: seriousViolations.length }),
            detailList: seriousViolations.map(a => new URL(a.url).pathname),
          });
        } else if (suspiciousPages.length > pageAnalyses.length * 0.2) {
          complianceItems.push({
            name: t('item.ai.compliance_suspicious', lang),
            status: 'warn',
            message: t('ai.compliance_suspicious', lang, { count: suspiciousPages.length, total: pageAnalyses.length }),
          });
        } else {
          complianceItems.push({
            name: t('item.ai.compliance_ok', lang),
            status: 'pass',
            message: t('ai.compliance_ok', lang),
          });
        }
        allCategories.push({ name: t('group.policy_compliance', lang), items: complianceItems, group: 'hard' });

        // If keyword check was 'fail' but AI compliance is strong, downgrade to 'warn'
        // The AI understands context; the keyword check is a blunt regex instrument
        const avgCompliance = pageAnalyses.length > 0
          ? pageAnalyses.reduce((s, a) => s + (a.complianceScore ?? 5), 0) / pageAnalyses.length
          : 5;
        if (avgCompliance >= 7) {
          const policyCat = allCategories.find(c => c.name === t('cat.policy', lang));
          if (policyCat) {
            const keywordItem = policyCat.items.find(i => i.name === t('item.policy.keywords', lang));
            if (keywordItem && keywordItem.status === 'fail') {
              keywordItem.status = 'warn';
            }
          }
        }
      } catch (err) {
        allCategories.push({ name: t('group.ai_value', lang), items: [{ name: 'AI', status: 'skip', message: t('ai.fail', lang, { error: err instanceof Error ? err.message : String(err) }) }], group: 'soft' });
      }
    }

    const pageDetails = buildPageDetails(uniquePages, pageAnalyses, siteType, lang, pages.map(p => p.signals));

    // Separate hard/soft categories
    const hardCategories = allCategories.filter(c => c.group === 'hard');
    const softCategories = allCategories.filter(c => c.group === 'soft');
    const allItems = allCategories.flatMap(c => c.items);

    // Compute composite score with AI value scoring
    const pageScoresForComposite = pageDetails.map(p => ({ pageType: p.pageType, score: p.score }));
    const { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty, siteAiScore, pageValueScore, pageValueEstimated, siteQuality, homeQuality } = computeCompositeScore(pageScoresForComposite, hardCategories, softCategories, pageAnalyses, contentDuplicationScore);

    // Per-dimension averages and stats (generic, iterates over all dimensions)
    const DIMENSION_KEYS: Array<{ key: 'valueScore' | 'originalityScore' | 'relevanceScore' | 'complianceScore' | 'translationScore'; name: string }> = [
      { key: 'valueScore', name: 'value' },
      { key: 'originalityScore', name: 'originality' },
      { key: 'relevanceScore', name: 'relevance' },
      { key: 'complianceScore', name: 'compliance' },
      { key: 'translationScore', name: 'translation' },
    ];
    const LOW_THRESHOLD = 6;

    const aiDimensionAverages: Record<string, number> = {};
    const aiDimensionStats: Record<string, { avg: number; min: number; lowCount: number; lowPct: number }> = {};

    if (pageAnalyses.length > 0) {
      for (const dim of DIMENSION_KEYS) {
        const scores = pageAnalyses.map(a => a[dim.key] ?? 5);
        const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10;
        const min = Math.min(...scores);
        const lowCount = scores.filter(s => s < LOW_THRESHOLD).length;
        aiDimensionAverages[dim.name] = avg;
        aiDimensionStats[dim.name] = { avg, min, lowCount, lowPct: Math.round(lowCount / scores.length * 1000) / 10 };
      }
    }

    // Rule-based approval probability (always computed)
    const partialReport: CheckReport = {
      url, timestamp: new Date().toISOString(), lang, siteType,
      siteTypeConfidence, siteTopic,
      samplingInfo: { pagesAnalyzed: uniquePages.length, aiAnalyzed: pageAnalyses.length, totalDiscovered: allInternal.length, confidence: uniquePages.length >= 10 ? 'high' : uniquePages.length >= 5 ? 'medium' : 'low' },
      categories: allCategories, hardCategories, softCategories,
      score: allItems.filter(i => i.status === 'pass').length,
      totalChecks: allItems.length,
      passed: allItems.filter(i => i.status === 'pass').length,
      warned: allItems.filter(i => i.status === 'warn').length,
      failed: allItems.filter(i => i.status === 'fail').length,
      skipped: allItems.filter(i => i.status === 'skip').length,
      pages: pageDetails,
      compositeScore, categoryScores, hardStatus, softScore,
      warningRatio, warningPenalty, siteAiScore, pageValueScore, pageValueEstimated, siteQuality, homeQuality, aiDimensionAverages, aiDimensionStats,
    };
    const approvalEstimate = estimateByRules(partialReport, lang);

    // Fast model final assessment (always runs with --ai)
    let fastSummary: CheckReport['fastSummary'] = undefined;
    let expertSummary: CheckReport['expertSummary'] = undefined;
    if (!skipAi && apiKeyResolved) {
      try {
        timing.start('ai-fast-summary');
        fastSummary = await summarizeFinal(
          { ...partialReport, approvalEstimate },
          lang,
          new Date().toISOString().slice(0, 10),
          false
        ) ?? undefined;
        timing.end();
      } catch { /* silent */ }

      // Expert model (only when --expert flag and models differ)
      if (expert) {
        const { getFastModel, getExpertModel } = await import('./ai/analyzer.js');
        if (getExpertModel() !== getFastModel()) {
          try {
            timing.start('ai-expert-summary');
            expertSummary = await summarizeFinal(
              { ...partialReport, approvalEstimate, fastSummary },
              lang,
              new Date().toISOString().slice(0, 10),
              true
            ) ?? undefined;
            timing.end();
            if (!expertSummary) {
              progress('Expert assessment: API returned empty result (model may not be available)');
            }
          } catch (e) {
            progress(`Expert assessment failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          progress(`Expert assessment: skipped (expert model "${getExpertModel()}" same as fast model)`);
        }
      }
    }

    timing.print();

    return {
      ...partialReport,
      approvalEstimate,
      fastSummary,
      expertSummary,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Site-wide basic info check: hard requirements only.
 * Fetches homepage for links/nav/footer, then runs required pages, site structure, and policy checks.
 * No content page crawl, no AI, no performance/DOM measurements.
 */
export async function checkSiteBasic(
  url: string,
  timeout: number,
  lang: Lang
): Promise<CheckReport> {
  const origin = new URL(url).origin;
  const browser = new BrowserManager();
  const timing = new TimingTracker();

  try {
    timing.start('launch');
    await browser.launch();
    timing.end();

    timing.start('homepage');
    const pg = await browser.newPage();
    const homeData = await fetchPage(pg, url, timeout);
    await pg.close();
    timing.end();

    // Sitemap URLs for required pages check
    const robotsSitemaps = await getSitemapFromRobots(origin);
    let sitemapUrls: string[] = [];
    try {
      const resp = await fetch(`${origin}/sitemap.xml`);
      if (resp.ok) {
        const text = await resp.text();
        const locs = text.match(/<loc>([^<]+)<\/loc>/g) || [];
        sitemapUrls = locs.map(l => l.replace(/<\/?loc>/g, ''));
      }
    } catch {}
    if (robotsSitemaps.length > 0 && sitemapUrls.length === 0) {
      for (const rs of robotsSitemaps) {
        try {
          const resp = await fetch(rs);
          if (resp.ok) {
            const text = await resp.text();
            const locs = text.match(/<loc>([^<]+)<\/loc>/g) || [];
            sitemapUrls.push(...locs.map(l => l.replace(/<\/?loc>/g, '')));
          }
        } catch {}
      }
    }

    // Required pages
    const pagesCat = await checkRequiredPages({ allLinks: homeData.linkDetails, navText: homeData.navText, footerText: homeData.footerText, sitemapUrls }, lang);

    // Site structure (excluding H1 + internal links — those belong to homepage quality)
    const structCat = await checkSiteStructure(origin, homeData.links, 0, [], lang);
    const landingStructNames = ['H1', t('item.structure.internal', lang)];
    const siteStructItems = structCat.items.filter(i => !landingStructNames.includes(i.name));

    // Policy (homepage text only)
    const policyCat = checkPolicyCompliance([{ url: homeData.url, text: homeData.text }], lang);

    // Site type detection (DOM signals only, no AI)
    const domResult = detectSiteType([homeData.signals], homeData.navText + ' ' + homeData.footerText, undefined);
    const siteType = domResult.type;
    const siteTypeConfidence = domResult.confidence;

    // Estimate site page count from sitemap + homepage links
    const allInternal = [...new Set([...homeData.links.filter(l => { try { return new URL(l).origin === origin; } catch { return false; } }), ...sitemapUrls.filter(u => { try { return new URL(u).origin === origin; } catch { return false; } })])];
    const estimatedPageCount = allInternal.length;

    // Content quality: only site scale check
    const contentResult = checkContentQuality([], estimatedPageCount, lang, siteType, []);
    const scaleItem = contentResult.category.items.find(i => i.name === t('item.content.scale', lang));

    // Build categories
    const allCategories: CheckCategory[] = [];
    if (scaleItem) {
      allCategories.push({ name: t('group.site_scale', lang), items: [scaleItem], group: 'hard' });
    }
    allCategories.push({ ...pagesCat, group: 'hard' });
    allCategories.push({ name: t('group.site_structure', lang), items: siteStructItems, group: 'hard' });
    allCategories.push({ ...policyCat, group: 'hard' });

    const hardCategories = allCategories.filter(c => c.group === 'hard');
    const softCategories: CheckCategory[] = [];
    const allItems = allCategories.flatMap(c => c.items);
    const hardItems = hardCategories.flatMap(c => c.items);

    timing.print();

    return {
      url,
      timestamp: new Date().toISOString(),
      lang,
      siteType,
      siteTypeConfidence,
      samplingInfo: { pagesAnalyzed: 1, aiAnalyzed: 0, totalDiscovered: allInternal.length, confidence: 'low' },
      categories: allCategories,
      hardCategories,
      softCategories,
      score: allItems.filter(i => i.status === 'pass').length,
      totalChecks: allItems.length,
      passed: allItems.filter(i => i.status === 'pass').length,
      warned: allItems.filter(i => i.status === 'warn').length,
      failed: allItems.filter(i => i.status === 'fail').length,
      skipped: allItems.filter(i => i.status === 'skip').length,
      pages: [],
      compositeScore: 0,
      categoryScores: allCategories.map(c => ({ name: c.name, score: categoryScoreValue(c), maxScore: c.items.length * 100 })),
      hardStatus: hardItems.some(i => i.status === 'fail') ? 'fail' : hardItems.some(i => i.status === 'warn') ? 'warn' : 'ready',
      softScore: 0,
      warningRatio: 0,
      warningPenalty: 0,
      siteAiScore: 0,
      pageValueScore: 0,
      pageValueEstimated: true,
      siteQuality: hardItems.length > 0 ? Math.round(hardItems.filter(i => i.status === 'pass').length / hardItems.length * 100) : 100,
      homeQuality: 0,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Homepage quality check: H1, internal links, load speed, viewport, overflow, font, heading, nav, touch, popup.
 * Needs Playwright for DOM measurements and performance timing.
 */
export async function checkHomeQuality(
  url: string,
  timeout: number,
  lang: Lang
): Promise<CheckReport> {
  const browser = new BrowserManager();
  const timing = new TimingTracker();

  try {
    timing.start('launch');
    await browser.launch();
    timing.end();

    timing.start('homepage');
    const pg = await browser.newPage();
    const homeData = await fetchPage(pg, url, timeout);
    timing.end();

    timing.start('h1');
    const h1Count = await pg.evaluate(() => document.querySelectorAll('h1').length);
    timing.end();

    // Performance checks (needs live page + browser for mobile context)
    const perfCat = await checkPerformance(pg, url, await browser.launch(), lang);
    await pg.close();

    // Landing page items: speed, viewport, overflow + H1 + internal links
    const landingPerfNames = [t('item.perf.speed', lang), 'Viewport', t('item.perf.overflow', lang)];
    const landingPerfItems = perfCat.items.filter(i => landingPerfNames.includes(i.name));
    const uxItems = perfCat.items.filter(i => !landingPerfNames.includes(i.name));

    // Structure items for landing page: H1 + internal links
    const structCat = await checkSiteStructure(url.replace(/\/+$/, '').split('/').slice(0, 3).join('/'), homeData.links, h1Count, [], lang);
    const landingStructNames = ['H1', t('item.structure.internal', lang)];
    const landingStructItems = structCat.items.filter(i => landingStructNames.includes(i.name));

    // Site type detection
    const domResult = detectSiteType([homeData.signals], homeData.navText + ' ' + homeData.footerText, undefined);
    const siteType = domResult.type;
    const siteTypeConfidence = domResult.confidence;

    // Homepage page detail
    const homePageDetail = buildPageDetails(
      [{ url: homeData.url, text: homeData.text, title: homeData.title, lang: homeData.pageInfo?.lang ?? 'en' }],
      [],
      siteType,
      lang,
      [homeData.signals]
    );

    // Build categories
    const allCategories: CheckCategory[] = [];

    // Landing page (soft)
    const landingItems: CheckItem[] = [...landingStructItems, ...landingPerfItems];
    if (landingItems.length > 0) {
      allCategories.push({ name: t('group.landing_page', lang), items: landingItems, group: 'soft' });
    }

    // UX (soft)
    if (uxItems.length > 0) {
      allCategories.push({ name: t('group.user_experience', lang), items: uxItems, group: 'soft' });
    }

    const hardCategories: CheckCategory[] = [];
    const softCategories = allCategories.filter(c => c.group === 'soft');
    const allItems = allCategories.flatMap(c => c.items);
    const softLanding = softCategories.find(c => c.name === t('group.landing_page', lang));

    const homeQuality = softLanding && softLanding.items.length > 0
      ? Math.round(softLanding.items.filter(i => i.status === 'pass').length / softLanding.items.length * 100)
      : 100;

    timing.print();

    return {
      url,
      timestamp: new Date().toISOString(),
      lang,
      siteType,
      siteTypeConfidence,
      samplingInfo: { pagesAnalyzed: 1, aiAnalyzed: 0, totalDiscovered: 0, confidence: 'low' },
      categories: allCategories,
      hardCategories,
      softCategories,
      score: allItems.filter(i => i.status === 'pass').length,
      totalChecks: allItems.length,
      passed: allItems.filter(i => i.status === 'pass').length,
      warned: allItems.filter(i => i.status === 'warn').length,
      failed: allItems.filter(i => i.status === 'fail').length,
      skipped: allItems.filter(i => i.status === 'skip').length,
      pages: homePageDetail,
      compositeScore: 0,
      categoryScores: allCategories.map(c => ({ name: c.name, score: categoryScoreValue(c), maxScore: c.items.length * 100 })),
      hardStatus: 'ready',
      softScore: 0,
      warningRatio: 0,
      warningPenalty: 0,
      siteAiScore: 0,
      pageValueScore: 0,
      pageValueEstimated: true,
      siteQuality: 0,
      homeQuality,
    };
  } finally {
    await browser.close();
  }
}

function categoryScoreValue(cat: CheckCategory): number {
  if (cat.items.length === 0) return 100;
  return cat.items.reduce((s, i) => s + (i.status === 'pass' ? 100 : i.status === 'warn' ? 40 : 0), 0);
}
