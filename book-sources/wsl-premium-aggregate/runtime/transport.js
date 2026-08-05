/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var ACTIVE_KEY = api.config.prefix + 'active_host';
  var HEALTH_KEY = api.config.prefix + 'host_health';
  var COOLDOWN_MS = 10 * 60 * 1000;

  function queryString(query) {
    return Object.keys(query || {}).filter(function (key) {
      return query[key] !== undefined && query[key] !== null;
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key]));
    }).join('&');
  }
  function servicePath(path) {
    var value = String(path || '');
    if (value.charAt(0) !== '/' || value.substring(0, 2) === '//' ||
        value.indexOf('://') >= 0 || value.indexOf('?') >= 0 || value.indexOf('#') >= 0 ||
        /[\r\n]/.test(value)) {
      throw new Error('服务路径无效');
    }
    return value;
  }
  function health(ctx) {
    try { return JSON.parse(String(ctx.cache.get(HEALTH_KEY) || '{}')); } catch (error) { return {}; }
  }
  function saveHealth(ctx, value) { ctx.cache.put(HEALTH_KEY, JSON.stringify(value)); }
  function markFailure(ctx, host) {
    var value = health(ctx);
    value[host] = Date.now();
    saveHealth(ctx, value);
  }
  function candidates(ctx, mutating) {
    var hosts = api.config.hosts(ctx);
    var active = ctx.cache.get(ACTIVE_KEY);
    if (active && hosts.indexOf(String(active)) >= 0) {
      hosts.splice(hosts.indexOf(String(active)), 1);
      hosts.unshift(String(active));
    }
    var state = health(ctx);
    var now = Date.now();
    var available = hosts.filter(function (host) {
      return !state[host] || now - state[host] >= COOLDOWN_MS;
    });
    // 全部节点都在冷却时只探测首选节点一次，避免候选列表为空后永久失去恢复机会。
    hosts = available.length ? available : hosts.slice(0, 1);
    return mutating ? hosts.slice(0, 1) : hosts;
  }
  function parseEnvelope(host, status, text) {
    if (status >= 500) return { retryable: true, message: 'HTTP ' + status };
    var parsed;
    try { parsed = JSON.parse(String(text || '')); }
    catch (error) {
      // 重要逻辑：HTTP 4xx 本身已是确定的业务响应，即使错误页不是 JSON 也不轮换节点。
      if (status >= 400) {
        return {
          ok: false, business: true, code: status, message: 'HTTP ' + status,
          data: null, host: host, raw: null
        };
      }
      return { retryable: true, message: '响应不是 JSON' };
    }
    if (status >= 400) {
      var errorEnvelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return {
        ok: false, business: true, code: errorEnvelope.code === undefined ? status : errorEnvelope.code,
        message: String(errorEnvelope.msg || errorEnvelope.error || ('HTTP ' + status)),
        data: errorEnvelope.data, host: host, raw: parsed
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Object.prototype.hasOwnProperty.call(parsed, 'code') ||
        parsed.code === null || String(parsed.code).trim() === '' || !isFinite(Number(parsed.code))) {
      return { retryable: true, message: '响应 code 无效' };
    }
    if (Number(parsed.code) !== 0) {
      return {
        ok: false, business: true, code: Number(parsed.code),
        message: String(parsed.msg || parsed.error || '服务返回业务错误'),
        data: parsed.data, host: host, raw: parsed
      };
    }
    return {
      ok: true, business: false, code: 0, message: String(parsed.msg || ''),
      data: parsed.data, host: host, raw: parsed
    };
  }
  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function httpUrl(value) { return /^https?:\/\/[^\s]+$/i.test(clean(value)); }
  function novelReadable(value) {
    var html = clean(value)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    var safeImage = false;
    html.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (_, url) {
      if (httpUrl(url)) safeImage = true;
      return '';
    });
    // 重要逻辑：小说节点只有在净化后仍含可读文本或安全图片时才算成功，空壳响应留在候选循环内切换。
    var text = html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);?/gi, ' ').replace(/\u00a0/g, ' ').trim();
    return safeImage || !!text;
  }
  function mediaMatches(ctx, item) {
    return !item.tab || String(item.tab).trim() === api.config.media(ctx);
  }
  function booksValid(ctx, data) {
    if (!Array.isArray(data)) return false;
    return data.every(function (item) {
      return object(item) && item.book_id !== undefined && String(item.book_id).trim() &&
        item.source !== undefined && String(item.source).trim() && mediaMatches(ctx, item);
    });
  }
  function schemaError(ctx, path, envelope) {
    if (path === '/search' || path === '/get_discover') {
      return booksValid(ctx, envelope.data) ? '' : '书籍列表字段无效';
    }
    if (path === '/detail') {
      var detail = envelope.data || {};
      var hasMetadata = ['book_name', 'author', 'abstract', 'thumb_url', 'category', 'last_chapter_title']
        .some(function (key) { return !!clean(detail[key]); });
      return object(detail) && hasMetadata && mediaMatches(ctx, detail) ? '' : '详情字段无效';
    }
    if (path === '/catalog') {
      if (!Array.isArray(envelope.data)) return '目录字段无效';
      return envelope.data.every(function (item) {
        return object(item) && clean(item.title) && mediaMatches(ctx, item) &&
          (item.is_volume === true || !!clean(item.item_id));
      }) ? '' : '目录字段无效';
    }
    if (path === '/discovestyle') {
      return Array.isArray(envelope.data) && envelope.data.every(object) ? '' : '发现栏目字段无效';
    }
    if (path === '/content') {
      var raw = envelope.raw || {};
      var media = api.config.media(ctx);
      if (media === '小说') return novelReadable(raw.content) ? '' : '正文字段无效';
      if (media === '听书') return httpUrl(raw.content) ? '' : '音频字段无效';
      if (media === '漫画') {
        var count = 0;
        var valid = true;
        clean(raw.content).replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, function (_, url) {
          count += 1;
          if (!httpUrl(url)) valid = false;
          return '';
        });
        return count > 0 && valid ? '' : '漫画字段无效';
      }
      if (media === '短剧') {
        if (Array.isArray(raw.contents) && raw.contents.length) {
          return raw.contents.every(function (item) { return object(item) && httpUrl(item.url); }) ? '' : '视频字段无效';
        }
        return httpUrl(raw.content) ? '' : '视频字段无效';
      }
      return '正文媒体类型无效';
    }
    if (path === '/para_review') {
      return object(envelope.data) && Array.isArray(envelope.data.comments) &&
        envelope.data.comments.every(object) ? '' : '评论字段无效';
    }
    if (path === '/check_book_in_book_shelf') {
      return object(envelope.data) ? '' : '书架检查字段无效';
    }
    return '';
  }
  function request(ctx, method, path, query, body, mutating) {
    path = servicePath(path);
    var hosts = candidates(ctx, mutating);
    var lastError = null;
    for (var index = 0; index < hosts.length; index += 1) {
      var host = hosts[index];
      var qs = queryString(query);
      var url = host + path + (qs ? '?' + qs : '');
      var option = { method: method, retry: 0, headers: { Accept: 'application/json' } };
      if (body !== null && body !== undefined) {
        option.headers['Content-Type'] = 'application/json; charset=utf-8';
        option.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      try {
        var response = ctx.java.connect(url + ',' + JSON.stringify(option));
        var envelope = parseEnvelope(host, Number(response.code()), response.body());
        if (envelope.retryable) {
          markFailure(ctx, host);
          lastError = new Error(envelope.message);
          if (mutating) throw lastError;
          continue;
        }
        var invalid = envelope.ok && !mutating ? schemaError(ctx, path, envelope) : '';
        if (invalid) {
          markFailure(ctx, host);
          lastError = new Error(invalid);
          continue;
        }
        ctx.cache.put(ACTIVE_KEY, host);
        return envelope;
      } catch (error) {
        markFailure(ctx, host);
        lastError = error;
        // 重要逻辑：写请求响应不确定时立即停止，避免在备用节点重复添加或提交。
        if (mutating) throw error;
      }
    }
    throw lastError || new Error('没有可用服务节点');
  }
  function requireSuccess(ctx, envelope) {
    if (!envelope.ok) {
      ctx.java.longToast(envelope.message);
      throw new Error(envelope.message);
    }
    return envelope;
  }
  function currentHost(ctx) {
    var hosts = api.config.hosts(ctx);
    var active = String(ctx.cache.get(ACTIVE_KEY) || '');
    if (active && hosts.indexOf(active) >= 0) return active;
    if (!hosts.length) throw new Error('没有可用服务节点');
    return String(hosts[0]);
  }
  function buildUrl(ctx, path, query) {
    var safePath = servicePath(path);
    var qs = queryString(query || {});
    // 重要逻辑：搜索与榜单只返回真实网络 URL，让 Legado 获取响应体，避免跨 Rhino 作用域传递内存键。
    return currentHost(ctx) + safePath + (qs ? '?' + qs : '');
  }
  function parseRead(ctx, path, body) {
    var safePath = servicePath(path);
    // 重要逻辑：列表规则只接收宿主在成功 HTTP 请求后提供的正文；连接和 HTTP 状态错误已由宿主网络层处理。
    var envelope = parseEnvelope(currentHost(ctx), 200, body);
    if (envelope.retryable) throw new Error(envelope.message);
    var invalid = envelope.ok ? schemaError(ctx, safePath, envelope) : '';
    if (invalid) throw new Error(invalid);
    return requireSuccess(ctx, envelope).raw;
  }

  api.transport = {
    url: buildUrl,
    parseRead: parseRead,
    read: function (ctx, path, query) { return request(ctx, 'GET', path, query || {}, null, false); },
    postRead: function (ctx, path, query, body) { return request(ctx, 'POST', path, query || {}, body, false); },
    write: function (ctx, path, body) { return request(ctx, 'POST', path, {}, body, true); },
    requireSuccess: requireSuccess,
    currentHost: currentHost,
    clearHealth: function (ctx) { ctx.cache.delete(ACTIVE_KEY); ctx.cache.delete(HEALTH_KEY); }
  };
})(WSLPA);
