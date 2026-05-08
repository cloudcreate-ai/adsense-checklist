import type { CheckReport, CheckOptions, CheckCategory, CheckItem, PageDetail } from './types.js';
import { BrowserManager, fetchPage, fetchSitemapUrls } from './browser.js';
import { checkContentQuality } from './checks/content.js';
import { checkRequiredPages } from './checks/pages.js';
import { checkSiteStructure } from './checks/structure.js';
import { checkPerformance } from './checks/performance.js';
import { checkPolicyCompliance } from './checks/policy.js';
import { analyzeWithAI, type PageAiAnalysis } from './ai/analyzer.js';

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

function buildPageDetails(
  pages: Array<{ url: string; text: string; title: string }>,
  aiAnalyses: PageAiAnalysis[]
): PageDetail[] {
  const allTexts = pages.map(p => p.text);
  const aiMap = new Map(aiAnalyses.map(a => [a.url, a]));

  return pages.map(page => {
    const totalChars = page.text.replace(/\s+/g, '').length;
    const mainContent = extractMainContent(page.text, allTexts);
    const contentChars = mainContent.replace(/\s+/g, '').length;
    const contentRatio = totalChars > 0 ? Math.round((contentChars / totalChars) * 100) : 0;

    const issues: string[] = [];
    let contentStatus: 'pass' | 'warn' | 'fail' = 'pass';

    if (contentRatio < 30 && totalChars > 200) {
      issues.push(`正文占比仅 ${contentRatio}%，大量模板元素`);
      contentStatus = 'fail';
    }
    if (contentChars < 300) {
      issues.push(`正文内容不足 (${contentChars} 字)`);
      contentStatus = contentStatus === 'fail' ? 'fail' : 'warn';
    }

    const ai = aiMap.get(page.url);
    const detail: PageDetail = {
      url: page.url,
      title: page.title,
      totalChars,
      contentChars,
      contentRatio,
      contentStatus,
      issues,
    };

    if (ai) {
      detail.ai = {
        status: ai.status,
        assessment: ai.assessment,
        suggestions: ai.suggestions,
      };
    }

    return detail;
  });
}

export async function check(options: CheckOptions): Promise<CheckReport> {
  const { url, depth = 10, skipAi = false, timeout = 30000, apiKey } = options;
  const origin = new URL(url).origin;
  const browser = new BrowserManager();

  try {
    // Fetch homepage
    const homepage = await browser.newPage();
    const homeData = await fetchPage(homepage, url, timeout);
    const h1Count = await homepage.evaluate(
      () => document.querySelectorAll('h1').length
    );

    // Fetch sitemap URLs
    const sitemapUrls = await fetchSitemapUrls(origin);

    // Collect pages for analysis
    const pages: Array<{ url: string; text: string; title: string }> = [
      { url: homeData.url, text: homeData.text, title: homeData.title },
    ];

    // Sample internal links for deeper analysis
    const internalLinks = homeData.links.filter(l => {
      try {
        return new URL(l).origin === origin;
      } catch {
        return false;
      }
    });
    // Merge links from page + sitemap for better coverage
    const sitemapInternal = sitemapUrls.filter(u => {
      try { return new URL(u).origin === origin; } catch { return false; }
    });
    const allInternal = [...new Set([...internalLinks, ...sitemapInternal])];
    const uniqueLinks = allInternal.slice(0, depth);

    // Track dead links
    const deadLinks: string[] = [];

    for (const link of uniqueLinks) {
      if (link === url) continue;
      try {
        const page = await browser.newPage();
        const resp = await page.goto(link, { waitUntil: 'domcontentloaded', timeout });
        const status = resp?.status() ?? 0;
        if (status >= 400) {
          deadLinks.push(`${link} (${status})`);
        } else {
          const data = await fetchPage(page, link, timeout);
          pages.push({ url: link, text: data.text, title: data.title });
        }
        await page.close();
      } catch {
        deadLinks.push(`${link} (timeout/error)`);
      }
    }

    // Deduplicate pages by normalized URL (strip trailing slash and hash)
    const seen = new Set<string>();
    const uniquePages = pages.filter(p => {
      const normalized = p.url.replace(/\/+$/, '').split('#')[0];
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    // Run all checks
    const categories: CheckCategory[] = [];

    categories.push(checkContentQuality(uniquePages, allInternal.length));
    categories.push(await checkRequiredPages({
      allLinks: homeData.linkDetails,
      navText: homeData.navText,
      footerText: homeData.footerText,
      sitemapUrls,
    }));
    categories.push(await checkSiteStructure(origin, homeData.links, h1Count, deadLinks));

    // Performance check on a fresh page
    const playBrowser = await browser.launch();
    const perfPage = await browser.newPage();
    categories.push(await checkPerformance(perfPage, url, playBrowser));
    await perfPage.close();

    categories.push(checkPolicyCompliance(uniquePages));

    // AI analysis (overall + per-page)
    let pageAnalyses: PageAiAnalysis[] = [];
    if (!skipAi) {
      try {
        const aiResult = await analyzeWithAI(uniquePages, apiKey);
        pageAnalyses = aiResult.pageAnalyses;

        const aiCategory: CheckCategory = {
          name: 'AI Content Analysis',
          items: [
            {
              name: '内容质量评估',
              status: aiResult.contentQuality.status,
              message: aiResult.contentQuality.detail.slice(0, 200),
            },
            {
              name: '原创性评估',
              status: aiResult.originality.status,
              message: aiResult.originality.detail.slice(0, 200),
            },
            {
              name: '合规性评估',
              status: aiResult.compliance.status,
              message: aiResult.compliance.detail.slice(0, 200),
            },
          ],
        };
        if (aiResult.suggestions.length > 0) {
          aiCategory.items.push({
            name: 'AI 建议',
            status: 'warn',
            message: `${aiResult.suggestions.length} 条改进建议`,
            detail: aiResult.suggestions.join('; '),
          });
        }
        categories.push(aiCategory);
      } catch (err) {
        categories.push({
          name: 'AI Content Analysis',
          items: [
            {
              name: 'AI 分析',
              status: 'skip',
              message: `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        });
      }
    }

    // Build per-page details
    const pageDetails = buildPageDetails(uniquePages, pageAnalyses);

    // Calculate score
    const allItems = categories.flatMap(c => c.items);
    const passed = allItems.filter(i => i.status === 'pass').length;
    const warned = allItems.filter(i => i.status === 'warn').length;
    const failed = allItems.filter(i => i.status === 'fail').length;
    const skipped = allItems.filter(i => i.status === 'skip').length;

    return {
      url,
      timestamp: new Date().toISOString(),
      categories,
      score: passed,
      totalChecks: allItems.length,
      passed,
      warned,
      failed,
      skipped,
      pages: pageDetails,
    };
  } finally {
    await browser.close();
  }
}
