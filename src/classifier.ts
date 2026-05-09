import type { PageType } from './types.js';

// Patterns for required pages
const REQUIRED_PATTERNS = [/\/about/i, /\/privacy/i, /\/contact/i, /\/terms/i, /\/legal/i, /\/editorial-policy/i, /\/imprint/i];

// Patterns for content pages (blog posts, articles, guides)
const CONTENT_PREFIXES = ['/blog/', '/news/', '/guides/', '/articles/', '/posts/', '/tutorials/'];

// Patterns for game detail pages
const GAME_PREFIXES = ['/games/', '/game/', '/play/', '/online-games/'];

// Patterns for game mod/resource sites (Minecraft PE, etc.)
const GAME_MOD_PREFIXES = ['/addons/', '/mods/', '/texture-packs/', '/resource-packs/', '/shaders/', '/maps/', '/skins/', '/seeds/', '/clients/'];

// Patterns for video detail pages
const VIDEO_PREFIXES = ['/videos/', '/video/', '/watch/', '/v/', '/shorts/', '/clip/', '/stream/'];

// Patterns for reference/Wiki pages
const REFERENCE_PREFIXES = ['/wiki/', '/reference/', '/docs/', '/encyclopedia/', '/glossary/', '/knowledge/', '/archive/', '/database/', '/transcript/'];

// Patterns for reference listing/index pages
const REFERENCE_LISTING_PATHS = ['/wiki', '/reference', '/docs', '/encyclopedia', '/glossary', '/knowledge', '/archive', '/database', '/transcript'];

// Patterns for listing/index pages
const LISTING_PATHS = ['/blog', '/news', '/guides', '/articles', '/games', '/play', '/videos', '/watch', '/channels', '/categories', '/tags', '/archive', ...GAME_MOD_PREFIXES.map(p => p.replace(/\/$/, ''))];

// Patterns for utility pages
const UTILITY_PATTERNS = [/\/download/i, /\/search/i, /\/login/i, /\/signup/i, /\/register/i, /\/sitemap/i, /\/404/i];

export function classifyPage(url: string): PageType {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'unknown';
  }

  // Homepage
  if (pathname === '/' || pathname === '') return 'homepage';

  // Required pages
  if (REQUIRED_PATTERNS.some(p => p.test(pathname))) return 'required';

  // Utility pages
  if (UTILITY_PATTERNS.some(p => p.test(pathname))) return 'utility';

  // Content pages (has a slug after the content prefix)
  const normalizedPath = pathname.replace(/\/$/, '');
  for (const prefix of CONTENT_PREFIXES) {
    if (normalizedPath.startsWith(prefix.replace(/\/$/, '/'))) {
      const suffix = normalizedPath.slice(prefix.replace(/\/$/, '').length);
      if (suffix.length > 1 && suffix.includes('/')) return 'content';
      if (suffix.length > 1 && !suffix.includes('/')) return 'content'; // single-level like /blog/my-post
    }
  }

  // Game detail pages
  for (const prefix of GAME_PREFIXES) {
    if (normalizedPath.startsWith(prefix.replace(/\/$/, '/'))) {
      const suffix = normalizedPath.slice(prefix.replace(/\/$/, '').length);
      if (suffix.length > 1) return 'game_detail';
    }
  }

  // Game mod/resource detail pages (Minecraft PE mods, addons, etc.)
  for (const prefix of GAME_MOD_PREFIXES) {
    if (normalizedPath.startsWith(prefix)) {
      const suffix = normalizedPath.slice(prefix.length);
      // Multi-level or single-level slug = detail page; bare path = listing
      if (suffix.length > 0) return 'game_detail';
    }
  }

  // Video detail pages
  for (const prefix of VIDEO_PREFIXES) {
    if (normalizedPath.startsWith(prefix.replace(/\/$/, '/'))) {
      const suffix = normalizedPath.slice(prefix.replace(/\/$/, '').length);
      if (suffix.length > 1) return 'video_detail';
    }
  }

  // Reference detail pages
  for (const prefix of REFERENCE_PREFIXES) {
    if (normalizedPath.startsWith(prefix.replace(/\/$/, '/'))) {
      const suffix = normalizedPath.slice(prefix.replace(/\/$/, '').length);
      if (suffix.length > 1) return 'reference_detail';
    }
  }

  // Reference listing pages
  if (REFERENCE_LISTING_PATHS.some(p => normalizedPath === p || normalizedPath === p.replace(/\/$/, ''))) return 'reference_listing';

  // Listing pages
  if (LISTING_PATHS.some(p => normalizedPath === p || normalizedPath === p.replace(/\/$/, ''))) return 'listing';

  // Multi-language prefix detection (e.g., /ja/blog/, /hi/games/xxx/)
  const langPrefix = normalizedPath.match(/^\/[a-z]{2}(\/|$)/);
  if (langPrefix) {
    const rest = normalizedPath.slice(3); // skip /xx
    if (!rest) return 'listing'; // /ja/, /hi/

    for (const prefix of CONTENT_PREFIXES) {
      if (rest.startsWith(prefix.replace(/\/$/, '/'))) {
        const suffix = rest.slice(prefix.replace(/\/$/, '').length);
        if (suffix.length > 1) return 'content';
        return 'listing';
      }
    }
    for (const prefix of GAME_PREFIXES) {
      if (rest.startsWith(prefix.replace(/\/$/, '/'))) {
        const suffix = rest.slice(prefix.replace(/\/$/, '').length);
        if (suffix.length > 1) return 'game_detail';
        return 'listing';
      }
    }
    for (const prefix of VIDEO_PREFIXES) {
      if (rest.startsWith(prefix.replace(/\/$/, '/'))) {
        const suffix = rest.slice(prefix.replace(/\/$/, '').length);
        if (suffix.length > 1) return 'video_detail';
        return 'listing';
      }
    }
    for (const prefix of REFERENCE_PREFIXES) {
      if (rest.startsWith(prefix.replace(/\/$/, '/'))) {
        const suffix = rest.slice(prefix.replace(/\/$/, '').length);
        if (suffix.length > 1) return 'reference_detail';
        return 'reference_listing';
      }
    }
    if (REQUIRED_PATTERNS.some(p => p.test(rest))) return 'required';
  }

  // Generic fallback: multi-segment paths are likely content pages
  // (e.g., /zombie-apocalypse-modpack/ for a Minecraft mod detail page)
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length >= 1) return 'content';

  return 'unknown';
}

// Page type weights for scoring (higher = more impact on AdSense review)
export const PAGE_TYPE_WEIGHTS: Record<PageType, number> = {
  homepage: 10,
  content: 8,
  game_detail: 8,
  video_detail: 8,
  reference_detail: 8,
  required: 7,
  listing: 4,
  reference_listing: 4,
  utility: 2,
  unknown: 3,
};
