import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, formatDuration } from '../lib/api';
import { Avatar } from './Avatar';

export function CallOverlay() {
  const { activeCall, closeCallOverlay, subscribeRealtime } = useAuth();
  const [status, setStatus] = useState<'ringing' | 'connecting' | 'connected' | 'ended' | 'error'>('ringing');
  const [errorMsg, setErrorMsg] = useState('');
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [elapsed, setElapsed] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const cleanupMedia = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
  };

  useEffect(() => {
    if (!activeCall) return;
    setStatus('ringing');
    setErrorMsg('');
    setElapsed(0);
    setMicMuted(false);
    setCameraOff(activeCall.callType === 'audio');

    let timer: ReturnType<typeof setInterval> | null = null;
    if (status === 'connected') {
      timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [activeCall?.callId]);

  useEffect(() => {
    if (status !== 'connected') return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const initPeerConnection = async () => {
    if (!activeCall) return null;
    const iceRes = await api.get<{ iceServers: RTCIceServer[] }>('/calls/ice-config');
    const pc = new RTCPeerConnection({ iceServers: iceRes.data.iceServers });
    pcRef.current = pc;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: activeCall.callType === 'video' ? { facingMode } : false,
    });
    localStreamRef.current = stream;

    if (localVideoRef.current && activeCall.callType === 'video') {
      localVideoRef.current.srcObject = stream;
    }

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void api.post('/calls/signal', {
          callId: activeCall.callId,
          signalType: 'ice-candidate',
          payload: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;
      if (activeCall.callType === 'video' && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      } else if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
      setStatus('connected');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setErrorMsg('Call connection interrupted.');
      }
    };

    return pc;
  };

  // Outgoing call: wait for partner 'accept' signal before requesting camera/mic & sending offer
  useEffect(() => {
    if (!activeCall) return;

    const unsubscribe = subscribeRealtime(async (eventName, raw) => {
      if (eventName === 'call:status') {
        const data = raw as { id: string; status: string };
        if (data.id === activeCall.callId && (data.status === 'ended' || data.status === 'rejected')) {
          cleanupMedia();
          closeCallOverlay();
        }
        return;
      }

      if (eventName !== 'call:signal') return;
      const sig = raw as { callId: string; signalType: string; payload?: unknown };
      if (sig.callId !== activeCall.callId) return;

      try {
        if (sig.signalType === 'accept' && activeCall.direction === 'outgoing') {
          setStatus('connecting');
          const pc = await initPeerConnection();
          if (!pc) return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await api.post('/calls/signal', {
            callId: activeCall.callId,
            signalType: 'offer',
            payload: offer,
          });
        } else if (sig.signalType === 'offer' && activeCall.direction === 'incoming') {
          setStatus('connecting');
          const pc = pcRef.current || (await initPeerConnection());
          if (!pc) return;
          await pc.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
          for (const candidate of pendingIceRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingIceRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await api.post('/calls/signal', {
            callId: activeCall.callId,
            signalType: 'answer',
            payload: answer,
          });
        } else if (sig.signalType === 'answer' && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sig.payload as RTCSessionDescriptionInit));
          for (const candidate of pendingIceRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingIceRef.current = [];
        } else if (sig.signalType === 'ice-candidate' && sig.payload) {
          if (pcRef.current && pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(sig.payload as RTCIceCandidateInit));
          } else {
            pendingIceRef.current.push(sig.payload as RTCIceCandidateInit);
          }
        } else if (sig.signalType === 'hangup' || sig.signalType === 'reject') {
          cleanupMedia();
          closeCallOverlay();
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(extractErrorMessage(err, 'Call media permission or connection failed.'));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeCall, subscribeRealtime, closeCallOverlay]);

  useEffect(() => {
    return () => cleanupMedia();
  }, []);

  if (!activeCall) return null;

  const handleAccept = async () => {
    try {
      setStatus('connecting');
      await initPeerConnection();
      await api.post(`/calls/${activeCall.callId}/status`, { status: 'active' });
      await api.post('/calls/signal', {
        callId: activeCall.callId,
        signalType: 'accept',
      });
    } catch (err) {
      setStatus('error');
      setErrorMsg(extractErrorMessage(err, 'Microphone or camera access is required to answer this call.'));
    }
  };

  const handleReject = async () => {
    await api.post('/calls/signal', { callId: activeCall.callId, signalType: 'reject' }).catch(() => {});
    await api.post(`/calls/${activeCall.callId}/status`, { status: 'rejected' }).catch(() => {});
    cleanupMedia();
    closeCallOverlay();
  };

  const handleEnd = async () => {
    const finalStatus = status === 'ringing' && activeCall.direction === 'outgoing' ? 'missed' : 'ended';
    await api.post('/calls/signal', { callId: activeCall.callId, signalType: 'hangup' }).catch(() => {});
    await api.post(`/calls/${activeCall.callId}/status`, { status: finalStatus }).catch(() => {});
    cleanupMedia();
    closeCallOverlay();
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const next = !micMuted;
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !next;
    }
    setMicMuted(next);
  };

  const toggleCamera = () => {
    if (!localStreamRef.current) return;
    const next = !cameraOff;
    for (const track of localStreamRef.current.getVideoTracks()) {
      track.enabled = !next;
    }
    setCameraOff(next);
  };

  const switchCamera = async () => {
    if (!localStreamRef.current || activeCall.callType !== 'video') return;
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextMode } });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);
      }
      for (const oldTrack of localStreamRef.current.getVideoTracks()) {
        oldTrack.stop();
        localStreamRef.current.removeTrack(oldTrack);
      }
      if (newVideoTrack) {
        localStreamRef.current.addTrack(newVideoTrack);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setFacingMode(nextMode);
    } catch {
      setErrorMsg('Unable to switch camera on this device.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${activeCall.callType} call with ${activeCall.remoteUser.displayName}`}
    >
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Avatar
              name={activeCall.remoteUser.displayName}
              avatarMediaId={activeCall.remoteUser.avatarMediaId}
              size="sm"
            />
            <div>
              <p className="text-sm font-semibold">{activeCall.remoteUser.displayName}</p>
              <p className="text-xs text-zinc-400 tabular-nums">
                {activeCall.callType === 'video' ? 'Video call' : 'Voice call'} ·{' '}
                {status === 'connected'
                  ? formatDuration(elapsed)
                  : status === 'connecting'
                  ? 'Connecting...'
                  : activeCall.direction === 'incoming'
                  ? 'Incoming call'
                  : 'Calling...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            {localStreamRef.current && (
              <span>
                {micMuted ? 'Mic muted' : 'Mic active'}
                {activeCall.callType === 'video' ? ` · ${cameraOff ? 'Camera off' : 'Camera active'}` : ''}
              </span>
            )}
            <button
              onClick={handleEnd}
              aria-label="Close call window"
              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative aspect-video bg-zinc-950 flex items-center justify-center">
          {activeCall.callType === 'video' ? (
            <>
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="absolute bottom-4 right-4 w-36 aspect-video object-cover rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg"
              />
              {status !== 'connected' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/70">
                  <Avatar
                    name={activeCall.remoteUser.displayName}
                    avatarMediaId={activeCall.remoteUser.avatarMediaId}
                    size="xl"
                  />
                  <p className="text-sm text-zinc-300">
                    {status === 'ringing' && activeCall.direction === 'incoming'
                      ? `${activeCall.remoteUser.displayName} is calling you`
                      : status === 'connecting'
                      ? 'Establishing encrypted peer connection...'
                      : 'Ringing...'}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 p-8">
              <audio ref={remoteAudioRef} autoPlay />
              <Avatar
                name={activeCall.remoteUser.displayName}
                avatarMediaId={activeCall.remoteUser.avatarMediaId}
                size="xl"
              />
              <div className="text-center">
                <p className="text-lg font-semibold">{activeCall.remoteUser.displayName}</p>
                <p className="text-sm text-zinc-400 tabular-nums mt-1">
                  {status === 'connected' ? formatDuration(elapsed) : status === 'connecting' ? 'Connecting...' : 'Ringing...'}
                </p>
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="px-5 py-2.5 bg-rose-950/60 border-t border-rose-900 text-xs text-rose-200">{errorMsg}</div>
        )}

        <div className="flex items-center justify-center gap-4 px-5 py-4 bg-zinc-900 border-t border-zinc-800">
          {status === 'ringing' && activeCall.direction === 'incoming' ? (
            <>
              <button
                onClick={handleReject}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium transition-colors"
              >
                <PhoneOff className="w-4 h-4 text-rose-400" />
                Decline
              </button>
              <button
                onClick={handleAccept}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
              >
                <Phone className="w-4 h-4" />
                Accept
              </button>
            </>
          ) : (
            <>
              <button
                onClick={toggleMic}
                aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                className={`p-3 rounded-xl border transition-colors ${
                  micMuted
                    ? 'bg-rose-600/20 border-rose-500/40 text-rose-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                }`}
              >
                {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {activeCall.callType === 'video' && (
                <>
                  <button
                    onClick={toggleCamera}
                    aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                    className={`p-3 rounded-xl border transition-colors ${
                      cameraOff
                        ? 'bg-rose-600/20 border-rose-500/40 text-rose-300'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                    }`}
                  >
                    {cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={switchCamera}
                    aria-label="Switch camera"
                    className="p-3 rounded-xl border bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 transition-colors"
                  >
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                </>
              )}

              <button
                onClick={handleEnd}
                aria-label="End call"
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                End Call
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
