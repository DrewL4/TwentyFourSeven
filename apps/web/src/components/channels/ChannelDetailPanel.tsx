"use client";

import type { ReactNode } from "react";

interface ChannelDetailPanelProps {
  main: ReactNode;
  sidebar: ReactNode | null;
}

/** Two-column channel detail layout (main + programming tools sidebar). */
export function ChannelDetailPanel({ main, sidebar }: ChannelDetailPanelProps) {
  return (
    <>
      <div className="lg:col-span-2">{main}</div>
      {sidebar}
    </>
  );
}
