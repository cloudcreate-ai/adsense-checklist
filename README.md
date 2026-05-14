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

## Quick Start

```bash
# Full check with AI analysis
adsense-check https://example.com --ai

# Full check with expert AI assessment
adsense-check https://example.com --ai --expert

# Quick check without AI (mechanical checks only)
adsense-check https://example.com

# JSON output (for programmatic use)
adsense-check https://example.com --json

# Chinese output
adsense-check https://example.com -l zh --ai

# Only detect site type and topic
adsense-check https://example.com --detect-only --ai

# Single-page value analysis
adsense-check https://example.com --page https://example.com/some-page --ai
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

With `--ai`, the tool analyzes the homepage to determine:
- **Topic**: What the site is about (e.g., "online match-3 puzzle games")
- **Description**: One-line summary of the site's purpose
- **Type**: content / tool / game / video / reference / unsupported

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

### Two-Group Scoring

Checks are divided into **Hard Requirements** (pass/fail) and **Soft Scoring** (0-100):

```
Composite = Hard Pass Rate × 0.4 + Soft Score × 0.6 - Warning Penalty
```

- **Hard**: Site scale, required pages, structure, performance baseline, policy compliance (including AI compliance)
- **Soft**: AI value analysis (45%), content quality (35%), user experience (10%), page quality (10%)
- **Warning penalty**: Applied when >15% of checks are warnings

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
--ai                      Enable AI content quality analysis
--expert                  Enable expert AI summary (requires --ai)
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

### Eval subcommand

```
eval <report>             Evaluate approval probability from existing JSON report
  --lang <lang>           Output language: en|zh (default: en)
  --expert                Run expert model assessment
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

  综合评分: 82/100

  审核通过概率
  机械推算: ~85% (置信度: 高)
  快速评估: ~90% (deepseek-v4-flash)
  深度评估: ~88% (deepseek-v4-pro)

  ┌─ 硬性要求 ──────────────────────────────────── PASS
  │  ✔ 站点规模             站点规模良好 (194 个页面)
  │  ✔ About            找到 About 页面 (/about/)
  │  ...
  └─ 评分: READY — 所有必要项达标

  ┌─ 智能评分 ──────────────────────────────────── 75/100
  │  ████████████████████ 100%  内容质量
  │  ████████████████████ 100%  用户体验
  │  ████████░░░░░░░░░░░░  40%  价值分析
  │
  │  AI 维度: 价值 7.9/10 原创 7.8/10 相关 9.8/10 合规 9.9/10 翻译 10/10
  │  维度统计: 价值 均7.9 最低5  1/50, 2%
  └─
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
