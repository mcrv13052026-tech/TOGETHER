import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    bio: { type: String, default: '' },
    avatarMediaId: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, index: true },
    emailVerificationExpiresAt: { type: String, default: null },
    passwordResetTokenHash: { type: String, default: null, index: true },
    passwordResetExpiresAt: { type: String, default: null },
    role: { type: String, enum: ['owner', 'partner'], required: true },
    accountStatus: { type: String, enum: ['active', 'deleted'], default: 'active', index: true },
    themePreference: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
    notificationPrefs: { type: Schema.Types.Mixed, default: {} },
    privacyPrefs: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const InvitationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    inviterId: { type: String, required: true, index: true },
    intendedEmail: { type: String, default: null },
    status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], required: true, index: true },
    expiresAt: { type: String, required: true },
    acceptedUserId: { type: String, default: null },
    acceptedAt: { type: String, default: null },
    revokedAt: { type: String, default: null },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const ConnectionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true, index: true },
    partnerId: { type: String, default: null, index: true },
    status: { type: String, enum: ['pending', 'connected', 'disconnected'], required: true },
    connectedAt: { type: String, default: null },
    disconnectedAt: { type: String, default: null },
    disconnectedBy: { type: String, default: null },
    relationshipTitle: { type: String, default: 'Our Private Space' },
    anniversaryDate: { type: String, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const GoogleAccountSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true, unique: true, index: true },
    googleEmail: { type: String, required: true },
    encryptedRefreshToken: { type: String, required: true },
    accessTokenEncrypted: { type: String, default: null },
    accessTokenExpiresAt: { type: String, default: null },
    grantedScopes: { type: [String], default: [] },
    connectionStatus: { type: String, enum: ['connected', 'expired', 'revoked', 'disconnected'], required: true },
    driveFolderId: { type: String, default: null },
    lastQuotaBytesTotal: { type: Number, default: null },
    lastQuotaBytesUsed: { type: Number, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const MediaSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    ownerId: { type: String, required: true, index: true },
    storageProvider: { type: String, enum: ['google_drive', 'local_vault'], required: true },
    googleDriveFileId: { type: String, default: null },
    localFilename: { type: String, default: null },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mediaType: { type: String, enum: ['photo', 'video', 'audio'], required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
    thumbnailMediaId: { type: String, default: null },
    allowedViewerIds: { type: [String], default: [], index: true },
    albumIds: { type: [String], default: [] },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const PostSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true, index: true },
    caption: { type: String, default: '' },
    mediaIds: { type: [String], default: [] },
    location: { type: String, default: '' },
    editedAt: { type: String, default: null },
    createdAt: { type: String, required: true, index: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const ReelSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true, index: true },
    mediaId: { type: String, required: true },
    coverMediaId: { type: String, default: null },
    caption: { type: String, default: '' },
    audioLabel: { type: String, default: 'Original Audio' },
    watchHistory: { type: [Schema.Types.Mixed], default: [] },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const StorySchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true, index: true },
    storyType: { type: String, enum: ['photo', 'video', 'text'], required: true },
    mediaId: { type: String, default: null },
    textContent: { type: String, default: '' },
    backgroundStyle: { type: String, default: '' },
    caption: { type: String, default: '' },
    overlaySticker: { type: String, default: null },
    viewers: { type: [Schema.Types.Mixed], default: [] },
    reactions: { type: [Schema.Types.Mixed], default: [] },
    expiresAt: { type: String, required: true, index: true },
    archived: { type: Boolean, default: false },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const ConversationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    participantIds: { type: [String], required: true, index: true },
    lastMessageAt: { type: String, default: null },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const MessageSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    conversationId: { type: String, required: true, index: true },
    senderId: { type: String, required: true, index: true },
    messageType: { type: String, required: true },
    textContent: { type: String, default: '' },
    mediaId: { type: String, default: null },
    sharedPostId: { type: String, default: null },
    sharedReelId: { type: String, default: null },
    sharedStoryId: { type: String, default: null },
    replyToMessageId: { type: String, default: null },
    reactions: { type: [Schema.Types.Mixed], default: [] },
    readBy: { type: [Schema.Types.Mixed], default: [] },
    deletedForAll: { type: Boolean, default: false },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const AlbumSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    creatorId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    coverMediaId: { type: String, default: null },
    mediaIds: { type: [String], default: [] },
    isShared: { type: Boolean, default: true },
    isFavoriteBy: { type: [String], default: [] },
    memoryDate: { type: String, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false }
);

const CommentSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    targetType: { type: String, enum: ['post', 'reel'], required: true, index: true },
    targetId: { type: String, required: true, index: true },
    authorId: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const LikeSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    targetType: { type: String, enum: ['post', 'reel'], required: true },
    targetId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);
LikeSchema.index({ targetType: 1, targetId: 1, userId: 1 }, { unique: true });

const SavedMediaSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    targetType: { type: String, enum: ['post', 'reel'], required: true },
    targetId: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);
SavedMediaSchema.index({ targetType: 1, targetId: 1, userId: 1 }, { unique: true });

const NotificationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    recipientId: { type: String, required: true, index: true },
    actorId: { type: String, default: null },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: '/' },
    read: { type: Boolean, default: false },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const CallSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    callerId: { type: String, required: true, index: true },
    calleeId: { type: String, required: true, index: true },
    callType: { type: String, enum: ['audio', 'video'], required: true },
    status: { type: String, required: true },
    startedAt: { type: String, required: true },
    answeredAt: { type: String, default: null },
    endedAt: { type: String, default: null },
    durationSeconds: { type: Number, default: 0 },
  },
  { versionKey: false }
);

const ActivitySchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    summary: { type: String, required: true },
    category: { type: String, required: true },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

const SessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    revoked: { type: Boolean, default: false, index: true },
    lastActiveAt: { type: String, required: true },
    expiresAt: { type: String, required: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false }
);

const AuditLogSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: String, required: true, index: true },
  },
  { versionKey: false }
);

export const MongoModels = {
  User: mongoose.models.User || mongoose.model('User', UserSchema, 'users'),
  Invitation: mongoose.models.Invitation || mongoose.model('Invitation', InvitationSchema, 'invitations'),
  Connection: mongoose.models.Connection || mongoose.model('Connection', ConnectionSchema, 'connections'),
  GoogleAccount: mongoose.models.GoogleAccount || mongoose.model('GoogleAccount', GoogleAccountSchema, 'googleAccounts'),
  Media: mongoose.models.Media || mongoose.model('Media', MediaSchema, 'media'),
  Post: mongoose.models.Post || mongoose.model('Post', PostSchema, 'posts'),
  Reel: mongoose.models.Reel || mongoose.model('Reel', ReelSchema, 'reels'),
  Story: mongoose.models.Story || mongoose.model('Story', StorySchema, 'stories'),
  Conversation: mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema, 'conversations'),
  Message: mongoose.models.Message || mongoose.model('Message', MessageSchema, 'messages'),
  Album: mongoose.models.Album || mongoose.model('Album', AlbumSchema, 'albums'),
  Comment: mongoose.models.Comment || mongoose.model('Comment', CommentSchema, 'comments'),
  Like: mongoose.models.Like || mongoose.model('Like', LikeSchema, 'likes'),
  SavedMedia: mongoose.models.SavedMedia || mongoose.model('SavedMedia', SavedMediaSchema, 'savedMedia'),
  Notification: mongoose.models.Notification || mongoose.model('Notification', NotificationSchema, 'notifications'),
  Call: mongoose.models.Call || mongoose.model('Call', CallSchema, 'calls'),
  Activity: mongoose.models.Activity || mongoose.model('Activity', ActivitySchema, 'activities'),
  Session: mongoose.models.Session || mongoose.model('Session', SessionSchema, 'sessions'),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema, 'auditLogs'),
};
