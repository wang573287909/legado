# WSL Premium Direct List Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `WSL·精品聚合` 的搜索和发现榜单返回真实 HTTPS 请求地址，并在独立 Rhino 作用域中直接解析宿主取得的原始 JSON，消除空列表后立即到底的问题。

**Architecture:** `transport.js` 新增纯 URL 构造器和宿主响应解析器；`search.js`、`explore.js` 只生成活动节点上的 HTTPS URL，不再把列表响应暂存到 `WSLPA.responseStashes`。详情、目录、正文和评论保持原有协议边界，构建器继续把 ES5 模块确定性合并到四个书源对象中。

**Tech Stack:** Legado 3.x 书源 JSON、Rhino 1.9.1 / JavaScript ES5、Node.js `node:test` 与 `vm`、PowerShell 7、Java 17、Git、GitHub、jsDelivr。

---

## 执行上下文与边界

- 工作树：`G:\legado\.worktrees\qidian-mobile-free`
- 分支：`codex/qidian-mobile-free`
- 远端：`https://github.com/wang573287909/legado.git`
- 已批准设计：`docs/superpowers/specs/2026-08-05-wsl-premium-direct-list-response-design.md`
- 设计提交：`288c6b793fe79536b2d52f516ff1e0b304f882ef`
- 修改前生成书源 SHA-256：`2b83b61ed489c1f181b7794b7f10f2566e3587a04445cae67786e570cc6ebe28`
- 新增脚本必须在文件头写 `Author: WSL`；重要执行边界必须带中文逻辑注释。
- 所有运行时 `.js` 保持 ES5：不使用箭头函数、模板字符串、`const`、`let`、可选链或空值合并。
- 评论仍使用现有有界响应暂存；本次只替换搜索和发现书单的跨作用域响应交接。
- 实时正文链路只执行一次，不打印或保存正文、评论原文和媒体签名地址。

## 文件职责图

| 路径 | 本次职责 |
|---|---|
| `book-sources/wsl-premium-aggregate/runtime/transport.js` | 校验内部路径、构造活动节点 HTTPS URL、校验宿主取得的列表 JSON |
| `book-sources/wsl-premium-aggregate/runtime/search.js` | 生成 `/search` URL，并从原始 JSON 映射搜索结果 |
| `book-sources/wsl-premium-aggregate/runtime/explore.js` | 保留动态栏目状态，生成 `/get_discover` URL，并从原始 JSON 映射榜单结果 |
| `book-sources/wsl-premium-aggregate/source.template.json` | 提升更新时间并把发现缓存标记从 `v2` 改为 `v3` |
| `book-sources/wsl-premium-aggregate.json` | 构建生成的四书源可导入制品 |
| `book-sources/tests/wsl-premium-aggregate.test.mjs` | URL、原始响应、独立运行时、缓存版本和构建回归测试 |
| `book-sources/README.md` | 说明列表直连与节点重试边界 |
| `build/wsl-premium-direct-list-response/*` | 忽略提交的原件、补丁、验证脚本、验证记录和回滚制品 |

## Task 1: 保存基线和执行位置

**Files:**
- Create: `build/wsl-premium-direct-list-response/original/wsl-premium-aggregate.json`
- Create: `build/wsl-premium-direct-list-response/baseline.sha256`
- Create: `build/wsl-premium-direct-list-response/baseline.commit`

- [ ] **Step 1: 确认工作树干净并记录当前提交**

Run:

```powershell
Set-Location 'G:\legado\.worktrees\qidian-mobile-free'
if (git status --porcelain) { throw '执行前工作树存在未提交修改' }
$artifactRoot = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response'
New-Item -ItemType Directory -Force -Path "$artifactRoot\original" | Out-Null
$baselineCommit = (git rev-parse HEAD).Trim()
$baselineCommit | Set-Content -Encoding utf8NoBOM "$artifactRoot\baseline.commit"
Write-Output "baseline_commit=$baselineCommit"
```

Expected: 输出当前计划提交的完整 SHA，`git status --porcelain` 没有内容。

- [ ] **Step 2: 保存生成书源原件和哈希**

Run:

```powershell
$source = 'G:\legado\.worktrees\qidian-mobile-free\book-sources\wsl-premium-aggregate.json'
$original = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response\original\wsl-premium-aggregate.json'
Copy-Item -LiteralPath $source -Destination $original -Force
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$originalHash = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $originalHash) { throw '原件复制后的 SHA-256 不一致' }
$sourceHash | Set-Content -Encoding ascii 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response\baseline.sha256'
Write-Output "baseline_sha256=$sourceHash"
```

Expected: `baseline_sha256=2b83b61ed489c1f181b7794b7f10f2566e3587a04445cae67786e570cc6ebe28`。

## Task 2: 为列表直连增加传输原语

**Files:**
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs:203-298`
- Modify: `book-sources/wsl-premium-aggregate/runtime/transport.js:8-14,157-211`

- [ ] **Step 1: 写出 URL 和原始响应的失败测试**

在 `response(status, body)` 辅助函数后加入：

```javascript
test('列表直连传输构造活动节点 URL 并校验宿主原始响应', async () => {
  const raw = await fixture('search');
  const cache = makeCache();
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');
  const { api, context } = await loadRuntime(['config.js', 'state.js', 'transport.js'], { cache });

  const direct = new URL(api.transport.url(context, '/search', {
    title: 'A B', source: '来源/一', page: 2, disabled_sources: '0', omitted: null,
  }));
  assert.equal(direct.origin, 'https://v4.czyl.cf');
  assert.equal(direct.pathname, '/search');
  assert.equal(direct.searchParams.get('title'), 'A B');
  assert.equal(direct.searchParams.get('source'), '来源/一');
  assert.equal(direct.searchParams.get('page'), '2');
  assert.equal(direct.searchParams.has('omitted'), false);
  assert.throws(() => api.transport.url(context, 'https://external.invalid/search', {}), /服务路径无效/);
  assert.throws(() => api.transport.url(context, '//external.invalid/search', {}), /服务路径无效/);

  const parsed = api.transport.parseRead(context, '/search', JSON.stringify(raw));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), raw);
  // 空 `data` 且 has_more=false 是合法到底页，不应与响应结构损坏混同。
  const empty = { code: 0, data: [], has_more: false };
  assert.deepEqual(JSON.parse(JSON.stringify(
    api.transport.parseRead(context, '/search', JSON.stringify(empty)),
  )), empty);
  assert.throws(() => api.transport.parseRead(context, '/search', '<html>bad</html>'), /响应不是 JSON/);
  assert.throws(() => api.transport.parseRead(context, '/search', '{"data":[]}'), /响应 code 无效/);
  // 端点校验继续拒绝与当前书源不一致的媒体类型。
  assert.throws(() => api.transport.parseRead(context, '/search', JSON.stringify({
    code: 0, data: [{ book_id: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '听书' }],
  })), /书籍列表字段无效/);
  assert.throws(() => api.transport.parseRead(context, '/search', JSON.stringify({
    code: -1, msg: 'SYNTHETIC_BUSINESS_ERROR', data: null,
  })), /SYNTHETIC_BUSINESS_ERROR/);
});
```

- [ ] **Step 2: 运行测试并确认失败原因**

Run:

```powershell
node --test --test-name-pattern="列表直连传输" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL，错误包含 `api.transport.url is not a function`。

- [ ] **Step 3: 实现内部路径、URL 构造和原始响应解析**

在 `queryString()` 后加入：

```javascript
  function servicePath(path) {
    var value = String(path || '');
    if (value.charAt(0) !== '/' || value.substring(0, 2) === '//' ||
        value.indexOf('://') >= 0 || value.indexOf('?') >= 0 || value.indexOf('#') >= 0 ||
        /[\r\n]/.test(value)) {
      throw new Error('服务路径无效');
    }
    return value;
  }
```

在 `requireSuccess()` 后加入：

```javascript
  function currentHost(ctx) {
    var hosts = api.config.hosts(ctx);
    var active = String(ctx.cache.get(ACTIVE_KEY) || '');
    if (active && hosts.indexOf(active) >= 0) return active;
    if (!hosts.length) throw new Error('没有可用服务节点');
    return String(hosts[0]);
  }
  function buildUrl(ctx, path, query) {
    var safePath = servicePath(path);
    var qs = queryString(query || {});
    // 重要逻辑：搜索与榜单只返回真实网络 URL，让 Legado 获取响应体，避免跨 Rhino 作用域传递内存键。
    return currentHost(ctx) + safePath + (qs ? '?' + qs : '');
  }
  function parseRead(ctx, path, body) {
    var safePath = servicePath(path);
    // 重要逻辑：列表规则只接收宿主在成功 HTTP 请求后提供的正文；连接和 HTTP 状态错误已由宿主网络层处理。
    var envelope = parseEnvelope(currentHost(ctx), 200, body);
    if (envelope.retryable) throw new Error(envelope.message);
    var invalid = envelope.ok ? schemaError(ctx, safePath, envelope) : '';
    if (invalid) throw new Error(invalid);
    return requireSuccess(ctx, envelope).raw;
  }
```

把 `request()` 的开头和 URL 拼接改为：

```javascript
  function request(ctx, method, path, query, body, mutating) {
    path = servicePath(path);
    var hosts = candidates(ctx, mutating);
```

```javascript
        var url = host + path + (qs ? '?' + qs : '');
```

把导出对象改为：

```javascript
  api.transport = {
    url: buildUrl,
    parseRead: parseRead,
    read: function (ctx, path, query) { return request(ctx, 'GET', path, query || {}, null, false); },
    postRead: function (ctx, path, query, body) { return request(ctx, 'POST', path, query || {}, body, false); },
    write: function (ctx, path, body) { return request(ctx, 'POST', path, {}, body, true); },
    requireSuccess: requireSuccess,
    currentHost: currentHost,
    clearHealth: function (ctx) { ctx.cache.delete(ACTIVE_KEY); ctx.cache.delete(HEALTH_KEY); }
  };
```

- [ ] **Step 4: 运行传输测试并确认通过**

Run:

```powershell
node --test --test-name-pattern="列表直连传输|只读传输|业务错误|HTTP 4xx|损坏信封|端点最低字段" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: 相关传输测试全部 PASS，其他测试因名称过滤被跳过。

- [ ] **Step 5: 提交传输原语**

Run:

```powershell
git diff --check
git add book-sources/wsl-premium-aggregate/runtime/transport.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "fix: add direct aggregate list transport"
```

Expected: 新提交只包含 `transport.js` 和聚合测试文件。

## Task 3: 搜索改为 HTTPS 直连并跨独立作用域解析

**Files:**
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs:360-375`
- Modify: `book-sources/wsl-premium-aggregate/runtime/search.js:42-59`

- [ ] **Step 1: 把搜索测试改为两个完全独立的运行时**

用以下测试替换现有“搜索语法支持来源后缀和 @@ 转义，并保留同名不同来源”测试：

```javascript
test('搜索返回 HTTPS 且独立运行时直接解析原始响应', async () => {
  const raw = await fixture('search');
  raw.data.push({ ...raw.data[0], source: 'SECOND_SOURCE', book_id: 'SECOND_ID' });
  const cache = makeCache();
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');
  const first = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js'], { cache });

  assert.deepEqual(JSON.parse(JSON.stringify(first.api.search.parse('A@@B@SOURCE_X'))), {
    title: 'A@B', upstream: 'SOURCE_X',
  });
  const searchUrl = first.api.search.url(first.context, 'A@@B@SOURCE_X', 2);
  const direct = new URL(searchUrl);
  assert.equal(direct.origin, 'https://v4.czyl.cf');
  assert.equal(direct.pathname, '/search');
  assert.equal(direct.searchParams.get('title'), 'A@B');
  assert.equal(direct.searchParams.get('source'), 'SOURCE_X');
  assert.equal(direct.searchParams.get('tab'), '小说');
  assert.equal(direct.searchParams.get('page'), '2');
  assert.equal(direct.searchParams.get('disabled_sources'), '0');
  assert.equal(Object.keys(first.api.responseStashes).length, 0);

  // 重要逻辑：第二个 vm 上下文模拟 SharedJsScope 被回收；这里只提供 HTTP 原始正文，不共享 WSLPA 内存。
  const second = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js'], { cache });
  const books = second.api.search.list(second.context, JSON.stringify(raw));
  assert.equal(books.length, 2);
  assert.notEqual(books[0].bookUrl, books[1].bookUrl);
  assert.equal(second.api.state.fromDataUri(second.context, books[0].bookUrl).bookId, 'BOOK_ID');
  assert.equal(second.api.search.hasMore(second.context, JSON.stringify(raw)), true);
  assert.equal(second.api.search.hasMore(second.context, JSON.stringify({ ...raw, has_more: false })), false);
  assert.equal(Object.keys(second.api.responseStashes).length, 0);
  assert.throws(() => second.api.search.parse('   '), /关键词为空/);
});
```

- [ ] **Step 2: 运行搜索测试并确认旧实现预取网络**

Run:

```powershell
node --test --test-name-pattern="搜索返回 HTTPS" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL，错误包含 `unexpected connect`，证明旧 `search.url()` 仍在 URL 阶段请求服务器。

- [ ] **Step 3: 用 transport URL 和 parseRead 替换响应暂存**

把 `search.js` 中的 `url()` 和 `response()` 替换为：

```javascript
  function url(ctx, keyword, page) {
    var query = parse(keyword);
    return api.transport.url(ctx, '/search', {
      title: query.title, tab: api.config.media(ctx), source: query.upstream,
      page: Number(page || 1), disabled_sources: '0'
    });
  }
  function response(ctx, body) {
    // 重要逻辑：列表正文来自 Legado 的实际 HTTPS 请求，不读取任何前一 Rhino 作用域中的响应暂存。
    return api.transport.parseRead(ctx, '/search', body);
  }
```

- [ ] **Step 4: 运行搜索和状态回归**

Run:

```powershell
node --test --test-name-pattern="搜索返回 HTTPS|书籍和章节状态|状态 URL" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: 三组测试全部 PASS；搜索结果 `bookUrl` 仍是带 `{"type":"wslpa"}` 的 typed data URL。

- [ ] **Step 5: 提交搜索修改**

Run:

```powershell
git diff --check
git add book-sources/wsl-premium-aggregate/runtime/search.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "fix: load aggregate search lists directly"
```

Expected: 新提交只包含 `search.js` 和聚合测试文件。

## Task 4: 发现榜单改为 HTTPS 直连并跨独立作用域解析

**Files:**
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs:406-441`
- Modify: `book-sources/wsl-premium-aggregate/runtime/explore.js:70-90`

- [ ] **Step 1: 把发现测试改为真实 URL 和独立运行时断言**

用以下测试替换现有“发现栏目丢弃占位项、改写节点 origin 并复用书籍映射”测试：

```javascript
test('发现栏目返回活动节点 HTTPS 并在独立运行时解析原始响应', async () => {
  const style = await fixture('discover-style');
  style.data[1].url = 'https://v10.czyl.cf/get_discover?source=A+B&tab=小说&page={{page}}';
  style.data.push({
    title: '错误路径', url: 'https://v10.czyl.cf/other?source=IGNORED',
    style: { layout_flexBasisPercent: 0.5 },
  });
  style.data.push({
    title: '畸形编码', url: 'https://v10.czyl.cf/get_discover?source=%ZZ',
    style: { layout_flexBasisPercent: 0.5 },
  });
  const listing = await fixture('discover-list');
  const cache = makeCache();
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');
  const first = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js'], { cache });
  first.api.transport.read = (_ctx, pathName) => ({
    ok: true,
    data: pathName === '/discovestyle' ? style.data : listing.data,
    raw: pathName === '/discovestyle' ? style : listing,
  });
  const kinds = JSON.parse(first.api.explore.kinds(first.context));
  assert.deepEqual(kinds.map((kind) => kind.title), ['排行榜', '推荐榜']);
  assert.equal(kinds[0].type, 'title');
  // 重要逻辑：普通发现分类省略 type 才会由宿主作为可点击链接打开；text 会被部分版本渲染为输入框。
  assert.equal(Object.hasOwn(kinds[1], 'type'), false);
  assert.equal(kinds[1].style.cols, 4);
  assert.doesNotMatch(kinds[1].url, /v10\.czyl\.cf/);

  const encodedState = JSON.parse(kinds[1].url.match(/cookie\),\s*("(?:\\.|[^"\\])*")\s*,\s*page/)[1]);
  const discoverState = first.api.state.fromDataUri(first.context, encodedState);
  assert.equal(discoverState.path, '/get_discover');
  assert.equal(discoverState.query.source, 'A B');
  const responseUrl = first.api.explore.url(first.context, encodedState, 3);
  const direct = new URL(responseUrl);
  assert.equal(direct.origin, 'https://v4.czyl.cf');
  assert.equal(direct.pathname, '/get_discover');
  assert.equal(direct.searchParams.get('source'), 'A B');
  assert.equal(direct.searchParams.get('page'), '3');
  assert.equal(Object.keys(first.api.responseStashes).length, 0);

  // 重要逻辑：榜单解析在新的 vm 上下文中只消费服务器 JSON，验证弱引用作用域重建不会丢书单。
  const second = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js'], { cache });
  const books = second.api.explore.list(second.context, JSON.stringify(listing));
  assert.equal(books[0].name, 'SYNTHETIC_DISCOVER_BOOK');
  assert.equal(second.api.state.fromDataUri(second.context, books[0].bookUrl).bookId, 'DISCOVER_BOOK_ID');
  assert.equal(second.api.explore.hasMore(second.context, JSON.stringify(listing)), true);
  assert.equal(second.api.explore.hasMore(second.context, JSON.stringify({ ...listing, has_more: false })), false);
  assert.equal(Object.keys(second.api.responseStashes).length, 0);
});
```

- [ ] **Step 2: 运行发现测试并确认旧实现返回 data URL**

Run:

```powershell
node --test --test-name-pattern="发现栏目返回活动节点 HTTPS" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL，HTTPS 协议断言显示旧实现返回 `data:`。

- [ ] **Step 3: 用 transport URL 和 parseRead 替换发现响应暂存**

把 `explore.js` 中的 `url()` 和 `response()` 替换为：

```javascript
  function url(ctx, encodedState, page) {
    var state = api.state.fromDataUri(ctx, encodedState);
    if (state.kind !== 'discover') throw new Error('发现栏目状态类型无效');
    var query = state.query || {};
    query.page = Number(page || 1);
    return api.transport.url(ctx, state.path, query);
  }
  function response(ctx, body) {
    // 重要逻辑：动态栏目状态仍自包含在 data URL 中，但大型书单正文直接来自当前 HTTPS 请求。
    return api.transport.parseRead(ctx, '/get_discover', body);
  }
```

- [ ] **Step 4: 运行发现、包装器和搜索回归**

Run:

```powershell
node --test --test-name-pattern="发现栏目返回活动节点 HTTPS|Legado 顶层|榜单控件|搜索返回 HTTPS" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: 相关测试全部 PASS；动态栏目仍省略 `type`，所有 `@js:` 包装器可直接编译。

- [ ] **Step 5: 提交发现修改**

Run:

```powershell
git diff --check
git add book-sources/wsl-premium-aggregate/runtime/explore.js book-sources/tests/wsl-premium-aggregate.test.mjs
git commit -m "fix: load aggregate ranking lists directly"
```

Expected: 新提交只包含 `explore.js` 和聚合测试文件。

## Task 5: 提升覆盖版本、更新说明并重新构建四书源

**Files:**
- Modify: `book-sources/tests/wsl-premium-aggregate.test.mjs:472-490`
- Modify: `book-sources/wsl-premium-aggregate/source.template.json:16-18`
- Modify: `book-sources/README.md:59-84`
- Modify: `book-sources/wsl-premium-aggregate.json`

- [ ] **Step 1: 收紧缓存标记和更新时间测试**

把缓存标记测试改为：

```javascript
test('列表直连修复版更换发现栏目缓存键并保持包装器返回值', async () => {
  const [source] = await jsonFile(outputFile);
  const staleExploreUrl = '@js:WSLPA.explore.kinds(WSLPA.ctx(java, source, cache, cookie));/*发现榜单缓存-v2*/';
  // 重要逻辑：Legado 用 bookSourceUrl + exploreUrl 缓存发现栏目；v3 强制丢弃仍会返回内存响应键的旧动态链接。
  assert.notEqual(source.exploreUrl, staleExploreUrl);
  assert.match(source.exploreUrl, /发现榜单缓存-v3/);

  const style = await fixture('discover-style');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']);
  loaded.api.transport.read = () => ({ ok: true, data: style.data, raw: style });
  const kinds = JSON.parse(vm.runInContext(source.exploreUrl.slice(4), loaded.context));
  assert.deepEqual(kinds.map((kind) => kind.title), ['排行榜', '推荐榜']);
});
```

把更新时间测试改为：

```javascript
test('列表直连版本递增更新时间以便 Legado 默认选中覆盖更新', async () => {
  const sources = await jsonFile(outputFile);
  const previousResponseStashVersion = 1785902874675;
  assert.ok(sources.every((source) => source.lastUpdateTime > previousResponseStashVersion));
  assert.equal(new Set(sources.map((source) => source.lastUpdateTime)).size, 1);
});
```

- [ ] **Step 2: 运行版本测试并确认旧制品失败**

Run:

```powershell
node --test --test-name-pattern="列表直连修复版|列表直连版本" book-sources/tests/wsl-premium-aggregate.test.mjs
```

Expected: FAIL；旧生成文件仍包含缓存标记 `v2`，更新时间等于 `1785902874675`。

- [ ] **Step 3: 更新模板中的固定发布值**

在 `source.template.json` 中使用以下值：

```json
    "lastUpdateTime": 1785906400000,
    "variableComment": "在登录面板统一设置节点、发现频道、书架同步、评论和明文末级节点。",
    "exploreUrl": "@js:WSLPA.explore.kinds(WSLPA.ctx(java, source, cache, cookie));/*发现榜单缓存-v3*/",
```

- [ ] **Step 4: 更新 README 的验证状态和节点边界**

把能力验证项目改为：

```markdown
- 已自动验证：搜索与榜单 HTTPS 直连、独立 Rhino 作用域解析、详情、目录、四种正文夹具、节点故障切换、状态 URL、评论读取映射和确定性构建。
```

把只读重试说明改为：

```markdown
详情、目录、正文、发现栏目定义和评论等由运行时连接器执行的只读请求，会在网络错误、TLS 错误、HTTP 5xx 或损坏信封后切换节点。HTTP 4xx、`code != 0`、登录提示和匿名配额属于业务状态，不触发节点轮换。

搜索和发现书单返回当前活动节点的真实 HTTPS URL，由 Legado 直接取得 JSON，以避免跨 Rhino 作用域丢失大型列表响应。这两个列表请求不在同一次请求内自动轮换节点；连接失败后可在登录面板清除或切换节点，再刷新搜索或榜单。

旧版已经加入书架且仍保存裸 `data:` 地址的条目，需要通过新版书源重新搜索并加入书架，才能更新为带 `wslpa` 宿主标记的自包含书籍状态 URL。
```

- [ ] **Step 5: 构建生成文件并运行全量离线测试**

Run:

```powershell
node book-sources/wsl-premium-aggregate/build.mjs
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
node --test book-sources/tests/qidian-mobile-free.test.mjs
```

Expected: 聚合测试全部通过且实时测试恰好跳过 1 项；起点回归 7 项全部通过。

- [ ] **Step 6: 确认生成文件包含四个直连版本书源**

Run:

```powershell
node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync('book-sources/wsl-premium-aggregate.json','utf8'));if(x.length!==4||x.some(s=>!s.exploreUrl.includes('缓存-v3')||s.lastUpdateTime!==1785906400000||!s.jsLib.includes('return api.transport.url(ctx')))process.exit(1);console.log(x.map(s=>s.bookSourceName+'='+s.bookSourceType).join('\n'))"
git diff --check
```

Expected: 输出小说 `0`、听书 `1`、漫画 `2`、短剧 `4` 四行，两个命令退出状态均为 0。

- [ ] **Step 7: 提交模板、生成文件、测试和说明**

Run:

```powershell
git add book-sources/wsl-premium-aggregate/source.template.json book-sources/wsl-premium-aggregate.json book-sources/tests/wsl-premium-aggregate.test.mjs book-sources/README.md
git commit -m "fix: release direct aggregate list responses"
```

Expected: 提交包含模板、生成制品、聚合测试和 README 四个路径。

## Task 6: 代码审查并封闭发现的问题

**Files:**
- Review: `book-sources/wsl-premium-aggregate/runtime/transport.js`
- Review: `book-sources/wsl-premium-aggregate/runtime/search.js`
- Review: `book-sources/wsl-premium-aggregate/runtime/explore.js`
- Review: `book-sources/wsl-premium-aggregate/source.template.json`
- Review: `book-sources/tests/wsl-premium-aggregate.test.mjs`

- [ ] **Step 1: 读取并执行 requesting-code-review skill**

Review focus:

```text
Review the WSL premium direct-list fix against docs/superpowers/specs/2026-08-05-wsl-premium-direct-list-response-design.md. Check Rhino ES5 compatibility, URL-origin/path injection, query encoding, host selection, raw-envelope and endpoint-schema validation, business errors, independent SharedJsScope execution, pagination, dynamic explore click behavior, generated-source determinism, and whether search/discovery still depend on responseStashes.
```

Expected: 没有未处理的 P1/P2 结论；每个可复现结论先加入回归测试，再做最小修正并提交 `fix: address direct list review`。

- [ ] **Step 2: 重新运行定向与全量测试**

Run:

```powershell
node --test --test-name-pattern="列表直连传输|搜索返回 HTTPS|发现栏目返回活动节点 HTTPS|Legado 顶层|列表直连修复版|列表直连版本|构建器生成" book-sources/tests/wsl-premium-aggregate.test.mjs
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
git diff --check
if (git status --porcelain) { throw '代码审查后仍有未提交修改' }
```

Expected: 定向和全量离线测试全部通过，实时项跳过，工作树干净。

## Task 7: 生成补丁、可执行回滚和行为验证记录

**Files:**
- Create: `build/wsl-premium-direct-list-response/source-change.patch`
- Create: `build/wsl-premium-direct-list-response/modified.sha256`
- Create: `build/wsl-premium-direct-list-response/verify-list-response.mjs`
- Create: `build/wsl-premium-direct-list-response/RhinoSourceCheck.java`
- Create: `build/wsl-premium-direct-list-response/generated-jsLib.js`
- Create: `build/wsl-premium-direct-list-response/rollback.ps1`
- Create: `build/wsl-premium-direct-list-response/verification.txt`
- Verify: `book-sources/wsl-premium-aggregate.json`

- [ ] **Step 1: 创建独立行为验证脚本**

创建 `build/wsl-premium-direct-list-response/verify-list-response.mjs`：

```javascript
/**
 * Author: WSL
 * 在独立 JavaScript 作用域中验证列表 URL 和原始响应交接行为。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const mode = process.argv[2];
const workspace = path.resolve(process.argv[3]);
assert.ok(['baseline', 'modified'].includes(mode), '模式必须是 baseline 或 modified');
const runtimeRoot = path.join(workspace, 'book-sources', 'wsl-premium-aggregate', 'runtime');
const fixtureRoot = path.join(workspace, 'book-sources', 'wsl-premium-aggregate', 'protocol', 'fixtures');
const searchRaw = JSON.parse(await readFile(path.join(fixtureRoot, 'search.json'), 'utf8'));
const discoverRaw = JSON.parse(await readFile(path.join(fixtureRoot, 'discover-list.json'), 'utf8'));

function makeCache() {
  const values = new Map();
  return {
    delete(key) { values.delete(String(key)); },
    get(key) { return values.get(String(key)) ?? null; },
    put(key, value) { values.set(String(key), String(value)); },
  };
}

function makeJava() {
  return {
    base64Decode(value) { return Buffer.from(String(value), 'base64').toString('utf8'); },
    base64Encode(value) { return Buffer.from(String(value), 'utf8').toString('base64'); },
    connect(spec) {
      const raw = String(spec).includes('/get_discover') ? discoverRaw : searchRaw;
      return { body() { return JSON.stringify(raw); }, code() { return 200; } };
    },
    hexDecodeToString(value) { return Buffer.from(String(value), 'hex').toString('utf8'); },
    longToast() {},
  };
}

async function load(cache) {
  const context = vm.createContext({
    JSON, cache, decodeURIComponent, encodeURIComponent, java: makeJava(),
    source: { getKey() { return 'https://www.qidian.com/#wsl-premium-aggregate-novel'; } },
  });
  for (const file of ['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']) {
    vm.runInContext(await readFile(path.join(runtimeRoot, file), 'utf8'), context, { filename: file });
  }
  return { api: context.WSLPA, context };
}

function scheme(value) { return new URL(value).protocol.replace(':', ''); }
function count(action) {
  try { return String(action().length); }
  catch (error) { return 'error'; }
}

const cache = makeCache();
const first = await load(cache);
const searchUrl = first.api.search.url(first.context, 'SYNTHETIC_BOOK', 1);
const discoverState = first.api.state.toDataUri(first.context, {
  v: 1, kind: 'discover', path: '/get_discover', query: { source: 'SYNTHETIC_SOURCE', tab: '小说' },
});
const discoverUrl = first.api.explore.url(first.context, discoverState, 1);

// 重要逻辑：第二个上下文不共享 first.api.responseStashes，只获得宿主实际取得的 JSON 字符串。
const second = await load(cache);
const actual = {
  searchScheme: scheme(searchUrl),
  discoverScheme: scheme(discoverUrl),
  searchBooks: count(() => second.api.search.list(second.context, JSON.stringify(searchRaw))),
  discoverBooks: count(() => second.api.explore.list(second.context, JSON.stringify(discoverRaw))),
};
const expected = {
  baseline: { searchScheme: 'data', discoverScheme: 'data', searchBooks: 'error', discoverBooks: 'error' },
  modified: { searchScheme: 'https', discoverScheme: 'https', searchBooks: '1', discoverBooks: '1' },
};
assert.deepEqual(actual, expected[mode]);
console.log(`mode=${mode}`);
console.log('inputs=search.json,discover-list.json');
console.log(`search_scheme=${actual.searchScheme}`);
console.log(`discover_scheme=${actual.discoverScheme}`);
console.log(`fresh_search_books=${actual.searchBooks}`);
console.log(`fresh_discover_books=${actual.discoverBooks}`);
```

- [ ] **Step 2: 创建 Rhino 1.9.1 加载器**

创建 `build/wsl-premium-direct-list-response/RhinoSourceCheck.java`：

```java
/**
 * Author: WSL
 * 使用仓库锁定的 Rhino 版本编译并加载生成书源的 jsLib。
 */
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

public final class RhinoSourceCheck {
    public static void main(String[] args) throws Exception {
        String version = Context.class.getPackage().getImplementationVersion();
        if (!"1.9.1".equals(version)) {
            throw new IllegalStateException("Rhino 版本无效: " + version);
        }
        String script = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        Context context = Context.enter();
        try {
            context.setOptimizationLevel(-1);
            Scriptable scope = context.initStandardObjects();
            context.evaluateString(scope, script, args[0], 1, null);
            Object api = ScriptableObject.getProperty(scope, "WSLPA");
            if (api == Scriptable.NOT_FOUND) {
                throw new IllegalStateException("生成 jsLib 没有导出 WSLPA");
            }
            System.out.println("rhino=" + version);
            System.out.println("generated_jslib=loaded");
        } finally {
            Context.exit();
        }
    }
}
```

- [ ] **Step 3: 创建可执行回滚脚本**

创建 `build/wsl-premium-direct-list-response/rollback.ps1`：

```powershell
# Author: WSL
param(
    [string]$Workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)
$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot 'source-change.patch'
$target = Join-Path $Workspace 'book-sources\wsl-premium-aggregate.json'
$expectedModified = (Get-Content -Raw (Join-Path $PSScriptRoot 'modified.sha256')).Trim()
$expectedBaseline = (Get-Content -Raw (Join-Path $PSScriptRoot 'baseline.sha256')).Trim()
$current = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if ($current -ne $expectedModified) {
    throw "回滚前制品哈希无效: $current"
}

# 重要逻辑：先检查整份反向补丁，再一次性恢复运行时、测试、模板、README 和生成制品，避免半回滚状态。
& git -C $Workspace apply --check --reverse $patch
if ($LASTEXITCODE -ne 0) { throw '反向补丁预检失败' }
& git -C $Workspace apply --reverse $patch
if ($LASTEXITCODE -ne 0) { throw '反向补丁执行失败' }

$restored = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
if ($restored -ne $expectedBaseline) {
    throw "回滚后制品哈希无效: $restored"
}
Write-Output "rollback_sha256=$restored"
```

- [ ] **Step 4: 生成修改哈希、完整补丁和 Rhino 输入**

Run:

```powershell
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$artifactRoot = "$workspace\build\wsl-premium-direct-list-response"
$baselineCommit = (Get-Content -Raw "$artifactRoot\baseline.commit").Trim()
$modifiedHash = (Get-FileHash "$workspace\book-sources\wsl-premium-aggregate.json" -Algorithm SHA256).Hash.ToLowerInvariant()
$modifiedHash | Set-Content -Encoding ascii "$artifactRoot\modified.sha256"
$patch = "$artifactRoot\source-change.patch"
& git -C $workspace diff --binary "$baselineCommit..HEAD" --output=$patch -- book-sources/wsl-premium-aggregate/runtime/transport.js book-sources/wsl-premium-aggregate/runtime/search.js book-sources/wsl-premium-aggregate/runtime/explore.js book-sources/wsl-premium-aggregate/source.template.json book-sources/wsl-premium-aggregate.json book-sources/tests/wsl-premium-aggregate.test.mjs book-sources/README.md
if ($LASTEXITCODE -ne 0 -or !(Test-Path $patch) -or (Get-Item $patch).Length -eq 0) { throw '补丁生成失败' }
node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync(process.argv[2],x[0].jsLib,'utf8')" "$workspace\book-sources\wsl-premium-aggregate.json" "$artifactRoot\generated-jsLib.js"
& git -C $workspace apply --check --reverse $patch
if ($LASTEXITCODE -ne 0) { throw '生成补丁不能反向应用' }
Write-Output "modified_sha256=$modifiedHash"
Write-Output "patch_bytes=$((Get-Item $patch).Length)"
```

Expected: 修改哈希非基线哈希，补丁字节数大于 0，反向应用预检退出状态为 0。

- [ ] **Step 5: 执行回滚并验证旧行为**

Run:

```powershell
$artifactRoot = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response'
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$rollbackOutput = @(& "$artifactRoot\rollback.ps1" -Workspace $workspace 2>&1 | ForEach-Object { $_.ToString() })
$rollbackStatus = if ($?) { 0 } else { 1 }
$rollbackOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\rollback-output.txt"
$rollbackStatus | Set-Content -Encoding ascii "$artifactRoot\rollback-status.txt"
$rollbackOutput | Write-Output
$baselineOutput = @(node "$artifactRoot\verify-list-response.mjs" baseline $workspace 2>&1)
$baselineStatus = $LASTEXITCODE
$baselineOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\baseline-output.txt"
$baselineStatus | Set-Content -Encoding ascii "$artifactRoot\baseline-status.txt"
$baselineOutput | Write-Output
if ($rollbackStatus -ne 0 -or $baselineStatus -ne 0) { throw '基线行为验证失败' }
```

Expected literal behavior output:

```text
mode=baseline
inputs=search.json,discover-list.json
search_scheme=data
discover_scheme=data
fresh_search_books=error
fresh_discover_books=error
```

- [ ] **Step 6: 重新应用补丁并验证新行为**

Run:

```powershell
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$artifactRoot = "$workspace\build\wsl-premium-direct-list-response"
$restoreOutput = @(& git -C $workspace apply --check "$artifactRoot\source-change.patch" 2>&1)
if ($LASTEXITCODE -ne 0) { throw '正向补丁预检失败' }
$restoreOutput += @(& git -C $workspace apply "$artifactRoot\source-change.patch" 2>&1)
if ($LASTEXITCODE -ne 0) { throw '正向补丁恢复失败' }
$actual = (Get-FileHash "$workspace\book-sources\wsl-premium-aggregate.json" -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = (Get-Content -Raw "$artifactRoot\modified.sha256").Trim()
if ($actual -ne $expected) { throw '正向补丁后的制品哈希无效' }
$restoreOutput += "modified_sha256=$actual"
$restoreOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\restore-output.txt"
0 | Set-Content -Encoding ascii "$artifactRoot\restore-status.txt"
$restoreOutput | Write-Output
$modifiedOutput = @(node "$artifactRoot\verify-list-response.mjs" modified $workspace 2>&1)
$modifiedStatus = $LASTEXITCODE
$modifiedOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\modified-output.txt"
$modifiedStatus | Set-Content -Encoding ascii "$artifactRoot\modified-status.txt"
$modifiedOutput | Write-Output
if ($modifiedStatus -ne 0) { throw '修改行为验证失败' }
```

Expected literal behavior output:

```text
mode=modified
inputs=search.json,discover-list.json
search_scheme=https
discover_scheme=https
fresh_search_books=1
fresh_discover_books=1
```

- [ ] **Step 7: 用 Rhino 1.9.1 加载生成 jsLib**

Run:

```powershell
$artifactRoot = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response'
$rhinoJar = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\org.mozilla\rhino\1.9.1\*\rhino-1.9.1.jar" | Select-Object -First 1 -ExpandProperty FullName
if (!$rhinoJar) { throw 'Rhino 1.9.1 JAR 不存在' }
$rhinoOutput = @(javac -encoding UTF-8 -cp $rhinoJar -d $artifactRoot "$artifactRoot\RhinoSourceCheck.java" 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Rhino 验证器编译失败' }
$rhinoOutput += @(java -cp "$rhinoJar;$artifactRoot" RhinoSourceCheck "$artifactRoot\generated-jsLib.js" 2>&1)
$rhinoStatus = $LASTEXITCODE
$rhinoOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\rhino-output.txt"
$rhinoStatus | Set-Content -Encoding ascii "$artifactRoot\rhino-status.txt"
$rhinoOutput | Write-Output
if ($rhinoStatus -ne 0) { throw 'Rhino jsLib 加载失败' }
```

Expected:

```text
rhino=1.9.1
generated_jslib=loaded
```

- [ ] **Step 8: 执行最终离线、实时、确定性和敏感信息检查**

Run:

```powershell
Set-Location 'G:\legado\.worktrees\qidian-mobile-free'
$artifactRoot = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response'
$aggregateOutput = @(node --test book-sources/tests/wsl-premium-aggregate.test.mjs 2>&1)
$aggregateStatus = $LASTEXITCODE
$aggregateOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\aggregate-output.txt"
$aggregateStatus | Set-Content -Encoding ascii "$artifactRoot\aggregate-status.txt"
$aggregateOutput | Write-Output
if ($aggregateStatus -ne 0) { throw '聚合离线测试失败' }
$qidianOutput = @(node --test book-sources/tests/qidian-mobile-free.test.mjs 2>&1)
$qidianStatus = $LASTEXITCODE
$qidianOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\qidian-output.txt"
$qidianStatus | Set-Content -Encoding ascii "$artifactRoot\qidian-status.txt"
$qidianOutput | Write-Output
if ($qidianStatus -ne 0) { throw '起点回归失败' }
$env:WSL_LIVE='1'; $env:WSL_LIVE_MEDIA='小说'
$liveOutput = @(node --test --test-name-pattern="匿名实时链路" book-sources/tests/wsl-premium-aggregate.test.mjs 2>&1)
$liveStatus = $LASTEXITCODE
Remove-Item Env:WSL_LIVE,Env:WSL_LIVE_MEDIA -ErrorAction SilentlyContinue
$liveOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\live-output.txt"
$liveStatus | Set-Content -Encoding ascii "$artifactRoot\live-status.txt"
$liveOutput | Write-Output
if ($liveStatus -ne 0) { throw '聚合实时链路失败' }
$finalOutput = @(node book-sources/wsl-premium-aggregate/build.mjs 2>&1)
if ($LASTEXITCODE -ne 0) { throw '第一次确定性构建失败' }
$firstHash = (Get-FileHash book-sources/wsl-premium-aggregate.json -Algorithm SHA256).Hash.ToLowerInvariant()
$finalOutput += @(node book-sources/wsl-premium-aggregate/build.mjs 2>&1)
if ($LASTEXITCODE -ne 0) { throw '第二次确定性构建失败' }
$secondHash = (Get-FileHash book-sources/wsl-premium-aggregate.json -Algorithm SHA256).Hash.ToLowerInvariant()
if ($firstHash -ne $secondHash) { throw '连续构建哈希不一致' }
$leaks = Get-ChildItem book-sources/wsl-premium-aggregate/runtime,book-sources/wsl-premium-aggregate.json -File -Recurse | Select-String -Pattern 'Bearer\s+[A-Za-z0-9._~-]+|Set-Cookie\s*:|SESSION_COOKIE=|qttoken|sessionid|SYNTHETIC_PARAGRAPH'
if ($leaks) { throw '生成制品包含禁止内容' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Git diff 检查失败' }
if (git status --porcelain) { throw '最终验证后工作树与已提交修改不一致' }
$finalOutput += "deterministic_sha256=$secondHash"
$finalOutput += 'sensitive_scan=clean'
$finalOutput += 'git_worktree=clean'
$finalOutput | Set-Content -Encoding utf8NoBOM "$artifactRoot\final-output.txt"
0 | Set-Content -Encoding ascii "$artifactRoot\final-status.txt"
$finalOutput | Write-Output
```

Expected: 聚合离线测试全部通过且跳过实时项 1 个，起点 7 项通过，小说实时链路通过，两次构建哈希一致，敏感模式扫描为空，Git 工作树干净。

- [ ] **Step 9: 从捕获文件生成并重读验证记录**

Run:

```powershell
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$artifactRoot = "$workspace\build\wsl-premium-direct-list-response"
$record = "$artifactRoot\verification.txt"
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('WSL Premium Direct List Response Verification')
$lines.Add("Baseline artifact SHA-256: $((Get-Content -Raw "$artifactRoot\baseline.sha256").Trim())")
$lines.Add("Modified artifact SHA-256: $((Get-Content -Raw "$artifactRoot\modified.sha256").Trim())")
$rhinoJar = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\org.mozilla\rhino\1.9.1\*\rhino-1.9.1.jar" | Select-Object -First 1 -ExpandProperty FullName
if (!$rhinoJar) { throw '验证记录找不到 Rhino 1.9.1 JAR' }
$sections = @(
  @{ Title='Rollback command'; Command="& '$artifactRoot\rollback.ps1' -Workspace '$workspace'"; Inputs='source-change.patch, modified.sha256, baseline.sha256'; Output='rollback-output.txt'; Status='rollback-status.txt' },
  @{ Title='Baseline command'; Command="node '$artifactRoot\verify-list-response.mjs' baseline '$workspace'"; Inputs='search.json, discover-list.json, baseline runtime'; Output='baseline-output.txt'; Status='baseline-status.txt' },
  @{ Title='Restore modified command'; Command="git -C '$workspace' apply '$artifactRoot\source-change.patch'"; Inputs='source-change.patch'; Output='restore-output.txt'; Status='restore-status.txt' },
  @{ Title='Modified command'; Command="node '$artifactRoot\verify-list-response.mjs' modified '$workspace'"; Inputs='search.json, discover-list.json, modified runtime'; Output='modified-output.txt'; Status='modified-status.txt' },
  @{ Title='Rhino 1.9.1 load'; Command="javac -encoding UTF-8 / java -cp '$rhinoJar;$artifactRoot' RhinoSourceCheck '$artifactRoot\generated-jsLib.js'"; Inputs='generated-jsLib.js, Rhino 1.9.1'; Output='rhino-output.txt'; Status='rhino-status.txt' },
  @{ Title='Aggregate offline tests'; Command='node --test book-sources/tests/wsl-premium-aggregate.test.mjs'; Inputs='aggregate fixtures and runtime'; Output='aggregate-output.txt'; Status='aggregate-status.txt' },
  @{ Title='Qidian regression'; Command='node --test book-sources/tests/qidian-mobile-free.test.mjs'; Inputs='qidian-mobile-free.json'; Output='qidian-output.txt'; Status='qidian-status.txt' },
  @{ Title='Anonymous live chain'; Command='$env:WSL_LIVE=1; $env:WSL_LIVE_MEDIA=小说; node --test --test-name-pattern=匿名实时链路 book-sources/tests/wsl-premium-aggregate.test.mjs'; Inputs='live /discovestyle, /get_discover, /search, /detail, /catalog, /content'; Output='live-output.txt'; Status='live-status.txt' },
  @{ Title='Deterministic build and scans'; Command='build.mjs twice; SHA-256 compare; sensitive scan; git diff/status'; Inputs='source.template.json and runtime modules'; Output='final-output.txt'; Status='final-status.txt' }
)
foreach ($section in $sections) {
  $status = (Get-Content -Raw "$artifactRoot\$($section.Status)").Trim()
  if ($status -ne '0') { throw "$($section.Title) 的退出状态不是 0" }
  $output = Get-Content -Raw -Encoding UTF8 "$artifactRoot\$($section.Output)"
  $lines.Add('')
  $lines.Add("## $($section.Title)")
  $lines.Add("command=$($section.Command)")
  $lines.Add("inputs=$($section.Inputs)")
  $lines.Add('literal_output_begin')
  $lines.Add($output.TrimEnd())
  $lines.Add('literal_output_end')
  $lines.Add("exit_status=$status")
}
$lines | Set-Content -Encoding utf8NoBOM $record
```

Run:

```powershell
$record = 'G:\legado\.worktrees\qidian-mobile-free\build\wsl-premium-direct-list-response\verification.txt'
if (!(Test-Path $record) -or (Get-Item $record).Length -eq 0) { throw '验证记录为空' }
$required = @('Baseline command','Rollback command','Modified command','exit_status=0','Rhino 1.9.1','Deterministic build')
$text = Get-Content -Raw -Encoding UTF8 $record
foreach ($item in $required) { if (!$text.Contains($item)) { throw "验证记录缺少: $item" } }
Get-Content -Encoding UTF8 $record
```

Expected: 验证记录被完整重读，固定标题齐全，基线和修改行为均包含原样输出与退出状态 0。

- [ ] **Step 10: 重新打开并验证四个交付角色**

Run:

```powershell
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$artifactRoot = "$workspace\build\wsl-premium-direct-list-response"
$roles = @(
  "$workspace\book-sources\wsl-premium-aggregate.json",
  "$artifactRoot\source-change.patch",
  "$artifactRoot\verification.txt",
  "$artifactRoot\rollback.ps1"
)
foreach ($role in $roles) {
  if (!(Test-Path -LiteralPath $role) -or (Get-Item -LiteralPath $role).Length -eq 0) { throw "交付角色无效: $role" }
  Write-Output "$role=$((Get-FileHash -LiteralPath $role -Algorithm SHA256).Hash.ToLowerInvariant())"
}
Get-Content -Raw -Encoding UTF8 "$workspace\book-sources\wsl-premium-aggregate.json" | ConvertFrom-Json | Out-Null
& git -C $workspace apply --check --reverse "$artifactRoot\source-change.patch"
if ($LASTEXITCODE -ne 0) { throw '补丁重开验证失败' }
& powershell -NoProfile -Command "`$errors = `$null; [System.Management.Automation.Language.Parser]::ParseFile('$artifactRoot\rollback.ps1',[ref]`$null,[ref]`$errors) | Out-Null; if (`$errors.Count) { exit 1 }"
if ($LASTEXITCODE -ne 0) { throw '回滚脚本语法验证失败' }
```

Expected: 四个绝对路径各输出一个 SHA-256；JSON 可解析；补丁可反向应用；回滚脚本语法正确。

## Task 8: 完成验证、推送分支并校验网络导入制品

**Files:**
- Verify: `book-sources/wsl-premium-aggregate.json`
- Publish: branch `codex/qidian-mobile-free`
- Update: existing draft PR `#1`

- [ ] **Step 1: 读取并执行 verification-before-completion skill**

使用 Task 7 的最新命令输出作为证据；任何命令在代码或构建之后发生变化时，重新运行受影响的验证并更新 `verification.txt`。

- [ ] **Step 2: 确认提交历史和工作树**

Run:

```powershell
Set-Location 'G:\legado\.worktrees\qidian-mobile-free'
git status --short
git log --oneline --decorate -8
git diff 288c6b793fe79536b2d52f516ff1e0b304f882ef..HEAD --check
```

Expected: `git status --short` 无输出；提交历史依次包含设计、计划、传输、搜索、发现和发布提交；diff check 退出状态为 0。

- [ ] **Step 3: 使用 github:yeet 流程推送现有分支**

推送目标固定为：

```powershell
git push origin codex/qidian-mobile-free
```

随后读取现有 PR `#1`，确认 head 分支仍为 `codex/qidian-mobile-free`，保持 draft 状态并包含新提交。

Expected: 远端分支前进到本地 `HEAD`，现有 PR 不重复创建。

- [ ] **Step 4: 通过不可变提交 URL 校验 jsDelivr 文件**

Run:

```powershell
$workspace = 'G:\legado\.worktrees\qidian-mobile-free'
$commit = (git -C $workspace rev-parse HEAD).Trim()
$url = "https://fastly.jsdelivr.net/gh/wang573287909/legado@$commit/book-sources/wsl-premium-aggregate.json"
$remoteFile = "$workspace\build\wsl-premium-direct-list-response\cdn-wsl-premium-aggregate.json"
Invoke-WebRequest -Uri $url -OutFile $remoteFile -TimeoutSec 60
$localHash = (Get-FileHash "$workspace\book-sources\wsl-premium-aggregate.json" -Algorithm SHA256).Hash.ToLowerInvariant()
$remoteHash = (Get-FileHash $remoteFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($localHash -ne $remoteHash) { throw "CDN 文件哈希不一致: $localHash != $remoteHash" }
$sources = Get-Content -Raw -Encoding UTF8 $remoteFile | ConvertFrom-Json
if ($sources.Count -ne 4 -or ($sources | Where-Object { $_.exploreUrl -notmatch '缓存-v3' }).Count -ne 0) { throw 'CDN 书源结构无效' }
Write-Output "import_url=$url"
Write-Output "cdn_sha256=$remoteHash"
```

Expected: HTTP 下载成功，本地与 CDN SHA-256 完全相同，远端 JSON 含四个书源和 `v3` 发现缓存标记。

- [ ] **Step 5: 返回安装和人工验证步骤**

最终答复必须列出：

1. 根因：列表响应内存键跨 `SharedJsScope` 丢失。
2. 已改变字段：`searchUrl`、动态发现 URL、`lastUpdateTime`、发现缓存标记。
3. 基线行为：搜索/发现 URL 为 `data`，独立作用域列表解析为 `error`。
4. 修改行为：搜索/发现 URL 为 `https`，独立作用域各解析 1 本夹具书。
5. 四个交付角色的绝对路径，以及原件和两个制品哈希。
6. 最新提交 SHA、现有 PR `#1` 和完整 jsDelivr 导入 URL。
7. Legado 操作：网络导入新 URL，四项全部覆盖，进入 `WSL·精品聚合·小说` 的发现页，点击“推荐榜”，确认出现书籍卡片并翻到第 2 页；再搜索“剑来”确认搜索结果。
8. 若 Legado 仍显示旧栏目，删除四个同名聚合书源后重新网络导入，避免旧发现缓存继续命中。
9. 旧书架条目若仍使用裸 `data:` 地址，通过新版搜索结果重新加入书架。
