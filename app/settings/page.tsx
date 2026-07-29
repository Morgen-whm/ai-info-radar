import type { Metadata } from "next";
import { getAppEnv } from "@/db/runtime";
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
    name: "AI 摘要模型",
    env: "AI_API_KEY / AI_MODEL",
    description: "兼容 OpenAI Chat Completions；未配置时使用本地摘录摘要。",
    status: "可选配置",
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
            Token 只用于定时任务。不要把 TikHub Token 或 AI Key
            写进代码或提交记录，真实采集前先用少量来源测试计费和字段兼容。
          </p>
        </div>
      </section>
    </main>
  );
}
