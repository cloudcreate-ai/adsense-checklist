import type { Lang } from './types.js';

// ─── English messages ───────────────────────────────────────────────
const en: Record<string, string> = {
  // Categories
  'cat.content': 'Content Quality',
  'cat.pages': 'Required Pages',
  'cat.structure': 'Site Structure',
  'cat.performance': 'Performance',
  'cat.policy': 'Policy Compliance',
  'cat.ai': 'AI Content Analysis',

  // Content items
  'item.content.ratio': 'Content Ratio',
  'item.content.home': 'Homepage Content',
  'item.content.subpage': 'Subpage Depth',
  'item.content.template': 'Template Detection',
  'item.content.filler': 'Filler Detection',
  'item.content.dup': 'Cross-Page Duplication',
  'item.content.freshness': 'Content Freshness',
  'item.content.scale': 'Site Scale',
  'item.content.game_desc': 'Game Descriptions',
  'item.content.iframe_quality': 'Iframe Quality',
  'item.content.game_variety': 'Game Variety',

  // Structure items
  'item.structure.internal': 'Internal Links',
  'item.structure.deadlinks': 'Dead Links',

  // Performance items
  'item.perf.speed': 'Load Speed',
  'item.perf.overflow': 'Mobile Overflow',
  'item.perf.font': 'Mobile Font Size',
  'item.perf.popup': 'Popup Detection',

  // Policy items
  'item.policy.keywords': 'Violating Keywords',

  // AI items
  'item.ai.quality': 'Content Value',
  'item.ai.originality': 'Originality',
  'item.ai.compliance': 'Compliance',
  'item.ai.suggestions': 'AI Suggestions',

  // Required page names
  'page.about': 'About',
  'page.privacy': 'Privacy Policy',
  'page.contact': 'Contact',
  'page.terms': 'Terms of Service',

  // Content messages
  'content.ratio.pass': 'Content-to-boilerplate ratio is healthy across pages',
  'content.ratio.fail': '{count} page(s) have low content ratio (<30%), mostly boilerplate',
  'content.home.pass': 'Homepage content is substantial ({chars} chars)',
  'content.home.fail': 'Homepage content is thin ({chars} chars, recommend 500+)',
  'content.subpage.pass': 'All subpages have sufficient content',
  'content.subpage.warn': '{thin}/{total} subpages have thin content (<300 chars)',
  'content.subpage.fail': '{thin}/{total} subpages have thin content (<300 chars)',
  'content.template.pass': 'Page structure diversity is good (similarity {pct}%)',
  'content.template.fail': 'Page structure similarity {pct}% — likely mass-produced template pages',
  'content.filler.pass': 'No obvious filler/padding content detected',
  'content.filler.warn': '{count} instances of filler content detected',
  'content.dup.pass': 'Cross-page content uniqueness is good ({pct}% overlap)',
  'content.dup.warn': '{pct}% of content segments are duplicated across pages',
  'content.freshness.pass': 'Site has recent updates (latest: {date})',
  'content.freshness.warn_old': 'Latest update: {date} — over 6 months old',
  'content.freshness.warn_none': 'No date information found in pages',
  'content.scale.warn': 'Only {count} pages found (recommend 10+ valuable content pages)',
  'content.scale.pass_small': 'Site has {count} pages',
  'content.scale.pass': 'Site scale is good ({count} pages)',

  // Game-specific messages
  'content.game_desc.pass': '{total} game page(s) have sufficient description text',
  'content.game_desc.warn': '{thin}/{total} game pages lack description text (recommend 100+ chars of gameplay info)',
  'content.iframe_quality.pass': '{count} game iframe(s) embedded',
  'content.iframe_quality.warn': '{count} game iframes detected — ensure each has proper title and size attributes',
  'content.game_variety.pass': 'Game pages show good variety',
  'content.game_variety.warn': 'Game pages are {pct}% similar — may look like mass-produced content',

  // Site type detection
  'detector.type.content': 'Content Site',
  'detector.type.game': 'Game Site',
  'detector.signals': 'Signals: {details}',

  // Required pages messages
  'pages.found': 'Found {name} page ({path})',
  'pages.missing_required': '{name} page not found (required)',
  'pages.missing_optional': '{name} page not found (recommended)',

  // Structure messages
  'structure.h1.pass': 'Page has exactly one H1 tag',
  'structure.h1.warn_none': 'Page is missing H1 tag',
  'structure.h1.warn_multi': 'Page has {count} H1 tags (recommend 1)',
  'structure.robots.pass': 'robots.txt exists',
  'structure.robots.warn': 'robots.txt not found (recommended)',
  'structure.sitemap.pass': 'sitemap.xml exists',
  'structure.sitemap.warn': 'sitemap.xml not found (recommended)',
  'structure.links.pass': 'Homepage has {count} internal links',
  'structure.links.warn': 'Homepage has only {count} internal links (recommend more navigation)',
  'structure.deadlinks.pass': 'No broken links detected',
  'structure.deadlinks.fail': '{count} broken link(s) detected',

  // Performance messages
  'perf.speed.pass': 'Load time {time}s',
  'perf.speed.warn': 'Load time {time}s (recommend under 3s)',
  'perf.speed.fail': 'Load time {time}s (too slow, impacts user experience)',
  'perf.speed.timeout': 'Page load timed out (30s)',
  'perf.viewport.pass': 'Viewport meta tag present',
  'perf.viewport.warn': 'Missing viewport meta tag',
  'perf.overflow.pass': 'No horizontal overflow on mobile',
  'perf.overflow.warn': 'Horizontal scroll detected on mobile viewport',
  'perf.font.pass': 'Mobile font sizes are adequate',
  'perf.font.warn': 'Some text is smaller than 12px, hard to read on mobile',
  'perf.popup.pass': 'No intrusive popups/overlays detected',
  'perf.popup.warn': '{count} potential popup/overlay element(s) detected',

  // Policy messages
  'policy.keywords.pass': 'No policy-violating keywords found',
  'policy.keywords.fail': '{count} potentially violating keyword(s) found',

  // AI messages
  'ai.skip': 'AI_API_KEY not configured, skipping AI analysis',
  'ai.fail': 'AI analysis failed: {error}',
  'ai.suggestion_count': '{count} suggestion(s)',
  'ai.suggest_enable': 'Tip: use --ai flag to enable AI content quality analysis for deeper insights',

  // Reporter
  'report.title': 'AdSense Checklist Report',
  'report.composite_score': 'Composite Score',
  'report.score': 'Score',
  'report.ready': 'READY — can submit for AdSense review',
  'report.mostly': 'MOSTLY READY — fix {count} warning(s) before submitting',
  'report.notready': 'NOT READY — {count} failure(s) must be fixed',
  'report.pages': '{count} pages analyzed',
  'report.pages_ok': '+ {count} page(s) with no issues',
  'report.saved': 'Report saved',
  'report.page_details': 'Page Details',
  'report.content_label': 'Content',

  // Two-group scoring
  'report.hard_requirements': 'Hard Requirements',
  'report.soft_scoring': 'Soft Scoring',
  'report.hard.ready': 'READY — all requirements met',
  'report.hard.warn': 'NEEDS FIXES — {count} warning(s) to address',
  'report.hard.fail': 'NOT READY — {count} failure(s) must be fixed',
  'report.warning_ratio': 'Warning ratio: {count}/{total} ({pct}%)',
  'report.warning_penalty': 'Score penalty: -{points}',

  // Group labels
  'group.required_pages': 'Required Pages',
  'group.basic_structure': 'Basic Structure',
  'group.performance_min': 'Performance Baseline',
  'group.policy': 'Policy Compliance',
  'group.site_scale': 'Site Scale',
  'group.content_quality': 'Content Quality',
  'group.ai_analysis': 'AI Content Analysis',
  'group.page_quality': 'Page Quality',
  'group.user_experience': 'User Experience',
  'group.content_relevance': 'Content Relevance',

  // Topic & relevance
  'item.relevance.topic': 'Topic Relevance',
  'detector.type.tool': 'Tool Site',
  'detector.type.unsupported': 'Unsupported Type',
  'topic.info': 'Site topic: {topic}',
  'topic.description': '{description}',
  'topic.unsupported_warning': 'This site type ({type}) is not supported by AdSense checklist',
};

// ─── 中文消息 ───────────────────────────────────────────────────────
const zh: Record<string, string> = {
  // 分类
  'cat.content': '内容质量',
  'cat.pages': '必要页面',
  'cat.structure': '网站结构',
  'cat.performance': '性能体验',
  'cat.policy': '政策合规',
  'cat.ai': 'AI 内容分析',

  // 内容检查项
  'item.content.ratio': '有效内容比率',
  'item.content.home': '首页实质内容',
  'item.content.subpage': '内页内容深度',
  'item.content.template': '模板化检测',
  'item.content.filler': '凑字数检测',
  'item.content.dup': '跨页内容重复',
  'item.content.freshness': '内容新鲜度',
  'item.content.scale': '站点规模',
  'item.content.game_desc': '游戏描述',
  'item.content.iframe_quality': 'Iframe 质量',
  'item.content.game_variety': '游戏多样性',

  // 结构检查项
  'item.structure.internal': '内部链接',
  'item.structure.deadlinks': '死链检测',

  // 性能检查项
  'item.perf.speed': '加载速度',
  'item.perf.overflow': '移动端溢出',
  'item.perf.font': '移动端字体',
  'item.perf.popup': '弹窗检测',

  // 合规检查项
  'item.policy.keywords': '违规关键词',

  // AI 检查项
  'item.ai.quality': '内容价值评估',
  'item.ai.originality': '原创性评估',
  'item.ai.compliance': '合规性评估',
  'item.ai.suggestions': 'AI 建议',

  // 必要页面名称
  'page.about': 'About',
  'page.privacy': '隐私政策',
  'page.contact': '联系方式',
  'page.terms': '服务条款',

  // 内容消息
  'content.ratio.pass': '各页面正文占比正常，模板元素占比合理',
  'content.ratio.fail': '{count} 个页面正文占比过低（<30%），大量内容为导航/页脚等模板元素',
  'content.home.pass': '首页正文内容充足 ({chars} 字)',
  'content.home.fail': '首页正文内容不足 ({chars} 字，建议 500+ 字)',
  'content.subpage.pass': '所有内页正文内容充足',
  'content.subpage.warn': '{thin}/{total} 个内页正文内容不足 (<300 字)',
  'content.subpage.fail': '{thin}/{total} 个内页正文内容不足 (<300 字)',
  'content.template.pass': '页面结构多样性正常 (相似度 {pct}%)',
  'content.template.fail': '页面结构相似度 {pct}%，疑似模板批量生成',
  'content.filler.pass': '未检测到明显的填充/凑字数内容',
  'content.filler.warn': '检测到 {count} 处疑似凑字数的填充内容',
  'content.dup.pass': '各页面内容独立性良好 (重复率 {pct}%)',
  'content.dup.warn': '{pct}% 的内容片段在多个页面重复出现',
  'content.freshness.pass': '最近有更新内容 (最新: {date})',
  'content.freshness.warn_old': '最近更新: {date}，超过 6 个月未更新',
  'content.freshness.warn_none': '页面中未检测到日期信息，无法判断内容时效性',
  'content.scale.warn': '站点仅 {count} 个页面（建议至少 10+ 个有价值的内容页）',
  'content.scale.pass_small': '站点有 {count} 个页面',
  'content.scale.pass': '站点规模良好 ({count} 个页面)',

  // 游戏站专用消息
  'content.game_desc.pass': '{total} 个游戏页面有足够的描述文字',
  'content.game_desc.warn': '{thin}/{total} 个游戏页面缺少描述文字（建议 100+ 字的玩法说明）',
  'content.iframe_quality.pass': '嵌入了 {count} 个游戏 iframe',
  'content.iframe_quality.warn': '检测到 {count} 个游戏 iframe — 确保每个都有 title 和合理尺寸',
  'content.game_variety.pass': '游戏页面多样性正常',
  'content.game_variety.warn': '游戏页面相似度 {pct}% — 可能是模板批量生成',

  // 站点类型检测
  'detector.type.content': '内容站',
  'detector.type.game': '游戏站',
  'detector.signals': '检测信号: {details}',

  // 必要页面消息
  'pages.found': '找到 {name} 页面 ({path})',
  'pages.missing_required': '未找到 {name} 页面（必需）',
  'pages.missing_optional': '未找到 {name} 页面（建议添加）',

  // 结构消息
  'structure.h1.pass': '页面有且仅有一个 H1 标签',
  'structure.h1.warn_none': '页面缺少 H1 标签',
  'structure.h1.warn_multi': '页面有 {count} 个 H1 标签（建议保留 1 个）',
  'structure.robots.pass': 'robots.txt 存在',
  'structure.robots.warn': '未找到 robots.txt（建议添加）',
  'structure.sitemap.pass': 'sitemap.xml 存在',
  'structure.sitemap.warn': '未找到 sitemap.xml（建议添加）',
  'structure.links.pass': '首页有 {count} 个内部链接',
  'structure.links.warn': '首页仅 {count} 个内部链接（建议增加导航链接）',
  'structure.deadlinks.pass': '未检测到死链',
  'structure.deadlinks.fail': '检测到 {count} 个死链',

  // 性能消息
  'perf.speed.pass': '加载时间 {time}s',
  'perf.speed.warn': '加载时间 {time}s（建议优化到 3s 以内）',
  'perf.speed.fail': '加载时间 {time}s（过慢，严重影响用户体验）',
  'perf.speed.timeout': '页面加载超时（30s）',
  'perf.viewport.pass': '存在 viewport meta 标签',
  'perf.viewport.warn': '缺少 viewport meta 标签',
  'perf.overflow.pass': '移动端页面无横向溢出',
  'perf.overflow.warn': '移动端页面存在横向滚动（body 宽度超出视口）',
  'perf.font.pass': '移动端字号适中',
  'perf.font.warn': '部分文字字号小于 12px，移动端阅读困难',
  'perf.popup.pass': '未检测到明显的弹窗/遮罩层',
  'perf.popup.warn': '检测到 {count} 个可能的弹窗/遮罩层（过多弹窗会影响审核）',

  // 合规消息
  'policy.keywords.pass': '未检测到明显的违规关键词',
  'policy.keywords.fail': '检测到 {count} 个可疑关键词',

  // AI 消息
  'ai.skip': '未配置 AI_API_KEY，跳过 AI 分析',
  'ai.fail': 'AI 分析失败: {error}',
  'ai.suggestion_count': '{count} 条改进建议',
  'ai.suggest_enable': '提示: 使用 --ai 参数启用 AI 内容质量分析，获取更深入的审查建议',

  // 报告
  'report.title': 'AdSense 审核检查报告',
  'report.composite_score': '综合评分',
  'report.score': '评分',
  'report.ready': 'READY — 可以提交 AdSense 审核',
  'report.mostly': 'MOSTLY READY — 修复 {count} 项警告后可提交审核',
  'report.notready': 'NOT READY — {count} 项失败需要修复',
  'report.pages': '已分析 {count} 个页面',
  'report.pages_ok': '+ {count} 个页面无问题',
  'report.saved': '报告已保存',
  'report.page_details': '逐页详情',
  'report.content_label': '正文',

  // 两组评分
  'report.hard_requirements': '硬性要求',
  'report.soft_scoring': '柔性评分',
  'report.hard.ready': 'READY — 所有必要项达标',
  'report.hard.warn': 'NEEDS FIXES — {count} 项警告待修复',
  'report.hard.fail': 'NOT READY — {count} 项失败必须修复',
  'report.warning_ratio': '警告比例: {count}/{total} ({pct}%)',
  'report.warning_penalty': '扣分: -{points}',

  // 分组标签
  'group.required_pages': '必要页面',
  'group.basic_structure': '基础结构',
  'group.performance_min': '性能底线',
  'group.policy': '政策合规',
  'group.site_scale': '站点规模',
  'group.content_quality': '内容质量',
  'group.ai_analysis': 'AI 内容分析',
  'group.page_quality': '页面质量',
  'group.user_experience': '用户体验',
  'group.content_relevance': '内容相关性',

  // 主题和相关性
  'item.relevance.topic': '主题相关性',
  'detector.type.tool': '工具站',
  'detector.type.unsupported': '不支持的类型',
  'topic.info': '站点主题: {topic}',
  'topic.description': '{description}',
  'topic.unsupported_warning': '该站点类型（{type}）不在 AdSense 检查支持范围内',
};

// ─── Language registry ──────────────────────────────────────────────
const langMap: Record<string, Record<string, string>> = { en, zh };

export function getSupportedLangs(): string[] {
  return Object.keys(langMap);
}

export function isValidLang(lang: string): boolean {
  return lang in langMap;
}

export function t(key: string, lang: string, vars?: Record<string, string | number>): string {
  const dict = langMap[lang] ?? langMap['en'];
  let msg = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(`{${k}}`, String(v));
    }
  }
  return msg;
}
