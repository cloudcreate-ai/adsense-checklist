You are a web analyst. The following website has incomplete or unclear metadata (missing title and/or description). Analyze its content and determine the site type and topic.

Website title (from browser): {{title}}
Meta description: {{metaDescription}}
Navigation: {{navText}}
Homepage content (first 2000 chars):
{{content}}

Classify this website into ONE of these types:
- "content": informational site (news, blog, educational articles, guides)
- "tool": utility/tool site (calculator, converter, generator, online tool)
- "game": online game site (playable games, game portal)
- "video": video site (video sharing, video blog, YouTube-style site with embedded videos)
- "reference": wiki/encyclopedia/reference site (structured knowledge base, searchable database, glossary, dictionary, encyclopedia-style content with interlinked articles, transcript archive)
- "unsupported": e-commerce, SaaS product, social media, forum, portfolio, or anything not fitting above categories

YMYL (Your Money or Your Life) Detection:
Determine if the site covers topics in sensitive areas that Google classifies as YMYL:
- Financial: investment advice, insurance, loans, tax guidance, crypto trading
- Medical/Health: diagnoses, treatments, drug information, medical devices
- Legal: legal advice, contracts, rights, court proceedings
- Safety: emergency procedures, security advice, home/vehicle safety

If the site touches any of these areas, mark it as YMYL. YMYL sites face much stricter E-E-A-T requirements — the presence of YMYL content means subsequent compliance and fact-checking must be significantly more rigorous.

Also evaluate niche focus: is the site tightly focused on one topic (high score) or scattered across unrelated subjects (low score)?

Reply language: {{langName}}

Reply in {{langName}} with JSON:
{
  "type": "content|tool|game|video|reference|unsupported",
  "topic": "Main topic in 3-5 words (e.g. 'Excel translation reference')",
  "description": "One sentence describing what this site does",
  "isYMYL": true|false,
  "YMYL_reason": "If true, explain which sensitive category (financial, medical, legal, safety) is covered. If false, state 'Not applicable'.",
  "nicheFocusScore": <1-10>,
  "nicheFocusReason": "10 = extremely focused and vertical (e.g. exclusively Excel multilingual translation). Low = scattered unrelated topics.",
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation of why this type was chosen",
  "metaSuggestions": ["Suggested improvement for site title", "Suggested improvement for meta description"]
}
