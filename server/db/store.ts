import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../config/env.ts';
import type { DatabaseState } from './types.ts';
import { MongoModels } from './models.ts';

const EMPTY_STATE: DatabaseState = {
  users: [],
  invitations: [],
  connections: [],
  googleAccounts: [],
  media: [],
  posts: [],
  reels: [],
  stories: [],
  conversations: [],
  messages: [],
  albums: [],
  comments: [],
  likes: [],
  savedMedia: [],
  notifications: [],
  calls: [],
  activities: [],
  sessions: [],
  auditLogs: [],
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const VAULT_DIR = path.join(DATA_DIR, 'vault');
const DB_FILE = path.join(DATA_DIR, 'togetherspace.db.json');

let memoryState: DatabaseState | null = null;
let mongoReady = false;
let writeQueue: Promise<unknown> = Promise.resolve();

function ensureLocalDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function loadLocalState(): DatabaseState {
  if (memoryState) return memoryState;
  ensureLocalDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DatabaseState>;
      memoryState = {
        ...structuredClone(EMPTY_STATE),
        ...parsed,
      };
      return memoryState;
    } catch {
      memoryState = structuredClone(EMPTY_STATE);
      return memoryState;
    }
  }
  memoryState = structuredClone(EMPTY_STATE);
  persistLocalState(memoryState);
  return memoryState;
}

function persistLocalState(state: DatabaseState) {
  ensureLocalDirs();
  const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

export async function initDatabase(): Promise<void> {
  ensureLocalDirs();
  if (env.mongodbUri && !mongoReady) {
    await mongoose.connect(env.mongodbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    mongoReady = true;
    await syncFromMongo();
    return;
  }
  loadLocalState();
}

async function syncFromMongo(): Promise<DatabaseState> {
  const [
    users,
    invitations,
    connections,
    googleAccounts,
    media,
    posts,
    reels,
    stories,
    conversations,
    messages,
    albums,
    comments,
    likes,
    savedMedia,
    notifications,
    calls,
    activities,
    sessions,
    auditLogs,
  ] = await Promise.all([
    MongoModels.User.find().lean(),
    MongoModels.Invitation.find().lean(),
    MongoModels.Connection.find().lean(),
    MongoModels.GoogleAccount.find().lean(),
    MongoModels.Media.find().lean(),
    MongoModels.Post.find().lean(),
    MongoModels.Reel.find().lean(),
    MongoModels.Story.find().lean(),
    MongoModels.Conversation.find().lean(),
    MongoModels.Message.find().lean(),
    MongoModels.Album.find().lean(),
    MongoModels.Comment.find().lean(),
    MongoModels.Like.find().lean(),
    MongoModels.SavedMedia.find().lean(),
    MongoModels.Notification.find().lean(),
    MongoModels.Call.find().lean(),
    MongoModels.Activity.find().lean(),
    MongoModels.Session.find().lean(),
    MongoModels.AuditLog.find().lean(),
  ]);

  const strip = <T>(docs: unknown[]): T[] =>
    docs.map((d) => {
      const obj = { ...(d as Record<string, unknown>) };
      delete obj._id;
      return obj as T;
    });

  memoryState = {
    users: strip(users),
    invitations: strip(invitations),
    connections: strip(connections),
    googleAccounts: strip(googleAccounts),
    media: strip(media),
    posts: strip(posts),
    reels: strip(reels),
    stories: strip(stories),
    conversations: strip(conversations),
    messages: strip(messages),
    albums: strip(albums),
    comments: strip(comments),
    likes: strip(likes),
    savedMedia: strip(savedMedia),
    notifications: strip(notifications),
    calls: strip(calls),
    activities: strip(activities),
    sessions: strip(sessions),
    auditLogs: strip(auditLogs),
  };
  return memoryState;
}

async function syncCollectionToMongo(key: keyof DatabaseState, items: unknown[]) {
  const modelMap = {
    users: MongoModels.User,
    invitations: MongoModels.Invitation,
    connections: MongoModels.Connection,
    googleAccounts: MongoModels.GoogleAccount,
    media: MongoModels.Media,
    posts: MongoModels.Post,
    reels: MongoModels.Reel,
    stories: MongoModels.Story,
    conversations: MongoModels.Conversation,
    messages: MongoModels.Message,
    albums: MongoModels.Album,
    comments: MongoModels.Comment,
    likes: MongoModels.Like,
    savedMedia: MongoModels.SavedMedia,
    notifications: MongoModels.Notification,
    calls: MongoModels.Call,
    activities: MongoModels.Activity,
    sessions: MongoModels.Session,
    auditLogs: MongoModels.AuditLog,
  };
  const Model = modelMap[key];
  await Model.deleteMany({});
  if (items.length > 0) {
    await Model.insertMany(items);
  }
}

export function readState(): DatabaseState {
  if (!memoryState) {
    return loadLocalState();
  }
  return memoryState;
}

/**
 * Serialized atomic state mutation.
 * Prevents race conditions (e.g., concurrent 2nd-account invitation acceptance or simultaneous owner setup).
 */
export function mutateState<T>(
  mutator: (state: DatabaseState) => T | Promise<T>,
  dirtyCollections?: (keyof DatabaseState)[]
): Promise<T> {
  const run = writeQueue.then(async () => {
    const state = memoryState ? memoryState : loadLocalState();
    const result = await mutator(state);
    if (mongoReady) {
      const keys = dirtyCollections && dirtyCollections.length > 0
        ? dirtyCollections
        : (Object.keys(EMPTY_STATE) as (keyof DatabaseState)[]);
      await Promise.all(keys.map((k) => syncCollectionToMongo(k, state[k])));
    } else {
      persistLocalState(state);
    }
    return result;
  });

  writeQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

export function resetStateForTests() {
  memoryState = structuredClone(EMPTY_STATE);
  if (!mongoReady) {
    persistLocalState(memoryState);
  }
}
