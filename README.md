# adsense-check

Check if a website meets Google AdSense review requirements.

## Install

```bash
npm install -g adsense-check
```

## Usage

```bash
# Basic check
adsense-check https://example.com

# JSON output (for programmatic use)
adsense-check https://example.com --json

# Crawl more internal pages (default: 5)
adsense-check https://example.com --depth 10

# Skip AI content analysis
adsense-check https://example.com --skip-ai

# Custom timeout (ms)
adsense-check https://example.com --timeout 60000
```

## What it checks

| Category | Checks |
|----------|--------|
| **Content Quality** | Page word count, content duplication |
| **Required Pages** | About, Privacy Policy, Contact, Terms of Service |
| **Site Structure** | H1 tags, robots.txt, sitemap.xml, internal links, dead links |
| **Performance** | Load time, mobile viewport, responsive layout, font size, popups |
| **Policy Compliance** | Blacklisted keywords (porn, gambling, piracy, etc.) |
| **AI Analysis** | Content originality, quality, compliance (requires `ANTHROPIC_API_KEY`) |

## Options

```
-v, --version        Show version
-j, --json           Output as JSON
-d, --depth <n>      Number of internal pages to crawl (default: 5)
-s, --skip-ai        Skip AI content analysis
-t, --timeout <ms>   Page load timeout (default: 30000)
--api-key <key>      Anthropic API key (or set ANTHROPIC_API_KEY env var)
```

## AI Analysis

For deeper content quality assessment, set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
adsense-check https://example.com
```

Or pass it directly:

```bash
adsense-check https://example.com --api-key sk-ant-...
```

## Exit codes

- `0` — No failures (ready or mostly ready)
- `1` — Has failures (not ready)
- `2` — Error (invalid URL, network failure, etc.)

## License

MIT
