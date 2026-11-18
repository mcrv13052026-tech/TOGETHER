import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export interface PublicUser {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  emailVerified: boolean;
  role: 'owner' | 'partner';
  themePreference?: 'system' | 'light' | 'dark';
  notificationPrefs?: {
    messages: boolean;
    likesAndComments: boolean;
    stories: boolean;
    calls: boolean;
    invitations: boolean;
  };
  privacyPrefs: {
    readReceipts: boolean;
    onlinePresence: boolean;
    activityStatus: boolean;
  };
  online?: boolean;
  createdAt: string;
}

export interface ConnectionInfo {
  id: string;
  ownerId: string;
  partnerId: string | null;
  status: 'pending' | 'connected' | 'disconnected';
  connectedAt: string | null;
  relationshipTitle: string;
  anniversaryDate: string | null;
}

export interface GoogleDriveSummary {
  connected: boolean;
  status: 'connected' | 'expired' | 'revoked' | 'disconnected';
  googleEmail?: string;
  lastQuotaBytesTotal?: number | null;
  lastQuotaBytesUsed?: number | null;
}

export interface Capabilities {
  database: string;
  googleDriveConfigured: boolean;
  ablyConfigured: boolean;
  emailConfigured: boolean;
  turnConfigured: boolean;
  privacyContactEmail: string;
}

export interface DevEmailItem {
  id: string;
  to: string;
  subject: string;
  actionUrl?: string;
  sentAt: string;
}

export interface IncomingCallEvent {
  call: {
    id: string;
    callerId: string;
    calleeId: string;
    callType: 'audio' | 'video';
    status: string;
  };
  caller: {
    id: string;
    displayName: string;
    username: string;
    avatarMediaId: string | null;
  };
}

type RealtimeListener = (event: string, data: unknown) => void;

interface AuthContextValue {
  loading: boolean;
  user: PublicUser | null;
  partner: PublicUser | null;
  connection: ConnectionInfo | null;
  googleDrive: GoogleDriveSummary;
  capabilities: Capabilities | null;
  unreadNotifications: number;
  devEmails: DevEmailItem[];
  activeCall: {
    callId: string;
    callType: 'audio' | 'video';
    direction: 'outgoing' | 'incoming';
    remoteUser: { id: string; displayName: string; username: string; avatarMediaId: string | null };
  } | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  startCall: (callType: 'audio' | 'video') => Promise<void>;
  closeCallOverlay: () => void;
  subscribeRealtime: (fn: RealtimeListener) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [partner, setPartner] = useState<PublicUser | null>(null);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [googleDrive, setGoogleDrive] = useState<GoogleDriveSummary>({ connected: false, status: 'disconnected' });
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [devEmails, setDevEmails] = useState<DevEmailItem[]>([]);
  const [activeCall, setActiveCall] = useState<AuthContextValue['activeCall']>(null);

  const listenersRef = useRef(new Set<RealtimeListener>());

  const subscribeRealtime = useCallback((fn: RealtimeListener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await api.get('/auth/session');
      setUser(res.data.user);
      setPartner(res.data.partner);
      setConnection(res.data.connection);
      setGoogleDrive(res.data.googleDrive);
      setCapabilities(res.data.capabilities);
      setUnreadNotifications(res.data.unreadNotifications || 0);
      setDevEmails(res.data.devEmails || []);
    } catch {
      setUser(null);
      setPartner(null);
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Connect Server-Sent Events realtime stream whenever verified user is authenticated
  useEffect(() => {
    if (!user || !user.emailVerified) return;

    const evtSource = new EventSource('/api/realtime/stream', { withCredentials: true });
    const eventNames = [
      'message:new',
      'message:reaction',
      'message:read',
      'message:delete',
      'typing',
      'presence',
      'notification:new',
      'call:incoming',
      'call:signal',
      'call:status',
    ];

    const handlers: Array<[string, (e: MessageEvent) => void]> = eventNames.map((name) => {
      const handler = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          if (name === 'presence' && parsed.userId) {
            setPartner((prev) => (prev && prev.id === parsed.userId ? { ...prev, online: parsed.online } : prev));
          }
          if (name === 'notification:new') {
            setUnreadNotifications((c) => c + 1);
          }
          if (name === 'call:incoming') {
            const payload = parsed as IncomingCallEvent;
            setActiveCall({
              callId: payload.call.id,
              callType: payload.call.callType,
              direction: 'incoming',
              remoteUser: payload.caller,
            });
          }
          for (const fn of listenersRef.current) {
            fn(name, parsed);
          }
        } catch {
          // ignore malformed SSE chunk
        }
      };
      evtSource.addEventListener(name, handler);
      return [name, handler];
    });

    return () => {
      for (const [name, handler] of handlers) {
        evtSource.removeEventListener(name, handler);
      }
      evtSource.close();
    };
  }, [user?.id, user?.emailVerified]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setPartner(null);
      setConnection(null);
      setActiveCall(null);
    }
  }, []);

  const startCall = useCallback(
    async (callType: 'audio' | 'video') => {
      if (!partner) return;
      const res = await api.post('/calls/initiate', { callType });
      setActiveCall({
        callId: res.data.call.id,
        callType,
        direction: 'outgoing',
        remoteUser: {
          id: partner.id,
          displayName: partner.displayName,
          username: partner.username,
          avatarMediaId: partner.avatarMediaId,
        },
      });
    },
    [partner]
  );

  const closeCallOverlay = useCallback(() => {
    setActiveCall(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        partner,
        connection,
        googleDrive,
        capabilities,
        unreadNotifications,
        devEmails,
        activeCall,
        refreshSession,
        logout,
        startCall,
        closeCallOverlay,
        subscribeRealtime,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
