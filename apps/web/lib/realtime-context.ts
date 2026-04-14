import { createContext, useContext } from "react";

export type RealtimeConnectionState = "connecting" | "connected" | "disconnected";
export type NotificationPermissionState = NotificationPermission | "unsupported";

type RealtimeContextValue = {
  connectionState: RealtimeConnectionState;
  isOffline: boolean;
  statusesMayBeStale: boolean;
  notificationPermission: NotificationPermissionState;
  notificationsEnabled: boolean;
  notificationsSupported: boolean;
  requestNotificationPermission: () => Promise<void>;
  setNotificationsEnabled: (value: boolean) => void;
  isUserOnline: (userId: string | null | undefined) => boolean;
  isUserTyping: (chatId: string, userId: string | null | undefined) => boolean;
  updateTyping: (chatId: string, isTyping: boolean) => void;
};

const noopAsync = async () => {};
const noop = () => {};
const returnFalse = () => false;

export const RealtimeContext = createContext<RealtimeContextValue>({
  connectionState: "disconnected",
  isOffline: false,
  statusesMayBeStale: true,
  notificationPermission: "unsupported",
  notificationsEnabled: false,
  notificationsSupported: false,
  requestNotificationPermission: noopAsync,
  setNotificationsEnabled: noop,
  isUserOnline: returnFalse,
  isUserTyping: returnFalse,
  updateTyping: noop,
});

export function useRealtime() {
  return useContext(RealtimeContext);
}
