/**
 * 提供兼容服务端平台的 API 入口处理函数。
 * @param req 当前 HTTP 请求对象。
 * @param res 当前 HTTP 响应对象。
 * @returns 返回 Express 应用对本次请求的处理结果。
 */
import type { Request, Response } from 'express'
import app from './app.js'

export default function handler(req: Request, res: Response) {
  return app(req, res)
}
