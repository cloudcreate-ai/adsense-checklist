---
name: adsense-check
description: 检查网站是否符合 Google AdSense 审核要求，重点检测 low value content，给出结构化报告和逐页修复建议
trigger: adsense-check, adsense 审核, 广告审核检查, 检查网站是否符合 adsense, check adsense eligibility, low value content
---

当用户要求检查网站 AdSense 审核合规性时，执行以下流程：

## 前置条件

确认 `@cloudcreate/adsense-check` CLI 已安装：
```bash
which adsense-check || npx @cloudcreate/adsense-check --version
```
如未安装，提示用户：`npm install -g @cloudcreate/adsense-check`

## 执行检查

1. 获取目标 URL（从用户消息中提取，或询问用户）
2. 运行检查命令：
```bash
adsense-check <url> --json
```
如用户不想用 AI 分析，添加 `--skip-ai` 参数。
AI 分析需要配置 `AI_API_KEY`（在 `.env` 中）。

3. 解析 JSON 输出，给用户中文总结：

## 输出模板

### 总览
- 网站: `<url>`
- 总评分: `<score>/<totalChecks>`
- 状态: `<status>` (READY / MOSTLY READY / NOT READY)

### 检查结果摘要

按类别汇总：
- **Content Quality (N 项)**: PASS x N, WARN x N, FAIL x N — 重点关注 low value content 相关
- **Required Pages**: 缺失哪些必要页面
- **Site Structure**: 结构问题
- **Performance**: 性能/移动端问题
- **Policy Compliance**: 政策合规
- **AI Analysis**: AI 整体评估

### 逐页详情（问题页面）

从 `pages` 数组中筛选有问题的页面，逐一说明：

```
页面: <url>
  标题: <title>
  正文占比: <contentRatio>%  (<contentChars>/<totalChars> 字)
  问题: <issues>
  AI 评估: <ai.assessment>
  改进建议:
    - <ai.suggestions[0]>
    - <ai.suggestions[1]>
```

### 修复建议

按优先级排序：
1. **FAIL 项（必须修复）**: 具体修复步骤
2. **WARN 项（建议修复）**: 改进方法

### AdSense 审核提醒
- 网站至少运营 3 个月再申请
- 确保有持续更新的原创内容
- "low value content" 是最常见的拒绝理由，重点关注：
  - 每个页面是否有足够的原创实质内容（≥500 字正文）
  - 内容是否对用户有独特价值，而非泛泛而谈
  - 避免页面间内容高度重复
- 申请前检查 Google Search Console 无严重错误
- 避免在审核期间大幅改动网站结构
