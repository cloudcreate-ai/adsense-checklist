export interface AiAnalysis {
  contentQuality: { status: 'pass' | 'warn' | 'fail'; detail: string };
  originality: { status: 'pass' | 'warn' | 'fail'; detail: string };
  compliance: { status: 'pass' | 'warn' | 'fail'; detail: string };
  suggestions: string[];
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

export async function analyzeWithAI(
  pages: Array<{ url: string; text: string }>,
  apiKey?: string
): Promise<AiAnalysis> {
  const key = apiKey || getApiKey();
  if (!key) {
    return {
      contentQuality: { status: 'skip' as any, detail: '未配置 AI_API_KEY，跳过 AI 分析' },
      originality: { status: 'skip' as any, detail: 'N/A' },
      compliance: { status: 'skip' as any, detail: 'N/A' },
      suggestions: [],
    };
  }

  const contentSummary = pages
    .map(p => `URL: ${p.url}\n${p.text.slice(0, 2000)}`)
    .join('\n\n---\n\n');

  const response = await fetch(getApiEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `你是一个 Google AdSense 审核专家，专门判断网站是否存在 "low value content" 问题。
当前日期：${new Date().toISOString().slice(0, 10)}

AdSense 最常见的拒绝理由是 "low value content"（低价值内容），具体表现包括：
- 页面内容太薄，缺乏实质性信息
- 内容像是机器批量生成或从其他网站采集的
- 网站没有为用户提供独特的价值（只是搬运/改写别人的内容）
- 内容空洞，大量凑字数、重复表述、无意义的填充文字
- 多个页面内容高度雷同，只是换了关键词

请从三个维度评估：

1. 内容价值：用户访问这些页面能获得什么？内容是否有深度、有见解、有帮助？还是只是泛泛而谈？
2. 原创性：内容是否像人工撰写的原创内容？是否有 AI 生成痕迹（过于工整、缺乏个人观点）？是否有采集痕迹？
3. 政策合规：是否含有违反 AdSense 政策的内容？

请用 JSON 格式回复，每个维度包含 status 和 detail 字段。
status 取值: "pass"（通过）、"warn"（有问题但可改进）、"fail"（不符合要求）。
结构如下：
{
  "contentQuality": { "status": "pass|warn|fail", "detail": "详细评估..." },
  "originality": { "status": "pass|warn|fail", "detail": "原创性评估..." },
  "compliance": { "status": "pass|warn|fail", "detail": "合规性评估..." },
  "suggestions": ["建议1", "建议2"]
}

以下是网站页面内容：

${contentSummary}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fall through
  }

  return {
    contentQuality: { status: 'warn', detail: text.slice(0, 500) },
    originality: { status: 'warn', detail: '解析失败' },
    compliance: { status: 'warn', detail: '解析失败' },
    suggestions: [],
  };
}
