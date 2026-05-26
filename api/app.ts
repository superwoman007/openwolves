/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { existsSync } from 'fs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import gamesRoutes from './routes/games.js'
import testAiRoutes from './routes/testAi.js'
import { generalLimiter } from './middleware/rate-limit.js'
import { requestLogger } from './middleware/requestLogger.js'
import { getTokenCount } from './middleware/auth.js'
import { logger } from './lib/logger.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

// Security headers
app.use(helmet())

// Request logging
app.use(requestLogger)

// CORS whitelist
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173']
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  maxAge: 86400,
}))

// Rate limiting
app.use(generalLimiter)

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/games', gamesRoutes)

// 预设页需要在生产构建后也能做模型连通性测试。
app.use('/api/test-ai', testAiRoutes)

/**
 * Serve static files in production / e2e
 */
const distPath = path.join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.url.startsWith('/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    const memUsage = process.memoryUsage()
    res.status(200).json({
      success: true,
      message: 'ok',
      uptime: Math.floor(process.uptime()),
      tokens: getTokenCount(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      llm: !!process.env.OPENAI_API_KEY,
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`${req.method} ${req.url}`, {
    error: error.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  })
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
