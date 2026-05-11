import type { Lang, SiteTopic, PageType } from '../types.js';

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

async function callAI(prompt: string, maxTokens: number = 4096, model?: string, apiBase?: string, apiKey?: string): Promise<string> {
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
   Important context rules:
   - Words like "crack", "bet", "drug", "gamble" used in educational, news, or informational contexts are NOT violations.
   - If the page discusses or reports on sensitive topics (e.g., "puzzle crack" as a news headline, "betting odds" in sports analysis), this is NOT a violation.
   - Only flag actual promotion or facilitation of policy-violating content.
   - If the page appears to be a 404 error page or has minimal content, do not flag it as a compliance violation. Note it as "insufficient content for compliance review".

Also classify the page type based on its content and purpose. Choose ONE:
- "homepage": The site's main landing page
- "listing": An index/category page listing multiple items (articles, mods, products)
- "content": A standalone article, blog post, guide, or tutorial
- "game_detail": A game page with playable game or game download
- "video_detail": A page centered around a video or video embed
- "reference_detail": A wiki entry, glossary term, encyclopedia article, or database record
- "required": About, Privacy, Terms, Contact, Editorial Policy, Legal
- "utility": Search, Login, Signup, Download, 404, or functional tool pages

IMPORTANT — special handling for "required" and "utility" pages:
These pages are necessary for site operation. Do NOT penalize them for low value, originality, or relevance.
- For "required" pages (Privacy, Terms, About, Contact, Legal): set value=10, originality=10, relevance=10 automatically.
- Only score compliance normally. Check if the page has reasonable content (not empty or placeholder).
- For "utility" pages (Search, Login, 404): same rule — set value=10, originality=10, relevance=10, only evaluate compliance and basic completeness.
- For all other page types (homepage, listing, content, game_detail, video_detail, reference_detail): score all four dimensions normally.

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
  "pageType": "homepage|listing|content|game_detail|video_detail|reference_detail|required|utility",
  "assessment": "Brief assessment covering the key findings across all dimensions",
  "suggestions": ["Specific actionable suggestion to improve this page"]
}`;

  try {
    const text = await callAI(prompt, 2048, undefined, getFastApiBase());
    const result = extractJson(text);
    const valueScore = clampScore(result.value);
    const originalityScore = clampScore(result.originality);
    const relevanceScore = clampScore(result.relevance);
    const complianceScore = clampScore(result.compliance);
    const validPageTypes: PageType[] = ['homepage', 'listing', 'content', 'game_detail', 'video_detail', 'reference_detail', 'required', 'utility'];
    const inferredPageType = validPageTypes.includes(result.pageType) ? result.pageType : undefined;

    // For required/utility pages, don't penalize for low value/originality/relevance
    let finalValueScore = valueScore;
    let finalOriginalityScore = originalityScore;
    let finalRelevanceScore = relevanceScore;
    if (inferredPageType === 'required' || inferredPageType === 'utility') {
      finalValueScore = 10;
      finalOriginalityScore = 10;
      finalRelevanceScore = 10;
    }

    // Overall status based on geometric mean
    const geoMean = Math.pow(finalValueScore * finalOriginalityScore * finalRelevanceScore * complianceScore, 0.25);
    const status: 'pass' | 'warn' | 'fail' = geoMean >= 7 ? 'pass' : geoMean >= 4 ? 'warn' : 'fail';
    return {
      url: page.url,
      status,
      relevance: result.relevanceLabel ?? (finalRelevanceScore >= 7 ? 'relevant' : finalRelevanceScore >= 4 ? 'tangential' : 'off-topic'),
      valueScore: finalValueScore,
      originalityScore: finalOriginalityScore,
      relevanceScore: finalRelevanceScore,
      complianceScore,
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
): Promise<Map<string, { complianceScore: number; assessment: string }>> {
  const result = new Map<string, { complianceScore: number; assessment: string }>();
  if (pages.length === 0) return result;

  const progress = onProgress ?? (() => {});
  progress(`AI: re-checking ${pages.length} suspicious page(s) for compliance...`);

  for (const page of pages) {
    const content = page.text.slice(0, PAGE_CHARS);
    const prompt = `You are a Google AdSense policy compliance expert. A previous analysis flagged this page as potentially non-compliant (score: ${page.firstComplianceScore}/10). Perform a careful second review.

Focus ONLY on compliance. Check for:
- Adult or sexually explicit content
- Gambling or casino promotion
- Illegal drugs or controlled substances
- Violence, gore, or hate speech
- Copyright infringement or pirated content
- Deceptive content, phishing, or scams
- Excessive profanity
- Misleading medical/financial claims
- Content that targets children inappropriately

Be fair — informational/educational content ABOUT sensitive topics (e.g., health articles, news reporting) is NOT a violation. Only flag actual policy violations.

Additional instructions:
- If the page text is very short (< 200 characters) and appears to be an error page, 404, or placeholder, do not flag any compliance violations. Score compliance as 10 and note "insufficient content".
- Context matters: words that match policy keywords but appear in news reporting, educational content, or informational discussion are NOT violations.

Page: ${page.url}

Content:
${content}

Reply in ${langName} with JSON:
{
  "compliance": <0-10>,
  "verdict": "compliant|borderline|violation",
  "assessment": "Brief explanation of your compliance determination"
}`;

    try {
      const text = await callAI(prompt, 1024, undefined, getFastApiBase());
      const r = extractJson(text);
      const newScore = clampScore(r.compliance);
      // Take the higher score — give benefit of the doubt on re-check
      const finalScore = Math.max(page.firstComplianceScore, newScore);
      result.set(page.url, {
        complianceScore: finalScore,
        assessment: r.assessment ?? '',
      });
    } catch {
      // On failure, keep the original score
      result.set(page.url, {
        complianceScore: page.firstComplianceScore,
        assessment: 'Re-check failed, keeping original score',
      });
    }
  }

  return result;
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
