import { useEffect, useRef, useState, useCallback } from "react"
import type { GameEvent } from "@shared/game"

const REVEAL_INTERVAL_MS = 600

function eventKey(e: GameEvent, idx: number) {
  return `${e.ts}-${e.t}-${idx}`
}

export function useStaggeredEvents(events: GameEvent[] | undefined) {
  const [displayed, setDisplayed] = useState<GameEvent[]>([])
  const pendingRef = useRef<GameEvent[]>([])
  const seenRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const revealNext = useCallback(() => {
    if (pendingRef.current.length === 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    const next = pendingRef.current.shift()!
    setDisplayed((prev) => [...prev, next])
  }, [])

  useEffect(() => {
    if (!events || events.length === 0) return

    // Find new events not yet seen
    const newEvents: GameEvent[] = []
    for (let i = 0; i < events.length; i++) {
      const key = eventKey(events[i], i)
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key)
        newEvents.push(events[i])
      }
    }

    if (newEvents.length > 0) {
      const [firstEvent, ...restEvents] = newEvents
      setDisplayed((prev) => [...prev, firstEvent])
      pendingRef.current.push(...restEvents)
      if (pendingRef.current.length > 0 && !timerRef.current) {
        timerRef.current = setInterval(revealNext, REVEAL_INTERVAL_MS)
      }
    }
  }, [events, revealNext])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return displayed
}
