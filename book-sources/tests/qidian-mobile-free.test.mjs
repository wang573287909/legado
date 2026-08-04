/**
 * Author: WSL
 * 起点移动端官方免费书源的静态契约与实时链路回归测试。
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.resolve(testDirectory, '..', 'qidian-mobile-free.json');
const bookId = '1209977';
const keyword = '斗破苍穹';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const tagStart = html.lastIndexOf('<a', markerIndex);
  const tagEnd = html.indexOf('>', markerIndex);
  assert.ok(tagStart >= 0 && tagEnd > markerIndex, `无法定位 ${marker} 所在章节节点`);
  return html.slice(tagStart, tagEnd + 1);
}

async function fetchHtml(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 200, `${url} 返回 HTTP ${response.status}`);
  return response.text();
}

test('起点官方免费书源满足静态契约和实时四段链路', async (t) => {
  const sourceText = await readFile(sourceFile, 'utf8');
  const parsed = JSON.parse(sourceText);
  assert.ok(Array.isArray(parsed), '书源文件必须使用可直接导入的 JSON 数组');
  assert.equal(parsed.length, 1, '书源文件只能包含一个书源');
  const source = parsed[0];

  await t.test('静态配置不依赖凭据或第三方聚合服务', () => {
    assert.equal(source.bookSourceName, '起点中文·官方免费');
    assert.equal(source.bookSourceUrl, 'https://m.qidian.com');
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
    assert.doesNotMatch(source.header, /Cookie|Authorization/i);
    assert.doesNotMatch(sourceText, /yckceo|langge|czyl|example\.com/i);
  });

  const headers = JSON.parse(source.header);

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
    assert.match(getMetaContent(detailHtml, 'property', 'og:novel:category'), /玄幻/);
    assert.match(detailHtml, /id=["']details-menu["'][^>]*href=["'][^"']*\/catalog\//i);
    assert.match(detailHtml, /class=["'][^"']*detail__header-cover__img[^"']*["']/i);
  });

  await t.test('目录完整并把 App 专享章节识别为受限章节', async () => {
    const catalogHtml = await fetchHtml(`${source.bookSourceUrl}/book/${bookId}/catalog/`, headers);
    const chapterUrls = catalogHtml.match(/\/chapter\/1209977\/\d+\//g) ?? [];
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
    assert.match(freeInfo.content, /<p[ >]/i);

    const restrictedHtml = await fetchHtml(`${source.bookSourceUrl}/chapter/${bookId}/26560227/`, headers);
    const restrictedInfo = getPageContext(restrictedHtml).pageContext.pageProps.pageData.chapterInfo;
    assert.equal(restrictedInfo.vipStatus, 1);
    assert.equal(restrictedInfo.isBuy, 0);
    assert.ok(restrictedInfo.content.length < 500, '受限章节意外返回了可读长正文');
  });
});
