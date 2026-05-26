import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { SCOPES_PATH } from "../paths.js";
import {
  DEFAULT_SETUP_SCOPES,
  formatScopesJson,
  permissionsConsoleUrl,
  type ScopeManifest,
} from "./scopes.js";

export interface ScopeSetupResult {
  filePath: string;
  consoleUrl: string;
  copiedToClipboard: boolean;
  browserOpened: boolean;
}

export async function writeScopesFile(
  manifest: ScopeManifest = DEFAULT_SETUP_SCOPES,
): Promise<string> {
  const json = formatScopesJson(manifest);
  await fs.writeFile(SCOPES_PATH, json + "\n", "utf8");
  return SCOPES_PATH;
}

export function copyScopesToClipboard(manifest: ScopeManifest = DEFAULT_SETUP_SCOPES): boolean {
  return copyToClipboard(formatScopesJson(manifest));
}

/** Write scopes JSON, copy to clipboard, and open the Developer Console permissions page. */
export async function guideScopeImport(
  appId: string,
  brand: "feishu" | "lark" = "feishu",
  manifest: ScopeManifest = DEFAULT_SETUP_SCOPES,
): Promise<ScopeSetupResult> {
  const json = formatScopesJson(manifest);
  await fs.writeFile(SCOPES_PATH, json + "\n", "utf8");

  const copiedToClipboard = copyToClipboard(json);
  const consoleUrl = permissionsConsoleUrl(appId, brand);
  const browserOpened = openInBrowser(consoleUrl);

  process.stdout.write("\n=== 配置应用权限 ===\n\n");
  process.stdout.write(
    "飞书开放平台暂不支持通过 API 自动批量开通权限，需要在开发者后台手动导入。\n\n",
  );
  process.stdout.write(`1. 打开权限管理页：\n   ${consoleUrl}\n`);
  if (browserOpened) process.stdout.write("   （已在浏览器中打开）\n");
  process.stdout.write("2. 点击 **批量导入/导出权限** → **批量导入**\n");
  if (copiedToClipboard) {
    process.stdout.write("3. 直接 **Cmd+V / Ctrl+V 粘贴**（JSON 已复制到剪贴板）\n");
  } else {
    process.stdout.write(`3. 粘贴以下文件内容：\n   ${SCOPES_PATH}\n`);
  }
  process.stdout.write("4. 确认导入 → **申请开通** → 创建版本并 **发布应用**\n\n");

  return { filePath: SCOPES_PATH, consoleUrl, copiedToClipboard, browserOpened };
}

function copyToClipboard(text: string): boolean {
  if (process.platform === "darwin") {
    const r = spawnSync("pbcopy", { input: text, encoding: "utf8" });
    return r.status === 0;
  }
  if (process.platform === "linux") {
    const r = spawnSync("xclip", ["-selection", "clipboard"], { input: text, encoding: "utf8" });
    if (r.status === 0) return true;
    const wl = spawnSync("wl-copy", [], { input: text, encoding: "utf8" });
    return wl.status === 0;
  }
  return false;
}

function openInBrowser(url: string): boolean {
  if (process.platform === "darwin") {
    return spawnSync("open", [url], { stdio: "ignore" }).status === 0;
  }
  if (process.platform === "linux") {
    return spawnSync("xdg-open", [url], { stdio: "ignore" }).status === 0;
  }
  return false;
}
