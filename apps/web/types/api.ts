export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  emailVerificationSentAt: string | null;
  lastSeenAt: string | null;
}

export interface ChatAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  downloadPath: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isDeleted: boolean;
  sender: SafeUser;
  attachments: ChatAttachment[];
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
    body: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    isDeleted: boolean;
    attachments: ChatAttachment[];
  } | null;
  members: SafeUser[];
}

export interface MessagePage {
  items: ChatMessage[];
  nextCursor: string | null;
}
