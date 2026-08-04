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
    catch (error) { return { retryable: true, message: '响应不是 JSON' }; }
    if (status >= 400 || Number(parsed.code) !== 0) {
      return {
        ok: false, business: true, code: parsed.code,
        message: String(parsed.msg || parsed.error || ('HTTP ' + status)),
        data: parsed.data, host: host, raw: parsed
      };
    }
    return {
      ok: true, business: false, code: 0, message: String(parsed.msg || ''),
      data: parsed.data, host: host, raw: parsed
    };
  }
  function request(ctx, method, path, query, body, mutating) {
    if (String(path).charAt(0) !== '/' || String(path).indexOf('://') >= 0) throw new Error('服务路径无效');
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

  api.transport = {
    read: function (ctx, path, query) { return request(ctx, 'GET', path, query || {}, null, false); },
    postRead: function (ctx, path, query, body) { return request(ctx, 'POST', path, query || {}, body, false); },
    write: function (ctx, path, body) { return request(ctx, 'POST', path, {}, body, true); },
    requireSuccess: requireSuccess,
    currentHost: function (ctx) { return String(ctx.cache.get(ACTIVE_KEY) || api.config.hosts(ctx)[0]); },
    clearHealth: function (ctx) { ctx.cache.delete(ACTIVE_KEY); ctx.cache.delete(HEALTH_KEY); }
  };
})(WSLPA);
