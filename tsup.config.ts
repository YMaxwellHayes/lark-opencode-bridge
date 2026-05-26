import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: false,
});
