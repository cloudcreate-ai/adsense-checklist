import type { CheckReport, CheckOptions, CheckCategory, CheckItem, PageDetail, Lang, SiteType, SiteTopic } from './types.js';
import { BrowserManager, fetchPage, fetchSitemapUrls, isContentUrl } from './browser.js';
import { checkContentQuality } from './checks/content.js';
import { checkRequiredPages } from './checks/pages.js';
import { checkSiteStructure } from './checks/structure.js';
import { checkPerformance } from './checks/performance.js';
import { checkPolicyCompliance } from './checks/policy.js';
import { analyzeWithAI, recheckCompliance, type PageAiAnalysis } from './ai/analyzer.js';
import { analyzeSiteTopic } from './ai/topic.js';
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
    const ai = aiMap.get(page.url);
    const aiStatus = ai?.status;
    const relevance = ai?.relevance;
    const pageType = ai?.inferredPageType ?? classifyPage(page.url);

    // Skip content depth checks for required/utility pages — they don't need 300+ chars of editorial content
    const isFunctional = pageType === 'required' || pageType === 'utility';
    if (siteType === 'content' && !isFunctional) {
      if (contentRatio < 30 && totalChars > 200) { issues.push(`Content ratio only ${contentRatio}%, mostly boilerplate`); contentStatus = 'fail'; }
      if (contentChars < 300) { issues.push(`Thin content (${contentChars} chars)`); contentStatus = contentStatus === 'fail' ? 'fail' : 'warn'; }
    }
    const { score } = scorePage(pageType, contentChars, contentRatio, issues, siteType, aiStatus);
    const detail: PageDetail = { url: page.url, title: page.title, pageType, totalChars, contentChars, contentRatio, contentStatus, issues, score };
    if (relevance) detail.relevance = relevance;
    if (ai) detail.ai = {
      status: ai.status,
      valueScore: ai.valueScore,
      originalityScore: ai.originalityScore,
      relevanceScore: ai.relevanceScore,
      complianceScore: ai.complianceScore,
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
  const { url, maxCrawl = 50, maxPages = 50, maxContent = 20, sampleMin = 20, sampleRatio = 0.2, skipAi = false, timeout = 30000, apiKey, lang = 'en', siteType: manualType, onProgress } = options;

  // Cap phase limits by total crawl budget
  const phase1Limit = Math.min(maxPages, maxCrawl);
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

    // AI topic analysis (runs early, after homepage is fetched)
    let siteTopic: SiteTopic | undefined;
    if (!skipAi) {
      try {
        const apiKeyResolved = apiKey || process.env.AI_API_KEY;
        if (apiKeyResolved) {
          progress('AI: analyzing site topic...');
          siteTopic = await analyzeSiteTopic(
            { title: homeData.title, text: homeData.text, navText: homeData.navText + ' ' + homeData.footerText },
            lang,
            apiKeyResolved
          );
          progress(`AI: site type = ${siteTopic.type}, topic = ${siteTopic.topic}`);
        }
      } catch {}
    }

    const pages: Array<{ url: string; text: string; title: string; links: string[] }> = [
      { url: homeData.url, text: homeData.text, title: homeData.title, links: homeData.links },
    ];
    const allSignals: PageSignals[] = [homeData.signals];

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
    const sitemapInternal = sitemapUrls.filter(u => { try { return new URL(u).origin === origin && isContentUrl(u); } catch { return false; } });
    const allInternal = [...new Set([...internalLinks, ...sitemapInternal])];
    const uniqueLinks = allInternal.slice(0, phase1Limit);

    const deadLinks: string[] = [];
    const crawledUrls = new Set([homeData.url.replace(/\/+$/, '')]);

    async function crawlPage(link: string) {
      const norm = link.replace(/\/+$/, '').split('#')[0];
      if (crawledUrls.has(norm)) return;
      crawledUrls.add(norm);
      try {
        const pg = await browser.newPage();
        const data = await fetchPage(pg, link, timeout);
        const postNorm = data.url.replace(/\/+$/, '').split('#')[0];
        // Skip if SPA navigation resolved to an already-crawled page
        if (crawledUrls.has(postNorm) && postNorm !== norm) {
          await pg.close();
          return;
        }
        crawledUrls.add(postNorm);
        if (data.status >= 400) { deadLinks.push(`${link} (${data.status})`); }
        else {
          pages.push({ url: data.url, text: data.text, title: data.title, links: data.links });
          allSignals.push(data.signals);
        }
        await pg.close();
      } catch { deadLinks.push(`${link} (timeout)`); }
    }

    // Phase 1: Crawl initial batch
    progress(`Phase 1: Crawling ${uniqueLinks.length} pages...`);
    for (let i = 0; i < uniqueLinks.length; i++) {
      const link = uniqueLinks[i];
      progress(`Phase 1: [${i + 1}/${uniqueLinks.length}] ${new URL(link).pathname}${new URL(link).search}`);
      await crawlPage(link);
    }

    // Phase 2: Discover content pages (recursively through listing pages)
    const CHILDREN_PER_LISTING = 10;
    const MAX_DISCOVERY_DEPTH = 3;
    const discoveredContent = new Set<string>();

    // BFS discovery: follow listing pages up to MAX_DISCOVERY_DEPTH
    const discoveryQueue: Array<{ url: string; links: string[]; depth: number }> =
      pages.map(p => ({ url: p.url, links: p.links, depth: 0 }));
    const seenInDiscovery = new Set<string>([...crawledUrls].map(u => u.replace(/\/+$/, '').split('#')[0]));

    while (discoveryQueue.length > 0) {
      const current = discoveryQueue.shift()!;
      if (current.depth > MAX_DISCOVERY_DEPTH) continue;
      const children = discoverChildLinks(current.url, current.links, origin, CHILDREN_PER_LISTING);
      for (const child of children) {
        const norm = child.replace(/\/+$/, '');
        if (seenInDiscovery.has(norm)) continue;
        seenInDiscovery.add(norm);
        const pt = classifyPage(child);
        if (pt === 'listing') {
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
        if (pt !== 'listing') {
          discoveredContent.add(smUrl);
        }
      }
    }

    // Sort by freshness (newest first) then take maxContent, capped by remaining crawl budget
    const remainingBudget = Math.max(0, maxCrawl - crawledUrls.size);
    const phase2Limit = Math.min(maxContent, remainingBudget);
    const sortedContent = sortByFreshness([...discoveredContent]);
    const toCrawl = sortedContent.slice(0, phase2Limit);
    if (toCrawl.length > 0) progress(`Phase 2: Crawling ${toCrawl.length} content pages (from ${discoveredContent.size} discovered)...`);
    for (let i = 0; i < toCrawl.length; i++) {
      const link = toCrawl[i];
      progress(`Phase 2: [${i + 1}/${toCrawl.length}] ${new URL(link).pathname}${new URL(link).search}`);
      await crawlPage(link);

      // After crawling a page, check if it has deeper content links we missed
      const crawledPage = pages[pages.length - 1];
      if (crawledPage && crawledPage.url === link) {
        const deeperChildren = discoverChildLinks(link, crawledPage.links, origin, CHILDREN_PER_LISTING);
        for (const dc of deeperChildren) {
          const dnorm = dc.replace(/\/+$/, '');
          if (!crawledUrls.has(dnorm) && !discoveredContent.has(dnorm) && classifyPage(dc) !== 'listing') {
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

    // Sampling stats
    const totalDiscovered = discoveredContent.size;
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const recentCount = [...discoveredContent].filter(u => freshnessScore(u) >= sixMonthsAgo).length;
    const sampledCount = toCrawl.length;
    const samplePct = totalDiscovered > 0 ? Math.round((sampledCount / totalDiscovered) * 100) : 0;
    const confidence = samplePct >= 50 ? 'high' : samplePct >= 20 ? 'medium' : 'low';
    progress(`Pages: ${totalDiscovered} discovered, ${recentCount} recent (6mo), ${sampledCount} sampled (${samplePct}%, confidence: ${confidence})`);

    // Detect site type: prefer AI topic, fallback to DOM signals
    progress('Detecting site type...');
    const domResult = detectSiteType(allSignals, homeData.navText + ' ' + homeData.footerText, manualType);
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

    // AI → soft (value analysis with four-dimension scoring)
    let pageAnalyses: PageAiAnalysis[] = [];
    if (!skipAi) {
      try {
        progress(`AI analysis: ${uniquePages.length} pages...`);
        const aiResult = await analyzeWithAI(uniquePages, lang, apiKey, progress, siteTopic);
        pageAnalyses = aiResult.pageAnalyses;

        // AI value analysis category (displayed in report)
        const aiItems: CheckItem[] = [];
        if (aiResult.suggestions.length > 0) {
          aiItems.push({ name: t('item.ai.suggestions', lang), status: 'warn', message: t('ai.suggestion_count', lang, { count: aiResult.suggestions.length }), detailList: aiResult.suggestions });
        }
        allCategories.push({ name: t('group.ai_value', lang), items: aiItems, group: 'soft' });

        // Compliance hard check: flag pages with serious violations
        let suspiciousPages = pageAnalyses.filter(a => {
          const c = a.complianceScore ?? 5;
          return c > 2 && c <= 5;
        });

        // Also recheck very low-score pages with short text (likely 404/error pages being false-flagged)
        const shortTextPages = pageAnalyses.filter(a => {
          const c = a.complianceScore ?? 5;
          const text = uniquePages.find(up => up.url === a.url)?.text ?? '';
          return c <= 2 && text.replace(/\s+/g, '').length < 200;
        });
        const recheckUrls = new Set(suspiciousPages.map(p => p.url));
        for (const p of shortTextPages) {
          if (!recheckUrls.has(p.url)) {
            suspiciousPages.push(p);
            recheckUrls.add(p.url);
          }
        }

        // Second-pass compliance check for suspicious pages to reduce false positives
        if (suspiciousPages.length > 0) {
          const apiKeyResolved2 = apiKey || process.env.AI_API_KEY;
          if (apiKeyResolved2) {
            const recheckResults = await recheckCompliance(
              suspiciousPages.map(p => ({
                url: p.url,
                text: uniquePages.find(up => up.url === p.url)?.text ?? '',
                firstComplianceScore: p.complianceScore ?? 5,
              })),
              lang,
              progress
            );
            // Update page analyses with re-checked scores
            for (const analysis of pageAnalyses) {
              const recheck = recheckResults.get(analysis.url);
              if (recheck) {
                analysis.complianceScore = recheck.complianceScore;
              }
            }
            // Recompute statuses based on updated scores
            for (const analysis of pageAnalyses) {
              const v = analysis.valueScore ?? 5;
              const o = analysis.originalityScore ?? 5;
              const r = analysis.relevanceScore ?? 5;
              const c = analysis.complianceScore ?? 5;
              const geoMean = Math.pow(v * o * r * c, 0.25);
              analysis.status = geoMean >= 7 ? 'pass' : geoMean >= 4 ? 'warn' : 'fail';
            }
            // Recompute suspicious pages after re-check
            suspiciousPages = pageAnalyses.filter(a => {
              const c = a.complianceScore ?? 5;
              return c > 2 && c <= 5;
            });
          }
        }

        const seriousViolations = pageAnalyses.filter(a => (a.complianceScore ?? 5) <= 2);
        const complianceItems: CheckItem[] = [];
        if (seriousViolations.length > 0) {
          complianceItems.push({
            name: t('item.ai.compliance_serious', lang),
            status: 'fail',
            message: t('ai.compliance_serious', lang, { count: seriousViolations.length }),
            detail: seriousViolations.map(a => new URL(a.url).pathname).join('; '),
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

    const pageDetails = buildPageDetails(uniquePages, pageAnalyses, siteType);

    // Separate hard/soft categories
    const hardCategories = allCategories.filter(c => c.group === 'hard');
    const softCategories = allCategories.filter(c => c.group === 'soft');
    const allItems = allCategories.flatMap(c => c.items);

    // Compute composite score with AI value scoring
    const pageScoresForComposite = pageDetails.map(p => ({ pageType: p.pageType, score: p.score }));
    const { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty, siteAiScore } = computeCompositeScore(pageScoresForComposite, hardCategories, softCategories, pageAnalyses);

    // Per-dimension averages
    const aiDimensionAverages = pageAnalyses.length > 0 ? {
      value: Math.round(pageAnalyses.reduce((s, a) => s + (a.valueScore ?? 5), 0) / pageAnalyses.length * 10) / 10,
      originality: Math.round(pageAnalyses.reduce((s, a) => s + (a.originalityScore ?? 5), 0) / pageAnalyses.length * 10) / 10,
      relevance: Math.round(pageAnalyses.reduce((s, a) => s + (a.relevanceScore ?? 5), 0) / pageAnalyses.length * 10) / 10,
      compliance: Math.round(pageAnalyses.reduce((s, a) => s + (a.complianceScore ?? 5), 0) / pageAnalyses.length * 10) / 10,
    } : undefined;

    return {
      url, timestamp: new Date().toISOString(), lang, siteType,
      siteTypeConfidence,
      siteTopic,
      samplingInfo: { totalDiscovered, recentCount, sampledCount, samplePct, confidence },
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
      siteAiScore,
      aiDimensionAverages,
    };
  } finally {
    await browser.close();
  }
}
