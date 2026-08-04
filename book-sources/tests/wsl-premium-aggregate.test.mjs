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
