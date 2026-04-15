"use client";

import { createContext, useContext, type ReactNode } from "react";

export const CHAT_LEFT_SIDEBAR_DEFAULT_WIDTH = 380;
export const CHAT_LEFT_SIDEBAR_MIN_WIDTH = 300;
export const CHAT_LEFT_SIDEBAR_MAX_WIDTH = 520;
export const CHAT_RIGHT_PANEL_DEFAULT_WIDTH = 332;
export const CHAT_RIGHT_PANEL_MIN_WIDTH = 280;
export const CHAT_RIGHT_PANEL_MAX_WIDTH = 420;
export const CHAT_CENTER_MIN_WIDTH = 560;

type ChatLayoutContextValue = {
  isDesktopLayout: boolean;
  leftSidebarWidth: number;
  rightPanelWidth: number;
  setLeftSidebarWidth: (value: number) => void;
  setRightPanelWidth: (value: number) => void;
};

const ChatLayoutContext = createContext<ChatLayoutContextValue | null>(null);

export function ChatLayoutProvider({
  value,
  children,
}: {
  value: ChatLayoutContextValue;
  children: ReactNode;
}) {
  return <ChatLayoutContext.Provider value={value}>{children}</ChatLayoutContext.Provider>;
}

export function useChatLayout() {
  const context = useContext(ChatLayoutContext);

  if (!context) {
    throw new Error("useChatLayout must be used within ChatLayoutProvider");
  }

  return context;
}
