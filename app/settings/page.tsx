import type { Metadata } from "next";
import { getAppEnv } from "@/db/runtime";
import { getFeishuConfigStatus } from "@/lib/feishu";
import { getWechatConfigStatus } from "@/lib/wechat";
import { TikHubKeySettings } from "./TikHubKeySettings";

export const metadata: Metadata = {
  title: "系统设置",
};

const settings = [
  {
    name: "TikHub 服务端备用 Token",
    env: "TIKHUB_TOKEN",
    description: "仅用于无人值守的定时采集；手动同步优先使用当前浏览器的个人 Key。",
    status: "可选配置",
  },
  {
    name: "DeepSeek 写作与摘要模型",
    env: "AI_BASE_URL / AI_API_KEY / AI_MODEL",
    description: "使用 DeepSeek 的 OpenAI-compatible Chat Completions；一键知识库改写必须配置 API Key。",
    status: "改写必需",
  },
  {
    name: "GitHub API Token",
    env: "GITHUB_TOKEN",
    description: "用于扩大仓库搜索额度；不配置也可使用低额度公开接口建立 Star 快照。",
    status: "线上建议配置",
  },
  {
    name: "定时任务密钥",
    env: "CRON_SECRET",
    description: "保护生产环境的内部定时采集入口。",
    status: "上线前配置",
  },
  {
    name: "部署区域",
    env: "TIKHUB_BASE_URL",
    description: "美国洛杉矶服务器使用 https://api.tikhub.io。",
    status: "已确定",
  },
];

export default async function SettingsPage() {
  const env = await getAppEnv();
  const isLive = env.DATA_MODE === "live";
  const feishu = getFeishuConfigStatus(env);
  const wechat = getWechatConfigStatus(env);
  return (
    <main className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-eyebrow">SYSTEM CONFIGURATION</span>
          <h1>系统设置</h1>
          <p>当前无应用登录；上线时建议通过 VPN、IP 白名单或访问网关限制团队访问。</p>
        </div>
      </header>
      <section className="panel settings-panel">
        <div className="settings-intro">
          <div>
            <span className="mode-icon">{isLive ? "L" : "M"}</span>
            <div>
              <strong>
                {isLive ? "定时采集模式正在运行" : "本地手动采集模式"}
              </strong>
              <p>
                {isLive
                  ? "后台定时任务会使用服务端 Token；个人 Key 仍只属于当前浏览器。"
                  : "保存个人 Key 后，X / YouTube 的“立即同步”可单独执行真实采集。"}
              </p>
            </div>
          </div>
          <code>{`DATA_MODE=${isLive ? "live" : "demo"}`}</code>
        </div>
      </section>

      <TikHubKeySettings />

      <section id="wechat-settings" className="panel feishu-settings-panel">
        <div className="feishu-settings-heading">
          <div><span className="section-eyebrow">WECHAT DRAFTS</span><h2>公众号草稿箱</h2><p>独立生成公众号版，上传正文图片与封面，仅保存草稿，由你在微信后台预览发布。</p></div>
          <span className={wechat.configured ? "credential-status credential-ready" : "credential-status credential-empty"}>{wechat.configured ? "凭据已设置" : "待配置"}</span>
        </div>
        <div className="feishu-config-grid">
          <div><span>公众号凭据</span><strong>{wechat.configured ? "已设置（未验证接口权限）" : "未设置"}</strong><code>WECHAT_APP_ID / WECHAT_APP_SECRET</code></div>
          <div><span>公众号写作</span><strong>{wechat.aiConfigured ? "沿用现有 AI 配置" : "未设置 AI Key"}</strong><code>AI_BASE_URL / AI_API_KEY / AI_MODEL</code></div>
          <div><span>发布保护</span><strong>只存草稿，不自动发布</strong><code>独立稿件 · 人工确认 · 同步日志</code></div>
        </div>
        <div className="wechat-setup">
          <p>在项目根目录的 <code>.env.local</code> 增加以下配置，保存后重启项目。不要把 AppSecret 发到聊天或提交到 Git。</p>
          <pre>{"WECHAT_APP_ID=你的公众号AppID\nWECHAT_APP_SECRET=你的公众号AppSecret\n# 可选：公众号稿默认署名\nWECHAT_AUTHOR=你的知识库名称"}</pre>
          <p>在公众号后台确认具备草稿箱、素材管理接口权限，并将运行本项目的服务器出口公网 IP 加入 IP 白名单。本地 Mac 使用当前网络的公网出口 IP；IP 变化后需更新白名单。</p>
          <p>正文图片使用 JPG / PNG、小于 1 MB。无法直接读取的飞书图片可先下载，再在公众号稿件区上传；额外可信图片域名可由管理员配置 <code>WECHAT_IMAGE_HOSTS</code>（逗号分隔、精确域名）。</p>
          <a href="/review#wechat-draft">前往审核中心 → 公众号稿件</a>
        </div>
      </section>

      <section className="panel feishu-settings-panel">
        <div className="feishu-settings-heading">
          <div>
            <span className="section-eyebrow">FEISHU PUBLISHING</span>
            <h2>飞书每日精选总文档</h2>
            <p>所有审核通过的文章写入同一份专用文档，并按北京时间自动建立日期章节。</p>
          </div>
          <span className={feishu.configured ? "credential-status credential-ready" : "credential-status credential-empty"}>
            {feishu.configured ? "已配置" : "待配置"}
          </span>
        </div>
        <div className="feishu-config-grid">
          <div><span>应用凭据</span><strong>{env.FEISHU_APP_ID && env.FEISHU_APP_SECRET ? "已设置" : "未设置"}</strong><code>FEISHU_APP_ID / FEISHU_APP_SECRET</code></div>
          <div><span>专用总文档</span><strong>{feishu.dailyDocumentConfigured ? (feishu.dailyWikiNodeConfigured ? "Wiki页面" : "Docx文档") : "未设置"}</strong><code>{feishu.dailyWikiNodeConfigured ? "FEISHU_DAILY_WIKI_NODE_TOKEN" : "FEISHU_DAILY_DOCUMENT_ID"}</code></div>
          <div><span>归档规则</span><strong>北京时间 · 每日一节</strong><code>同文档幂等更新</code></div>
        </div>
        <div className="feishu-settings-note">
          <span>{feishu.message}</span>
          <a href="/review">进入审核中心</a>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="settings-list">
          {settings.map((setting) => (
            <article key={setting.name}>
              <div>
                <h2>{setting.name}</h2>
                <p>{setting.description}</p>
              </div>
              <code>{setting.env}</code>
              <span>{setting.status}</span>
            </article>
          ))}
        </div>
      </section>
      <section className="security-note">
        <span>安全提示</span>
        <div>
          <h2>个人 Key 与服务端 Token 分开管理</h2>
          <p>
            个人 Key 只保存在当前浏览器的加密 HttpOnly Cookie 中；服务端
            Token 只用于定时任务。不要把 TikHub Token、GitHub Token 或 AI Key
            写进代码或提交记录，真实采集前先用少量来源测试计费和字段兼容。
          </p>
        </div>
      </section>
    </main>
  );
}
