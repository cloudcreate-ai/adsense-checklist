import type { PageType, CheckStatus, CheckCategory, CategoryScore, SiteType } from './types.js';
import { PAGE_TYPE_WEIGHTS } from './classifier.js';
import type { PageAiAnalysis } from './ai/analyzer.js';

// ─── Per-page scoring ──────────────────────────────────────────────

export interface PageCheckResult {
  label: string;
  status: CheckStatus;
  weight: number;
}

function scoreFromChecks(checks: PageCheckResult[]): number {
  if (checks.length === 0) return 100;
  let totalWeight = 0;
  let earnedWeight = 0;
  for (const c of checks) {
    totalWeight += c.weight;
    if (c.status === 'pass') earnedWeight += c.weight;
    else if (c.status === 'warn') earnedWeight += c.weight * 0.4;
  }
  return totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;
}

export function scorePage(
  pageType: PageType,
  contentChars: number,
  contentRatio: number,
  issues: string[],
  siteType: SiteType,
  aiStatus?: CheckStatus
): { score: number; checks: PageCheckResult[] } {
  const checks: PageCheckResult[] = [];

  if (pageType === 'homepage') {
    checks.push({ label: 'Content depth', status: contentChars >= 500 ? 'pass' : contentChars >= 200 ? 'warn' : 'fail', weight: 3 });
    checks.push({ label: 'Content ratio', status: contentRatio >= 40 ? 'pass' : contentRatio >= 20 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'content') {
    checks.push({ label: 'Content depth', status: contentChars >= 500 ? 'pass' : contentChars >= 300 ? 'warn' : 'fail', weight: 4 });
    checks.push({ label: 'Content ratio', status: contentRatio >= 40 ? 'pass' : contentRatio >= 20 ? 'warn' : 'fail', weight: 2 });
    if (issues.length > 0) checks.push({ label: 'Issues', status: 'warn', weight: 1 });
  } else if (pageType === 'game_detail') {
    if (siteType === 'game') {
      checks.push({ label: 'Game description', status: contentChars >= 100 ? 'pass' : 'warn', weight: 3 });
    } else {
      checks.push({ label: 'Content depth', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 3 });
    }
    checks.push({ label: 'Content ratio', status: contentRatio >= 30 ? 'pass' : contentRatio >= 15 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'video_detail') {
    if (siteType === 'video') {
      checks.push({ label: 'Video description', status: contentChars >= 50 ? 'pass' : 'warn', weight: 3 });
      checks.push({ label: 'Content ratio', status: contentRatio >= 15 ? 'pass' : contentRatio >= 5 ? 'warn' : 'fail', weight: 2 });
    } else {
      checks.push({ label: 'Content depth', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 3 });
      checks.push({ label: 'Content ratio', status: contentRatio >= 30 ? 'pass' : contentRatio >= 15 ? 'warn' : 'fail', weight: 2 });
    }
  } else if (pageType === 'reference_detail') {
    if (siteType === 'reference') {
      checks.push({ label: 'Entry completeness', status: contentChars >= 100 ? 'pass' : contentChars >= 50 ? 'warn' : 'fail', weight: 3 });
      checks.push({ label: 'Content ratio', status: contentRatio >= 20 ? 'pass' : contentRatio >= 5 ? 'warn' : 'fail', weight: 2 });
    } else {
      checks.push({ label: 'Content depth', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 3 });
      checks.push({ label: 'Content ratio', status: contentRatio >= 30 ? 'pass' : contentRatio >= 15 ? 'warn' : 'fail', weight: 2 });
    }
  } else if (pageType === 'reference_listing') {
    checks.push({ label: 'Listing content', status: contentChars >= 200 ? 'pass' : contentChars >= 50 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'listing') {
    checks.push({ label: 'Content', status: contentChars >= 200 ? 'pass' : contentChars >= 50 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'required') {
    checks.push({ label: 'Exists', status: contentChars > 0 ? 'pass' : 'fail', weight: 3 });
    checks.push({ label: 'Content depth', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'utility') {
    checks.push({ label: 'Functional', status: contentChars > 0 ? 'pass' : 'warn', weight: 1 });
  } else {
    checks.push({ label: 'Content', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 2 });
  }

  let score = scoreFromChecks(checks);

  // AI status directly affects page score
  if (aiStatus === 'fail') score = 0;
  else if (aiStatus === 'warn') score = Math.min(score, 70);

  return { score, checks };
}

// ─── AI value scoring ──────────────────────────────────────────────

// Page type weights for AI value (content pages matter most)
const AI_PAGE_TYPE_WEIGHTS: Record<PageType, number> = {
  homepage: 1.5,
  content: 1.0,
  game_detail: 1.0,
  video_detail: 1.0,
  reference_detail: 1.0,
  unknown: 0.5,
  listing: 0.1,
  reference_listing: 0.1,
  required: 0.2,
  utility: 0.1,
};

/**
 * Compute per-page AI score using geometric mean of 4 dimensions (0-10 → 0-100).
 * Geometric mean = (v × o × r × c) ^ (1/4) × 10
 * Properties: any dimension at 0 → score 0; low dimension drags down heavily.
 */
export function computePageAiScore(analysis: PageAiAnalysis): number {
  const v = analysis.valueScore ?? 5;
  const o = analysis.originalityScore ?? 5;
  const r = analysis.relevanceScore ?? 5;
  const c = analysis.complianceScore ?? 5;
  const t = analysis.translationScore ?? 5;
  const geoMean = Math.pow(v * o * r * c * t, 0.2);
  return Math.round(geoMean * 10);
}

/**
 * Compute site-level AI score: weighted average of per-page scores by page type.
 */
export function computeSiteAiScore(
  pageAiScores: Array<{ pageType: PageType; score: number }>
): number {
  if (pageAiScores.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const p of pageAiScores) {
    const w = AI_PAGE_TYPE_WEIGHTS[p.pageType] ?? 0.5;
    weightedSum += p.score * w;
    totalWeight += w;
  }
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
}

// ─── Site-level category scoring ───────────────────────────────────

function statusToScore(status: CheckStatus): number {
  if (status === 'pass') return 100;
  if (status === 'warn') return 40;
  if (status === 'skip') return 0;
  return 0;
}

export function scoreCategory(category: CheckCategory): CategoryScore {
  if (category.items.length === 0) return { name: category.name, score: 0, maxScore: 0 };
  const total = category.items.length * 100;
  const earned = category.items.reduce((sum, item) => sum + statusToScore(item.status), 0);
  return { name: category.name, score: earned, maxScore: total };
}

function categoryPassRate(category: CheckCategory): number {
  if (category.items.length === 0) return 100;
  const cs = scoreCategory(category);
  return cs.maxScore > 0 ? Math.round(cs.score / cs.maxScore * 100) : 100;
}

// ─── Composite score ───────────────────────────────────────────────

/**
 * Composite formula: value × site_coef × home_coef, with compliance/relevance caps.
 *
 * Rationale:
 * - 网页价值 (VOT: value × originality × translation) is the core signal
 * - 全站质量 and 首页质量 are multipliers — good infrastructure prevents discounting,
 *   but can't make mediocre content good
 * - Compliance and relevance are thresholds, not scores — low compliance or relevance
 *   caps the total regardless of other factors
 *
 * Compliance/relevance are excluded from the VOT mean because they're "safety" dimensions:
 * nearly all pages score 10/10, so including them dilutes the signal from value/originality/translation.
 * When they DO drop below threshold, the cap mechanism kicks in.
 */

// Threshold caps for compliance and relevance
const COMPLIANCE_LOW_CAP = 50;  // any page compliance < 6 → cap total at 50
const RELEVANCE_LOW_CAP = 60;   // avg relevance < 6 → cap total at 60
const COMPLIANCE_THRESHOLD = 6;
const RELEVANCE_THRESHOLD = 6;

// Category names to identify the landing page group
const LANDING_PAGE_NAMES = ['落地页', 'Landing'];

export interface CompositeResult {
  compositeScore: number;
  categoryScores: CategoryScore[];
  hardStatus: 'ready' | 'warn' | 'fail';
  softScore: number;
  warningRatio: number;
  warningPenalty: number;
  siteAiScore: number;
  /** Page value score: VOT (value × originality × translation) geometric mean, excluding required/utility pages */
  pageValueScore: number;
  /** Site-wide quality score (hard + content + UX categories) */
  siteQuality: number;
  /** Landing page quality score */
  homeQuality: number;
}

/**
 * Compute per-page VOT score (value × originality × translation geometric mean).
 * Excludes compliance and relevance — they're thresholds, not quality signals.
 */
function computePageVot(analysis: PageAiAnalysis): number {
  const v = analysis.valueScore ?? 5;
  const o = analysis.originalityScore ?? 5;
  const t = analysis.translationScore ?? 5;
  return Math.pow(v * o * t, 1 / 3) * 10;
}

/**
 * Compute site-level VOT score: weighted average of per-page VOT scores,
 * excluding required/utility pages which don't need editorial content quality.
 */
function computeSiteVot(
  aiAnalyses: PageAiAnalysis[],
  pageScores: Array<{ pageType: PageType; score: number }>
): number {
  // Only content pages participate in VOT
  const contentPages = aiAnalyses.map((a, i) => ({
    analysis: a,
    pageType: pageScores[i]?.pageType ?? 'unknown',
    vot: computePageVot(a),
  })).filter(p => p.pageType !== 'required' && p.pageType !== 'utility');

  if (contentPages.length === 0) return 0;

  const weights: Record<string, number> = {
    homepage: 1.5, content: 1.0, game_detail: 1.0, video_detail: 1.0,
    reference_detail: 1.0, unknown: 0.5, listing: 0.1, reference_listing: 0.1,
  };

  let wSum = 0, wTotal = 0;
  for (const p of contentPages) {
    const w = weights[p.pageType] ?? 0.5;
    wSum += p.vot * w;
    wTotal += w;
  }
  return wTotal > 0 ? wSum / wTotal : 0;
}

export function computeCompositeScore(
  pageScores: Array<{ pageType: PageType; score: number }>,
  hardCategories: CheckCategory[],
  softCategories: CheckCategory[],
  aiAnalyses?: PageAiAnalysis[],
  contentDuplicationScore?: number
): CompositeResult {
  // 1. Hard pass rate (for hardStatus display)
  const hardItems = hardCategories.flatMap(c => c.items);
  const hardFail = hardItems.filter(i => i.status === 'fail').length;
  const hardWarn = hardItems.filter(i => i.status === 'warn').length;
  const hardTotal = hardItems.length;
  const hardPass = hardItems.filter(i => i.status === 'pass').length;
  const hardPassRate = hardTotal > 0 ? (hardPass / hardTotal) * 100 : 100;

  let hardStatus: 'ready' | 'warn' | 'fail' = 'ready';
  if (hardFail > 0) hardStatus = 'fail';
  else if (hardWarn > 0) hardStatus = 'warn';

  // 2. Site-wide quality score (hard + content + UX categories)
  const siteWideItems = hardCategories.flatMap(c => c.items)
    .concat(softCategories.filter(c =>
      c.name.includes('内容质量') || c.name.includes('Content')
      || c.name.includes('体验') || c.name.includes('UX') || c.name.includes('User')
    ).flatMap(c => c.items));
  const siteQuality = siteWideItems.length > 0
    ? siteWideItems.reduce((s, i) => s + statusToScore(i.status), 0) / siteWideItems.length
    : 100;

  // 3. Landing page quality
  const landingCat = softCategories.find(c => LANDING_PAGE_NAMES.some(n => c.name.includes(n)));
  const homeQuality = landingCat
    ? landingCat.items.reduce((s, i) => s + statusToScore(i.status), 0) / Math.max(1, landingCat.items.length)
    : 100;

  // 4. Page value (VOT: value × originality × translation)
  let votScore = 0;
  if (aiAnalyses && aiAnalyses.length > 0) {
    votScore = computeSiteVot(aiAnalyses, pageScores);
  }

  // Legacy siteAiScore for display (5-dim geo mean, all pages weighted)
  let siteAiScore = 0;
  if (aiAnalyses && aiAnalyses.length > 0) {
    siteAiScore = computeSiteAiScore(
      aiAnalyses.map((a, i) => ({
        pageType: pageScores[i]?.pageType ?? 'unknown',
        score: computePageAiScore(a),
      }))
    );
  }

  // 5. Compliance/relevance thresholds
  let cap = 100;
  if (aiAnalyses && aiAnalyses.length > 0) {
    const minCompliance = Math.min(...aiAnalyses.map(a => a.complianceScore ?? 5));
    const avgRelevance = aiAnalyses.reduce((s, a) => s + (a.relevanceScore ?? 5), 0) / aiAnalyses.length;
    if (minCompliance < COMPLIANCE_THRESHOLD) cap = COMPLIANCE_LOW_CAP;
    else if (avgRelevance < RELEVANCE_THRESHOLD) cap = RELEVANCE_LOW_CAP;
  }

  // 6. Composite: value × site_coef × home_coef, capped by thresholds
  const siteCoef = siteQuality / 100;
  const homeCoef = homeQuality / 100;
  const base = votScore > 0
    ? votScore * siteCoef * homeCoef
    : Math.round(Math.sqrt(hardPassRate * (softCategories.length > 0 ? softCategories.reduce((s, c) => s + categoryPassRate(c), 0) / softCategories.length : 100)));
  const compositeScore = Math.min(100, Math.max(0, Math.round(Math.min(base, cap))));

  // Legacy softScore for display compatibility
  const softScore = votScore > 0
    ? Math.round(votScore * 0.6 + (siteQuality + homeQuality) / 2 * 0.4)
    : Math.round(softCategories.reduce((s, c) => s + categoryPassRate(c), 0) / Math.max(1, softCategories.length));

  // 7. Warning penalty
  const allItems = [...hardItems, ...softCategories.flatMap(c => c.items)];
  const totalWarn = allItems.filter(i => i.status === 'warn').length;
  const totalAll = allItems.length;
  const warningRatio = totalAll > 0 ? totalWarn / totalAll : 0;
  const warningPenalty = warningRatio > 0.15 ? Math.round((warningRatio - 0.15) * 100) : 0;

  // Category scores for display
  const categoryScores: CategoryScore[] = [];
  for (const cat of [...hardCategories, ...softCategories]) {
    categoryScores.push(scoreCategory(cat));
  }

  return { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty, siteAiScore, pageValueScore: votScore, siteQuality, homeQuality };
}
