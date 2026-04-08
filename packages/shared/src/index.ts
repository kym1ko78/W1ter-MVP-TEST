export * from "./events";

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
}

export interface MessageDto {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatListItemDto {
  id: string;
  type: "direct";
  updatedAt: string;
  unreadCount: number;
  lastMessage: MessageDto | null;
  members: SafeUser[];
}
