"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"

export interface AutocompleteProps {
  options: string[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  loading?: boolean
  onSearch?: (search: string) => void
}

export function Autocomplete({
  options,
  value,
  onValueChange,
  placeholder = "Search and select...",
  className,
  disabled = false,
  loading = false,
  onSearch,
}: AutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(value || "")
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
      return options
    }
    if (!searchValue) {
      return options
    }
    return options.filter((option) =>
      option.toLowerCase().includes(searchValue.toLowerCase())
    )
  }, [options, searchValue, onSearch])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setInputFocused(false)
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
    
    // If the input value exactly matches an option, select it
    if (options.includes(newValue)) {
      onValueChange?.(newValue)
    } else if (value && newValue !== value) {
      // Clear selection if input doesn't match current value
      onValueChange?.("")
    }
  }

  const handleOptionSelect = (option: string) => {
    setSearchValue(option)
    onValueChange?.(option)
    setOpen(false)
    setInputFocused(false)
    inputRef.current?.blur()
  }

  const handleInputFocus = () => {
    setInputFocused(true)
    setOpen(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false)
      setInputFocused(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={searchValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="pr-8"
        />
        <ChevronDown 
          className={cn(
            "absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50 transition-transform",
            open && "rotate-180"
          )} 
        />
      </div>

      {open && (inputFocused || searchValue) && (
        <Card className="absolute top-full z-50 mt-1 w-full border bg-popover p-0 shadow-md">
          <div className="max-h-[200px] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No options found.
              </div>
            ) : (
              filteredOptions.map((option) => (
                <div
                  key={option}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    value === option && "bg-accent text-accent-foreground"
                  )}
                  onClick={() => handleOptionSelect(option)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option}
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  )
} 