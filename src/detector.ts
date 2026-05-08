import type { SiteType } from './types.js';

export interface PageSignals {
  iframeCount: number;
  iframeSrcs: string[];
  canvasCount: number;
  articleCount: number;
  textLength: number;
  gameLinks: number;
}

export interface SiteTypeResult {
  type: SiteType;
  confidence: 'high' | 'medium' | 'low';
  signals: {
    iframeRatio: number;
    canvasRatio: number;
    articleRatio: number;
    navGameKeywords: boolean;
  };
}

const GAME_NAV_KEYWORDS = /\b(games?|play\b|arcade|puzzle|action)\b/i;
const GAME_NAV_KEYWORDS_ZH = /游戏|玩游戏/;

const TOOL_NAV_KEYWORDS = /\b(calculator|converter|generator|tool|translat|calculat|checker|analyzer|formatter|validator|encoder|decoder)\b/i;
const TOOL_NAV_KEYWORDS_ZH = /计算器|转换器|工具|翻译/;

const GAME_IFRAME_PATTERNS = [
  /game/i,
  /play/i,
  /html5/i,
  /unity/i,
  /gamedistribution/i,
  /gameflare/i,
  /gamepix/i,
  /crazygames/i,
  /poki/i,
  /y8/i,
  /friv/i,
  /itch\.io/i,
  /htmlgames/i,
  /gameflare/i,
  /embed/i,
];

export function detectSiteType(
  pagesSignals: PageSignals[],
  navText: string,
  manualType?: SiteType
): SiteTypeResult {
  if (manualType) {
    return { type: manualType, confidence: 'high', signals: { iframeRatio: 0, canvasRatio: 0, articleRatio: 0, navGameKeywords: false } };
  }

  const total = pagesSignals.length;
  if (total === 0) {
    return { type: 'content', confidence: 'low', signals: { iframeRatio: 0, canvasRatio: 0, articleRatio: 0, navGameKeywords: false } };
  }

  let pagesWithIframe = 0;
  let pagesWithCanvas = 0;
  let pagesWithArticle = 0;
  let pagesWithGameIframe = 0;
  let firstPageIframes = 0;
  let firstPageCanvas = 0;
  let totalGameLinks = 0;

  for (let i = 0; i < pagesSignals.length; i++) {
    const sig = pagesSignals[i];
    if (sig.iframeCount > 0) pagesWithIframe++;
    if (sig.canvasCount > 0) pagesWithCanvas++;
    if (sig.articleCount > 0) pagesWithArticle++;
    totalGameLinks += sig.gameLinks || 0;

    if (i === 0) {
      firstPageIframes = sig.iframeCount;
      firstPageCanvas = sig.canvasCount;
    }

    const hasGameIframe = sig.iframeSrcs.some(src => GAME_IFRAME_PATTERNS.some(p => p.test(src)));
    if (hasGameIframe) pagesWithGameIframe++;
  }

  const avgGameLinks = totalGameLinks / total;

  const iframeRatio = pagesWithIframe / total;
  const canvasRatio = pagesWithCanvas / total;
  const articleRatio = pagesWithArticle / total;
  const gameIframeRatio = pagesWithGameIframe / total;
  const navGameKeywords = GAME_NAV_KEYWORDS.test(navText) || GAME_NAV_KEYWORDS_ZH.test(navText);

  let gameScore = 0;

  // Strong signals: iframes with game-related src
  if (gameIframeRatio >= 0.3) gameScore += 5;
  else if (gameIframeRatio >= 0.1) gameScore += 3;

  // Any iframe presence is a moderate signal
  if (iframeRatio >= 0.3) gameScore += 2;
  else if (firstPageIframes >= 1) gameScore += 1;

  // Canvas/WebGL is a strong game signal
  if (canvasRatio >= 0.1) gameScore += 4;
  if (firstPageCanvas >= 1) gameScore += 3;

  // Nav keywords
  if (navGameKeywords) gameScore += 3;

  // Homepage: multiple iframes = likely game embed page
  if (firstPageIframes >= 3) gameScore += 3;

  // Game links in listing pages (game sites have /game/, /play/ links)
  if (avgGameLinks >= 5) gameScore += 3;
  else if (avgGameLinks >= 2) gameScore += 2;
  else if (totalGameLinks >= 3) gameScore += 1;

  // Article-heavy sites are likely content sites (but only penalize if no game signals)
  if (articleRatio >= 0.7 && gameScore < 3) gameScore -= 2;

  const isGame = gameScore >= 3;

  let type: SiteType;
  let confidence: 'high' | 'medium' | 'low';

  if (isGame) {
    type = 'game';
    confidence = gameScore >= 6 ? 'high' : 'medium';
  } else {
    // Tool detection: nav keywords related to tools/utilities
    const navToolKeywords = TOOL_NAV_KEYWORDS.test(navText) || TOOL_NAV_KEYWORDS_ZH.test(navText);
    if (navToolKeywords) {
      type = 'tool';
      confidence = 'medium';
    } else {
      type = 'content';
      confidence = 'high';
    }
  }

  return { type, confidence, signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords } };
}
