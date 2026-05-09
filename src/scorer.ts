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
  } else if (pageType === 'required') {
    checks.push({ label: 'Exists', status: contentChars > 0 ? 'pass' : 'fail', weight: 3 });
    checks.push({ label: 'Content depth', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 2 });
  } else if (pageType === 'listing') {
    checks.push({ label: 'Content', status: contentChars >= 200 ? 'pass' : contentChars >= 50 ? 'warn' : 'fail', weight: 2 });
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
  unknown: 0.5,
  listing: 0.1,
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
  const geoMean = Math.pow(v * o * r * c, 0.25);
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

// Soft category weights (must sum to 1.0)
// AI value analysis: 45%, Content quality: 35%, User experience: 10%, Page quality: 10%
const SOFT_CAT_WEIGHTS: Record<string, number> = {
  aiValue: 0.45,
  contentQuality: 0.35,
  userExperience: 0.10,
  pageQuality: 0.10,
};

// Composite: hard * 0.4 + soft * 0.6
const HARD_COMPOSITE_WEIGHT = 0.4;
const SOFT_COMPOSITE_WEIGHT = 0.6;

export interface CompositeResult {
  compositeScore: number;
  categoryScores: CategoryScore[];
  hardStatus: 'ready' | 'warn' | 'fail';
  softScore: number;
  warningRatio: number;
  warningPenalty: number;
  siteAiScore: number;
}

export function computeCompositeScore(
  pageScores: Array<{ pageType: PageType; score: number }>,
  hardCategories: CheckCategory[],
  softCategories: CheckCategory[],
  aiAnalyses?: PageAiAnalysis[]
): CompositeResult {
  // 1. Hard pass rate
  const hardItems = hardCategories.flatMap(c => c.items);
  const hardPass = hardItems.filter(i => i.status === 'pass').length;
  const hardFail = hardItems.filter(i => i.status === 'fail').length;
  const hardWarn = hardItems.filter(i => i.status === 'warn').length;
  const hardTotal = hardItems.length;
  const hardPassRate = hardTotal > 0 ? (hardPass / hardTotal) * 100 : 100;

  let hardStatus: 'ready' | 'warn' | 'fail' = 'ready';
  if (hardFail > 0) hardStatus = 'fail';
  else if (hardWarn > 0) hardStatus = 'warn';

  // 2. AI value score (geometric mean, page-type weighted)
  // pageScores and aiAnalyses are in the same order (both from uniquePages)
  let siteAiScore = 0;
  if (aiAnalyses && aiAnalyses.length > 0) {
    siteAiScore = computeSiteAiScore(
      aiAnalyses.map((a, i) => ({
        pageType: pageScores[i]?.pageType ?? 'unknown',
        score: computePageAiScore(a),
      }))
    );
  }

  // 3. Soft scoring: use displayed category pass rates + AI score
  // Find AI value category
  const aiCat = softCategories.find(c => c.name.includes('AI') || c.name.includes('ai'));
  const contentCat = softCategories.find(c => c.name.includes('内容质量') || c.name.includes('Content'));
  const uxCat = softCategories.find(c => c.name.includes('体验') || c.name.includes('UX') || c.name.includes('User'));

  // AI value score: use computed siteAiScore (0-100)
  const aiValue = siteAiScore > 0 ? siteAiScore : (aiCat ? categoryPassRate(aiCat) : 100);

  // Content quality: pass rate of content quality category items
  const contentQuality = contentCat ? categoryPassRate(contentCat) : 100;

  // User experience: pass rate of UX category items
  const userExperience = uxCat ? categoryPassRate(uxCat) : 100;

  // Page quality: average of per-page mechanical scores
  const pageQuality = pageScores.length > 0
    ? Math.round(pageScores.reduce((s, p) => s + p.score, 0) / pageScores.length)
    : 100;

  const softScore = Math.round(
    aiValue * SOFT_CAT_WEIGHTS.aiValue +
    contentQuality * SOFT_CAT_WEIGHTS.contentQuality +
    userExperience * SOFT_CAT_WEIGHTS.userExperience +
    pageQuality * SOFT_CAT_WEIGHTS.pageQuality
  );

  // 4. Warning penalty
  const allItems = [...hardItems, ...softCategories.flatMap(c => c.items)];
  const totalWarn = allItems.filter(i => i.status === 'warn').length;
  const totalAll = allItems.length;
  const warningRatio = totalAll > 0 ? totalWarn / totalAll : 0;
  const warningPenalty = warningRatio > 0.15 ? Math.round((warningRatio - 0.15) * 100) : 0;

  // 5. Composite
  const base = hardPassRate * HARD_COMPOSITE_WEIGHT + softScore * SOFT_COMPOSITE_WEIGHT;
  const compositeScore = Math.min(100, Math.max(0, Math.round(base - warningPenalty)));

  // Category scores for display
  const categoryScores: CategoryScore[] = [];
  for (const cat of [...hardCategories, ...softCategories]) {
    categoryScores.push(scoreCategory(cat));
  }

  return { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty, siteAiScore };
}
