import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export function Panel(props: {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_-40px_rgba(0,0,0,0.9)]",
        props.className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.22] [background-image:radial-gradient(70%_60%_at_20%_0%,rgba(255,255,255,0.10),transparent_65%),radial-gradient(60%_60%_at_80%_100%,rgba(255,80,80,0.08),transparent_60%)]" />
      {(props.title || props.right) && (
        <div className="relative flex items-start justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            {props.title && (
              <div className="font-display text-sm tracking-[0.22em] uppercase text-[var(--fg-strong)]">
                {props.title}
              </div>
            )}
            {props.subtitle && <div className="mt-1 text-xs text-white/45">{props.subtitle}</div>}
          </div>
          <div className="shrink-0">{props.right}</div>
        </div>
      )}
      <div className="relative p-4">{props.children}</div>
    </section>
  )
}

