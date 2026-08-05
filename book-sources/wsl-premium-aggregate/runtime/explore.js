/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function safeDecode(value) {
    try { return decodeURIComponent(String(value).replace(/\+/g, ' ')); }
    catch (error) { return null; }
  }
  function parseQuery(url) {
    var query = {};
    var valid = true;
    var text = clean(url);
    var start = text.indexOf('?');
    if (start < 0) return query;
    text.substring(start + 1).split('&').forEach(function (pair) {
      var index = pair.indexOf('=');
      var key = safeDecode(index < 0 ? pair : pair.substring(0, index));
      var value = safeDecode(index < 0 ? '' : pair.substring(index + 1));
      if (key === null || value === null) { valid = false; return; }
      if (key && key !== 'page') query[key] = value;
    });
    return valid ? query : null;
  }
  function requestPath(url) {
    var text = clean(url).split('#')[0];
    var queryStart = text.indexOf('?');
    if (queryStart >= 0) text = text.substring(0, queryStart);
    return text.replace(/^https?:\/\/[^/]+/i, '') || '/';
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
      // 重要逻辑：动态栏目只接受已验证的发现列表路径，其他服务端链接不进入书源执行链。
      if (requestPath(item.url) !== '/get_discover') return;
      var query = parseQuery(item.url);
      // 单个上游栏目编码损坏时只丢弃该栏目，保留同一发现页中的其他有效入口。
      if (!query) return;
      var state = { v: 1, kind: 'discover', path: '/get_discover', query: query };
      // 重要逻辑：只保存路径参数，不持久化服务端 origin；打开时根据当前活动节点生成直接列表 URL，失败后需切换节点并刷新。
      var stateUrl = api.state.toDataUri(ctx, state);
      mapped.push({
        // 重要逻辑：普通发现分类沿用示例协议并省略 type；显式 text 在部分宿主版本中会被渲染为输入控件。
        title: title,
        url: '@js:WSLPA.explore.url(WSLPA.ctx(java, source, cache, cookie), ' + JSON.stringify(stateUrl) + ', page);',
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
    return api.transport.url(ctx, state.path, query);
  }
  function response(ctx, body) {
    // 重要逻辑：动态栏目状态仍自包含在 data URL 中，但大型书单正文直接来自当前 HTTPS 请求。
    return api.transport.parseRead(ctx, '/get_discover', body);
  }
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
