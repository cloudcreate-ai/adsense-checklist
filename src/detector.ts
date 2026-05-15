import type { SiteType } from './types.js';

export interface PageSignals {
  iframeCount: number;
  iframeSrcs: string[];
  canvasCount: number;
  articleCount: number;
  textLength: number;
  gameLinks: number;
  videoElementCount: number;
  // Listing page structure signals
  listItems: number;
  hasPagination: boolean;
  hasCategories: boolean;
  hasSearch: boolean;
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

const REFERENCE_NAV_KEYWORDS = /\b(wiki|encyclopedia|reference|glossary|docs|documentation|knowledge\s*base|archive|database|transcript)\b/i;
const REFERENCE_NAV_KEYWORDS_ZH = /百科|知识库|参考|词典|文档|数据库|档案/;

const VIDEO_NAV_KEYWORDS = /\b(video|videos|watch|channel|channels|stream|vlog|clip|playlist|shorts|tv)\b/i;
const VIDEO_NAV_KEYWORDS_ZH = /视频|频道|直播|短视频/;

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
];

const VIDEO_IFRAME_PATTERNS = [
  /youtube\.com\/embed/i,
  /youtube-nocookie\.com/i,
  /youtu\.be/i,
  /player\.vimeo\.com/i,
  /player\.bilibili\.com/i,
  /dailymotion\.com\/embed/i,
  /embed\.twitch\.tv/i,
  /streamable\.com\/o/i,
  /wistia.*\.net\/medias/i,
  /vidyard\.com\/embed/i,
  /brightcove/i,
];

function isVideoIframe(src: string): boolean {
  return VIDEO_IFRAME_PATTERNS.some(p => p.test(src));
}

function isGameIframe(src: string): boolean {
  return GAME_IFRAME_PATTERNS.some(p => p.test(src));
}

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
  let pagesWithVideoIframe = 0;
  let pagesWithVideoElement = 0;
  let firstPageIframes = 0;
  let firstPageCanvas = 0;
  let firstPageVideoIframes = 0;
  let totalGameLinks = 0;

  for (let i = 0; i < pagesSignals.length; i++) {
    const sig = pagesSignals[i];
    if (sig.iframeCount > 0) pagesWithIframe++;
    if (sig.canvasCount > 0) pagesWithCanvas++;
    if (sig.articleCount > 0) pagesWithArticle++;
    if (sig.videoElementCount > 0) pagesWithVideoElement++;
    totalGameLinks += sig.gameLinks || 0;

    if (i === 0) {
      firstPageIframes = sig.iframeCount;
      firstPageCanvas = sig.canvasCount;
    }

    const hasGameIframe = sig.iframeSrcs.some(s => isGameIframe(s));
    const hasVideoIframe = sig.iframeSrcs.some(s => isVideoIframe(s));
    if (hasGameIframe) pagesWithGameIframe++;
    if (hasVideoIframe) {
      pagesWithVideoIframe++;
      if (i === 0) firstPageVideoIframes = sig.iframeSrcs.filter(s => isVideoIframe(s)).length;
    }
  }

  const avgGameLinks = totalGameLinks / total;

  const iframeRatio = pagesWithIframe / total;
  const canvasRatio = pagesWithCanvas / total;
  const articleRatio = pagesWithArticle / total;
  const gameIframeRatio = pagesWithGameIframe / total;
  const videoIframeRatio = pagesWithVideoIframe / total;
  const videoElementRatio = pagesWithVideoElement / total;
  const navGameKeywords = GAME_NAV_KEYWORDS.test(navText) || GAME_NAV_KEYWORDS_ZH.test(navText);
  const navVideoKeywords = VIDEO_NAV_KEYWORDS.test(navText) || VIDEO_NAV_KEYWORDS_ZH.test(navText);

  // ── Video detection (check first, before game) ──
  let videoScore = 0;

  // Video iframe patterns (YouTube, Vimeo, etc.)
  if (videoIframeRatio >= 0.3) videoScore += 5;
  else if (videoIframeRatio >= 0.1) videoScore += 3;

  // <video> elements
  if (videoElementRatio >= 0.3) videoScore += 5;
  else if (videoElementRatio >= 0.1) videoScore += 3;

  // Nav keywords
  if (navVideoKeywords) videoScore += 3;

  // Homepage: multiple video iframes
  if (firstPageVideoIframes >= 3) videoScore += 3;
  else if (firstPageVideoIframes >= 1) videoScore += 1;

  if (videoScore >= 3) {
    return {
      type: 'video',
      confidence: videoScore >= 6 ? 'high' : 'medium',
      signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords },
    };
  }

  // ── Game detection ──
  let gameScore = 0;

  if (gameIframeRatio >= 0.3) gameScore += 5;
  else if (gameIframeRatio >= 0.1) gameScore += 3;

  if (iframeRatio >= 0.3) gameScore += 2;
  else if (firstPageIframes >= 1) gameScore += 1;

  if (canvasRatio >= 0.1) gameScore += 4;
  if (firstPageCanvas >= 1) gameScore += 3;

  if (navGameKeywords) gameScore += 3;

  if (firstPageIframes >= 3) gameScore += 3;

  if (avgGameLinks >= 5) gameScore += 3;
  else if (avgGameLinks >= 2) gameScore += 2;
  else if (totalGameLinks >= 3) gameScore += 1;

  if (articleRatio >= 0.7 && gameScore < 3) gameScore -= 2;

  if (gameScore >= 3) {
    return {
      type: 'game',
      confidence: gameScore >= 6 ? 'high' : 'medium',
      signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords },
    };
  }

  // ── Tool detection ──
  const navToolKeywords = TOOL_NAV_KEYWORDS.test(navText) || TOOL_NAV_KEYWORDS_ZH.test(navText);
  if (navToolKeywords) {
    return { type: 'tool', confidence: 'medium', signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords } };
  }

  // ── Reference detection (wiki, encyclopedia, reference database) ──
  const navReferenceKeywords = REFERENCE_NAV_KEYWORDS.test(navText) || REFERENCE_NAV_KEYWORDS_ZH.test(navText);
  let referenceScore = 0;

  if (articleRatio >= 0.7) referenceScore += 3;
  else if (articleRatio >= 0.5) referenceScore += 1;

  if (navReferenceKeywords) referenceScore += 3;

  if (iframeRatio < 0.1) referenceScore += 1;

  if (referenceScore >= 3) {
    return {
      type: 'reference',
      confidence: referenceScore >= 6 ? 'high' : 'medium',
      signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords },
    };
  }

  // ── Content (default) ──
  return { type: 'content', confidence: 'high', signals: { iframeRatio, canvasRatio, articleRatio, navGameKeywords } };
}
