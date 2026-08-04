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
