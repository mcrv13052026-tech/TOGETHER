export type UserRole = 'owner' | 'partner';
export type AccountStatus = 'active' | 'deleted';

export interface NotificationPrefs {
  messages: boolean;
  likesAndComments: boolean;
  stories: boolean;
  calls: boolean;
  invitations: boolean;
}

export interface PrivacyPrefs {
  readReceipts: boolean;
  onlinePresence: boolean;
  activityStatus: boolean;
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
  bio: string;
  avatarMediaId: string | null;
  emailVerified: boolean;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  themePreference: 'system' | 'light' | 'dark';
  notificationPrefs: NotificationPrefs;
  privacyPrefs: PrivacyPrefs;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  id: string;
  tokenHash: string;
  inviterId: string;
  intendedEmail: string | null;
  status: InvitationStatus;
  expiresAt: string;
  acceptedUserId: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Connection {
  id: string;
  ownerId: string;
  partnerId: string | null;
  status: 'pending' | 'connected' | 'disconnected';
  connectedAt: string | null;
  disconnectedAt: string | null;
  disconnectedBy: string | null;
  relationshipTitle: string;
  anniversaryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleAccount {
  id: string;
  userId: string;
  googleEmail: string;
  encryptedRefreshToken: string;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
  grantedScopes: string[];
  connectionStatus: 'connected' | 'expired' | 'revoked' | 'disconnected';
  driveFolderId: string | null;
  lastQuotaBytesTotal: number | null;
  lastQuotaBytesUsed: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MediaKind = 'photo' | 'video' | 'audio';
export type StorageProvider = 'google_drive' | 'local_vault';

export interface MediaItem {
  id: string;
  ownerId: string;
  storageProvider: StorageProvider;
  googleDriveFileId: string | null;
  localFilename: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
  mediaType: MediaKind;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  thumbnailMediaId: string | null;
  allowedViewerIds: string[];
  albumIds: string[];
  createdAt: string;
}

export interface Post {
  id: string;
  authorId: string;
  caption: string;
  mediaIds: string[];
  location: string;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reel {
  id: string;
  authorId: string;
  mediaId: string;
  coverMediaId: string | null;
  caption: string;
  audioLabel: string;
  watchHistory: { userId: string; watchedAt: string }[];
  createdAt: string;
}

export interface Story {
  id: string;
  authorId: string;
  storyType: 'photo' | 'video' | 'text';
  mediaId: string | null;
  textContent: string;
  backgroundStyle: string;
  caption: string;
  overlaySticker: string | null;
  viewers: { userId: string; viewedAt: string }[];
  reactions: { userId: string; emoji: string; createdAt: string }[];
  expiresAt: string;
  archived: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  lastMessageAt: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: 'text' | 'photo' | 'video' | 'voice' | 'post_share' | 'reel_share' | 'story_reply';
  textContent: string;
  mediaId: string | null;
  sharedPostId: string | null;
  sharedReelId: string | null;
  sharedStoryId: string | null;
  replyToMessageId: string | null;
  reactions: { userId: string; emoji: string }[];
  readBy: { userId: string; readAt: string }[];
  deletedForAll: boolean;
  createdAt: string;
}

export interface Album {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  coverMediaId: string | null;
  mediaIds: string[];
  isShared: boolean;
  isFavoriteBy: string[];
  memoryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  targetType: 'post' | 'reel';
  targetId: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface Like {
  id: string;
  targetType: 'post' | 'reel';
  targetId: string;
  userId: string;
  createdAt: string;
}

export interface SavedMedia {
  id: string;
  targetType: 'post' | 'reel';
  targetId: string;
  userId: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: 'invite_accepted' | 'like' | 'comment' | 'message' | 'story_reply' | 'story_reaction' | 'call_missed' | 'album_shared' | 'security';
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface CallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
}

export interface ActivityItem {
  id: string;
  userId: string;
  summary: string;
  category: 'post' | 'album' | 'story' | 'reel' | 'connection' | 'drive';
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  userAgent: string;
  ipAddress: string;
  revoked: boolean;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  ipAddress: string;
  userAgent: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DatabaseState {
  users: User[];
  invitations: Invitation[];
  connections: Connection[];
  googleAccounts: GoogleAccount[];
  media: MediaItem[];
  posts: Post[];
  reels: Reel[];
  stories: Story[];
  conversations: Conversation[];
  messages: Message[];
  albums: Album[];
  comments: Comment[];
  likes: Like[];
  savedMedia: SavedMedia[];
  notifications: NotificationItem[];
  calls: CallRecord[];
  activities: ActivityItem[];
  sessions: SessionRecord[];
  auditLogs: AuditLog[];
}
