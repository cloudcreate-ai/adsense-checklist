import type { Lang, SiteTopic, PageType } from '../types.js';

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

export async function analyzeSinglePage(
  page: { url: string; text: string },
  langName: string,
  date: string,
  siteTopic?: SiteTopic,
  pageLanguage?: string
): Promise<PageAiAnalysis> {
  const content = page.text.slice(0, PAGE_CHARS);

  const topicContext = siteTopic
    ? `\nSite topic: ${siteTopic.topic}\nSite type: ${siteTopic.type}\nSite description: ${siteTopic.description}`
    : '';

  const prompt = `You are a Google AdSense review expert. Analyze this page and score it on five dimensions.
Current date: ${date}
Reply language: ${langName}
${topicContext}

## Step 1 — Classify the page type
Choose ONE type based on the page's content and purpose:
- "homepage": The site's main landing page
- "listing": An index/category page listing multiple items
- "content": A standalone article, blog post, guide, or tutorial
- "game_detail": A game page with a playable game or game download
- "video_detail": A page centered around a video or video embed
- "reference_detail": A wiki entry, glossary term, encyclopedia article, or database record
- "required": About, Privacy, Terms, Contact, Legal, Editorial Policy
- "utility": Search, Login, Signup, Download, 404, or functional tool pages

## Step 2 — Score based on page type

### For "required" and "utility" pages:
Set value=10, originality=10, relevance=10, translation=10 automatically. Only evaluate compliance (is the page reasonably complete and not empty/placeholder?).

### For "game_detail" pages:
The page's core value IS the interactive gaming experience, not editorial text.
- value: Score 7+ if the page embeds a working game with basic context (title, description, instructions). Score 3-4 only if the embed is broken, missing, or there's zero supporting text.
- originality: Score based on curation quality — unique descriptions, gameplay tips, editorial commentary. Score 5-7 for basic original descriptions. Score 7+ for pages with gameplay tips or unique analysis. Score 3-4 only for generic one-liners like "Play X free online" that clearly follow an auto-generated template.
- relevance: How relevant the game is to the site's overall topic/theme.
- compliance: Flag actual policy violations (see rules below).

### For "video_detail" pages:
The page's core value IS the video content, not surrounding text.
- value: Score 7+ if the page embeds a working video with basic context. Score 3-4 only if the video is broken or the page has zero supporting text.
- originality: Score based on unique descriptions, analysis, commentary, or curation. Score 5-7 for basic original descriptions. Score 3-4 for generic boilerplate.
- relevance: How relevant the video is to the site's topic.
- compliance: Flag actual policy violations.

### For "content" pages (articles, guides, tutorials):
- value: Depth and usefulness of information. Score 7+ for detailed, substantive, helpful content. Score 3-4 for thin or superficial content.
- originality: Unique perspective, personal experience, not just rephrasing others. Score 7+ for genuine original analysis. Score 3-4 for scraped/AI-generated/templated content.
- relevance: How relevant to the site's topic.
- compliance: Flag actual policy violations.

### For "listing" pages:
- value: Navigation and discovery utility. Well-organized categories with useful descriptions score 7+. Bare link lists score 3-4.
- originality: Editorial curation, unique categorization, original introductions. Score 7+ for pages with unique editorial organization. Score 3-4 for auto-generated link dumps.
- relevance: How relevant the listed items are to the site's topic.
- compliance: Flag actual policy violations.

### For "homepage":
- value: Does the page clearly communicate the site's purpose and help users navigate? Score 7+ for clear, informative, well-structured homepages.
- originality: Unique positioning, brand identity, editorial voice.
- relevance: By definition should be highly relevant to the site's topic.
- compliance: Flag actual policy violations.

### For "reference_detail" pages:
- value: Completeness and accuracy of information. Score 7+ for thorough, well-structured entries.
- originality: Original compilation, unique presentation, not just copied from other sources.
- relevance: How relevant to the site's topic.
- compliance: Flag actual policy violations.

### Compliance rules (apply to ALL page types):
Flag: adult content, gambling promotion, drugs, violence promotion, copyright infringement, deceptive content.
- Words like "crack", "bet", "drug", "gamble" used in educational, news, or informational contexts are NOT violations.
- Only flag actual promotion or facilitation of policy-violating content.
- If the page is a 404 or has minimal content, do not flag. Note "insufficient content".

### Translation rules (apply to ALL page types):
Declared language: ${pageLanguage || 'English'}
Score 10 = content is fully, correctly, and naturally written in the declared language.
Score 0 = content is completely untranslated or machine-translated gibberish.

**STRICT SCORING RULES — do NOT be lenient:**
- If ANY paragraph or section of substantial length (2+ sentences) is in a different language than declared, score ≤ 5.
- If FAQ headings are in one language but answers are in another, score ≤ 4.
- If key content blocks are left in English while the rest is in the declared language, score ≤ 5.
- If the page mixes 3+ languages, score ≤ 3.
- Minor UI artifacts (button text, copyright notice) alone → score 8-9.
- If the declared language is English or not set, score 10 automatically.

Page: ${page.url}

Content:
${content}

Reply in ${langName} with JSON:
{
  "pageType": "homepage|listing|content|game_detail|video_detail|reference_detail|required|utility",
  "value": <0-10>,
  "originality": <0-10>,
  "relevance": <0-10>,
  "relevanceLabel": "relevant|tangential|off-topic",
  "compliance": <0-10>,
  "translation": <0-10>,
  "confidence": "high|medium|low",
  "assessment": "Brief assessment covering the key findings across all dimensions",
  "suggestions": ["Specific actionable suggestion to improve this page"]
}

**Confidence scoring rules:**
- "high": Page type is clear and the evaluation criteria apply well.
- "medium": Page type is somewhat ambiguous, or the page is a hybrid that doesn't fit cleanly into one category. Note the uncertainty in the assessment.
- "low": Cannot determine page type, or the page is too minimal/thin to meaningfully evaluate. Reduce value and originality by 1-2 points to reflect the uncertainty. Note why in the assessment.
`;

  try {
    const text = await callAI(prompt, 2048, undefined, getFastApiBase());
    const result = extractJson(text);
    let valueScore = clampScore(result.value);
    let originalityScore = clampScore(result.originality);
    const relevanceScore = clampScore(result.relevance);
    const complianceScore = clampScore(result.compliance);
    const translationScore = clampScore(result.translation);
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

export async function analyzeOverall(
  pageAnalyses: PageAiAnalysis[],
  langName: string,
  date: string
): Promise<{ suggestions: string[] }> {
  const summaries = pageAnalyses.map((p, i) =>
    `Page ${i + 1} (${p.url}): [${p.status}] value=${p.valueScore} originality=${p.originalityScore} relevance=${p.relevanceScore} compliance=${p.complianceScore} translation=${p.translationScore} — ${p.assessment.slice(0, 150)}`
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

/**
 * Analyze a batch of pages concurrently.
 * Used by pipeline mode where crawling and AI overlap.
 */
export async function analyzeBatch(
  pages: Array<{ url: string; text: string; lang?: string }>,
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
  return Promise.all(pages.map(p => analyzeSinglePage(p, langName, date, siteTopic, p.lang)));
}

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string; lang?: string }>,
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
        batch.map(p => analyzeSinglePage(p, langName, date, siteTopic, p.lang))
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
