/** Author: WSL */
var WSLPA = typeof WSLPA === 'object' && WSLPA ? WSLPA : {};
(function (api) {
  var INSECURE_HOST = 'http://219.154.201.122:5006';
  var EMAIL_FIELD = '服务账号邮箱';
  function allHosts() { return api.config.secureHosts.concat([INSECURE_HOST]); }
  function cleanCookie(value) { return String(value || '').trim(); }
  function sessionHost(ctx) {
    var hosts = allHosts();
    for (var index = 0; index < hosts.length; index += 1) {
      if (cleanCookie(ctx.java.getCookie(hosts[index]))) return hosts[index];
    }
    return '';
  }
  function refresh(ctx) { ctx.java.refreshUi('login'); ctx.java.refreshUi('explore'); }
  function row(name, action, cols) {
    return { name: name, type: 'button', action: action, style: { cols: cols || 2 } };
  }
  function ui(ctx) {
    var config = api.config.read(ctx);
    var host = sessionHost(ctx);
    var values = [
      { name: host ? '状态：检测到登录 Cookie' : '状态：匿名', type: 'title', style: { cols: 1 } },
      { name: EMAIL_FIELD, type: 'text', style: { cols: 1 } },
      row('打开登录页面', 'WSLPA.auth.openLogin(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('检查登录状态', 'WSLPA.auth.check(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('退出全部节点', 'WSLPA.auth.logout(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('清除节点记录', 'WSLPA.auth.clearHealth(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('节点：' + (config.nodeMode === 'auto' ? '自动' : config.fixedHost), 'WSLPA.auth.cycleNode(WSLPA.ctx(java, source, cache, cookie));', 1),
      row('发现：' + config.channel, 'WSLPA.auth.toggleChannel(WSLPA.ctx(java, source, cache, cookie));', 2),
      row('书架同步：' + (config.syncBookshelf ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'syncBookshelf');", 2),
      row('评论：' + (config.reviews ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'reviews');", 2),
      row('明文末级节点：' + (config.allowInsecure ? '开' : '关'), "WSLPA.auth.toggle(WSLPA.ctx(java, source, cache, cookie), 'allowInsecure');", 2),
      row('刷新发现栏目', "java.refreshUi('explore');", 1)
    ];
    return JSON.stringify(values);
  }
  function openLogin(ctx) {
    ctx.java.startBrowser(api.transport.currentHost(ctx) + '/login', 'WSL·精品聚合登录');
  }
  function check(ctx) {
    var host = sessionHost(ctx);
    ctx.java.longToast(host ? '已检测到当前节点的登录 Cookie' : '当前为匿名状态');
    refresh(ctx);
    return !!host;
  }
  function logout(ctx) {
    // 重要逻辑：只清理本书源声明的服务节点，避免影响用户在其他网站的登录 Cookie。
    allHosts().forEach(function (host) { ctx.cookie.removeCookie(host); });
    refresh(ctx);
  }
  function toggle(ctx, key) {
    var config = api.config.read(ctx);
    var patch = {};
    patch[key] = !config[key];
    api.config.write(ctx, patch);
    refresh(ctx);
  }
  function toggleChannel(ctx) {
    var config = api.config.read(ctx);
    api.config.write(ctx, { channel: config.channel === '男频' ? '女频' : '男频' });
    refresh(ctx);
  }
  function cycleNode(ctx) {
    var config = api.config.read(ctx);
    var hosts = api.config.secureHosts;
    if (config.nodeMode === 'auto') {
      api.config.write(ctx, { nodeMode: 'fixed', fixedHost: hosts[0] });
    } else {
      var next = hosts.indexOf(config.fixedHost) + 1;
      if (next >= hosts.length) api.config.write(ctx, { nodeMode: 'auto', fixedHost: '' });
      else api.config.write(ctx, { nodeMode: 'fixed', fixedHost: hosts[next] });
    }
    api.transport.clearHealth(ctx);
    refresh(ctx);
  }
  function clearHealth(ctx) { api.transport.clearHealth(ctx); refresh(ctx); }
  function email(ctx) {
    // 邮箱只从 Legado 自带的加密 loginInfo 读取，不复制到四书源共享的普通 cache。
    var info = ctx.source.getLoginInfoMap ? ctx.source.getLoginInfoMap() : null;
    var raw = info && typeof info.get === 'function' ? info.get(EMAIL_FIELD) : (info ? info[EMAIL_FIELD] : '');
    var value = raw ? String(raw).trim() : '';
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : '';
  }

  api.auth = {
    ui: ui, openLogin: openLogin, check: check, logout: logout, toggle: toggle,
    toggleChannel: toggleChannel, cycleNode: cycleNode, clearHealth: clearHealth,
    hasSession: function (ctx) { return !!sessionHost(ctx); },
    // /get_avatar 的请求密钥尚待账号态捕获；邮箱由用户在当前书源登录面板中保存到加密 loginInfo。
    email: email
  };
})(WSLPA);
