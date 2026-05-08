# @cloudcreate/adsense-check

Automated website checker for Google AdSense review requirements. Focuses on detecting "low value content" — the #1 rejection reason.

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
adsense-check https://example.com

# Quick check without AI
adsense-check https://example.com --skip-ai

# JSON output (for programmatic use)
adsense-check https://example.com --json
```

Reports are auto-saved to `tmp/<domain>-<timestamp>.json`.

## What It Checks

| Category | Checks | Focus |
|----------|--------|-------|
| **Content Quality** (8) | Content ratio, depth, template detection, filler detection, duplication, freshness, site scale | Low-value content |
| **Required Pages** (4) | About, Privacy Policy, Contact, Terms of Service | Completeness |
| **Site Structure** (5) | H1 tags, robots.txt, sitemap, internal links, dead links | Crawlability |
| **Performance** (5) | Load speed, viewport, mobile overflow, font size, popups | User experience |
| **Policy Compliance** (1) | Blacklisted keywords | AdSense policy |
| **AI Analysis** (3+) | Content value, originality, compliance + per-page analysis | Low-value content |

### Content Quality (Anti Low-Value Content)

The core focus of this tool — detecting content that AdSense reviewers flag as "low value":

- **Content Ratio**: Strips navigation/footer/sidebar, measures real content percentage
- **Content Depth**: Per-page word count of actual content (not total page text)
- **Template Detection**: Flags pages with identical structures but different words
- **Filler Detection**: Catches repeated phrases, padding, meaningless text
- **Cross-Page Duplication**: Segment-level dedup across all crawled pages
- **Content Freshness**: Checks if site has been updated recently
- **Site Scale**: Warns if site has too few content pages

### AI Per-Page Analysis

With AI enabled, each crawled page gets individual assessment:

```json
{
  "pages": [
    {
      "url": "https://example.com/blog/post-1",
      "title": "Post Title",
      "contentChars": 1200,
      "contentRatio": 85,
      "contentStatus": "pass",
      "issues": [],
      "ai": {
        "status": "pass",
        "assessment": "Content provides genuine value...",
        "suggestions": ["Add more specific examples"]
      }
    }
  ]
}
```

## Options

```
-v, --version         Show version
-j, --json            Output JSON to stdout
-d, --depth <n>       Pages to crawl (default: 10)
-s, --skip-ai         Skip AI analysis
-t, --timeout <ms>    Page load timeout (default: 30000)
--api-key <key>       AI API key
-o, --output <dir>    Report output dir (default: tmp)
--no-save             Skip auto-saving report
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
adsense-check https://example.com --api-key sk-xxx...
```

## Report Output

### Terminal Report

```
  AdSense Checklist Report
  Website: https://example.com

  Content Quality
    ✔ [PASS] 各页面正文占比正常
    ✔ [PASS] 首页正文内容充足 (2,340 字)

  ...

  Page Details (5 pages analyzed)
    ✔ /
       正文 92% (2,340/2,540 字)
    ⚠ /blog/old-post
       正文 25% (80/320 字)
       ! 正文占比仅 25%，大量模板元素
       ✘ AI: 内容过于单薄，缺乏实质性信息
         → 增加至少 500 字的原创分析内容

  Score: 18/21
  Status: NOT READY — 1 项失败需要修复
```

### JSON Report

Full structured data including per-page details, saved automatically to `tmp/`.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No failures (READY or MOSTLY READY) |
| 1 | Has failures (NOT READY) |
| 2 | Runtime error |

## License

MIT
