/**
 * Request logging middleware.
 * Logs method, path, status code, and response time for every request.
 */
import type { Request, Response, NextFunction } from "express"
import { logger } from "../lib/logger.js"

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip health checks to reduce noise
  if (req.path === "/api/health") {
    next()
    return
  }

  const start = Date.now()

  res.on("finish", () => {
    const duration = Date.now() - start
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"
    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
    })
  })

  next()
}
