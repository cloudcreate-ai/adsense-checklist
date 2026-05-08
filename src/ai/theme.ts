import type { SiteTheme, SiteType } from '../types.js';

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

const VALID_TYPES: SiteType[] = ['content', 'tool', 'game'];

export async function analyzeSiteTheme(
  homepage: { title: string; text: string; navText: string },
  lang: string = 'en',
  apiKey: string
): Promise<SiteTheme> {
  const langName = lang === 'zh' ? '中文' : 'English';
  const content = homepage.text.slice(0, 2000);

  const prompt = `You are a web analyst. Determine the type and theme of this website.

Homepage title: ${homepage.title}
Navigation: ${homepage.navText.slice(0, 500)}
Homepage content (first 2000 chars):
${content}

Classify this website into ONE of these types:
- "content": informational site (news, blog, reference materials, educational content)
- "tool": utility/tool site (calculator, converter, generator, online tool)
- "game": online game site (playable games, game portal)
- "unsupported": e-commerce, SaaS product, social media, forum, portfolio, or anything not fitting above categories

Reply language: ${langName}

Reply in ${langName} with JSON:
{
  "type": "content|tool|game|unsupported",
  "topic": "Main topic/theme in 3-5 words (e.g. 'Excel translation reference')",
  "description": "One sentence describing what this site does",
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation of why this type was chosen"
}`;

  try {
    const text = await callAI(prompt, apiKey);
    const result = extractJson(text);
    const type = VALID_TYPES.includes(result.type) ? result.type : 'unsupported';
    return {
      type: type as SiteType,
      topic: result.topic ?? 'Unknown',
      description: result.description ?? '',
      confidence: result.confidence ?? 'medium',
      reasoning: result.reasoning ?? '',
    };
  } catch {
    return {
      type: 'unsupported',
      topic: 'Unknown',
      description: 'Theme analysis failed',
      confidence: 'low',
      reasoning: 'AI analysis failed',
    };
  }
}
