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
  replyTo: {
    id: string;
    senderId: string;
    body: string | null;
    isDeleted: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
  attachments: AttachmentDto[];
  reactions: Array<{
    emoji: string;
    count: number;
    userIds: string[];
  }>;
}

export type ChatTypeDto = "direct" | "group";
export type ChatMemberRoleDto = "creator" | "admin" | "member";

export interface ChatListItemDto {
  id: string;
  type: ChatTypeDto;
  title: string | null;
  updatedAt: string;
  unreadCount: number;
  currentUserRole: ChatMemberRoleDto;
  lastMessage: MessageDto | null;
  members: SafeUser[];
}
