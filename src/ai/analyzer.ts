import type { Lang } from '../types.js';
import { t } from '../i18n.js';

export interface AiAnalysis {
  contentQuality: { status: 'pass' | 'warn' | 'fail'; detail: string };
  originality: { status: 'pass' | 'warn' | 'fail'; detail: string };
  compliance: { status: 'pass' | 'warn' | 'fail'; detail: string };
  suggestions: string[];
}

export interface PageAiAnalysis {
  url: string;
  status: 'pass' | 'warn' | 'fail';
  assessment: string;
  suggestions: string[];
}

export interface FullAiAnalysis extends AiAnalysis {
  pageAnalyses: PageAiAnalysis[];
}

function getApiEndpoint(): string {
  const base = process.env.AI_API_BASE || 'https://api.deepseek.com';
  return `${base.replace(/\/$/, '')}/chat/completions`;
}

function getApiKey(): string | undefined {
  return process.env.AI_API_KEY;
}

function getModel(): string {
  return process.env.AI_MODEL || 'deepseek-chat';
}

async function callAI(prompt: string, maxTokens: number = 4096): Promise<string> {
  const response = await fetch(getApiEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function extractJson(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('No JSON found in response');
}

const AI_LANG_NAMES: Record<string, string> = {
  en: 'English',
  zh: '中文',
};

function getAiLangName(lang: string): string {
  return AI_LANG_NAMES[lang] ?? lang;
}

const PAGE_CHARS = 5000;
const CONCURRENCY = 3;

async function analyzePage(
  page: { url: string; text: string },
  langName: string,
  date: string
): Promise<PageAiAnalysis> {
  const content = page.text.slice(0, PAGE_CHARS);

  const prompt = `You are a Google AdSense review expert. Analyze this page for "low value content" issues.
Current date: ${date}
Reply language: ${langName}

Low value content signs:
- Thin content lacking substantial information
- Machine-generated or scraped content
- No unique value for users
- Padded/repetitive content to fill space
- Template-like structure with minimal real content

Page: ${page.url}

Content:
${content}

Reply in ${langName} with JSON:
{
  "status": "pass|warn|fail",
  "assessment": "Detailed assessment: content depth, originality, user value, specific issues found",
  "suggestions": ["Specific actionable suggestion to improve this page"]
}`;

  try {
    const text = await callAI(prompt, 2048);
    const result = extractJson(text);
    return {
      url: page.url,
      status: result.status ?? 'warn',
      assessment: result.assessment ?? '',
      suggestions: result.suggestions ?? [],
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

async function analyzeOverall(
  pageAnalyses: PageAiAnalysis[],
  langName: string,
  date: string
): Promise<{ contentQuality: AiAnalysis['contentQuality']; originality: AiAnalysis['originality']; compliance: AiAnalysis['compliance']; suggestions: string[] }> {
  const summaries = pageAnalyses.map((p, i) =>
    `Page ${i + 1} (${p.url}): [${p.status}] ${p.assessment.slice(0, 200)}`
  ).join('\n');

  const prompt = `You are a Google AdSense review expert. Based on per-page analyses below, give an overall site assessment.
Current date: ${date}
Reply language: ${langName}

Per-page results:
${summaries}

Based on these results, provide an overall assessment in ${langName} with JSON:
{
  "contentQuality": { "status": "pass|warn|fail", "detail": "Overall content value assessment considering all pages" },
  "originality": { "status": "pass|warn|fail", "detail": "Overall originality assessment across the site" },
  "compliance": { "status": "pass|warn|fail", "detail": "Overall AdSense policy compliance" },
  "suggestions": ["Top priority site-wide improvement suggestion"]
}`;

  try {
    const text = await callAI(prompt, 2048);
    const result = extractJson(text);
    return {
      contentQuality: result.contentQuality ?? { status: 'warn', detail: 'Parse error' },
      originality: result.originality ?? { status: 'warn', detail: 'Parse error' },
      compliance: result.compliance ?? { status: 'warn', detail: 'Parse error' },
      suggestions: result.suggestions ?? [],
    };
  } catch {
    return {
      contentQuality: { status: 'warn' as const, detail: 'Overall analysis failed' },
      originality: { status: 'warn' as const, detail: 'N/A' },
      compliance: { status: 'warn' as const, detail: 'N/A' },
      suggestions: [],
    };
  }
}

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string }>,
  lang: string = 'en',
  apiKey?: string
): Promise<FullAiAnalysis> {
  const key = apiKey || getApiKey();
  const empty: FullAiAnalysis = {
    contentQuality: { status: 'skip' as any, detail: t('ai.skip', lang) },
    originality: { status: 'skip' as any, detail: 'N/A' },
    compliance: { status: 'skip' as any, detail: 'N/A' },
    suggestions: [],
    pageAnalyses: [],
  };
  if (!key) return empty;

  const langName = getAiLangName(lang);
  const date = new Date().toISOString().slice(0, 10);

  try {
    // Phase 1: Analyze each page individually (concurrency-limited)
    const pageAnalyses: PageAiAnalysis[] = [];
    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const batch = pages.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(p => analyzePage(p, langName, date))
      );
      pageAnalyses.push(...results);
    }

    // Phase 2: Overall assessment based on per-page results
    const overall = await analyzeOverall(pageAnalyses, langName, date);

    return {
      ...overall,
      pageAnalyses,
    };
  } catch (err) {
    return {
      ...empty,
      contentQuality: { status: 'warn', detail: t('ai.fail', lang, { error: err instanceof Error ? err.message : String(err) }) },
    };
  }
}
