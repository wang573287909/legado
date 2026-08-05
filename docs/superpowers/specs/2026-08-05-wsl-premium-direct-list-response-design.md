# WSL 精品聚合列表直连响应设计

## 1. 背景与根因

`WSL·精品聚合` 当前由 `search.url()` 和 `explore.url()` 先在 JavaScript 中请求服务器，再把完整响应放入 `WSLPA.responseStashes`，最后返回只包含 `wsl-response:*` 键的 typed data URL。列表规则在第二次 JavaScript 求值中使用该键取回响应。

宿主的 `SharedJsScope` 只保留 Rhino 作用域的弱引用。URL 求值与列表解析之间一旦作用域被回收或重建，第二次求值只剩响应键，实际书单已经丢失。使用两个独立 Rhino 作用域可稳定复现：作用域 A 生成响应键，作用域 B 解析时得到“响应内存已失效”。

同期实时证据表明，服务器的“推荐榜”第一页正常返回 100 本书，因此空列表产生于宿主内的响应交接边界，不是榜单接口无数据。

## 2. 目标与范围

本次修改要达到：

1. 搜索与发现榜单不再依赖跨 Rhino 作用域的响应内存。
2. `searchUrl` 和动态发现 URL 返回真实 `http/https` 地址，由宿主发起列表请求。
3. 书籍详情、目录、章节正文的结构化状态继续使用 `data:application/json;base64,...,{"type":"wslpa"}`。
4. 发现栏目仍显示为可点击 URL 项，不在栏目对象上设置 `type: "text"`。
5. 搜索语法、媒体类型校验、书籍状态字段白名单和服务器响应验证继续保留。

本次不改动详情、目录、正文、登录、书架写入和评论的业务协议。评论响应暂存不是当前可见空书单的触发路径，保持原状。

## 3. 方案选择

已选择方案 A：列表请求使用真实 HTTPS URL。

未采用的方案及原因：

- 把完整书单放入 data URL：一页可包含 100 本书及简介，URL 体积和日志暴露面过大。
- 把完整书单写入持久缓存：需要额外容量、过期和并发覆盖策略，且没有必要保存用户浏览的列表内容。

## 4. 组件设计

### 4.1 `transport.js`

增加两个公开能力：

- `url(ctx, path, query)`：从已记录的活动节点或当前配置的首选节点构造绝对 HTTP(S) URL。路径必须以 `/` 开头且不得包含新的 origin。
- `parseRead(ctx, path, body)`：把宿主已经获取的 JSON 字符串按一次成功的 HTTP 响应解析，执行现有 `code` 信封检查、端点字段校验和业务错误提示，成功时返回服务器原始 JSON 对象（保留 `data`、`has_more` 等字段），而不是内部传输包装对象。

`url()` 不发起请求。搜索与榜单的真正请求只由 Legado 执行一次。URL 生成时读取活动节点；尚无活动节点时使用配置中的第一个节点。列表直连不再提供 JavaScript 内的单请求多节点重试；已通过发现栏目请求验证的活动节点优先使用，用户仍可通过登录面板切换固定节点或清除节点记录。

列表规则输入只有响应正文、不暴露 HTTP status；连接错误由宿主显示。若宿主继续解析非 2xx body，本实现仍只能依据严格 `code` 信封与 endpoint schema 判定。

### 4.2 `search.js`

`search.url(ctx, keyword, page)` 解析原有 `书名@来源` 语法后，调用 `transport.url()` 生成 `/search` 的绝对 URL，不再调用 `transport.read()` 或 `state.stash()`。

`search.response(ctx, body)` 调用 `transport.parseRead(ctx, "/search", body)`。`list()` 继续把服务器条目映射为 Legado 书籍列表，并通过 `state.toDataUri()` 生成带 `wslpa` 标记的 `bookUrl`。

### 4.3 `explore.js`

`explore.kinds()` 继续请求 `/discovestyle`、清洗服务器栏目 URL 并保存发现查询状态。

`explore.url(ctx, encodedState, page)` 解码查询状态后，使用 `transport.url()` 生成 `/get_discover` 绝对 URL，不再在此处预取书单。

`explore.response(ctx, body)` 调用 `transport.parseRead(ctx, "/get_discover", body)`。列表映射继续复用 `search.mapItem()`。

## 5. 数据流

### 5.1 发现榜单

1. Legado 求值 `exploreUrl`，`explore.kinds()` 获取栏目。
2. 用户点击“推荐榜”。
3. `explore.url()` 返回 `https://ACTIVE_HOST/get_discover?...&page=1`。
4. Legado 直接请求该 URL，把服务器 JSON 作为规则 `result`。
5. `explore.list()` 验证响应并映射书籍。
6. 每本书的 `bookUrl` 仍是自包含的 typed data URL，后续详情流程不依赖列表作用域。

### 5.2 搜索

1. Legado 求值 `searchUrl`，得到 `https://ACTIVE_HOST/search?...`。
2. Legado 获取服务器 JSON。
3. `search.list()` 在当前规则求值中直接解析 JSON 并映射书籍。

## 6. 错误处理

- 服务器响应不是 JSON、缺少有效 `code`、`code != 0` 或书籍字段缺失时，`parseRead()` 抛出明确错误，不把损坏响应解析成空列表；连接错误由 Legado 报告；HTTP response 若进入规则，由严格 code/schema 决定，不声称 status 可见。
- `transport.url()` 拒绝绝对路径注入，只允许使用书源内声明的服务节点。
- `hasMore` 优先使用服务器的布尔字段；字段缺失时，当页有书就允许请求下一页。
- 空 `data` 是合法的到底页；字段结构损坏则是可见错误，两者不混同。

## 7. 测试与验收

自动测试要覆盖：

1. `transport.url()` 正确编码查询参数，优先使用活动节点，并拒绝外部 origin。
2. `transport.parseRead()` 对搜索和发现响应复用既有信封与字段校验。
3. `search.url()` 和 `explore.url()` 返回 `http/https` URL，不返回 `data:` 或 `wsl-response:*` 键。
4. 在两个完全独立的 Rhino 运行时中，第二个运行时仅使用原始 HTTP JSON 就能映射出书籍，不需要第一个运行时的 `responseStashes`。
5. 发现项仍省略 UI `type`，动态 `@js:` 包装器可由 Rhino 编译。
6. 发现、搜索、详情、目录和一次正文的实时链路通过。
7. 聚合书源全量离线测试、起点书源回归、Rhino 1.9.1 加载、确定性构建和 CDN 内容校验通过。

人工验收标准：覆盖导入后点击“推荐榜”可见书籍卡片，翻页时页码进入实际 HTTPS 请求，不再出现首页空白后直接到底的现象。

## 8. 发布与迁移

- 提升四个书源的 `lastUpdateTime`，使覆盖导入选中新定义。
- 更换 `exploreUrl` 中的发现缓存标记，使宿主重建动态栏目 URL。
- 新生成的搜索和发现书籍使用 typed `bookUrl`。旧版已存入书架的裸 data URL 条目仍需通过重新搜索并加入书架来更新。
