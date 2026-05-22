# OpenWolves 🐺

**OpenWolves** 是一个 AI 驱动的狼人杀（Werewolf）对战平台，支持人类玩家与多种大语言模型（LLM）AI 同局竞技。

**OpenWolves** is an AI-powered Werewolf game platform where human players can compete alongside various Large Language Model (LLM) AIs in the same match.

---

## 项目简介 | Project Overview

OpenWolves 让你可以：

- **与 AI 同局对战**：邀请 DeepSeek、Doubao、GLM、Kimi、GPT 等多种 AI 模型作为你的对手或队友。
- **灵活配置角色与玩家**：自定义每局游戏的角色池（村民、狼人、预言家、女巫、猎人、守卫）和座位配置。
- **完整的狼人杀流程**：覆盖夜晚行动、白天发言、投票、PK、结算等完整游戏阶段。
- **游戏回放**：随时回顾任何一局游戏的完整过程。

OpenWolves allows you to:

- **Play with AI**: Invite various AI models (DeepSeek, Doubao, GLM, Kimi, GPT, etc.) as your opponents or teammates.
- **Flexible Role & Player Configuration**: Customize the role pool (Villager, Werewolf, Seer, Witch, Hunter, Guard) and seat layout for each game.
- **Full Werewolf Game Flow**: Covers complete game phases including night actions, day speeches, voting, PK, and resolution.
- **Game Replay**: Review the full process of any past game at any time.

---

## 技术栈 | Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 Backend | Express + TypeScript |
| 测试 Testing | Vitest + Playwright (E2E) |
| AI 对接 AI Integration | OpenAI-Compatible API |

---

## 快速开始 | Quick Start

```bash
# 安装依赖 | Install dependencies
npm install

# 同时启动前端和后端开发服务器 | Start both frontend and backend dev servers
npm run dev

# 仅启动前端 | Start frontend only
npm run client:dev

# 仅启动后端 | Start backend only
npm run server:dev
```

---

## 可用脚本 | Available Scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前端和后端 |
| `npm run client:dev` | 启动 Vite 开发服务器 |
| `npm run server:dev` | 启动 Express 后端（带热重载）|
| `npm run build` | 构建生产版本 |
| `npm run test` | 运行单元测试 |
| `npm run test:e2e` | 运行 E2E 测试 |
| `npm run lint` | 运行 ESLint |
| `npm run check` | 运行 TypeScript 类型检查 |

---

## 项目结构 | Project Structure

```
├── src/              # 前端代码 Frontend
├── api/              # 后端代码 Backend
│   ├── game/         # 游戏引擎与 AI 逻辑 Game engine & AI logic
│   ├── routes/       # API 路由 API routes
│   └── db/           # 数据存储 Data storage
├── shared/           # 前后端共享类型 Shared types
├── e2e/              # Playwright 端到端测试
├── public/           # 静态资源 Static assets
└── data/             # 本地运行时数据（已忽略）Runtime data (gitignored)
```

---

## 许可证 | License

MIT
