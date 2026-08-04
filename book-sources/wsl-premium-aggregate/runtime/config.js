/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var PREFIX = 'wsl_premium_aggregate:';
  var CONFIG_KEY = PREFIX + 'config';
  var DEFAULTS = {
    nodeMode: 'auto', fixedHost: '', channel: '男频',
    syncBookshelf: false, reviews: true, allowInsecure: false
  };
  var ALLOWED = {
    nodeMode: true, fixedHost: true, channel: true,
    syncBookshelf: true, reviews: true, allowInsecure: true
  };
  var SECURE_HOSTS = [
    'https://v10.czyl.cf', 'https://v4.czyl.cf', 'https://v2.czyl.cf',
    'https://api.langge.cf', 'https://20.langge.tk'
  ];
  var MEDIA = { novel: '小说', audio: '听书', image: '漫画', video: '短剧' };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function read(ctx) {
    var value = clone(DEFAULTS);
    var raw = ctx.cache.get(CONFIG_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(String(raw));
        Object.keys(ALLOWED).forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(saved, key)) value[key] = saved[key];
        });
      } catch (error) {
        ctx.cache.delete(CONFIG_KEY);
      }
    }
    return value;
  }
  function validate(value) {
    if (['auto', 'fixed'].indexOf(value.nodeMode) < 0) throw new Error('节点策略无效');
    if (['男频', '女频'].indexOf(value.channel) < 0) throw new Error('发现频道无效');
    if (value.nodeMode === 'fixed' && !value.fixedHost) throw new Error('固定节点不能为空');
    if (value.fixedHost && SECURE_HOSTS.indexOf(value.fixedHost) < 0) throw new Error('固定节点无效');
    return value;
  }
  function write(ctx, patch) {
    Object.keys(patch).forEach(function (key) {
      if (!ALLOWED[key]) throw new Error('不支持的配置字段: ' + key);
    });
    var value = read(ctx);
    Object.keys(patch).forEach(function (key) { value[key] = patch[key]; });
    validate(value);
    ctx.cache.put(CONFIG_KEY, JSON.stringify(value));
    return value;
  }
  function media(ctx) {
    var key = String(ctx.source.getKey());
    var suffix = key.substring(key.lastIndexOf('-') + 1);
    if (!MEDIA[suffix]) throw new Error('书源媒体主键无效: ' + key);
    return MEDIA[suffix];
  }
  function hosts(ctx) {
    var config = read(ctx);
    var values = SECURE_HOSTS.slice();
    if (config.allowInsecure) values.push('http://219.154.201.122:5006');
    if (config.nodeMode === 'fixed') return [config.fixedHost];
    return values;
  }

  api.ctx = function (javaValue, sourceValue, cacheValue, cookieValue) {
    return { java: javaValue, source: sourceValue, cache: cacheValue, cookie: cookieValue };
  };
  api.config = {
    prefix: PREFIX,
    secureHosts: SECURE_HOSTS.slice(),
    hosts: hosts,
    media: media,
    read: read,
    write: write
  };
})(WSLPA);
