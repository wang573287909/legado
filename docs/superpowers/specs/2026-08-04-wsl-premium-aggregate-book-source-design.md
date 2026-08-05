# WSL 精品聚合书源设计

- Author: WSL
- Date: 2026-08-04
- Status: 已确认，等待书面规格复核

## 1. 背景

目标是在 Legado 3.x 中提供一份独立、可直接导入的聚合书源 JSON。书源使用 [YckCeo 示例书源 7595](https://www.yckceo.com/yuedu/shuyuan/content/id/7595.html) 当前使用的服务端接口，但客户端规则采用黑盒协议观察后的独立实现，不复制示例书源 `jsLib` 中的函数体、变量组织或控制流程。

用户只需导入一个 `wsl-premium-aggregate.json` 文件。该文件包含小说、听书、漫画和短剧四个书源对象，使 Legado 能按当前分支的 `bookSourceType` 分别进入文本阅读器、音频播放器、漫画阅读器和视频播放器。

该功能不需要修改 Android、Kotlin、Java 或 Gradle 代码。所有产物位于 `book-sources/` 和对应文档目录，并与原始 `7595` 书源及现有 `qidian-mobile-free` 书源共存。

## 2. 已确认范围

### 2.1 目标

1. 一个 JSON 文件一次导入四个原生媒体类型书源。
2. 支持搜索、详情、目录、正文和分页。
3. 支持服务端发现栏目和排行榜。
4. 支持服务端登录、登录状态检查和退出。
5. 支持健康节点选择与自动故障切换。
6. 支持服务端书架检查、添加和阅读进度同步。
7. 支持书评、章评、段评及服务端已经提供的评论操作。
8. 保持所有账号状态、节点状态和设置在四个书源之间一致。
9. 提供确定性构建、静态测试、脱敏夹具测试和匿名实时链路测试。
10. 所有新增脚本文件头使用 `Author: WSL`；协议、故障切换、媒体分派和写操作重试边界使用中文注释解释重要逻辑。

### 2.2 约束

1. 依赖示例书源当前使用的第三方服务端，客户端不自建后端。
2. 原始书源只作为不透明客户端运行。允许记录它发出的请求方法、路径、参数名、请求体字段、响应字段和错误语义，不读取或复用其函数实现。
3. Cookie、Token、账号、正文、评论原文和其他用户数据不得写入仓库、测试快照或调试日志。
4. 登录、书架同步和评论的最终账号态验证由用户稍后在 Legado 中人工执行；实现阶段仍需使用合成数据和脱敏协议夹具覆盖其控制流。
5. 匿名内容配额是服务端业务状态，不通过轮换节点重复消耗。

## 3. 交付物与目录

实现阶段新增以下结构：

```text
book-sources/
├── wsl-premium-aggregate.json
├── wsl-premium-aggregate/
│   ├── source.template.json
│   ├── build.mjs
│   ├── protocol/
│   │   ├── capture.mjs
│   │   ├── observed-api.json
│   │   └── fixtures/
│   │       ├── search.json
│   │       ├── detail.json
│   │       ├── catalog.json
│   │       ├── discover-style.json
│   │       ├── discover-list.json
│   │       ├── content-novel.json
│   │       ├── content-audio.json
│   │       ├── content-image.json
│   │       ├── content-video.json
│   │       ├── auth.json
│   │       ├── bookshelf.json
│   │       └── review.json
│   └── runtime/
│       ├── config.js
│       ├── transport.js
│       ├── state.js
│       ├── search.js
│       ├── detail.js
│       ├── catalog.js
│       ├── content.js
│       ├── auth.js
│       ├── explore.js
│       ├── review.js
│       └── bookshelf.js
└── tests/
    └── wsl-premium-aggregate.test.mjs
```

`book-sources/README.md` 增加导入方法、能力说明、服务器依赖、匿名配额和人工验收步骤。本设计文档保留在 `docs/superpowers/specs/2026-08-04-wsl-premium-aggregate-book-source-design.md`。

`build.mjs` 按固定模块顺序把开发期文件合并进最终书源的 `jsLib`。最终用户只需要 `wsl-premium-aggregate.json`，运行时不从仓库或网络加载这些模块。

## 4. 四书源生成模型

最终 JSON 是长度为 4 的数组：

| 名称 | 分组 | `bookSourceType` | `bookSourceUrl` |
| --- | --- | ---: | --- |
| `WSL·精品聚合·小说` | `WSL·精品聚合` | `0` | `https://www.qidian.com/#wsl-premium-aggregate-novel` |
| `WSL·精品聚合·听书` | `WSL·精品聚合` | `1` | `https://www.qidian.com/#wsl-premium-aggregate-audio` |
| `WSL·精品聚合·漫画` | `WSL·精品聚合` | `2` | `https://www.qidian.com/#wsl-premium-aggregate-image` |
| `WSL·精品聚合·短剧` | `WSL·精品聚合` | `4` | `https://www.qidian.com/#wsl-premium-aggregate-video` |

四个对象都设置：

- `enabled: true`
- `enabledExplore: true`
- `enabledReview: true`
- `enabledCookieJar: true`
- `enableDangerousApi: false`

模板中的媒体常量分别是 `小说`、`听书`、`漫画` 和 `短剧`。构建器只替换白名单字段，不通过字符串全局替换生成 JSON。四个 `bookSourceUrl` 是数据库主键和状态命名空间，不作为服务端请求地址。

发现布局分别使用：小说单列、听书单列、漫画三列封面、短剧 `0x12` 两列视频卡片。

## 5. 黑盒协议证据边界

### 5.1 允许记录的证据

1. HTTP 方法、服务域名、路径和状态码。
2. 查询参数、表单字段、JSON 字段和请求头名称。
3. 响应信封、字段名称、字段类型、数组长度和错误码语义。
4. 经过替换或清空后的示例 ID、URL、标题和内容。
5. 响应时间、超时、TLS 错误和节点可用性。

### 5.2 不进入实现的内容

1. 示例书源 `jsLib` 的函数体、变量命名和控制流。
2. 示例书源登录 UI 的脚本实现。
3. Cookie、Token、用户名、密码、设备标识或账号密钥。
4. 小说正文、音频签名地址、整套漫画图片地址、视频签名地址和评论原文。

### 5.3 证据准入流程

认证、书架、评论和媒体正文模块必须按以下顺序实现：

1. 把原始 `7595` 作为不透明客户端运行。
2. 匿名读取和媒体字段映射捕获一条成功响应及至少一条业务失败响应；账号写接口捕获一条被服务器识别的请求及其业务响应。
3. 使用 `capture.mjs` 删除敏感头、密钥和值域内容，并用固定合成值代替。
4. 在 `observed-api.json` 登记方法、路径、字段和响应状态。
5. 保存最小化夹具，并先为该契约编写失败测试。
6. 独立编写运行时模块，使测试通过。

缺少成功响应夹具时，配额或错误响应只能验证错误处理，不作为成功字段映射依据。登录态写接口可以先依据已观察的请求契约和统一 `code/msg` 信封实现，但在用户完成账号态人工验收前必须标记为“实现完成、登录态待实测”，不得声称成功链路已经通过。

## 6. 当前已观察协议

### 6.1 节点

匿名搜索已验证以下节点返回 `code: 0`：

```text
https://v10.czyl.cf
https://v4.czyl.cf
https://v2.czyl.cf
https://api.langge.cf
https://20.langge.tk
http://219.154.201.122:5006
```

安全节点池默认只启用前五个 HTTPS 地址。明文 IP 节点只在用户打开“明文末级节点”后加入队列。`https://legado.langge.cf/search` 和 `https://sy.langge.cf/search` 当前返回 404，不进入节点池；其他仅出现在示例配置、但未实测成功的域名也不进入生成物。

### 6.2 已实测端点

| 功能 | 方法与路径 | 当前证据 |
| --- | --- | --- |
| 搜索 | `GET /search` | 四种媒体均返回统一书籍列表字段 |
| 详情 | `GET /detail` | 四种媒体均返回统一详情字段 |
| 目录 | `GET /catalog` | 小说、听书、漫画、短剧目录均已返回成功 |
| 正文 | `POST /content`，JSON | 请求结构被接受；当前匿名配额返回业务错误，仍需成功正文夹具 |
| 发现栏目 | `GET /discovestyle` | 四种媒体均返回 `ExploreKind` 风格数组 |
| 发现列表 | `GET /get_discover` | 四种媒体均返回统一书籍列表字段 |
| 登录页 | `GET /login` | 返回认证中心 HTML |
| 注册页 | `GET /register` | 返回注册页面 HTML |
| 登录检查 | `GET /get_avatar` | 匿名请求返回缺少密钥业务错误 |

正文请求已观察到的 JSON 字段为：

```json
{
  "html": "",
  "item_id": "ITEM_ID",
  "source": "SOURCE",
  "tab": "小说",
  "tone_id": "4",
  "variable": "{\"custom\":\"\"}",
  "version": "4.11.5.1"
}
```

### 6.3 待按证据流程确认的端点

以下路径已从网络可见配置或请求候选中发现，但在实现前仍需捕获完整方法和响应契约：

```text
/online_video
/check_book_in_book_shelf
/add_book_to_book_shelf
/update_book_shelf
/get_book_shelf
/para_review
/get_para_review
/get_review
/post_idea_review
```

这些端点是已确认交付范围，不使用猜测字段实现。完成标准要求它们全部经过第 5.3 节的准入流程。

## 7. 传输与节点切换

`transport.js` 是所有服务请求的唯一入口，业务模块不得直接拼接服务域名。

标准化返回值为：

```javascript
{
  ok: true,
  code: 0,
  message: "",
  data: [],
  host: "https://v10.czyl.cf"
}
```

节点策略如下：

1. 优先使用共享缓存中的活动节点；没有活动节点时按 HTTPS 列表顺序选择。
2. DNS、连接超时、TLS 错误、HTTP 5xx 或响应信封损坏会把节点置为冷却状态并尝试下一个节点。
3. HTTP 4xx、服务端 `code != 0`、登录失效、内容配额和参数错误直接返回业务层，不触发轮换。
4. 每次请求对每个候选节点最多尝试一次，成功节点写入共享粘性状态；失败节点冷却 10 分钟。
5. 搜索、详情、目录、发现、评论读取以及语义只读的 `/content` POST 可以自动故障切换。
6. 添加书架、更新进度、提交评论等写操作在响应不确定时不自动重放，避免重复写入；只为下一次操作更新活动节点。
7. 切换节点只提示一次。业务错误显示服务端 `msg`，不得改写为网络故障。

共享状态键为：

```text
wsl_premium_aggregate:config
wsl_premium_aggregate:active_host
wsl_premium_aggregate:host_health
wsl_premium_aggregate:sync_throttle
```

缓存中只保存配置、时间戳和节点状态，不保存认证信息。

## 8. 状态编码与数据模型

搜索、发现、书籍、目录、正文和评论的内部状态使用 `data:application/json;base64,...,{"type":"wslpa"}` URL。`type` 是宿主的本地字节解码标记：Legado-E 只在该选项存在时从 `data:` 直接取数据，避免将状态地址交给 OkHttp。书源内部解码状态时会先分离逗号后的 Legado URL 选项。

书籍状态：

```javascript
{
  v: 1,
  bookId: "BOOK_ID",
  source: "番茄",
  tab: "小说",
  bookUrl: "",
  tocUrl: ""
}
```

章节状态：

```javascript
{
  v: 1,
  bookId: "BOOK_ID",
  itemId: "ITEM_ID",
  source: "番茄",
  tab: "小说",
  title: "第一章",
  url: ""
}
```

解码器验证版本、字段类型、允许的 `tab` 和最大长度。未知版本、缺少 ID 或包含 `cookie`、`token`、`password` 等敏感键的状态直接报错。状态中不保存认证信息。

## 9. 搜索、详情与目录

### 9.1 搜索语法

每个书源固定媒体类型，普通输入直接作为书名：

```text
斗破苍穹
```

可用最后一个单独的 `@` 指定上游来源：

```text
斗破苍穹@番茄
斗破苍穹@猫眼
```

`@@` 表示书名中的普通 `@`。没有来源后缀时 `source` 为空，由服务端聚合所有来源。空关键词不发起请求。

搜索参数为：

```text
title=KEY
tab=小说|听书|漫画|短剧
source=SOURCE
page={{page}}
disabled_sources=0
```

### 9.2 公共字段映射

搜索和发现列表共用映射器：

| 服务字段 | Legado 字段 |
| --- | --- |
| `book_name` | `name` |
| `author` | `author` |
| `abstract` | `intro` |
| `thumb_url` | `coverUrl` |
| `category + tags + status + source` | `kind` |
| `word_number` | `wordCount` |
| `last_chapter_title` | `lastChapter` |
| `last_chapter_update_time` | `updateTime` |
| `book_id + source + tab` | 编码后的 `bookUrl` |

同名书籍只要 `source` 或 `book_id` 不同就保留为独立结果。

### 9.3 详情

详情调用：

```text
GET /detail?book_id=...&source=...&tab=...&variable=...
```

详情结果补齐评分、角色、版权信息和媒体说明。服务端空字符串不得覆盖搜索阶段已经取得的非空封面、简介或作者。详情生成同一状态模型的 `tocUrl`。

### 9.4 目录

目录调用：

```text
GET /catalog?book_id=...&source=...&tab=...&variable=...
```

目录按服务端顺序返回。`is_volume` 映射到卷节点，`is_pay` 映射到 VIP，`item_id` 写入章节状态。当前实测样本分别返回小说 1,914 章、听书 190 集、漫画 554 话和短剧 34 集。

## 10. 四种正文适配器

`content.js` 先验证统一响应信封，再按状态中的 `tab` 分派。每种适配器都必须有一份成功的脱敏夹具。

### 10.1 小说

提取服务端正文 HTML，清除脚本、样式、事件属性和无关容器，保留段落、换行和正文图片。返回值是 Legado 文本阅读器可格式化的 HTML。

### 10.2 听书

提取可播放音频 URL及其必要请求头。`ruleContent.content` 返回直接播放 URL；如服务端还提供封面或歌词，则分别映射到当前分支的 `musicCover` 和 `musicLrc` 规则。签名 URL不写入持久化夹具。

### 10.3 漫画

按服务端顺序提取图片 URL，过滤重复项并生成仅含 `<img src="...">` 的正文 HTML。当前分支的漫画阅读器会从正文中抽取图片节点。图片所需 Referer 或其他请求头通过 Legado URL 选项携带，不拼进日志。

### 10.4 短剧

优先使用 `/online_video` 取得播放信息。适配器按当前分支能力返回 `VideoSource` JSON，包含清晰度列表、默认清晰度和必要请求头；只有单一路径时可以返回直接视频 URL。多清晰度文本回退格式为每行 `清晰度::URL`。

正文业务错误、配额提示和登录提示原样传递，且不触发节点轮换。

## 11. 发现页

四种媒体的 `/discovestyle` 当前分别返回 373、385、181 和 265 个栏目，所有可点击项目都落到 `/get_discover`。

处理规则：

1. 没有 URL 的栏目转为 `TITLE:` 分组标题。
2. `--` 和空标题占位项丢弃。
3. 服务端四列比例转换为 Legado `FlexChildStyle`。
4. 绝对服务 URL 解析成路径和查询参数，丢弃原节点 origin；打开栏目时重新走 `transport.js`。
5. `/get_discover` 的书籍列表复用第 9.2 节映射器。
6. Legado 缓存发现栏目；用户长按刷新后重新请求当前服务配置。
7. 发现频道默认男频，可在统一设置中切换男频或女频。

## 12. 登录与统一设置

`loginUi` 由运行时动态生成。它从共享缓存读取当前值，并在操作后调用 `java.refreshUi("login")`，因此从四个书源任意一个打开时都显示同一设置。

界面包含：

1. 打开登录页面。
2. 检查登录状态。
3. 退出并清理登录态。
4. 节点策略：自动或固定 HTTPS 节点。
5. 发现频道：男频或女频。
6. 书架同步：开或关。
7. 段评与书评：开或关。
8. 明文末级节点：开或关，默认关。
9. 清除节点健康记录。
10. 刷新发现栏目。

登录按钮使用内置浏览器打开活动节点 `/login`。Cookie 由 Legado 按真实服务域名保存，所以同一节点登录一次后四个书源共享登录态。客户端脚本不读取或保存密码。

节点域名之间的认证状态默认不复制。只有黑盒证据证明某个 Token 是可跨白名单节点使用的同一账号凭据后，才允许同步该特定 Cookie 键；否则故障切换后按匿名状态运行并提示在新节点登录。

退出只删除声明节点的认证 Cookie 和共享登录状态，不清理其他站点 Cookie。

## 13. 书架同步与评论

### 13.1 书架同步

开启同步后：

1. 打开详情时调用检查接口；服务端不存在该书时执行一次添加。
2. 正文成功后按“章节变化且距离上次同步至少 10 分钟”节流更新进度。
3. 添加前检查，使重复打开详情保持幂等。
4. 同步失败不阻断详情、目录、正文或媒体播放。
5. 写请求出现超时或连接中断时不在备用节点自动重放。

### 13.2 评论与段评

`ruleReview` 映射服务端已观察到的评论 ID、头像、用户名、内容、时间、图片、点赞数、回复数和分页状态。书籍级使用 `paragraphIndex = -1`，章节级使用 `0`，段落级使用正整数。

读取评论可以按读请求故障切换。发表、回复、点赞、点踩和删除只有在对应服务端请求被实际观察后才启用；所有写操作不自动重放。关闭“段评与书评”时不发出评论请求。

## 14. 错误、日志与隐私

| 情况 | 行为 |
| --- | --- |
| 搜索无结果 | 返回空数组，保留正常分页语义 |
| 传输、TLS 或 5xx | 标记节点冷却并切换健康节点 |
| HTTP 4xx | 返回当前错误，不轮换节点 |
| `code != 0` | 显示服务端 `msg`，不轮换节点 |
| 匿名次数耗尽 | 显示配额提示，不重复请求其他节点 |
| 登录失效 | 标记当前节点匿名并提示登录 |
| 响应缺少必需字段 | 视为协议结构损坏，允许只读请求切换节点 |
| 写操作响应不确定 | 不重放，提示用户稍后检查状态 |
| 状态 URL 非法 | 停止请求并报告状态损坏 |

日志只记录方法、路径、字段名称、状态码、耗时、节点和脱敏错误消息。日志禁止记录请求 Cookie、认证头、请求体值、正文、媒体签名 URL 和评论内容。

`capture.mjs` 默认删除 `Cookie`、`Set-Cookie`、`Authorization`、Token 类字段和所有内容值，并通过测试验证脱敏器自身不会漏出敏感标记。

## 15. 构建与测试

### 15.1 确定性构建

```powershell
node book-sources/wsl-premium-aggregate/build.mjs
```

构建器使用 Node 标准库和结构化 JSON API，固定模块顺序和换行符。连续构建两次结果必须字节一致，且不得修改模板或运行时源文件。

运行时代码保持当前 Rhino 引擎兼容语法，不使用可选链、空值合并、顶层 `await` 或依赖 Node、浏览器 DOM 的 API。

### 15.2 静态与夹具测试

```powershell
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
```

覆盖：

1. JSON 数组长度、四个唯一主键、类型、名称和分组。
2. 构建结果确定性及脚本 `Author: WSL` 署名。
3. 状态编码往返、版本检查、长度限制和敏感键拒绝。
4. 搜索语法、分页、公共字段映射和同名多来源保留。
5. 详情空字段回退、目录排序、卷和 VIP 映射。
6. 四种正文成功夹具及业务失败夹具。
7. 发现标题、占位清理、样式和节点 origin 重写。
8. 读请求故障切换、冷却、粘性节点和单轮去重。
9. 业务错误不切换、写操作不重放。
10. 四书源共享设置，Cookie 和 Token 不进入共享缓存。
11. 夹具和最终 JSON 不含敏感值或示例正文。

### 15.3 匿名实时测试

```powershell
$env:WSL_LIVE='1'
$env:WSL_LIVE_MEDIA='小说'
node --test book-sources/tests/wsl-premium-aggregate.test.mjs
```

实时测试对四种媒体分别验证：

```text
/search -> /detail -> /catalog
/discovestyle -> /get_discover
```

每次运行只为 `WSL_LIVE_MEDIA` 指定的媒体请求一次正文，避免重复消耗匿名日配额。服务端明确返回配额不足时，测试报告“链路可达、内容配额不足”，不报告为节点故障；该结果仍不替代对应媒体的成功脱敏夹具。

测试不得依赖固定排行榜书名，只验证信封、非空列表、字段类型、状态往返和后续链路可达。

### 15.4 Legado 人工验收

自动测试完成后执行以下清单：

1. 一次导入出现四个书源，原始 `7595` 仍保留。
2. 四个来源分别进入文本、音频、漫画和视频原生界面。
3. 四种搜索、详情、目录、分页和发现栏目正常。
4. 登录一次后四个来源的登录状态一致。
5. 登录状态下验证正文、音频、漫画和短剧各一章或一集。
6. 开启书架同步后验证添加和一次进度更新。
7. 验证书评、章评、段评读取和一次评论提交。
8. 模拟主节点故障，确认读请求切换且写请求不重复。

没有账号或可用 Android 实例时，交付说明必须把“自动化通过”和“登录态人工验收待执行”分开，不把夹具测试描述成真机登录验证。

## 16. 风险与维护边界

1. 第三方服务端可能停机、改域名、改协议或限制访问，书源客户端无法保证其持续可用。
2. 匿名正文存在每日次数限制，自动测试必须控制调用数量。
3. 四个书源对象会重复嵌入公共 `jsLib`，最终 JSON 体积高于单一对象；这是换取四种原生阅读模式的明确成本。
4. 服务端账号状态可能按节点隔离，节点切换后可能需要重新登录。
5. 动态发现栏目数量较大，服务端返回异常项目时由清洗规则过滤；不在客户端维护一份会快速过期的完整分类表。
6. 媒体签名 URL 可能短期有效，正文规则每次播放或阅读时实时获取，不把签名地址固化进书源。
7. 黑盒协议发生变化时先更新观察夹具和测试，再修改运行时映射。

## 17. 完成标准

满足以下条件后实现阶段才可交付：

1. 最终 JSON 可直接导入，包含且只包含四个设计对象。
2. 构建连续执行两次无差异，所有新增脚本署名 `Author: WSL`。
3. 静态、夹具和匿名实时测试均有可复核结果。
4. 四种正文适配器各有成功脱敏夹具；配额错误不作为成功夹具。
5. 认证、书架、评论和短剧播放端点均登记已观察的请求契约，不含猜测字段；尚未取得账号态成功响应的功能逐项标记待人工实测。
6. 原始示例 `jsLib` 的函数实现未进入新运行时或测试。
7. 代码、夹具、日志和提交历史不含 Cookie、Token、账号、正文、评论或媒体签名地址。
8. README 明确服务器依赖、匿名配额、节点策略和登录态人工验收状态。
9. 当前可用环境中的验证全部通过；受账号或设备条件限制的项目被逐项标明。
