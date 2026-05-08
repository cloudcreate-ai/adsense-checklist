# AdSense Checklist - 检查项说明

## 1. Content Quality（内容质量）

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| 首页内容量 | 首页文字字数 | ≥ 300 字 |
| 内页内容量 | 抽样内页的文字量 | ≥ 300 字 |
| 内容重复度 | 各页面内容相似度 | 重复页面 < 30% |
| AI 内容评估 | AI 评估内容对用户的价值 | 需要 `ANTHROPIC_API_KEY` |
| AI 原创性 | AI 评估内容是否原创 | 无采集/拼凑痕迹 |

## 2. Required Pages（必要页面）

| 检查项 | 必需 | 说明 |
|--------|------|------|
| About 页面 | ✅ | 关于我们 / About Us |
| Privacy Policy 页面 | ✅ | 隐私政策 / Privacy Policy |
| Contact 页面 | ✅ | 联系方式 / Contact Us |
| Terms of Service 页面 | ⚠️ 建议 | 服务条款 / Terms of Service |

页面通过导航链接和 URL 关键词匹配检测。

## 3. Site Structure（网站结构）

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| H1 标签 | 页面 H1 标签数量 | 有且仅有 1 个 |
| robots.txt | robots.txt 文件是否存在 | 文件存在且可访问 |
| sitemap.xml | sitemap 文件是否存在 | 文件存在且可访问 |
| 内部链接 | 首页内部链接数量 | ≥ 5 个 |
| 死链检测 | 爬取内链检查 HTTP 状态码 | 无 404/5xx 响应 |

死链检测采样前 5 个（可通过 `--depth` 调整）内部链接进行检测。

## 4. Performance（性能与体验）

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| 页面加载速度 | 从请求到 DOMContentLoaded 的时间 | < 3s 通过，3-6s 警告，> 6s 失败 |
| viewport 标签 | 是否存在 `<meta name="viewport">` | 标签存在 |
| 移动端横向溢出 | 以 iPhone 视口（390px）访问，检测横向滚动 | body 宽度 ≤ 视口宽度 |
| 移动端字体大小 | 检测所有文字元素字号 | 所有文字 ≥ 12px |
| 弹窗检测 | 检测可见的 modal/popup/overlay 元素 | 无可见弹窗 |

移动端测试使用 Playwright 模拟 iPhone 14 Pro 视口和 User-Agent。

## 5. Policy Compliance（政策合规）

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| 违规关键词 | 扫描页面是否包含违规关键词 | 无匹配 |
| 广告代码 | 检测页面是否已有广告代码占位 | 仅供参考，不计入评分 |

违规关键词黑名单（中英文）：
- 色情类：porn, xxx, nude, sex tube, 色情
- 赌博类：gamble, casino, betting, lottery, 赌博
- 盗版类：hack, crack, pirate, torrent, warez, 盗版
- 毒品类：drug, marijuana, cocaine, heroin, 毒品
- 暴力类：暴力

## 6. AI Content Analysis（AI 内容分析）

需要设置 `ANTHROPIC_API_KEY` 环境变量或使用 `--api-key` 参数。

| 检查项 | 说明 |
|--------|------|
| 内容质量评估 | Claude 分析内容深度、价值、语言质量 |
| 原创性评估 | Claude 分析内容是否有采集/拼凑痕迹 |
| 合规性评估 | Claude 分析内容是否违反 AdSense 政策 |
| AI 建议 | Claude 给出的改进建议 |

使用 `--skip-ai` 可跳过 AI 分析。

## 评分规则

- **Score** = PASS 项目数
- **Status 判定**：
  - 有 FAIL → `NOT READY`
  - 无 FAIL 但有 WARN → `MOSTLY READY`
  - 全部 PASS → `READY`

## 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 无 FAIL（READY 或 MOSTLY READY） |
| 1 | 有 FAIL（NOT READY） |
| 2 | 运行错误（URL 无效、网络异常等） |
