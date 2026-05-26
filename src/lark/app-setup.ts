import { spawnSync } from "node:child_process";
import { createLogger } from "../log.js";
import {
  DEFAULT_SUBSCRIBED_CALLBACKS,
  DEFAULT_SUBSCRIBED_EVENTS,
  baseInfoConsoleUrl,
  callbacksConsoleUrl,
  eventsConsoleUrl,
  formatAppDisplayName,
} from "./default-events.js";
import { createFeishuAppClient } from "./feishu-app-client.js";

const log = createLogger("app-setup");

export interface AppSetupOptions {
  appId: string;
  brand: "feishu" | "lark";
  /** Direct SDK auth — preferred when available (setup / bridge secrets file). */
  appSecret?: string;
  /** Fallback: call Open API through lark-cli (uses its encrypted keyring). */
  larkCliProfile?: string;
  larkCliPath?: string;
  ownerOpenId?: string;
  /** Skip contact lookup when already known (e.g. from lark-cli config). */
  ownerName?: string;
}

export interface AppSetupResult {
  displayName: string;
  nameUpdated: boolean;
  eventsConfigured: boolean;
  callbacksConfigured: boolean;
  errors: string[];
}

/** Rename app, subscribe events/callbacks (WebSocket), after QR onboarding. */
export async function configureBridgeApp(opts: AppSetupOptions): Promise<AppSetupResult> {
  const ownerName =
    opts.ownerName?.trim() ||
    (opts.appSecret
      ? await resolveOwnerDisplayNameViaSdk(
          opts.appId,
          opts.appSecret,
          opts.brand,
          opts.ownerOpenId,
        )
      : "我的");
  const displayName = formatAppDisplayName(ownerName);
  const errors: string[] = [];

  process.stdout.write("\n=== 配置应用（名称 / 事件 / 回调）===\n\n");
  process.stdout.write(`目标应用名称: ${displayName}\n\n`);

  let nameUpdated = false;
  let eventsConfigured = false;
  let callbacksConfigured = false;

  if (opts.appSecret) {
    const client = createFeishuAppClient({
      appId: opts.appId,
      appSecret: opts.appSecret,
      brand: opts.brand,
    });
    nameUpdated = await updateAppDisplayNameViaSdk(client, opts.appId, displayName, errors);
    ({ eventsConfigured, callbacksConfigured } = await updateEventAndCallbackViaSdk(
      client,
      opts.appId,
      errors,
    ));
  } else if (opts.larkCliProfile) {
    const bin = opts.larkCliPath ?? "lark-cli";
    nameUpdated = patchViaLarkCli(
      bin,
      opts.larkCliProfile,
      `/open-apis/application/v7/applications/${opts.appId}/base`,
      { i18ns: [{ i18n_key: "zh_cn", name: displayName }] },
      errors,
      "更新应用名称",
    );
    const eventOk = patchViaLarkCli(
      bin,
      opts.larkCliProfile,
      `/open-apis/application/v6/applications/${opts.appId}`,
      {
        event: {
          subscription_type: "websocket",
          subscribed_events: [...DEFAULT_SUBSCRIBED_EVENTS],
        },
        callback_info: {
          callback_type: "websocket",
          subscribed_callbacks: [...DEFAULT_SUBSCRIBED_CALLBACKS],
        },
      },
      errors,
      "事件/回调配置",
      { lang: "zh_cn" },
    );
    eventsConfigured = eventOk;
    callbacksConfigured = eventOk;
  } else {
    throw new Error("configureBridgeApp requires appSecret or larkCliProfile");
  }

  if (nameUpdated) process.stdout.write("✓ 应用名称已更新\n");
  else process.stdout.write("✗ 应用名称更新失败（见下方说明）\n");

  if (eventsConfigured) {
    process.stdout.write(`✓ 事件订阅已配置（长连接，${DEFAULT_SUBSCRIBED_EVENTS.length} 个事件）\n`);
  } else {
    process.stdout.write("✗ 事件订阅 API 配置失败\n");
  }

  if (callbacksConfigured) {
    process.stdout.write(
      `✓ 回调已配置（长连接，${DEFAULT_SUBSCRIBED_CALLBACKS.join(", ")}）\n`,
    );
  } else {
    process.stdout.write("✗ 回调 API 配置失败\n");
  }

  if (errors.length) {
    process.stdout.write("\n部分步骤未成功，常见原因：\n");
    process.stdout.write("  • 权限尚未导入/发布（先完成上一步权限批量导入）\n");
    process.stdout.write("  • 缺少 application:application:self_manage 等应用管理权限\n");
    process.stdout.write("  • 长连接模式需在后台保存前至少有一次 WS 在线（可先 npm start 再重试）\n\n");
    for (const err of errors) process.stdout.write(`  - ${err}\n`);
    process.stdout.write("\n可手动打开：\n");
    process.stdout.write(`  基础信息: ${baseInfoConsoleUrl(opts.appId, opts.brand)}\n`);
    process.stdout.write(`  事件配置: ${eventsConsoleUrl(opts.appId, opts.brand)}\n`);
    process.stdout.write(`  回调配置: ${callbacksConsoleUrl(opts.appId, opts.brand)}\n`);
    process.stdout.write("\n权限发布完成后重试: npm run bridge -- configure\n\n");
    openInBrowser(eventsConsoleUrl(opts.appId, opts.brand));
  } else {
    process.stdout.write("\n应用配置完成。请确保权限已导入并发布版本。\n\n");
  }

  return { displayName, nameUpdated, eventsConfigured, callbacksConfigured, errors };
}

function patchViaLarkCli(
  bin: string,
  profile: string,
  apiPath: string,
  body: Record<string, unknown>,
  errors: string[],
  label: string,
  query?: Record<string, string>,
): boolean {
  const args = [
    "--profile",
    profile,
    "api",
    "PATCH",
    apiPath,
    "--as",
    "bot",
    "--data",
    JSON.stringify(body),
  ];
  if (query) {
    args.push("--params", JSON.stringify(query));
  }
  const res = spawnSync(bin, args, { encoding: "utf8" });
  const out = `${res.stdout || ""}${res.stderr || ""}`.trim();
  if (res.status !== 0) {
    errors.push(`${label}: lark-cli failed (${out || `exit ${res.status}`})`);
    return false;
  }
  try {
    const parsed = JSON.parse(res.stdout) as { code?: number; msg?: string };
    if (parsed.code !== 0) {
      errors.push(`${label}: ${parsed.msg ?? `code=${parsed.code}`}`);
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`${label}: bad response (${(err as Error).message})`);
    log.debug(`lark-cli api output: ${out}`);
    return false;
  }
}

async function resolveOwnerDisplayNameViaSdk(
  appId: string,
  appSecret: string,
  brand: "feishu" | "lark",
  openId?: string,
): Promise<string> {
  if (!openId) return "我的";
  const client = createFeishuAppClient({ appId, appSecret, brand });
  try {
    const res = await client.contact.v3.user.get({
      path: { user_id: openId },
      params: { user_id_type: "open_id" },
    });
    const name = res.data?.user?.name?.trim();
    if (name) return name;
  } catch (err) {
    log.warn(`contact user get failed: ${(err as Error).message}`);
  }
  return "我的";
}

async function updateAppDisplayNameViaSdk(
  client: ReturnType<typeof createFeishuAppClient>,
  appId: string,
  displayName: string,
  errors: string[],
): Promise<boolean> {
  try {
    const res = await client.request<{ code?: number; msg?: string }>({
      method: "PATCH",
      url: `${client.domain}/open-apis/application/v7/applications/${appId}/base`,
      data: {
        i18ns: [{ i18n_key: "zh_cn", name: displayName }],
      },
    });
    if (res.code !== 0) {
      errors.push(`更新应用名称: ${res.msg ?? `code=${res.code}`}`);
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`更新应用名称: ${(err as Error).message}`);
    return false;
  }
}

async function updateEventAndCallbackViaSdk(
  client: ReturnType<typeof createFeishuAppClient>,
  appId: string,
  errors: string[],
): Promise<{ eventsConfigured: boolean; callbacksConfigured: boolean }> {
  try {
    const res = await client.application.v6.application.patch({
      path: { app_id: appId },
      params: { lang: "zh_cn" },
      data: {
        event: {
          subscription_type: "websocket",
          subscribed_events: [...DEFAULT_SUBSCRIBED_EVENTS],
        },
        callback_info: {
          callback_type: "websocket",
          subscribed_callbacks: [...DEFAULT_SUBSCRIBED_CALLBACKS],
        },
      },
    });
    if (res.code !== 0) {
      errors.push(`事件/回调配置: ${res.msg ?? `code=${res.code}`}`);
      return { eventsConfigured: false, callbacksConfigured: false };
    }
    return { eventsConfigured: true, callbacksConfigured: true };
  } catch (err) {
    errors.push(`事件/回调配置: ${(err as Error).message}`);
    return { eventsConfigured: false, callbacksConfigured: false };
  }
}

function openInBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawnSync("open", [url], { stdio: "ignore" });
  } else if (process.platform === "linux") {
    spawnSync("xdg-open", [url], { stdio: "ignore" });
  }
}
