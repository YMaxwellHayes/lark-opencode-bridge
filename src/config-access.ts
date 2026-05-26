import type { BridgeConfig } from "./config.js";
import type { SlashName } from "./slash.js";

/** Slash commands restricted when `adminOpenIds` is non-empty. */
export const ADMIN_SLASH_COMMANDS = new Set<SlashName>([
  "config",
  "reconnect",
  "doctor",
  "cd",
  "workspaces",
  "spawn",
]);

export function parseIdList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinIdList(ids: string[]): string {
  return ids.join(", ");
}

export function isUserAllowed(cfg: BridgeConfig, openId: string): boolean {
  if (!cfg.allowedSenderOpenIds.length) return true;
  return cfg.allowedSenderOpenIds.includes(openId);
}

/** Group chat allowlist; P2P is always allowed when the user passes `isUserAllowed`. */
export function isChatAllowed(
  cfg: BridgeConfig,
  chatId: string,
  chatType: "p2p" | "group",
): boolean {
  if (chatType === "p2p") return true;
  if (!cfg.allowedChatIds.length) return true;
  return cfg.allowedChatIds.includes(chatId);
}

/** When `adminOpenIds` is empty, everyone may run admin commands. */
export function isAdmin(cfg: BridgeConfig, openId: string): boolean {
  if (!cfg.adminOpenIds.length) return true;
  return cfg.adminOpenIds.includes(openId);
}
