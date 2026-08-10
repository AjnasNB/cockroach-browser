#!/usr/bin/env node
import { runPlaywrightCli } from "./playwright-cli.js";

await runPlaywrightCli("test", process.argv.slice(2));

