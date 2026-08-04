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

function hexBody(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('hex');
}

test('搜索语法支持来源后缀和 @@ 转义，并保留同名不同来源', async () => {
  const raw = await fixture('search');
  raw.data.push({ ...raw.data[0], source: 'SECOND_SOURCE', book_id: 'SECOND_ID' });
  const loaded = await loadRuntime(['config.js', 'state.js', 'transport.js', 'search.js']);
  loaded.api.transport.read = () => ({ ok: true, data: raw.data, raw });

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
  assert.equal(kinds[1].style.cols, 4);
  assert.doesNotMatch(kinds[1].url, /v10\.czyl\.cf/);

  const encodedState = JSON.parse(kinds[1].url.match(/cookie\),\s*("[^"]+")/)[1]);
  const discoverState = loaded.api.state.fromDataUri(loaded.context, encodedState);
  assert.equal(discoverState.path, '/get_discover');
  const responseUrl = loaded.api.explore.url(loaded.context, encodedState, 3);
  const books = loaded.api.explore.list(loaded.context, hexBody(loaded.api.state.fromDataUri(loaded.context, responseUrl)));
  assert.equal(books[0].name, 'SYNTHETIC_DISCOVER_BOOK');
  assert.equal(loaded.api.state.fromDataUri(loaded.context, books[0].bookUrl).bookId, 'DISCOVER_BOOK_ID');
});

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
