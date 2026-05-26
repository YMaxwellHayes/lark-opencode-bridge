import type { BridgeConfig } from "../src/config.js";

export function baseConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    opencodePort: 4096,
    opencodeHost: "127.0.0.1",
    manageOpencodeServer: true,
    larkIdentity: "bot",
    allowedSenderOpenIds: [],
    allowedChatIds: [],
    adminOpenIds: [],
    requireGroupMention: true,
    replyStyle: "reply",
    handleDocComments: true,
    idleTimeoutMinutes: 30,
    messageBatchMs: 600,
    ...overrides,
  };
}
