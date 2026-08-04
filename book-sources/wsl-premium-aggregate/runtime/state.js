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
