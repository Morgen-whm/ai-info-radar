# TrendHub AI 情报雷达

团队内部使用的 X、YouTube、Linux.do、IDCFlare 与 GitLab AI 资讯自动采集、摘要与热点发现平台。

当前版本是可本地运行的 MVP：

- 中文响应式仪表盘；
- X / YouTube TikHub 连接器；
- 按浏览器隔离的 TikHub BYOK（使用者自带 API Key）；
- Linux.do RSS 连接器（本地受限代理 + 只读回退）；
- IDCFlare 官方每日热门 RSS 连接器（作者、分类、讨论量与只读回退）；
- GitLab 官方博客、正式版本与安全补丁 Atom/RSS 连接器；
- D1/SQLite 本地持久化；
- 数据源管理、高级采集参数、单源同步、一键采集全部与定时采集入口；
- 统一内容模型、去重、指标快照和热度评分；
- 多语言价值评分、低质量推广降权与可解释推荐；
- OpenAI-compatible AI 摘要；
- 演示模式与真实采集模式隔离；
- 采集任务和错误状态页面；
- 构建、接口和服务端渲染测试。

## 本地运行

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
- 每个监测源可设置最低价值分；默认 `42`，设为 `0` 可保留全部。

TikHub 每增加一页就会增加一次 API 请求。数据库按“平台 + 外部内容 ID”
自动去重，因此“发现数”可能大于“新增数”。

## 推荐与价值评分

采集范围由监测源决定：

- X / YouTube：关键词、账号、频道或趋势；
- Linux.do：RSS 地址和可选关键词。
- IDCFlare：官方 `top.rss?period=daily` 热门榜和可选关键词。
- GitLab：官方博客按 AI/Agent/DevSecOps/安全关键词过滤，正式版本与安全补丁完整采集。

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

# AI 摘要可选；不配置时使用本地摘录摘要
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=你的_AI_Key
AI_MODEL=gpt-5-mini

CRON_SECRET=生成一个足够长的随机字符串
WEEKLY_API_KEY=至少_32_个字符的独立随机字符串
```

美国洛杉矶服务器应使用 `https://api.tikhub.io`。切换真实模式前，先保留少量监测源进行费用和字段兼容测试。

## 主要页面

- `/`：实时总览；
- `/feed`：统一信息流；
- `/topics`：跨平台热点；
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

## 定时任务

Cloudflare Worker 部署已配置每五分钟触发一次 `scheduled` handler。由于
Linux.do 和 IDCFlare 会按云端出口网络启用访问防护，正式站点使用私有
GitHub Actions 定时任务读取其公开 RSS，并在受限时使用只读文本回退，再通过 Sites 私有访问
令牌写入同一个 D1；任务随后调用受 `CRON_SECRET` 保护的后台入口采集
IDCFlare、GitLab 以及配置服务端 Token 后的 X / YouTube。Cloudflare
自身的五分钟触发也保留为冗余调度。
每周一北京时间 08:10 会在采集任务完成后生成上一个完整自然周的周报快照。
没有配置
服务端 `TIKHUB_TOKEN` 时，后台任务会跳过 X / YouTube，但仍会定时采集
IDCFlare 和 GitLab；浏览器内的手动采集仍可使用个人 TikHub Key。
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
npm run db:generate
npm test
```

完整架构与后续 PostgreSQL / Redis 扩展规划见
[ARCHITECTURE_PROPOSAL.md](./ARCHITECTURE_PROPOSAL.md)。
