import Anthropic from '@anthropic-ai/sdk';

export interface AiAnalysis {
  contentQuality: string;
  originality: string;
  compliance: string;
  suggestions: string[];
}

export async function analyzeWithClaude(
  pages: Array<{ url: string; text: string }>,
  apiKey?: string
): Promise<AiAnalysis> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      contentQuality: '未配置 ANTHROPIC_API_KEY，跳过 AI 分析',
      originality: 'N/A',
      compliance: 'N/A',
      suggestions: [],
    };
  }

  const client = new Anthropic({ apiKey: key });

  const contentSummary = pages
    .map(p => `URL: ${p.url}\n${p.text.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `你是一个网站内容质量审核专家，专门评估网站是否符合 Google AdSense 审核要求。

请分析以下网站页面内容，从三个维度给出评估：

1. 内容质量：内容是否对用户有价值？是否有足够深度？语言表达如何？
2. 原创性：内容是否像是原创的？是否有采集/拼凑痕迹？
3. 政策合规：是否含有任何违反 AdSense 政策的内容（色情、暴力、仇恨言论、侵权等）？

请用 JSON 格式回复，结构如下：
{
  "contentQuality": "详细评估...",
  "originality": "原创性评估...",
  "compliance": "合规性评估...",
  "suggestions": ["建议1", "建议2"]
}

以下是网站页面内容：

${contentSummary}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fall through
  }

  return {
    contentQuality: text.slice(0, 500),
    originality: '解析失败',
    compliance: '解析失败',
    suggestions: [],
  };
}
