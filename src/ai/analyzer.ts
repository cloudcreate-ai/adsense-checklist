import type { Lang, SiteTopic, PageType } from '../types.js';
import { loadPrompt, renderPrompt } from './prompts.js';

export interface AiAnalysis {
  suggestions: string[];
}

export interface PageAiAnalysis {
  url: string;
  status: 'pass' | 'warn' | 'fail';
  relevance?: 'relevant' | 'tangential' | 'off-topic';
  // Five-dimension scores (0-10)
  valueScore?: number;
  originalityScore?: number;
  relevanceScore?: number;
  complianceScore?: number;
  translationScore?: number;
  // Reasoning behind each score
  valueReason?: string;
  originalityReason?: string;
  relevanceReason?: string;
  complianceReason?: string;
  translationReason?: string;
  assessment: string;
  suggestions: string[];
  // AI-inferred page type (overrides URL-based classification when AI is enabled)
  inferredPageType?: PageType;
}

export interface FullAiAnalysis extends AiAnalysis {
  pageAnalyses: PageAiAnalysis[];
}

function getApiEndpoint(base?: string): string {
  const resolved = base || process.env.AI_API_BASE || 'https://api.deepseek.com';
  return `${resolved.replace(/\/$/, '')}/chat/completions`;
}

function getApiKey(key?: string): string | undefined {
  return key || process.env.AI_API_KEY;
}

export function getFastApiBase(): string {
  return process.env.AI_FAST_API_BASE || process.env.AI_API_BASE || 'https://api.deepseek.com';
}

export function getFastApiKey(): string | undefined {
  return process.env.AI_FAST_API_KEY || process.env.AI_API_KEY;
}

export function getExpertApiBase(): string {
  return process.env.AI_EXPERT_API_BASE || process.env.AI_API_BASE || 'https://api.anthropic.com';
}

export function getExpertApiKey(): string | undefined {
  return process.env.AI_EXPERT_API_KEY || process.env.AI_API_KEY;
}

export function getFastModel(): string {
  return process.env.AI_FAST_MODEL || process.env.AI_MODEL || 'deepseek-chat';
}

async function callAI(prompt: string, maxTokens: number = 4096, model?: string, apiBase?: string, apiKey?: string, maxRetries: number = 3): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(getApiEndpoint(apiBase), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey(apiKey)}`,
        },
        body: JSON.stringify({
          model: model || getFastModel(),
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Wait before retry — exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError!;
}

export function extractJson(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('No JSON found in response');
}

export function getExpertModel(): string {
  return process.env.AI_EXPERT_MODEL || process.env.AI_MODEL || 'claude-sonnet-4-6';
}

export async function callAIWithModel(prompt: string, maxTokens: number, model: string, apiBase?: string, apiKey?: string): Promise<string> {
  return callAI(prompt, maxTokens, model, apiBase, apiKey);
}

const AI_LANG_NAMES: Record<string, string> = {
  en: 'English',
  zh: '中文',
};

function getAiLangName(lang: string): string {
  return AI_LANG_NAMES[lang] ?? lang;
}

const PAGE_CHARS = 5000;

export async function analyzeSinglePage(
  page: { url: string; text: string },
  langName: string,
  date: string,
  siteTopic?: SiteTopic,
  pageLanguage?: string,
  embedType?: 'game' | 'video' | 'none',
  listingSignals?: { listItems: number; hasPagination: boolean; hasCategories: boolean; hasSearch: boolean }
): Promise<PageAiAnalysis> {
  const content = page.text.slice(0, PAGE_CHARS);
  const embed = embedType ?? 'none';

  const listingCtx = listingSignals
    ? `\nListing structure: ${listingSignals.listItems} items, pagination=${listingSignals.hasPagination}, categories=${listingSignals.hasCategories}, search=${listingSignals.hasSearch}`
    : '';

  const template = loadPrompt('analyze-single');
  const prompt = renderPrompt(template, {
    date,
    langName,
    topicContext: siteTopic
      ? `\nSite topic: ${siteTopic.topic}\nSite type: ${siteTopic.type}\nSite description: ${siteTopic.description}`
      : '',
    pageLanguage: pageLanguage || 'English',
    url: page.url,
    embedSignal: embed,
    listingContext: listingCtx,
    content,
  });

  try {
    const text = await callAI(prompt, 2048, undefined, getFastApiBase());
    const result = extractJson(text);
    const details = result.evaluation_details || result; // support both nested and flat formats
    let valueScore = clampScore(details.value);
    let originalityScore = clampScore(details.originality);
    const relevanceScore = clampScore(details.relevance);
    const complianceScore = clampScore(details.compliance);
    const translationScore = clampScore(details.translation);
    const validPageTypes: PageType[] = ['homepage', 'listing', 'content', 'game_detail', 'video_detail', 'reference_detail', 'required', 'utility'];
    const inferredPageType = validPageTypes.includes(result.pageType) ? result.pageType : undefined;
    const confidence: 'high' | 'medium' | 'low' = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'high';

    // Low confidence → reduce value and originality to reflect evaluation uncertainty
    if (confidence === 'low') {
      valueScore = Math.max(0, valueScore - 2);
      originalityScore = Math.max(0, originalityScore - 2);
    } else if (confidence === 'medium') {
      valueScore = Math.max(0, valueScore - 1);
      originalityScore = Math.max(0, originalityScore - 1);
    }

    // For required/utility pages, don't penalize for low value/originality/relevance/translation
    let finalValueScore = valueScore;
    let finalOriginalityScore = originalityScore;
    let finalRelevanceScore = relevanceScore;
    let finalTranslationScore = translationScore;
    if (inferredPageType === 'required' || inferredPageType === 'utility') {
      finalValueScore = 10;
      finalOriginalityScore = 10;
      finalRelevanceScore = 10;
      finalTranslationScore = 10;
    } else if (!pageLanguage || pageLanguage === 'en') {
      finalTranslationScore = 10;
    }

    // Overall status based on geometric mean of 5 dimensions
    const geoMean = Math.pow(finalValueScore * finalOriginalityScore * finalRelevanceScore * complianceScore * finalTranslationScore, 0.2);
    const status: 'pass' | 'warn' | 'fail' = geoMean >= 7 ? 'pass' : geoMean >= 4 ? 'warn' : 'fail';
    return {
      url: page.url,
      status,
      relevance: result.relevanceLabel ?? (finalRelevanceScore >= 7 ? 'relevant' : finalRelevanceScore >= 4 ? 'tangential' : 'off-topic'),
      valueScore: finalValueScore,
      originalityScore: finalOriginalityScore,
      relevanceScore: finalRelevanceScore,
      complianceScore,
      translationScore: finalTranslationScore,
      valueReason: details.value_reason ?? '',
      originalityReason: details.originality_reason ?? '',
      relevanceReason: details.relevance_reason ?? '',
      complianceReason: details.compliance_reason ?? '',
      translationReason: details.translation_reason ?? '',
      assessment: result.assessment ?? '',
      suggestions: result.suggestions ?? [],
      inferredPageType,
    };
  } catch (err) {
    return {
      url: page.url,
      status: 'warn' as const,
      assessment: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      suggestions: [],
    };
  }
}

function clampScore(v: any): number {
  const n = Number(v);
  if (isNaN(n)) return 5; // default if missing
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * Second-pass compliance check for suspicious pages (compliance 3-5).
 * Returns updated compliance scores — takes the higher of first and second pass.
 */
export async function recheckCompliance(
  pages: Array<{ url: string; text: string; firstComplianceScore: number }>,
  langName: string,
  onProgress?: (msg: string) => void
): Promise<Map<string, { complianceScore: number; complianceReason: string; assessment: string }>> {
  const result = new Map<string, { complianceScore: number; complianceReason: string; assessment: string }>();
  if (pages.length === 0) return result;

  const progress = onProgress ?? (() => {});
  progress(`AI: re-checking ${pages.length} suspicious page(s) for compliance...`);

  for (const page of pages) {
    const content = page.text.slice(0, PAGE_CHARS);
    const template = loadPrompt('compliance-recheck');
    const prompt = renderPrompt(template, {
      firstScore: String(page.firstComplianceScore),
      langName,
      url: page.url,
      content,
    });

    try {
      const text = await callAI(prompt, 1024, undefined, getFastApiBase());
      const r = extractJson(text);
      const newScore = clampScore(r.compliance);
      // Take the higher score — give benefit of the doubt on re-check
      const finalScore = Math.max(page.firstComplianceScore, newScore);
      result.set(page.url, {
        complianceScore: finalScore,
        complianceReason: r.compliance_reason ?? '',
        assessment: r.assessment ?? '',
      });
    } catch {
      // On failure, keep the original score
      result.set(page.url, {
        complianceScore: page.firstComplianceScore,
        complianceReason: 'Re-check failed, keeping original score',
        assessment: 'Re-check failed, keeping original score',
      });
    }
  }

  return result;
}

export async function analyzeOverall(
  pageAnalyses: PageAiAnalysis[],
  langName: string,
  date: string
): Promise<{ suggestions: string[] }> {
  const summaries = pageAnalyses.map((p, i) =>
    `Page ${i + 1} (${p.url}): [${p.status}] value=${p.valueScore} originality=${p.originalityScore} relevance=${p.relevanceScore} compliance=${p.complianceScore} translation=${p.translationScore} — ${p.assessment.slice(0, 150)}`
  ).join('\n');

  const template = loadPrompt('overall-suggestions');
  const prompt = renderPrompt(template, {
    date,
    langName,
    pageSummaries: summaries,
  });

  try {
    const text = await callAI(prompt, 2048, undefined, getFastApiBase());
    const result = extractJson(text);
    return {
      suggestions: result.suggestions ?? [],
    };
  } catch {
    return {
      suggestions: [],
    };
  }
}

/**
 * Analyze a batch of pages concurrently.
 * Used by pipeline mode where crawling and AI overlap.
 */
export async function analyzeBatch(
  pages: Array<{ url: string; text: string; lang?: string; embedType?: 'game' | 'video' | 'none'; listingSignals?: { listItems: number; hasPagination: boolean; hasCategories: boolean; hasSearch: boolean } }>,
  lang: string,
  apiKey: string,
  siteTopic?: SiteTopic,
  onProgress?: (message: string) => void
): Promise<PageAiAnalysis[]> {
  const langName = getAiLangName(lang);
  const date = new Date().toISOString().slice(0, 10);
  const progress = onProgress ?? (() => {});
  const paths = pages.map(p => { try { return new URL(p.url).pathname; } catch { return p.url; } });
  progress(`AI: analyzing ${pages.length} page(s) (${paths.join(', ')})`);
  return Promise.all(pages.map(p => analyzeSinglePage(p, langName, date, siteTopic, p.lang, p.embedType, p.listingSignals)));
}

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string; lang?: string; embedType?: 'game' | 'video' | 'none'; listingSignals?: { listItems: number; hasPagination: boolean; hasCategories: boolean; hasSearch: boolean } }>,
  lang: string = 'en',
  apiKey?: string,
  onProgress?: (message: string) => void,
  siteTopic?: SiteTopic,
  concurrency: number = 5
): Promise<FullAiAnalysis> {
  const key = apiKey || getApiKey();
  const empty: FullAiAnalysis = {
    suggestions: [],
    pageAnalyses: [],
  };
  if (!key) return empty;

  const langName = getAiLangName(lang);
  const date = new Date().toISOString().slice(0, 10);

  try {
    const pageAnalyses: PageAiAnalysis[] = [];
    const progress = onProgress ?? (() => {});
    for (let i = 0; i < pages.length; i += concurrency) {
      const batch = pages.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      const totalBatches = Math.ceil(pages.length / concurrency);
      progress(`AI: batch ${batchNum}/${totalBatches} (${batch.map(p => { try { return new URL(p.url).pathname; } catch { return p.url; } }).join(', ')})`);
      const results = await Promise.all(
        batch.map(p => analyzeSinglePage(p, langName, date, siteTopic, p.lang, p.embedType))
      );
      pageAnalyses.push(...results);
    }

    // Phase 2: Overall assessment based on per-page results
    progress('AI: generating overall assessment...');
    const overall = await analyzeOverall(pageAnalyses, langName, date);

    return {
      ...overall,
      pageAnalyses,
    };
  } catch (err) {
    return {
      ...empty,
    };
  }
}
