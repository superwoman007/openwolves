import { NoirLayout } from "@/components/NoirLayout"
import { Panel } from "@/components/Panel"
import { ActionPanel } from "@/components/game/ActionPanel"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, createAuthEventSource } from "@/lib/api"
import { useStaggeredEvents } from "@/hooks/useStaggeredEvents"
import type { GameConfig, GameEvent, GamePrivateState, GamePublicState, HumanAction, ReplayPayload, Role, SeatConfig } from "@shared/game"
import { ArrowRight, Loader2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"

const phaseLabel: Record<GamePublicState["phase"], string> = {
  lobby: "准备",
  night: "夜晚",
  day_speech: "白天·发言",
  day_vote: "白天·投票",
  day_vote_pk: "白天·PK投票",
  day_last_words: "白天·遗言",
  resolve: "结算",
  ended: "结束",
}

const roleLabel: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  guard: "守卫",
  villager: "村民",
}

const safeJson = <T,>(text: string): T | null => {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export default function Game() {
  const { id } = useParams()
  const location = useLocation()
  const selfSeat = useMemo(() => {
    const v = new URLSearchParams(location.search).get("selfSeat")
    return v ? Number(v) : null
  }, [location.search])

  const [config, setConfig] = useState<GameConfig | null>(null)
  const [state, setState] = useState<GamePublicState | null>(null)
  const [priv, setPriv] = useState<GamePrivateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const displayedEvents = useStaggeredEvents(state?.lastEvents)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      try {
        const j = await apiGet<{ replay: ReplayPayload }>(`/api/games/${id}/replay`)
        if (!j.success || !("replay" in j)) throw new Error("error" in j ? j.error : "加载失败")
        if (!cancelled) setConfig(j.replay.config)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    setError(null)
    const es = createAuthEventSource(`/api/games/${id}/events`)
    esRef.current = es

    const onState = (ev: MessageEvent) => {
      const next = safeJson<GamePublicState>(ev.data)
      if (next) setState(next)
    }

    es.addEventListener("state", onState)
    es.addEventListener("error", () => setError("连接中断，尝试刷新页面"))

    return () => {
      es.removeEventListener("state", onState)
      es.close()
      esRef.current = null
    }
  }, [id])

  useEffect(() => {
    if (!id || selfSeat === null) return
    if (!state) return
    let cancelled = false
    const load = async () => {
      try {
        const j = await apiGet<{ state: GamePrivateState }>(`/api/games/${id}/state/private`)
        if (!j.success || !("state" in j)) throw new Error("error" in j ? j.error : "加载私密信息失败")
        if (!cancelled) setPriv(j.state)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, selfSeat, state?.phase, state?.day, state?.aliveSeats?.join(",")])

  const seats = useMemo(() => config?.seats ?? [], [config])
  const aliveSet = useMemo(() => new Set(state?.aliveSeats ?? []), [state?.aliveSeats])

  const mySeatCfg = useMemo(
    () => (selfSeat !== null ? seats.find((s) => s.seat === selfSeat) ?? null : null),
    [seats, selfSeat],
  )

  const submit = async (action: HumanAction) => {
    if (!id || selfSeat === null) return
    setBusy(true)
    setError(null)
    try {
      const j = await apiPost<{ state?: GamePublicState }>(`/api/games/${id}/action`, { seat: selfSeat, action })
      if (!j.success) throw new Error("error" in j ? j.error : "提交失败")
      if ("state" in j && j.state) setState(j.state)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const advance = async () => {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const j = await apiPost<{ state?: GamePublicState }>(`/api/games/${id}/advance`)
      if (!j.success) throw new Error("error" in j ? j.error : "推进失败")
      if ("state" in j && j.state) setState(j.state)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title = state ? `DAY ${String(state.day).padStart(2, "0")} · ${phaseLabel[state.phase]}` : "加载中…"

  return (
    <NoirLayout
      title="Noir Werewolf"
      subtitle={title}
      right={
        id ? (
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs tracking-[0.18em] text-white/80 transition hover:bg-white/10"
            to={`/replay/${id}`}
          >
            <ArrowRight size={16} />
            <span>去复盘</span>
          </Link>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Panel title="玩家" subtitle={id ? `GameId: ${id}` : undefined}>
            <div className="grid grid-cols-2 gap-3">
              {seats.map((s) => {
                const alive = aliveSet.has(s.seat)
                const isMe = selfSeat === s.seat
                const isThinking = state?.thinkingSeats?.includes(s.seat)
                return (
                  <div
                    key={s.seat}
                    className={cn(
                      "rounded-lg border border-white/10 bg-black/25 px-3 py-3 transition",
                      alive ? "opacity-100" : "opacity-50",
                      isMe && "border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]",
                      isThinking && "border-amber-500/30 bg-amber-500/[0.04]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-display text-sm tracking-[0.18em] text-white/85">
                        {s.seat}号
                      </div>
                      <div className={cn("text-xs", alive ? "text-[var(--accent)]" : "text-[var(--danger)]")}>
                        {alive ? "ALIVE" : "DEAD"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-white/70">{s.name}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-white/45">
                      <span>{s.kind === "ai" ? "AI" : "HUMAN"}</span>
                      <div className="flex items-center gap-2">
                        {isThinking && (
                          <span className="inline-flex items-center gap-1 text-amber-400/80">
                            <Loader2 size={10} className="animate-spin" />
                            思考中
                          </span>
                        )}
                        {isMe && priv?.role ? <span className="text-white/75">{roleLabel[priv.role]}</span> : <span />}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-5">
          <Panel title="记录" subtitle="主持人播报 / 公共发言 / 关键事件">
            <div className="h-[520px] overflow-auto rounded-lg border border-white/10 bg-black/25 p-3">
              <div className="space-y-2">
                {displayedEvents.map((e, idx) => (
                  <EventCard key={`${e.ts}-${e.t}-${idx}`} e={e} idx={idx} />
                ))}
                {!displayedEvents.length && <div className="text-sm text-white/45">等待事件…</div>}
                {displayedEvents.length < (state?.lastEvents?.length ?? 0) && (
                  <div className="flex items-center gap-2 py-1 text-xs text-white/35">
                    <Loader2 size={12} className="animate-spin" />
                    <span>还有 {((state?.lastEvents?.length ?? 0) - displayedEvents.length)} 条记录待展示…</span>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-white/80">
                {error}
              </div>
            )}
          </Panel>
        </div>

        <div className="lg:col-span-3">
          <Panel
            title="行动"
            subtitle={selfSeat !== null ? `你是 ${selfSeat}号` : "纯观战：不占座位"}
            right={
              state && (state.phase === "day_speech" || state.phase === "day_vote" || state.phase === "day_vote_pk") ? (
                <button
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/40 px-3 py-1 text-xs text-white/75 hover:bg-white/10",
                    busy && "pointer-events-none opacity-60",
                  )}
                  onClick={advance}
                >
                  {busy ? <Loader2 className="animate-spin" size={14} /> : <ArrowRight size={14} />}
                  <span>{state.phase === "day_speech" ? "进入投票" : "强制结算"}</span>
                </button>
              ) : null
            }
          >
            {!state ? (
              <div className="text-sm text-white/45">加载中…</div>
            ) : selfSeat === null ? (
              <div className="space-y-3 text-sm text-white/55">
                <div>当前为纯观战模式；若想参与，请返回房间页把某个座位设为“人类”，并选择“我操控座位”。</div>
                <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/55">
                  实时更新通过 SSE 推送：/api/games/:id/events
                </div>
              </div>
            ) : !priv ? (
              <div className="text-sm text-white/45">读取身份信息…</div>
            ) : !aliveSet.has(selfSeat) ? (
              <div className="text-sm text-white/45">你已出局。继续观战 / 去复盘。</div>
            ) : (
              <ActionPanel
                state={state}
                priv={priv}
                seats={seats}
                selfSeat={selfSeat}
                busy={busy}
                onSubmit={submit}
              />
            )}
          </Panel>
        </div>
      </div>
    </NoirLayout>
  )
}

function EventCard({ e, idx }: { e: GameEvent; idx: number }) {
  return (
    <div
      className="animate-fade-in rounded-md border border-white/10 bg-white/[0.03] px-3 py-2"
      style={{ animationDelay: `${Math.min(idx * 80, 400)}ms` }}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] tracking-[0.18em] text-white/45">
        <span>{new Date(e.ts).toLocaleTimeString()}</span>
        <EventTypeBadge t={e.t} />
      </div>
      <div className="mt-1 text-sm text-white/80">
        {e.t === "chat_public" ? (
          <span>
            <span className="font-medium text-white/70">{e.seat}号</span>
            <span className="text-white/40">：</span>
            <span className="leading-relaxed">{e.text}</span>
          </span>
        ) : e.t === "phase" ? (
          <span className="text-[var(--accent)]">
            阶段切换：{phaseLabel[e.phase]} · Day {e.day}
          </span>
        ) : e.t === "result" ? (
          <span className="text-[var(--accent)] font-medium">{e.text}</span>
        ) : e.t === "action" ? (
          <span className="text-white/60">
            {e.seat}号行动：{e.action}
            {(e.payload != null && typeof e.payload === "object" && Object.keys(e.payload as Record<string, unknown>).length > 0) ? (
              <span className="ml-1 text-white/35">{JSON.stringify(e.payload)}</span>
            ) : null}
          </span>
        ) : e.t === "chat_private" ? (
          <span className="text-white/60">
            💬 私聊 {e.fromSeat}→{e.toSeat}：{e.text}
          </span>
        ) : e.t === "chat_wolf" ? (
          <span className="text-amber-300/70">
            🐺 狼人频道 {e.seat}号：{e.text}
          </span>
        ) : e.t === "system" ? (
          <span className="text-white/55">{e.text}</span>
        ) : (
          <span>-</span>
        )}
      </div>
    </div>
  )
}

function EventTypeBadge({ t }: { t: GameEvent["t"] }) {
  const colors: Record<string, string> = {
    chat_public: "bg-white/[0.06] text-white/50",
    phase: "bg-[var(--accent)]/10 text-[var(--accent)]/70",
    result: "bg-[var(--accent)]/10 text-[var(--accent)]/70",
    action: "bg-white/[0.06] text-white/40",
    chat_private: "bg-white/[0.06] text-white/40",
    chat_wolf: "bg-amber-500/10 text-amber-400/60",
    system: "bg-white/[0.06] text-white/40",
  }
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", colors[t] ?? "bg-white/[0.06] text-white/40")}>
      {t}
    </span>
  )
}
