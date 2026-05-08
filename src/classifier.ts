import type { PageType } from './types.js';

// Patterns for required pages
const REQUIRED_PATTERNS = [/\/about/i, /\/privacy/i, /\/contact/i, /\/terms/i, /\/legal/i];

// Patterns for content pages (blog posts, articles, guides)
const CONTENT_PREFIXES = ['/blog/', '/news/', '/guides/', '/articles/', '/posts/', '/tutorials/', '/wiki/'];

// Patterns for game detail pages
const GAME_PREFIXES = ['/games/', '/game/', '/play/', '/online-games/'];

// Patterns for listing/index pages
const LISTING_PATHS = ['/blog', '/news', '/guides', '/articles', '/games', '/play', '/categories', '/tags', '/archive'];

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
    if (REQUIRED_PATTERNS.some(p => p.test(rest))) return 'required';
  }

  return 'unknown';
}

// Page type weights for scoring (higher = more impact on AdSense review)
export const PAGE_TYPE_WEIGHTS: Record<PageType, number> = {
  homepage: 10,
  content: 8,
  game_detail: 8,
  required: 7,
  listing: 4,
  utility: 2,
  unknown: 3,
};
