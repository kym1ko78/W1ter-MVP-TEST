export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  sender: SafeUser;
}

export interface ChatListItem {
  id: string;
  type: "direct";
  updatedAt: string;
  unreadCount: number;
  lastMessage: {
    id: string;
    chatId: string;
    senderId: string;
    body: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  members: SafeUser[];
}

export interface MessagePage {
  items: ChatMessage[];
  nextCursor: string | null;
}

