export const SOCKET_EVENTS = {
  joinUserRoom: "join_user_room",
  joinChatRoom: "join_chat_room",
  messageNew: "message:new",
  messageAck: "message:ack",
  chatUpdated: "chat:updated",
  chatRead: "chat:read",
  presenceChanged: "presence:changed",
} as const;

export type SocketEventName =
  (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

