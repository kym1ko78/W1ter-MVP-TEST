export const SOCKET_EVENTS = {
  joinUserRoom: "join_user_room",
  joinChatRoom: "join_chat_room",
  presenceSync: "presence:sync",
  typingUpdate: "typing:update",
  typingChanged: "typing:changed",
  callStart: "call:start",
  callAccept: "call:accept",
  callDecline: "call:decline",
  callEnd: "call:end",
  callSignal: "call:signal",
  callIncoming: "call:incoming",
  callAccepted: "call:accepted",
  callDeclined: "call:declined",
  callEnded: "call:ended",
  messageNew: "message:new",
  messageAck: "message:ack",
  chatUpdated: "chat:updated",
  chatRead: "chat:read",
  presenceChanged: "presence:changed",
} as const;

export type SocketEventName =
  (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
