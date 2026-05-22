import { NoirLayout } from "@/components/NoirLayout"
import { Panel } from "@/components/Panel"
import { cn } from "@/lib/utils"
import type { ReplayPayload } from "@shared/game"
import { Download, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

export default function Replay() {
  const { id } = useParams()
  const [replay, setReplay] = useState<ReplayPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      setBusy(true)
      setError(null)
      try {
        const r = await fetch(`/api/games/${id}/replay`)
        const j = (await r.json()) as { success: boolean; replay?: ReplayPayload; error?: string }
        if (!j.success || !j.replay) throw new Error(j.error ?? "加载失败")
        if (!cancelled) setReplay(j.replay)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const download = () => {
    if (!replay) return
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `replay-${replay.gameId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const title = useMemo(() => (replay ? `REPLAY · ${replay.gameId.slice(0, 8)}` : "REPLAY"), [replay])

  return (
    <NoirLayout
      title="Noir Werewolf"
      subtitle={title}
      right={
        <div className="flex items-center gap-3">
          {id && (
            <Link
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs tracking-[0.18em] text-white/80 hover:bg-white/10"
              to={`/game/${id}`}
            >
              返回对局
            </Link>
          )}
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs tracking-[0.18em] text-white/80 hover:bg-white/10",
              (!replay || busy) && "pointer-events-none opacity-60",
            )}
            onClick={download}
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            <span>导出 JSON</span>
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Panel title="配置" subtitle="对局创建时的房间配置">
            {!replay ? (
              <div className="text-sm text-white/45">{busy ? "加载中…" : "暂无数据"}</div>
            ) : (
              <div className="space-y-3 text-sm text-white/70">
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="text-xs text-white/45">人数</div>
                  <div className="mt-1 font-display text-lg text-white/85">{replay.config.seats.length}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="text-xs text-white/45">角色池</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {replay.config.rolePool.map((r, i) => (
                      <span key={`${r}-${i}`} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/70">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-8">
          <Panel title="事件流" subtitle="按时间顺序展示；当前版本重点用于复盘与导出。">
            <div className="h-[640px] overflow-auto rounded-lg border border-white/10 bg-black/25 p-3">
              {!replay ? (
                <div className="text-sm text-white/45">{busy ? "加载中…" : "暂无数据"}</div>
              ) : (
                <div className="space-y-2">
                  {replay.events.map((e, idx) => (
                    <div key={idx} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[11px] tracking-[0.18em] text-white/45">
                        <span>{new Date(e.ts).toLocaleTimeString()}</span>
                        <span className="uppercase">{e.t}</span>
                      </div>
                      <div className="mt-1 text-sm text-white/80">
                        {e.t === "chat_public" ? (
                          <span>
                            <span className="text-white/55">{e.seat}号：</span>
                            {e.text}
                          </span>
                        ) : e.t === "phase" ? (
                          <span>
                            phase={e.phase} day={e.day}
                          </span>
                        ) : "text" in e ? (
                          <span>{(e as any).text}</span>
                        ) : (
                          <span>-</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {error && (
              <div className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-white/80">
                {error}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </NoirLayout>
  )
}

