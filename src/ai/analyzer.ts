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

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string }>,
  apiKey?: string
): Promise<FullAiAnalysis> {
  const key = apiKey || getApiKey();
  const empty: FullAiAnalysis = {
    contentQuality: { status: 'skip' as any, detail: '未配置 AI_API_KEY，跳过 AI 分析' },
    originality: { status: 'skip' as any, detail: 'N/A' },
    compliance: { status: 'skip' as any, detail: 'N/A' },
    suggestions: [],
    pageAnalyses: [],
  };
  if (!key) return empty;

  // Limit pages to avoid token overflow (max 8 pages, 1500 chars each)
  const sampled = pages.slice(0, 8);
  const pageContents = sampled
    .map((p, i) => `=== 页面 ${i + 1}: ${p.url} ===\n${p.text.slice(0, 1500)}`)
    .join('\n\n');

  const prompt = `你是一个 Google AdSense 审核专家，专门判断网站是否存在 "low value content" 问题。
当前日期：${new Date().toISOString().slice(0, 10)}

AdSense 最常见的拒绝理由是 "low value content"（低价值内容），表现包括：
- 页面内容太薄，缺乏实质性信息
- 内容像是机器批量生成或从其他网站采集的
- 网站没有为用户提供独特的价值
- 内容空洞，大量凑字数、重复表述
- 多个页面内容高度雷同，只是换了关键词

请分析以下 ${sampled.length} 个页面，返回 JSON：

{
  "overall": {
    "contentQuality": { "status": "pass|warn|fail", "detail": "整体内容价值评估..." },
    "originality": { "status": "pass|warn|fail", "detail": "整体原创性评估..." },
    "compliance": { "status": "pass|warn|fail", "detail": "整体合规性评估..." },
    "suggestions": ["改进建议1", "改进建议2"]
  },
  "pages": [
    {
      "url": "页面URL",
      "status": "pass|warn|fail",
      "assessment": "该页面的具体评估，说明内容价值、问题所在",
      "suggestions": ["针对该页面的具体改进建议"]
    }
  ]
}

页面内容：

${pageContents}`;

  try {
    const text = await callAI(prompt, 4096);
    const result = extractJson(text);

    return {
      contentQuality: result.overall?.contentQuality ?? { status: 'warn', detail: '解析异常' },
      originality: result.overall?.originality ?? { status: 'warn', detail: '解析异常' },
      compliance: result.overall?.compliance ?? { status: 'warn', detail: '解析异常' },
      suggestions: result.overall?.suggestions ?? [],
      pageAnalyses: (result.pages ?? []).map((p: any) => ({
        url: p.url,
        status: p.status ?? 'warn',
        assessment: p.assessment ?? '',
        suggestions: p.suggestions ?? [],
      })),
    };
  } catch (err) {
    return {
      ...empty,
      contentQuality: { status: 'warn', detail: `AI 分析失败: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}
