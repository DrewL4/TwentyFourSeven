/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck: a kit with the same exports as WatchTower's and ESPG's, so the shared Users tab and person page need no typing here.
"use client"
import * as React from "react"
import {
  ArrowLeft, Calendar, Check, ChevronDown, ChevronRight, ChevronUp, Clock, Mail, Search, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Card as UiCard } from "@/components/ui/card"
import { Badge as UiBadge } from "@/components/ui/badge"
import { Button as UiButton } from "@/components/ui/button"
import { Input as UiInput } from "@/components/ui/input"
import { Switch as UiSwitch } from "@/components/ui/switch"
import { Table as UiTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/*
 * 24/7's kit for the shared Users tab and person page, built from the app's own shadcn components and tokens.
 * WatchTower and ESPG have a file with the same exports in their own look, so UsersTab and UserPage never name a
 * colour or a corner radius themselves.
 */

export const tx = {
  strong: "text-foreground",
  muted: "text-muted-foreground",
  subtle: "text-muted-foreground",
  danger: "text-destructive",
  ok: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  link: "text-accent-text",
  divide: "divide-y divide-border",
  rule: "border-border",
  well: "rounded-xl bg-muted/50",
}

export const Icons = {
  Search, Back: ArrowLeft, Next: ChevronRight, Up: ChevronUp, Down: ChevronDown, Check, Close: X, Mail, Calendar, Clock,
}

export function Card({ className = "", children, ...rest }) {
  return <UiCard className={cn("gap-0 py-0", className)} {...rest}>{children}</UiCard>
}

export function CardSection({ title, description, actions, children, className = "", bodyClassName = "", ...rest }) {
  return (
    <Card className={className} {...rest}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </Card>
  )
}

export function InlineSpinner({ label = "Loading", className = "" }) {
  return (
    <span role="status" aria-label={label}
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]", className)} />
  )
}

const BUTTON_VARIANTS = { primary: "default", secondary: "outline", ghost: "ghost", danger: "destructive", success: "default" }

export function Button({ variant = "secondary", size = "md", loading = false, loadingLabel = "Loading", icon: IconComp = null, className = "", children, type = "button", disabled, ...rest }) {
  return (
    <UiButton type={type} variant={BUTTON_VARIANTS[variant] || "outline"} disabled={disabled || loading}
      className={cn(size === "sm" ? "h-8 rounded-lg px-3 text-xs" : "h-9 px-4", variant === "ghost" && "self-start",
        variant === "success" && "bg-emerald-600 text-white shadow-none hover:bg-emerald-700", className)} {...rest}>
      {loading ? <InlineSpinner label={loadingLabel} /> : IconComp ? <IconComp className="h-4 w-4" aria-hidden /> : null}
      {children}
    </UiButton>
  )
}

const BADGE_TONES = {
  neutral: "bg-secondary text-secondary-foreground",
  accent: "bg-primary/20 text-accent-text",
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  danger: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
}

export function Badge({ tone = "neutral", children, className = "", ...rest }) {
  return (
    <UiBadge className={cn("gap-1 whitespace-nowrap border-transparent px-2 py-0.5 text-[11px] hover:opacity-100", BADGE_TONES[tone] || BADGE_TONES.neutral, className)} {...rest}>
      {children}
    </UiBadge>
  )
}

const AVATAR_SIZES = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl" }

export function Avatar({ name = "", size = "md", className = "" }) {
  const letters = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary/25 font-semibold text-accent-text", AVATAR_SIZES[size] || AVATAR_SIZES.md, className)}>
      {letters}
    </span>
  )
}

const FIELD = "tfs-field w-full rounded-lg border px-3 py-2 text-base text-foreground outline-none transition-[color,background-color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"

export const Input = React.forwardRef(function Input({ className = "", ...rest }, ref) {
  return <UiInput ref={ref} className={cn("h-10", className)} {...rest} />
})

export function Select({ className = "", children, ...rest }) {
  return <select className={cn(FIELD, "h-10 py-1 pr-8", className)} {...rest}>{children}</select>
}

export function SearchInput({ className = "", ...rest }) {
  return (
    <div className={cn("relative", className)}>
      <Icons.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <UiInput type="search" className="h-10 pl-9" {...rest} />
    </div>
  )
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={cn("block text-xs font-medium text-muted-foreground", className)}>
      {label}
      <div className="mt-1 text-sm font-normal text-foreground">{children}</div>
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function Chip({ active = false, count = null, children, className = "", ...rest }) {
  return (
    <button type="button" aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors touch-manipulation",
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-[rgba(60,60,67,0.14)] dark:hover:bg-white/16", className)} {...rest}>
      {children}
      {count !== null && <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", active ? "bg-black/10" : "bg-background/60 text-muted-foreground")}>{count}</span>}
    </button>
  )
}

export function PillTabs({ items, value, onChange, label = "Sections", className = "" }) {
  return (
    <div role="tablist" aria-label={label}
      className={cn("tfs-glass-panel flex gap-1 overflow-x-auto rounded-[14px] p-1 text-muted-foreground", className)}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={active} aria-controls={`panel-${item.id}`}
            data-testid={`tab-${item.id}`} data-state={active ? "active" : "inactive"} onClick={() => onChange(item.id)}
            className="relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition-colors touch-manipulation hover:bg-[rgba(107,114,128,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-primary">
            {item.label}
            {item.dot && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, disabled = false, className = "", ...rest }) {
  return <UiSwitch checked={checked} onChange={onChange} disabled={disabled} className={cn(disabled && "cursor-not-allowed opacity-50", className)} {...rest} />
}

export function Toggle({ checked, onChange, disabled = false, children, className = "", ...rest }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
      checked ? "bg-primary/25 text-accent-text ring-1 ring-primary" : "bg-secondary text-muted-foreground hover:bg-[rgba(60,60,67,0.14)] dark:hover:bg-white/16",
      disabled && "cursor-not-allowed opacity-50", className)}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={onChange} {...rest} />
      <span aria-hidden className={cn("inline-flex h-3.5 w-3.5 items-center justify-center rounded-full", checked ? "bg-accent-text text-white" : "ring-1 ring-border")}>
        {checked && <Icons.Check className="h-2.5 w-2.5" />}
      </span>
      {children}
    </label>
  )
}

export function Table({ label, children, className = "" }) {
  return <div className={className}><UiTable aria-label={label}>{children}</UiTable></div>
}
export function THead({ children }) {
  return <TableHeader><TableRow className="hover:bg-transparent">{children}</TableRow></TableHeader>
}
export function Th({ children, sortable = false, active = false, dir = "asc", onSort, className = "" }) {
  const base = "h-10 whitespace-nowrap px-4 text-xs"
  if (!sortable) return <TableHead scope="col" className={cn(base, className)}>{children}</TableHead>
  const Arrow = dir === "asc" ? Icons.Up : Icons.Down
  return (
    <TableHead scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn(base, className)}>
      <button type="button" onClick={onSort} className={cn("inline-flex items-center gap-1 [letter-spacing:inherit] [text-transform:inherit] hover:text-foreground", active && "text-foreground")}>
        {children}
        <Arrow className={cn("h-3 w-3", !active && "opacity-30")} aria-hidden />
      </button>
    </TableHead>
  )
}
export function TBody({ children }) {
  return <TableBody>{children}</TableBody>
}
export function Tr({ children, onClick, className = "", ...rest }) {
  return <TableRow onClick={onClick} className={cn("align-middle", onClick && "cursor-pointer", className)} {...rest}>{children}</TableRow>
}
export function Td({ children, className = "", ...rest }) {
  return <TableCell className={cn("px-4 py-3 align-middle", className)} {...rest}>{children}</TableCell>
}

const ALERT_TONES = {
  info: "border-border bg-muted/50 text-muted-foreground",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-100",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
}

export function Alert({ tone = "info", children, className = "", ...rest }) {
  return <div className={cn("rounded-xl border px-4 py-3 text-sm", ALERT_TONES[tone] || ALERT_TONES.info, className)} {...rest}>{children}</div>
}

export function EmptyState({ title, children, action = null }) {
  return (
    <div className="tfs-glass-panel rounded-2xl border-dashed px-6 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function StickyBar({ children, ...rest }) {
  return (
    <div className="sticky bottom-3 z-30 mt-4" {...rest}>
      <div className="tfs-glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-lg">
        {children}
      </div>
    </div>
  )
}
