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

function detectTemplatePages(pages: Array<{ url: string; text: string }>): { isTemplate: boolean; similarity: number } {
  if (pages.length < 3) return { isTemplate: false, similarity: 0 };
  const structures = pages.map(p =>
    p.text.replace(/[a-zA-Z一-鿿]+/g, 'W').replace(/\d+/g, 'N').replace(/\s+/g, ' ').slice(0, 1000)
  );
  let total = 0, pairs = 0;
  for (let i = 0; i < structures.length; i++) {
    for (let j = i + 1; j < structures.length; j++) {
      const longer = structures[i].length > structures[j].length ? structures[i] : structures[j];
      const shorter = structures[i].length > structures[j].length ? structures[j] : structures[i];
      let common = 0;
      for (let k = 0; k < shorter.length; k++) { if (shorter[k] === longer[k]) common++; }
      total += common / longer.length; pairs++;
    }
  }
  const sim = pairs > 0 ? total / pairs : 0;
  return { isTemplate: sim > 0.6, similarity: Math.round(sim * 100) };
}

function checkFreshness(pages: Array<{ url: string; text: string }>): { hasRecent: boolean; latestDate: string; stalePages: string[] } {
  const patterns = [
    /(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/g,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/gi,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/gi,
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
          if (p.source.includes('January|February')) ds = `${m[1]} ${m[2]} ${m[3]}`;
          else if (p.source.includes('Jan|Feb')) ds = `${m[1]} ${m[2]} ${m[3]}`;
          else ds = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
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
  return { name: t('item.content.template', lang), status: tpl.isTemplate ? 'fail' : 'pass', message: t(tpl.isTemplate ? 'content.template.fail' : 'content.template.pass', lang, { pct: tpl.similarity }) };
}

function checkCrossPageDuplication(pages: Array<{ url: string; text: string }>, lang: Lang): CheckItem | null {
  if (pages.length <= 1) return null;
  const chunkSize = 200;
  let dup = 0;
  const chunks = new Set<string>();
  for (const page of pages) {
    const text = page.text.replace(/\s+/g, ' ');
    for (let i = 0; i < text.length - chunkSize; i += chunkSize) {
      const c = text.slice(i, i + chunkSize);
      if (chunks.has(c)) dup++; else chunks.add(c);
    }
  }
  const total = pages.reduce((s, p) => s + Math.max(1, Math.floor(p.text.replace(/\s+/g, ' ').length / chunkSize)), 0);
  const pct = total > 0 ? Math.round(dup / total * 100) : 0;
  return { name: t('item.content.dup', lang), status: pct > 30 ? 'warn' : 'pass', message: t(pct > 30 ? 'content.dup.warn' : 'content.dup.pass', lang, { pct }) };
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

  // 3. Game Variety — check if game pages have sufficient diversity
  if (subpages.length >= 3) {
    const tpl = detectTemplatePages(subpages);
    items.push({
      name: t('item.content.game_variety', lang),
      status: tpl.isTemplate ? 'warn' : 'pass',
      message: t(tpl.isTemplate ? 'content.game_variety.warn' : 'content.game_variety.pass', lang, { pct: tpl.similarity }),
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

  // 2. Video Variety — check if video pages have sufficient diversity
  if (subpages.length >= 3) {
    const tpl = detectTemplatePages(subpages);
    items.push({
      name: t('item.content.video_variety', lang),
      status: tpl.isTemplate ? 'warn' : 'pass',
      message: t(tpl.isTemplate ? 'content.video_variety.warn' : 'content.video_variety.pass', lang, { pct: tpl.similarity }),
    });
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

  // 2. Reference variety — warn at 70% similarity (higher threshold than game/video)
  if (subpages.length >= 3) {
    const tpl = detectTemplatePages(subpages);
    items.push({
      name: t('item.content.reference_variety', lang),
      status: tpl.similarity > 70 ? 'warn' : 'pass',
      message: t(tpl.similarity > 70 ? 'content.reference_variety.warn' : 'content.reference_variety.pass', lang, { pct: tpl.similarity }),
    });
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
): CheckCategory {
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

  const dupItem = checkCrossPageDuplication(pages, lang);
  if (dupItem) items.push(dupItem);

  items.push(checkFreshnessItem(pages, lang));

  const scaleItem = checkSiteScale(sitePageCount, lang);
  if (scaleItem) items.push(scaleItem);

  return { name: t('cat.content', lang), items };
}
