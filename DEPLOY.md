# 部署指南

## 前置要求

- Docker 20.10+
- Docker Compose v2
- 一台公网服务器（1核2G 即可）
- 域名（可选，用于 HTTPS）

## 快速开始

```bash
# 1. 克隆项目
git clone <repo-url> && cd AI_Werewolf_Game_Website

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置生产环境值

# 3. 一键部署
./deploy.sh
```

## 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | 3001 | 应用监听端口（容器内部） |
| `NODE_ENV` | 是 | development | 设为 `production` |
| `ALLOWED_ORIGINS` | 是 | http://localhost:5173 | 前端域名，逗号分隔 |
| `TOKEN_TTL_HOURS` | 否 | 4 | Token 过期时间（小时） |
| `OPENAI_API_KEY` | 否 | - | LLM API Key（AI 对局需要） |
| `OPENAI_BASE_URL` | 否 | https://api.deepseek.com | LLM API 地址 |
| `OPENAI_MODEL` | 否 | deepseek-v4-pro | LLM 模型名 |
| `LLM_TIMEOUT_MS` | 否 | 15000 | LLM 请求超时（毫秒） |

生产环境 `.env` 示例：

```env
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://your-domain.com
TOKEN_TTL_HOURS=4
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-pro
LLM_TIMEOUT_MS=15000
```

## HTTPS 配置

### 方式一：Let's Encrypt（推荐）

在服务器上获取证书后放入 `deploy/certs/`：

```bash
# 安装 certbot
apt install certbot

# 获取证书（先停止 nginx）
./deploy.sh --stop
certbot certonly --standalone -d your-domain.com

# 复制证书
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem deploy/certs/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem deploy/certs/
```

然后编辑 `deploy/nginx.conf`，取消 SSL 相关注释，启用 HTTPS。

### 方式二：自签名证书（测试用）

```bash
mkdir -p deploy/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout deploy/certs/privkey.pem \
  -out deploy/certs/fullchain.pem \
  -subj "/CN=localhost"
```

## 常用运维命令

```bash
# 查看服务状态
./deploy.sh --status

# 查看实时日志
./deploy.sh --logs

# 重启服务
./deploy.sh --restart

# 停止服务
./deploy.sh --stop

# 重新构建并部署
./deploy.sh --build && ./deploy.sh --start

# 进入容器调试
docker exec -it werewolf-app sh

# 查看健康状态
curl http://localhost/api/health
```

## 监控

健康检查端点：`GET /api/health`

返回：
```json
{
  "success": true,
  "message": "ok",
  "uptime": 3600,
  "tokens": 5
}
```

Docker 内置 HEALTHCHECK 每 30 秒检测一次，连续 3 次失败会标记容器为 unhealthy。

## 数据备份

游戏数据存储在 Docker volume `game-data` 中：

```bash
# 备份
docker run --rm -v werewolf_game-data:/data -v $(pwd)/backup:/backup \
  alpine tar czf /backup/game-data-$(date +%Y%m%d).tar.gz -C /data .

# 恢复
docker run --rm -v werewolf_game-data:/data -v $(pwd)/backup:/backup \
  alpine tar xzf /backup/game-data-20240101.tar.gz -C /data
```

## 故障排查

| 问题 | 排查 |
|------|------|
| 容器启动失败 | `docker compose logs app` 查看错误 |
| 502 Bad Gateway | app 容器未就绪，等待 healthcheck 通过 |
| SSE 连接断开 | 检查 nginx proxy_read_timeout 配置 |
| Token 失效 | 检查 TOKEN_TTL_HOURS 设置，默认 4 小时 |
| CORS 错误 | 检查 ALLOWED_ORIGINS 是否包含前端域名 |
| LLM 超时 | 增大 LLM_TIMEOUT_MS 或检查网络连通性 |

## 架构图

```
                    ┌─────────────┐
    Internet ──────▶│   Nginx     │
                    │  (port 80)  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         /api/*      /assets/*       /*
              │            │            │
              ▼            ▼            ▼
        ┌─────────────────────────────────┐
        │         Express App             │
        │        (port 3001)              │
        │                                 │
        │  API routes + Static serving    │
        │  + SSE events                   │
        └────────────────┬────────────────┘
                         │
                    ┌────┴────┐
                    │  data/  │
                    │ (volume)│
                    └─────────┘
```
