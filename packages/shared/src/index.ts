export * from "./events";

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
}

export interface AttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  downloadPath: string;
}

export interface MessageDto {
  id: string;
  chatId: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentDto[];
}

export interface ChatListItemDto {
  id: string;
  type: "direct";
  updatedAt: string;
  unreadCount: number;
  lastMessage: MessageDto | null;
  members: SafeUser[];
}