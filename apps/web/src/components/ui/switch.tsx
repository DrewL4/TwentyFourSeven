import * as React from "react"

import { cn } from "@/lib/utils"

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e)
      onCheckedChange?.(e.target.checked)
    }

    return (
      <label
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
          className
        )}
        data-state={props.checked ? "checked" : "unchecked"}
      >
        <input
          ref={ref}
          type="checkbox"
          className="sr-only"
          onChange={handleChange}
          {...props}
        />
        <span
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
            props.checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </label>
    )
  }
)
Switch.displayName = "Switch"

export { Switch } 