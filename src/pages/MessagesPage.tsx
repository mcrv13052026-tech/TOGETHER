import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  History,
  ImagePlus,
  Mic,
  Phone,
  Reply,
  Send,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, formatDuration, formatRelativeTime, uploadMediaFile } from '../lib/api';

interface ChatMessage {
  id: string;
  senderId: string;
  messageType: 'text' | 'photo' | 'video' | 'voice' | 'post_share' | 'reel_share' | 'story_reply';
  textContent: string;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaDurationSeconds: number | null;
  sharedPostPreview: { id: string; caption: string; thumbnailUrl: string | null } | null;
  sharedReelPreview: { id: string; caption: string; videoUrl: string | null } | null;
  replyToPreview: { id: string; senderId: string; textContent: string; messageType: string } | null;
  reactions: { userId: string; emoji: string }[];
  readBy: { userId: string; readAt: string }[];
  deletedForAll: boolean;
  createdAt: string;
}

interface CallHistoryEntry {
  id: string;
  callerId: string;
  callType: 'audio' | 'video';
  status: string;
  startedAt: string;
  durationSeconds: number;
}

export function MessagesPage() {
  const { user, partner, startCall, subscribeRealtime } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  // Call history drawer
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);

  const endRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMessages = async () => {
    try {
      await api.get('/messages/conversations');
      const res = await api.get<{ messages: ChatMessage[] }>('/messages/history?limit=80');
      setMessages(res.data.messages);
      await api.post('/messages/read').catch(() => {});
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const unsub = subscribeRealtime((eventName, raw) => {
      if (eventName === 'message:new') {
        const msg = raw as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (msg.senderId !== user?.id) {
          void api.post('/messages/read').catch(() => {});
        }
      } else if (eventName === 'message:reaction' || eventName === 'message:delete') {
        const updated = raw as ChatMessage;
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      } else if (eventName === 'message:read') {
        const data = raw as { readerId: string; messageIds: string[]; readAt: string };
        setMessages((prev) =>
          prev.map((m) =>
            data.messageIds.includes(m.id) && !m.readBy.some((r) => r.userId === data.readerId)
              ? { ...m, readBy: [...m.readBy, { userId: data.readerId, readAt: data.readAt }] }
              : m
          )
        );
      } else if (eventName === 'typing') {
        const data = raw as { userId: string; isTyping: boolean };
        if (data.userId !== user?.id) {
          setPartnerTyping(data.isTyping);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          if (data.isTyping) {
            typingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 3500);
          }
        }
      }
    });
    return unsub;
  }, [subscribeRealtime, user?.id]);

  const emitTyping = (isTyping: boolean) => {
    void api.post('/messages/typing', { isTyping }).catch(() => {});
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.post<{ message: ChatMessage }>('/messages/send', {
        messageType: 'text',
        textContent: text,
        replyToMessageId: replyTo?.id || null,
      });
      setMessages((prev) => (prev.some((m) => m.id === res.data.message.id) ? prev : [...prev, res.data.message]));
      setText('');
      setReplyTo(null);
      emitTyping(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleFileAttachment = async (file: File) => {
    setSending(true);
    setError(null);
    try {
      const uploaded = await uploadMediaFile(file, file.name);
      const messageType = uploaded.mediaType === 'video' ? 'video' : 'photo';
      const res = await api.post<{ message: ChatMessage }>('/messages/send', {
        messageType,
        mediaId: uploaded.id,
        replyToMessageId: replyTo?.id || null,
      });
      setMessages((prev) => (prev.some((m) => m.id === res.data.message.id) ? prev : [...prev, res.data.message]));
      setReplyTo(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const startVoiceRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) audioChunksRef.current.push(evt.data);
      };
      recorder.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone permission is required to record voice messages.');
    }
  };

  const stopVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  };

  const sendVoiceMessage = async () => {
    if (!recordedBlob) return;
    setSending(true);
    setError(null);
    try {
      const ext = recordedBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const uploaded = await uploadMediaFile(recordedBlob, `voice-note.${ext}`, {
        durationSeconds: recordSeconds,
      });
      const res = await api.post<{ message: ChatMessage }>('/messages/send', {
        messageType: 'voice',
        mediaId: uploaded.id,
        replyToMessageId: replyTo?.id || null,
      });
      setMessages((prev) => (prev.some((m) => m.id === res.data.message.id) ? prev : [...prev, res.data.message]));
      setRecordedBlob(null);
      setRecordedUrl(null);
      setReplyTo(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (msgId: string, emoji: string) => {
    const res = await api.post<{ message: ChatMessage }>(`/messages/${msgId}/react`, { emoji });
    setMessages((prev) => prev.map((m) => (m.id === msgId ? res.data.message : m)));
  };

  const handleDeleteMsg = async (msgId: string) => {
    const res = await api.delete<{ message: ChatMessage }>(`/messages/${msgId}`);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? res.data.message : m)));
  };

  const openCallsDrawer = async () => {
    setCallHistoryOpen(true);
    const res = await api.get<{ calls: CallHistoryEntry[] }>('/calls/history');
    setCallHistory(res.data.calls);
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-7rem)] lg:h-screen flex flex-col bg-white dark:bg-zinc-950 lg:border-x border-zinc-200 dark:border-zinc-800">
      {/* Chat Header */}
      <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            name={partner?.displayName || 'Waiting for Partner'}
            avatarMediaId={partner?.avatarMediaId}
            size="sm"
            online={partner?.online}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {partner ? partner.displayName : 'Private Conversation'}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {partnerTyping
                ? 'Typing...'
                : partner
                ? partner.online
                  ? 'Active now'
                  : `@${partner.username} · Offline`
                : 'Invite your partner in Settings to chat together'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void startCall('audio')}
            disabled={!partner}
            aria-label="Start voice call"
            title="Start voice call"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => void startCall('video')}
            disabled={!partner}
            aria-label="Start video call"
            title="Start video call"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            <Video className="w-4 h-4" />
          </button>
          <button
            onClick={() => void openCallsDrawer()}
            aria-label="Call history"
            title="Call history"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {loading ? (
          <p className="text-center text-xs text-zinc-500">Loading private conversation...</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <p className="font-display text-lg font-medium">Private 1-on-1 Chat</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Only you and your approved partner have access to this conversation.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === user?.id;
            const seenByPartner = partner ? msg.readBy.some((r) => r.userId === partner.id) : false;

            return (
              <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                {msg.replyToPreview && (
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 px-3 py-1 mb-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 max-w-xs truncate">
                    Replying to: {msg.replyToPreview.textContent || msg.replyToPreview.messageType}
                  </div>
                )}

                <div
                  className={`group relative max-w-[82%] sm:max-w-md rounded-2xl px-4 py-2.5 text-sm ${
                    msg.deletedForAll
                      ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400 italic'
                      : isMine
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {msg.deletedForAll ? (
                    <span>Message deleted</span>
                  ) : (
                    <div className="space-y-2">
                      {msg.messageType === 'photo' && msg.mediaUrl && (
                        <img
                          src={msg.mediaUrl}
                          alt="Shared attachment"
                          referrerPolicy="no-referrer"
                          className="rounded-xl max-h-72 w-full object-cover"
                        />
                      )}
                      {msg.messageType === 'video' && msg.mediaUrl && (
                        <video src={msg.mediaUrl} controls playsInline className="rounded-xl max-h-72 w-full" />
                      )}
                      {msg.messageType === 'voice' && msg.mediaUrl && (
                        <div className="space-y-1 min-w-[220px]">
                          <audio src={msg.mediaUrl} controls className="w-full h-9" />
                          {msg.mediaDurationSeconds !== null && (
                            <p className="text-[10px] opacity-75 tabular-nums">
                              Voice note · {formatDuration(msg.mediaDurationSeconds)}
                            </p>
                          )}
                        </div>
                      )}
                      {msg.sharedPostPreview && (
                        <div className="rounded-xl overflow-hidden border border-white/15 bg-black/15 p-2 space-y-1.5">
                          {msg.sharedPostPreview.thumbnailUrl && (
                            <img
                              src={msg.sharedPostPreview.thumbnailUrl}
                              alt="Shared post"
                              className="w-full h-32 object-cover rounded-lg"
                            />
                          )}
                          <p className="text-xs opacity-90">{msg.sharedPostPreview.caption || 'Shared post'}</p>
                        </div>
                      )}
                      {msg.sharedReelPreview && (
                        <div className="rounded-xl overflow-hidden border border-white/15 bg-black/15 p-2 space-y-1">
                          <p className="text-xs font-medium">Shared Reel</p>
                          <p className="text-xs opacity-85">{msg.sharedReelPreview.caption || 'Watch in Reels'}</p>
                        </div>
                      )}
                      {msg.textContent && <p className="leading-relaxed whitespace-pre-wrap">{msg.textContent}</p>}
                    </div>
                  )}

                  {/* Quick Hover Actions */}
                  {!msg.deletedForAll && (
                    <div
                      className={`hidden group-hover:flex items-center gap-1 absolute -top-7 ${
                        isMine ? 'right-0' : 'left-0'
                      } bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-1.5 py-0.5 shadow-sm text-zinc-700 dark:text-zinc-200`}
                    >
                      {['❤️', '😂', '👍'].map((em) => (
                        <button
                          key={em}
                          onClick={() => void handleReact(msg.id, em)}
                          className="text-xs px-1 hover:scale-110 transition-transform"
                        >
                          {em}
                        </button>
                      ))}
                      <button
                        onClick={() => setReplyTo(msg)}
                        aria-label="Reply to message"
                        className="p-1 hover:text-rose-500"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                      {isMine && (
                        <button
                          onClick={() => void handleDeleteMsg(msg.id)}
                          aria-label="Delete message"
                          className="p-1 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Reactions & Timestamp + Read Receipt */}
                <div className="flex items-center gap-2 mt-1 px-1 text-[11px] text-zinc-400">
                  {msg.reactions.length > 0 && (
                    <span className="text-xs">{msg.reactions.map((r) => r.emoji).join(' ')}</span>
                  )}
                  <span>{formatRelativeTime(msg.createdAt)}</span>
                  {isMine && !msg.deletedForAll && (
                    <span className="inline-flex items-center">
                      {seenByPartner ? (
                        <CheckCheck className="w-3.5 h-3.5 text-rose-500" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Voice Preview Bar */}
      {recordedUrl && (
        <div className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <audio src={recordedUrl} controls className="h-9 flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRecordedBlob(null);
                setRecordedUrl(null);
              }}
              className="p-2 text-xs text-zinc-500 hover:text-zinc-900"
            >
              Discard
            </button>
            <button
              onClick={() => void sendVoiceMessage()}
              disabled={sending}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
            >
              Send Voice Note
            </button>
          </div>
        </div>
      )}

      {replyTo && (
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
          <span className="truncate text-zinc-600 dark:text-zinc-300">
            Replying to: {replyTo.textContent || replyTo.messageType}
          </span>
          <button onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300 border-t border-rose-200 dark:border-rose-900">
          {error}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSendText}
        className="p-3 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2"
      >
        <label
          aria-label="Send photo or video"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-zinc-600 dark:text-zinc-300"
        >
          <ImagePlus className="w-5 h-5" />
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileAttachment(f);
            }}
          />
        </label>

        <button
          type="button"
          onClick={recording ? stopVoiceRecording : () => void startVoiceRecording()}
          aria-label={recording ? 'Stop recording' : 'Record voice message'}
          className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors ${
            recording
              ? 'bg-rose-600 text-white'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
          }`}
        >
          {recording ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
        </button>

        {recording ? (
          <div className="flex-1 px-3 py-2 text-xs text-rose-600 font-medium tabular-nums">
            Recording voice note... {formatDuration(recordSeconds)}
          </div>
        ) : (
          <input
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              emitTyping(e.target.value.length > 0);
            }}
            placeholder="Write a private message..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-sm focus:outline-none"
          />
        )}

        <button
          type="submit"
          disabled={sending || !text.trim() || recording}
          aria-label="Send message"
          className="min-w-[40px] min-h-[40px] px-3.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Call History Drawer */}
      {callHistoryOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          onClick={() => setCallHistoryOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-zinc-900 h-full border-l border-zinc-200 dark:border-zinc-800 p-5 flex flex-col"
          >
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-base font-semibold">Call History</h2>
              <button onClick={() => setCallHistoryOpen(false)} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 mt-2">
              {callHistory.length === 0 ? (
                <p className="py-8 text-xs text-zinc-500">No calls recorded yet.</p>
              ) : (
                callHistory.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium capitalize">
                        {c.callType} call · {c.status}
                      </p>
                      <p className="text-zinc-500 mt-0.5">{formatRelativeTime(c.startedAt)}</p>
                    </div>
                    <span className="tabular-nums text-zinc-500">
                      {c.durationSeconds > 0 ? formatDuration(c.durationSeconds) : '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
