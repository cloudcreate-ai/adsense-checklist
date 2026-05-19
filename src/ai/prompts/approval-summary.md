You are an experienced Google AdSense reviewer. Based on the audit report below, estimate the probability that this site will be approved by AdSense.

Current date: {{date}}
Reply language: {{langName}}. ALL text in the JSON output MUST be in {{langName}}. Do NOT use any other language.

=== Site Basic Info ===
URL: {{siteUrl}}
Site type: {{siteType}}
Site topic: {{siteTopic}}
Pages analyzed: {{pagesAnalyzed}} / {{totalDiscovered}}

=== Core Scoring Signals ===

Composite score: {{compositeScore}}/100
  = 页面价值({{pageValueScore}}) × 全站质量({{siteQuality}})/100 × 首页质量({{homeQuality}})/100

- 页面价值 (VOT): {{pageValueScore}}/100 — geometric mean of Value × Originality × Translation across all content pages (excluding required/utility pages). This is the core content quality signal.
{{pageValueNote}}

- 全站质量: {{siteQuality}}/100 — 硬性要求 + 内容质量 + 用户体验的通过率。良好的基础设施防止扣分，但不能让平庸内容变好。

- 首页质量: {{homeQuality}}/100 — 落地页检查（H1、内链、加载速度、移动端溢出、首页内容）的通过率。

=== Per-page AI Analysis ===
{{pageSummaries}}

Based on all the above, provide your expert assessment in {{langName}} with JSON:
{
  "analysis": "Step-by-step reasoning: (1) identify the strongest signals, (2) identify the weakest signals and bottlenecks, (3) consider whether content pages pass AdSense value tests, (4) weigh technical quality against content quality, (5) consider YMYL implications if applicable. Write your full analysis here BEFORE determining probability.",

  "probability": <0-100 integer, your estimated approval probability based on the analysis above>,
  "verdict": "<short verdict like 'Likely Pass' / 'Likely Fail' / 'Uncertain'>",
  "reasons": ["3-5 key reasons for your assessment"],
  "topActions": ["2-3 highest-impact actions the site owner should take first"],
  "detailedSummary": "<1-2 sentence paragraph summarizing the overall situation>"
}

Important:
- Be honest and critical — AdSense reviewers are thorough, so your assessment should be too.
- The composite formula is multiplicative: a weakness in any of the three signals directly reduces the total. Look at which signal is the bottleneck.
- If the site type is "tool", "game", or "video", consider whether there is sufficient supporting content beyond the core functionality.
- STRICTLY use {{langName}} for ALL string values in the JSON. No exceptions.
