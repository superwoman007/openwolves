import { cn } from "@/lib/utils"
import { FileText, Play, Skull } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

export function NoirLayout(props: {
  title: string
  subtitle?: string
  children: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-h-screen bg-[var(--bg)] text-[var(--fg)]", props.className)}>
      <div className="pointer-events-none fixed inset-0 opacity-[0.28] [background-image:radial-gradient(80%_50%_at_20%_0%,rgba(255,255,255,0.10),transparent),radial-gradient(60%_40%_at_80%_20%,rgba(208,255,167,0.06),transparent),radial-gradient(70%_60%_at_50%_100%,rgba(255,80,80,0.07),transparent)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.18] [background-image:repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_3px)]" />
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black/30 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <div className="font-display text-lg tracking-[0.12em] uppercase text-[var(--fg-strong)]">
                {props.title}
              </div>
              <div className="hidden text-xs tracking-[0.28em] text-white/45 md:block">
                {props.subtitle}
              </div>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] tracking-[0.22em] text-white/40">
              <Link className="inline-flex items-center gap-2 hover:text-white/70" to="/">
                <Play size={14} />
                <span>房间</span>
              </Link>
              <span className="h-3 w-px bg-white/10" />
              <span className="inline-flex items-center gap-2">
                <Skull size={14} />
                <span>对局</span>
              </span>
              <span className="h-3 w-px bg-white/10" />
              <span className="inline-flex items-center gap-2">
                <FileText size={14} />
                <span>复盘</span>
              </span>
            </div>
          </div>
          <div className="shrink-0">{props.right}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-6">{props.children}</main>
    </div>
  )
}
