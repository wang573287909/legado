/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function assertHttp(url, label) {
    var value = clean(url);
    if (!/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(label + '地址无效');
    return value;
  }
  function decodeEntities(value) {
    return String(value)
      .replace(/&#x([0-9a-f]+);?/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
      .replace(/&#([0-9]+);?/g, function (_, decimal) { return String.fromCharCode(parseInt(decimal, 10)); })
      .replace(/&colon;/gi, ':').replace(/&sol;/gi, '/').replace(/&amp;/gi, '&');
  }
  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }
  function safeImage(tag) {
    var match = String(tag).match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!match) return '';
    var url = decodeEntities(match[1] || match[2] || match[3] || '').trim();
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(url)) return '';
    return '<img src="' + escapeAttribute(url) + '">';
  }
  function sanitizeNovelHtml(input) {
    var allowed = {
      p: true, br: true, div: true, span: true, b: true, strong: true,
      i: true, em: true, u: true, s: true, del: true, blockquote: true,
      pre: true, code: true, h1: true, h2: true, h3: true, h4: true,
      h5: true, h6: true, ul: true, ol: true, li: true, hr: true,
      sub: true, sup: true, img: true
    };
    var html = String(input || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    // 重要逻辑：只按允许列表重建标签；普通标签的全部属性被丢弃，图片仅保留验证后的 HTTP(S) src。
    return html.replace(/<[^>]*>/g, function (tag) {
      var match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)\b/i);
      if (!match) return '';
      var closing = !!match[1];
      var name = match[2].toLowerCase();
      if (!allowed[name]) return '';
      if (name === 'img') return closing ? '' : safeImage(tag);
      if (name === 'br' || name === 'hr') return closing ? '' : '<' + name + '>';
      return closing ? '</' + name + '>' : '<' + name + '>';
    });
  }
  function novel(raw) {
    var value = sanitizeNovelHtml(clean(raw.content));
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
