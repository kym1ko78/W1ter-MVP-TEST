"use client";

import { createContext, useContext } from "react";

export type RealtimeConnectionState = "connecting" | "connected" | "disconnected";
export type NotificationPermissionState = NotificationPermission | "unsupported";
export type CallMode = "audio" | "video";
export type CallSignalType = "offer" | "answer" | "ice-candidate";

export type RealtimeCallIncomingPayload = {
  chatId: string;
  callId: string;
  mode: CallMode;
  fromUserId: string;
  createdAt: string;
};

export type RealtimeCallAcceptedPayload = {
  chatId: string;
  callId: string;
  userId: string;
  acceptedAt: string;
};

export type RealtimeCallDeclinedPayload = {
  chatId: string;
  callId: string;
  userId: string;
  reason: string | null;
  declinedAt: string;
};

export type RealtimeCallEndedPayload = {
  chatId: string;
  callId: string;
  userId: string;
  reason: string | null;
  endedAt: string;
};

export type RealtimeCallSignalPayload = {
  chatId: string;
  callId: string;
  fromUserId: string;
  signalType: CallSignalType;
  payload: unknown;
  createdAt: string;
};

type RealtimeEventPayloadByName = {
  "call:incoming": RealtimeCallIncomingPayload;
  "call:accepted": RealtimeCallAcceptedPayload;
  "call:declined": RealtimeCallDeclinedPayload;
  "call:ended": RealtimeCallEndedPayload;
  "call:signal": RealtimeCallSignalPayload;
};

export type RealtimeEventName = keyof RealtimeEventPayloadByName;
type RealtimeEventHandler<TName extends RealtimeEventName> = (
  payload: RealtimeEventPayloadByName[TName],
) => void;

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
  emitSocketEvent: (eventName: string, payload: unknown) => void;
  subscribeSocketEvent: <TName extends RealtimeEventName>(
    eventName: TName,
    handler: RealtimeEventHandler<TName>,
  ) => () => void;
};

async function noopAsync() {
  return;
}

function noop() {
  return;
}

function returnFalse() {
  return false;
}

const defaultValue: RealtimeContextValue = {
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
  emitSocketEvent: noop,
  subscribeSocketEvent: () => noop,
};

export const RealtimeContext = createContext<RealtimeContextValue>(defaultValue);

export function useRealtime() {
  return useContext(RealtimeContext);
}
