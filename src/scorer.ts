import type { PageType, CheckStatus, CheckCategory, CategoryScore, SiteType } from './types.js';
import { PAGE_TYPE_WEIGHTS } from './classifier.js';

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

// ─── Composite score: hard/soft two-group system ───────────────────

// Soft scoring weights (must sum to 1.0)
const SOFT_WEIGHTS = {
  pageQuality: 0.25,    // per-page scores (AI-adjusted)
  aiAnalysis: 0.45,     // AI content analysis
  contentQuality: 0.20, // mechanical content checks
  userExperience: 0.10, // font, popup checks
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
}

export function computeCompositeScore(
  pageScores: Array<{ pageType: PageType; score: number }>,
  hardCategories: CheckCategory[],
  softCategories: CheckCategory[]
): CompositeResult {
  // 1. Hard pass rate
  const hardItems = hardCategories.flatMap(c => c.items);
  const hardPass = hardItems.filter(i => i.status === 'pass').length;
  const hardFail = hardItems.filter(i => i.status === 'fail').length;
  const hardWarn = hardItems.filter(i => i.status === 'warn').length;
  const hardTotal = hardItems.length;
  const hardPassRate = hardTotal > 0 ? (hardPass / hardTotal) * 100 : 100;

  // Hard status
  let hardStatus: 'ready' | 'warn' | 'fail' = 'ready';
  if (hardFail > 0) hardStatus = 'fail';
  else if (hardWarn > 0) hardStatus = 'warn';

  // 2. Soft scoring components
  // 2a. Page quality: score pages penalized by AI issues ratio
  const allPages = pageScores.length;
  const ai = softCategories.find(c => c.name.includes('AI') || c.name.includes('ai'));
  // Count pages with AI issues from the AI category detail (passed via soft categories)
  // Instead, use a simpler approach: if AI category has warnings/fails, reduce page quality
  let pageQuality: number;
  if (allPages > 0) {
    const avgPageScore = pageScores.reduce((s, p) => s + p.score, 0) / allPages;
    pageQuality = avgPageScore;
  } else {
    pageQuality = 100;
  }

  // 2b. AI analysis score
  let aiScore = 100;
  if (ai && ai.items.length > 0) {
    aiScore = ai.items.reduce((sum, item) => sum + statusToScore(item.status), 0) / ai.items.length;
  }

  // 2c. Content quality score (other soft categories excluding AI)
  const contentCats = softCategories.filter(c => c !== ai);
  let contentScore = 100;
  if (contentCats.length > 0) {
    let totalEarned = 0;
    let totalItems = 0;
    for (const cat of contentCats) {
      for (const item of cat.items) {
        totalEarned += statusToScore(item.status);
        totalItems++;
      }
    }
    contentScore = totalItems > 0 ? totalEarned / totalItems : 100;
  }

  // 2d. UX score (extracted from contentCats if present)
  let uxScore = 100;

  // Weighted soft score
  const softScore = Math.round(
    pageQuality * SOFT_WEIGHTS.pageQuality +
    aiScore * SOFT_WEIGHTS.aiAnalysis +
    contentScore * SOFT_WEIGHTS.contentQuality +
    uxScore * SOFT_WEIGHTS.userExperience
  );

  // 3. Warning penalty (multiplicative)
  const allItems = [...hardItems, ...softCategories.flatMap(c => c.items)];
  const totalWarn = allItems.filter(i => i.status === 'warn').length;
  const totalAll = allItems.length;
  const warningRatio = totalAll > 0 ? totalWarn / totalAll : 0;
  const warningPenalty = warningRatio > 0.05 ? Math.round((warningRatio - 0.05) * 200) : 0;

  // 4. Composite
  const base = hardPassRate * HARD_COMPOSITE_WEIGHT + softScore * SOFT_COMPOSITE_WEIGHT;
  const compositeScore = Math.min(100, Math.max(0, Math.round(base - warningPenalty)));

  // Category scores for display
  const categoryScores: CategoryScore[] = [];
  for (const cat of [...hardCategories, ...softCategories]) {
    categoryScores.push(scoreCategory(cat));
  }

  return { compositeScore, categoryScores, hardStatus, softScore, warningRatio, warningPenalty };
}
