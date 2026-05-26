#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

runCli(process.argv).catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
