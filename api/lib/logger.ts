type LogLevel = "info" | "warn" | "error"

interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  [key: string]: unknown
}

const isProd = process.env.NODE_ENV === "production"

function formatEntry(entry: LogEntry): string {
  if (isProd) {
    return JSON.stringify(entry)
  }
  const { ts, level, msg, ...meta } = entry
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ""
  return `[${ts}] ${level.toUpperCase()} ${msg}${metaStr}`
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  }
  const output = formatEntry(entry)
  if (level === "error") {
    console.error(output)
  } else if (level === "warn") {
    console.warn(output)
  } else {
    console.log(output)
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
}
