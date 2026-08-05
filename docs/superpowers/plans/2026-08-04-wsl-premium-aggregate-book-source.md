# WSL Premium Aggregate Book Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一个可直接导入的 JSON 文件，在 Legado 中一次安装小说、听书、漫画、短剧四个原生类型的 `WSL·精品聚合` 书源，并覆盖搜索、详情、目录、正文、发现、登录、节点切换、书架同步和评论。

**Architecture:** 开发期把 Rhino ES5 运行时拆为独立模块，通过 `build.mjs` 按固定顺序合并到四个书源对象的 `jsLib`。所有书籍、章节和发现链接使用 `data:;base64,` 状态 URL，实际 HTTP 请求统一进入 `transport.js`；协议证据只来自实际请求/响应的脱敏结构。四个对象按服务域名共享 Cookie，通过全局缓存命名空间共享设置和节点健康状态；大型列表响应只在 `WSLPA` 共享作用域的有界内存桥接中短暂存在，不写入持久缓存。

**Tech Stack:** Legado 3.x 书源 JSON、Rhino JavaScript ES5、Legado `java.connect`/`cache`/`cookie` API、Node.js 24 `node:test`、Node `vm`、PowerShell 7、Java 17、Android Debug Bridge。

---

**Author:** WSL
**Design:** `docs/superpowers/specs/2026-08-04-wsl-premium-aggregate-book-source-design.md`

## Implementation Constraints

- 在执行实现前调用 `superpowers:using-git-worktrees` 校验当前隔离工作区；当前目标分支是 `codex/qidian-mobile-free`。
- 原始 `7595` 只作为不透明客户端运行，不打开或复制其 `jsLib` 函数体。
- 新增 `.js`、`.mjs` 和其他脚本的文件头必须包含 `Author: WSL`。
- Rhino `SharedJsScope` 在没有规则绑定时加载并封存 `jsLib`；运行时入口必须显式接收 `WSLPA.ctx(java, source, cache, cookie)`，不得依赖共享函数中的自由 `java/cache/source/cookie` 变量。
- 协议解析、节点切换、媒体分派、脱敏和写操作不重放逻辑必须有中文注释。
- 不提交 HAR、代理证书、Cookie、Token、账号、正文、评论原文或媒体签名 URL。
- 任何测试失败或协议行为与夹具不一致时，先调用 `superpowers:systematic-debugging`，再修改最小责任文件。
- 每个任务的提交只包含该任务列出的文件；不推送远端，除非用户明确要求。

## File Map

| Path | Responsibility |
| --- | --- |
| `book-sources/wsl-premium-aggregate.json` | 最终可导入的四书源数组，仅由构建器生成 |
| `book-sources/wsl-premium-aggregate/source.template.json` | 四个对象共享的 Legado 规则模板 |
| `book-sources/wsl-premium-aggregate/build.mjs` | 校验模板、合并模块、生成确定性 JSON |
| `book-sources/wsl-premium-aggregate/protocol/capture.mjs` | 从 HAR 提取字段结构并脱敏，不保存值域内容 |
| `book-sources/wsl-premium-aggregate/protocol/observed-api.json` | 已观察的主机、方法、路径、字段和证据状态 |
| `book-sources/wsl-premium-aggregate/protocol/fixtures/*.json` | 合成值组成的响应契约夹具 |
| `book-sources/wsl-premium-aggregate/runtime/config.js` | 媒体识别、共享配置、主机常量和缓存键 |
| `book-sources/wsl-premium-aggregate/runtime/state.js` | 状态 URL 编解码、版本、敏感键校验和有界内存响应桥接 |
| `book-sources/wsl-premium-aggregate/runtime/transport.js` | 请求构造、业务信封、健康节点与重试边界 |
| `book-sources/wsl-premium-aggregate/runtime/search.js` | 搜索语法、请求和公共列表映射 |
| `book-sources/wsl-premium-aggregate/runtime/detail.js` | 详情请求、空字段回退和目录状态生成 |
| `book-sources/wsl-premium-aggregate/runtime/catalog.js` | 目录请求、卷/VIP 映射和章节状态生成 |
| `book-sources/wsl-premium-aggregate/runtime/content.js` | 小说、音频、漫画和视频正文适配 |
| `book-sources/wsl-premium-aggregate/runtime/auth.js` | 动态登录 UI、浏览器登录、状态检查和退出 |
| `book-sources/wsl-premium-aggregate/runtime/explore.js` | 动态发现栏目、样式清洗和发现列表 |
| `book-sources/wsl-premium-aggregate/runtime/review.js` | 章评/段评读取映射与已观察写操作 |
| `book-sources/wsl-premium-aggregate/runtime/bookshelf.js` | 检查、添加和节流进度同步 |
| `book-sources/tests/wsl-premium-aggregate.test.mjs` | 静态、夹具、运行时和可选实时回归 |
| `book-sources/README.md` | 导入、服务器依赖、验证结果和人工检查清单 |

### Task 1: Establish the sanitized protocol registry and fixtures

**Files:**
- Create: `book-sources/wsl-premium-aggregate/protocol/capture.mjs`
- Create: `book-sources/wsl-premium-aggregate/protocol/observed-api.json`
- Create: `book-sources/wsl-premium-aggregate/protocol/fixtures/*.json`
- Create: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Write the failing protocol and privacy tests**

Create `book-sources/tests/wsl-premium-aggregate.test.mjs` with:

```javascript
/**
 * Author: WSL
 * WSL 精品聚合书源的静态、夹具、运行时与实时契约测试。
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, '..', 'wsl-premium-aggregate');
const fixtureRoot = path.join(sourceRoot, 'protocol', 'fixtures');
const runtimeRoot = path.join(sourceRoot, 'runtime');
const outputFile = path.resolve(testDir, '..', 'wsl-premium-aggregate.json');

async function jsonFile(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function fixture(name) {
  return jsonFile(path.join(fixtureRoot, `${name}.json`));
}

function makeCache() {
  const values = new Map();
  return {
    delete(key) { values.delete(String(key)); },
    get(key) { return values.get(String(key)) ?? null; },
    put(key, value) { values.set(String(key), String(value)); },
    values,
  };
}

function makeJava(connect = () => { throw new Error('unexpected connect'); }) {
  return {
    base64Decode(value) { return Buffer.from(String(value), 'base64').toString('utf8'); },
    base64Encode(value) { return Buffer.from(String(value), 'utf8').toString('base64'); },
    connect,
    getCookie() { return ''; },
    hexDecodeToString(value) { return Buffer.from(String(value), 'hex').toString('utf8'); },
    longToast() {},
    refreshUi() {},
    startBrowser() {},
    toast() {},
  };
}

async function loadRuntime(files, overrides = {}) {
  const cache = overrides.cache ?? makeCache();
  const context = vm.createContext({
    JSON,
    cache,
    cookie: overrides.cookie ?? { getCookie() { return ''; }, removeCookie() {} },
    decodeURIComponent,
    encodeURIComponent,
    java: overrides.java ?? makeJava(),
    source: overrides.source ?? { getKey() { return 'https://www.qidian.com/#wsl-premium-aggregate-novel'; } },
  });
  for (const file of files) {
    const code = await readFile(path.join(runtimeRoot, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return { api: context.WSLPA, cache, context };
}

test('协议登记只包含结构化证据，夹具只包含合成值', async () => {
  const registry = await jsonFile(path.join(sourceRoot, 'protocol', 'observed-api.json'));
  assert.equal(registry.version, 1);
  assert.deepEqual(registry.secureHosts, [
    'https://v10.czyl.cf',
    'https://v4.czyl.cf',
    'https://v2.czyl.cf',
    'https://api.langge.cf',
    'https://20.langge.tk',
  ]);
  assert.equal(registry.endpoints.content.method, 'POST');
  assert.deepEqual(registry.endpoints.content.bodyFields, [
    'html', 'item_id', 'source', 'tab', 'tone_id', 'variable', 'version',
  ]);
  assert.equal(registry.endpoints.reviewList.path, '/para_review');

  const files = await readdir(fixtureRoot);
  assert.deepEqual(files.sort(), [
    'auth.json', 'bookshelf.json', 'catalog.json', 'content-audio.json',
    'content-image.json', 'content-novel.json', 'content-video.json',
    'detail.json', 'discover-list.json', 'discover-style.json', 'review.json',
    'search.json',
  ]);
  for (const file of files) {
    const text = await readFile(path.join(fixtureRoot, file), 'utf8');
    assert.doesNotMatch(text, /Bearer\s|Set-Cookie|qttoken|sessionid/i, file);
    assert.doesNotMatch(text, /斗破苍穹|萧炎|langge\.cf\/video\/cached/i, file);
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL with `ENOENT` for `protocol/observed-api.json`.

- [ ] **Step 3: Add the exact observed protocol registry**

Create `book-sources/wsl-premium-aggregate/protocol/observed-api.json` with:

```json
{
  "version": 1,
  "secureHosts": [
    "https://v10.czyl.cf",
    "https://v4.czyl.cf",
    "https://v2.czyl.cf",
    "https://api.langge.cf",
    "https://20.langge.tk"
  ],
  "insecureHost": "http://219.154.201.122:5006",
  "excludedHosts": ["https://legado.langge.cf", "https://sy.langge.cf"],
  "endpoints": {
    "search": {"method": "GET", "path": "/search", "queryFields": ["title", "tab", "source", "page", "disabled_sources"], "evidence": "anonymous-success"},
    "detail": {"method": "GET", "path": "/detail", "queryFields": ["book_id", "source", "tab", "variable"], "evidence": "anonymous-success"},
    "catalog": {"method": "GET", "path": "/catalog", "queryFields": ["book_id", "source", "tab", "variable"], "evidence": "anonymous-success"},
    "content": {"method": "POST", "path": "/content", "contentType": "application/json; charset=utf-8", "bodyFields": ["html", "item_id", "source", "tab", "tone_id", "variable", "version"], "responseFields": ["code", "msg", "time", "cache", "title", "content", "contents"], "evidence": "anonymous-success-all-media"},
    "discoverStyle": {"method": "GET", "path": "/discovestyle", "queryFields": ["source", "source_type", "tab"], "evidence": "anonymous-success"},
    "discoverList": {"method": "GET", "path": "/get_discover", "queryFields": ["source", "tab", "page"], "evidence": "anonymous-success"},
    "loginPage": {"method": "GET", "path": "/login", "evidence": "html-success"},
    "registerPage": {"method": "GET", "path": "/register", "evidence": "html-success"},
    "avatar": {"method": "GET", "path": "/get_avatar", "evidence": "request-key-capture-required"},
    "bookshelfCheck": {"method": "POST", "path": "/check_book_in_book_shelf", "requiredFields": ["EMAIL", "BookId"], "evidence": "request-encoding-capture-required"},
    "bookshelfAdd": {"method": "POST", "path": "/add_book_to_book_shelf", "requiredFields": ["EMAIL", "BookName", "BookId", "Source", "Tab"], "evidence": "request-encoding-capture-required"},
    "bookshelfUpdate": {"method": "POST", "path": "/update_book_shelf", "requiredFields": ["ID", "EMAIL"], "evidence": "progress-fields-capture-required"},
    "bookshelfList": {"method": "GET", "path": "/get_book_shelf", "evidence": "anonymous-error-observed"},
    "reviewList": {"method": "GET", "path": "/para_review", "queryFields": ["book_id", "item_id", "source", "tab", "cursor"], "evidence": "anonymous-success"},
    "reviewPost": {"method": "POST", "path": "/post_idea_review", "evidence": "server-disabled-observed"},
    "onlineVideo": {"method": "GET", "path": "/online_video", "queryFields": ["book_id", "source", "tab"], "evidence": "html-success"}
  }
}
```

- [ ] **Step 4: Add synthetic response fixtures**

Create the listed files under `book-sources/wsl-premium-aggregate/protocol/fixtures/` with these exact contents:

```json
// search.json
{"code":0,"msg":"ok","data":[{"book_name":"SYNTHETIC_BOOK","book_id":"BOOK_ID","author":"SYNTHETIC_AUTHOR","score":"9.0","status":"连载中","word_number":"100万字","last_chapter_update_time":"2026-08-04","last_chapter_title":"第10章","category":"玄幻","tags":"热血,成长","abstract":"SYNTHETIC_INTRO","thumb_url":"https://media.invalid/cover.jpg","tab":"小说","source":"SYNTHETIC_SOURCE","book_url":"","toc_url":""}]}
// detail.json
{"code":0,"msg":"","data":{"book_name":"SYNTHETIC_BOOK","book_id":"BOOK_ID","author":"SYNTHETIC_AUTHOR","score":"9.0","status":"连载中","word_number":"100万字","last_chapter_update_time":"2026-08-04","last_chapter_title":"第10章","category":"玄幻","tags":"热血,成长","abstract":"SYNTHETIC_INTRO","thumb_url":"https://media.invalid/cover.jpg","tab":"小说","source":"SYNTHETIC_SOURCE"}}
// catalog.json
{"code":0,"msg":"","data":[{"title":"第一卷","item_id":"VOLUME_ID","first_pass_time":"","chapter_word_number":"","source":"SYNTHETIC_SOURCE","tab":"小说","url":"","is_pay":false,"is_volume":true,"toc_url":""},{"title":"第1章","item_id":"ITEM_ID","first_pass_time":"2026-08-04","chapter_word_number":"2000","source":"SYNTHETIC_SOURCE","tab":"小说","url":"","is_pay":false,"is_volume":false,"toc_url":""}]}
// discover-style.json
{"code":0,"msg":"","data":[{"title":"排行榜","url":"","style":{"layout_flexGrow":1,"layout_flexBasisPercent":1}},{"title":"推荐榜","url":"https://v10.czyl.cf/get_discover?source=SYNTHETIC_SOURCE&tab=小说&bdtype=推荐榜&page={{page}}","style":{"layout_flexGrow":1,"layout_flexBasisPercent":0.25}},{"title":"--","url":"","style":{"layout_flexGrow":1,"layout_flexBasisPercent":0.25}}]}
// discover-list.json
{"code":0,"msg":"","data":[{"book_name":"SYNTHETIC_DISCOVER_BOOK","book_id":"DISCOVER_BOOK_ID","author":"SYNTHETIC_AUTHOR","status":"已完结","category":"都市","tags":"日常","abstract":"SYNTHETIC_DISCOVER_INTRO","thumb_url":"https://media.invalid/discover.jpg","tab":"小说","source":"SYNTHETIC_SOURCE"}]}
// content-novel.json
{"code":0,"msg":"","title":"第1章","content":"<p>SYNTHETIC_PARAGRAPH_ONE</p>\n<p>SYNTHETIC_PARAGRAPH_TWO</p>\n\n您当前未登录，今日已访问 1/3 次\n\nSYNTHETIC_SERVICE_NOTICE","contents":null}
// content-audio.json
{"code":0,"msg":"","title":"第1集","content":"https://media.invalid/audio.mp3","contents":null}
// content-image.json
{"code":0,"msg":"","title":"第1话","content":"<img src=\"https://media.invalid/page-1.jpg\" width=\"800\" height=\"1200\" />\n<img src=\"https://media.invalid/page-2.jpg\" />","contents":null}
// content-video.json
{"code":0,"msg":"","title":"第1集","content":"https://media.invalid/video.mp4","contents":null}
// auth.json
{"code":0,"msg":"ok","data":{"email":"reader@example.invalid","avatar":"https://media.invalid/avatar.jpg","nickname":"SYNTHETIC_USER"}}
// bookshelf.json
{"check":{"code":0,"msg":"ok","data":{"exists":true,"id":"SHELF_ID"}},"add":{"code":0,"msg":"ok","data":{"id":"SHELF_ID"}},"update":{"code":0,"msg":"ok","data":null}}
// review.json
{"code":0,"msg":"ok","data":{"comments":[{"comment_id":"COMMENT_ID","content":"SYNTHETIC_REVIEW","image_url":"https://media.invalid/review.jpg","like_count":3,"reply_count":1,"create_time":"2026-08-04","user":{"user_id":"USER_ID","user_name":"SYNTHETIC_READER","user_avatar":"https://media.invalid/avatar.jpg"}}],"total":1,"has_more":false,"next_cursor":"0"}}
```

The `// filename` lines above are separators in the plan; do not put them inside JSON files.

- [ ] **Step 5: Add the HAR structure sanitizer**

Create `book-sources/wsl-premium-aggregate/protocol/capture.mjs` with:

```javascript
/**
 * Author: WSL
 * 从 HAR 中只保留协议形状；所有身份、正文、评论和媒体值都替换为类型标记。
 */

import { readFile, writeFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!args.input || !args.output) throw new Error('usage: capture.mjs --input INPUT.har --output OUTPUT.json');

const allowedHosts = new Set([
  'v10.czyl.cf', 'v4.czyl.cf', 'v2.czyl.cf', 'api.langge.cf',
  '20.langge.tk', '219.154.201.122',
]);
const secretName = /cookie|authorization|token|password|secret|session|nonce|sign|email/i;
const contentName = /content|html|comment|review|avatar|image|audio|video|url/i;

function marker(value, key = '') {
  if (secretName.test(key)) return '<redacted>';
  if (contentName.test(key)) return '<content-redacted>';
  if (Array.isArray(value)) return value.slice(0, 1).map((item) => marker(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, marker(value[name], name)]));
  }
  if (typeof value === 'string') return '<string>';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
}

function parseBody(text, mimeType) {
  if (!text) return { fields: [], shape: null };
  try {
    const value = JSON.parse(text);
    return { fields: Object.keys(value).sort(), shape: marker(value) };
  } catch {}
  if (mimeType.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    return { fields: [...new Set(params.keys())].sort(), shape: null };
  }
  return { fields: [], shape: '<opaque-body-redacted>' };
}

const har = JSON.parse(await readFile(args.input, 'utf8'));
const entries = [];
for (const entry of har.log?.entries ?? []) {
  const url = new URL(entry.request.url);
  if (!allowedHosts.has(url.hostname)) continue;
  const requestBody = parseBody(entry.request.postData?.text ?? '', entry.request.postData?.mimeType ?? '');
  let responseShape = '<non-json-response-redacted>';
  try { responseShape = marker(JSON.parse(entry.response.content?.text ?? '')); } catch {}
  entries.push({
    host: url.host,
    method: entry.request.method,
    path: url.pathname,
    queryFields: [...new Set(url.searchParams.keys())].sort(),
    requestHeaders: entry.request.headers.map((header) => header.name).filter((name) => !secretName.test(name)).sort(),
    requestBodyFields: requestBody.fields,
    requestBodyShape: requestBody.shape,
    responseStatus: entry.response.status,
    responseShape,
  });
}

await writeFile(args.output, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
console.log(`sanitized ${entries.length} entries -> ${args.output}`);
```

- [ ] **Step 6: Run the protocol tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/protocol book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "test: define aggregate source protocol contracts"
```

Expected: the test ends with `fail 0`; the commit contains only the registry, sanitizer, fixtures and test file.

### Task 2: Implement shared configuration and state URLs

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/config.js`
- Create: `book-sources/wsl-premium-aggregate/runtime/state.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing config and state tests**

Append:

```javascript
test('四个主键映射到正确媒体，共享配置不保存身份字段', async () => {
  for (const [suffix, media] of Object.entries({ novel: '小说', audio: '听书', image: '漫画', video: '短剧' })) {
    const source = { getKey() { return `https://www.qidian.com/#wsl-premium-aggregate-${suffix}`; } };
    const loaded = await loadRuntime(['config.js'], { source });
    assert.equal(loaded.api.config.media(loaded.context), media);
  }
  const loaded = await loadRuntime(['config.js']);
  assert.throws(() => loaded.api.config.write(loaded.context, { token: 'SECRET' }), /不支持的配置字段/);
  assert.equal(loaded.api.config.write(loaded.context, { syncBookshelf: true }).syncBookshelf, true);
  assert.equal(loaded.api.config.read(loaded.context).syncBookshelf, true);
});

test('状态 URL 往返并拒绝敏感键、超长值和未知版本', async () => {
  const { api, context } = await loadRuntime(['config.js', 'state.js']);
  const state = { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' };
  const url = api.state.toDataUri(context, state);
  assert.match(url, /^data:application\/json;base64,/);
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.fromDataUri(context, url))), state);
  assert.throws(() => api.state.toDataUri(context, { ...state, token: 'SECRET' }), /敏感字段/);
  assert.throws(() => api.state.toDataUri(context, { ...state, v: 2 }), /状态版本/);
  assert.throws(() => api.state.toDataUri(context, { ...state, title: 'x'.repeat(9000) }), /状态过长/);
});

test('大型接口响应通过短内存键传递，不进入 data URL 或持久缓存', async () => {
  const { api, cache, context } = await loadRuntime(['config.js', 'state.js']);
  const response = { code: 0, data: [{ name: 'SYNTHETIC_BOOK', intro: 'x'.repeat(20000) }] };
  const url = api.state.stash(context, response);
  assert.ok(url.length < 512);
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.readStashFromBody(context, Buffer.from(
    JSON.stringify(api.state.fromDataUri(context, url)), 'utf8'
  ).toString('hex')))), response);
  assert.equal([...cache.values.values()].some((value) => value.includes('SYNTHETIC_BOOK')), false);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="主键|状态 URL|大型接口响应" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/config.js` does not exist.

- [ ] **Step 3: Add shared configuration**

Create `book-sources/wsl-premium-aggregate/runtime/config.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var PREFIX = 'wsl_premium_aggregate:';
  var CONFIG_KEY = PREFIX + 'config';
  var DEFAULTS = {
    nodeMode: 'auto', fixedHost: '', channel: '男频',
    syncBookshelf: false, reviews: true, allowInsecure: false
  };
  var ALLOWED = {
    nodeMode: true, fixedHost: true, channel: true,
    syncBookshelf: true, reviews: true, allowInsecure: true
  };
  var SECURE_HOSTS = [
    'https://v10.czyl.cf', 'https://v4.czyl.cf', 'https://v2.czyl.cf',
    'https://api.langge.cf', 'https://20.langge.tk'
  ];
  var MEDIA = { novel: '小说', audio: '听书', image: '漫画', video: '短剧' };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function read(ctx) {
    var value = clone(DEFAULTS);
    var raw = ctx.cache.get(CONFIG_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(String(raw));
        Object.keys(ALLOWED).forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(saved, key)) value[key] = saved[key];
        });
      } catch (error) {
        ctx.cache.delete(CONFIG_KEY);
      }
    }
    return value;
  }
  function validate(value) {
    if (['auto', 'fixed'].indexOf(value.nodeMode) < 0) throw new Error('节点策略无效');
    if (['男频', '女频'].indexOf(value.channel) < 0) throw new Error('发现频道无效');
    if (value.nodeMode === 'fixed' && !value.fixedHost) throw new Error('固定节点不能为空');
    if (value.fixedHost && SECURE_HOSTS.indexOf(value.fixedHost) < 0) throw new Error('固定节点无效');
    return value;
  }
  function write(ctx, patch) {
    Object.keys(patch).forEach(function (key) {
      if (!ALLOWED[key]) throw new Error('不支持的配置字段: ' + key);
    });
    var value = read(ctx);
    Object.keys(patch).forEach(function (key) { value[key] = patch[key]; });
    validate(value);
    ctx.cache.put(CONFIG_KEY, JSON.stringify(value));
    return value;
  }
  function media(ctx) {
    var key = String(ctx.source.getKey());
    var suffix = key.substring(key.lastIndexOf('-') + 1);
    if (!MEDIA[suffix]) throw new Error('书源媒体主键无效: ' + key);
    return MEDIA[suffix];
  }
  function hosts(ctx) {
    var config = read(ctx);
    var values = SECURE_HOSTS.slice();
    if (config.allowInsecure) values.push('http://219.154.201.122:5006');
    if (config.nodeMode === 'fixed') return [config.fixedHost];
    return values;
  }

  api.ctx = function (javaValue, sourceValue, cacheValue, cookieValue) {
    return { java: javaValue, source: sourceValue, cache: cacheValue, cookie: cookieValue };
  };
  api.config = {
    prefix: PREFIX,
    secureHosts: SECURE_HOSTS.slice(),
    hosts: hosts,
    media: media,
    read: read,
    write: write
  };
})(WSLPA);
```

- [ ] **Step 4: Add versioned state encoding**

Create `book-sources/wsl-premium-aggregate/runtime/state.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var PREFIX = 'data:application/json;base64,';
  var STASH_PREFIX = 'wsl-response:';
  var stashes = api.responseStashes || {};
  var sequence = Number(api.responseSequence || 0);
  api.responseStashes = stashes;
  var SENSITIVE = /cookie|token|password|authorization|session|secret/i;

  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('状态必须是对象');
    if (value.v !== 1) throw new Error('状态版本无效');
    if (['book', 'chapter', 'discover', 'response'].indexOf(value.kind) < 0) throw new Error('状态类型无效');
    if (value.kind === 'book' || value.kind === 'chapter') {
      if (!value.bookId || !value.source || ['小说', '听书', '漫画', '短剧'].indexOf(value.tab) < 0) {
        throw new Error('书籍状态字段无效');
      }
    }
    if (value.kind === 'chapter' && !value.itemId) throw new Error('章节状态字段无效');
    if (value.kind === 'discover' && value.path !== '/get_discover') throw new Error('发现状态字段无效');
    if (value.kind === 'response' && String(value.cacheKey || '').indexOf(STASH_PREFIX) !== 0) {
      throw new Error('响应缓存状态无效');
    }
    (function walk(node) {
      Object.keys(node).forEach(function (key) {
        if (SENSITIVE.test(key)) throw new Error('状态包含敏感字段: ' + key);
        if (node[key] && typeof node[key] === 'object') walk(node[key]);
      });
    })(value);
    var json = JSON.stringify(value);
    if (json.length > 8192) throw new Error('状态过长');
    return json;
  }
  function toDataUri(ctx, value) { return PREFIX + ctx.java.base64Encode(validate(value)); }
  function fromDataUri(ctx, url) {
    var text = String(url);
    var marker = text.indexOf(';base64,');
    if (marker < 0) throw new Error('状态 URL 格式无效');
    var payload = text.substring(marker + 8).split('?')[0];
    var value = JSON.parse(ctx.java.base64Decode(payload));
    validate(value);
    return value;
  }
  function fromBody(ctx, body) {
    var text = String(body || '').trim();
    if (/^[0-9a-f]+$/i.test(text) && text.length % 2 === 0) text = ctx.java.hexDecodeToString(text);
    var value = JSON.parse(text);
    validate(value);
    return value;
  }
  function stash(ctx, value) {
    sequence += 1;
    if (sequence > 1000000) sequence = 1;
    api.responseSequence = sequence;
    var cacheKey = STASH_PREFIX + Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.floor(Math.random() * 1679616).toString(36);
    var keys = Object.keys(stashes);
    if (keys.length >= 32) delete stashes[keys[0]];
    // 重要逻辑：大型响应只放在共享 Rhino 作用域的有界内存中，不写入持久 cache 或 data URL。
    stashes[cacheKey] = value;
    return toDataUri(ctx, { v: 1, kind: 'response', cacheKey: cacheKey });
  }
  function readStashFromBody(ctx, body) {
    var state = fromBody(ctx, body);
    if (state.kind !== 'response' || String(state.cacheKey).indexOf(STASH_PREFIX) !== 0) {
      throw new Error('响应缓存状态无效');
    }
    var value = stashes[state.cacheKey];
    if (value === undefined) throw new Error('响应内存已失效，请重新加载');
    return value;
  }

  api.state = {
    fromBody: fromBody,
    fromDataUri: fromDataUri,
    toDataUri: toDataUri,
    stash: stash,
    readStashFromBody: readStashFromBody
  };
})(WSLPA);
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
node --test --test-name-pattern="主键|状态 URL|大型接口响应" book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/config.js book-sources/wsl-premium-aggregate/runtime/state.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: add aggregate source state and config"
```

Expected: focused tests end with `fail 0`; commit contains the two runtime modules and test changes.

### Task 3: Implement transport semantics and node failover

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/transport.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing transport tests**

Append:

```javascript
function response(status, body) {
  return { body() { return body; }, code() { return status; } };
}

test('只读传输在 5xx 后切换并粘住成功节点', async () => {
  const calls = [];
  const java = makeJava((spec) => {
    calls.push(String(spec));
    if (calls.length === 1) return response(503, '{"code":-1,"msg":"down"}');
    return response(200, '{"code":0,"msg":"ok","data":[1]}');
  });
  const { api, cache, context } = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java });
  const result = api.transport.read(context, '/search', { title: 'SYNTHETIC' });
  assert.equal(result.ok, true);
  assert.equal(result.host, 'https://v4.czyl.cf');
  assert.equal(calls.length, 2);
  assert.equal(cache.get('wsl_premium_aggregate:active_host'), 'https://v4.czyl.cf');
  const secondResult = api.transport.read(context, '/detail', { book_id: 'BOOK_ID' });
  assert.equal(secondResult.host, 'https://v4.czyl.cf');
  assert.equal(calls.length, 3);
  assert.match(calls[2], /^https:\/\/v4\.czyl\.cf\/detail/);
});

test('业务错误不切换，写操作在传输不确定时不重放', async () => {
  let calls = 0;
  const businessJava = makeJava(() => {
    calls += 1;
    return response(200, '{"code":-1,"msg":"今日次数已达上限","data":null}');
  });
  const first = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java: businessJava });
  const result = first.api.transport.read(first.context, '/content', {});
  assert.equal(result.business, true);
  assert.equal(calls, 1);

  calls = 0;
  const failedJava = makeJava(() => { calls += 1; throw new Error('timeout'); });
  const second = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java: failedJava });
  assert.throws(() => second.api.transport.write(second.context, '/update_book_shelf', { ID: 'SHELF_ID' }), /timeout/);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="传输|业务错误" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/transport.js` does not exist.

- [ ] **Step 3: Add the transport module**

Create `book-sources/wsl-premium-aggregate/runtime/transport.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var ACTIVE_KEY = api.config.prefix + 'active_host';
  var HEALTH_KEY = api.config.prefix + 'host_health';
  var COOLDOWN_MS = 10 * 60 * 1000;

  function queryString(query) {
    return Object.keys(query || {}).filter(function (key) {
      return query[key] !== undefined && query[key] !== null;
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key]));
    }).join('&');
  }
  function health(ctx) {
    try { return JSON.parse(String(ctx.cache.get(HEALTH_KEY) || '{}')); } catch (error) { return {}; }
  }
  function saveHealth(ctx, value) { ctx.cache.put(HEALTH_KEY, JSON.stringify(value)); }
  function markFailure(ctx, host) {
    var value = health(ctx);
    value[host] = Date.now();
    saveHealth(ctx, value);
  }
  function candidates(ctx, mutating) {
    var hosts = api.config.hosts(ctx);
    var active = ctx.cache.get(ACTIVE_KEY);
    if (active && hosts.indexOf(String(active)) >= 0) {
      hosts.splice(hosts.indexOf(String(active)), 1);
      hosts.unshift(String(active));
    }
    var state = health(ctx);
    var now = Date.now();
    var available = hosts.filter(function (host) {
      return !state[host] || now - state[host] >= COOLDOWN_MS;
    });
    // 全部节点都在冷却时只探测首选节点一次，避免候选列表为空后永久失去恢复机会。
    hosts = available.length ? available : hosts.slice(0, 1);
    return mutating ? hosts.slice(0, 1) : hosts;
  }
  function parseEnvelope(host, status, text) {
    if (status >= 500) return { retryable: true, message: 'HTTP ' + status };
    var parsed;
    try { parsed = JSON.parse(String(text || '')); }
    catch (error) { return { retryable: true, message: '响应不是 JSON' }; }
    if (status >= 400 || Number(parsed.code) !== 0) {
      return {
        ok: false, business: true, code: parsed.code,
        message: String(parsed.msg || parsed.error || ('HTTP ' + status)),
        data: parsed.data, host: host, raw: parsed
      };
    }
    return { ok: true, business: false, code: 0, message: String(parsed.msg || ''), data: parsed.data, host: host, raw: parsed };
  }
  function request(ctx, method, path, query, body, mutating) {
    if (String(path).charAt(0) !== '/' || String(path).indexOf('://') >= 0) throw new Error('服务路径无效');
    var hosts = candidates(ctx, mutating);
    var lastError = null;
    for (var index = 0; index < hosts.length; index += 1) {
      var host = hosts[index];
      var qs = queryString(query);
      var url = host + path + (qs ? '?' + qs : '');
      var option = { method: method, retry: 0, headers: { Accept: 'application/json' } };
      if (body !== null && body !== undefined) {
        option.headers['Content-Type'] = 'application/json; charset=utf-8';
        option.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      try {
        var response = ctx.java.connect(url + ',' + JSON.stringify(option));
        var envelope = parseEnvelope(host, Number(response.code()), response.body());
        if (envelope.retryable) {
          markFailure(ctx, host);
          lastError = new Error(envelope.message);
          if (mutating) throw lastError;
          continue;
        }
        ctx.cache.put(ACTIVE_KEY, host);
        return envelope;
      } catch (error) {
        markFailure(ctx, host);
        lastError = error;
        // 重要逻辑：写请求响应不确定时立即停止，避免在备用节点重复添加或提交。
        if (mutating) throw error;
      }
    }
    throw lastError || new Error('没有可用服务节点');
  }
  function requireSuccess(ctx, envelope) {
    if (!envelope.ok) {
      ctx.java.longToast(envelope.message);
      throw new Error(envelope.message);
    }
    return envelope;
  }

  api.transport = {
    read: function (ctx, path, query) { return request(ctx, 'GET', path, query || {}, null, false); },
    postRead: function (ctx, path, query, body) { return request(ctx, 'POST', path, query || {}, body, false); },
    write: function (ctx, path, body) { return request(ctx, 'POST', path, {}, body, true); },
    requireSuccess: requireSuccess,
    currentHost: function (ctx) { return String(ctx.cache.get(ACTIVE_KEY) || api.config.hosts(ctx)[0]); },
    clearHealth: function (ctx) { ctx.cache.delete(ACTIVE_KEY); ctx.cache.delete(HEALTH_KEY); }
  };
})(WSLPA);
```

- [ ] **Step 4: Run all current tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/transport.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: add aggregate source failover transport"
```

Expected: tests end with `fail 0`; transport test proves two read attempts and one write attempt.

### Task 4: Implement search, detail, and catalog mapping

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/search.js`
- Create: `book-sources/wsl-premium-aggregate/runtime/detail.js`
- Create: `book-sources/wsl-premium-aggregate/runtime/catalog.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing search/detail/catalog tests**

Append:

```javascript
function hexBody(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('hex');
}

test('搜索语法支持来源后缀和 @@ 转义，并保留同名不同来源', async () => {
  const raw = await fixture('search');
  raw.data.push({ ...raw.data[0], source: 'SECOND_SOURCE', book_id: 'SECOND_ID' });
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js']);
  loaded.api.transport.read = () => ({ ok: true, raw });

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.search.parse('A@@B@SOURCE_X'))), {
    title: 'A@B', upstream: 'SOURCE_X',
  });
  const responseUrl = loaded.api.search.url(loaded.context, 'A@@B@SOURCE_X', 2);
  const books = loaded.api.search.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl)));
  assert.equal(books.length, 2);
  assert.notEqual(books[0].bookUrl, books[1].bookUrl);
  assert.equal(loaded.api.state.fromDataUri(loaded.context, books[0].bookUrl).bookId, 'BOOK_ID');
  assert.throws(() => loaded.api.search.parse('   '), /关键词为空/);
});

test('详情用搜索种子回退空字段并生成同一书籍状态的目录 URL', async () => {
  const raw = await fixture('detail');
  raw.data.author = '';
  raw.data.thumb_url = '';
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'detail.js']);
  loaded.api.transport.read = () => ({ ok: true, raw });
  const state = {
    v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说',
    variable: '{"custom":""}', seed: { author: 'SEED_AUTHOR', coverUrl: 'https://media.invalid/seed.jpg' },
  };
  const detail = JSON.parse(loaded.api.detail.load(loaded.context, hexBody(state)));
  assert.equal(detail.author, 'SEED_AUTHOR');
  assert.equal(detail.coverUrl, 'https://media.invalid/seed.jpg');
  assert.equal(loaded.api.state.fromDataUri(loaded.context, detail.tocUrl).bookId, 'BOOK_ID');
});

test('目录保持服务端顺序并映射卷、VIP 与章节状态', async () => {
  const raw = await fixture('catalog');
  raw.data[1].is_pay = true;
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'catalog.js']);
  loaded.api.transport.read = () => ({ ok: true, raw });
  const state = { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说', variable: '{"custom":""}' };
  const chapters = loaded.api.catalog.list(loaded.context, hexBody(state));
  assert.deepEqual(chapters.map((item) => item.title), ['第一卷', '第1章']);
  assert.equal(chapters[0].isVolume, true);
  assert.equal(chapters[1].isVip, true);
  assert.equal(loaded.api.state.fromDataUri(loaded.context, chapters[1].chapterUrl).itemId, 'ITEM_ID');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="搜索语法|详情用|目录保持" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL with `ENOENT` for `runtime/search.js`.

- [ ] **Step 3: Add the shared search mapper**

Create `book-sources/wsl-premium-aggregate/runtime/search.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function parse(keyword) {
    var sentinel = '\u0000';
    var text = clean(keyword).replace(/@@/g, sentinel);
    var index = text.lastIndexOf('@');
    var title = index > 0 ? text.substring(0, index) : text;
    var upstream = index > 0 ? text.substring(index + 1) : '';
    title = title.split(sentinel).join('@').trim();
    upstream = upstream.split(sentinel).join('@').trim();
    if (!title) throw new Error('搜索关键词为空');
    return { title: title, upstream: upstream };
  }
  function kinds(item) {
    var values = [item.category, item.tags, item.status, item.source].map(clean).filter(function (value) { return !!value; });
    return values.join(',');
  }
  function bookState(ctx, item) {
    var tab = clean(item.tab) || api.config.media(ctx);
    var state = {
      v: 1, kind: 'book', bookId: clean(item.book_id), source: clean(item.source), tab: tab,
      variable: clean(item.variable) || '{"custom":""}',
      seed: {
        name: clean(item.book_name), author: clean(item.author), intro: clean(item.abstract),
        coverUrl: clean(item.thumb_url), kind: kinds(item), wordCount: clean(item.word_number),
        lastChapter: clean(item.last_chapter_title), updateTime: clean(item.last_chapter_update_time)
      }
    };
    if (!state.bookId || !state.source) throw new Error('搜索结果缺少 book_id 或 source');
    return state;
  }
  function mapItem(ctx, item) {
    var seed = bookState(ctx, item).seed;
    return {
      name: seed.name, author: seed.author, intro: seed.intro, coverUrl: seed.coverUrl,
      kind: seed.kind, wordCount: seed.wordCount, lastChapter: seed.lastChapter,
      updateTime: seed.updateTime, bookUrl: api.state.toDataUri(ctx, bookState(ctx, item))
    };
  }
  function url(ctx, keyword, page) {
    var query = parse(keyword);
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/search', {
      title: query.title, tab: api.config.media(ctx), source: query.upstream,
      page: Number(page || 1), disabled_sources: '0'
    }));
    return api.state.stash(ctx, envelope.raw);
  }
  function response(ctx, body) { return api.state.readStashFromBody(ctx, body); }
  function list(ctx, body) {
    var raw = response(ctx, body);
    if (!Array.isArray(raw.data)) throw new Error('搜索响应 data 不是数组');
    return raw.data.map(function (item) { return mapItem(ctx, item); });
  }
  function hasMore(ctx, body) {
    var raw = response(ctx, body);
    if (typeof raw.has_more === 'boolean') return raw.has_more;
    return Array.isArray(raw.data) && raw.data.length > 0;
  }

  api.search = { parse: parse, mapItem: mapItem, url: url, list: list, hasMore: hasMore };
})(WSLPA);
```

- [ ] **Step 4: Add detail fallback mapping**

Create `book-sources/wsl-premium-aggregate/runtime/detail.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function first(value, fallback) { return clean(value) || clean(fallback); }
  function kinds(item, seed) {
    var value = [item.category, item.tags, item.status, item.source].map(clean).filter(function (entry) { return !!entry; }).join(',');
    return value || clean(seed.kind);
  }
  function load(ctx, body) {
    var state = api.state.fromBody(ctx, body);
    if (state.kind !== 'book') throw new Error('详情状态类型无效');
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/detail', {
      book_id: state.bookId, source: state.source, tab: state.tab, variable: state.variable || '{"custom":""}'
    }));
    var item = envelope.data || {};
    var seed = state.seed || {};
    var mapped = {
      name: first(item.book_name, seed.name), author: first(item.author, seed.author),
      intro: first(item.abstract, seed.intro), coverUrl: first(item.thumb_url, seed.coverUrl),
      kind: kinds(item, seed), wordCount: first(item.word_number, seed.wordCount),
      lastChapter: first(item.last_chapter_title, seed.lastChapter),
      updateTime: first(item.last_chapter_update_time, seed.updateTime),
      tocUrl: api.state.toDataUri(ctx, state)
    };
    if (api.bookshelf) api.bookshelf.ensure(ctx, state, mapped);
    return JSON.stringify(mapped);
  }
  function field(result, name) {
    var value = typeof result === 'string' ? JSON.parse(result) : result;
    return value && value[name] !== undefined && value[name] !== null ? value[name] : '';
  }

  api.detail = { load: load, field: field };
})(WSLPA);
```

- [ ] **Step 5: Add catalog mapping**

Create `book-sources/wsl-premium-aggregate/runtime/catalog.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function list(ctx, body) {
    var book = api.state.fromBody(ctx, body);
    if (book.kind !== 'book') throw new Error('目录状态类型无效');
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/catalog', {
      book_id: book.bookId, source: book.source, tab: book.tab, variable: book.variable || '{"custom":""}'
    }));
    if (!Array.isArray(envelope.data)) throw new Error('目录响应 data 不是数组');
    return envelope.data.map(function (item, index) {
      var itemId = clean(item.item_id) || ('volume-' + index);
      var chapter = {
        v: 1, kind: 'chapter', bookId: book.bookId, itemId: itemId,
        source: clean(item.source) || book.source, tab: clean(item.tab) || book.tab,
        title: clean(item.title), url: clean(item.url), variable: book.variable || '{"custom":""}'
      };
      return {
        title: chapter.title, chapterUrl: api.state.toDataUri(ctx, chapter),
        updateTime: clean(item.first_pass_time), isVolume: item.is_volume === true,
        isVip: item.is_pay === true, isPay: item.is_pay === true
      };
    });
  }

  api.catalog = { list: list };
})(WSLPA);
```

- [ ] **Step 6: Run all tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/search.js book-sources/wsl-premium-aggregate/runtime/detail.js book-sources/wsl-premium-aggregate/runtime/catalog.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: map aggregate books and catalogs"
```

Expected: tests end with `fail 0`; the fixture title order is unchanged and both result states decode.

### Task 5: Implement dynamic discovery

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/explore.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing discovery tests**

Append:

```javascript
test('发现栏目丢弃占位项、改写节点 origin 并复用书籍映射', async () => {
  const style = await fixture('discover-style');
  const listing = await fixture('discover-list');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']);
  loaded.api.transport.read = (_ctx, pathName) => ({ ok: true, raw: pathName === '/discovestyle' ? style : listing });
  const kinds = JSON.parse(loaded.api.explore.kinds(loaded.context));
  assert.deepEqual(kinds.map((kind) => kind.title), ['排行榜', '推荐榜']);
  assert.equal(kinds[0].type, 'title');
  assert.equal(kinds[1].style.cols, 4);
  assert.doesNotMatch(kinds[1].url, /v10\.czyl\.cf/);

  const encodedState = JSON.parse(kinds[1].url.match(/cookie\),\s*("[^"]+")/)[1]);
  const discoverState = loaded.api.state.fromDataUri(loaded.context, encodedState);
  const responseUrl = loaded.api.explore.url(loaded.context, encodedState, 3);
  const books = loaded.api.explore.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl)));
  assert.equal(books[0].name, 'SYNTHETIC_DISCOVER_BOOK');
  assert.equal(loaded.api.state.fromDataUri(loaded.context, books[0].bookUrl).bookId, 'DISCOVER_BOOK_ID');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="发现栏目" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/explore.js` does not exist.

- [ ] **Step 3: Add discovery cleaning and path-only states**

Create `book-sources/wsl-premium-aggregate/runtime/explore.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function parseQuery(url) {
    var query = {};
    var text = clean(url);
    var start = text.indexOf('?');
    if (start < 0) return query;
    text.substring(start + 1).split('&').forEach(function (pair) {
      var index = pair.indexOf('=');
      var key = decodeURIComponent(index < 0 ? pair : pair.substring(0, index));
      var value = decodeURIComponent(index < 0 ? '' : pair.substring(index + 1));
      if (key && key !== 'page') query[key] = value;
    });
    return query;
  }
  function cols(style) {
    var width = Number(style && style.layout_flexBasisPercent);
    if (width >= 0.99) return 1;
    if (width >= 0.49) return 2;
    if (width >= 0.32) return 3;
    return 4;
  }
  function kinds(ctx) {
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/discovestyle', {
      source: '', source_type: api.config.read(ctx).channel, tab: api.config.media(ctx)
    }));
    if (!Array.isArray(envelope.data)) throw new Error('发现栏目 data 不是数组');
    var mapped = [];
    envelope.data.forEach(function (item) {
      var title = clean(item.title);
      if (!title || title === '--') return;
      if (!clean(item.url)) {
        mapped.push({ title: title, type: 'title', style: { cols: 1 } });
        return;
      }
      var state = { v: 1, kind: 'discover', path: '/get_discover', query: parseQuery(item.url) };
      // 重要逻辑：只保存路径参数，服务端返回的节点 origin 不进入发现链接，打开时仍走统一故障切换。
      var stateUrl = api.state.toDataUri(ctx, state);
      mapped.push({
        title: title, type: 'button',
        url: '@js:return WSLPA.explore.url(WSLPA.ctx(java, source, cache, cookie), ' + JSON.stringify(stateUrl) + ', page);',
        style: { cols: cols(item.style) }
      });
    });
    return JSON.stringify(mapped);
  }
  function url(ctx, encodedState, page) {
    var state = api.state.fromDataUri(ctx, encodedState);
    if (state.kind !== 'discover') throw new Error('发现栏目状态类型无效');
    var query = state.query || {};
    query.page = Number(page || 1);
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, state.path, query));
    return api.state.stash(ctx, envelope.raw);
  }
  function response(ctx, body) { return api.state.readStashFromBody(ctx, body); }
  function list(ctx, body) {
    var raw = response(ctx, body);
    if (!Array.isArray(raw.data)) throw new Error('发现列表 data 不是数组');
    return raw.data.map(function (item) { return api.search.mapItem(ctx, item); });
  }
  function hasMore(ctx, body) {
    var raw = response(ctx, body);
    if (typeof raw.has_more === 'boolean') return raw.has_more;
    return Array.isArray(raw.data) && raw.data.length > 0;
  }

  api.explore = { kinds: kinds, url: url, list: list, hasMore: hasMore };
})(WSLPA);
```

- [ ] **Step 4: Run all tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/explore.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: add dynamic aggregate discovery"
```

Expected: tests end with `fail 0`; no generated discovery URL contains a service hostname.

### Task 6: Implement the four native content adapters

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/content.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing content tests**

Append:

```javascript
test('正文适配器分别输出文本、音频 URL、图片 HTML 和视频 URL', async () => {
  const names = { 小说: 'content-novel', 听书: 'content-audio', 漫画: 'content-image', 短剧: 'content-video' };
  for (const [tab, name] of Object.entries(names)) {
    const raw = await fixture(name);
    const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'content.js']);
    loaded.api.transport.postRead = () => ({ ok: true, raw, data: raw.data });
    const chapter = {
      v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID',
      source: 'SYNTHETIC_SOURCE', tab, title: 'ITEM', variable: '{"custom":""}',
    };
    const output = loaded.api.content.load(loaded.context, hexBody(chapter));
    if (tab === '小说') {
      assert.match(output, /SYNTHETIC_PARAGRAPH_ONE/);
      assert.doesNotMatch(output, /今日已访问|SYNTHETIC_SERVICE_NOTICE/);
    } else if (tab === '听书') assert.equal(output, 'https://media.invalid/audio.mp3');
    else if (tab === '漫画') assert.deepEqual(output.match(/<img /g)?.length, 2);
    else assert.equal(output, 'https://media.invalid/video.mp4');
  }
});

test('正文业务错误原样抛出且不会尝试其他内容适配器', async () => {
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'content.js']);
  loaded.api.transport.postRead = () => ({ ok: false, business: true, message: '今日次数已达上限' });
  const chapter = { v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' };
  assert.throws(() => loaded.api.content.load(loaded.context, hexBody(chapter)), /今日次数已达上限/);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="正文适配器|正文业务错误" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/content.js` does not exist.

- [ ] **Step 3: Add strict media dispatch and sanitization**

Create `book-sources/wsl-premium-aggregate/runtime/content.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function assertHttp(url, label) {
    var value = clean(url);
    if (!/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(label + '地址无效');
    return value;
  }
  function novel(raw) {
    var value = clean(raw.content)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    // 重要逻辑：服务端在匿名正文尾部附加配额与推广说明，只截断已观察的固定配额标记。
    var markers = ['您当前未登录，今日已访问', '您今日已访问'];
    markers.forEach(function (marker) {
      var index = value.indexOf(marker);
      if (index >= 0) value = value.substring(0, index);
    });
    if (!value.trim()) throw new Error('小说正文为空');
    return value.trim();
  }
  function audio(raw) { return assertHttp(raw.content, '音频'); }
  function image(raw) {
    var html = clean(raw.content);
    var seen = {};
    var images = [];
    html.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (_, url) {
      var value = assertHttp(url, '漫画图片');
      if (!seen[value]) { seen[value] = true; images.push('<img src="' + value.replace(/"/g, '&quot;') + '">'); }
      return '';
    });
    if (!images.length) throw new Error('漫画图片为空');
    return images.join('\n');
  }
  function video(raw) {
    if (Array.isArray(raw.contents) && raw.contents.length) {
      var resolutions = raw.contents.map(function (item) {
        return { name: clean(item.name || item.title || item.quality), url: assertHttp(item.url, '视频') };
      });
      return JSON.stringify({ resolutions: resolutions, defaultIndex: 0, headers: raw.headers || {} });
    }
    return assertHttp(raw.content, '视频');
  }
  var adapters = { '小说': novel, '听书': audio, '漫画': image, '短剧': video };
  function load(ctx, body) {
    var chapter = api.state.fromBody(ctx, body);
    if (chapter.kind !== 'chapter') throw new Error('正文状态类型无效');
    var envelope = api.transport.postRead(ctx, '/content', {}, {
      html: '', item_id: chapter.itemId, source: chapter.source, tab: chapter.tab,
      tone_id: '4', variable: chapter.variable || '{"custom":""}', version: '4.11.5.1'
    });
    api.transport.requireSuccess(ctx, envelope);
    // 重要逻辑：由章节状态中的媒体类型唯一分派，避免音频或视频 URL 被文本清洗器破坏。
    var adapter = adapters[chapter.tab];
    if (!adapter) throw new Error('未支持的媒体类型: ' + chapter.tab);
    var output = adapter(envelope.raw);
    if (api.bookshelf) api.bookshelf.sync(ctx, chapter);
    return output;
  }

  api.content = { load: load };
})(WSLPA);
```

- [ ] **Step 4: Run all tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/content.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: adapt aggregate native media content"
```

Expected: tests end with `fail 0`; each fixture takes exactly one adapter path and the novel service footer is absent.

### Task 7: Add shared login controls and an evidence gate for account writes

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/auth.js`
- Modify: `book-sources/wsl-premium-aggregate/protocol/observed-api.json` only when a new sanitized capture proves additional fields
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing login-control tests**

Append:

```javascript
test('登录 UI 从共享配置生成，Cookie 状态不写入共享缓存', async () => {
  const cache = makeCache();
  const opened = [];
  const removed = [];
  const java = {
    ...makeJava(),
    getCookie(host) { return String(host).includes('v10.czyl.cf') ? 'SESSION_COOKIE=<redacted>' : ''; },
    startBrowser(url, title) { opened.push([String(url), String(title)]); },
  };
  const cookie = { getCookie() { return ''; }, removeCookie(host) { removed.push(String(host)); } };
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'auth.js'], { cache, cookie, java });
  const ui = JSON.parse(loaded.api.auth.ui(loaded.context));
  assert.match(ui[0].name, /检测到登录 Cookie/);
  loaded.api.auth.toggle(loaded.context, 'syncBookshelf');
  assert.equal(loaded.api.config.read(loaded.context).syncBookshelf, true);
  loaded.api.auth.openLogin(loaded.context);
  assert.equal(opened[0][0], 'https://v10.czyl.cf/login');
  loaded.api.auth.logout(loaded.context);
  assert.equal(removed.length, 6);
  assert.doesNotMatch([...cache.values.values()].join('\n'), /SESSION_COOKIE|token|authorization/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="登录 UI" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/auth.js` does not exist.

- [ ] **Step 3: Add dynamic shared login controls**

Create `book-sources/wsl-premium-aggregate/runtime/auth.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var INSECURE_HOST = 'http://219.154.201.122:5006';
  var EMAIL_FIELD = '服务账号邮箱';
  function allHosts() { return api.config.secureHosts.concat([INSECURE_HOST]); }
  function sessionHost(ctx) {
    var hosts = allHosts();
    for (var index = 0; index < hosts.length; index += 1) {
      if (cleanCookie(ctx.java.getCookie(hosts[index]))) return hosts[index];
    }
    return '';
  }
  function cleanCookie(value) { return String(value || '').trim(); }
  function refresh(ctx) { ctx.java.refreshUi('login'); ctx.java.refreshUi('explore'); }
  function row(name, action, cols) {
    return { name: name, type: 'button', action: action, style: { cols: cols || 2 } };
  }
  function ui(ctx) {
    var config = api.config.read(ctx);
    var host = sessionHost(ctx);
    var values = [
      { name: host ? '状态：检测到登录 Cookie' : '状态：匿名', type: 'title', style: { cols: 1 } },
      { name: EMAIL_FIELD, type: 'text', style: { cols: 1 } },
      row('打开登录页面', 'WSLPA.auth.openLogin(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('检查登录状态', 'WSLPA.auth.check(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('退出全部节点', 'WSLPA.auth.logout(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('清除节点记录', 'WSLPA.auth.clearHealth(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('节点：' + (config.nodeMode === 'auto' ? '自动' : config.fixedHost), 'WSLPA.auth.cycleNode(WSLPA.ctx(java, source, cache, cookie));', 1),
      row('发现：' + config.channel, 'WSLPA.auth.toggleChannel(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('书架同步：' + (config.syncBookshelf ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'syncBookshelf');", 2),
      row('评论：' + (config.reviews ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'reviews');", 2),
      row('明文末级节点：' + (config.allowInsecure ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'allowInsecure');", 2),
      row('刷新发现栏目', "java.refreshUi('explore');", 1)
    ];
    return JSON.stringify(values);
  }
  function openLogin(ctx) {
    ctx.java.startBrowser(api.transport.currentHost(ctx) + '/login', 'WSL·精品聚合登录');
  }
  function check(ctx) {
    var host = sessionHost(ctx);
    ctx.java.longToast(host ? '已检测到当前节点的登录 Cookie' : '当前为匿名状态');
    refresh(ctx);
    return !!host;
  }
  function logout(ctx) {
    // 重要逻辑：只清理本书源声明的服务节点，避免影响用户在其他网站的登录 Cookie。
    allHosts().forEach(function (host) { ctx.cookie.removeCookie(host); });
    refresh(ctx);
  }
  function toggle(ctx, key) {
    var config = api.config.read(ctx);
    var patch = {};
    patch[key] = !config[key];
    api.config.write(ctx, patch);
    refresh(ctx);
  }
  function toggleChannel(ctx) {
    var config = api.config.read(ctx);
    api.config.write(ctx, { channel: config.channel === '男频' ? '女频' : '男频' });
    refresh(ctx);
  }
  function cycleNode(ctx) {
    var config = api.config.read(ctx);
    var hosts = api.config.secureHosts;
    if (config.nodeMode === 'auto') {
      api.config.write(ctx, { nodeMode: 'fixed', fixedHost: hosts[0] });
    } else {
      var next = hosts.indexOf(config.fixedHost) + 1;
      if (next >= hosts.length) api.config.write(ctx, { nodeMode: 'auto', fixedHost: '' });
      else api.config.write(ctx, { nodeMode: 'fixed', fixedHost: hosts[next] });
    }
    api.transport.clearHealth(ctx);
    refresh(ctx);
  }
  function clearHealth(ctx) { api.transport.clearHealth(ctx); refresh(ctx); }
  function email(ctx) {
    // 邮箱只从 Legado 自带的加密 loginInfo 读取，不复制到四书源共享的普通 cache。
    var info = ctx.source.getLoginInfoMap ? ctx.source.getLoginInfoMap() : null;
    var raw = info && typeof info.get === 'function' ? info.get(EMAIL_FIELD) : (info ? info[EMAIL_FIELD] : '');
    var value = raw ? String(raw).trim() : '';
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : '';
  }

  api.auth = {
    ui: ui, openLogin: openLogin, check: check, logout: logout, toggle: toggle,
    toggleChannel: toggleChannel, cycleNode: cycleNode, clearHealth: clearHealth,
    hasSession: function (ctx) { return !!sessionHost(ctx); },
    // /get_avatar 的请求密钥尚待账号态捕获；邮箱由用户在当前书源登录面板中保存到加密 loginInfo。
    email: email
  };
})(WSLPA);
```

- [ ] **Step 4: Run the login-control test and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="登录 UI" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: PASS; the cache dump contains settings and host state only.

- [ ] **Step 5: Capture account-request shapes when the user supplies the later manual login session**

Keep the raw capture outside the repository. In PowerShell:

```powershell
New-Item -ItemType Directory -Force 'G:\legado-capture' | Out-Null
mitmweb --listen-port 8081 --set hardump='G:\legado-capture\wsl-account.har'
```

In the original `7595` source running as an opaque client, perform exactly these actions once: check login status, check one book, add one synthetic test book only when the account permits it, and update that same test book once. Stop the proxy, then run:

```powershell
node book-sources/wsl-premium-aggregate/protocol/capture.mjs --input 'G:\legado-capture\wsl-account.har' --output 'G:\legado-capture\wsl-account.sanitized.json'
rg -n "cookie|authorization|token|password|session|@" 'G:\legado-capture\wsl-account.sanitized.json'
```

Expected: the sanitizer reports captured entries; the `rg` result contains only field names paired with `<redacted>`, never credential values. Compare the sanitized shapes with `observed-api.json`. Change an endpoint from `*-capture-required` to `authenticated-request-recognized` only when method, content type, request field names and a server-recognized business response all match. Do not add the raw or sanitized HAR to Git.

- [ ] **Step 6: Commit the login controls and any evidence-only registry update**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/auth.js book-sources/wsl-premium-aggregate/protocol/observed-api.json book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: add aggregate login and shared controls"
```

Expected: tests end with `fail 0`. If no account capture was supplied, `observed-api.json` remains unchanged and the commit contains only `auth.js` plus tests.

### Task 8: Implement evidence-gated bookshelf sync and observed review reads

**Files:**
- Create: `book-sources/wsl-premium-aggregate/runtime/bookshelf.js`
- Create: `book-sources/wsl-premium-aggregate/runtime/review.js`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing bookshelf and review tests**

Append:

```javascript
test('书架写入只有契约被识别后启用，进度按章节和十分钟节流', async () => {
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'auth.js', 'bookshelf.js']);
  loaded.api.config.write(loaded.context, { syncBookshelf: true });
  loaded.api.auth.email = () => 'reader@example.invalid';
  const writes = [];
  loaded.api.transport.postRead = () => ({ ok: true, data: { exists: false }, raw: { code: 0, data: { exists: false } } });
  loaded.api.transport.write = (_ctx, pathName, body) => {
    writes.push([pathName, body]);
    return { ok: true, data: pathName.includes('add_') ? { id: 'SHELF_ID' } : null, raw: { code: 0 } };
  };
  const book = { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' };
  assert.equal(loaded.api.bookshelf.ensure(loaded.context, book, { name: 'SYNTHETIC_BOOK' }), false);
  assert.equal(writes.length, 0);

  loaded.api.protocol = { endpoints: {
    bookshelfCheck: { evidence: 'authenticated-request-recognized', contentType: 'application/json', requiredFields: ['EMAIL', 'BookId'] },
    bookshelfAdd: { evidence: 'authenticated-request-recognized', contentType: 'application/json', requiredFields: ['EMAIL', 'BookName', 'BookId', 'Source', 'Tab'] },
    bookshelfUpdate: { evidence: 'authenticated-request-recognized', contentType: 'application/json', requiredFields: ['ID', 'EMAIL', 'BookId', 'ItemId', 'Title'] },
  } };
  assert.equal(loaded.api.bookshelf.ensure(loaded.context, book, { name: 'SYNTHETIC_BOOK' }), true);
  const chapter = { v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说', title: '第1章' };
  assert.equal(loaded.api.bookshelf.sync(loaded.context, chapter), true);
  assert.equal(loaded.api.bookshelf.sync(loaded.context, chapter), false);
  assert.deepEqual(writes.map(([pathName]) => pathName), ['/add_book_to_book_shelf', '/update_book_shelf']);
});

test('评论读取映射用户、图片、计数和游标，不配置已关闭的写规则', async () => {
  const raw = await fixture('review');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'review.js']);
  loaded.api.transport.read = () => ({ ok: true, raw, data: raw.data });
  const bookUrl = loaded.api.state.toDataUri(loaded.context, { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' });
  const chapterUrl = loaded.api.state.toDataUri(loaded.context, { v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' });
  const responseUrl = loaded.api.review.url(loaded.context, { bookUrl }, { url: chapterUrl }, 0, 1);
  const body = hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl));
  const comments = loaded.api.review.list(loaded.context, body);
  assert.equal(comments[0].reviewId, 'COMMENT_ID');
  assert.equal(comments[0].name, 'SYNTHETIC_READER');
  assert.equal(comments[0].images[0], 'https://media.invalid/review.jpg');
  assert.equal(loaded.api.review.total(loaded.context, body), 1);
  assert.equal(loaded.api.review.hasMore(loaded.context, body), false);
  assert.equal(loaded.api.review.reply, undefined);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="书架写入|评论读取" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL because `runtime/bookshelf.js` does not exist.

- [ ] **Step 3: Add evidence-gated bookshelf behavior**

Create `book-sources/wsl-premium-aggregate/runtime/bookshelf.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var THROTTLE_KEY = api.config.prefix + 'sync_throttle';
  var THROTTLE_MS = 10 * 60 * 1000;
  var shelfIds = api.shelfIds || {};
  api.shelfIds = shelfIds;
  function endpoint(name) { return api.protocol && api.protocol.endpoints ? api.protocol.endpoints[name] : null; }
  function ready(name) {
    var value = endpoint(name);
    return !!value && value.evidence === 'authenticated-request-recognized' && value.contentType === 'application/json';
  }
  function bodyFor(name, values) {
    var contract = endpoint(name);
    var body = {};
    (contract.requiredFields || []).forEach(function (field) {
      if (values[field] === undefined || values[field] === null || values[field] === '') throw new Error('书架字段缺失: ' + field);
      body[field] = values[field];
    });
    return body;
  }
  function shelfKey(book) { return book.source + ':' + book.bookId; }
  function ensure(ctx, book, mapped) {
    if (!api.config.read(ctx).syncBookshelf || !ready('bookshelfCheck') || !ready('bookshelfAdd')) return false;
    var email = api.auth && api.auth.email ? api.auth.email(ctx) : '';
    if (!email) return false;
    try {
      var values = { EMAIL: email, BookName: mapped.name, BookId: book.bookId, Source: book.source, Tab: book.tab };
      var checked = api.transport.requireSuccess(ctx, api.transport.postRead(ctx, '/check_book_in_book_shelf', {}, bodyFor('bookshelfCheck', values)));
      if (checked.data && checked.data.exists) {
        if (checked.data.id) shelfIds[shelfKey(book)] = String(checked.data.id);
        return true;
      }
      // 重要逻辑：添加属于非幂等写操作，交给 transport.write 单节点执行，网络结果不确定时不重放。
      var added = api.transport.requireSuccess(ctx, api.transport.write(ctx, '/add_book_to_book_shelf', bodyFor('bookshelfAdd', values)));
      if (added.data && added.data.id) shelfIds[shelfKey(book)] = String(added.data.id);
      return true;
    } catch (error) {
      ctx.java.toast('书架同步：' + error.message);
      return false;
    }
  }
  function sync(ctx, chapter) {
    if (!api.config.read(ctx).syncBookshelf || !ready('bookshelfUpdate')) return false;
    var email = api.auth && api.auth.email ? api.auth.email(ctx) : '';
    var id = shelfIds[shelfKey(chapter)];
    if (!email || !id) return false;
    var throttle = {};
    try { throttle = JSON.parse(String(ctx.cache.get(THROTTLE_KEY) || '{}')); } catch (error) { throttle = {}; }
    var throttleKey = chapter.source + ':' + chapter.bookId;
    var previous = throttle[throttleKey] || {};
    var now = Date.now();
    if (previous.time && (previous.itemId === chapter.itemId || now - Number(previous.time) < THROTTLE_MS)) return false;
    try {
      var values = {
        ID: String(id), EMAIL: email, BookId: chapter.bookId,
        ItemId: chapter.itemId, Title: chapter.title || ''
      };
      // 重要逻辑：先完成单次写请求再记录节流状态；超时不在备用节点重复提交。
      api.transport.requireSuccess(ctx, api.transport.write(ctx, '/update_book_shelf', bodyFor('bookshelfUpdate', values)));
      throttle[throttleKey] = { itemId: chapter.itemId, time: now };
      ctx.cache.put(THROTTLE_KEY, JSON.stringify(throttle));
      return true;
    } catch (error) {
      ctx.java.toast('进度同步：' + error.message);
      return false;
    }
  }

  api.bookshelf = { ensure: ensure, sync: sync };
})(WSLPA);
```

- [ ] **Step 4: Add review-list mapping**

Create `book-sources/wsl-premium-aggregate/runtime/review.js` with:

```javascript
/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var cursors = api.reviewCursors || {};
  api.reviewCursors = cursors;
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function objectUrl(value, property, getter) {
    if (!value) return '';
    if (value[property]) return String(value[property]);
    if (typeof value[getter] === 'function') return String(value[getter]());
    return '';
  }
  function requestState(ctx, book, chapter) {
    var chapterUrl = objectUrl(chapter, 'url', 'getUrl');
    if (chapterUrl) return api.state.fromDataUri(ctx, chapterUrl);
    return api.state.fromDataUri(ctx, objectUrl(book, 'bookUrl', 'getBookUrl'));
  }
  function cursorKey(state, page) {
    return state.source + ':' + state.bookId + ':' + clean(state.itemId) + ':' + page;
  }
  function emptyResponse() {
    return { code: 0, msg: '', data: { comments: [], total: 0, has_more: false, next_cursor: '' } };
  }
  function url(ctx, book, chapter, paragraphIndex, page) {
    if (!api.config.read(ctx).reviews) return api.state.stash(ctx, emptyResponse());
    var state = requestState(ctx, book, chapter);
    var pageNumber = Number(page || 1);
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/para_review', {
      book_id: state.bookId, item_id: clean(state.itemId), source: state.source,
      tab: state.tab, cursor: clean(cursors[cursorKey(state, pageNumber)])
    }));
    if (envelope.data && envelope.data.next_cursor) {
      cursors[cursorKey(state, pageNumber + 1)] = String(envelope.data.next_cursor);
    }
    return api.state.stash(ctx, envelope.raw);
  }
  function response(ctx, body) { return api.state.readStashFromBody(ctx, body); }
  function list(ctx, body) {
    var raw = response(ctx, body);
    var comments = raw.data && Array.isArray(raw.data.comments) ? raw.data.comments : [];
    return comments.map(function (item) {
      var user = item.user || {};
      var images = item.image_url ? (Array.isArray(item.image_url) ? item.image_url : [item.image_url]) : [];
      return {
        reviewId: clean(item.comment_id), avatar: clean(user.user_avatar), name: clean(user.user_name),
        content: clean(item.content), postTime: clean(item.create_time), images: images,
        voteUpCount: Number(item.like_count || 0), replyCount: Number(item.reply_count || 0),
        extra: user.is_author ? '作者' : (user.is_vip ? 'VIP' : '')
      };
    });
  }
  function total(ctx, body) { var raw = response(ctx, body); return Number(raw.data && raw.data.total || 0); }
  function hasMore(ctx, body) { var raw = response(ctx, body); return !!(raw.data && raw.data.has_more); }

  // 服务端已明确关闭 /post_idea_review，因此这里只暴露读取映射，不生成发表、点赞或删除规则。
  api.review = { url: url, list: list, total: total, hasMore: hasMore };
})(WSLPA);
```

- [ ] **Step 5: Run all tests and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/runtime/bookshelf.js book-sources/wsl-premium-aggregate/runtime/review.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: add aggregate bookshelf and reviews"
```

Expected: tests end with `fail 0`; the first account attempt under pending evidence makes zero requests, and the second progress call is throttled.

### Task 9: Build the four importable BookSource objects deterministically

**Files:**
- Create: `book-sources/wsl-premium-aggregate/source.template.json`
- Create: `book-sources/wsl-premium-aggregate/build.mjs`
- Create: `book-sources/wsl-premium-aggregate.json`
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: Append failing build and static-contract tests**

Add these imports near the top of the test file:

```javascript
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
```

Add after the path constants:

```javascript
const execFileAsync = promisify(execFile);
const buildFile = path.join(sourceRoot, 'build.mjs');
```

Append:

```javascript
test('构建器生成四个唯一原生媒体书源且连续构建字节一致', async () => {
  await execFileAsync(process.execPath, [buildFile]);
  const first = await readFile(outputFile);
  await execFileAsync(process.execPath, [buildFile]);
  const second = await readFile(outputFile);
  assert.equal(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(second).digest('hex'));

  const sources = JSON.parse(second.toString('utf8'));
  assert.equal(sources.length, 4);
  assert.deepEqual(sources.map((item) => item.bookSourceType), [0, 1, 2, 4]);
  assert.equal(new Set(sources.map((item) => item.bookSourceUrl)).size, 4);
  assert.ok(sources.every((item) => item.bookSourceGroup === 'WSL·精品聚合'));
  assert.ok(sources.every((item) => item.enabledCookieJar && !item.enableDangerousApi));
  assert.ok(sources.every((item) => item.jsLib.includes('Author: WSL')));
  assert.ok(sources.every((item) => item.ruleReview.voteUpRule === undefined));
  assert.doesNotMatch(second.toString('utf8'), /SESSION_COOKIE|reader@example\.invalid|SYNTHETIC_PARAGRAPH/i);

  const shared = vm.createContext({ JSON, decodeURIComponent, encodeURIComponent });
  vm.runInContext(sources[0].jsLib, shared, { filename: 'generated-jsLib.js' });
  const runtimeContext = shared.WSLPA.ctx(
    makeJava(), { getKey() { return sources[0].bookSourceUrl; }, getLoginInfoMap() { return null; } },
    makeCache(), { removeCookie() {} },
  );
  assert.equal(shared.WSLPA.config.media(runtimeContext), '小说');
  const stateUrl = shared.WSLPA.state.toDataUri(runtimeContext, {
    v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说',
  });
  assert.equal(shared.WSLPA.state.fromDataUri(runtimeContext, stateUrl).bookId, 'BOOK_ID');
});

test('所有新增脚本署名 WSL，Rhino 运行时不含现代语法', async () => {
  const scriptFiles = [
    path.join(sourceRoot, 'build.mjs'), path.join(sourceRoot, 'protocol', 'capture.mjs'),
    ...(await readdir(runtimeRoot)).filter((name) => name.endsWith('.js')).map((name) => path.join(runtimeRoot, name)),
  ];
  for (const file of scriptFiles) {
    const text = await readFile(file, 'utf8');
    assert.match(text.slice(0, 240), /Author:\s*WSL/, file);
    if (file.endsWith('.js')) {
      assert.doesNotMatch(text, /\?\.|\?\?|=>|\bconst\b|\blet\b|`/, file);
    }
  }
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="构建器生成|新增脚本署名" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL with `ENOENT` for `build.mjs`.

- [ ] **Step 3: Add the exact structured source template**

Create `book-sources/wsl-premium-aggregate/source.template.json` with:

```json
{
  "common": {
    "bookSourceComment": "独立实现的多媒体聚合书源，依赖示例书源当前使用的第三方服务器。账号态写接口仅在脱敏协议登记为已识别后启用。",
    "bookSourceGroup": "WSL·精品聚合",
    "enabled": true,
    "enabledExplore": true,
    "enabledReview": true,
    "enabledCookieJar": true,
    "enableDangerousApi": false,
    "concurrentRate": "1/1000",
    "header": "{\"User-Agent\":\"Mozilla/5.0 (Linux; Android 13; Legado WSL Source) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36\",\"Accept\":\"application/json,text/html;q=0.9,*/*;q=0.8\"}",
    "loginUi": "@js:return WSLPA.auth.ui(WSLPA.ctx(java, source, cache, cookie));",
    "loginCheckJs": null,
    "respondTime": 180000,
    "weight": 0,
    "lastUpdateTime": 1785772800000,
    "variableComment": "在登录面板统一设置节点、发现频道、书架同步、评论和明文末级节点。",
    "exploreUrl": "@js:return WSLPA.explore.kinds(WSLPA.ctx(java, source, cache, cookie));",
    "searchUrl": "@js:return WSLPA.search.url(WSLPA.ctx(java, source, cache, cookie), key, page);",
    "ruleSearch": {
      "checkKeyWord": "剑来",
      "hasMoreRule": "WSLPA.search.hasMore(WSLPA.ctx(java, source, cache, cookie), result);",
      "bookList": "<js>WSLPA.search.list(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "name": "<js>result.name;</js>",
      "author": "<js>result.author;</js>",
      "intro": "<js>result.intro;</js>",
      "kind": "<js>result.kind;</js>",
      "lastChapter": "<js>result.lastChapter;</js>",
      "updateTime": "<js>result.updateTime;</js>",
      "bookUrl": "<js>result.bookUrl;</js>",
      "coverUrl": "<js>result.coverUrl;</js>",
      "wordCount": "<js>result.wordCount;</js>"
    },
    "ruleExplore": {
      "hasMoreRule": "WSLPA.explore.hasMore(WSLPA.ctx(java, source, cache, cookie), result);",
      "bookList": "<js>WSLPA.explore.list(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "name": "<js>result.name;</js>",
      "author": "<js>result.author;</js>",
      "intro": "<js>result.intro;</js>",
      "kind": "<js>result.kind;</js>",
      "lastChapter": "<js>result.lastChapter;</js>",
      "updateTime": "<js>result.updateTime;</js>",
      "bookUrl": "<js>result.bookUrl;</js>",
      "coverUrl": "<js>result.coverUrl;</js>",
      "wordCount": "<js>result.wordCount;</js>"
    },
    "ruleBookInfo": {
      "init": "<js>WSLPA.detail.load(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "name": "<js>WSLPA.detail.field(result, 'name');</js>",
      "author": "<js>WSLPA.detail.field(result, 'author');</js>",
      "intro": "<js>WSLPA.detail.field(result, 'intro');</js>",
      "kind": "<js>WSLPA.detail.field(result, 'kind');</js>",
      "lastChapter": "<js>WSLPA.detail.field(result, 'lastChapter');</js>",
      "updateTime": "<js>WSLPA.detail.field(result, 'updateTime');</js>",
      "coverUrl": "<js>WSLPA.detail.field(result, 'coverUrl');</js>",
      "tocUrl": "<js>WSLPA.detail.field(result, 'tocUrl');</js>",
      "wordCount": "<js>WSLPA.detail.field(result, 'wordCount');</js>"
    },
    "ruleToc": {
      "chapterList": "<js>WSLPA.catalog.list(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "chapterName": "<js>result.title;</js>",
      "chapterUrl": "<js>result.chapterUrl;</js>",
      "isVolume": "<js>result.isVolume;</js>",
      "isVip": "<js>result.isVip;</js>",
      "isPay": "<js>result.isPay;</js>",
      "updateTime": "<js>result.updateTime;</js>"
    },
    "ruleContent": {
      "content": "<js>WSLPA.content.load(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "imageStyle": "FULL"
    },
    "ruleReview": {
      "reviewUrl": "@js:return WSLPA.review.url(WSLPA.ctx(java, source, cache, cookie), book, chapter, paragraphIndex, page);",
      "reviewList": "<js>WSLPA.review.list(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "reviewIdRule": "<js>result.reviewId;</js>",
      "avatarRule": "<js>result.avatar;</js>",
      "nameRule": "<js>result.name;</js>",
      "contentRule": "<js>result.content;</js>",
      "postTimeRule": "<js>result.postTime;</js>",
      "extraRule": "<js>result.extra;</js>",
      "imagesRule": "<js>result.images;</js>",
      "voteUpCountRule": "<js>result.voteUpCount;</js>",
      "replyCountRule": "<js>result.replyCount;</js>",
      "totalCountRule": "<js>WSLPA.review.total(WSLPA.ctx(java, source, cache, cookie), result);</js>",
      "hasMoreRule": "<js>WSLPA.review.hasMore(WSLPA.ctx(java, source, cache, cookie), result);</js>"
    }
  },
  "variants": [
    {"bookSourceName":"WSL·精品聚合·小说","bookSourceType":0,"bookSourceUrl":"https://www.qidian.com/#wsl-premium-aggregate-novel","customOrder":0,"exploreStyle":0},
    {"bookSourceName":"WSL·精品聚合·听书","bookSourceType":1,"bookSourceUrl":"https://www.qidian.com/#wsl-premium-aggregate-audio","customOrder":1,"exploreStyle":0},
    {"bookSourceName":"WSL·精品聚合·漫画","bookSourceType":2,"bookSourceUrl":"https://www.qidian.com/#wsl-premium-aggregate-image","customOrder":2,"exploreStyle":3},
    {"bookSourceName":"WSL·精品聚合·短剧","bookSourceType":4,"bookSourceUrl":"https://www.qidian.com/#wsl-premium-aggregate-video","customOrder":3,"exploreStyle":18}
  ]
}
```

- [ ] **Step 4: Add the deterministic builder**

Create `book-sources/wsl-premium-aggregate/build.mjs` with:

```javascript
/**
 * Author: WSL
 * 把可测试的 ES5 模块和协议登记合并为四个自包含 Legado 书源。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '..', 'wsl-premium-aggregate.json');
const modules = [
  'config.js', 'state.js', 'transport.js', 'search.js', 'detail.js', 'catalog.js',
  'content.js', 'auth.js', 'explore.js', 'review.js', 'bookshelf.js',
];

const template = JSON.parse(await readFile(path.join(root, 'source.template.json'), 'utf8'));
const protocol = JSON.parse(await readFile(path.join(root, 'protocol', 'observed-api.json'), 'utf8'));
if (protocol.version !== 1) throw new Error('observed-api.json 版本无效');
if (!Array.isArray(template.variants) || template.variants.length !== 4) throw new Error('模板必须包含四个媒体变体');

const parts = [
  '/** Author: WSL */\nvar WSLPA = typeof WSLPA === \'object\' && WSLPA ? WSLPA : {};\nWSLPA.protocol = ' + JSON.stringify(protocol) + ';',
];
for (const name of modules) {
  const code = (await readFile(path.join(root, 'runtime', name), 'utf8')).replace(/\r\n/g, '\n').trim();
  if (!/^\/\*\*[\s\S]{0,180}Author:\s*WSL/.test(code)) throw new Error(name + ' 缺少 Author: WSL');
  parts.push(code);
}
const jsLib = parts.join('\n\n') + '\n';

const sources = template.variants.map((variant) => ({
  ...JSON.parse(JSON.stringify(template.common)),
  ...variant,
  jsLib,
}));
const keys = new Set(sources.map((item) => item.bookSourceUrl));
if (keys.size !== 4) throw new Error('书源主键必须唯一');
if (JSON.stringify(sources.map((item) => item.bookSourceType)) !== '[0,1,2,4]') throw new Error('媒体类型顺序无效');
if (sources.some((item) => item.enableDangerousApi !== false)) throw new Error('危险 API 必须关闭');

await writeFile(output, `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
console.log(`built ${sources.length} sources -> ${output}`);
```

- [ ] **Step 5: Build, inspect the generated objects, and verify GREEN**

Run:

```powershell
node book-sources/wsl-premium-aggregate/build.mjs
node --test --test-name-pattern="构建器生成|新增脚本署名" book-sources/tests/wsl-premium-aggregate.test.mjs
Get-FileHash book-sources/wsl-premium-aggregate.json -Algorithm SHA256
```

Expected: builder reports `built 4 sources`; focused tests pass; one SHA-256 hash is printed.

- [ ] **Step 6: Run the full suite and commit**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git add book-sources/wsl-premium-aggregate/source.template.json book-sources/wsl-premium-aggregate/build.mjs book-sources/wsl-premium-aggregate.json book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "feat: build WSL premium aggregate sources"
```

Expected: tests end with `fail 0`; the commit contains the template, builder, generated array and tests.

### Task 10: Add anonymous live-chain coverage and operator documentation

**Files:**
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs`
- Modify: `book-sources/README.md`

- [ ] **Step 1: Append the opt-in anonymous live test**

Append before the final static build tests or at the end of the test file:

```javascript
async function liveJson(url, options) {
  const response = await fetch(url, options);
  assert.ok(response.ok, `${new URL(url).pathname} HTTP ${response.status}`);
  return response.json();
}

test('匿名实时链路覆盖搜索、详情、目录、发现和一次正文请求', {
  skip: process.env.WSL_LIVE !== '1',
}, async (t) => {
  const media = process.env.WSL_LIVE_MEDIA || '小说';
  assert.ok(['小说', '听书', '漫画', '短剧'].includes(media), 'WSL_LIVE_MEDIA 必须是四种媒体之一');
  const host = process.env.WSL_LIVE_HOST || 'https://v10.czyl.cf';
  const query = (values) => new URLSearchParams(values).toString();

  const styles = await liveJson(`${host}/discovestyle?${query({ source: '', source_type: '男频', tab: media })}`);
  assert.equal(Number(styles.code), 0);
  const kind = (styles.data || []).find((item) => typeof item.url === 'string' && item.url.includes('/get_discover'));
  assert.ok(kind, '未找到可点击发现栏目');
  const discoverUrl = new URL(kind.url, host);
  discoverUrl.host = new URL(host).host;
  discoverUrl.protocol = new URL(host).protocol;
  discoverUrl.searchParams.set('page', '1');
  const discover = await liveJson(discoverUrl.toString());
  assert.equal(Number(discover.code), 0);
  assert.ok(Array.isArray(discover.data) && discover.data.length > 0);
  const discoveredBook = discover.data.find((item) => item.book_name && item.book_id && item.source);
  assert.ok(discoveredBook, '发现列表没有可串联验证的书籍');

  // 重要逻辑：实时测试从当次发现结果取关键词，不依赖会随时间变化的固定书名或排行榜名次。
  const keyword = process.env.WSL_LIVE_KEYWORD || String(discoveredBook.book_name);
  const search = await liveJson(`${host}/search?${query({ title: keyword, tab: media, source: '', page: '1', disabled_sources: '0' })}`);
  assert.equal(Number(search.code), 0);
  assert.ok(Array.isArray(search.data) && search.data.length > 0);
  const book = search.data.find((item) => item.book_id && item.source) || search.data[0];
  assert.ok(book.book_id && book.source);

  const common = { book_id: String(book.book_id), source: String(book.source), tab: media, variable: '{"custom":""}' };
  const detail = await liveJson(`${host}/detail?${query(common)}`);
  assert.equal(Number(detail.code), 0);
  assert.ok(detail.data && typeof detail.data === 'object');

  const catalog = await liveJson(`${host}/catalog?${query(common)}`);
  assert.equal(Number(catalog.code), 0);
  assert.ok(Array.isArray(catalog.data) && catalog.data.length > 0);

  const chapter = catalog.data.find((item) => !item.is_volume && item.item_id);
  assert.ok(chapter, '目录没有可请求的章节或集');
  const content = await liveJson(`${host}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify({
      html: '', item_id: String(chapter.item_id), source: String(chapter.source || book.source),
      tab: String(chapter.tab || media), tone_id: '4', variable: '{"custom":""}', version: '4.11.5.1',
    }),
  });
  if (Number(content.code) === 0) {
    assert.ok(typeof content.content === 'string' && content.content.length > 0);
  } else {
    assert.ok(typeof content.msg === 'string' && content.msg.length > 0);
    t.diagnostic('正文服务可达，返回业务状态；未打印正文或媒体地址');
  }
});
```

- [ ] **Step 2: Run the offline suite first**

Run:

```powershell
Remove-Item Env:WSL_LIVE -ErrorAction SilentlyContinue
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: all offline tests pass; exactly one live test is reported skipped.

- [ ] **Step 3: Run one live chain for each native media type**

Run each command separately so a failure is attributable to one media type:

```powershell
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='小说'; node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='听书'; node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='漫画'; node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='短剧'; node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs
Remove-Item Env:WSL_LIVE,Env:WSL_LIVE_MEDIA -ErrorAction SilentlyContinue
```

Expected for each run: search, detail, catalog and discovery assertions pass. Content either succeeds with a non-empty unprinted value or reports a non-empty business message through the diagnostic path.

- [ ] **Step 4: Append the operator-facing README section**

Append this section to `book-sources/README.md`, preserving the existing Qidian section:

```markdown
## WSL·精品聚合

书源文件：`wsl-premium-aggregate.json`

该文件一次导入四个书源：小说、听书、漫画和短剧。它们共用 `WSL·精品聚合` 分组、服务器节点设置和节点健康状态，并分别进入 Legado 的文本、音频、漫画和视频原生界面。

### 导入

1. 在 Legado 3.x 打开“我的” -> “书源管理”。
2. 选择右上角菜单中的“本地导入”。
3. 选择 `wsl-premium-aggregate.json`。
4. 确认列表中出现 `WSL·精品聚合·小说`、`听书`、`漫画`、`短剧` 四项。

### 能力与状态

- 搜索语法：`书名` 搜索全部上游；`书名@来源` 固定上游；书名内的 `@` 写成 `@@`。
- 已自动验证：搜索、详情、目录、发现、四种正文夹具、节点故障切换、状态 URL、评论读取映射和确定性构建。
- 登录：登录面板会在当前服务节点打开 `/login`；Cookie 由 Legado 按服务域名管理，普通共享缓存不保存账号信息。
- 书架写入：默认关闭。需要在准备启用同步的每个媒体书源登录面板填写“服务账号邮箱”并点右上角保存；该值进入 Legado 自带的加密 `loginInfo`，不进入普通共享缓存。只有脱敏协议登记确认请求方法、内容类型和字段后才会发出添加或进度写请求；不确定写响应不会在备用节点重放。
- 评论写入：服务器当前明确关闭 `/post_idea_review`，生成书源只配置评论读取规则。
- 账号态状态：实现完成，登录、书架和账号态正文仍按下方清单在用户的 Legado 环境中人工实测。

### 服务器依赖

默认节点是 `v10.czyl.cf`、`v4.czyl.cf`、`v2.czyl.cf`、`api.langge.cf` 和 `20.langge.tk`。这些节点属于示例书源当前依赖的第三方服务，可能停机、换域名、改协议或限制匿名次数。明文 IP 节点默认关闭，可在登录面板单独开启。

只读请求会在网络错误、TLS 错误、HTTP 5xx 或损坏信封后切换节点。HTTP 4xx、`code != 0`、登录提示和匿名配额属于业务状态，不触发节点轮换。

### 复现检查

```powershell
node book-sources/wsl-premium-aggregate/build.mjs
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='小说'; node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs
```

实时测试不会打印或保存正文、评论原文和媒体签名地址。正文请求会消耗服务端匿名次数，不要反复运行。

### Legado 人工验收

1. 一次导入出现四个书源，原有书源保持不变。
2. 四种搜索分别能打开详情、目录和对应原生阅读界面。
3. 发现页栏目可以刷新，栏目 URL 不固定到已失效节点。
4. 登录一次后检查四个来源的当前节点登录状态。
5. 登录状态下各验证一章小说、一集音频、一话漫画和一集短剧。
6. 开启书架同步后验证一次添加和一次进度更新，随后关闭以避免意外写入。
7. 验证书籍级和章节级评论读取；评论写入在服务器重新开放并取得新协议证据前保持未配置。
8. 切断当前节点后确认读请求切换；恢复网络后确认写操作没有重复。
```

- [ ] **Step 5: Run tests and commit the live test plus documentation**

Run:

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git diff --check
git add book-sources/tests/wsl-premium-aggregate.test.mjs book-sources/README.md
git commit -m "test: cover aggregate live chains"
```

Expected: offline tests end with `fail 0`, the live test is skipped, and `git diff --check` prints nothing.

### Task 11: Perform privacy, compatibility, import, and completion verification

**Files:**
- Modify only files proven necessary by a failing verification
- Do not create a commit when all checks pass unchanged

- [ ] **Step 1: Rebuild twice and prove deterministic output**

Run:

```powershell
node book-sources/wsl-premium-aggregate/build.mjs
$firstHash = (Get-FileHash 'book-sources\wsl-premium-aggregate.json' -Algorithm SHA256).Hash
node book-sources/wsl-premium-aggregate/build.mjs
$secondHash = (Get-FileHash 'book-sources\wsl-premium-aggregate.json' -Algorithm SHA256).Hash
if ($firstHash -ne $secondHash) { throw "构建结果不确定: $firstHash != $secondHash" }
$firstHash
```

Expected: one stable SHA-256 hash is printed.

- [ ] **Step 2: Run syntax, JSON, unit, privacy, and whitespace checks**

Run:

```powershell
Get-ChildItem 'book-sources\wsl-premium-aggregate\runtime\*.js' | ForEach-Object { node --check $_.FullName }
node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('book-sources/wsl-premium-aggregate.json','utf8'));if(x.length!==4)process.exit(1);console.log(x.map(s=>s.bookSourceName+'='+s.bookSourceType).join('\n'))"
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
rg -n "Bearer\s+[A-Za-z0-9._~-]+|Set-Cookie\s*:|SESSION_COOKIE=|qttoken|sessionid|SYNTHETIC_PARAGRAPH" book-sources/wsl-premium-aggregate.json book-sources/wsl-premium-aggregate/runtime book-sources/wsl-premium-aggregate/protocol/observed-api.json
git diff --check
```

Expected: all `node --check` commands exit 0; four `name=type` lines print; tests end with `fail 0`; the privacy scan and `git diff --check` print nothing.

- [ ] **Step 3: Inspect scope and run a code review**

Run:

```powershell
git status --short
git diff --stat dae1772..HEAD
git log --oneline --decorate -8
```

Confirm the implementation touches only `book-sources/`, the approved spec/plan, and their tests. Then invoke `superpowers:requesting-code-review` with focus on:

```text
Review the WSL premium aggregate BookSource implementation against docs/superpowers/specs/2026-08-04-wsl-premium-aggregate-book-source-design.md. Prioritize Rhino compatibility, data-URI hex handling, read/write retry boundaries, response-cache lifetime, privacy leakage, media-type output contracts, dynamic explore URLs, and unsupported account writes.
```

Expected: no unresolved P1/P2 findings. For each valid finding, add one reproducing test, make the smallest fix, rebuild, rerun Step 2, and commit with `fix: address aggregate source review`.

- [ ] **Step 4: Attempt Android/Legado import verification without overstating unavailable evidence**

Run:

```powershell
adb devices
```

If a device is listed as `device`, open Legado, import `book-sources/wsl-premium-aggregate.json`, and execute the eight README checks. Record only pass/fail state and endpoint paths; do not record account values, content, comments, screenshots containing identity, or media URLs. If no device is listed, retain the README status `账号态待实测` and report that exact remaining verification gap.

- [ ] **Step 5: Verify the final tree and prepare branch handoff**

Run:

```powershell
git status --short --branch
git log --oneline --decorate --max-count=10
```

Expected: the worktree is clean except for explicitly documented user changes, and the implementation commits appear after the approved design commit. Invoke `superpowers:verification-before-completion`, report the exact offline/live/device results, then invoke `superpowers:finishing-a-development-branch` to offer merge, PR, keep-branch, or cleanup choices. Do not push or merge without the user's selection.
