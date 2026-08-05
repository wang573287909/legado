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
  function kindStyle(columnCount) {
    var count = Number(columnCount || 1);
    // 重要逻辑：同时输出官方 Flexbox 旧字段和本分支 GridLayout 新字段，保证不同阅读版本都能计算按钮宽度。
    return {
      cols: count,
      layout_flexGrow: 1,
      layout_flexBasisPercent: 1 / count
    };
  }
  function discoverKind(ctx, title, query, columnCount) {
    var state = { v: 1, kind: 'discover', path: '/get_discover', query: query };
    var stateUrl = api.state.toDataUri(ctx, state);
    return {
      title: title,
      url: '@js:WSLPA.explore.url(WSLPA.ctx(java, source, cache, cookie), ' + JSON.stringify(stateUrl) + ', page);',
      style: kindStyle(columnCount)
    };
  }
  function fallbackKinds(ctx) {
    var media = api.config.media(ctx);
    var channel = api.config.read(ctx).channel;
    var section = '基础分类';
    var definitions = [];
    var gender = channel === '女频' ? 2 : 1;
    if (media === '小说') {
      section = '排行榜';
      ['推荐榜', '完本榜', '新书榜', '书友榜', '追更榜', '黑马榜', '巅峰榜', '书荒榜', '礼物榜', '阅读榜', '作者榜']
        .forEach(function (title) {
          definitions.push([title, { bdtype: title, gender: gender, is_ranking: 1 }]);
        });
    } else if (media === '听书') {
      section = '听书分类';
      definitions = [
        ['全部', { type: 899, gender: 2, genre_type: 1 }],
        ['都市', { type: 1, gender: 2, genre_type: 1 }],
        ['玄幻', { type: 7, gender: 2, genre_type: 1 }],
        ['悬疑', { type: 10, gender: 2, genre_type: 1 }]
      ];
    } else if (media === '漫画') {
      section = '漫画分类';
      definitions = [
        ['玄幻', { type: 7, gender: gender, genre_type: 0 }],
        ['都市', { type: 1, gender: gender, genre_type: 0 }],
        ['悬疑', { type: 10, gender: gender, genre_type: 0 }],
        ['历史', { type: 12, gender: gender, genre_type: 0 }]
      ];
    } else if (media === '短剧') {
      section = '短剧分类';
      definitions = [
        ['必看榜', { type: 'rank_hot', gender: 111 }],
        ['新剧榜', { type: 'rank_new_reader', gender: 111 }],
        ['逆袭', { type: 'cat_739', gender: 111 }],
        ['现代言情', { type: 'cat_3', gender: 111 }]
      ];
    }
    var result = [{ title: section, type: 'title', style: kindStyle(1) }];
    definitions.forEach(function (definition) {
      var query = { source: '番茄', tab: media };
      Object.keys(definition[1]).forEach(function (key) { query[key] = definition[1][key]; });
      result.push(discoverKind(ctx, definition[0], query, 4));
    });
    return result;
  }
  function mapRemoteKinds(ctx, data) {
    var mapped = [];
    data.forEach(function (item) {
      var title = clean(item.title);
      if (!title || title === '--') return;
      if (!clean(item.url)) {
        mapped.push({ title: title, type: 'title', style: kindStyle(1) });
        return;
      }
      // 重要逻辑：动态栏目只接受已验证的发现列表路径，其他服务端链接不进入书源执行链。
      if (requestPath(item.url) !== '/get_discover') return;
      var query = parseQuery(item.url);
      // 单个上游栏目编码损坏时只丢弃该栏目，保留同一发现页中的其他有效入口。
      if (!query) return;
      // 重要逻辑：普通发现分类沿用示例协议并省略 type；显式 text 在部分宿主版本中会被渲染为输入控件。
      mapped.push(discoverKind(ctx, title, query, cols(item.style)));
    });
    return mapped;
  }
  function kinds(ctx) {
    var fallback = fallbackKinds(ctx);
    try {
      var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/discovestyle', {
        source: '', source_type: api.config.read(ctx).channel, tab: api.config.media(ctx)
      }));
      if (!Array.isArray(envelope.data)) throw new Error('发现栏目 data 不是数组');
      var mapped = mapRemoteKinds(ctx, envelope.data);
      // 服务端偶发返回空栏目时不把 [] 写入 Legado 持久缓存，基础榜单始终保持可进入。
      if (mapped.length > 0) return JSON.stringify(mapped);
    } catch (error) {
      try { ctx.java.toast('发现栏目网络异常，已显示基础榜单'); } catch (ignored) {}
    }
    // 重要逻辑：基础榜单不发起网络请求，因此首次展开失败或旧栏目缓存失效时仍有确定的可点击入口。
    return JSON.stringify(fallback);
  }
  function url(ctx, encodedState, page) {
    var state = api.state.fromDataUri(ctx, encodedState);
    if (state.kind !== 'discover') throw new Error('发现栏目状态类型无效');
    var query = state.query || {};
    query.page = Number(page || 1);
    return api.transport.url(ctx, state.path, query);
  }
  function response(ctx, body) {
    // 重要逻辑：动态栏目状态仍自包含在 data URL 中，但大型书单正文直接来自当前列表请求。
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
