# AdSense Checklist — 检查项说明

## 1. Content Quality（内容质量）— 抗 Low Value Content

核心模块，专门检测 AdSense 最常见的拒绝理由 "low value content"。

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| 有效内容比率 | 剥离导航/footer/sidebar 后的正文占总页面比例 | 正文 ≥ 30% |
| 首页实质内容 | 首页正文字符数（排除模板元素） | ≥ 500 字 |
| 内页内容深度 | 抽样内页的正文字符数 | ≥ 300 字（超半数不足 → fail） |
| 模板化检测 | 多页面结构相似度（替换文字后的骨架对比） | 相似度 < 60% |
| 凑字数检测 | 重复短语、无意义填充文字（总之、众所周知、click here 等） | 每页平均 ≤ 3 处 |
| 跨页内容重复 | 段落级去重，200 字粒度检测内容搬运 | 重复率 < 30% |
| 内容新鲜度 | 页面中日期信息的时效性 | 最近 6 个月内有更新 |
| 站点规模 | sitemap 中的总页面数 | ≥ 10 个页面 |

### 正文提取算法

1. 将页面按空行分段
2. 跨页面对比，标记出现在 ≥60% 其他页面的段落（视为模板元素）
3. 剩余段落即为"正文内容"

### 模板检测算法

1. 将所有文字替换为 `W`、数字替换为 `N`
2. 比较页面间的"骨架"结构相似度
3. 相似度 > 60% 视为模板批量生成

## 2. Required Pages（必要页面）

| 检查项 | 必需 | 匹配方式 |
|--------|------|----------|
| About 页面 | ✅ | URL 路径 `/about` + 链接文字 + sitemap |
| Privacy Policy 页面 | ✅ | URL 路径 `/privacy` + 链接文字 + sitemap |
| Contact 页面 | ✅ | URL 路径 `/contact` + 链接文字 + sitemap |
| Terms of Service 页面 | ⚠️ 建议 | URL 路径 `/terms` + 链接文字 + sitemap |

检测覆盖范围：首页所有链接的 href + 可见文字 + `<nav>` + `<footer>` + sitemap.xml URL。
找到时报告具体路径，如 `/privacy/`。

## 3. Site Structure（网站结构）

| 检查项 | 说明 | 通过条件 |
|--------|------|----------|
| H1 标签 | 页面 H1 标签数量 | 有且仅有 1 个 |
| robots.txt | robots.txt 文件是否存在 | 文件存在且可访问 |
| sitemap.xml | sitemap 文件是否存在 | 文件存在且可访问 |
| 内部链接 | 首页内部链接数量 | ≥ 5 个 |
| 死链检测 | 爬取内链检查 HTTP 状态码 | 无 404/5xx 响应 |

死链检测采样前 N 个内部链接（`--depth` 参数控制，默认 10）。

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

违规关键词黑名单（中英文）：
- 色情类：porn, xxx, nude, sex tube, 色情
- 赌博类：gamble, casino, betting, lottery, 赌博
- 盗版类：hack, crack, pirate, torrent, warez, 盗版
- 毒品类：drug, marijuana, cocaine, heroin, 毒品
- 暴力类：暴力

## 6. AI Content Analysis（AI 内容分析）

需要在 `.env` 文件中配置 AI 相关环境变量，或使用 `--api-key` 参数。
支持任何兼容 OpenAI API 格式的服务（DeepSeek、OpenAI、月之暗面、本地 LLM 等）。

### 整体评估

| 检查项 | 说明 |
|--------|------|
| 内容价值评估 | AI 分析内容深度、价值、对用户的帮助程度 |
| 原创性评估 | AI 分析内容是否有 AI 生成痕迹、采集痕迹 |
| 合规性评估 | AI 分析内容是否违反 AdSense 政策 |
| AI 建议 | AI 给出的改进建议 |

### 逐页分析

AI 同时对每个页面给出独立评估，包含在 JSON 报告的 `pages[].ai` 中：
- `status`: pass/warn/fail
- `assessment`: 该页面的具体评估
- `suggestions`: 针对该页面的改进建议

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
