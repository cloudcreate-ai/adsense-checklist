import type { CheckCategory, CheckItem } from '../types.js';
import type { Page, Browser } from 'playwright';

export async function checkPerformance(
  page: Page,
  url: string,
  browser: Browser
): Promise<CheckCategory> {
  const items: CheckItem[] = [];

  // Measure load time
  const startTime = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loadTime = Date.now() - startTime;

    if (loadTime < 3000) {
      items.push({
        name: '页面加载速度',
        status: 'pass',
        message: `加载时间 ${(loadTime / 1000).toFixed(1)}s`,
      });
    } else if (loadTime < 6000) {
      items.push({
        name: '页面加载速度',
        status: 'warn',
        message: `加载时间 ${(loadTime / 1000).toFixed(1)}s（建议优化到 3s 以内）`,
      });
    } else {
      items.push({
        name: '页面加载速度',
        status: 'fail',
        message: `加载时间 ${(loadTime / 1000).toFixed(1)}s（过慢，严重影响用户体验）`,
      });
    }
  } catch {
    items.push({
      name: '页面加载速度',
      status: 'fail',
      message: '页面加载超时（30s）',
    });
  }

  // Check for viewport meta tag (mobile responsive)
  const hasViewport = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    return !!meta;
  });
  items.push({
    name: 'viewport 标签',
    status: hasViewport ? 'pass' : 'warn',
    message: hasViewport
      ? '存在 viewport meta 标签'
      : '缺少 viewport meta 标签',
  });

  // Real mobile test: visit with mobile viewport and check horizontal overflow
  try {
    const mobileContext = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const mobileCheck = await mobilePage.evaluate(() => {
      const body = document.body;
      const hasHorizontalScroll = body.scrollWidth > window.innerWidth;
      const textTooSmall = Array.from(document.querySelectorAll('p, span, a, li')).some(el => {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        return fontSize > 0 && fontSize < 12;
      });
      return { hasHorizontalScroll, textTooSmall };
    });

    if (mobileCheck.hasHorizontalScroll) {
      items.push({
        name: '移动端横向溢出',
        status: 'warn',
        message: '移动端页面存在横向滚动（body 宽度超出视口）',
      });
    } else {
      items.push({
        name: '移动端横向溢出',
        status: 'pass',
        message: '移动端页面无横向溢出',
      });
    }

    if (mobileCheck.textTooSmall) {
      items.push({
        name: '移动端字体大小',
        status: 'warn',
        message: '部分文字字号小于 12px，移动端阅读困难',
      });
    } else {
      items.push({
        name: '移动端字体大小',
        status: 'pass',
        message: '移动端字号适中',
      });
    }

    await mobileContext.close();
  } catch {
    items.push({
      name: '移动端测试',
      status: 'skip',
      message: '移动端测试失败（页面加载异常）',
    });
  }

  // Check for intrusive interstitials (popups)
  const hasOverlay = await page.evaluate(() => {
    const overlays = document.querySelectorAll(
      '[class*="modal"], [class*="popup"], [class*="overlay"], [id*="modal"], [id*="popup"]'
    );
    const visible = Array.from(overlays).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
    return visible.length;
  });
  if (hasOverlay > 0) {
    items.push({
      name: '弹窗检测',
      status: 'warn',
      message: `检测到 ${hasOverlay} 个可能的弹窗/遮罩层（过多弹窗会影响审核）`,
    });
  } else {
    items.push({
      name: '弹窗检测',
      status: 'pass',
      message: '未检测到明显的弹窗/遮罩层',
    });
  }

  return { name: 'Performance', items };
}
