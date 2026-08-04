/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var PREFIX = 'data:application/json;base64,';
  var STASH_PREFIX = 'wsl-response:';
  var STASH_TTL_MS = 5 * 60 * 1000;
  var STASH_LIMIT = 32;
  var stashes = api.responseStashes || {};
  var sequence = Number(api.responseSequence || 0);
  api.responseStashes = stashes;
  var SENSITIVE = /cookie|token|password|authorization|session|secret/i;
  var STATE_FIELDS = {
    book: ['v', 'kind', 'bookId', 'source', 'tab', 'variable', 'seed'],
    chapter: ['v', 'kind', 'bookId', 'itemId', 'source', 'tab', 'title', 'variable'],
    discover: ['v', 'kind', 'path', 'query'],
    response: ['v', 'kind', 'cacheKey']
  };
  var SEED_FIELDS = ['name', 'author', 'intro', 'coverUrl', 'kind', 'wordCount', 'lastChapter', 'updateTime'];

  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function textField(value, name, required, maxLength) {
    if (value === undefined && !required) return;
    if (typeof value !== 'string') throw new Error(name + '字段类型无效');
    if (required && !value.trim()) throw new Error(name + '字段为空');
    if (value.length > maxLength) throw new Error(name + '字段过长');
  }
  function allowedFields(value, fields, label) {
    Object.keys(value).forEach(function (key) {
      if (SENSITIVE.test(key)) throw new Error('状态包含敏感字段: ' + key);
      if (fields.indexOf(key) < 0) throw new Error(label + '字段不支持: ' + key);
    });
  }
  function validateSeed(seed) {
    if (seed === undefined) return;
    if (!object(seed)) throw new Error('搜索种子字段类型无效');
    allowedFields(seed, SEED_FIELDS, '搜索种子');
    Object.keys(seed).forEach(function (key) { textField(seed[key], '搜索种子.' + key, false, 4096); });
  }
  function validateQuery(query) {
    if (query === undefined) return;
    if (!object(query)) throw new Error('发现查询字段类型无效');
    Object.keys(query).forEach(function (key) {
      var value = query[key];
      if (key.length > 128) throw new Error('发现查询字段过长');
      if (['string', 'number', 'boolean'].indexOf(typeof value) < 0) throw new Error('发现查询字段类型无效');
      if (String(value).length > 2048) throw new Error('发现查询字段过长');
    });
  }

  function validate(value) {
    if (!object(value)) throw new Error('状态必须是对象');
    var json = JSON.stringify(value);
    if (json.length > 8192) throw new Error('状态过长');
    if (value.v !== 1) throw new Error('状态版本无效');
    if (['book', 'chapter', 'discover', 'response'].indexOf(value.kind) < 0) throw new Error('状态类型无效');
    // 重要逻辑：每类状态只接受运行时实际消费的字段，避免把上游 opaque 对象顺带持久化到 data URL。
    allowedFields(value, STATE_FIELDS[value.kind], '状态');
    if (value.kind === 'book' || value.kind === 'chapter') {
      textField(value.bookId, 'bookId', true, 1024);
      textField(value.source, 'source', true, 1024);
      textField(value.variable, 'variable', false, 2048);
      if (typeof value.tab !== 'string' || ['小说', '听书', '漫画', '短剧'].indexOf(value.tab) < 0) throw new Error('书籍状态字段无效');
    }
    if (value.kind === 'book') validateSeed(value.seed);
    if (value.kind === 'chapter') {
      textField(value.itemId, 'itemId', true, 1024);
      textField(value.title, 'title', false, 4096);
    }
    if (value.kind === 'discover') {
      if (value.path !== '/get_discover') throw new Error('发现状态字段无效');
      validateQuery(value.query);
    }
    if (value.kind === 'response') {
      textField(value.cacheKey, 'cacheKey', true, 256);
      if (value.cacheKey.indexOf(STASH_PREFIX) !== 0) throw new Error('响应缓存状态无效');
    }
    (function walk(node) {
      Object.keys(node).forEach(function (key) {
        if (SENSITIVE.test(key)) throw new Error('状态包含敏感字段: ' + key);
        if (node[key] && typeof node[key] === 'object') {
          walk(node[key]);
        } else if (typeof node[key] === 'string') {
          var text = node[key].trim();
          if ((text.charAt(0) === '{' && text.charAt(text.length - 1) === '}') ||
              (text.charAt(0) === '[' && text.charAt(text.length - 1) === ']')) {
            // 重要逻辑：字符串化 JSON 也递归检查，避免 variable 等 opaque 字段藏入 token/cookie 键。
            var nested = null;
            try { nested = JSON.parse(text); } catch (error) { nested = null; }
            if (nested && typeof nested === 'object') walk(nested);
          }
        }
      });
    })(value);
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
  function clearObject(value) {
    Object.keys(value).forEach(function (key) { delete value[key]; });
  }
  function purgeStashes(now) {
    Object.keys(stashes).forEach(function (key) {
      var record = stashes[key];
      if (!record || typeof record.createdAt !== 'number' || now - record.createdAt > STASH_TTL_MS) {
        delete stashes[key];
      }
    });
  }
  function stash(ctx, value) {
    var now = Date.now();
    purgeStashes(now);
    sequence += 1;
    if (sequence > 1000000) sequence = 1;
    api.responseSequence = sequence;
    var cacheKey = STASH_PREFIX + now.toString(36) + '-' + sequence.toString(36) + '-' + Math.floor(Math.random() * 1679616).toString(36);
    var keys = Object.keys(stashes);
    if (keys.length >= STASH_LIMIT) delete stashes[keys[0]];
    // 重要逻辑：大型响应只放在共享 Rhino 作用域的有界内存中，不写入持久 cache 或 data URL。
    stashes[cacheKey] = { createdAt: now, value: value };
    return toDataUri(ctx, { v: 1, kind: 'response', cacheKey: cacheKey });
  }
  function readStashFromBody(ctx, body) {
    var state = fromBody(ctx, body);
    if (state.kind !== 'response' || String(state.cacheKey).indexOf(STASH_PREFIX) !== 0) {
      throw new Error('响应缓存状态无效');
    }
    purgeStashes(Date.now());
    var record = stashes[state.cacheKey];
    if (!record) throw new Error('响应内存已失效，请重新加载');
    return record.value;
  }

  api.state = {
    fromBody: fromBody,
    fromDataUri: fromDataUri,
    toDataUri: toDataUri,
    stash: stash,
    readStashFromBody: readStashFromBody,
    clearResponses: function () { clearObject(stashes); }
  };
})(WSLPA);
