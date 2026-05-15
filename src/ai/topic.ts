import type { SiteTopic, SiteType } from '../types.js';
import { loadPrompt, renderPrompt } from './prompts.js';

function getApiEndpoint(): string {
  const base = process.env.AI_API_BASE || 'https://api.deepseek.com';
  return `${base.replace(/\/$/, '')}/chat/completions`;
}

function getModel(): string {
  return process.env.AI_MODEL || 'deepseek-chat';
}

async function callAI(prompt: string, apiKey: string, maxTokens: number = 1024): Promise<string> {
  const response = await fetch(getApiEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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

const VALID_TYPES: SiteType[] = ['content', 'tool', 'game', 'video', 'reference'];

// Determine if metadata is clear enough to use directly
interface MetaQuality {
  hasTitle: boolean;
  hasDescription: boolean;
  descriptionLength: number;
  score: number; // 0-3
}

function assessMetadata(page: { title: string; metaInfo?: { description: string; ogDescription: string; h1: string } }): MetaQuality {
  const hasTitle = !!page.title && page.title.trim().length > 5;
  const desc = page.metaInfo?.description ?? '';
  const ogDesc = page.metaInfo?.ogDescription ?? '';
  const h1 = page.metaInfo?.h1 ?? '';
  const primaryDesc = desc || ogDesc || '';
  const descriptionLength = primaryDesc.length;
  const hasDescription = descriptionLength > 20;

  let score = 0;
  if (hasTitle) score++;
  if (hasDescription) score++;
  if (descriptionLength > 100) score++;

  return { hasTitle, hasDescription, descriptionLength, score };
}

// Extract topic from metadata only
function extractTopicFromMeta(
  page: { title: string; text: string; metaInfo?: { description: string; ogDescription: string; h1: string } }
): { topic: string; description: string; confidence: 'high' | 'medium' } | null {
  const title = page.title?.trim() || '';
  const desc = page.metaInfo?.description || page.metaInfo?.ogDescription || '';
  const h1 = page.metaInfo?.h1 || '';

  if (!title && !desc && !h1) return null;

  // Use title + description as topic; derive description from meta if available
  const topic = title || h1 || 'Unknown';
  const description = desc || (h1 !== title ? h1 : '');

  return {
    topic,
    description: description.slice(0, 300),
    confidence: (title && desc.length > 50) ? 'high' : 'medium',
  };
}

// Map content to site type based on signals
function guessTypeFromSignals(signals: any, navText: string): SiteType {
  // Game signals
  if (signals.iframeCount > 0 || signals.canvasCount > 0 || signals.gameLinks > 5) return 'game';
  // Video signals
  if (signals.videoElementCount > 0) return 'video';
  // Tool signals — look for calculator/converter patterns in nav
  if (/calc|convert|generator|tool|checker|builder/i.test(navText)) return 'tool';
  // Reference — structured data, glossary, wiki patterns
  if (/wiki|glossary|encyclopedia|dictionary|reference|archive/i.test(navText)) return 'reference';
  // Default: content
  return 'content';
}

export async function analyzeSiteTopic(
  homepage: { title: string; text: string; navText: string; metaInfo?: { description: string; ogDescription: string; h1: string } },
  lang: string = 'en',
  apiKey: string
): Promise<SiteTopic> {
  const langName = lang === 'zh' ? '中文' : 'English';
  const metaQuality = assessMetadata(homepage);
  const metaIncomplete = metaQuality.score < 2; // missing title OR description OR very short description

  // Fast path: metadata is clear enough → use directly
  if (metaQuality.score >= 2) {
    const metaTopic = extractTopicFromMeta(homepage);
    if (metaTopic) {
      const siteType = guessTypeFromSignals(
        { iframeCount: 0, canvasCount: 0, gameLinks: 0, videoElementCount: 0 }, // will be refined by checker
        homepage.navText
      );
      return {
        type: siteType,
        topic: metaTopic.topic,
        description: metaTopic.description,
        confidence: metaTopic.confidence,
        reasoning: 'Extracted from page metadata',
        metaIncomplete,
      };
    }
  }

  // Fallback: metadata unclear → use AI to guess
  const content = homepage.text.slice(0, 2000);
  const title = homepage.title;
  const navText = homepage.navText.slice(0, 500);
  const desc = homepage.metaInfo?.description || homepage.metaInfo?.ogDescription || '(none)';

  const template = loadPrompt('topic-analysis');
  const prompt = renderPrompt(template, {
    title: title || '(none)',
    metaDescription: desc,
    navText: navText.slice(0, 500),
    content: content,
    langName,
  });

  try {
    const text = await callAI(prompt, apiKey);
    const result = extractJson(text);
    const type = VALID_TYPES.includes(result.type) ? result.type : 'unsupported';
    return {
      type: type as SiteType,
      topic: result.topic ?? 'Unknown',
      description: result.description ?? '',
      confidence: result.confidence ?? 'low',
      reasoning: result.reasoning ?? 'AI guessed from content analysis',
      metaIncomplete,
      metaSuggestions: result.metaSuggestions ?? [],
    };
  } catch {
    return {
      type: 'unsupported',
      topic: 'Unknown',
      description: 'Topic analysis failed',
      confidence: 'low',
      reasoning: 'AI analysis failed',
      metaIncomplete,
      metaSuggestions: metaIncomplete ? ['Add a <meta name="description"> tag with 120-160 characters describing your site'] : [],
    };
  }
}
