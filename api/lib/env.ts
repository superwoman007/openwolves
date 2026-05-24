/**
 * Startup environment variable validation.
 * Call validateEnv() early in server bootstrap to fail fast on misconfiguration.
 */
import { logger } from "./logger.js"

interface EnvRule {
  key: string
  required: boolean
  validator?: (v: string) => boolean
  hint?: string
}

const rules: EnvRule[] = [
  { key: "PORT", required: false, validator: (v) => /^\d+$/.test(v) && +v > 0 && +v < 65536, hint: "must be 1-65535" },
  { key: "ALLOWED_ORIGINS", required: false, validator: (v) => v.split(",").every((o) => o.startsWith("http")), hint: "comma-separated URLs starting with http(s)" },
  { key: "TOKEN_TTL_HOURS", required: false, validator: (v) => /^\d+$/.test(v) && +v > 0, hint: "positive integer" },
  { key: "LLM_TIMEOUT_MS", required: false, validator: (v) => /^\d+$/.test(v) && +v >= 1000, hint: "milliseconds >= 1000" },
  { key: "OPENAI_API_KEY", required: false },
  { key: "OPENAI_BASE_URL", required: false, validator: (v) => v.startsWith("http"), hint: "must be a valid URL" },
  { key: "OPENAI_MODEL", required: false },
]

export function validateEnv(): void {
  const errors: string[] = []
  const warnings: string[] = []

  for (const rule of rules) {
    const val = process.env[rule.key]
    if (!val || val.trim() === "") {
      if (rule.required) {
        errors.push(`${rule.key} is required but not set`)
      }
      continue
    }
    if (rule.validator && !rule.validator(val)) {
      errors.push(`${rule.key}="${val}" is invalid${rule.hint ? ` (${rule.hint})` : ""}`)
    }
  }

  // Warn if AI features won't work
  if (!process.env.OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY not set — AI games will fail")
  }

  for (const w of warnings) {
    logger.warn(w)
  }

  if (errors.length > 0) {
    for (const e of errors) {
      logger.error(`Env validation: ${e}`)
    }
    throw new Error(`Environment validation failed:\n  ${errors.join("\n  ")}`)
  }

  logger.info("Environment validated OK")
}
