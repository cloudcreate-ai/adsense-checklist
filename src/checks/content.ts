import type { CheckCategory, CheckItem, Lang, SiteType } from '../types.js';
import { t } from '../i18n.js';

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

function detectTemplatePages(pages: Array<{ url: string; text: string }>): {
  isTemplate: boolean;
  similarity: number;
  clusterCount: number;
  maxPair: [string, string];
} {
  if (pages.length < 3) return { isTemplate: false, similarity: 0, clusterCount: 0, maxPair: ['', ''] };

  const skeletons = pages.map(p => ({
    url: p.url,
    text: p.text.replace(/[a-zA-Z一-鿿]+/g, 'W').replace(/\d+/g, 'N').replace(/\s+/g, ' ').slice(0, 1000),
  }));

  const SIM_THRESHOLD = 0.6;
  let maxSim = 0;
  let maxPair: [string, string] = ['', ''];
  const edges: Array<[number, number]> = [];

  for (let i = 0; i < skeletons.length; i++) {
    for (let j = i + 1; j < skeletons.length; j++) {
      const a = skeletons[i].text;
      const b = skeletons[j].text;
      const longer = a.length > b.length ? a : b;
      const shorter = a.length > b.length ? b : a;
      if (longer.length === 0) continue;
      let common = 0;
      for (let k = 0; k < shorter.length; k++) { if (shorter[k] === longer[k]) common++; }
      const sim = common / longer.length;
      if (sim > maxSim) { maxSim = sim; maxPair = [skeletons[i].url, skeletons[j].url]; }
      if (sim >= SIM_THRESHOLD) edges.push([i, j]);
    }
  }

  // Union-Find to build connected components
  const parent = new Array(skeletons.length).fill(0).map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const [i, j] of edges) union(i, j);

  // Largest cluster size
  const clusterSizes = new Map<number, number>();
  for (let i = 0; i < skeletons.length; i++) {
    const root = find(i);
    clusterSizes.set(root, (clusterSizes.get(root) || 0) + 1);
  }
  let clusterCount = 0;
  for (const size of clusterSizes.values()) { if (size > clusterCount) clusterCount = size; }

  return {
    isTemplate: maxSim > SIM_THRESHOLD && clusterCount >= 3,
    similarity: Math.round(maxSim * 100),
    clusterCount,
    maxPair,
  };
}

function checkFreshness(pages: Array<{ url: string; text: string }>): { hasRecent: boolean; latestDate: string; stalePages: string[] } {
  const patterns = [
    /(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/g,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/gi,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/gi,
    // Month YYYY (no day) — common blog date format
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/gi,
  ];
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  let latest = new Date(0), latestStr = '';
  const stale: string[] = [];
  let hasAny = false;
  for (const page of pages) {
    let recent = false;
    for (const p of patterns) {
      for (const m of [...page.text.matchAll(p)]) {
        hasAny = true;
        try {
          let ds: string;
          // Distinguish by capture group count: Month YYYY has 2 groups, others have 3
          if (m.length === 3 && p.source.includes('January|February')) {
            // Month YYYY (no day) — pattern 3: (Month)(Year)
            ds = `${m[1]} 1, ${m[2]}`;
          } else if (p.source.includes('January|February')) {
            // Month DD, YYYY — pattern 1: (Month)(DD)(YYYY)
            ds = `${m[1]} ${m[2]} ${m[3]}`;
          } else if (p.source.includes('Jan|Feb')) {
            // DD Mon YYYY — pattern 2: (DD)(Mon)(YYYY)
            ds = `${m[1]} ${m[2]} ${m[3]}`;
          } else {
            // YYYY-MM-DD — pattern 0: (YYYY)(MM)(DD)
            ds = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
          }
          const d = new Date(ds);
          if (!isNaN(d.getTime()) && d > new Date('2020-01-01') && d <= now) {
            if (d > latest) { latest = d; latestStr = ds; }
            if (d >= sixMonthsAgo) recent = true;
          }
        } catch {}
      }
    }
    if (!recent && page.text.length > 200) stale.push(page.url);
  }
  return { hasRecent: hasAny && latest >= sixMonthsAgo, latestDate: latestStr || '', stalePages: stale };
}

// ─── Common checks (both content and game) ─────────────────────────

function checkTemplateDetection(pages: Array<{ url: string; text: string }>, lang: Lang): CheckItem | null {
  if (pages.length < 3) return null;
  const tpl = detectTemplatePages(pages);
  const a = tpl.maxPair[0] ? new URL(tpl.maxPair[0]).pathname : '';
  const b = tpl.maxPair[1] ? new URL(tpl.maxPair[1]).pathname : '';
  // Informational only — skeleton templating is a normal web dev technique
  return { name: t('item.content.template', lang), status: 'pass', message: t('content.template.info', lang, { pct: tpl.similarity, count: tpl.clusterCount, a, b }) };
}

/**
 * Detect cross-page text duplication after removing boilerplate.
 * Uses word-level n-gram Jaccard similarity on the unique content
 * (after extractMainContent removes shared nav/footer/etc).
 *
 * This measures how similar the page texts are — a structural signal.
 * It does NOT judge content value; that is left to AI analysis.
 */
function checkCrossPageDuplication(pages: Array<{ url: string; text: string }>, lang: Lang): { item: CheckItem; score: number } {
  if (pages.length <= 1) return { item: { name: t('item.content.dup', lang), status: 'pass', message: t('content.dup.skip', lang) }, score: 100 };

  const allTexts = pages.map(p => p.text);
  const mainTexts = pages.map(p => extractMainContent(p.text, allTexts));

  // Word-level 4-gram Jaccard similarity
  function getNgrams(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const n = 4;
    if (words.length < n) return words;
    const ngrams: string[] = [];
    for (let i = 0; i <= words.length - n; i++) ngrams.push(words.slice(i, i + n).join(' '));
    return ngrams;
  }

  function jaccard(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 0;
    const sa = new Set(a), sb = new Set(b);
    const inter = [...sa].filter(x => sb.has(x)).length;
    const union = new Set([...sa, ...sb]).size;
    return union > 0 ? inter / union : 0;
  }

  // Find the pair with highest Jaccard similarity
  let maxJaccard = 0;
  let maxPair: [string, string] = ['', ''];
  const ngrams = mainTexts.map(getNgrams);

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      if (ngrams[i].length < 3 || ngrams[j].length < 3) continue;
      const sim = jaccard(ngrams[i], ngrams[j]);
      if (sim > maxJaccard) { maxJaccard = sim; maxPair = [pages[i].url, pages[j].url]; }
    }
  }

  const jaccardPct = Math.round(maxJaccard * 100);
  // Score: high similarity = potential duplication, but not a fail by itself
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - maxJaccard))));

  const aPath = (() => { try { return new URL(maxPair[0]).pathname; } catch { return maxPair[0]; } })();
  const bPath = (() => { try { return new URL(maxPair[1]).pathname; } catch { return maxPair[1]; } })();

  if (jaccardPct >= 60) {
    return {
      item: {
        name: t('item.content.dup', lang),
        status: 'warn',
        message: t('content.dup.warn', lang, { score, pct: jaccardPct, a: aPath, b: bPath, jaccard: jaccardPct }),
      },
      score,
    };
  }
  return {
    item: {
      name: t('item.content.dup', lang),
      status: 'pass',
      message: t('content.dup.pass', lang, { score, pct: 0, a: aPath, b: bPath, jaccard: jaccardPct }),
    },
    score,
  };
}

function checkFreshnessItem(pages: Array<{ url: string; text: string }>, lang: Lang): CheckItem {
  const fresh = checkFreshness(pages);
  if (fresh.hasRecent) return { name: t('item.content.freshness', lang), status: 'pass', message: t('content.freshness.pass', lang, { date: fresh.latestDate }) };
  if (fresh.latestDate) return { name: t('item.content.freshness', lang), status: 'warn', message: t('content.freshness.warn_old', lang, { date: fresh.latestDate }) };
  return { name: t('item.content.freshness', lang), status: 'warn', message: t('content.freshness.warn_none', lang) };
}

function checkSiteScale(sitePageCount: number | undefined, lang: Lang): CheckItem | null {
  if (sitePageCount === undefined) return null;
  const key = sitePageCount < 10 ? 'content.scale.warn' : sitePageCount < 30 ? 'content.scale.pass_small' : 'content.scale.pass';
  return { name: t('item.content.scale', lang), status: sitePageCount < 10 ? 'warn' : 'pass', message: t(key, lang, { count: sitePageCount }) };
}

// ─── Content-site specific checks ──────────────────────────────────

function checkContentSite(
  pages: Array<{ url: string; text: string; title: string }>,
  lang: Lang
): CheckItem[] {
  const items: CheckItem[] = [];
  const allTexts = pages.map(p => p.text);

  // 1. Content ratio
  const lowRatio: Array<{ url: string; ratio: number; chars: number }> = [];
  for (const page of pages) {
    const main = extractMainContent(page.text, allTexts);
    const total = page.text.replace(/\s+/g, '').length;
    const content = main.replace(/\s+/g, '').length;
    const ratio = total > 0 ? content / total : 1;
    if (ratio < 0.3 && total > 200) lowRatio.push({ url: page.url, ratio: Math.round(ratio * 100), chars: content });
  }
  items.push(lowRatio.length > 0
    ? { name: t('item.content.ratio', lang), status: 'fail', message: t('content.ratio.fail', lang, { count: lowRatio.length }), detailList: lowRatio.map(p => `${new URL(p.url).pathname}: ${p.ratio}% (${p.chars} chars)`) }
    : { name: t('item.content.ratio', lang), status: 'pass', message: t('content.ratio.pass', lang) }
  );

  // 2. Per-page depth
  let thinCount = 0;
  for (const page of pages) {
    const main = extractMainContent(page.text, allTexts);
    const chars = main.replace(/\s+/g, '').length;
    if (pages.indexOf(page) === 0) {
      items.push(chars >= 500
        ? { name: t('item.content.home', lang), status: 'pass', message: t('content.home.pass', lang, { chars }) }
        : { name: t('item.content.home', lang), status: 'fail', message: t('content.home.fail', lang, { chars }) }
      );
    } else {
      if (chars < 300) thinCount++;
    }
  }
  if (pages.length > 1) {
    const key = thinCount === 0 ? 'content.subpage.pass' : thinCount > (pages.length - 1) * 0.5 ? 'content.subpage.fail' : 'content.subpage.warn';
    items.push({ name: t('item.content.subpage', lang), status: thinCount === 0 ? 'pass' : thinCount > (pages.length - 1) * 0.5 ? 'fail' : 'warn', message: t(key, lang, { thin: thinCount, total: pages.length - 1 }) });
  }

  // 3. Filler detection
  const fillers = [/(?:总之|综上所述|总的来说|简单来说|众所周知|毫无疑问|显而易见)/g, /(?:in conclusion|as we all know|it goes without saying|needless to say)/gi, /(.{10,30})\1{3,}/g];
  let fillerCount = 0;
  for (const page of pages) for (const f of fillers) { const m = page.text.match(f); if (m) fillerCount += m.length; }
  items.push({ name: t('item.content.filler', lang), status: fillerCount > pages.length * 3 ? 'warn' : 'pass', message: t(fillerCount > pages.length * 3 ? 'content.filler.warn' : 'content.filler.pass', lang, { count: fillerCount }) });

  return items;
}

// ─── Game-site specific checks ─────────────────────────────────────

function checkGameSite(
  pages: Array<{ url: string; text: string; title: string }>,
  pagesSignals: Array<{ iframeCount: number; iframeSrcs: string[]; canvasCount: number; textLength: number }>,
  lang: Lang
): CheckItem[] {
  const items: CheckItem[] = [];

  // 1. Game Description — check if game pages have sufficient description text (100+ chars)
  const subpages = pages.slice(1);
  const subpageSignals = pagesSignals.slice(1);
  if (subpages.length > 0) {
    let thinDesc = 0;
    const thinPages: string[] = [];
    for (let i = 0; i < subpages.length; i++) {
      const sig = subpageSignals[i];
      // Only check pages that look like game pages (have iframes or canvas)
      if (sig && (sig.iframeCount > 0 || sig.canvasCount > 0)) {
        if (sig.textLength < 100) {
          thinDesc++;
          try { thinPages.push(new URL(subpages[i].url).pathname); } catch { thinPages.push(subpages[i].url); }
        }
      }
    }
    const gamePages = subpageSignals.filter(s => s.iframeCount > 0 || s.canvasCount > 0).length;
    if (gamePages > 0) {
      const ratio = thinDesc / gamePages;
      items.push(ratio > 0.5
        ? { name: t('item.content.game_desc', lang), status: 'warn', message: t('content.game_desc.warn', lang, { thin: thinDesc, total: gamePages }), detailList: thinPages.slice(0, 5).map(p => `${new URL(p).pathname}`) }
        : { name: t('item.content.game_desc', lang), status: 'pass', message: t('content.game_desc.pass', lang, { total: gamePages }) }
      );
    }
  }

  // 2. Iframe Quality — check if game iframes have title attributes
  let iframesWithTitle = 0;
  let totalIframes = 0;
  for (const sig of pagesSignals) {
    totalIframes += sig.iframeCount;
  }
  // This is a basic count check — detailed title check would need DOM access
  if (totalIframes > 0) {
    items.push({
      name: t('item.content.iframe_quality', lang),
      status: totalIframes > 20 ? 'warn' : 'pass',
      message: t(totalIframes > 20 ? 'content.iframe_quality.warn' : 'content.iframe_quality.pass', lang, { count: totalIframes }),
    });
  }

  return items;
}

// ─── Video-site specific checks ────────────────────────────────────

function checkVideoSite(
  pages: Array<{ url: string; text: string; title: string }>,
  pagesSignals: Array<{ iframeCount: number; iframeSrcs: string[]; canvasCount: number; textLength: number }>,
  lang: Lang
): CheckItem[] {
  const items: CheckItem[] = [];

  // 1. Video Description — check if video pages have sufficient description text (50+ chars)
  const subpages = pages.slice(1);
  const subpageSignals = pagesSignals.slice(1);
  if (subpages.length > 0) {
    let thinDesc = 0;
    const thinPages: string[] = [];
    for (let i = 0; i < subpages.length; i++) {
      const sig = subpageSignals[i];
      if (sig && sig.textLength < 50) {
        thinDesc++;
        try { thinPages.push(new URL(subpages[i].url).pathname); } catch { thinPages.push(subpages[i].url); }
      }
    }
    if (subpages.length > 0) {
      const ratio = thinDesc / subpages.length;
      items.push(ratio > 0.5
        ? { name: t('item.content.video_desc', lang), status: 'warn', message: t('content.video_desc.warn', lang, { thin: thinDesc, total: subpages.length }), detailList: thinPages.slice(0, 5).map(p => `${new URL(p).pathname}`) }
        : { name: t('item.content.video_desc', lang), status: 'pass', message: t('content.video_desc.pass', lang, { total: subpages.length }) }
      );
    }
  }

  return items;
}

// ─── Reference-site specific checks ────────────────────────────────

function checkReferenceSite(
  pages: Array<{ url: string; text: string; title: string }>,
  pagesSignals: Array<{ iframeCount: number; iframeSrcs: string[]; canvasCount: number; textLength: number }>,
  lang: Lang
): CheckItem[] {
  const items: CheckItem[] = [];

  // 1. Entry completeness — check if reference entries have basic structure (100+ chars)
  const subpages = pages.slice(1);
  const subpageSignals = pagesSignals.slice(1);
  if (subpages.length > 0) {
    let thinEntries = 0;
    const thinPages: string[] = [];
    for (let i = 0; i < subpages.length; i++) {
      const sig = subpageSignals[i];
      if (sig && sig.textLength < 100) {
        thinEntries++;
        try { thinPages.push(new URL(subpages[i].url).pathname); } catch { thinPages.push(subpages[i].url); }
      }
    }
    if (subpages.length > 0) {
      const ratio = thinEntries / subpages.length;
      items.push(ratio > 0.5
        ? { name: t('item.content.reference_entry', lang), status: 'warn', message: t('content.reference_entry.warn', lang, { thin: thinEntries, total: subpages.length }), detailList: thinPages.slice(0, 5).map(p => `${new URL(p).pathname}`) }
        : { name: t('item.content.reference_entry', lang), status: 'pass', message: t('content.reference_entry.pass', lang) }
      );
    }
  }

  return items;
}

// ─── Main entry ────────────────────────────────────────────────────

export function checkContentQuality(
  pages: Array<{ url: string; text: string; title: string }>,
  sitePageCount: number | undefined,
  lang: Lang,
  siteType: SiteType = 'content',
  pagesSignals?: Array<{ iframeCount: number; iframeSrcs: string[]; canvasCount: number; textLength: number }>
): { category: CheckCategory; contentDuplicationScore: number } {
  const items: CheckItem[] = [];

  if (siteType === 'game') {
    // Game site: skip text volume checks, add game-specific checks
    if (pagesSignals) {
      items.push(...checkGameSite(pages, pagesSignals, lang));
    }
  } else if (siteType === 'video') {
    // Video site: skip text volume checks, add video-specific checks
    if (pagesSignals) {
      items.push(...checkVideoSite(pages, pagesSignals, lang));
    }
  } else if (siteType === 'reference') {
    // Reference site: adapted text thresholds, add reference-specific checks
    if (pagesSignals) {
      items.push(...checkReferenceSite(pages, pagesSignals, lang));
    }
  } else {
    // Content site: full text quality checks
    items.push(...checkContentSite(pages, lang));
  }

  // Common checks for both types
  const tplItem = checkTemplateDetection(pages, lang);
  if (tplItem) items.push(tplItem);

  const dupResult = checkCrossPageDuplication(pages, lang);
  items.push(dupResult.item);
  const contentDuplicationScore = dupResult.score;

  items.push(checkFreshnessItem(pages, lang));

  const scaleItem = checkSiteScale(sitePageCount, lang);
  if (scaleItem) items.push(scaleItem);

  return { category: { name: t('cat.content', lang), items }, contentDuplicationScore };
}
