import type { PageType, CheckStatus, CheckCategory, CategoryScore, SiteType } from './types.js';
import { PAGE_TYPE_WEIGHTS } from './classifier.js';

// ─── Per-page scoring ──────────────────────────────────────────────

export interface PageCheckResult {
  label: string;
  status: CheckStatus;
  weight: number;  // relative weight within this page type
}

function scoreFromChecks(checks: PageCheckResult[]): number {
  if (checks.length === 0) return 100;
  let totalWeight = 0;
  let earnedWeight = 0;
  for (const c of checks) {
    totalWeight += c.weight;
    if (c.status === 'pass') earnedWeight += c.weight;
    else if (c.status === 'warn') earnedWeight += c.weight * 0.4;
    // fail/skip = 0
  }
  return totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;
}

export function scorePage(
  pageType: PageType,
  contentChars: number,
  contentRatio: number,
  issues: string[],
  siteType: SiteType
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
    // unknown
    checks.push({ label: 'Content', status: contentChars >= 300 ? 'pass' : contentChars >= 100 ? 'warn' : 'fail', weight: 2 });
  }

  return { score: scoreFromChecks(checks), checks };
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

// ─── Composite score aggregation ───────────────────────────────────

// Weights for different scoring components
const SITE_CATEGORY_WEIGHT: Record<string, number> = {
  // Matched by category name substring
  '结构': 15, 'Structure': 15,
  '必要页面': 15, 'Required': 15,
  '性能': 10, 'Performance': 10,
  '合规': 10, 'Policy': 10,
};

export function computeCompositeScore(
  pageScores: Array<{ pageType: PageType; score: number }>,
  siteCategoryScores: CategoryScore[]
): { compositeScore: number; categoryScores: CategoryScore[] } {
  // 1. Aggregate page scores by type
  const pageTypeScores: Record<string, { total: number; count: number; weight: number }> = {};
  for (const ps of pageScores) {
    const key = ps.pageType;
    if (!pageTypeScores[key]) pageTypeScores[key] = { total: 0, count: 0, weight: PAGE_TYPE_WEIGHTS[ps.pageType] || 3 };
    pageTypeScores[key].total += ps.score;
    pageTypeScores[key].count++;
  }

  // 2. Compute weighted page average (max 55 points for pages)
  const PAGE_TOTAL_WEIGHT = 55;
  let pageWeightedSum = 0;
  let pageWeightTotal = 0;
  for (const [, data] of Object.entries(pageTypeScores)) {
    const avg = data.total / data.count;
    const weight = data.weight * data.count;
    pageWeightedSum += avg * weight;
    pageWeightTotal += weight;
  }
  const pageAvg = pageWeightTotal > 0 ? pageWeightedSum / pageWeightTotal : 0;
  const pageContribution = (pageAvg / 100) * PAGE_TOTAL_WEIGHT;

  // 3. Compute site category scores (max 45 points for site checks)
  const SITE_TOTAL_WEIGHT = 45;
  const allCategoryScores: CategoryScore[] = [];
  let siteWeightedSum = 0;
  let siteWeightTotal = 0;

  for (const cs of siteCategoryScores) {
    const catScore = cs.maxScore > 0 ? (cs.score / cs.maxScore) * 100 : 0;
    let weight = 8; // default weight for categories not explicitly listed
    for (const [pattern, w] of Object.entries(SITE_CATEGORY_WEIGHT)) {
      if (cs.name.includes(pattern)) { weight = w; break; }
    }
    siteWeightedSum += catScore * weight;
    siteWeightTotal += weight;
    allCategoryScores.push({ name: cs.name, score: Math.round(catScore), maxScore: 100 });
  }

  const siteAvg = siteWeightTotal > 0 ? siteWeightedSum / siteWeightTotal : 0;
  const siteContribution = (siteAvg / 100) * SITE_TOTAL_WEIGHT;

  // 4. Combine
  const compositeScore = Math.round(pageContribution + siteContribution);

  return {
    compositeScore: Math.min(100, Math.max(0, compositeScore)),
    categoryScores: allCategoryScores,
  };
}
