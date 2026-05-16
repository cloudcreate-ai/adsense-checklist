# AdSense Checklist — Check Items Reference

## Overview

Automated website checker for Google AdSense review requirements. Detects "low value content" — the #1 rejection reason. Supports content sites, tool sites, game sites, video sites, and reference sites with AI-powered topic analysis, 5-dimension content quality scoring, and stratified sampling.

## Subcommands

| Command | Purpose | Speed |
|---------|---------|-------|
| `<url>` (main) | Full check: crawler + AI content quality + hard requirements + homepage | ~1-3 min |
| `site <url>` | Site-wide hard requirements only: required pages, robots.txt, sitemap, ads.txt, policy keywords | ~10s |
| `home <url>` | Homepage quality: H1, internal links, load speed, viewport, mobile UX | ~5s |
| `page <url>` | Single page AI 5-dimension scoring (use `-r` to check relevance against site topic) | ~10s |
| `topic <url>` | Detect site type and topic from homepage | ~5s |
| `init` | Generate `.adsense-check.yaml` config file | — |
| `eval <report>` | Estimate approval probability from an existing JSON report | ~5s |

## Scoring System

Three independent signals combine into the final composite score:

```
Composite = Page Value(VOT) × Site Quality/100 × Landing Page Quality/100
```

- **Page Value (VOT)**: ∛(Value × Originality × Translation) — the core content quality signal, computed as a geometric mean of AI-evaluated dimensions across all content pages
- **Site-wide Quality**: Pass rate of all hard requirements + content quality + UX categories. Acts as a multiplier
- **Landing Page Quality**: Pass rate of landing page–specific checks (H1, internal links, load speed, viewport, mobile overflow, homepage content). Also a multiplier

### Caps

- Any page compliance < 6 → max composite score 50
- Average relevance < 6 → max composite score 60

### Page Base Score

Each page receives a base score of 100/100, reduced only by AI quality assessment (AI warn → max 70, AI fail → 0). Content quality is assessed entirely through the AI 5-dimension evaluation rather than structural heuristics like character count or content ratio.

---

## Hard Requirements

Any FAIL → category NOT READY

### 1. Site Scale

| Check | Description | Pass Condition |
|-------|-------------|----------------|
| Site scale | Total pages discovered via sitemap + links | ≥ 10 pages |

### 2. Required Pages

| Check | Required | Detection |
|-------|----------|-----------|
| About page | ✅ | URL path `/about` + link text + sitemap |
| Privacy Policy page | ✅ | URL path `/privacy` + link text + sitemap |
| Contact page | ✅ | URL path `/contact` + link text + sitemap |
| Terms of Service page | ⚠️ Recommended | URL path `/terms` + link text + sitemap |

### 3. Site Structure

| Check | Description | Pass Condition |
|-------|-------------|----------------|
| robots.txt | robots.txt file existence | File exists and accessible |
| sitemap.xml | sitemap file existence | File exists and accessible |
| ads.txt | ads.txt file existence | File exists and accessible |

### 4. Performance

| Check | Description | Pass Condition |
|-------|-------------|----------------|
| H1 tag | Page H1 tag count | Exactly 1 |
| Internal links | Homepage internal link count | ≥ 5 |
| Page load speed | Time to DOMContentLoad | < 3s pass, 3-6s warn, > 6s fail |
| Viewport tag | `<meta name="viewport">` existence | Tag present |
| Mobile horizontal overflow | Check horizontal scroll at iPhone viewport (390px) | body width ≤ viewport width |

### 5. Policy Compliance

| Check | Source | Description | Pass Condition |
|-------|--------|-------------|----------------|
| Blacklist keywords | Mechanical | Scan page for prohibited keywords | No matches |
| AI severe violations | AI | AI detects severe violations (compliance ≤ 2) | No severe violation pages |
| AI suspicious content | AI | AI detects suspicious non-compliant content | ≤ 20% of pages |
| AI compliance re-check | AI | Second-pass review for borderline pages (score 3-5) | No severe violations after re-check |

Keyword blacklist (Chinese and English): pornography, gambling, piracy, drugs, violence.

---

## AI 5-Dimension Page Scoring

Requires `--ai` flag + AI API configuration. Supports any OpenAI-compatible API format.

### Scoring Dimensions

Each page receives 5 AI-evaluated dimensions (0-10):

| Dimension | Description | Criteria |
|-----------|-------------|----------|
| Value | Does content provide substantive value? | Deep information, helpful to readers, non-empty |
| Originality | Is content original? | Unique perspective, not plagiarized/AI-generated/copied |
| Relevance | How relevant to site topic? | Directly related → partially → unrelated |
| Compliance | AdSense policy compliance? | No prohibited content |
| Translation | Translation quality | Content matches declared language, no machine-translation artifacts. English pages auto-score 10 |

### Page Score: Geometric Mean

```
pageAiScore = (value × originality × relevance × compliance × translation) ^ (1/5) × 10
```

Geometric mean property: any dimension at 0 drives total to 0; low dimensions drag heavily (weakest link effect).

### Site Score: Page-Type Weighted Average

```
siteAiScore = Σ(pageAiScore × typeWeight) / Σ(typeWeight)
```

| Page Type | Weight | Description |
|-----------|--------|-------------|
| homepage | 1.5 | Site storefront |
| content | 1.0 | Core content pages |
| game_detail | 1.0 | Game site core content |
| video_detail | 1.0 | Video site core content |
| reference_detail | 1.0 | Reference site core content |
| unknown | 0.5 | Unknown pages |
| required | 0.2 | Legal/required pages |
| listing | 0.1 | Listing/navigation pages |
| reference_listing | 0.1 | Reference site listing pages |
| utility | 0.1 | Functional pages |

---

## Site Type Detection

### AI Topic Analysis (default enabled)

AI analyzes homepage title, navigation, and body text to determine:
- Site type: content / tool / game / video / reference / unsupported
- Topic keyword
- One-line description

### DOM Signal Detection (fallback)

When AI is unavailable, DOM signals determine type:
- **Game**: iframe game embeds, canvas tags, game-related links
- **Video**: YouTube/Vimeo/Bilibili video iframes, `<video>` tags, video navigation keywords
- **Reference**: High article ratio, navigation with wiki/encyclopedia/glossary keywords
- **Tool**: Navigation with calculator/converter/generator/tool keywords
- **Content**: Default type

### Type-Specific Standards

| Type | Content Depth | Special Handling |
|------|--------------|------------------|
| Content | ≥ 300 chars/page | Focus on content ratio |
| Tool | ≥ 300 chars/page | Same as content |
| Game | ≥ 100 chars/page | Relaxed content depth |
| Video | ≥ 50 chars/page | Video descriptions + diversity |
| Reference | ≥ 100 chars/page | Reference structure + diversity |
| Unsupported | — | Skip checks, warn |

---

## Stratified Sampling

1. Discover URLs from sitemaps (including recursive sitemap indexes and robots.txt fallback) and homepage links
2. **Always-crawl pages**: homepage + required pages (about, privacy, contact, terms)
3. **URL classification**: Classify each URL by path pattern (content, game_detail, listing, reference_detail, etc.)
4. **Proportional budget allocation**: Remaining crawl budget distributed across page types proportionally to weight and count
5. **Freshness sorting**: Within each type group, URLs with date patterns in paths are crawled first

## Sampling Confidence

| Confidence | Condition |
|------------|-----------|
| high | Sampled ≥ 50% of discovered content pages |
| medium | Sampled ≥ 20% |
| low | Sampled < 20% |

---

## Approval Probability Estimation

| Method | Description |
|--------|-------------|
| **Rule-based** | Mechanical estimate from composite score, hard status, AI site score |
| **Fast model** | AI reviews full report, provides probability + reasons + actions |
| **Expert model** | Deeper analysis with `--expert` flag |

---

## Configuration

Priority: CLI flags > `.adsense-check.yaml` > `~/.adsense-check/config.yaml` > built-in defaults.

Run `npx adsense-check init` to generate a config file. Use `--global` for global defaults.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No failures (READY or MOSTLY READY) |
| 1 | Has failures (NOT READY or NEEDS FIXES) |
| 2 | Runtime error (invalid URL, network issue, etc.) |
