---
name: adsense-check
description: Check if a website meets Google AdSense review requirements, with focus on detecting low value content
trigger: adsense-check, adsense review, check adsense eligibility, low value content
---

When the user asks to check a website's AdSense compliance, follow this workflow:

## Prerequisites

Confirm `@cloudcreate/adsense-check` CLI is installed:
```bash
which adsense-check || npx @cloudcreate/adsense-check --version
```
If not installed, suggest: `npm install -g @cloudcreate/adsense-check`

## Choose the Right Subcommand

| Command | Purpose | Speed |
|---------|---------|-------|
| `adsense-check <url>` | Full check: crawl + AI content quality + hard requirements + homepage | ~1-3 min |
| `adsense-check site <url>` | Site-wide hard requirements only | ~10s |
| `adsense-check home <url>` | Homepage quality check | ~5s |
| `adsense-check page <url>` | Single page AI 5-dimension scoring | ~10s |
| `adsense-check topic <url>` | Detect site type and topic | ~5s |
| `adsense-check eval <report>` | Estimate approval from existing report | ~5s |

## Execute the Check

1. Extract the target URL from the user's message (or ask)
2. Run the appropriate command:
```bash
adsense-check <url> --json
```
AI analysis requires an API key configured via `.adsense-check.yaml`, `~/.adsense-check/config.yaml`, environment variables, or `--api-key` flag. Use `--no-ai` to skip AI analysis.

3. Parse the JSON output and summarize findings to the user.

## Output Template

### Overview
- Website: `<url>`
- Composite Score: `<score>/100`
- Site Quality: `<score>/100`
- Landing Page Quality: `<score>/100`
- Page Value (VOT): `<score>/100`
- Status: `READY` / `MOSTLY READY` / `NOT READY` / `NEEDS FIXES`

### Approval Estimate
- Rule-based: ~X% (confidence: high/medium/low)
- AI fast model: ~X% (if configured)
- AI expert model: ~X% (if --expert)

### Hard Requirements

By category:
- **Required Pages**: which required pages pass/fail
- **Site Structure**: robots.txt, sitemap, ads.txt
- **Policy Keywords**: blacklist keyword scan results

### Content Quality

AI-assessed dimensions per page:
- Value, Originality, Relevance, Compliance, Translation (0-10 each)
- Pages scoring below threshold are flagged with issues

### UX & Performance

- H1 tags, internal links, load speed, viewport, mobile overflow, font size, popup detection

### Problem Pages

For each page with issues:
```
Page: <url>
  Title: <title>
  Value: X/10 | Originality: X/10 | Relevance: X/10 | Compliance: X/10 | Translation: X/10
  Issues: <list>
  Suggestions:
    - <actionable fix>
```

### Prioritized Fix List

1. **FAIL items (must fix)**: specific steps
2. **WARN items (should fix)**: improvements

## AdSense Reminders
- Sites should be live for at least 3 months before applying
- Ensure consistent original content updates
- "Low value content" is the #1 rejection reason — focus on:
  - Substantive original content on every page
  - Unique value to users, not generic filler
  - Avoiding near-duplicate pages
- Check Google Search Console for critical errors before applying
