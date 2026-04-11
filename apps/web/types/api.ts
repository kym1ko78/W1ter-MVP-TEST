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

export type ChatType = "direct" | "group";
export type ChatMemberRole = "creator" | "admin" | "member";

export interface ChatListItem {
  id: string;
  type: ChatType;
  title: string | null;
  updatedAt: string;
  unreadCount: number;
  currentUserRole: ChatMemberRole;
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
