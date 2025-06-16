"use client";
import { ModeToggle } from "./mode-toggle";

export default function Header() {
  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex flex-row items-center justify-end px-4 py-3">
        <div className="flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>
    </div>
  );
}
