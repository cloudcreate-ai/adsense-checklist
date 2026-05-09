# @cloudcreate/adsense-check

Automated website checker for Google AdSense review requirements. Detects "low value content" — the #1 rejection reason. Supports content sites, tool sites, game sites, video sites, and reference sites with AI-powered topic analysis and content relevance checking.

## Install

```bash
npm install -g @cloudcreate/adsense-check
```

Or run directly without installing:

```bash
npx @cloudcreate/adsense-check https://example.com
```

## Quick Start

```bash
# Full check with AI analysis
adsense-check https://example.com --ai

# Quick check without AI
adsense-check https://example.com

# JSON output (for programmatic use)
adsense-check https://example.com --json

# Chinese output
adsense-check https://example.com -l zh --ai

# Only detect site type and topic
adsense-check https://example.com --detect-only --ai
```

Reports are auto-saved to `tmp/<domain>-<timestamp>.json`.

## Features

### Site Type Detection

Automatically classifies websites into three supported types:

| Type | Description | Examples |
|------|-------------|----------|
| **Content** | News, blogs, educational articles, guides | theexceltranslator.com |
| **Tool** | Online calculators, converters, generators | ishowspeedsaid.com |
| **Game** | Online games, game portals | popstone2.com |
| **Video** | Video sharing, video blogs, YouTube-style sites | — |
| **Reference** | Wiki, encyclopedia, glossary, knowledge base | — |
| **Unsupported** | Other types (e-commerce, social, etc.) | — |

AI analysis classifies the site type and topic. Falls back to DOM signal detection when AI is unavailable.

### AI Topic Analysis

With `--ai`, the tool analyzes the homepage to determine:
- **Topic**: What the site is about (e.g., "online match-3 puzzle games")
- **Description**: One-line summary of the site's purpose
- **Type**: content / tool / game / video / reference / unsupported

### Content Relevance Checking

Each page is evaluated for relevance to the site's topic:
- **relevant**: Directly related to the site's topic
- **tangential**: Loosely related
- **off-topic**: Unrelated to the site's purpose

Sites with >30% off-topic content are flagged as potentially failing review.

### Sampling Strategy

The tool discovers content pages from sitemaps (including recursive sitemap indexes) and homepage links, then samples based on:

- **6-month freshness**: Prioritizes recently updated content
- **Configurable minimum**: `--sample-min` (default: 20)
- **Configurable ratio**: `--sample-ratio` (default: 0.2, i.e., 20%)
- **Confidence level**: high (≥50%), medium (≥20%), low (<20%)

### Two-Group Scoring

Checks are divided into **Hard Requirements** (pass/fail) and **Soft Scoring** (0-100):

```
Composite = Hard Pass Rate × 0.4 + Soft Score × 0.6 - Warning Penalty
```

- **Hard**: Site scale, required pages, structure, performance baseline, policy compliance (including AI compliance)
- **Soft**: AI value analysis (45%), content quality (35%), user experience (10%), page quality (10%)

### AI Value Scoring

Each page is scored on four dimensions (0-10) by AI:

| Dimension | Description |
|-----------|-------------|
| **Value** | Does the page provide real, substantive information? |
| **Originality** | Is the content original (not scraped/AI-generated/copied)? |
| **Relevance** | How relevant is the page to the site's topic? |
| **Compliance** | Does the content comply with AdSense policies? |

Page score = geometric mean of all four dimensions. This means any weak dimension drags down the overall score significantly.

Site score = page-type weighted average across all analyzed pages (homepage and content pages have highest weight).

### AI Page Classification

With `--ai`, each page is classified by content analysis into one of: homepage, listing, content, game_detail, video_detail, reference_detail, required, utility. This overrides URL-based classification for sites with non-standard URL patterns.

### Compliance Re-check

Pages flagged with borderline compliance scores (3-5) receive a second-pass AI review to reduce false positives. Context-aware: informational/educational mentions of sensitive topics are not treated as violations.

### Single-Page Analysis

```bash
adsense-check <site> --page <url> --ai
```

## Options

```
-v, --version             Show version
-j, --json                Output JSON to stdout
-n, --max-crawl <n>       Total page crawl limit, Phase 1 + 2 (default: 50)
-m, --page-limit <n>      Max structural pages to crawl, Phase 1 (default: 50)
-c, --content-limit <n>   Max content pages to crawl, Phase 2 (default: 20)
--sample-min <n>          Min content pages to sample (default: 20)
--sample-ratio <ratio>    Content page sampling ratio 0-1 (default: 0.2)
--ai                      Enable AI content quality analysis
--page <url>              Analyze single page value (four-dimension scoring)
-t, --timeout <ms>        Page load timeout (default: 30000)
--api-key <key>           AI API key
-o, --output <dir>        Report output dir (default: tmp)
--no-save                 Skip auto-saving report
-l, --lang <lang>         Output language: en|zh (default: en)
--type <type>             Force site type: content|tool|game|video|reference
--detect-only             Only detect site type/topic, skip full check
```

## AI Configuration

Supports any OpenAI-compatible API (DeepSeek, OpenAI, Moonshot, local LLM, etc.).

```bash
cp .env.example .env
# Edit .env:
#   AI_API_KEY=sk-xxx
#   AI_API_BASE=https://api.deepseek.com
#   AI_MODEL=deepseek-chat
```

Or pass directly:

```bash
adsense-check https://example.com --ai --api-key sk-xxx...
```

## Report Output

### Terminal Report

```
  AdSense Checklist Report
  URL: https://example.com
  Time: 2026-05-08T15:00:00.000Z
  Site type: 内容站
  Topic: Excel translation reference — Provides Excel terminology translations for multiple languages.
  Pages: 165 total, 82 recent (6mo), 33 sampled (20%) medium confidence

  综合评分: 82/100

  ┌─ 硬性要求 ──────────────────────────────────── PASS
  │  ✔ 站点规模             站点规模良好 (194 个页面)
  │  ✔ About            找到 About 页面 (/about/)
  │  ...
  └─ 评分: READY — 所有必要项达标

  ┌─ 柔性评分 ──────────────────────────────────── 75/100
  │  ████████████████████ 100%  内容质量
  │  ████████████████████ 100%  用户体验
  │  ████████░░░░░░░░░░░░  40%  AI 内容分析
  │  ████████████████████ 100%  内容相关性
  │
  │  Hard 40% × 0.4 + Soft 75% × 0.6 - Penalty 0 = 82
  └─
```

### JSON Report

Full structured data including per-page details, AI assessments, topic info, and sampling stats. Saved automatically to `tmp/`.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No failures (READY or MOSTLY READY) |
| 1 | Has failures (NOT READY) |
| 2 | Runtime error |

## License

MIT
