"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type OrderMode = "CHRONOLOGICAL" | "RELEASE" | "RECOMMENDED";

export const ORDER_MODES: Array<{ value: OrderMode; label: string; hint: string }> = [
  { value: "RECOMMENDED", label: "Recommended", hint: "Story order where we know it, release order for the rest" },
  { value: "CHRONOLOGICAL", label: "Story order", hint: "The order things happen in the story" },
  { value: "RELEASE", label: "Release order", hint: "The order they came out" },
];

export function OrderControls(props: {
  mode: OrderMode;
  onMode: (mode: OrderMode) => void;
  includeShows: boolean;
  onIncludeShows: (value: boolean) => void;
  disabled?: boolean;
}) {
  const active = ORDER_MODES.find((m) => m.value === props.mode);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Order</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Order">
          {ORDER_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={props.mode === m.value}
              disabled={props.disabled}
              onClick={() => props.onMode(m.value)}
              className={cn(
                "min-h-10 rounded-lg border px-3 text-sm touch-manipulation disabled:opacity-50",
                props.mode === m.value ? "border-primary bg-primary/10 font-semibold" : "border-border",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {active && <p className="text-xs text-muted-foreground">{active.hint}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <div className="min-w-0">
          <Label htmlFor="include-shows" className="text-sm">Include TV shows</Label>
          <p className="text-xs text-muted-foreground">Off: movies only. On: shows, seasons and episodes play between the movies.</p>
        </div>
        <Switch
          id="include-shows"
          checked={props.includeShows}
          disabled={props.disabled}
          onCheckedChange={props.onIncludeShows}
          aria-label="Include TV shows"
        />
      </div>
    </div>
  );
}
