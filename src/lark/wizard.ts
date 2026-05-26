import { registerApp } from "@larksuiteoapi/node-sdk";
import { spawnSync } from "node:child_process";
import qrcode from "qrcode-terminal";
import { createLogger } from "../log.js";
import { guideScopeImport } from "./scopes-setup.js";
import { configureBridgeApp } from "./app-setup.js";
import { saveBridgeSecret } from "./bridge-secrets.js";

const log = createLogger("wizard");

function showQrCode(url: string, expireIn: number): void {
  process.stdout.write(`\n请用飞书 App 扫描下方二维码（${expireIn}s 内有效）:\n\n`);
  qrcode.generate(url, { small: true });
  process.stdout.write("\n");

  // macOS: open the auth page in the default browser (shows a scannable QR too).
  if (process.platform === "darwin") {
    const opened = spawnSync("open", [url], { stdio: "ignore" });
    if (opened.status === 0) {
      process.stdout.write("已在浏览器中打开授权页。\n");
    }
  }

  process.stdout.write(`链接（备用）: ${url}\n\n`);
}

export interface SetupOptions {
  profileName?: string;
  larkCliPath?: string;
  domain?: "feishu" | "lark";
}

export interface SetupResult {
  appId: string;
  profileName: string;
}

/**
 * QR-code onboarding via SDK registerApp, then register credentials in
 * lark-cli so the bridge can load them the usual way.
 */
export async function runSetupWizard(opts: SetupOptions = {}): Promise<SetupResult> {
  const profileName = opts.profileName ?? "lark-opencode-bridge";
  const larkCli = opts.larkCliPath ?? "lark-cli";
  const domain = opts.domain ?? "feishu";

  process.stdout.write("\n=== lark-opencode-bridge 扫码绑定 ===\n\n");
  process.stdout.write("请用飞书 App 扫描下方二维码，授权后 bridge 会自动保存凭证。\n\n");

  const result = await registerApp({
    ...(domain === "lark"
      ? { larkDomain: "accounts.larksuite.com" }
      : { domain: "accounts.feishu.cn" }),
    source: "lark-opencode-bridge",
    onQRCodeReady: (info) => {
      showQrCode(info.url, info.expireIn);
    },
    onStatusChange: (info) => {
      if (info.status === "polling") process.stdout.write("等待扫码…\n");
      if (info.status === "slow_down") process.stdout.write("轮询降速，请尽快完成扫码…\n");
    },
  });

  const appId = result.client_id;
  const appSecret = result.client_secret;
  log.info(`registerApp ok appId=${appId}`);

  const brand = result.user_info?.tenant_brand ?? domain;
  const add = spawnSync(
    larkCli,
    [
      "profile",
      "add",
      "--name",
      profileName,
      "--app-id",
      appId,
      "--brand",
      brand,
      "--app-secret-stdin",
    ],
    { input: appSecret, encoding: "utf8" },
  );
  if (add.status !== 0) {
    throw new Error(
      `lark-cli profile add failed: ${(add.stderr || add.stdout || "").trim()}\n` +
        `You can manually run: echo '<secret>' | lark-cli profile add --name ${profileName} --app-id ${appId} --app-secret-stdin`,
    );
  }

  const use = spawnSync(larkCli, ["profile", "use", profileName], { encoding: "utf8" });
  if (use.status !== 0) {
    log.warn(`profile use failed: ${(use.stderr || "").trim()}`);
  }

  process.stdout.write(`\n绑定成功！appId=${appId} profile=${profileName}\n`);
  await saveBridgeSecret({
    appId,
    appSecret,
    brand: brand === "lark" ? "lark" : "feishu",
    profile: profileName,
  });
  await guideScopeImport(appId, brand === "lark" ? "lark" : "feishu");
  await configureBridgeApp({
    appId,
    appSecret,
    brand: brand === "lark" ? "lark" : "feishu",
    ownerOpenId: result.user_info?.open_id,
  });
  process.stdout.write("全部完成后运行: npm start\n\n");
  return { appId, profileName };
}
