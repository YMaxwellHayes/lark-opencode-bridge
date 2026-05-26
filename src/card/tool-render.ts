import type { ToolEntry } from "./run-state.js";

const OUTPUT_MAX = 800;

export function toolHeaderText(tool: ToolEntry): string {
  const suffix =
    tool.status === "done" ? ""
    : tool.status === "error" ? " · 出错"
    : " · 运行中";
  return `**${tool.name}**${suffix}`;
}

export function toolBodyMd(tool: ToolEntry): string {
  if (tool.output) {
    const out = truncate(tool.output, OUTPUT_MAX);
    return tool.status === "error"
      ? `\`\`\`\n${out}\n\`\`\``
      : `\`\`\`\n${out}\n\`\`\``;
  }
  return tool.status === "running" ? "_运行中_" : "_无输出_";
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
