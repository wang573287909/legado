/**
 * Author: WSL
 * 起点移动端官方免费书源的静态契约与实时链路回归测试。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.resolve(testDirectory, '..', 'qidian-mobile-free.json');
const bookId = '1209977';
const keyword = '斗破苍穹';
const officialOrigin = 'https://m.qidian.com';
const allowedHeaderNames = ['Accept-Language', 'User-Agent'];
const forbiddenIntegrationFields = ['loginUrl', 'loginUi', 'loginCheckJs', 'jsLib', 'proxy'];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectWebUrls(value, urls = []) {
  if (typeof value === 'string') {
    const matches = value.matchAll(/(?:https?:)?\/\/[^\s"'`<>]+/gi);
    for (const match of matches) {
      urls.push(match[0]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectWebUrls(item, urls);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectWebUrls(item, urls);
    }
  }
  return urls;
}

function isOfficialWebUrl(url) {
  try {
    return new URL(url, officialOrigin).origin === officialOrigin;
  } catch {
    return false;
  }
}

function getRuleContentScript(contentRule) {
  const script = /^<js>\s*([\s\S]*?)\s*<\/js>$/.exec(contentRule);
  assert.ok(script, '正文规则必须是完整的 <js> 脚本');
  return script[1];
}

function makeChapterPage(chapterInfo, openingTag = '<script id="vite-plugin-ssr_pageContext">') {
  return `${openingTag}${JSON.stringify({
    pageContext: { pageProps: { pageData: { chapterInfo } } },
  })}</script>`;
}

function runContentRuleHtml(contentRule, html) {
  const messages = [];
  const output = vm.runInNewContext(getRuleContentScript(contentRule), {
    result: html,
    java: {
      longToast(message) {
        messages.push(String(message));
      },
    },
  });
  return { output, messages };
}

function runContentRule(contentRule, chapterInfo, openingTag) {
  return runContentRuleHtml(contentRule, makeChapterPage(chapterInfo, openingTag));
}

function getMetaContent(html, key, value) {
  const keyPattern = new RegExp(`\\b${escapeRegExp(key)}=["']${escapeRegExp(value)}["']`, 'i');
  const tag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((candidate) => keyPattern.test(candidate));
  assert.ok(tag, `未找到 meta[${key}="${value}"]`);
  const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
  assert.ok(content, `meta[${key}="${value}"] 缺少 content`);
  return content;
}

function getPageContext(html) {
  // 重要逻辑：只截取已定位 script 标签到其闭合标签之间的 JSON，避免误解析页面其他脚本。
  const openingTag = /<script\b[^>]*id=["']vite-plugin-ssr_pageContext["'][^>]*>/i.exec(html);
  assert.ok(openingTag, '正文页缺少 vite-plugin-ssr_pageContext');
  const jsonStart = openingTag.index + openingTag[0].length;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  assert.ok(jsonEnd > jsonStart, '页面上下文 script 没有闭合');
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

function getOpeningAnchor(html, marker) {
  const markerIndex = html.indexOf(marker);
  assert.ok(markerIndex >= 0, `目录中缺少章节标记 ${marker}`);
  // 重要逻辑：从章节标记反向定位同一开标签，确保受限类名属于该章节节点而非相邻内容。
  const tagStart = html.lastIndexOf('<a', markerIndex);
  const tagEnd = html.indexOf('>', markerIndex);
  assert.ok(tagStart >= 0 && tagEnd > markerIndex, `无法定位 ${marker} 所在章节节点`);
  return html.slice(tagStart, tagEnd + 1);
}

async function fetchHtml(url, headers) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`请求 ${url} 的传输或正文读取在 20000ms 内失败`, { cause: error });
  }
  assert.equal(response.status, 200, `${url} 返回 HTTP ${response.status}`);
  try {
    return await response.text();
  } catch (error) {
    throw new Error(`请求 ${url} 的传输或正文读取在 20000ms 内失败`, { cause: error });
  }
}

test('起点官方免费书源满足静态契约和实时四段链路', async (t) => {
  const sourceText = await readFile(sourceFile, 'utf8');
  const parsed = JSON.parse(sourceText);
  assert.ok(Array.isArray(parsed), '书源文件必须使用可直接导入的 JSON 数组');
  assert.equal(parsed.length, 1, '书源文件只能包含一个书源');
  const source = parsed[0];
  const headers = JSON.parse(source.header);

  await t.test('静态配置不依赖凭据或第三方聚合服务', () => {
    const { bookUrlPattern, ...navigableSource } = source;
    assert.equal(source.bookSourceName, '起点中文·官方免费');
    assert.equal(source.bookSourceUrl, 'https://m.qidian.com');
    assert.equal(bookUrlPattern, '^https://m\\.qidian\\.com/book/\\d+/?$');
    assert.equal(source.bookSourceType, 0);
    assert.equal(source.enabled, true);
    assert.equal(source.enabledExplore, false);
    assert.equal(source.enabledReview, false);
    assert.equal(source.enabledCookieJar, false);
    assert.equal(source.enableDangerousApi, false);
    assert.equal(source.searchUrl, '/soushu/{{key}}.html');
    assert.equal(source.ruleSearch.checkKeyWord, keyword);
    assert.match(source.ruleSearch.bookUrl, /data-bid/);
    assert.match(source.ruleBookInfo.coverUrl, /book\.coverUrl/);
    assert.match(source.ruleBookInfo.tocUrl, /baseUrl/);
    assert.match(source.ruleToc.isVip, /_unPay_/);
    assert.match(source.ruleContent.content, /chapterInfo\.vipStatus/);
    assert.match(source.ruleContent.content, /重要逻辑/);
    assert.ok(headers && typeof headers === 'object' && !Array.isArray(headers), '请求头必须是 JSON 对象');
    assert.deepEqual(Object.keys(headers).sort(), allowedHeaderNames, '请求头只能包含最小化的公开浏览器字段');
    for (const field of forbiddenIntegrationFields) {
      assert.ok(!(field in source), `书源不得定义 ${field} 登录、脚本库或代理字段`);
    }
    // 重要逻辑：bookUrlPattern 是 URL 正则契约而不是可请求地址，不能按 URL origin 解析。
    const webUrls = collectWebUrls(navigableSource);
    assert.ok(
      webUrls.every(isOfficialWebUrl),
      '书源配置中的 HTTP(S) 或协议相对地址必须属于起点移动端官网',
    );
    const maliciousSource = { ...navigableSource, searchUrl: '//evil.invalid/search' };
    assert.ok(
      !collectWebUrls(maliciousSource).every(isOfficialWebUrl),
      '协议相对的第三方地址必须被 URL origin 校验拒绝',
    );
    assert.doesNotMatch(sourceText, /yckceo|langge|czyl|example\.com/i);
  });

  await t.test('正文执行规则只放行明确免费状态，并对结构变体失败关闭', () => {
    const syntheticContent = '<p>synthetic public content</p>';
    const freeCases = [0, '0'];
    for (const vipStatus of freeCases) {
      const { output, messages } = runContentRule(source.ruleContent.content, { vipStatus, content: syntheticContent });
      assert.equal(output, syntheticContent, `vipStatus=${JSON.stringify(vipStatus)} 应返回正文`);
      assert.deepEqual(messages, [], '明确免费状态不应提示读取失败');
    }

    const blockedCases = [
      { label: 'vipStatus=1,isBuy=0', chapterInfo: { vipStatus: 1, isBuy: 0, content: syntheticContent } },
      { label: 'vipStatus=1,isBuy=1', chapterInfo: { vipStatus: 1, isBuy: 1, content: syntheticContent } },
      { label: 'vipStatus="1"', chapterInfo: { vipStatus: '1', content: syntheticContent } },
      { label: 'missing vipStatus', chapterInfo: { content: syntheticContent } },
      { label: 'vipStatus=null', chapterInfo: { vipStatus: null, content: syntheticContent } },
      { label: 'vipStatus=""', chapterInfo: { vipStatus: '', content: syntheticContent } },
      { label: 'vipStatus=unknown', chapterInfo: { vipStatus: 'unknown', content: syntheticContent } },
    ];
    for (const { label, chapterInfo } of blockedCases) {
      const { output, messages } = runContentRule(source.ruleContent.content, chapterInfo);
      assert.equal(output, '', `${label} 必须失败关闭`);
      assert.ok(messages.length > 0, '失败关闭必须向用户提示官方阅读渠道或解析问题');
      assert.ok(messages.every((message) => !message.includes(syntheticContent)), '失败路径不得记录正文');
    }

    const changedTag = '<SCRIPT data-page="chapter" id = \'vite-plugin-ssr_pageContext\' type="application/json">';
    const { output, messages } = runContentRule(source.ruleContent.content, { vipStatus: 0, content: syntheticContent }, changedTag);
    assert.equal(output, syntheticContent, '属性顺序、单双引号和等号空白变化的 script 标签仍应解析');
    assert.deepEqual(messages, [], '可识别的结构变体不应触发失败提示');

    const unclosedHtml = makeChapterPage({ vipStatus: 0, content: syntheticContent }).replace('</script>', '');
    const unclosedResult = runContentRuleHtml(source.ruleContent.content, unclosedHtml);
    assert.equal(unclosedResult.output, '', '缺少 script 闭合标签时必须失败关闭');
    assert.ok(unclosedResult.messages.length > 0, '缺少 script 闭合标签时必须提示解析问题');
    assert.ok(unclosedResult.messages.every((message) => !message.includes(syntheticContent)), '结构失败路径不得记录正文');
  });

  await t.test('搜索斗破苍穹返回原作', async () => {
    const searchHtml = await fetchHtml(
      `${source.bookSourceUrl}/soushu/${encodeURIComponent(keyword)}.html`,
      headers,
    );
    assert.match(searchHtml, new RegExp(`data-bid=["']${bookId}["']`));
    assert.match(searchHtml, />斗破苍穹</);
    assert.match(searchHtml, /天蚕土豆/);
  });

  await t.test('详情页提供稳定元数据和目录链接', async () => {
    const detailHtml = await fetchHtml(`${source.bookSourceUrl}/book/${bookId}/`, headers);
    assert.equal(getMetaContent(detailHtml, 'property', 'og:novel:book_name'), keyword);
    assert.equal(getMetaContent(detailHtml, 'property', 'og:novel:author'), '天蚕土豆');
    assert.equal(getMetaContent(detailHtml, 'property', 'og:novel:category'), '异世大陆');
    assert.equal(getMetaContent(detailHtml, 'property', 'og:novel:status'), '完本');
    assert.match(detailHtml, /id=["']details-menu["'][^>]*href=["'][^"']*\/catalog\//i);
    assert.match(detailHtml, /class=["'][^"']*detail__header-cover__img[^"']*["']/i);
  });

  await t.test('目录完整并把 App 专享章节识别为受限章节', async () => {
    const catalogHtml = await fetchHtml(`${source.bookSourceUrl}/book/${bookId}/catalog/`, headers);
    const chapterUrls = catalogHtml.match(new RegExp(`/chapter/${escapeRegExp(bookId)}/\\d+/`, 'g')) ?? [];
    assert.ok(chapterUrls.length > 1_000, `目录章节链接过少：${chapterUrls.length}`);
    assert.match(catalogHtml, /第一章\s*陨落的天才/);

    // 重要逻辑：目录文案“App免费”不代表网页匿名可读，必须以节点的 _unPay_ 类为准。
    const restrictedAnchor = getOpeningAnchor(catalogHtml, '/26560227/');
    assert.match(restrictedAnchor, /_unPay_/);
  });

  await t.test('免费章节有正文，受限章节只返回锁定状态', async () => {
    const freeHtml = await fetchHtml(`${source.bookSourceUrl}/chapter/${bookId}/23183869/`, headers);
    const freeInfo = getPageContext(freeHtml).pageContext.pageProps.pageData.chapterInfo;
    assert.equal(freeInfo.chapterName, '第一章 陨落的天才');
    assert.ok(freeInfo.content.length > 1_000, `免费章节正文过短：${freeInfo.content.length}`);
    assert.ok(/<p[ >]/i.test(freeInfo.content), '免费章节正文缺少段落标签');

    const restrictedHtml = await fetchHtml(`${source.bookSourceUrl}/chapter/${bookId}/26560227/`, headers);
    const restrictedInfo = getPageContext(restrictedHtml).pageContext.pageProps.pageData.chapterInfo;
    assert.equal(restrictedInfo.vipStatus, 1);
    assert.equal(restrictedInfo.isBuy, 0);
    assert.ok(restrictedInfo.content.length < 500, '受限章节意外返回了可读长正文');
  });
});
