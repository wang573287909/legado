/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function parse(keyword) {
    var sentinel = '\u0000';
    // 重要逻辑：先保护 @@，再把最后一个未转义 @ 解释为上游来源分隔符。
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
    var tab = api.config.media(ctx);
    if (clean(item.tab) && clean(item.tab) !== tab) throw new Error('搜索结果媒体类型无效');
    var state = {
      v: 1, kind: 'book', bookId: clean(item.book_id), source: clean(item.source), tab: tab,
      // 重要逻辑：服务端 variable 属于 opaque 值，只持久化已观察且不含身份数据的固定公开结构。
      variable: '{"custom":""}',
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
    var state = bookState(ctx, item);
    var seed = state.seed;
    return {
      name: seed.name, author: seed.author, intro: seed.intro, coverUrl: seed.coverUrl,
      kind: seed.kind, wordCount: seed.wordCount, lastChapter: seed.lastChapter,
      updateTime: seed.updateTime, bookUrl: api.state.toDataUri(ctx, state)
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
