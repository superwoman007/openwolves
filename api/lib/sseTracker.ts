/**
 * Tracks active SSE connections for graceful shutdown.
 */
import type { Response } from "express"

export const sseConnections = new Set<Response>()

export function trackSSE(res: Response): void {
  sseConnections.add(res)
  res.on("close", () => sseConnections.delete(res))
}
