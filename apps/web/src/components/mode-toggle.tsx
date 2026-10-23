"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

const ORDER = ["light", "dark", "system"] as const
type Mode = (typeof ORDER)[number]

const LABELS: Record<Mode, string> = { light: "Light", dark: "Dark", system: "System" }

/**
 * ESPG/WatchTower theme cycle button: Light -> Dark -> System, stored by
 * next-themes under the same `theme` key ESPG uses (default System).
 */
export function ModeToggle({
  showLabel = false,
  className,
}: {
  showLabel?: boolean
  className?: string
}) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const current: Mode = mounted && (ORDER as readonly string[]).includes(theme ?? "")
    ? (theme as Mode)
    : "system"
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]

  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor
  const iconColor =
    current === "light"
      ? "text-yellow-600"
      : current === "dark"
        ? "text-gray-900 dark:text-gray-100"
        : "text-blue-600"

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md p-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-foreground touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      title={`Current theme: ${LABELS[current]}. Click to cycle: Light → Dark → System`}
      aria-label={`Theme: ${LABELS[current]}. Switch to ${LABELS[next]}`}
    >
      <Icon className={cn("h-5 w-5 shrink-0", iconColor)} aria-hidden="true" />
      {showLabel ? <span>{LABELS[current]}</span> : null}
    </button>
  )
}
