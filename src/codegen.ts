#!/usr/bin/env node
import { runPlaywrightCli } from "./playwright-cli.js";

await runPlaywrightCli("codegen", process.argv.slice(2));

