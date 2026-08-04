/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function list(ctx, body) {
    var book = api.state.fromBody(ctx, body);
    if (book.kind !== 'book') throw new Error('目录状态类型无效');
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/catalog', {
      book_id: book.bookId, source: book.source, tab: book.tab, variable: book.variable || '{"custom":""}'
    }));
    if (!Array.isArray(envelope.data)) throw new Error('目录响应 data 不是数组');
    // 重要逻辑：直接按接口数组映射，不在本地排序，保证卷标与章节的相对位置不变。
    return envelope.data.map(function (item, index) {
      var itemId = clean(item.item_id) || ('volume-' + index);
      var chapter = {
        v: 1, kind: 'chapter', bookId: book.bookId, itemId: itemId,
        source: clean(item.source) || book.source, tab: clean(item.tab) || book.tab,
        title: clean(item.title), url: clean(item.url), variable: book.variable || '{"custom":""}'
      };
      return {
        title: chapter.title, chapterUrl: api.state.toDataUri(ctx, chapter),
        updateTime: clean(item.first_pass_time), isVolume: item.is_volume === true,
        isVip: item.is_pay === true, isPay: item.is_pay === true
      };
    });
  }

  api.catalog = { list: list };
})(WSLPA);
