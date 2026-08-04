/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var THROTTLE_KEY = api.config.prefix + 'sync_throttle';
  var THROTTLE_MS = 10 * 60 * 1000;
  var shelfIds = api.shelfIds || {};
  api.shelfIds = shelfIds;
  function endpoint(name) { return api.protocol && api.protocol.endpoints ? api.protocol.endpoints[name] : null; }
  function ready(name) {
    var value = endpoint(name);
    return !!value && value.evidence === 'authenticated-request-recognized' && value.contentType === 'application/json';
  }
  function bodyFor(name, values) {
    var contract = endpoint(name);
    var body = {};
    (contract.requiredFields || []).forEach(function (field) {
      if (values[field] === undefined || values[field] === null || values[field] === '') {
        throw new Error('书架字段缺失: ' + field);
      }
      body[field] = values[field];
    });
    return body;
  }
  function shelfKey(book) { return book.source + ':' + book.bookId; }
  function ensure(ctx, book, mapped) {
    if (!api.config.read(ctx).syncBookshelf || !ready('bookshelfCheck') || !ready('bookshelfAdd')) return false;
    var email = api.auth && api.auth.email ? api.auth.email(ctx) : '';
    if (!email) return false;
    try {
      var values = { EMAIL: email, BookName: mapped.name, BookId: book.bookId, Source: book.source, Tab: book.tab };
      var checked = api.transport.requireSuccess(ctx, api.transport.postRead(ctx, '/check_book_in_book_shelf', {}, bodyFor('bookshelfCheck', values)));
      if (checked.data && checked.data.exists) {
        if (checked.data.id) shelfIds[shelfKey(book)] = String(checked.data.id);
        return true;
      }
      // 重要逻辑：添加属于非幂等写操作，交给 transport.write 单节点执行，网络结果不确定时不重放。
      var added = api.transport.requireSuccess(ctx, api.transport.write(ctx, '/add_book_to_book_shelf', bodyFor('bookshelfAdd', values)));
      if (added.data && added.data.id) shelfIds[shelfKey(book)] = String(added.data.id);
      return true;
    } catch (error) {
      ctx.java.toast('书架同步：' + error.message);
      return false;
    }
  }
  function sync(ctx, chapter) {
    if (!api.config.read(ctx).syncBookshelf || !ready('bookshelfUpdate')) return false;
    var email = api.auth && api.auth.email ? api.auth.email(ctx) : '';
    var id = shelfIds[shelfKey(chapter)];
    if (!email || !id) return false;
    var throttle = {};
    try { throttle = JSON.parse(String(ctx.cache.get(THROTTLE_KEY) || '{}')); } catch (error) { throttle = {}; }
    var throttleKey = chapter.source + ':' + chapter.bookId;
    var previous = throttle[throttleKey] || {};
    var now = Date.now();
    if (previous.time && (previous.itemId === chapter.itemId || now - Number(previous.time) < THROTTLE_MS)) return false;
    try {
      var values = {
        ID: String(id), EMAIL: email, BookId: chapter.bookId,
        ItemId: chapter.itemId, Title: chapter.title || ''
      };
      // 重要逻辑：先完成单次写请求再记录节流状态；超时不在备用节点重复提交。
      api.transport.requireSuccess(ctx, api.transport.write(ctx, '/update_book_shelf', bodyFor('bookshelfUpdate', values)));
      throttle[throttleKey] = { itemId: chapter.itemId, time: now };
      ctx.cache.put(THROTTLE_KEY, JSON.stringify(throttle));
      return true;
    } catch (error) {
      ctx.java.toast('进度同步：' + error.message);
      return false;
    }
  }

  api.bookshelf = { ensure: ensure, sync: sync };
})(WSLPA);
