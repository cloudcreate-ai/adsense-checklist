# @cloudcreate/adsense-check

Automated website checker for Google AdSense review requirements. Detects "low value content" — the #1 rejection reason. Supports content sites, tool sites, game sites, video sites, and reference sites with AI-powered topic analysis, 5-dimension content quality scoring, and stratified sampling.

## Install

```bash
npm install -g @cloudcreate/adsense-check
```

Or run directly without installing:

```bash
npx @cloudcreate/adsense-check https://example.com
```

## AI Configuration

Many features (topic detection, 5-dimension scoring, approval estimation) require an AI API key. Supports any OpenAI-compatible API (DeepSeek, OpenAI, Moonshot, local LLM, etc.).

**Option 1: Environment file**

```bash
cp .env.example .env
# Edit .env:
#   AI_API_KEY=sk-xxx
#   AI_API_BASE=https://api.deepseek.com
#   AI_MODEL=deepseek-chat
```

**Option 2: Command-line flag**

```bash
adsense-check https://example.com --ai --api-key sk-xxx...
```

# Quick Start

```bash
# Full check with AI analysis (AI enabled by default)
adsense-check https://example.com

# Full check with expert AI assessment (auto-enabled when configured)
adsense-check https://example.com --expert

# Disable AI for mechanical checks only
adsense-check https://example.com --no-ai

# JSON output (for programmatic use)
adsense-check https://example.com --json

# Chinese output
adsense-check https://example.com -l zh

# Only detect site type and topic
adsense-check https://example.com --detect-only

# Single-page value analysis (legacy, requires site URL)
adsense-check https://example.com --page https://example.com/some-page
```

### Page Subcommand

Analyze a single page with AI five-dimension scoring:

```bash
# Single-page AI value scoring (no site context)
adsense-check page https://example.com/some-page

# Check relevance against site topic (auto-extracts origin from page URL)
adsense-check page https://example.com/some-page -r

# Override site URL for topic detection (cross-site check, local dev)
adsense-check page https://example.com/some-page -r --site http://localhost:3000/

# With Chinese output
adsense-check page https://example.com/some-page -l zh

# JSON output
adsense-check page https://example.com/some-page --json
```

Without `-r/--relevance`, the page is scored in isolation and Relevance will always be high (the page defines its own topic). With `-r`, the site homepage is auto-extracted from the page URL (`https://example.com/blog/post` → `https://example.com`) and crawled first to detect the site topic, then the page's Relevance score reflects alignment with that theme. Use `--site` to override the auto-extracted origin for cross-site checks or local development.

### Detect Subcommand

Detect site type and topic from the homepage:

```bash
# Detect site type and topic
adsense-check detect https://example.com

# Force site type, skip AI detection
adsense-check detect https://example.com --type game

# JSON output
adsense-check detect https://example.com --json
```

Reports are auto-saved to `tmp/<domain>-<timestamp>.json` and `tmp/<domain>-<timestamp>.md`.

## Features

### Site Type Detection

Automatically classifies websites into supported types:

| Type | Description | Examples |
|------|-------------|----------|
| **Content** | News, blogs, educational articles, guides | theexceltranslator.com |
| **Tool** | Online calculators, converters, generators | ishowspeedsaid.com |
| **Game** | Online games, game portals | popstone2.com |
| **Video** | Video sharing, video blogs, YouTube-style sites | — |
| **Reference** | Wiki, encyclopedia, glossary, knowledge base | ishowspeedsaid.com |
| **Unsupported** | Other types (e-commerce, social, etc.) | — |

AI analysis classifies the site type and topic. Falls back to DOM signal detection when AI is unavailable. Use `--type` to override.

### AI Topic Analysis

With AI enabled (default), the tool analyzes the homepage to determine:
- **Topic**: What the site is about (e.g., "online match-3 puzzle games")
- **Description**: One-line summary of the site's purpose
- **Type**: content / tool / game / video / reference / unsupported

Use `--no-ai` to skip AI analysis. The expert model is auto-enabled when `AI_EXPERT_MODEL` or `AI_EXPERT_API_KEY` is configured with a different model than the fast model. Override with `--no-expert` to disable.

### 5-Dimension AI Page Scoring

Each page is evaluated by AI on five dimensions (0-10):

| Dimension | Description |
|-----------|-------------|
| **Value** | Does the page provide real, substantive information? |
| **Originality** | Is the content original (not scraped/AI-generated/copied)? |
| **Relevance** | How relevant is the page to the site's topic? |
| **Compliance** | Does the content comply with AdSense policies? |
| **Translation** | How well is the content translated into its declared language? |

Page score = geometric mean of all five dimensions. Any dimension at 0 drives the overall score to 0; a low dimension drags down heavily.

Site score = page-type weighted average across all analyzed pages (homepage and content pages have highest weight).

### Page Language Detection

Language is extracted from `<html lang>` and `<meta http-equiv="content-language">` attributes. The translation dimension checks whether page content matches its declared language, flagging mixed-language content and machine-translation artifacts. English pages are auto-scored 10.

### Stratified Sampling

The tool discovers URLs from sitemaps (including recursive sitemap indexes and robots.txt fallback) and homepage links, then performs stratified sampling:

1. **Always-crawl pages**: homepage + required pages (about, privacy, contact, terms)
2. **URL classification**: Each URL is classified by path pattern (content, game_detail, listing, reference_detail, etc.)
3. **Proportional budget allocation**: Remaining crawl budget is distributed across page types proportionally to their weight and count
4. **Freshness sorting**: Within each type group, URLs with date patterns in their paths are crawled first

This approach works on any site structure — it doesn't depend on listing pages or BFS discovery.

### Composite Scoring

Three independent signals combine into the final score:

```
Composite = Page Value(VOT) × Site Quality/100 × Landing Page Quality/100
```

- **Page Value (VOT)**: ∛(Value × Originality × Translation) — the core content quality signal, computed as a geometric mean of AI-evaluated dimensions across all content pages (excluding required/utility pages which don't need editorial content quality)
- **Site-wide Quality**: Pass rate of all hard requirements + content quality + UX categories. Acts as a multiplier — good infrastructure prevents discounting, but can't make mediocre content good
- **Landing Page Quality**: Pass rate of landing page–specific checks (H1, internal links, load speed, viewport, mobile overflow, homepage content). Also a multiplier
- **Caps**: Any page compliance < 6 → max composite 50; avg relevance < 6 → max composite 60

Compliance and relevance are excluded from the VOT mean because they're "safety" dimensions: nearly all pages score 10/10, so including them dilutes the signal from value/originality/translation. When they DO drop below threshold, the cap mechanism kicks in.

#### Page Base Score

Each page receives a base score of 100/100, reduced only by AI quality assessment (AI warn → max 70, AI fail → 0). Content quality is assessed entirely through the AI VOT dimensions rather than structural heuristics like character count or content ratio.

### Approval Estimation

Three-tier assessment:

| Method | Description |
|--------|-------------|
| **Rule-based** | Mechanical estimate from composite score, hard status, AI site score |
| **Fast model** | AI reviews the full report and gives probability + reasons + actions |
| **Expert model** | Deeper analysis with `--expert` flag (uses a more capable model) |

### Compliance Re-check

Pages flagged with borderline compliance scores (3-5) receive a second-pass AI review to reduce false positives. Context-aware: informational/educational mentions of sensitive topics are not treated as violations.

### Evaluate Existing Reports

```bash
adsense-check eval report.json
adsense-check eval report.json --expert
adsense-check eval report.json --json
```

Reads a previously saved JSON report and runs approval estimation without re-crawling.

## Options

```
-v, --version             Show version
-j, --json                Output JSON to stdout
-n, --max-crawl <n>       Total page crawl limit (default: 50)
-m, --page-limit <n>      Max structural pages for sampling pool (default: 50)
-c, --content-limit <n>   Max content pages to crawl (default: 20)
--sample-min <n>          Min content pages to sample (default: 20)
--sample-ratio <ratio>    Content page sampling ratio 0-1 (default: 0.2)
--ai                      Enable AI content quality analysis (default: on)
--no-ai                   Disable AI content quality analysis
--expert                  Enable expert AI summary (default: auto when configured)
--no-expert               Disable expert AI summary
-b, --concurrency <n>     AI batch concurrency (default: 5)
--page <url>              Analyze single page value (5-dimension scoring)
-t, --timeout <ms>        Page load timeout (default: 30000)
--api-key <key>           AI API key
-o, --output <dir>        Report output dir (default: tmp)
--no-save                 Skip auto-saving report
-l, --lang <lang>         Output language: en|zh (default: en)
--type <type>             Force site type: content|tool|game|video|reference
--detect-only             Only detect site type/topic, skip full check
```

### Detect subcommand

```
detect [options] <url>          Detect site type and topic from homepage
  -j, --json                    Output JSON to stdout
  -t, --timeout <ms>            Page load timeout (default: 30000)
  --api-key <key>               AI API key
  -l, --lang <lang>             Output language: en|zh (default: en)
  --type <type>                 Force site type, skip AI detection
```

### Page subcommand

```
page [options] <url>          Analyze a single page with AI five-dimension scoring
  -j, --json                  Output JSON to stdout
  -t, --timeout <ms>          Page load timeout (default: 30000)
  --api-key <key>             AI API key
  -l, --lang <lang>           Output language: en|zh (default: en)
  -r, --relevance             Check relevance against site topic (auto-extracts origin)
  --site <url>                Override site URL for topic detection
```

### Eval subcommand

```
eval <report>             Evaluate approval probability from existing JSON report
  --lang <lang>           Output language: en|zh (default: en)
  --expert                Run expert model assessment (default: auto when configured)
  --no-expert             Disable expert model assessment
  --json                  Output JSON comparison
```

## Report Output

### Terminal Report

```
  AdSense 审核检查报告
  URL: https://example.com
  Time: 2026-05-08T15:00:00.000Z
  Site type: 内容站
  Topic: Excel translation reference — Provides Excel terminology translations for multiple languages.
  页面: 50, 50 AI-analyzed, 置信度: high

  审核结论

  综合评分: 82/100
  ┌─ 全站质量: 94/100
  │  首页质量: 90/100
  │  网页价值: 97/100
  │
  │  97 × 94/100 × 90/100 = 82
  └─

  审核通过概率
    初步评估: ~85% (置信度: 高)
    AI快速评估: ~90% (deepseek-v4-flash)
    AI专家评估: ~88% (deepseek-v4-pro)

  全站质量分解 (94/100)

    ── 硬性要求 PASS

      ✔ 站点规模             站点规模良好 (194 个页面)
      ✔ About            找到 About 页面 (/about/)
      ...
      评分: READY — 所有必要项达标

    ── 内容质量

      ✔ 页面结构多样性良好 (最高相似度 42%)
      ✔ 正文原创度 41/100
      ...

    ── 用户体验

      ✔ 移动端字体
      ✔ 标题层级
      ✔ 导航元素
      ...
```

### Markdown Report

Saved alongside JSON with the same timestamp. Contains summary tables, dimension statistics, per-page details with 5-dimension scores, AI assessments, and improvement suggestions.

### JSON Report

Full structured data including per-page details, AI assessments, topic info, sampling stats, and timing breakdown.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No failures (READY or MOSTLY READY) |
| 1 | Has failures (NOT READY or NEEDS FIXES) |
| 2 | Runtime error |

## License

MIT
