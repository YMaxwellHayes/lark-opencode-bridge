import { AppType, Client, Domain, LoggerLevel } from "@larksuiteoapi/node-sdk";

const noopLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
};

export function createFeishuAppClient(opts: {
  appId: string;
  appSecret: string;
  brand: "feishu" | "lark";
  /** Suppress SDK console noise for expected API fallbacks (comments). */
  quiet?: boolean;
}): Client {
  return new Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    appType: AppType.SelfBuild,
    domain: opts.brand === "lark" ? Domain.Lark : Domain.Feishu,
    ...(opts.quiet
      ? { logger: noopLogger, loggerLevel: LoggerLevel.fatal }
      : {}),
  });
}
