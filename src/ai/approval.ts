import type { CheckReport } from '../types.js';
import { callAIWithModel, extractJson, getExpertModel, getExpertApiBase, getExpertApiKey, getFastModel, getFastApiBase, getFastApiKey } from './analyzer.js';
import { t } from '../i18n.js';
import { loadPrompt, renderPrompt } from './prompts.js';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Rule-based approval probability estimate — zero AI cost.
 * Uses mechanical check results and available AI scores.
 */
export function estimateByRules(report: CheckReport, lang: string = 'en'): {
  probability: number;
  confidence: 'high' | 'medium' | 'low';
  keyFactors: string[];
} {
  let prob = 50; // baseline
  const factors: string[] = [];

  // Composite score impact
  if (report.compositeScore >= 75) { prob += 25; factors.push(t('approval.factor.composite_high', lang)); }
  else if (report.compositeScore >= 50) { prob += 10; factors.push(t('approval.factor.composite_mid', lang)); }
  else { prob -= 15; factors.push(t('approval.factor.composite_low', lang)); }

  // Hard requirements
  if (report.hardStatus === 'ready') { prob += 15; factors.push(t('approval.factor.hard_ready', lang)); }
  else if (report.hardStatus === 'fail') { prob -= 25; factors.push(t('approval.factor.hard_fail', lang)); }
  else { prob -= 10; factors.push(t('approval.factor.hard_warn', lang)); }

  // AI site score (if available)
  if (report.siteAiScore > 0) {
    if (report.siteAiScore >= 60) { prob += 10; factors.push(t('approval.factor.ai_high', lang)); }
    else if (report.siteAiScore >= 40) { prob += 5; }
    else { prob -= 10; factors.push(t('approval.factor.ai_low', lang)); }
  }

  // Originality dimension weakness
  if (report.aiDimensionStats) {
    const origStats = report.aiDimensionStats.originality;
    if (origStats) {
      const origMin = origStats.min;
      if (origMin >= 6) { prob += 5; }
      else if (origMin < 4) { prob -= 10; factors.push(t('approval.factor.orig_low', lang)); }
    }

    // Low-count page ratio
    const totalPages = report.pages.length;
    if (totalPages > 0) {
      const totalLow = Object.values(report.aiDimensionStats).reduce((s, d) => {
        const stats = d as { lowCount?: number } | null;
        return Math.max(s, stats?.lowCount ?? 0);
      }, 0);
      const lowRatio = totalLow / totalPages;
      if (lowRatio >= 0.5) { prob -= 10; factors.push(t('approval.factor.low_ratio_high', lang)); }
      else if (lowRatio < 0.2) { prob += 5; }
    }
  }

  // Sampling coverage confidence
  const sampledCount = report.pages.length;
  const confidence: 'high' | 'medium' | 'low' =
    sampledCount >= 10 ? 'high' : sampledCount >= 5 ? 'medium' : 'low';

  prob = clamp(prob, 0, 100);

  if (factors.length === 0) factors.push(t('approval.factor.balanced', lang));

  return { probability: prob, confidence, keyFactors: factors.slice(0, 5) };
}

const AI_LANG_NAMES: Record<string, string> = { en: 'English', zh: '中文' };

/**
 * Final assessment summary — runs after all checks complete.
 * Uses the full report including per-page AI analysis as context.
 * When expert=true, uses expert model; otherwise uses fast model.
 */
export async function summarizeFinal(
  report: CheckReport,
  lang: string,
  date: string,
  expert: boolean
): Promise<{
  probability: number;
  verdict: string;
  reasons: string[];
  topActions: string[];
  detailedSummary: string;
  modelName: string;
} | null> {
  const langName = AI_LANG_NAMES[lang] ?? lang;
  const model = expert ? getExpertModel() : getFastModel();
  const apiBase = expert ? getExpertApiBase() : getFastApiBase();
  const apiKey = expert ? getExpertApiKey() : getFastApiKey();

  const pageSummaries = report.pages
    .filter(p => p.ai)
    .slice(0, 15)
    .map(p => {
      const a = p.ai!;
      return `- ${p.url}: [${a.status}] V=${a.valueScore ?? 5} O=${a.originalityScore ?? 5} R=${a.relevanceScore ?? 5} C=${a.complianceScore ?? 5} — ${a.assessment.slice(0, 100)}`;
    }).join('\n');

  const pageValueNote = report.pageValueEstimated
    ? '  (Estimated from structural quality signals — no AI analysis available)'
    : '';

  const template = loadPrompt('approval-summary');
  const prompt = renderPrompt(template, {
    date,
    langName,
    siteTopic: report.siteTopic
      ? report.siteTopic.topic
      : '(unknown)',
    siteUrl: report.url,
    siteType: report.siteType,
    pagesAnalyzed: String(report.pages.length),
    totalDiscovered: String(report.samplingInfo?.totalDiscovered ?? report.pages.length),
    compositeScore: String(report.compositeScore),
    pageValueScore: String(report.pageValueScore),
    siteQuality: String(report.siteQuality),
    homeQuality: String(report.homeQuality),
    pageValueNote,
    pageSummaries: pageSummaries || 'No per-page AI analysis available.',
  });

  try {
    const text = await callAIWithModel(prompt, 2048, model, apiBase, apiKey);
    const result = extractJson(text);
    return {
      probability: clamp(Number(result.probability), 0, 100),
      verdict: result.verdict ?? '',
      reasons: result.reasons ?? [],
      topActions: result.topActions ?? [],
      detailedSummary: result.detailedSummary ?? '',
      modelName: model,
    };
  } catch {
    return null;
  }
}
