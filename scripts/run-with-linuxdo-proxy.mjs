import { spawn } from "node:child_process";
import { join } from "node:path";

const command = process.argv[2] === "start" ? "start" : "dev";
const proxy = spawn(process.execPath, ["scripts/linuxdo-rss-proxy.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
const vinextArguments = [command];
const vinextHostname = process.env.VINEXT_HOSTNAME?.trim();
if (vinextHostname) {
  vinextArguments.push("--hostname", vinextHostname);
}

const vinext = spawn(
  join(process.cwd(), "node_modules", ".bin", "vinext"),
  vinextArguments,
  {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
  },
  stdio: "inherit",
  },
);

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  proxy.kill("SIGTERM");
  vinext.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250).unref();
}

proxy.on("exit", (code) => {
  if (!stopping && code && code !== 0) stop(code);
});
vinext.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
