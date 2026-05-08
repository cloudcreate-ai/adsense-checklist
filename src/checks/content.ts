import type { CheckCategory, CheckItem } from '../types.js';

/**
 * Extract main content text by stripping navigation, footer, sidebar boilerplate.
 * Works by comparing text across pages to find common (boilerplate) vs unique (content).
 */
function extractMainContent(text: string, allPageTexts: string[]): string {
  // Split into paragraphs
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  if (allPageTexts.length <= 1) return paragraphs.join('\n\n');

  // Find boilerplate: lines that appear on most other pages
  const otherTexts = allPageTexts.filter(t => t !== text);
  const threshold = Math.ceil(otherTexts.length * 0.6);

  const contentParagraphs = paragraphs.filter(para => {
    if (para.length < 20) return true; // too short to be boilerplate
    const normalized = para.replace(/\s+/g, ' ').slice(0, 100);
    const appearanceCount = otherTexts.filter(other =>
      other.replace(/\s+/g, ' ').includes(normalized)
    ).length;
    return appearanceCount < threshold;
  });

  return contentParagraphs.join('\n\n');
}

/**
 * Calculate content-to-total ratio for a page.
 * Returns the ratio of main content chars to total page chars.
 */
function contentRatio(pageText: string, mainContent: string): number {
  const total = pageText.replace(/\s+/g, '').length;
  if (total === 0) return 0;
  return mainContent.replace(/\s+/g, '').length / total;
}

/**
 * Detect filler/padding patterns that indicate low-value content.
 */
function detectFillerPatterns(text: string): { count: number; examples: string[] } {
  const fillers: RegExp[] = [
    /(?:总之|综上所述|总的来说|简单来说|众所周知|毫无疑问|显而易见|毋庸置疑)/g,
    /(?:in conclusion|as we all know|it goes without saying|needless to say|obviously)/gi,
    /(.{10,30})\1{3,}/g, // repeated phrases (e.g. "this is great this is great this is great")
    /(?:点击这里|了解更多|查看更多|click here|read more|learn more|check out){2,}/gi,
  ];

  const examples: string[] = [];
  let count = 0;

  for (const pattern of fillers) {
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
      examples.push(...matches.slice(0, 2));
    }
  }

  return { count, examples: examples.slice(0, 5) };
}

/**
 * Detect template-like pages: pages with high structural similarity
 * but different words (suggests mass-produced content).
 */
function detectTemplatePages(
  pages: Array<{ url: string; text: string }>
): { isTemplate: boolean; similarity: number; details: string } {
  if (pages.length < 3) return { isTemplate: false, similarity: 0, details: '' };

  // Extract sentence structures (replace words with placeholders)
  const structures = pages.map(p => {
    return p.text
      .replace(/[a-zA-Z一-鿿]+/g, 'W') // replace words with W
      .replace(/\d+/g, 'N')                      // replace numbers with N
      .replace(/\s+/g, ' ')                       // normalize whitespace
      .slice(0, 1000);
  });

  // Compare pairwise similarity of structures
  let totalSimilarity = 0;
  let pairs = 0;

  for (let i = 0; i < structures.length; i++) {
    for (let j = i + 1; j < structures.length; j++) {
      const a = structures[i];
      const b = structures[j];
      const longer = a.length > b.length ? a : b;
      const shorter = a.length > b.length ? b : a;

      // Simple similarity: longest common substring ratio
      let common = 0;
      for (let k = 0; k < shorter.length; k++) {
        if (shorter[k] === longer[k]) common++;
      }
      totalSimilarity += common / longer.length;
      pairs++;
    }
  }

  const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;

  return {
    isTemplate: avgSimilarity > 0.6,
    similarity: Math.round(avgSimilarity * 100),
    details: avgSimilarity > 0.6
      ? `页面结构相似度 ${Math.round(avgSimilarity * 100)}%，疑似模板批量生成`
      : '',
  };
}

/**
 * Check content freshness: look for dates in content and assess recency.
 */
function checkFreshness(
  pages: Array<{ url: string; text: string }>
): { hasRecentContent: boolean; latestDate: string; stalePages: string[] } {
  const datePatterns = [
    /(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/g,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/gi,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/gi,
  ];

  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  let latestDate = '';
  let latestDateObj = new Date(0);
  const stalePages: string[] = [];
  let hasAnyDate = false;

  for (const page of pages) {
    let pageHasRecentDate = false;
    for (const pattern of datePatterns) {
      const matches = [...page.text.matchAll(pattern)];
      for (const match of matches) {
        hasAnyDate = true;
        try {
          let dateStr: string;
          if (pattern.source.includes('January|February')) {
            dateStr = `${match[1]} ${match[2]} ${match[3]}`;
          } else if (pattern.source.includes('Jan|Feb')) {
            dateStr = `${match[1]} ${match[2]} ${match[3]}`;
          } else {
            dateStr = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
          }
          const d = new Date(dateStr);
          if (!isNaN(d.getTime()) && d > new Date('2020-01-01') && d <= now) {
            if (d > latestDateObj) {
              latestDateObj = d;
              latestDate = dateStr;
            }
            if (d >= sixMonthsAgo) pageHasRecentDate = true;
          }
        } catch { /* ignore */ }
      }
    }
    if (!pageHasRecentDate && page.text.length > 200) {
      stalePages.push(page.url);
    }
  }

  return {
    hasRecentContent: hasAnyDate && latestDateObj >= sixMonthsAgo,
    latestDate: latestDate || '未检测到日期',
    stalePages,
  };
}

export function checkContentQuality(
  pages: Array<{ url: string; text: string; title: string }>,
  sitePageCount?: number
): CheckCategory {
  const items: CheckItem[] = [];
  const allTexts = pages.map(p => p.text);

  // === 1. Main content ratio (core low-value check) ===
  const lowRatioPages: Array<{ url: string; ratio: number; contentChars: number }> = [];

  for (const page of pages) {
    const mainContent = extractMainContent(page.text, allTexts);
    const ratio = contentRatio(page.text, mainContent);
    const contentChars = mainContent.replace(/\s+/g, '').length;

    if (ratio < 0.3 && page.text.replace(/\s+/g, '').length > 200) {
      lowRatioPages.push({ url: page.url, ratio: Math.round(ratio * 100), contentChars });
    }
  }

  if (lowRatioPages.length > 0) {
    const details = lowRatioPages
      .map(p => `${new URL(p.url).pathname}: 正文占比 ${p.ratio}% (${p.contentChars} 字)`)
      .join('; ');
    items.push({
      name: '有效内容比率',
      status: 'fail',
      message: `${lowRatioPages.length} 个页面正文占比过低（<30%），大量内容为导航/页脚等模板元素`,
      detail: details,
    });
  } else {
    items.push({
      name: '有效内容比率',
      status: 'pass',
      message: '各页面正文占比正常，模板元素占比合理',
    });
  }

  // === 2. Per-page content depth ===
  let thinPages = 0;
  for (const page of pages) {
    const mainContent = extractMainContent(page.text, allTexts);
    const contentChars = mainContent.replace(/\s+/g, '').length;

    if (pages.indexOf(page) === 0) {
      if (contentChars >= 500) {
        items.push({
          name: '首页实质内容',
          status: 'pass',
          message: `首页正文内容充足 (${contentChars.toLocaleString()} 字)`,
        });
      } else {
        items.push({
          name: '首页实质内容',
          status: 'fail',
          message: `首页正文内容不足 (${contentChars} 字，建议 500+ 字)`,
        });
      }
    } else {
      if (contentChars < 300) thinPages++;
    }
  }

  if (pages.length > 1) {
    if (thinPages > 0) {
      items.push({
        name: '内页内容深度',
        status: thinPages > pages.length * 0.5 ? 'fail' : 'warn',
        message: `${thinPages}/${pages.length - 1} 个内页正文内容不足 (<300 字)`,
      });
    } else {
      items.push({
        name: '内页内容深度',
        status: 'pass',
        message: '所有内页正文内容充足',
      });
    }
  }

  // === 3. Template detection ===
  const templateResult = detectTemplatePages(pages);
  if (pages.length >= 3) {
    items.push({
      name: '模板化检测',
      status: templateResult.isTemplate ? 'fail' : 'pass',
      message: templateResult.isTemplate
        ? templateResult.details
        : `页面结构多样性正常 (相似度 ${templateResult.similarity}%)`,
    });
  }

  // === 4. Filler content detection ===
  let totalFiller = 0;
  const fillerExamples: string[] = [];
  for (const page of pages) {
    const filler = detectFillerPatterns(page.text);
    totalFiller += filler.count;
    fillerExamples.push(...filler.examples);
  }
  if (totalFiller > pages.length * 3) {
    items.push({
      name: '凑字数检测',
      status: 'warn',
      message: `检测到 ${totalFiller} 处疑似凑字数的填充内容`,
      detail: fillerExamples.slice(0, 3).join('; '),
    });
  } else {
    items.push({
      name: '凑字数检测',
      status: 'pass',
      message: '未检测到明显的填充/凑字数内容',
    });
  }

  // === 5. Content uniqueness (enhanced) ===
  if (pages.length > 1) {
    // Segment-level dedup: split into chunks and compare
    const chunkSize = 200;
    let duplicatedChunks = 0;
    const allChunks = new Set<string>();

    for (const page of pages) {
      const text = page.text.replace(/\s+/g, ' ');
      for (let i = 0; i < text.length - chunkSize; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        if (allChunks.has(chunk)) {
          duplicatedChunks++;
        } else {
          allChunks.add(chunk);
        }
      }
    }

    const totalChunks = pages.reduce((sum, p) =>
      sum + Math.max(1, Math.floor((p.text.replace(/\s+/g, ' ').length) / chunkSize)), 0);
    const dupRatio = totalChunks > 0 ? duplicatedChunks / totalChunks : 0;

    if (dupRatio > 0.3) {
      items.push({
        name: '跨页内容重复',
        status: 'warn',
        message: `${Math.round(dupRatio * 100)}% 的内容片段在多个页面重复出现`,
      });
    } else {
      items.push({
        name: '跨页内容重复',
        status: 'pass',
        message: `各页面内容独立性良好 (重复率 ${Math.round(dupRatio * 100)}%)`,
      });
    }
  }

  // === 6. Content freshness ===
  const freshness = checkFreshness(pages);
  if (freshness.hasRecentContent) {
    items.push({
      name: '内容新鲜度',
      status: 'pass',
      message: `最近有更新内容 (最新: ${freshness.latestDate})`,
    });
  } else if (freshness.latestDate !== '未检测到日期') {
    items.push({
      name: '内容新鲜度',
      status: 'warn',
      message: `最近更新: ${freshness.latestDate}，超过 6 个月未更新`,
      detail: freshness.stalePages.length > 0
        ? `无近期日期的页面: ${freshness.stalePages.map(u => new URL(u).pathname).join(', ')}`
        : '',
    });
  } else {
    items.push({
      name: '内容新鲜度',
      status: 'warn',
      message: '页面中未检测到日期信息，无法判断内容时效性',
    });
  }

  // === 7. Site scale ===
  if (sitePageCount !== undefined) {
    if (sitePageCount < 10) {
      items.push({
        name: '站点规模',
        status: 'warn',
        message: `站点仅 ${sitePageCount} 个页面（建议至少 10+ 个有价值的内容页）`,
      });
    } else if (sitePageCount < 30) {
      items.push({
        name: '站点规模',
        status: 'pass',
        message: `站点有 ${sitePageCount} 个页面`,
      });
    } else {
      items.push({
        name: '站点规模',
        status: 'pass',
        message: `站点规模良好 (${sitePageCount} 个页面)`,
      });
    }
  }

  return { name: 'Content Quality', items };
}
