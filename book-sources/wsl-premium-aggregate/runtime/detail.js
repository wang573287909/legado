/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function first(value, fallback) { return clean(value) || clean(fallback); }
  function kinds(item, seed) {
    var value = [item.category, item.tags, item.status, item.source].map(clean).filter(function (entry) { return !!entry; }).join(',');
    return value || clean(seed.kind);
  }
  function load(ctx, body) {
    var state = api.state.fromBody(ctx, body);
    if (state.kind !== 'book') throw new Error('详情状态类型无效');
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/detail', {
      book_id: state.bookId, source: state.source, tab: state.tab, variable: state.variable || '{"custom":""}'
    }));
    var item = envelope.data || {};
    var seed = state.seed || {};
    // 重要逻辑：详情接口空字段回退到搜索种子，避免书籍进入详情页后丢失封面或作者。
    var mapped = {
      name: first(item.book_name, seed.name), author: first(item.author, seed.author),
      intro: first(item.abstract, seed.intro), coverUrl: first(item.thumb_url, seed.coverUrl),
      kind: kinds(item, seed), wordCount: first(item.word_number, seed.wordCount),
      lastChapter: first(item.last_chapter_title, seed.lastChapter),
      updateTime: first(item.last_chapter_update_time, seed.updateTime),
      tocUrl: api.state.toDataUri(ctx, state)
    };
    if (api.bookshelf) api.bookshelf.ensure(ctx, state, mapped);
    return JSON.stringify(mapped);
  }
  function field(result, name) {
    var value = typeof result === 'string' ? JSON.parse(result) : result;
    return value && value[name] !== undefined && value[name] !== null ? value[name] : '';
  }

  api.detail = { load: load, field: field };
})(WSLPA);
