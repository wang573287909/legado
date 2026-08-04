/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var cursors = api.reviewCursors || {};
  api.reviewCursors = cursors;
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function objectUrl(value, property, getter) {
    if (!value) return '';
    if (value[property]) return String(value[property]);
    if (typeof value[getter] === 'function') return String(value[getter]());
    return '';
  }
  function requestState(ctx, book, chapter) {
    var chapterUrl = objectUrl(chapter, 'url', 'getUrl');
    if (chapterUrl) return api.state.fromDataUri(ctx, chapterUrl);
    return api.state.fromDataUri(ctx, objectUrl(book, 'bookUrl', 'getBookUrl'));
  }
  function cursorKey(state, page) {
    return state.source + ':' + state.bookId + ':' + clean(state.itemId) + ':' + page;
  }
  function emptyResponse() {
    return { code: 0, msg: '', data: { comments: [], total: 0, has_more: false, next_cursor: '' } };
  }
  function url(ctx, book, chapter, paragraphIndex, page) {
    if (!api.config.read(ctx).reviews) return api.state.stash(ctx, emptyResponse());
    var state = requestState(ctx, book, chapter);
    var pageNumber = Number(page || 1);
    var envelope = api.transport.requireSuccess(ctx, api.transport.read(ctx, '/para_review', {
      book_id: state.bookId, item_id: clean(state.itemId), source: state.source,
      tab: state.tab, cursor: clean(cursors[cursorKey(state, pageNumber)])
    }));
    // 重要逻辑：游标只保存在当前共享运行时内存中，避免把阅读轨迹写进持久缓存。
    if (envelope.data && envelope.data.next_cursor) {
      cursors[cursorKey(state, pageNumber + 1)] = String(envelope.data.next_cursor);
    }
    return api.state.stash(ctx, envelope.raw);
  }
  function response(ctx, body) { return api.state.readStashFromBody(ctx, body); }
  function list(ctx, body) {
    var raw = response(ctx, body);
    var comments = raw.data && Array.isArray(raw.data.comments) ? raw.data.comments : [];
    return comments.map(function (item) {
      var user = item.user || {};
      var images = item.image_url ? (Array.isArray(item.image_url) ? item.image_url : [item.image_url]) : [];
      return {
        reviewId: clean(item.comment_id), avatar: clean(user.user_avatar), name: clean(user.user_name),
        content: clean(item.content), postTime: clean(item.create_time), images: images,
        voteUpCount: Number(item.like_count || 0), replyCount: Number(item.reply_count || 0),
        extra: user.is_author ? '作者' : (user.is_vip ? 'VIP' : '')
      };
    });
  }
  function total(ctx, body) {
    var raw = response(ctx, body);
    return Number(raw.data && raw.data.total || 0);
  }
  function hasMore(ctx, body) {
    var raw = response(ctx, body);
    return !!(raw.data && raw.data.has_more);
  }

  // 服务端已明确关闭 /post_idea_review，因此这里只暴露读取映射，不生成发表、点赞或删除规则。
  api.review = { url: url, list: list, total: total, hasMore: hasMore };
})(WSLPA);
