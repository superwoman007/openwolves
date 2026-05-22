import { cn } from "@/lib/utils"
import type { GamePrivateState, GamePublicState, HumanAction, SeatConfig } from "@shared/game"
import { Crosshair, Eye, Flame, Hand, Loader2, Shield, Skull, Syringe, Vote } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

export function ActionPanel(props: {
  state: GamePublicState
  priv: GamePrivateState
  seats: SeatConfig[]
  selfSeat: number
  busy: boolean
  onSubmit: (action: HumanAction) => void
}) {
  const alive = useMemo(() => new Set(props.state.aliveSeats), [props.state.aliveSeats])
  const targetOptions = useMemo(
    () => props.seats.filter((s) => alive.has(s.seat) && s.seat !== props.selfSeat),
    [alive, props.seats, props.selfSeat],
  )

  const [text, setText] = useState("")
  const [target, setTarget] = useState<number | "">("")
  const [poisonTarget, setPoisonTarget] = useState<number | "">("")

  useEffect(() => {
    setTarget("")
    setPoisonTarget("")
    setText("")
  }, [props.state.phase, props.state.day])

  if (props.state.phase === "day_speech") {
    return (
      <div className="space-y-3">
        <div className="text-xs text-white/55">公开发言</div>
        <textarea
          className="h-28 w-full resize-none rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80 outline-none focus:border-white/30"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入你的发言…"
        />
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            props.busy && "pointer-events-none opacity-60",
          )}
          onClick={() => props.onSubmit({ t: "chat_public", text: text.trim() || "（沉默）" })}
        >
          <Hand size={16} />
          <span>提交发言</span>
        </button>
      </div>
    )
  }

  if (props.state.phase === "day_vote" || props.state.phase === "day_vote_pk") {
    const isPk = props.state.phase === "day_vote_pk"
    return (
      <div className="space-y-3">
        <div className="text-xs text-white/55">{isPk ? "PK 投票" : "投票放逐"}</div>
        {isPk && (
          <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-2 text-xs text-white/60">
            平票 PK：只能从平票候选人中投票
          </div>
        )}
        <select
          className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
          value={target}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">弃票</option>
          {targetOptions.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.seat}号 · {s.name}
            </option>
          ))}
        </select>
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            props.busy && "pointer-events-none opacity-60",
          )}
          onClick={() => props.onSubmit({ t: "vote", targetSeat: target === "" ? null : target })}
        >
          <Vote size={16} />
          <span>提交投票</span>
        </button>
      </div>
    )
  }

  if (props.state.phase === "resolve") {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 text-xs text-white/55">
          <Crosshair size={14} />
          <span>猎人开枪</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/60">
          你已濒死，可以选择开枪带走一名玩家，或选择放弃。
        </div>
        <select
          className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
          value={target}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">放弃开枪</option>
          {targetOptions.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.seat}号 · {s.name}
            </option>
          ))}
        </select>
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            props.busy && "pointer-events-none opacity-60",
          )}
          onClick={() => props.onSubmit({ t: "hunter_shoot", targetSeat: target === "" ? null : target })}
        >
          <Crosshair size={16} />
          <span>提交决定</span>
        </button>
      </div>
    )
  }

  if (props.state.phase !== "night") {
    return <div className="text-sm text-white/45">当前阶段无需操作</div>
  }

  if (props.priv.role === "werewolf") {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 text-xs text-white/55">
          <Flame size={14} />
          <span>夜晚击杀</span>
        </div>
        <select
          className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
          value={target}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">不击杀</option>
          {targetOptions.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.seat}号 · {s.name}
            </option>
          ))}
        </select>
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            props.busy && "pointer-events-none opacity-60",
          )}
          onClick={() => props.onSubmit({ t: "wolf_kill", targetSeat: target === "" ? null : target })}
        >
          <Skull size={16} />
          <span>提交击杀</span>
        </button>
      </div>
    )
  }

  if (props.priv.role === "seer") {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 text-xs text-white/55">
          <Eye size={14} />
          <span>查验</span>
        </div>
        <select
          className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
          value={target}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">选择目标</option>
          {targetOptions.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.seat}号 · {s.name}
            </option>
          ))}
        </select>
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            (props.busy || target === "") && "pointer-events-none opacity-60",
          )}
          onClick={() => target !== "" && props.onSubmit({ t: "seer_check", targetSeat: target })}
        >
          <Eye size={16} />
          <span>提交查验</span>
        </button>
      </div>
    )
  }

  if (props.priv.role === "guard") {
    return (
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 text-xs text-white/55">
          <Shield size={14} />
          <span>守护</span>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/60">
          规则：不能连续两晚守护同一人。
        </div>
        <select
          className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
          value={target}
          onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">选择目标</option>
          {props.seats
            .filter((s) => alive.has(s.seat))
            .map((s) => (
              <option key={s.seat} value={s.seat}>
                {s.seat}号 · {s.name}
              </option>
            ))}
        </select>
        <button
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
            (props.busy || target === "") && "pointer-events-none opacity-60",
          )}
          onClick={() => target !== "" && props.onSubmit({ t: "guard_protect", targetSeat: target })}
        >
          <Shield size={16} />
          <span>提交守护</span>
        </button>
      </div>
    )
  }

  if (props.priv.role === "witch") {
    const victim = props.priv.nightHint?.wolfVictimSeat
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/60">
          今夜被袭击目标：{victim === null || victim === undefined ? "未知/无" : `${victim}号`}
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs text-white/55">
            <Syringe size={14} />
            <span>解药</span>
          </div>
          <button
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
              props.busy && "pointer-events-none opacity-60",
            )}
            onClick={() => props.onSubmit({ t: "witch_antidote", targetSeat: victim ?? null })}
          >
            <Syringe size={16} />
            <span>使用解药（救）</span>
          </button>
          <button
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-black/30 px-4 py-2 text-sm text-white/70 hover:bg-white/10",
              props.busy && "pointer-events-none opacity-60",
            )}
            onClick={() => props.onSubmit({ t: "witch_antidote", targetSeat: null })}
          >
            <span>放弃解药</span>
          </button>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs text-white/55">
            <Skull size={14} />
            <span>毒药</span>
          </div>
          <select
            className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/80"
            value={poisonTarget}
            onChange={(e) => setPoisonTarget(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">不使用毒药</option>
            {targetOptions.map((s) => (
              <option key={s.seat} value={s.seat}>
                {s.seat}号 · {s.name}
              </option>
            ))}
          </select>
          <button
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10",
              props.busy && "pointer-events-none opacity-60",
            )}
            onClick={() =>
              props.onSubmit({
                t: "witch_poison",
                targetSeat: poisonTarget === "" ? null : poisonTarget,
              })
            }
          >
            <Skull size={16} />
            <span>提交毒药</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 text-sm text-white/55">
      <div className="rounded-lg border border-white/10 bg-black/25 p-3">
        你的身份：{props.priv.role}
      </div>
      <div className="text-xs text-white/40">当前阶段无需操作，等待其他玩家行动。</div>
      <div className="mt-2 flex items-center justify-center gap-2 text-xs text-white/45">
        <Loader2 size={14} className={cn(props.busy ? "animate-spin" : "opacity-0")} />
        <span>等待其他玩家行动…</span>
      </div>
    </div>
  )
}

