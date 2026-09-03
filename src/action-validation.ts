import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import actionSchema from "../schemas/action.schema.json" with { type: "json" };
import type { BrowserAction } from "./contracts.js";
import { CockroachBrowserError } from "./errors.js";

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
  validateFormats: false
});

const validateAction = ajv.compile(actionSchema) as ValidateFunction<BrowserAction>;

/** Validate untrusted action data against the same schema exposed to model clients. */
export function validatedBrowserAction(value: unknown): BrowserAction {
  if (!validateAction(value)) {
    throw new CockroachBrowserError(
      "ACTION_SCHEMA_INVALID",
      `Browser action does not match the public action schema: ${formatErrors(validateAction.errors)}`
    );
  }
  return structuredClone(value);
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "unknown validation error";
  return errors
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ")
    .slice(0, 1_000);
}
