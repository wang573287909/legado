/**
 * Author: WSL
 * WSL 精品聚合书源的静态、夹具、运行时与实时契约测试。
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, '..', 'wsl-premium-aggregate');
const fixtureRoot = path.join(sourceRoot, 'protocol', 'fixtures');
const runtimeRoot = path.join(sourceRoot, 'runtime');
const outputFile = path.resolve(testDir, '..', 'wsl-premium-aggregate.json');
const execFileAsync = promisify(execFile);
const buildFile = path.join(sourceRoot, 'build.mjs');

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
  assert.deepEqual(registry.endpoints.reviewList.levels, ['chapter']);
  assert.equal(registry.accountWrites.enabled, false);
  assert.equal(registry.accountWrites.failureLogRedaction, 'capture-required');

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
  const bareUrl = `data:application/json;base64,${context.java.base64Encode(JSON.stringify(state))}`;
  assert.equal(url, `${bareUrl},{"type":"wslpa"}`);
  // 重要逻辑：模拟 Legado AnalyzeUrl.paramPattern 分割，确认 data: 与宿主 URL 选项各自完整。
  const optionMarker = /\s*,\s*(?=\{)/;
  const marker = optionMarker.exec(url);
  assert.equal(url.substring(0, marker.index), bareUrl);
  assert.deepEqual(JSON.parse(url.substring(marker.index + marker[0].length)), { type: 'wslpa' });
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.fromDataUri(context, url))), state);
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.fromDataUri(context, bareUrl))), state);
  assert.throws(() => api.state.toDataUri(context, { ...state, token: 'SECRET' }), /敏感字段/);
  assert.throws(() => api.state.toDataUri(context, { ...state, v: 2 }), /状态版本/);
  assert.throws(() => api.state.toDataUri(context, { ...state, title: 'x'.repeat(9000) }), /状态过长/);
  assert.throws(() => api.state.toDataUri(context, { ...state, bookId: { value: 'BOOK_ID' } }), /字段类型/);
  assert.throws(() => api.state.toDataUri(context, { ...state, unexpected: 'VALUE' }), /字段不支持/);
  assert.throws(() => api.state.toDataUri(context, {
    v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'x'.repeat(1025),
    source: 'SYNTHETIC_SOURCE', tab: '小说',
  }), /字段过长/);
  assert.throws(() => api.state.toDataUri(context, {
    v: 1, kind: 'discover', path: '/get_discover', query: { source: { nested: true } },
  }), /查询字段类型/);
});

test('书籍和章节状态不持久化上游 opaque 变量或签名媒体 URL', async () => {
  const searchRaw = await fixture('search');
  searchRaw.data[0].variable = '{"nested":{"token":"SECRET"}}';
  const searchLoaded = await loadRuntime(['config.js', 'state.js', 'search.js']);
  const mapped = searchLoaded.api.search.mapItem(searchLoaded.context, searchRaw.data[0]);
  const bookState = searchLoaded.api.state.fromDataUri(searchLoaded.context, mapped.bookUrl);
  assert.equal(bookState.variable, '{"custom":""}');
  assert.doesNotMatch(JSON.stringify(bookState), /token|SECRET/i);
  assert.throws(() => searchLoaded.api.state.toDataUri(searchLoaded.context, {
    v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说',
    variable: '{"nested":{"token":"SECRET"}}',
  }), /敏感字段/);

  const catalogRaw = await fixture('catalog');
  catalogRaw.data[1].url = 'https://media.invalid/video.mp4?token=SECRET';
  const catalogLoaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'catalog.js']);
  catalogLoaded.api.transport.read = () => ({ ok: true, data: catalogRaw.data, raw: catalogRaw });
  const chapters = catalogLoaded.api.catalog.list(catalogLoaded.context, hexBody({
    v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说', variable: '{"custom":""}',
  }));
  const chapterState = catalogLoaded.api.state.fromDataUri(catalogLoaded.context, chapters[1].chapterUrl);
  assert.equal(Object.hasOwn(chapterState, 'url'), false);
  assert.doesNotMatch(JSON.stringify(chapterState), /token|SECRET|video\.mp4/i);
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

test('响应暂存按 TTL 过期且评论游标保持有界', async () => {
  const stateLoaded = await loadRuntime(['config.js', 'state.js']);
  const responseUrl = stateLoaded.api.state.stash(stateLoaded.context, { code: 0, data: ['VALUE'] });
  const responseState = stateLoaded.api.state.fromDataUri(stateLoaded.context, responseUrl);
  stateLoaded.api.responseStashes[responseState.cacheKey].createdAt = Date.now() - (6 * 60 * 1000);
  assert.throws(() => stateLoaded.api.state.readStashFromBody(
    stateLoaded.context, hexBody(responseState),
  ), /已失效/);

  const reviewRaw = await fixture('review');
  const reviewLoaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'review.js']);
  reviewLoaded.api.transport.read = () => ({ ok: true, raw: reviewRaw, data: reviewRaw.data });
  const chapterUrl = reviewLoaded.api.state.toDataUri(reviewLoaded.context, {
    v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说',
  });
  for (let page = 1; page <= 70; page += 1) {
    reviewLoaded.api.review.url(reviewLoaded.context, {}, { url: chapterUrl }, 0, page);
  }
  assert.ok(Object.keys(reviewLoaded.api.reviewCursors).length <= 64);
});

function response(status, body) {
  return { body() { return body; }, code() { return status; } };
}

test('列表直连传输构造活动节点 URL 并校验宿主原始响应', async () => {
  const raw = await fixture('search');
  const cache = makeCache();
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');
  const { api, context } = await loadRuntime(['config.js', 'state.js', 'transport.js'], { cache });

  cache.put('wsl_premium_aggregate:active_host', 'https://external.invalid');
  assert.equal(new URL(api.transport.url(context, '/search', {})).origin, 'https://v10.czyl.cf');
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');

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
  assert.throws(() => api.transport.url(context, '/search,{"method":"POST"}', {}), /服务路径无效/);
  assert.throws(() => api.transport.read(context, '/search,{"method":"POST"}', {}), /服务路径无效/);
  const optionLikeQuery = new URL(api.transport.url(context, '/search', {
    title: ',{"method":"POST"}&x=y',
  }));
  assert.equal(optionLikeQuery.searchParams.get('title'), ',{"method":"POST"}&x=y');

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

test('只读传输在 5xx 后切换并粘住成功节点', async () => {
  const calls = [];
  const java = makeJava((spec) => {
    calls.push(String(spec));
    if (calls.length === 1) return response(503, '{"code":-1,"msg":"down"}');
    if (String(spec).includes('/detail')) {
      return response(200, '{"code":0,"msg":"ok","data":{"book_id":"BOOK_ID","source":"SYNTHETIC_SOURCE","book_name":"SYNTHETIC_BOOK","tab":"小说"}}');
    }
    return response(200, '{"code":0,"msg":"ok","data":[{"book_id":"BOOK_ID","source":"SYNTHETIC_SOURCE","tab":"小说"}]}');
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

test('HTTP 4xx 即使响应非 JSON 也作为业务错误且不切节点', async () => {
  for (const body of ['<html>missing</html>', 'null']) {
    let calls = 0;
    const java = makeJava(() => {
      calls += 1;
      return response(404, body);
    });
    const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java });
    const result = loaded.api.transport.read(loaded.context, '/missing', {});
    assert.equal(result.business, true);
    assert.equal(result.code, 404);
    assert.equal(result.message, 'HTTP 404');
    assert.equal(calls, 1);
  }
});

test('损坏信封、缺失数据和媒体错配在候选循环内触发只读切换', async () => {
  const scenarios = [
    {
      first: '{"msg":"missing code","data":[]}',
      pathName: '/search',
      second: '{"code":0,"data":[]}',
    },
    {
      first: '{"code":0}',
      pathName: '/detail',
      second: '{"code":0,"data":{"book_id":"BOOK_ID","source":"SYNTHETIC_SOURCE","book_name":"SYNTHETIC_BOOK","tab":"小说"}}',
    },
    {
      first: '{"code":0,"data":[{"book_id":"BOOK_ID","source":"SYNTHETIC_SOURCE","tab":"听书"}]}',
      pathName: '/search',
      second: '{"code":0,"data":[{"book_id":"BOOK_ID","source":"SYNTHETIC_SOURCE","tab":"小说"}]}',
    },
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    const java = makeJava(() => {
      calls += 1;
      return response(200, calls === 1 ? scenario.first : scenario.second);
    });
    const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java });
    const result = loaded.api.transport.read(loaded.context, scenario.pathName, {});
    assert.equal(result.ok, true);
    assert.equal(result.host, 'https://v4.czyl.cf');
    assert.equal(calls, 2);
  }

  const searchLoaded = await loadRuntime(['config.js', 'state.js', 'search.js']);
  assert.throws(() => searchLoaded.api.search.mapItem(searchLoaded.context, {
    book_name: 'SYNTHETIC_BOOK', book_id: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '听书',
  }), /媒体类型/);
});

test('端点最低字段契约在候选循环内淘汰损坏的详情、目录、评论和媒体正文', async () => {
  const scenarios = [
    {
      pathName: '/detail', media: '小说',
      first: { code: 0, data: { book_id: '', source: '', tab: '小说' } },
      second: { code: 0, data: { book_id: '', source: '', book_name: 'SYNTHETIC_BOOK', tab: '小说' } },
    },
    {
      pathName: '/catalog', media: '小说',
      first: { code: 0, data: [{ title: '第1章', is_volume: false, tab: '小说' }] },
      second: { code: 0, data: [{ title: '第1章', item_id: 'ITEM_ID', is_volume: false, tab: '小说' }] },
    },
    {
      pathName: '/para_review', media: '小说',
      first: { code: 0, data: { comments: [null] } },
      second: { code: 0, data: { comments: [] } },
    },
    {
      pathName: '/content', media: '小说', post: true,
      first: { code: 0, content: '<script>only-active-content</script>', contents: null },
      second: { code: 0, content: '<p>SYNTHETIC_PARAGRAPH</p>', contents: null },
    },
    {
      pathName: '/content', media: '听书', post: true,
      first: { code: 0, content: 'not-a-url', contents: null },
      second: { code: 0, content: 'https://media.invalid/audio.mp3', contents: null },
    },
    {
      pathName: '/content', media: '漫画', post: true,
      first: { code: 0, content: '<img src="javascript:alert(1)">', contents: null },
      second: { code: 0, content: '<img src="https://media.invalid/page.jpg">', contents: null },
    },
    {
      pathName: '/content', media: '短剧', post: true,
      first: { code: 0, content: '', contents: [{}] },
      second: { code: 0, content: '', contents: [{ name: '高清', url: 'https://media.invalid/video.mp4' }] },
    },
  ];
  const suffixes = { 小说: 'novel', 听书: 'audio', 漫画: 'image', 短剧: 'video' };
  for (const scenario of scenarios) {
    let calls = 0;
    const java = makeJava(() => {
      calls += 1;
      return response(200, JSON.stringify(calls === 1 ? scenario.first : scenario.second));
    });
    const source = { getKey() { return `https://www.qidian.com/#wsl-premium-aggregate-${suffixes[scenario.media]}`; } };
    const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js'], { java, source });
    const result = scenario.post
      ? loaded.api.transport.postRead(loaded.context, scenario.pathName, {}, {})
      : loaded.api.transport.read(loaded.context, scenario.pathName, {});
    assert.equal(result.ok, true, scenario.pathName + ':' + scenario.media);
    assert.equal(result.host, 'https://v4.czyl.cf', scenario.pathName + ':' + scenario.media);
    assert.equal(calls, 2, scenario.pathName + ':' + scenario.media);
  }
});

function hexBody(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('hex');
}

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

test('详情用搜索种子回退空字段并生成同一书籍状态的目录 URL', async () => {
  const raw = await fixture('detail');
  raw.data.author = '';
  raw.data.thumb_url = '';
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'detail.js']);
  loaded.api.transport.read = () => ({ ok: true, data: raw.data, raw });
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
  loaded.api.transport.read = () => ({ ok: true, data: raw.data, raw });
  const state = { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说', variable: '{"custom":""}' };
  const chapters = loaded.api.catalog.list(loaded.context, hexBody(state));
  assert.deepEqual(chapters.map((item) => item.title), ['第一卷', '第1章']);
  assert.equal(chapters[0].isVolume, true);
  assert.equal(chapters[1].isVip, true);
  assert.equal(loaded.api.state.fromDataUri(loaded.context, chapters[1].chapterUrl).itemId, 'ITEM_ID');
});

test('发现栏目丢弃占位项、改写节点 origin 并复用书籍映射', async () => {
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
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']);
  loaded.api.transport.read = (_ctx, pathName) => ({
    ok: true,
    data: pathName === '/discovestyle' ? style.data : listing.data,
    raw: pathName === '/discovestyle' ? style : listing,
  });
  const kinds = JSON.parse(loaded.api.explore.kinds(loaded.context));
  assert.deepEqual(kinds.map((kind) => kind.title), ['排行榜', '推荐榜']);
  assert.equal(kinds[0].type, 'title');
  // 重要逻辑：普通发现分类沿用示例协议，省略 type 后由宿主按可点击链接处理；text 在部分版本会打开输入控件。
  assert.equal(Object.hasOwn(kinds[1], 'type'), false);
  assert.equal(kinds[1].style.cols, 4);
  assert.doesNotMatch(kinds[1].url, /v10\.czyl\.cf/);

  // 状态 URL 末尾的 Legado 选项会引入转义引号，按完整 JavaScript 字符串语法提取。
  const encodedState = JSON.parse(kinds[1].url.match(/cookie\),\s*("(?:\\.|[^"\\])*")\s*,\s*page/)[1]);
  const discoverState = loaded.api.state.fromDataUri(loaded.context, encodedState);
  assert.equal(discoverState.path, '/get_discover');
  assert.equal(discoverState.query.source, 'A B');
  const responseUrl = loaded.api.explore.url(loaded.context, encodedState, 3);
  const books = loaded.api.explore.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl)));
  assert.equal(books[0].name, 'SYNTHETIC_DISCOVER_BOOK');
  assert.equal(loaded.api.state.fromDataUri(loaded.context, books[0].bookUrl).bookId, 'DISCOVER_BOOK_ID');
});

test('Legado 顶层 @js 包装器可以作为 Rhino 脚本直接编译', async () => {
  const sources = await jsonFile(outputFile);
  const wrappers = sources.flatMap((source) => [
    [`${source.bookSourceName}.loginUi`, source.loginUi],
    [`${source.bookSourceName}.exploreUrl`, source.exploreUrl],
    [`${source.bookSourceName}.searchUrl`, source.searchUrl],
    [`${source.bookSourceName}.ruleReview.reviewUrl`, source.ruleReview.reviewUrl],
  ]);

  const style = await fixture('discover-style');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']);
  loaded.api.transport.read = () => ({ ok: true, data: style.data, raw: style });
  const dynamicKinds = JSON.parse(loaded.api.explore.kinds(loaded.context))
    .filter((item) => item.url);
  for (const item of dynamicKinds) {
    // 重要逻辑：button 会把完整 URL 直接交给 source.evalJS；普通项才会进入 AnalyzeUrl 解析 @js:。
    assert.notEqual(item.type, 'button', `${item.title} 应走 openExplore/AnalyzeUrl`);
  }
  const dynamicUrls = dynamicKinds
    .map((item, index) => [`动态发现链接[${index}]`, item.url]);
  wrappers.push(...dynamicUrls);

  for (const [label, wrapper] of wrappers) {
    assert.match(wrapper, /^@js:/, label);
    // 重要逻辑：Legado 会剥离 @js: 后直接交给 Rhino 编译，顶层 return 会触发“返回的值无效”。
    assert.doesNotThrow(() => new vm.Script(wrapper.slice(4)), label);
  }
});

test('榜单控件修复版更换发现栏目缓存键并保持包装器返回值', async () => {
  const [source] = await jsonFile(outputFile);
  const staleExploreUrl = '@js:WSLPA.explore.kinds(WSLPA.ctx(java, source, cache, cookie));';
  // 重要逻辑：Legado 用 bookSourceUrl + exploreUrl 缓存发现栏目；更换包装器文本可避开已持久化的 text 控件列表。
  assert.notEqual(source.exploreUrl, staleExploreUrl);

  const style = await fixture('discover-style');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js', 'explore.js']);
  loaded.api.transport.read = () => ({ ok: true, data: style.data, raw: style });
  const kinds = JSON.parse(vm.runInContext(source.exploreUrl.slice(4), loaded.context));
  assert.deepEqual(kinds.map((kind) => kind.title), ['排行榜', '推荐榜']);
});

test('兼容修复版递增更新时间以便 Legado 默认选中覆盖更新', async () => {
  const sources = await jsonFile(outputFile);
  const previousBareDataUrlVersion = 1785901109310;
  assert.ok(sources.every((source) => source.lastUpdateTime > previousBareDataUrlVersion));
  assert.equal(new Set(sources.map((source) => source.lastUpdateTime)).size, 1);
});

test('正文适配器分别输出文本、音频 URL、图片 HTML 和视频 URL', async () => {
  const names = { 小说: 'content-novel', 听书: 'content-audio', 漫画: 'content-image', 短剧: 'content-video' };
  for (const [tab, name] of Object.entries(names)) {
    const raw = await fixture(name);
    if (tab === '小说') {
      raw.content = '<iframe src="https://bad.invalid">BAD</iframe>' +
        '<object data="https://bad.invalid">BAD</object>' +
        '<img src="javascript:alert(1)" onerror=alert(1)>' +
        '<a href="java&#x73;cript:alert(1)">SYNTHETIC_LINK_TEXT</a>' +
        '<button formaction="javascript:alert(1)">SYNTHETIC_BUTTON_TEXT</button>' +
        '<div srcdoc="<script>alert(1)</script>" srcset="javascript:alert(1)">SYNTHETIC_ATTR_TEXT</div>' +
        '<svg><a xlink:href="javascript:alert(1)">BAD</a></svg>' +
        '<img src="https://media.invalid/safe.jpg" srcset="javascript:alert(1)" onerror="alert(1)">' +
        '<p onclick=go()>SYNTHETIC_SAFE_TEXT</p>' + raw.content;
    }
    const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'content.js']);
    loaded.api.transport.postRead = () => ({ ok: true, raw, data: raw.data });
    const chapter = {
      v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID',
      source: 'SYNTHETIC_SOURCE', tab, title: 'ITEM', variable: '{"custom":""}',
    };
    const output = loaded.api.content.load(loaded.context, hexBody(chapter));
    if (tab === '小说') {
      assert.match(output, /SYNTHETIC_PARAGRAPH_ONE/);
      assert.match(output, /SYNTHETIC_SAFE_TEXT/);
      assert.match(output, /SYNTHETIC_LINK_TEXT|SYNTHETIC_BUTTON_TEXT|SYNTHETIC_ATTR_TEXT/);
      assert.match(output, /<img src="https:\/\/media\.invalid\/safe\.jpg">/);
      assert.doesNotMatch(output, /今日已访问|SYNTHETIC_SERVICE_NOTICE/);
      assert.doesNotMatch(output, /iframe|object|javascript:|java&#x73;cript|onerror|onclick|formaction|srcdoc|srcset|xlink|<svg|<a\b|<button/i);
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

test('登录 UI 从共享配置生成，退出清除 Cookie、临时响应、游标、书架 ID 和节流轨迹', async () => {
  const cache = makeCache();
  const opened = [];
  const removed = [];
  const java = {
    ...makeJava(),
    getCookie(host) { return String(host).includes('v10.czyl.cf') ? 'SESSION_COOKIE=<redacted>' : ''; },
    startBrowser(url, title) { opened.push([String(url), String(title)]); },
  };
  const cookie = { getCookie() { return ''; }, removeCookie(host) { removed.push(String(host)); } };
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'auth.js', 'review.js', 'bookshelf.js'], { cache, cookie, java });
  const ui = JSON.parse(loaded.api.auth.ui(loaded.context));
  assert.match(ui[0].name, /检测到登录 Cookie/);
  assert.ok(ui.some((row) => row.name === '检查当前节点 Cookie'));
  cache.put('wsl_premium_aggregate:active_host', 'https://v4.czyl.cf');
  assert.match(JSON.parse(loaded.api.auth.ui(loaded.context))[0].name, /状态：匿名/);
  cache.put('wsl_premium_aggregate:active_host', 'https://v10.czyl.cf');
  loaded.api.auth.toggle(loaded.context, 'syncBookshelf');
  assert.equal(loaded.api.config.read(loaded.context).syncBookshelf, true);
  loaded.api.auth.openLogin(loaded.context);
  assert.equal(opened[0][0], 'https://v10.czyl.cf/login');
  loaded.api.state.stash(loaded.context, { code: 0, data: ['SYNTHETIC_RESPONSE'] });
  loaded.api.reviewCursors['SYNTHETIC_CURSOR'] = { createdAt: Date.now(), value: 'CURSOR' };
  loaded.api.shelfIds['SYNTHETIC_BOOK'] = 'SHELF_ID';
  cache.put('wsl_premium_aggregate:sync_throttle', '{"SYNTHETIC_SOURCE:BOOK_ID":{"itemId":"ITEM_ID","time":1}}');
  loaded.api.auth.logout(loaded.context);
  assert.equal(removed.length, 6);
  assert.equal(Object.keys(loaded.api.responseStashes).length, 0);
  assert.equal(Object.keys(loaded.api.reviewCursors).length, 0);
  assert.equal(Object.keys(loaded.api.shelfIds).length, 0);
  assert.equal(cache.get('wsl_premium_aggregate:sync_throttle'), null);
  assert.doesNotMatch([...cache.values.values()].join('\n'), /SESSION_COOKIE|token|authorization/i);
});

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
  assert.equal(loaded.api.bookshelf.ensure(loaded.context, book, { name: 'SYNTHETIC_BOOK' }), false);
  assert.equal(writes.length, 0);

  loaded.api.protocol = { endpoints: {
    bookshelfCheck: {
      method: 'POST', path: '/check_book_in_book_shelf', evidence: 'authenticated-request-recognized',
      contentType: 'application/json; charset=utf-8', requiredFields: ['EMAIL', 'BookId'],
    },
    bookshelfAdd: {
      method: 'POST', path: '/add_book_to_book_shelf', evidence: 'authenticated-request-recognized',
      contentType: 'application/json', requiredFields: ['EMAIL', 'BookName', 'BookId', 'Source', 'Tab'],
    },
    bookshelfUpdate: {
      method: 'POST', path: '/update_book_shelf', evidence: 'authenticated-request-recognized',
      contentType: 'application/json', requiredFields: ['ID', 'EMAIL', 'BookId', 'ItemId', 'Title'],
    },
  } };
  assert.equal(loaded.api.bookshelf.ensure(loaded.context, book, { name: 'SYNTHETIC_BOOK' }), false);
  assert.equal(writes.length, 0);
  loaded.api.protocol.accountWrites = { enabled: true, failureLogRedaction: 'verified' };
  assert.equal(loaded.api.bookshelf.ensure(loaded.context, book, { name: 'SYNTHETIC_BOOK' }), true);
  const chapter = { v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说', title: '第1章' };
  assert.equal(loaded.api.bookshelf.sync(loaded.context, chapter), true);
  assert.equal(loaded.api.bookshelf.sync(loaded.context, chapter), false);
  assert.deepEqual(writes.map(([pathName]) => pathName), ['/add_book_to_book_shelf', '/update_book_shelf']);
});

test('评论读取映射用户、图片、计数和游标，不配置已关闭的写规则', async () => {
  const raw = await fixture('review');
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'review.js']);
  const queries = [];
  loaded.api.transport.read = (_ctx, _pathName, query) => {
    queries.push(query);
    return { ok: true, raw, data: raw.data };
  };
  const bookUrl = loaded.api.state.toDataUri(loaded.context, { v: 1, kind: 'book', bookId: 'BOOK_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' });
  const chapterUrl = loaded.api.state.toDataUri(loaded.context, { v: 1, kind: 'chapter', bookId: 'BOOK_ID', itemId: 'ITEM_ID', source: 'SYNTHETIC_SOURCE', tab: '小说' });
  const bookResponse = loaded.api.review.url(loaded.context, { bookUrl }, null, -1, 1);
  const paragraphResponse = loaded.api.review.url(loaded.context, { bookUrl }, { url: chapterUrl }, 3, 1);
  assert.equal(loaded.api.review.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, bookResponse))).length, 0);
  assert.equal(loaded.api.review.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, paragraphResponse))).length, 0);
  assert.equal(queries.length, 0);
  const responseUrl = loaded.api.review.url(loaded.context, { bookUrl }, { url: chapterUrl }, 0, 1);
  const body = hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl));
  const comments = loaded.api.review.list(loaded.context, body);
  assert.equal(comments[0].reviewId, 'COMMENT_ID');
  assert.equal(comments[0].name, 'SYNTHETIC_READER');
  assert.equal(comments[0].images[0], 'https://media.invalid/review.jpg');
  assert.equal(loaded.api.review.total(loaded.context, body), 1);
  assert.equal(loaded.api.review.hasMore(loaded.context, body), false);
  assert.equal(loaded.api.review.reply, undefined);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].item_id, 'ITEM_ID');
});

test('构建器生成四个唯一原生媒体书源且连续构建字节一致', async () => {
  const committed = await readFile(outputFile);
  await execFileAsync(process.execPath, [buildFile]);
  const first = await readFile(outputFile);
  assert.equal(createHash('sha256').update(committed).digest('hex'), createHash('sha256').update(first).digest('hex'));
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
  assert.ok(['book_name', 'author', 'abstract', 'thumb_url', 'category', 'last_chapter_title']
    .some((key) => String(detail.data[key] || '').trim()));

  const catalog = await liveJson(`${host}/catalog?${query(common)}`);
  assert.equal(Number(catalog.code), 0);
  assert.ok(Array.isArray(catalog.data) && catalog.data.length > 0);
  assert.ok(catalog.data.every((item) => item && String(item.title || '').trim() &&
    (item.is_volume === true || String(item.item_id || '').trim())));

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
    const httpUrl = (value) => /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());
    if (media === '小说') assert.ok(typeof content.content === 'string' && content.content.trim());
    else if (media === '听书') assert.ok(httpUrl(content.content));
    else if (media === '漫画') {
      const urls = [...String(content.content || '').matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
      assert.ok(urls.length > 0 && urls.every(httpUrl));
    } else if (Array.isArray(content.contents) && content.contents.length) {
      assert.ok(content.contents.every((item) => item && httpUrl(item.url)));
    } else assert.ok(httpUrl(content.content));
  } else {
    assert.ok(typeof content.msg === 'string' && content.msg.length > 0);
    t.diagnostic('正文服务可达，返回业务状态；未打印正文或媒体地址');
  }
});
