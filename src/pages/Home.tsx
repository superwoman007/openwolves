import { Panel } from "@/components/Panel"
import { NoirLayout } from "@/components/NoirLayout"
import { cn } from "@/lib/utils"
import { joinGame } from "@/lib/api"
import type { AIProviderConfig, GameConfig, Role, SeatConfig } from "@shared/game"
import AiPresetManager, { loadPresets, type AIModelPreset } from "@/components/AiPresetManager"
import { Loader2, Shuffle, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

const roles: Array<{ value: Role; label: string }> = [
  { value: "werewolf", label: "狼人" },
  { value: "seer", label: "预言家" },
  { value: "witch", label: "女巫" },
  { value: "hunter", label: "猎人" },
  { value: "guard", label: "守卫" },
  { value: "villager", label: "村民" },
]

const defaultRolePool = (count: number): Role[] => {
  if (count <= 6) return ["werewolf", "werewolf", "seer", "witch", "villager", "villager"]
  if (count <= 8) return ["werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager"]
  if (count <= 10)
    return [
      "werewolf",
      "werewolf",
      "werewolf",
      "seer",
      "witch",
      "guard",
      "hunter",
      "villager",
      "villager",
      "villager",
    ]
  return [
    "werewolf",
    "werewolf",
    "werewolf",
    "seer",
    "witch",
    "guard",
    "hunter",
    "villager",
    "villager",
    "villager",
    "villager",
    "villager",
  ]
}

const defaultSeats = (count: number): SeatConfig[] =>
  Array.from({ length: count }).map((_, i) => ({
    seat: i + 1,
    name: `${i + 1}号`,
    kind: "ai",
    ai: { provider: "mock" } satisfies AIProviderConfig,
  }))

function findMatchingPresetId(ai: AIProviderConfig | undefined, presets: AIModelPreset[]): string | undefined {
  if (!ai) return undefined
  for (const p of presets) {
    if (p.provider === ai.provider && p.baseUrl === (ai.baseUrl ?? "") && p.model === (ai.model ?? "")) {
      return p.id
    }
  }
  for (const p of presets) {
    if (p.provider === ai.provider) {
      return p.id
    }
  }
  return undefined
}

function presetToAiConfig(preset: AIModelPreset): AIProviderConfig {
  return {
    provider: preset.provider,
    baseUrl: preset.baseUrl || undefined,
    apiKey: preset.apiKey || undefined,
    model: preset.model || undefined,
    temperature: preset.temperature,
  }
}

export default function Home() {
  const navigate = useNavigate()
  const [playerCount, setPlayerCount] = useState(8)
  const [seats, setSeats] = useState<SeatConfig[]>(() => defaultSeats(8))
  const [rolePool, setRolePool] = useState<Role[]>(() => defaultRolePool(8))
  const [selfSeat, setSelfSeat] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiPresets, setAiPresets] = useState<AIModelPreset[]>(() => loadPresets())

  const config: GameConfig = useMemo(
    () => ({
      seats,
      rolePool,
      rngSeed: "noir",
      phaseTimers: { speechSeconds: 60, voteSeconds: 25 },
    }),
    [rolePool, seats],
  )

  const humanSeats = useMemo(() => seats.filter((s) => s.kind === "human").map((s) => s.seat), [seats])

  const applyPlayerCount = (next: number) => {
    setPlayerCount(next)
    setSeats((prev) => {
      const nextSeats = defaultSeats(next)
      for (const s of nextSeats) {
        const old = prev.find((p) => p.seat === s.seat)
        if (old) {
          s.name = old.name
          s.kind = old.kind
          s.ai = old.ai
        }
      }
      return nextSeats
    })
    setRolePool(defaultRolePool(next))
    setSelfSeat(null)
    setError(null)
  }

  const updateSeat = (seat: number, patch: Partial<SeatConfig>) => {
    setSeats((prev) => prev.map((s) => (s.seat === seat ? { ...s, ...patch } : s)))
    setError(null)
  }

  const updateRoleAt = (idx: number, value: Role) => {
    setRolePool((prev) => prev.map((r, i) => (i === idx ? value : r)))
    setError(null)
  }

  const validate = () => {
    if (seats.length !== rolePool.length) return "角色数量必须与人数相同"
    const uniq = new Set(seats.map((s) => s.seat))
    if (uniq.size !== seats.length) return "座位号重复"
    for (const s of seats) {
      if (!s.name.trim()) return "玩家名称不能为空"
      if (s.kind === "ai" && !s.ai) return "AI 座位必须配置 AI"
    }
    if (selfSeat !== null) {
      const ss = seats.find((s) => s.seat === selfSeat)
      if (!ss) return "无效的自选座位"
      if (ss.kind !== "human") return "自选座位必须是人类"
    }
    return null
  }

  const start = async () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r1 = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      })
      const j1 = (await r1.json()) as { success: boolean; gameId?: string; error?: string }
      if (!j1.success || !j1.gameId) throw new Error(j1.error ?? "创建失败")

      // Join to get auth token before starting (required for protected endpoints)
      if (selfSeat !== null) {
        const joinRes = await joinGame(j1.gameId, selfSeat)
        if (!joinRes.success) throw new Error("error" in joinRes ? joinRes.error : "加入失败")
      }

      const r2 = await fetch(`/api/games/${j1.gameId}/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(selfSeat !== null ? { authorization: `Bearer ${sessionStorage.getItem("game-token") ?? ""}` } : {}),
        },
      })
      const j2 = (await r2.json()) as { success: boolean; error?: string }
      if (!j2.success) throw new Error(j2.error ?? "开始失败")

      const qs = selfSeat !== null ? `?selfSeat=${selfSeat}` : ""
      navigate(`/game/${j1.gameId}${qs}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectPresetForSeat = (seatNum: number, presetId: string) => {
    const preset = aiPresets.find((p) => p.id === presetId)
    if (!preset) return
    updateSeat(seatNum, { ai: presetToAiConfig(preset) })
  }

  return (
    <NoirLayout
      title="Noir Werewolf"
      subtitle="MULTI‑AI AUTOPLAY"
      right={
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs tracking-[0.18em] text-white/80 transition hover:bg-white/10 active:translate-y-px",
            busy && "pointer-events-none opacity-60",
          )}
          onClick={start}
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
          <span>创建并开始</span>
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel
            title="座位与 AI"
            subtitle="先单房间原型：支持多 AI 自动行动，人类可占用一个座位参与。"
            right={
              <div className="flex items-center gap-3">
                <select
                  className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white/75"
                  value={playerCount}
                  onChange={(e) => applyPlayerCount(Number(e.target.value))}
                >
                  {[6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} 人
                    </option>
                  ))}
                </select>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/40 px-3 py-1 text-xs text-white/75 hover:bg-white/10"
                  onClick={() => setRolePool(defaultRolePool(playerCount))}
                >
                  <Shuffle size={14} />
                  <span>重置角色</span>
                </button>
              </div>
            }
          >
            {/* AI Model Presets */}
            <div className="mb-4">
              <div className="mb-2 text-[11px] tracking-[0.22em] text-white/45">AI 模型管理</div>
              <AiPresetManager presets={aiPresets} onChange={setAiPresets} />
            </div>

            <div className="overflow-hidden rounded-lg border border-white/10">
              <div className="grid grid-cols-12 bg-white/[0.03] px-3 py-2 text-[11px] tracking-[0.22em] text-white/45">
                <div className="col-span-2">座位</div>
                <div className="col-span-4">名称</div>
                <div className="col-span-3">类型</div>
                <div className="col-span-3">AI 模型</div>
              </div>
              <div className="divide-y divide-white/10">
                {seats.map((s) => {
                  const matchedPresetId = findMatchingPresetId(s.ai, aiPresets)
                  return (
                    <div key={s.seat} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
                      <div className="col-span-2 text-sm text-white/80">{s.seat}</div>
                      <div className="col-span-4">
                        <input
                          className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80 outline-none focus:border-white/30"
                          value={s.name}
                          onChange={(e) => updateSeat(s.seat, { name: e.target.value })}
                        />
                      </div>
                      <div className="col-span-3">
                        <select
                          className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80"
                          value={s.kind}
                          onChange={(e) => {
                            const kind = e.target.value as SeatConfig["kind"]
                            updateSeat(s.seat, {
                              kind,
                              ai: kind === "ai" ? (s.ai ?? { provider: "mock" }) : undefined,
                            })
                            if (kind !== "human" && selfSeat === s.seat) {
                              setSelfSeat(null)
                            }
                          }}
                        >
                          <option value="ai">AI</option>
                          <option value="human">人类</option>
                        </select>
                      </div>
                      <div className="col-span-3">
                        {s.kind === "ai" ? (
                          <select
                            className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80"
                            value={matchedPresetId ?? "__custom__"}
                            onChange={(e) => selectPresetForSeat(s.seat, e.target.value)}
                          >
                            {aiPresets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                            {!matchedPresetId && (
                              <option value="__custom__" disabled>
                                自定义
                              </option>
                            )}
                          </select>
                        ) : (
                          <div className="text-xs text-white/40">-</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] tracking-[0.22em] text-white/45">我操控座位</div>
                <select
                  className="mt-2 w-full rounded-md border border-white/15 bg-black/30 px-2 py-2 text-sm text-white/80"
                  value={selfSeat ?? ""}
                  onChange={(e) => setSelfSeat(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">不加入（纯观战）</option>
                  {humanSeats.map((n) => (
                    <option key={n} value={n}>
                      {n}号
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-white/45">提示：自选座位需先把该座位类型改为“人类”。</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] tracking-[0.22em] text-white/45">AI 模型配置</div>
                <div className="mt-2 text-xs text-white/55">
                  在上方「AI 模型管理」中添加模型配置，每个 AI 座位只需下拉选择即可复用。
                </div>
                <div className="mt-2 text-xs text-white/35">未填写 Key 或请求失败时会自动回退到 mock 策略。</div>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-white/80">
                {error}
              </div>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <Panel title="角色池（可配置）" subtitle="角色数量必须与人数一致；这里按「座位列表」顺序分配。">
            <div className="grid grid-cols-2 gap-2">
              {rolePool.map((r, idx) => (
                <label key={idx} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-xs text-white/55">#{idx + 1}</div>
                  <select
                    className="w-full rounded-md border border-white/15 bg-black/30 px-2 py-1 text-sm text-white/80"
                    value={r}
                    onChange={(e) => updateRoleAt(idx, e.target.value as Role)}
                  >
                    {roles.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <button
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                onClick={() => setRolePool(defaultRolePool(playerCount))}
              >
                使用推荐配置
              </button>
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/55">
                分配规则：随机洗牌 rolePool，然后按 seat 顺序发到每个玩家。
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </NoirLayout>
  )
}
