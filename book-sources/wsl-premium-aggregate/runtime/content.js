/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function assertHttp(url, label) {
    var value = clean(url);
    if (!/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(label + '地址无效');
    return value;
  }
  function novel(raw) {
    var value = clean(raw.content)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    // 重要逻辑：服务端在匿名正文尾部附加配额与推广说明，只截断已观察的固定配额标记。
    var markers = ['您当前未登录，今日已访问', '您今日已访问'];
    markers.forEach(function (marker) {
      var index = value.indexOf(marker);
      if (index >= 0) value = value.substring(0, index);
    });
    if (!value.trim()) throw new Error('小说正文为空');
    return value.trim();
  }
  function audio(raw) { return assertHttp(raw.content, '音频'); }
  function image(raw) {
    var html = clean(raw.content);
    var seen = {};
    var images = [];
    html.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (_, url) {
      var value = assertHttp(url, '漫画图片');
      if (!seen[value]) {
        seen[value] = true;
        images.push('<img src="' + value.replace(/"/g, '&quot;') + '">');
      }
      return '';
    });
    if (!images.length) throw new Error('漫画图片为空');
    return images.join('\n');
  }
  function video(raw) {
    if (Array.isArray(raw.contents) && raw.contents.length) {
      var resolutions = raw.contents.map(function (item) {
        return { name: clean(item.name || item.title || item.quality), url: assertHttp(item.url, '视频') };
      });
      return JSON.stringify({ resolutions: resolutions, defaultIndex: 0, headers: raw.headers || {} });
    }
    return assertHttp(raw.content, '视频');
  }
  var adapters = { '小说': novel, '听书': audio, '漫画': image, '短剧': video };
  function load(ctx, body) {
    var chapter = api.state.fromBody(ctx, body);
    if (chapter.kind !== 'chapter') throw new Error('正文状态类型无效');
    var envelope = api.transport.postRead(ctx, '/content', {}, {
      html: '', item_id: chapter.itemId, source: chapter.source, tab: chapter.tab,
      tone_id: '4', variable: chapter.variable || '{"custom":""}', version: '4.11.5.1'
    });
    api.transport.requireSuccess(ctx, envelope);
    // 重要逻辑：由章节状态中的媒体类型唯一分派，避免音频或视频 URL 被文本清洗器破坏。
    var adapter = adapters[chapter.tab];
    if (!adapter) throw new Error('未支持的媒体类型: ' + chapter.tab);
    var output = adapter(envelope.raw);
    if (api.bookshelf) api.bookshelf.sync(ctx, chapter);
    return output;
  }

  api.content = { load: load };
})(WSLPA);
