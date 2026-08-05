# Qidian Mobile Free Book Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一份可直接导入 Legado 3.x 的起点中文移动端书源，使用户能以“斗破苍穹”为关键词完成搜索、详情、目录和官方网页公开章节阅读。

**Architecture:** 书源只访问 `https://m.qidian.com` 的服务端渲染页面。搜索、详情和目录使用 Legado 的 CSS/JSoup 规则；正文从页面内 `vite-plugin-ssr_pageContext` JSON 提取，并在 `vipStatus=1 && isBuy=0` 时返回空正文。Node 内置测试负责静态契约和实时端点回归，第三方 Legado 兼容验证器负责执行真实规则链路。

**Tech Stack:** Legado 3.x 书源 JSON、CSS/JSoup 选择器、Rhino JavaScript、Node.js 24 `node:test`、Legado Source Validator v2.1.1、PowerShell 7、Java 17。

---

**Author:** WSL
**Design:** `docs/superpowers/specs/2026-08-03-qidian-mobile-free-book-source-design.md`

## Implementation Constraints

- 只解析起点官方移动网页当前匿名可访问的内容。
- 不添加 Cookie、Token、账号、代理、验证码处理、付费墙绕过或第三方正文回退。
- “App免费”且目录节点带 `_unPay_` 的章节必须标记为 VIP，不能当作网页公开章节。
- 新增脚本必须包含 `Author: WSL`；重要判断逻辑必须有简洁中文注释。
- 不提交 validator ZIP/JAR、调试 HTML、小说正文、Cookie 或临时报告。
- 当前 `adb devices -l` 没有在线设备，因此最终结论必须写成“HTTP validator 已验证，Android/Legado 真机尚未验证”。

### Task 1: Write the acceptance test first

**Files:**
- Create: `book-sources/tests/qidian-mobile-free.test.mjs`
- Test target: `book-sources/qidian-mobile-free.json`

- [ ] **Step 1: Create the test directory**

Run:

```powershell
New-Item -ItemType Directory -Path 'book-sources\tests' -Force | Out-Null
```

Expected: `G:\legado\book-sources\tests` exists.

- [ ] **Step 2: Add the complete static and live-chain test**

Create `book-sources/tests/qidian-mobile-free.test.mjs` with:

```javascript
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
```

- [ ] **Step 3: Run the test and confirm the RED state**

Run:

```powershell
node --test book-sources/tests/qidian-mobile-free.test.mjs
```

Expected: FAIL with `ENOENT` for `book-sources/qidian-mobile-free.json`. If it fails earlier with a JavaScript syntax error, fix the test before proceeding.

### Task 2: Implement the importable Legado source

**Files:**
- Create: `book-sources/qidian-mobile-free.json`
- Test: `book-sources/tests/qidian-mobile-free.test.mjs`

- [ ] **Step 1: Add the complete source JSON**

Create `book-sources/qidian-mobile-free.json` with:

```json
[
  {
    "bookSourceComment": "起点中文网官方移动网页书源，仅解析匿名公开元数据、目录和网页免费章节；App 专享或订阅章节标记为 VIP。",
    "bookSourceGroup": "正版·公开章节",
    "bookSourceName": "起点中文·官方免费",
    "bookSourceType": 0,
    "bookSourceUrl": "https://m.qidian.com",
    "bookUrlPattern": "^https://m\\.qidian\\.com/book/\\d+/?$",
    "customOrder": 0,
    "enabled": true,
    "enabledCookieJar": false,
    "enabledExplore": false,
    "enabledReview": false,
    "enableDangerousApi": false,
    "header": "{\"User-Agent\":\"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36\",\"Accept-Language\":\"zh-CN,zh;q=0.9\"}",
    "respondTime": 180000,
    "searchUrl": "/soushu/{{key}}.html",
    "ruleSearch": {
      "checkKeyWord": "斗破苍穹",
      "bookList": "@CSS:div[class*=\"_searchResList_\"] a[data-bid][href*=\"/chapter/\"]",
      "name": "@CSS:h2@text",
      "author": "@CSS:p[class*=\"_searchBookAuthor_\"]@text",
      "intro": "@CSS:p[class*=\"_searchBookDesc_\"]@text",
      "kind": "@CSS:div[class*=\"_tags_\"] > p@text",
      "wordCount": "@CSS:div[class*=\"_tags_\"] > p:last-child@text",
      "bookUrl": "@data-bid@js:'https://m.qidian.com/book/'+result+'/'",
      "coverUrl": "@CSS:img@data-src"
    },
    "ruleBookInfo": {
      "name": "@CSS:meta[property=\"og:novel:book_name\"]@content",
      "author": "@CSS:meta[property=\"og:novel:author\"]@content",
      "intro": "@CSS:meta[name=\"description\"]@content",
      "kind": "@CSS:meta[property=\"og:novel:category\"]@content&&@CSS:meta[property=\"og:novel:status\"]@content",
      "lastChapter": "@CSS:meta[property=\"og:novel:latest_chapter_name\"]@content",
      "updateTime": "@CSS:meta[property=\"og:novel:update_time\"]@content",
      "coverUrl": "@CSS:img.detail__header-cover__img@data-src<js>result || (book && book.coverUrl) || ''</js>",
      "tocUrl": "@CSS:#details-menu@href<js>// 重要逻辑：目录入口缺失时，从当前详情页 URL 构造官方 catalog 地址。\nresult ? result : baseUrl.replace(/\\/?$/, '/') + 'catalog/'</js>"
    },
    "ruleToc": {
      "chapterList": "@CSS:a[href*=\"/chapter/\"][class*=\"_chapterItem_\"]",
      "chapterName": "@CSS:h2@text",
      "chapterUrl": "@href",
      "isVip": "@class@js:result.indexOf('_unPay_') >= 0"
    },
    "ruleContent": {
      "content": "<js>\nvar content = '';\n// 重要逻辑：正文位于 SSR 页面上下文 JSON 中，不能把页面菜单或脚本整体当作正文。\nvar idMarker = 'id=\\\"vite-plugin-ssr_pageContext\\\"';\nvar markerIndex = result.indexOf(idMarker);\nif (markerIndex < 0) {\n  java.longToast('起点正文结构已变化：未找到页面上下文');\n} else {\n  var jsonStart = result.indexOf('>', markerIndex) + 1;\n  var jsonEnd = result.indexOf('</script>', jsonStart);\n  if (jsonStart <= 0 || jsonEnd <= jsonStart) {\n    java.longToast('起点正文结构已变化：页面上下文不完整');\n  } else {\n    try {\n      var pageData = JSON.parse(result.substring(jsonStart, jsonEnd));\n      var chapterInfo = pageData && pageData.pageContext && pageData.pageContext.pageProps && pageData.pageContext.pageProps.pageData && pageData.pageContext.pageProps.pageData.chapterInfo;\n      // 重要逻辑：vipStatus=1 且未购买时，即使 content 含提示文字也必须返回空，避免把锁章提示误作正文。\n      if (chapterInfo && Number(chapterInfo.vipStatus) === 1 && Number(chapterInfo.isBuy) === 0) {\n        java.longToast('该章节需在起点官方渠道阅读');\n      } else if (chapterInfo && typeof chapterInfo.content === 'string') {\n        content = chapterInfo.content;\n      }\n    } catch (error) {\n      java.longToast('起点正文解析失败：' + error.message);\n    }\n  }\n}\ncontent;\n</js>"
    }
  }
]
```

- [ ] **Step 2: Parse the JSON independently**

Run:

```powershell
$source = Get-Content -LiteralPath 'book-sources\qidian-mobile-free.json' -Raw | ConvertFrom-Json
$source | Select-Object bookSourceName,bookSourceUrl,searchUrl | Format-List
```

Expected:

```text
bookSourceName : 起点中文·官方免费
bookSourceUrl  : https://m.qidian.com
searchUrl      : /soushu/{{key}}.html
```

- [ ] **Step 3: Run the full test and confirm GREEN**

Run:

```powershell
node --test book-sources/tests/qidian-mobile-free.test.mjs
```

Expected: one parent test and five child tests pass; output ends with `fail 0`.

- [ ] **Step 4: Commit the tested source and its regression test**

Run:

```powershell
git add book-sources/qidian-mobile-free.json book-sources/tests/qidian-mobile-free.test.mjs
git commit -m "feat: add qidian mobile free book source"
```

Expected: commit succeeds and contains exactly the source JSON and test script.

### Task 3: Run the Legado-compatible rule validator

**Files:**
- Verify: `book-sources/qidian-mobile-free.json`
- Temporary only: `G:\_tmp\legado-validator-v2.1.1-verified\`
- Do not commit: validator ZIP/JAR, debug HTML, response previews

- [ ] **Step 1: Download and checksum the pinned validator release outside the repository**

Run:

```powershell
$validatorRoot = 'G:\_tmp\legado-validator-v2.1.1-verified'
$validatorZip = Join-Path $validatorRoot 'legado-book-source-generator-v2.1.1.zip'
New-Item -ItemType Directory -Path $validatorRoot -Force | Out-Null
curl.exe -L --fail --retry 5 --retry-all-errors --max-time 300 -o $validatorZip 'https://github.com/Narylr350/book-source-creator-skill/releases/download/v2.1.1/legado-book-source-generator-v2.1.1.zip'
$validatorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $validatorZip).Hash.ToLowerInvariant()
if ($validatorHash -ne 'b9c50f87a75de211d0e0a0d4bcd7dbb8e6ff25944ebe587a28f3f6ad44864267') {
  throw "validator checksum mismatch: $validatorHash"
}
Expand-Archive -LiteralPath $validatorZip -DestinationPath $validatorRoot -Force
```

Expected: checksum matches, and this file exists:

```text
G:\_tmp\legado-validator-v2.1.1-verified\legado-book-source-generator\validator\app\legado-source-validator.jar
```

- [ ] **Step 2: Start the validator, execute the real four-phase rule chain, assert the report, and stop it**

Run from `G:\legado`:

```powershell
$validatorRoot = 'G:\_tmp\legado-validator-v2.1.1-verified\legado-book-source-generator\validator'
$validatorJar = Join-Path $validatorRoot 'app\legado-source-validator.jar'
$validatorProcess = Start-Process -FilePath 'java' -ArgumentList @('-jar', $validatorJar) -WorkingDirectory $validatorRoot -WindowStyle Hidden -PassThru

try {
  $validatorReady = $false
  foreach ($attempt in 1..30) {
    try {
      $sources = Invoke-RestMethod -Method Get -Uri 'http://localhost:1111/api/sources' -TimeoutSec 2
      $validatorReady = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $validatorReady) {
    throw 'Legado validator did not become ready on http://localhost:1111'
  }

  $debugDir = 'G:\_tmp\legado-qidian-validation-debug'
  New-Item -ItemType Directory -Path $debugDir -Force | Out-Null
  $sourceJson = Get-Content -LiteralPath 'book-sources\qidian-mobile-free.json' -Raw
  $requestBody = @{
    sourceJson = $sourceJson
    sourceUrl = 'https://m.qidian.com'
    keyword = '斗破苍穹'
    mode = 'http'
    debugDir = $debugDir
  } | ConvertTo-Json -Depth 8

  $report = Invoke-RestMethod -Method Post -Uri 'http://localhost:1111/api/debug/run' -ContentType 'application/json; charset=utf-8' -Body $requestBody -TimeoutSec 180
  [pscustomobject]@{
    FinalStatus = $report.finalStatus
    Search = $report.phases.search
    Detail = $report.phases.detail
    Toc = $report.phases.toc
    Content = $report.phases.content
    ResultCount = $report.summary.resultCount
    ChapterCount = $report.summary.chapterCount
    ContentLength = $report.summary.contentPreview.Length
  } | Format-List

  $failedSteps = @($report.steps | Where-Object { $_.status -ne 'success' })
  if ($report.finalStatus -ne 'passed' -or $failedSteps.Count -gt 0) {
    $failedSteps | Select-Object phase,errorCode,failedField,error | Format-Table -AutoSize
    throw 'Legado validator did not pass the complete source chain'
  }
  if ($report.summary.resultCount -lt 1 -or $report.summary.chapterCount -le 1000 -or $report.summary.contentPreview.Length -le 100) {
    throw 'Legado validator summary did not meet the acceptance thresholds'
  }
} finally {
  if ($validatorProcess -and -not $validatorProcess.HasExited) {
    Stop-Process -Id $validatorProcess.Id
  }
}
```

Expected:

```text
FinalStatus  : passed
Search       : success
Detail       : success
Toc          : success
Content      : success
ResultCount  : 1 or greater
ChapterCount : greater than 1000
ContentLength: greater than 100
```

If the report contains a structural validator error, stop this task and invoke `superpowers:systematic-debugging` before changing the source. Use `failedField` as the edit boundary. Do not respond to `CAPTCHA_DETECTED`, `HTTP_BLOCKED`, login, or VIP errors by adding credentials, third-party fallbacks, or bypass logic.

- [ ] **Step 3: Confirm validator artifacts remain outside Git**

Run:

```powershell
git status --short
$trackedArtifacts = git ls-files | Select-String -Pattern 'legado-source-validator\.jar|legado-book-source-generator.*\.zip|response\.raw\.html'
if ($trackedArtifacts) { throw 'validator or captured HTML was committed' }
```

Expected: `git status --short` lists no validator ZIP/JAR/debug artifacts, and the tracked-artifact assertion does not throw.

### Task 4: Document import steps, validation evidence, and limits

**Files:**
- Create: `book-sources/README.md`

- [ ] **Step 1: Add the user-facing README**

Create `book-sources/README.md` with:

```markdown
# Legado 书源

## 起点中文·官方免费

书源文件：`qidian-mobile-free.json`

这是一个自包含的起点中文网官方移动网页书源。它支持按书名搜索、书籍详情、完整目录，以及起点网页匿名公开的免费章节。需要订阅或只能在起点 App 中阅读的章节会标记为 VIP，不会尝试绕过访问限制。

### 导入

1. 在 Legado 3.x 打开“我的” → “书源管理”。
2. 选择右上角菜单中的“本地导入”。
3. 选择 `qidian-mobile-free.json`。
4. 保持“起点中文·官方免费”启用，在搜索中输入书名，例如“斗破苍穹”。

### 当前验证结果

验证日期：2026-08-03

- 标准 JSON 解析：通过。
- Node 静态契约和官方实时端点回归：通过。
- Legado Source Validator v2.1.1 HTTP 模式：搜索、详情、目录、正文四阶段通过。
- 验收关键词：`斗破苍穹`。
- 验收原作：书籍 ID `1209977`，作者“天蚕土豆”。
- 目录：超过 1,000 个章节条目，包含“第一章 陨落的天才”。
- 免费章节：正文提取长度超过 1,000 字符。
- 受限章节：目录 `_unPay_` 节点标记为 VIP；`vipStatus=1` 且 `isBuy=0` 时不返回锁章提示作为正文。
- Android/Legado 真机：本机当前无在线 adb 设备，尚未完成真机导入验证。

复现 Node 检查：

```powershell
node --test book-sources/tests/qidian-mobile-free.test.mjs
```

### 限制

- 只搜索起点中文网已收录的作品，不是多站聚合搜索。
- 只读取官方移动网页匿名公开的章节；订阅、App 专享、登录或验证码内容不在支持范围内。
- 起点页面结构或安全策略变化后，CSS 选择器或页面上下文路径可能需要维护。
- 不包含 Cookie、Token、账号信息、第三方代理或聚合正文接口。
- 仅供个人学习、兼容性验证和在服务条款允许范围内使用；不得用于内容再分发或规避平台限制。
```

- [ ] **Step 2: Verify that documentation does not overstate Android coverage**

Run:

```powershell
rg -n 'HTTP 模式|真机|VIP|Cookie|Token' book-sources/README.md
```

Expected: README explicitly says HTTP mode passed, Android/Legado device testing is not complete, restricted chapters are VIP, and no credentials are bundled.

- [ ] **Step 3: Commit the documentation**

Run:

```powershell
git add book-sources/README.md
git commit -m "docs: document qidian source validation"
```

Expected: commit succeeds and only adds `book-sources/README.md`.

### Task 5: Run the final audit

**Files:**
- Verify: `book-sources/qidian-mobile-free.json`
- Verify: `book-sources/tests/qidian-mobile-free.test.mjs`
- Verify: `book-sources/README.md`
- Verify: `docs/superpowers/specs/2026-08-03-qidian-mobile-free-book-source-design.md`

- [ ] **Step 1: Re-run all deliverable checks from a clean process**

Run:

```powershell
node --test book-sources/tests/qidian-mobile-free.test.mjs
$source = Get-Content -LiteralPath 'book-sources\qidian-mobile-free.json' -Raw | ConvertFrom-Json
if ($source.Count -ne 1) { throw 'expected exactly one source' }
if ($source[0].bookSourceUrl -ne 'https://m.qidian.com') { throw 'unexpected source URL' }
git diff --check HEAD~2..HEAD
```

Expected: tests end with `fail 0`, JSON assertions do not throw, and `git diff --check` prints nothing.

- [ ] **Step 2: Audit prohibited dependencies and uncommitted binaries**

Run:

```powershell
$sourceText = Get-Content -LiteralPath 'book-sources\qidian-mobile-free.json' -Raw
if ($sourceText -match 'yckceo|langge|czyl|example\.com') { throw 'third-party backend found' }
$source = $sourceText | ConvertFrom-Json
if ($source[0].header -match 'Cookie|Authorization') { throw 'credential header found' }
$trackedBinaries = git ls-files | Select-String -Pattern 'legado-source-validator\.jar|legado-book-source-generator.*\.zip|response\.raw\.html'
if ($trackedBinaries) { throw 'validator or captured HTML was committed' }
git status --short --branch
```

Expected: no exception. Branch is ahead of `origin/master`; only the implementation-plan file may still be uncommitted if the plan itself has not yet been committed.

- [ ] **Step 3: Recheck Android availability and record the honest boundary**

Run:

```powershell
& 'D:\Android\SDK\platform-tools\adb.exe' devices -l
```

Expected current output: only `List of devices attached` and no device row. Keep the README statement “尚未完成真机导入验证”. If a device is unexpectedly online, do not silently broaden scope; report that Android validation is available and ask before installing or launching any app.

- [ ] **Step 4: Inspect the final history and hand off the source**

Run:

```powershell
git log --oneline -5
git show --stat --oneline HEAD
git status --short --branch
```

Expected: design, source/test, and README commits are visible; no required implementation file is uncommitted. Report the absolute source path `G:\legado\book-sources\qidian-mobile-free.json`, the exact tests run, validator result, and the Android verification limitation. Do not push unless the user explicitly asks.
