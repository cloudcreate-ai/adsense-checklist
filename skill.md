---
name: adsense-check
description: 检查网站是否符合 Google AdSense 审核要求，给出结构化报告和修复建议
trigger: adsense-check, adsense 审核, 广告审核检查, 检查网站是否符合 adsense, check adsense eligibility
---

当用户要求检查网站 AdSense 审核合规性时，执行以下流程：

## 前置条件
确认 `adsense-check` CLI 已安装：
```bash
which adsense-check || npx adsense-check --version
```
如未安装，提示用户：`npm install -g adsense-check`

## 执行检查

1. 获取目标 URL（从用户消息中提取，或询问用户）
2. 运行检查命令，获取 JSON 输出：
```bash
adsense-check <url> --json
```
如需 AI 深度分析（默认启用），确保环境变量 `ANTHROPIC_API_KEY` 已设置。
如用户不想用 AI 分析，添加 `--skip-ai` 参数。

3. 解析 JSON 输出，给用户中文总结，格式如下：

## 输出模板

### 总览
- 网站: `<url>`
- 总评分: `<score>/10`
- 状态: `<status>`

### 检查结果

按类别列出每项检查结果：
- **通过 (PASS)**: 简要说明
- **警告 (WARN)**: 说明问题和影响
- **失败 (FAIL)**: 说明问题、影响和具体修复方法

### 修复建议

对每个 FAIL 和 WARN 项给出具体可操作的修复建议：
- 优先级排序（FAIL 优先于 WARN）
- 每条建议包含：问题描述、修复步骤、预期效果

### AdSense 审核额外提醒
- 网站至少运营 3 个月再申请
- 确保有持续更新的原创内容
- 申请前检查 Google Search Console 无严重错误
- 避免在审核期间大幅改动网站结构
