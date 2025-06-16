"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

export interface MultiSelectProps {
  options: string[]
  value?: string[]
  onValueChange?: (value: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  loading?: boolean
  onSearch?: (search: string) => void
  maxItems?: number
  showCounter?: boolean
}

export function MultiSelect({
  options,
  value = [],
  onValueChange,
  placeholder = "Search and select multiple...",
  className,
  disabled = false,
  loading = false,
  onSearch,
  maxItems,
  showCounter = true,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [inputFocused, setInputFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce search to avoid too many API calls
  useEffect(() => {
    if (onSearch) {
      const timeoutId = setTimeout(() => {
        onSearch(searchValue)
      }, 300)
      return () => clearTimeout(timeoutId)
    }
  }, [searchValue, onSearch])

  // Filter options locally if no onSearch provided
  const filteredOptions = React.useMemo(() => {
    if (onSearch) {
      return options.filter(option => !value.includes(option))
    }
    if (!searchValue) {
      return options.filter(option => !value.includes(option))
    }
    return options.filter((option) =>
      option.toLowerCase().includes(searchValue.toLowerCase()) &&
      !value.includes(option)
    )
  }, [options, searchValue, onSearch, value])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setInputFocused(false)
        setSearchValue("")
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchValue(newValue)
    setOpen(true)
  }

  const handleOptionSelect = (option: string) => {
    if (maxItems && value.length >= maxItems) {
      return // Don't add more items if limit reached
    }
    
    const newValue = [...value, option]
    onValueChange?.(newValue)
    setSearchValue("")
    inputRef.current?.focus()
  }

  const handleRemoveItem = (itemToRemove: string) => {
    const newValue = value.filter(item => item !== itemToRemove)
    onValueChange?.(newValue)
  }

  const handleInputFocus = () => {
    setInputFocused(true)
    setOpen(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false)
      setInputFocused(false)
      setSearchValue("")
      inputRef.current?.blur()
    } else if (e.key === "Backspace" && !searchValue && value.length > 0) {
      // Remove last item when backspace is pressed with empty input
      handleRemoveItem(value[value.length - 1])
    }
  }

  const remainingSlots = maxItems ? maxItems - value.length : null

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <div className="min-h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <div className="flex flex-wrap gap-1">
            {value.map((item) => (
              <Badge
                key={item}
                variant="secondary"
                className="px-2 py-1 text-xs"
              >
                {item}
                <button
                  type="button"
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  onClick={() => handleRemoveItem(item)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <div className="flex-1 min-w-0">
              <Input
                ref={inputRef}
                type="text"
                placeholder={value.length === 0 ? placeholder : "Add more..."}
                value={searchValue}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                onKeyDown={handleKeyDown}
                disabled={disabled || (maxItems ? value.length >= maxItems : false)}
                className="border-0 p-0 h-auto shadow-none focus-visible:ring-0 placeholder:text-muted-foreground"
              />
            </div>
          </div>
        </div>
        <ChevronDown 
          className={cn(
            "absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50 transition-transform pointer-events-none",
            open && "rotate-180"
          )} 
        />
      </div>

      {open && (inputFocused || searchValue) && filteredOptions.length > 0 && (
        <Card className="absolute top-full z-50 mt-1 w-full border bg-popover p-0 shadow-md">
          <div className="max-h-[300px] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : (
              <>
                {filteredOptions.length > 10 && (
                  <div className="px-3 py-1 text-xs text-muted-foreground border-b bg-muted/30">
                    {filteredOptions.length} options available - scroll to see more
                  </div>
                )}
                {remainingSlots !== null && remainingSlots <= 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground border-b">
                    Maximum {maxItems} items selected
                  </div>
                )}
                {filteredOptions.map((option) => (
                  <div
                    key={option}
                    className={cn(
                      "relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                      maxItems && value.length >= maxItems && "opacity-50 cursor-not-allowed"
                    )}
                    onClick={() => {
                      if (!(maxItems && value.length >= maxItems)) {
                        handleOptionSelect(option)
                      }
                    }}
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    {option}
                  </div>
                ))}
              </>
            )}
          </div>
        </Card>
      )}

      {value.length > 0 && showCounter && (
        <div className="mt-1 text-xs text-muted-foreground">
          {value.length} selected{maxItems && ` (max ${maxItems})`}
        </div>
      )}
    </div>
  )
} 