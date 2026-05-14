export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Lang = string;
export type SiteType = 'content' | 'tool' | 'game' | 'video' | 'reference' | 'unsupported';
export type PageType = 'homepage' | 'content' | 'game_detail' | 'video_detail' | 'reference_detail' | 'reference_listing' | 'required' | 'listing' | 'utility' | 'unknown';

export interface CheckItem {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  detailList?: string[];
}

export type CheckGroup = 'hard' | 'soft';

export interface CheckCategory {
  name: string;
  items: CheckItem[];
  group?: CheckGroup;
}

export interface PageDetail {
  url: string;
  title: string;
  pageType: PageType;
  pageLanguage: string;     // extracted from <html lang> or meta content-language
  totalChars: number;
  contentChars: number;
  contentRatio: number;
  contentStatus: CheckStatus;
  issues: string[];
  score: number;    // 0-100 per-page score
  relevance?: 'relevant' | 'tangential' | 'off-topic';
  ai?: {
    status: CheckStatus;
    valueScore?: number;
    originalityScore?: number;
    relevanceScore?: number;
    complianceScore?: number;
    translationScore?: number;    // 0-10 translation quality
    assessment: string;
    suggestions: string[];
  };
}

export interface SiteTopic {
  type: SiteType;
  topic: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  // Metadata quality
  metaIncomplete: boolean;       // true if site has no or very thin meta description
  metaSuggestions?: string[];    // AI-generated title/description improvement suggestions
}

export interface CategoryScore {
  name: string;
  score: number;
  maxScore: number;
}

export interface CheckReport {
  url: string;
  timestamp: string;
  lang: Lang;
  siteType: SiteType;
  siteTypeConfidence: 'high' | 'medium' | 'low';
  siteTopic?: SiteTopic;
  samplingInfo?: {
    pagesAnalyzed: number;       // total pages actually analyzed
    aiAnalyzed: number;          // pages with AI analysis
    confidence: 'high' | 'medium' | 'low';
  };
  categories: CheckCategory[];
  hardCategories: CheckCategory[];
  softCategories: CheckCategory[];
  score: number;
  totalChecks: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  pages: PageDetail[];
  compositeScore: number;          // 0-100 weighted total
  categoryScores: CategoryScore[]; // breakdown by category
  hardStatus: 'ready' | 'warn' | 'fail';
  softScore: number;               // 0-100 soft scoring result
  warningRatio: number;            // 0-1
  warningPenalty: number;          // points deducted
  siteAiScore: number;             // 0-100 AI value score (5-dim geometric mean, all pages weighted)
  pageValueScore: number;          // 0-100 VOT score (value × originality × translation, excluding required/utility)
  pageValueEstimated: boolean;     // true if estimated from structural quality (no AI)
  siteQuality: number;             // 0-100 site-wide quality (hard + content + UX)
  homeQuality: number;             // 0-100 landing page quality
  aiDimensionAverages?: Record<string, number>; // per-dimension averages across all analyzed pages (0-10)
  aiDimensionStats?: Record<string, {           // per-dimension stats with min and low-count
    avg: number;
    min: number;
    lowCount: number;
    lowPct: number;
  }>;
  approvalEstimate?: {             // rule-based approval probability (always computed)
    probability: number;
    confidence: 'high' | 'medium' | 'low';
    keyFactors: string[];
  };
  fastSummary?: {                  // fast model final assessment (with --ai)
    probability: number;
    verdict: string;
    reasons: string[];
    topActions: string[];
    detailedSummary: string;
    modelName: string;
  };
  expertSummary?: {                // expert AI summary (only with --expert, different model)
    probability: number;
    verdict: string;
    reasons: string[];
    topActions: string[];
    detailedSummary: string;
    modelName: string;
  };
}

export interface CheckOptions {
  url: string;
  maxCrawl?: number;
  maxPages?: number;
  maxContent?: number;
  sampleMin?: number;
  sampleRatio?: number;
  siteType?: SiteType;
  skipAi?: boolean;
  timeout?: number;
  apiKey?: string;
  lang?: Lang;
  expert?: boolean;            // use expert model for final summary (default: false)
  concurrency?: number;        // AI batch concurrency (default: 5)
  onProgress?: (message: string) => void;
}
