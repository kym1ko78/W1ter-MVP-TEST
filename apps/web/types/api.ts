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

export interface MessageReplyPreview {
  id: string;
  senderId: string;
  sender: SafeUser;
  body: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
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
  replyTo: MessageReplyPreview | null;
  sender: SafeUser;
  attachments: ChatAttachment[];
  reactions: MessageReactionSummary[];
}

export type ChatType = "direct" | "group";
export type ChatMemberRole = "creator" | "admin" | "member";

export interface ChatListItem {
  id: string;
  type: ChatType;
  title: string | null;
  updatedAt: string;
  unreadCount: number;
  currentUserRole: ChatMemberRole;
  isMuted?: boolean;
  mutedUntil?: string | null;
  isArchived?: boolean;
  archivedAt?: string | null;
  directStatus?: {
    blockedByCurrentUser: boolean;
    hasBlockedCurrentUser: boolean;
  } | null;
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

export interface GroupMemberItem {
  user: SafeUser;
  role: ChatMemberRole;
  joinedAt: string;
  isCurrentUser: boolean;
}

export interface GroupMembersResponse {
  chatId: string;
  title: string | null;
  members: GroupMemberItem[];
  permissions: {
    isCreator: boolean;
    isAdmin: boolean;
    canAddMembers: boolean;
    canRemoveMembers: boolean;
    canManageRoles: boolean;
    canLeaveGroup: boolean;
  };
}
