# 起点中文移动端官方免费书源设计

- Author: WSL
- Date: 2026-08-03
- Status: 已确认，等待书面规格复核

## 1. 背景

目标是在 Legado 3.x 中提供一份可直接导入的起点中文网书源。用户输入中文书名后，书源从起点移动端官方页面搜索书籍，并支持详情、目录和官方公开章节正文。首要验收书籍为《斗破苍穹》（起点书籍 ID `1209977`）。

该书源不需要重新编译 Android 应用，也不修改 Legado 的 Kotlin、Java 或 Gradle 代码。最终产物是一份独立 JSON 配置。

## 2. 目标与非目标

### 2.1 目标

1. 在 Legado 中搜索“斗破苍穹”并返回天蚕土豆原作。
2. 解析书名、作者、封面、简介、分类、状态、最新章节和字数等可公开元数据。
3. 按起点官方目录顺序展示章节。
4. 读取起点移动网页公开返回的免费章节正文。
5. 将需要订阅或只能在起点 App 中阅读的章节标记为 VIP。
6. 不依赖第三方聚合服务器、代理接口、登录账号或特定修改版 Legado。
7. 规则尽量基于稳定语义属性，减少前端构建产生的哈希类名变化造成的失效。

### 2.2 非目标

1. 不绕过登录、验证码、订阅、付费墙、DRM 或其他访问控制。
2. 不从第三方镜像或聚合接口补齐非公开正文。
3. 不承诺搜索到起点未收录的作品。
4. 不提供批量下载、内容再分发或书架账号同步。
5. 不复刻 YckCeo 社区书源中依赖远程 `/search`、`/detail`、`/catalog`、`/content` 服务的聚合后端架构。

## 3. 已验证的官方端点

| 阶段 | URL 模式 | 当前验证结果 |
| --- | --- | --- |
| 搜索 | `https://m.qidian.com/soushu/{{key}}.html` | 搜索“斗破苍穹”返回原作，含 `data-bid="1209977"` |
| 详情 | `https://m.qidian.com/book/{bookId}/` | 返回结构化元数据和目录链接 |
| 目录 | `https://m.qidian.com/book/{bookId}/catalog/` | 《斗破苍穹》当前可枚举约 1,681 个章节条目 |
| 正文 | `https://m.qidian.com/chapter/{bookId}/{chapterId}/` | 免费章节在页面结构化 JSON 中包含正文 |

桌面端 `www.qidian.com` 搜索当前可能返回 HTTP `202` 安全验证页，因此书源统一使用 `m.qidian.com` 和移动端 User-Agent。

## 4. 交付物

实现阶段新增以下文件：

1. `book-sources/qidian-mobile-free.json`：可直接导入 Legado 3.x 的书源。
2. `book-sources/README.md`：导入方法、能力边界、验收结果和已知限制。

设计文档保留在 `docs/superpowers/specs/2026-08-03-qidian-mobile-free-book-source-design.md`。不提交下载的验证器二进制文件、Cookie、Token 或抓取到的小说正文。

## 5. 书源基础配置

建议基础字段如下：

| 字段 | 设计值 |
| --- | --- |
| `bookSourceName` | `起点中文·官方免费` |
| `bookSourceGroup` | `正版·公开章节` |
| `bookSourceType` | `0`（文本） |
| `bookSourceUrl` | `https://m.qidian.com` |
| `enabled` | `true` |
| `enabledExplore` | `false` |
| `enabledCookieJar` | `false` |

`header` 使用常规 Android Chrome 移动端 User-Agent，并声明中文语言偏好。书源不写入伪造身份信息，不携带用户 Cookie，也不自动打开浏览器获取验证状态。

## 6. 数据流设计

### 6.1 搜索

`searchUrl` 请求：

```text
/soushu/{{key}}.html
```

搜索结果列表从带有 `data-bid` 的书籍链接中提取。选择器不依赖 `_searchBookName_xxxxx_123` 一类带构建哈希的完整类名，而优先使用：

- 书籍节点：搜索结果区域内同时含 `data-bid` 和 `/chapter/` 链接的 `a[data-bid][href*="/chapter/"]`
- 书名：节点内 `h2`
- 作者：节点内 `p[class*="_searchBookAuthor_"]`
- 简介：节点内 `p[class*="_searchBookDesc_"]`
- 封面：`img[data-src]`，回退到 `img[src]`
- 分类、状态和字数：节点内 `div[class*="_tags_"] > p`
- 书籍 ID：`data-bid`

`bookUrl` 根据书籍 ID 规范化为：

```text
https://m.qidian.com/book/{bookId}/
```

这样不会把搜索页提供的“从某章开始阅读”链接误当作详情页。

### 6.2 书籍详情

详情页优先使用稳定的 Open Graph 小说元数据：

- `meta[property="og:novel:book_name"]`
- `meta[property="og:novel:author"]`
- `meta[property="og:novel:category"]`
- `meta[property="og:novel:status"]`
- `meta[property="og:novel:update_time"]`
- `meta[property="og:novel:latest_chapter_name"]`
- 封面使用 `.detail__header-cover__img` 的 `data-src`，回退到搜索结果中已经取得的封面，不允许空值覆盖
- 简介使用 `meta[name="description"]` 的 `content`；若为空，则保留搜索结果摘要

目录地址使用稳定 ID `#details-menu` 的 `href`，并在缺失时根据书籍 ID 回退为 `/book/{bookId}/catalog/`。

### 6.3 目录

目录节点使用同时具备章节 URL 和章节条目语义的链接：

```text
a[href*="/chapter/"][class*="_chapterItem_"]
```

章节名取节点内 `h2`，章节 URL 取 `href`。目录按页面原始顺序返回，不在书源中重新排序。

当前起点移动目录中：

- 普通公开章节的章节节点没有 `_unPay_` 类，标签显示“免费”。
- 只能在起点 App 免费阅读或需要订阅的章节带 `_unPay_` 类，标签可能显示“App免费”。

重要判断逻辑：`isVip` 在章节节点类名包含 `_unPay_` 时返回 `true`。这防止 Legado 把只能在官方 App 中阅读的章节当作网页公开章节。

### 6.4 正文

免费章节页面包含：

```html
<script id="vite-plugin-ssr_pageContext" type="application/json">...</script>
```

正文规则执行以下步骤：

1. 定位 `#vite-plugin-ssr_pageContext` 脚本内容。
2. 使用 `JSON.parse` 解析页面上下文。
3. 读取 `pageContext.pageProps.pageData.chapterInfo`。
4. 检查 `chapterInfo.content` 是否为非空字符串。
5. 返回包含段落标签的正文内容，由 Legado 进行正常排版。

重要逻辑使用中文注释解释结构化 JSON 定位和 VIP 防误判。若创建任何独立验证脚本，文件头必须包含 `Author: WSL`；优先复用现有验证工具，避免新增脚本。

## 7. 错误处理

| 情况 | 行为 |
| --- | --- |
| 搜索无结果 | 返回空列表，不生成虚假书籍 |
| 搜索返回安全验证页 | 提示官方搜索暂时需要验证，不自动获取 Cookie |
| 搜索页面结构变化 | 结构验证失败并报告，不回退到第三方聚合站 |
| 详情字段缺失 | 保留可解析字段；书名或书籍 ID 缺失时判定失败 |
| 目录为空 | 报告目录解析失败，不把详情页伪装成单章目录 |
| VIP/App 专享章节 | 在目录标记 VIP，不请求绕过接口 |
| 正文 JSON 缺失 | 返回空正文并输出明确诊断，不返回页面菜单或付费提示作为正文 |
| JSON 结构变化 | 捕获解析异常并记录定位失败的字段路径 |

## 8. 验证策略

### 8.1 静态验证

1. JSON 能由标准解析器完整解析。
2. 必需字段齐全，字段类型符合 Legado 3.x 书源结构。
3. 不包含 Cookie、Token、账号、私钥或第三方聚合服务地址。
4. 重要 JavaScript 逻辑包含简洁中文注释。

### 8.2 实时链路验证

| 用例 | 预期结果 |
| --- | --- |
| 搜索 `斗破苍穹` | 返回书籍 ID `1209977`，书名 `斗破苍穹`，作者 `天蚕土豆` |
| 打开详情 | 获取封面、简介、玄幻分类和完结状态 |
| 打开目录 | 条目数大于 1,000，包含 `第一章 陨落的天才` |
| 打开免费章节 | 正文长度大于 1,000 字符，且不是菜单、验证码或订阅提示 |
| 检查受限章节 | 目录规则将带 `_unPay_` 的章节标记为 VIP |
| 搜索不存在的随机书名 | 正常返回空列表或官方搜索结果，不产生解析异常 |

### 8.3 Legado 兼容验证

优先使用与 Legado 规则引擎兼容的书源验证器检查搜索、详情、目录和正文。随后在可用的 Android 模拟器或 Legado 实例中执行一次实际导入和搜索验证。若本机没有可用实例，交付时必须明确区分“验证器通过”和“真机尚未验证”，不得把前者描述为后者。

## 9. 风险与维护边界

1. 起点前端仍可能改变语义属性或结构化 JSON 路径，书源届时需要更新。
2. 起点可能对自动请求启用安全验证；本方案不绕过验证，只报告状态。
3. 目录中的“App免费”不等同于移动网页正文公开，本方案按 VIP 处理。
4. 该书源的价值是可靠搜索、元数据、目录及公开章节兼容，不是替代起点的订阅系统。
5. YckCeo 聚合书源使用第三方服务器统一多个平台，覆盖更广但依赖远程服务和账号体系；本方案有意选择更小且可审计的自包含实现。

## 10. 完成标准

满足以下全部条件才可交付：

1. 书源 JSON 和导入说明已生成。
2. 标准 JSON 解析、静态字段检查和实时四段链路验证有可复核输出。
3. “斗破苍穹”搜索和免费章节验收通过。
4. 受限章节确实被标记为 VIP。
5. 未引入第三方聚合后端、凭据或访问控制绕过逻辑。
6. 验证结果和未覆盖项在 README 中如实说明。
