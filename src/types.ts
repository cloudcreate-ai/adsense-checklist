export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Lang = string;
export type SiteType = 'content' | 'tool' | 'game' | 'unsupported';
export type PageType = 'homepage' | 'content' | 'game_detail' | 'required' | 'listing' | 'utility' | 'unknown';

export interface CheckItem {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
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
  totalChars: number;
  contentChars: number;
  contentRatio: number;
  contentStatus: CheckStatus;
  issues: string[];
  score: number;    // 0-100 per-page score
  relevance?: 'relevant' | 'tangential' | 'off-topic';
  ai?: {
    status: CheckStatus;
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
    totalDiscovered: number;
    recentCount: number;
    sampledCount: number;
    samplePct: number;
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
  siteAiScore: number;             // 0-100 AI value score (geometric mean, page-type weighted)
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
  onProgress?: (message: string) => void;
}
