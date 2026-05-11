import type { CheckReport } from '../types.js';
import { callAIWithModel, extractJson, getExpertModel, getExpertApiBase, getExpertApiKey, getFastModel, getFastApiBase, getFastApiKey } from './analyzer.js';
import { t } from '../i18n.js';

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
    const origMin = report.aiDimensionStats.originality.min;
    if (origMin >= 6) { prob += 5; }
    else if (origMin < 4) { prob -= 10; factors.push(t('approval.factor.orig_low', lang)); }

    // Low-count page ratio
    const totalPages = report.pages.length;
    if (totalPages > 0) {
      const totalLow = Object.values(report.aiDimensionStats).reduce((s, d) => Math.max(s, d.lowCount), 0);
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

  const dimStats = report.aiDimensionStats ? `
Dimension stats:
  Value:      avg=${report.aiDimensionStats.value.avg} min=${report.aiDimensionStats.value.min} low=${report.aiDimensionStats.value.lowCount}
  Originality: avg=${report.aiDimensionStats.originality.avg} min=${report.aiDimensionStats.originality.min} low=${report.aiDimensionStats.originality.lowCount}
  Relevance:  avg=${report.aiDimensionStats.relevance.avg} min=${report.aiDimensionStats.relevance.min} low=${report.aiDimensionStats.relevance.lowCount}
  Compliance: avg=${report.aiDimensionStats.compliance.avg} min=${report.aiDimensionStats.compliance.min} low=${report.aiDimensionStats.compliance.lowCount}
` : 'No dimension stats available.';

  const siteTopic = report.siteTopic
    ? `\nSite topic: ${report.siteTopic.topic}\nSite type: ${report.siteTopic.type}\nSite description: ${report.siteTopic.description}`
    : '';

  const mechanical = `
Composite score: ${report.compositeScore}/100
Hard status: ${report.hardStatus}
Hard: ${report.passed} pass / ${report.warned} warn / ${report.failed} fail
Soft score: ${report.softScore}/100
AI site score: ${report.siteAiScore}/100
`;

  const prompt = `You are an experienced Google AdSense reviewer. Based on the comprehensive audit report below, estimate the probability that this site will be approved by AdSense.

Current date: ${date}
Reply language: ${langName}. ALL text in the JSON output MUST be in ${langName}. Do NOT use any other language.
${siteTopic}

Mechanical check results:
${mechanical}

${dimStats}

Per-page AI analysis:
${pageSummaries || 'No per-page AI analysis available.'}

Based on all the above, provide your expert assessment in ${langName} with JSON:
{
  "probability": <0-100 integer, your estimated approval probability>,
  "verdict": "<short verdict like 'Likely Pass' / 'Likely Fail' / 'Uncertain'>",
  "reasons": ["3-5 key reasons for your assessment"],
  "topActions": ["2-3 highest-impact actions the site owner should take first"],
  "detailedSummary": "<1-2 sentence paragraph summarizing the overall situation>"
}

Important:
- Be honest and critical — AdSense reviewers are thorough, so your assessment should be too.
- Consider content quality, originality, policy compliance, site completeness, and user experience.
- If the site type is "tool", "game", or "video", consider whether there is sufficient supporting content beyond the core functionality.
- STRICTLY use ${langName} for ALL string values in the JSON. No exceptions.`;

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
