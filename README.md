# TrendHub AI 情报雷达

从 X、YouTube、Linux.do、IDCFlare、GitLab 与 GitHub 采集一手 AI 信息，经过原创改写和人工审核后发布到自有知识库网站的平台。

当前版本是可本地运行的 MVP：

- 中文响应式仪表盘；
- X / YouTube TikHub 连接器；
- 按浏览器隔离的 TikHub BYOK（使用者自带 API Key）；
- Linux.do RSS 连接器（本地受限代理 + 只读回退）；
- IDCFlare 官方每日热门 RSS 连接器（作者、分类、讨论量与只读回退）；
- GitLab 官方博客、正式版本与安全补丁 Atom/RSS 连接器；
- GitHub AI 仓库 Star 每日快照、昨日增长 Top 10、周一上周增长 Top 10 与爆发项目优先摘要；
- D1/SQLite 本地持久化；
- 数据源管理、高级采集参数、单源同步、一键采集全部与定时采集入口；
- 统一内容模型、去重、指标快照和热度评分；
- 多语言价值评分、低质量推广降权与可解释推荐；
- 自选平台的话题搜索：全库检索 + X / YouTube / GitHub 实时搜索并采集；
- OpenAI-compatible AI 摘要；
- 项目内版本化知识库写作策略，支持 X 串文、媒体与 YouTube 字幕补全；
- 信息卡一键创建后台改写任务、显示阶段进度并可中断续跑；
- 内容审核中心、AI 原创初稿、人工改写与网站排版预览；
- 审核通过后发布到内置知识库网站，继续编辑时更新同一篇文章；
- 飞书知识库作为可选的第二发布渠道；
- 公众号独立稿件、手机排版预览、配图与封面上传、草稿箱同步（不自动发布）；
- 演示模式与真实采集模式隔离；
- 采集任务和错误状态页面；
- 构建、接口和服务端渲染测试。

## 话题搜索

点击侧边栏 **话题搜索**，或信息流右上角 **话题搜索 · 自选平台**。

- **搜索已采集内容**：勾选 X、YouTube、GitHub、Linux.do、IDCFlare、GitLab 的任意组合；搜索数据库中的标题、正文、作者与标签。空格分隔多个词时必须同时匹配，英文不区分大小写；`%` / `_` 按普通文字搜索，不作为通配符。全库查询、每页 30 条，不再局限信息流已加载的 500 条。可切换相关/最新排序与时间范围；不调用外部 API。
- **实时搜索平台 → 搜索并采集**：支持 X、YouTube、GitHub 多选。使用当前浏览器的个人 TikHub Key；仅在 `DATA_MODE=live` 时回退服务端 Token。GitHub 使用 `GITHUB_TOKEN`（可选，无 Token 额度较低）。每平台只请求一页、最多 30 条，不自动翻页；X / YouTube 会消耗 TikHub 额度。相关排序沿用平台排名（X 为 Top），跨平台交替展示，而不是把不同比例的热度直接比较。
- 实时搜索的时间范围由平台执行：X 使用 `since:`，YouTube 使用上传时间过滤，GitHub 按 `pushed:` 最近推送筛选。GitHub 卡片日期为仓库创建时间，最近推送时间写在正文；这不是 Star 日增榜。搜索结果不代表全网完整覆盖，也不保证每条 X 正文都包含关键词（引用、媒体等也可能匹配）。
- 新结果存入信息流，可立即“存入审核中心”或手动“一键改写”。同平台、同外部 ID 的既有记录只复用，不用搜索摘要覆盖正文或改写；不新增定时监测源、不自动改写/发布。搜索任务和单平台错误可在采集任务查看。
- Linux.do / IDCFlare / GitLab 目前仅检索已采集内容，实时模式会禁用这些选项，不将本地筛选伪装成实时平台结果。单个平台失败不影响其他结果；空结果不回退演示内容。停止等待或网络超时不代表平台请求已撤回，已保存结果可去信息流查看，不要立即反复提交。

接口：`GET /api/search?q=Codex&platform=x&platform=youtube&range=all&sort=relevance&page=1`；实时搜索使用同源 `POST /api/search`，JSON 为 `{ "query": "Codex", "platforms": ["x", "youtube"], "range": "month", "sort": "relevance" }`。平台参数采用白名单；无登录部署仍需现有访问保护。

官方接口参考：[TikHub X 搜索](https://docs.tikhub.io/215701673e0)、[TikHub YouTube 搜索 V2](https://docs.tikhub.io/431829299e0)、[GitHub 仓库搜索](https://docs.github.com/en/rest/search/search#search-repositories)。

## 公众号稿件与草稿箱

在 **审核中心 → 公众号稿件**（页面上方导航或编辑稿底部入口）使用：

1. 在改写审核队列选择文章，先保存知识库正文。
2. 点击“生成公众号版”。沿用现有 DeepSeek / OpenAI-compatible 配置，另存标题、摘要、正文和封面选择，不修改 `content_reviews` 或已发布知识库文章。生成失败不会用模板替换原文。
3. 独立编辑公众号稿；从正文图片选封面，或上传本地封面。缺图时可“添加正文配图”，再将图片 Markdown 移到相应段落。封面按 2.35:1 和 1:1 居中裁切，不伪造产品截图。
4. 使用“手机排版预览”检查正文，保存公众号稿。每张图片单独占一行；支持标题、粗体、引用、列表、代码块。原始 HTML 被当作文字处理，外部文字链接不转为可点击外链。复杂表格应改为列表。
5. 确认正文、封面与图片使用权，点击“发送到公众号草稿箱”。系统逐张上传正文图片、上传永久封面素材，然后创建微信草稿；再次发送更新同一草稿，不默认创建重复文章。
6. 点击“打开公众号后台预览”，登录后进入草稿箱，在手机预览内容和图片，并由你决定正式发布、群发和平台要求的声明/标识。项目不会调用正式发布、群发或原创声明接口。

项目根目录 `.env.local` 配置（真实值不要提交到 Git）：

```dotenv
WECHAT_APP_ID=
WECHAT_APP_SECRET=
# 可选：默认署名，最多 16 字
WECHAT_AUTHOR=
# 可选：额外可信 HTTPS 图片域名，逗号分隔；只允许精确域名
WECHAT_IMAGE_HOSTS=
```

保存后重启服务。**系统设置 → 公众号草稿箱**显示是否设置凭据，不回显密钥；“已设置”不代表接口权限已验证。账号必须具备微信草稿箱和素材接口权限，并配置项目运行环境的出口公网 IP 白名单。本地 Mac 公网 IP 改变时需更新。线上通过运行环境的 Secret 配置，不用 `NEXT_PUBLIC_*`。

边界与恢复：

- 标题最多 32 字、摘要最多 120 字、署名最多 16 字。正文使用微信安全的内联 HTML，最终需少于 2 万字符；超过限制会提示拆篇，不静默截断。
- 正文和封面统一支持 JPG / PNG、小于 1 MB（微信正文图片接口限制）。上传文件保存在 D1，不读取任意本地路径。默认允许 X、YouTube、GitHub、Linux.do 和微信常用图片域名；对其他来源建议本地上传。服务器不携带站点 Cookie 下载图片，每次重定向均检查域名。
- `WECHAT_IMAGE_HOSTS` 只填你信任且始终解析到公网的图片服务器，不要填内网、可被他人控制解析的域名或泛域名。需要登录的飞书图片不能直接用受保护 URL 同步，须先下载再上传。
- 图片上传部分失败会保存已完成的进度，重试复用图片；草稿提交超时属于“结果待核对”，不会自动重发。先查看微信后台，找到草稿则用其 `media_id` 绑定；确认没有未发布草稿后才解除保护。草稿已删除或发布后也需人工确认是否新建。
- 更新已有草稿会覆盖该篇在微信后台的手动编辑，因此每次同步前会确认。微信后台编辑不会自动回流；绑定的草稿变成多图文时会拒绝更新。
- 使用乐观版本检查和数据库任务锁防止多窗口重复提交。连接中断的任务最多保留 10 分钟，之后恢复为失败或待核对。切换文章或关页前请保存编辑。
- 不自动判断转载/原创资格，不删除水印或版权说明，不代表素材已获授权；发布人需在微信后台完成适用的内容声明与标识。
- 当前仍是无登录的内部系统。不要直接暴露公网；上线前使用访问网关/VPN等保护整个审核与图片接口。

数据独立存于 `wechat_drafts`、`wechat_assets`、`wechat_sync_logs`；迁移文件 `drizzle/0011_wechat_drafts.sql`，本地按现有机制自动建表，不清空历史数据。

官方接口参考：[新增草稿](https://developers.weixin.qq.com/doc/subscription/api/draftbox/draftmanage/api_draft_add)、[正文图片](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_uploadimage.html)、[永久素材](https://developers.weixin.qq.com/doc/subscription/api/material/permanent/api_addmaterial.html)。

## 本地启动

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开开发服务器输出的本地地址。`npm run dev` 会同时启动仅监听
`127.0.0.1:4317` 的受限公开 Feed 代理；它只接受配置好的 Linux.do、
IDCFlare 与 GitLab 官方 HTTPS Feed，解决部分站点对 Worker / Node
出口的访问限制。

默认 `DATA_MODE=demo` 代表“本地手动模式”：个人 Key 的手动 X / YouTube
采集、Linux.do、IDCFlare 与 GitLab 官方 Feed 都是真实采集，只是后台定时任务不会自动执行。

## 使用个人 TikHub API Key

项目不需要应用登录。执行 `npm run dev` 时会自动启用仅限本地开发的加密
密钥，所以可以直接在 `/settings` 输入个人 TikHub API Key。

正式构建或部署时，管理员必须在环境变量中配置自己的加密密钥：

```dotenv
TIKHUB_KEY_ENCRYPTION_SECRET=至少_24_个字符的随机字符串
```

然后每位使用者可在 `/settings` 中粘贴自己的 TikHub API Key。系统会先调用
TikHub 用户信息接口验证 Key，再使用 AES-GCM 加密并保存到当前浏览器的
HttpOnly Cookie：

- 不写入数据库或前端存储；
- 不在接口响应、页面或日志中回显完整 Key；
- 不同浏览器使用不同 Key；
- X / YouTube 的“立即同步”优先使用当前浏览器的个人 Key；
- “一键采集全部”会依次采集所有启用来源；
- 后台定时采集没有浏览器上下文，仍使用管理员配置的 `TIKHUB_TOKEN`。

## 采集量设置

在 `/sources` 的“编辑参数”中可调整：

- TikHub 连续采集 `1–3` 页，旧来源默认 `2` 页；
- 单次最多保存 `10–150` 条，X / YouTube 旧来源默认 `100` 条；
- X 可选择“最新”或“热门”排序；
- YouTube 可设置时间范围、排序、语言和国家；
- Linux.do / IDCFlare / GitLab 可选关键词过滤；留空时采集 Feed 中的全部内容。
- GitHub 每天只建立一次候选仓库快照；首日建立基线，第二天开始计算日增，周一计算上一个完整自然周。
- 每个监测源可设置最低价值分；默认 `42`，设为 `0` 可保留全部。

TikHub 每增加一页就会增加一次 API 请求。数据库按“平台 + 外部内容 ID”
自动去重，因此“发现数”可能大于“新增数”。

## 推荐与价值评分

采集范围由监测源决定：

- X / YouTube：关键词、账号、频道或趋势；
- Linux.do：RSS 地址和可选关键词。
- IDCFlare：官方 `top.rss?period=daily` 热门榜和可选关键词。
- GitLab：官方博客按 AI/Agent/DevSecOps/安全关键词过滤，正式版本与安全补丁完整采集。
- GitHub：从 AI、LLM、Agent、MCP、生成式 AI 主题和近期活跃仓库建立候选池，按 Star 快照差值生成日榜与周榜；绝对增长或相对增幅异常的项目优先推荐。

系统会额外创建四个面向知识库的高价值监测源：Codex 技能与工作流、新开源
AI 项目、海外 AI 实践和英文实战教程。它们使用更严格的价值阈值，优先保留
包含方法、发布、演示、教程或真实案例的内容。

信息流默认显示价值分不低于 `50` 的内容，并按“价值 + 新鲜度”推荐。
价值分综合主题相关性、发布时间、浏览与互动、作者影响力、内容完整度及
发布/开源/研究/安全等新闻事件词；合约地址、拉盘、市值宣传、返佣和抽奖等
推广信号会被降权。推荐不限制内容语言。

每张信息卡会显示“价值依据”和“采集依据”。信息流仍可切换为纯时间排序、
价值最高、仅看高价值或查看全部信号。

## 切换真实采集

在 `.env.local` 中配置：

```dotenv
DATA_MODE=live
TIKHUB_BASE_URL=https://api.tikhub.io
# 后台定时采集的服务端备用 Token
TIKHUB_TOKEN=你的_TikHub_Token
TIKHUB_KEY_ENCRYPTION_SECRET=至少_24_个字符的随机字符串

# DeepSeek API；AI 摘要可选，一键知识库改写必须配置
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=你的_AI_Key
AI_MODEL=deepseek-v4-pro

# GitHub 公开数据不配置 Token 也能采集，但线上强烈建议配置以提高限额
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_TOKEN=你的_GitHub_Fine_Grained_Token

CRON_SECRET=生成一个足够长的随机字符串
WEEKLY_API_KEY=至少_32_个字符的独立随机字符串

# 飞书自建应用，仅保存在服务端
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=你的应用密钥
# 推荐：可直接填写完整Wiki链接或 /wiki/ 后面的节点Token
FEISHU_DAILY_WIKI_NODE_TOKEN=https://团队域名.feishu.cn/wiki/wiki_node_token
# 也兼容普通Docx文档URL中 /docx/ 后面的Token
FEISHU_DAILY_DOCUMENT_ID=
FEISHU_DAILY_DOCUMENT_TITLE=AI 情报雷达 · 每日精选
# 例如 your-team.feishu.cn，用来生成可直接打开的文档链接
FEISHU_TENANT_DOMAIN=your-team.feishu.cn
```

美国洛杉矶服务器应使用 `https://api.tikhub.io`。切换真实模式前，先保留少量监测源进行费用和字段兼容测试。

## 主要页面

- `/`：实时总览；
- `/feed`：统一信息流；
- `/topics`：跨平台热点；
- `/weekly`：AI 周报和历史周报；
- `/review`：人工审核、重新编辑、飞书预览与发布；
- `/knowledge`：对外阅读的知识库网站；
- `/sources`：数据源管理与立即同步；
- `/jobs`：采集任务；
- `/settings`：连接器和环境状态。

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/feed`
- `GET|POST /api/sources`
- `PATCH|DELETE /api/sources/:id`
- `POST /api/sync`
- `POST /api/sync/all`
- `GET|POST|DELETE /api/settings/tikhub`
- `GET /api/settings/feishu`
- `GET /api/reviews`
- `PATCH /api/reviews/:contentId`
- `POST /api/reviews/:contentId/draft`
- `POST /api/rewrite-jobs`
- `GET /api/rewrite-jobs/:jobId`
- `POST /api/rewrite-jobs/:jobId/advance`
- `POST /api/reviews/:contentId/publish`
- `POST /api/reviews/:contentId/publish-site`
- `GET /api/knowledge`
- `GET /api/knowledge/:slug`
- `GET /api/jobs`
- `POST /api/internal/cron`
- `POST /api/v1/weekly-reports/refresh`
- `GET /api/v1/weekly-reports/latest`
- `GET /api/v1/weekly-reports/:reportId`
- `GET /api/v1/weekly-reports/:reportId/status`

生产环境应携带：

```http
Authorization: Bearer <CRON_SECRET>
```

周报 API 使用独立的服务间密钥：

```http
Authorization: Bearer <WEEKLY_API_KEY>
```

`refresh` 默认生成上一个完整的北京时间自然周。也可以提交
`{"weekStart":"2026-07-27","force":true}` 生成或重建指定周一开始的周报。
报告会固定保存筛选后的标题、摘要、入选依据、视频选题角度、热度分和最多
三个来源，供视频项目重复读取。正式站点为私有 Sites 时，外部调用还需同时
携带 `OAI-Sites-Authorization` 私有访问令牌。

## 原创改写与知识库发布

所有新采集内容都会出现在 `/review`。原始内容始终只读，编辑区单独保存
AI 初稿和人工终稿。信息流卡片可直接点击“按知识库标准一键改写”。系统使用
`lib/editorial-profiles` 中带版本号的写作策略，X 会补全同作者串文和原帖媒体，
YouTube 会补全视频简介、章节和真实字幕；无法取得字幕时明确提示，不根据标题
猜测视频内容。任务阶段和进度持久化到数据库，页面刷新后可以继续。

完整流程为：原始内容 → 关联同话题材料 → 事实证据包 → 独特写作角度 →
文章初稿 → 中文母语化与去 AI 腔 → 事实回查 → 中文排版校验 → 人工审核。
一键任务完成后只进入“待审核”，绝不会自动调用网站或飞书发布接口。

编辑也可以在审核台选择 Codex 技能、开源项目、海外实践或实测教程分类，
并选择快讯、知识卡片或深度文章模板，然后执行以下人工流程：

1. 生成或手写发布初稿；
2. 对照原文核实事实并重新组织内容；
3. 标记为通过、待补充或拒绝；
4. 通过网站预览确认排版；
5. 发布到 `/knowledge`。后续修改会更新同一篇网站文章；
6. 需要时再同步到飞书，飞书不再是网站发布的前置条件。

“实测教程”只有在原始材料或人工审核提供了真实验证证据时才能使用实测结论。
AI 改写提示会要求区分事实、影响、编辑判断和待验证项，并始终保留原始链接。

飞书使用一份专用总文档，不再为每篇文章单独创建文档。配置步骤：

1. 在飞书开放平台创建企业自建应用，获取 `App ID` 和 `App Secret`；
2. 为应用开通新版云文档读取、编辑权限和 `wiki:node:read`，并发布应用版本；
3. 手动新建一份空白Wiki文档，例如“AI 情报雷达 · 每日精选”；
4. 把应用机器人加入该知识空间，并确保它可以编辑目标页面；
5. 把完整的 `https://团队域名.feishu.cn/wiki/节点Token` 链接配置为
   `FEISHU_DAILY_WIKI_NODE_TOKEN`。系统会自动解析底层Docx Token；普通云文档仍可
   使用 `FEISHU_DAILY_DOCUMENT_ID`；
6. 重启项目，在审核中心先“审核通过”，再点击“同步飞书”。

Wiki页面标题由飞书端维护，雷达只重建页面正文；`FEISHU_DAILY_DOCUMENT_TITLE`
仅用于直接配置普通Docx文档的兼容模式。

系统会按北京时间生成“年/月/日”一级章节，在日期下写入当天首次发布的多篇
审核稿。同一篇内容再次发布时会在原日期更新，不会重复追加。总文档正文由雷达
根据数据库幂等重建，因此不要在这份专用文档中混放无关的手工笔记。应用密钥
只允许配置在服务端环境变量，不要写入前端、数据库或 Git 提交。

## 定时任务

Cloudflare Worker 部署已配置每五分钟触发一次 `scheduled` handler。由于
Linux.do 和 IDCFlare 会按云端出口网络启用访问防护，正式站点使用私有
GitHub Actions 定时任务读取其公开 RSS，并在受限时使用只读文本回退，再通过 Sites 私有访问
令牌写入同一个 D1；任务随后调用受 `CRON_SECRET` 保护的后台入口采集
IDCFlare、GitLab、GitHub 以及配置服务端 Token 后的 X / YouTube。Cloudflare
自身的五分钟触发也保留为冗余调度。
每周一北京时间 08:10 会在采集任务完成后生成上一个完整自然周的周报快照。
没有配置
服务端 `TIKHUB_TOKEN` 时，后台任务会跳过 X / YouTube，但仍会定时采集
IDCFlare、GitLab 和 GitHub；浏览器内的手动采集仍可使用个人 TikHub Key。
部署到美国洛杉矶
Node 服务器时，`npm start` 也会启动受限 Linux.do RSS 代理，可用系统
Cron 每五分钟调用：

```bash
curl -X POST https://你的内部域名/api/internal/cron \
  -H "Authorization: Bearer <CRON_SECRET>"
```

应用本身不提供登录。上线时应使用 VPN、Tailscale、IP 白名单、Cloudflare Access 或其他访问网关限制团队访问。

## 验证

```bash
npm run lint
npm run typecheck
npm run db:generate
npm test
```

完整架构与后续 PostgreSQL / Redis 扩展规划见
[ARCHITECTURE_PROPOSAL.md](./ARCHITECTURE_PROPOSAL.md)。
