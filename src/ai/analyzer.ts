import type { Lang, SiteTopic } from '../types.js';

export interface AiAnalysis {
  suggestions: string[];
}

export interface PageAiAnalysis {
  url: string;
  status: 'pass' | 'warn' | 'fail';
  relevance?: 'relevant' | 'tangential' | 'off-topic';
  // Four-dimension scores (0-10)
  valueScore?: number;
  originalityScore?: number;
  relevanceScore?: number;
  complianceScore?: number;
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
  date: string,
  siteTopic?: SiteTopic
): Promise<PageAiAnalysis> {
  const content = page.text.slice(0, PAGE_CHARS);

  const topicContext = siteTopic
    ? `\nSite topic: ${siteTopic.topic}\nSite type: ${siteTopic.type}\nSite description: ${siteTopic.description}`
    : '';

  const prompt = `You are a Google AdSense review expert. Analyze this page and score it on four dimensions.
Current date: ${date}
Reply language: ${langName}
${topicContext}

Score each dimension from 0 to 10:
1. value (0-10): Does the page provide real, substantive information? 10 = highly valuable, 0 = completely empty/useless.
   Consider: depth of information, usefulness to readers, whether it helps solve a problem or answers a question.
2. originality (0-10): Is the content original and not scraped/AI-generated/copied? 10 = fully original, 0 = clearly scraped or auto-generated.
   Consider: unique perspective, personal experience, not just rephrasing others' content.
3. relevance (0-10): How relevant is this page to the site's topic? 10 = directly on-topic, 0 = completely off-topic.
   Also set "relevanceLabel": "relevant" | "tangential" | "off-topic".
4. compliance (0-10): Does the content comply with Google AdSense policies? 10 = fully compliant, 0 = serious violations.
   Flag: adult content, gambling, drugs, violence, copyright infringement, deceptive content.

Page: ${page.url}

Content:
${content}

Reply in ${langName} with JSON:
{
  "value": <0-10>,
  "originality": <0-10>,
  "relevance": <0-10>,
  "relevanceLabel": "relevant|tangential|off-topic",
  "compliance": <0-10>,
  "assessment": "Brief assessment covering the key findings across all dimensions",
  "suggestions": ["Specific actionable suggestion to improve this page"]
}`;

  try {
    const text = await callAI(prompt, 2048);
    const result = extractJson(text);
    const valueScore = clampScore(result.value);
    const originalityScore = clampScore(result.originality);
    const relevanceScore = clampScore(result.relevance);
    const complianceScore = clampScore(result.compliance);
    // Overall status based on geometric mean
    const geoMean = Math.pow(valueScore * originalityScore * relevanceScore * complianceScore, 0.25);
    const status: 'pass' | 'warn' | 'fail' = geoMean >= 7 ? 'pass' : geoMean >= 4 ? 'warn' : 'fail';
    return {
      url: page.url,
      status,
      relevance: result.relevanceLabel ?? (relevanceScore >= 7 ? 'relevant' : relevanceScore >= 4 ? 'tangential' : 'off-topic'),
      valueScore,
      originalityScore,
      relevanceScore,
      complianceScore,
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

function clampScore(v: any): number {
  const n = Number(v);
  if (isNaN(n)) return 5; // default if missing
  return Math.max(0, Math.min(10, Math.round(n)));
}

async function analyzeOverall(
  pageAnalyses: PageAiAnalysis[],
  langName: string,
  date: string
): Promise<{ suggestions: string[] }> {
  const summaries = pageAnalyses.map((p, i) =>
    `Page ${i + 1} (${p.url}): [${p.status}] value=${p.valueScore} originality=${p.originalityScore} relevance=${p.relevanceScore} compliance=${p.complianceScore} — ${p.assessment.slice(0, 150)}`
  ).join('\n');

  const prompt = `You are a Google AdSense review expert. Based on per-page dimension scores below, give site-wide improvement suggestions.
Current date: ${date}
Reply language: ${langName}

Per-page results:
${summaries}

Based on these results, provide improvement suggestions in ${langName} with JSON:
{
  "suggestions": ["Top 3 priority site-wide improvement suggestions, most impactful first"]
}`;

  try {
    const text = await callAI(prompt, 2048);
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

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string }>,
  lang: string = 'en',
  apiKey?: string,
  onProgress?: (message: string) => void,
  siteTopic?: SiteTopic
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
    // Phase 1: Analyze each page individually (concurrency-limited)
    const pageAnalyses: PageAiAnalysis[] = [];
    const progress = onProgress ?? (() => {});
    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const batch = pages.slice(i, i + CONCURRENCY);
      const batchNum = Math.floor(i / CONCURRENCY) + 1;
      const totalBatches = Math.ceil(pages.length / CONCURRENCY);
      progress(`AI: batch ${batchNum}/${totalBatches} (${batch.map(p => { try { return new URL(p.url).pathname; } catch { return p.url; } }).join(', ')})`);
      const results = await Promise.all(
        batch.map(p => analyzePage(p, langName, date, siteTopic))
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
