import { memo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppStore } from '../../lib/store';
import { buildWsUrl, buildWsProtocols } from '../../lib/useAgentEvents';
import {
  shouldAutoplayFinishedReply,
  useTtsStore,
} from '../../lib/tts';

import { stripThinkTags } from '../../lib/message-text';
import { InputArea } from '../Chat/InputArea';

type SpeechStatus = 'idle' | 'recording' | 'transcribing';
type HudStatus = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'THINKING' | 'SPEAKING';
type HandsfreeStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'wake_detected'
  | 'recording'
  | 'transcribing'
  | 'paused'
  | 'error';
const C = 300;

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
}

function arcPath(r: number, from: number, to: number) {
  const s = polar(r, from);
  const e = polar(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${s.x.toFixed(2)} ${s.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function ticks(r: number, count: number, short: number, long: number, majorEvery: number) {
  return Array.from({ length: count }, (_, i) => {
    const deg = (i / count) * 360;
    const major = i % majorEvery === 0;
    const a = polar(r, deg);
    const b = polar(r - (major ? long : short), deg);
    return (
      <line
        key={i}
        x1={a.x.toFixed(2)}
        y1={a.y.toFixed(2)}
        x2={b.x.toFixed(2)}
        y2={b.y.toFixed(2)}
        className={major ? 'reactor-tick-major' : 'reactor-tick'}
      />
    );
  });
}

const DEGREE_LABELS = Array.from({ length: 12 }, (_, i) => i * 30);
const BARS = Array.from({ length: 60 }, (_, i) => i);

const ReactorSvg = memo(function ReactorSvg() {
  const sweepEnd = polar(282, 38);
  return (
    <svg viewBox="0 0 600 600" className="reactor-svg" aria-hidden="true">
      <defs>
        <radialGradient id="reactor-core-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#00D9FF" stopOpacity="0.30" />
          <stop offset="55%" stopColor="#147BBD" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#020711" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="reactor-halo-grad" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="#147BBD" stopOpacity="0" />
          <stop offset="100%" stopColor="#00D9FF" stopOpacity="0.10" />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r="298" fill="url(#reactor-halo-grad)" />

      {/* Outer measurement scale */}
      <g className="reactor-layer layer-a">
        <circle cx={C} cy={C} r="284" className="reactor-line" />
        {ticks(284, 120, 6, 14, 10)}
        {DEGREE_LABELS.map((deg) => {
          const p = polar(256, deg);
          return (
            <text
              key={deg}
              x={p.x}
              y={p.y}
              transform={`rotate(${deg} ${p.x} ${p.y})`}
              textAnchor="middle"
              dominantBaseline="middle"
              className="reactor-label"
            >
              {String(deg).padStart(3, '0')}
            </text>
          );
        })}
      </g>

      {/* Dashed ring with heavy arc segments */}
      <g className="reactor-layer layer-b">
        <circle cx={C} cy={C} r="238" className="reactor-line reactor-dashed" />
        <path d={arcPath(238, 10, 80)} className="reactor-arc" />
        <path d={arcPath(238, 130, 175)} className="reactor-arc" />
        <path d={arcPath(238, 215, 290)} className="reactor-arc" />
      </g>

      {/* Fine tick ring */}
      <g className="reactor-layer layer-c">
        <circle cx={C} cy={C} r="214" className="reactor-line" />
        {ticks(214, 72, 5, 10, 6)}
      </g>

      {/* Inner segmented ring */}
      <g className="reactor-layer layer-d">
        <path d={arcPath(190, 0, 70)} className="reactor-arc-thick" />
        <path d={arcPath(190, 90, 160)} className="reactor-arc-thick" />
        <path d={arcPath(190, 180, 250)} className="reactor-arc-thick" />
        <path d={arcPath(190, 270, 340)} className="reactor-arc-thick" />
        <circle cx={C} cy={C} r="176" className="reactor-line reactor-dotted" />
      </g>

      {/* Scan sweep (visible while transcribing / thinking) */}
      <g className="reactor-sweep">
        <path d={`M${C} ${C} L${C} 18 A282 282 0 0 1 ${sweepEnd.x.toFixed(2)} ${sweepEnd.y.toFixed(2)} Z`} className="reactor-sweep-fill" />
        <line x1={C} y1={C} x2={C} y2="18" className="reactor-sweep-edge" />
      </g>

      {/* Radial energy bars */}
      <g className="reactor-bars">
        {BARS.map((i) => (
          <g key={i} transform={`rotate(${i * 6} ${C} ${C})`}>
            <rect
              x="298"
              y="146"
              width="4"
              height="22"
              rx="1"
              className="reactor-bar"
              style={{ animationDelay: `${-(((i * 37) % 100) / 100) * 1.2}s` }}
            />
          </g>
        ))}
      </g>

      {/* Core */}
      <circle cx={C} cy={C} r="140" className="reactor-core-glow" fill="url(#reactor-core-grad)" />
      <circle cx={C} cy={C} r="126" className="reactor-line reactor-core-ring" />
      <circle cx={C} cy={C} r="112" className="reactor-core-disc" />
      <g className="reactor-layer layer-e">
        <circle cx={C} cy={C} r="100" className="reactor-line reactor-dashed" />
      </g>

      {/* Static cardinal marks */}
      <g className="reactor-cardinal">
        <line x1={C} y1="4" x2={C} y2="22" />
        <line x1={C} y1="578" x2={C} y2="596" />
        <line x1="4" y1={C} x2="22" y2={C} />
        <line x1="578" y1={C} x2="596" y2={C} />
      </g>
    </svg>
  );
});

function HudClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span>{now.toLocaleTimeString('en-GB')}</span>;
}

export function JarvisHUD() {
  const navigate = useNavigate();
  const [speechState, setSpeechState] = useState<SpeechStatus>('idle');
  const [handsfreeStatus, setHandsfreeStatus] =
  useState<HandsfreeStatus>('idle');
  const [externalMessage, setExternalMessage] = useState<string | null>(null);
  const [handsfreeError, setHandsfreeError] = useState('');
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const voiceTurnPendingRef = useRef(false);
  const voiceTtsStartedRef = useRef(false);
  const wakeAckPendingRef = useRef(false);
  const wakeAckStartedRef = useRef(false);

  const resumeVoiceSession = () => {
    if (!voiceTurnPendingRef.current) return;

    const ws = voiceSocketRef.current;

    if (ws?.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ action: 'resume' }));

    voiceTurnPendingRef.current = false;
    voiceTtsStartedRef.current = false;

    console.log('[Jarvis] Voice session resumed');
  };
  const toggleHandsfree = () => {
    const existingSocket = voiceSocketRef.current;

    if (existingSocket) {
      if (existingSocket.readyState === WebSocket.OPEN) {
        existingSocket.send(JSON.stringify({ action: 'stop' }));
      }

      existingSocket.close();
      voiceSocketRef.current = null;
      setHandsfreeStatus('idle');
      setHandsfreeError('');
      return;
    }

    setHandsfreeStatus('connecting');
    setHandsfreeError('');

    try {
      const ws = new WebSocket(
        buildWsUrl().replace('/v1/agents/events', '/v1/voice/stream'),
        buildWsProtocols(),
      );

      voiceSocketRef.current = ws;

      ws.onopen = () => {
        setHandsfreeStatus('listening');
      };

      ws.onmessage = (event) => {
       try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          message?: string;
          text?: string;
          language?: string;
          confidence?: number;
          duration_seconds?: number;
        };

        switch (payload.type) {
          case 'listening':
          case 'recording':
          case 'transcribing':
          case 'paused':
            setHandsfreeStatus(payload.type);
            break;

          case 'wake_detected':
            setHandsfreeStatus('wake_detected');

            wakeAckPendingRef.current = true;
            wakeAckStartedRef.current = false;

            void useTtsStore.getState().speak(
              'wake-ack',
              'Yes, sir.'
            );
            break;
          case 'transcript':
            console.log('[Jarvis] Transcript received:', payload.text);

            if (payload.text?.trim()) {
              voiceTurnPendingRef.current = true;
              voiceTtsStartedRef.current = false;
              setExternalMessage(payload.text);
            }
            break;
       



          case 'error':
            setHandsfreeError(payload.message || 'Voice session error');
            setHandsfreeStatus('error');
            break;
        }
      } catch {
        console.warn('[Jarvis] Invalid voice WebSocket message');
      }
    };

      ws.onerror = () => {
        setHandsfreeError('WebSocket connection failed');
        setHandsfreeStatus('error');
      };

      ws.onclose = () => {
        if (voiceSocketRef.current === ws) {
          voiceSocketRef.current = null;
        }

        setHandsfreeStatus((current) =>
          current === 'error' ? 'error' : 'idle',
        );
      };
    } catch (error) {
      voiceSocketRef.current = null;
      setHandsfreeError(
        error instanceof Error ? error.message : 'Connection failed',
      );
      setHandsfreeStatus('error');
    }
  };

  useEffect(() => {
    return () => {
      const ws = voiceSocketRef.current;

      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'stop' }));
        }

        ws.close();
        voiceSocketRef.current = null;
      }
    };
  }, []);
  const feedRef = useRef<HTMLDivElement>(null);

  const selectedModel = useAppStore((s) => s.selectedModel);
  const streamState = useAppStore((s) => s.streamState);
  const messages = useAppStore((s) => s.messages);
  const ttsState = useTtsStore((s) => s.state);
  const activeId = useAppStore((s) => s.activeId);
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);

  const isCurrentChatStreaming =
    streamState.isStreaming && streamState.conversationId === activeId;

  const streamingConversationRef = useRef<string | null>(null);

  // Check TTS backend availability.
useEffect(() => {
  if (!voiceOutputEnabled) return;

  void useTtsStore.getState().ensureHealth();
}, [voiceOutputEnabled]);

// Automatically speak the completed assistant response.
useEffect(() => {
  const last = messages[messages.length - 1];
  const tts = useTtsStore.getState();

  const justFinished = shouldAutoplayFinishedReply(
    streamingConversationRef.current,
    activeId,
    streamState.isStreaming,
    last,
    tts.autoSpokenId,
  );

  streamingConversationRef.current = isCurrentChatStreaming
    ? activeId
    : null;

  if (!justFinished) return;
  if (!voiceOutputEnabled || !voiceAutoplay) return;
  if (!last || last.role !== 'assistant' || activeId === null) return;

  const completedConversationId = activeId;
  const completedMessageId = last.id;

  void tts.ensureHealth().then(() => {
    const app = useAppStore.getState();
    const currentTts = useTtsStore.getState();
    const currentLast = app.messages[app.messages.length - 1];

    if (app.activeId !== completedConversationId || app.streamState.isStreaming) return;
    if (!app.settings.voiceOutputEnabled || !app.settings.voiceAutoplay) return;
    if (currentLast?.id !== completedMessageId || currentTts.available !== true) return;
    if (currentTts.autoSpokenId === completedMessageId) return;

    const text = stripThinkTags(currentLast.content);
    if (!text) return;

    currentTts.markAutoSpoken(completedMessageId);
    void currentTts.speak(completedMessageId, text);
  });
}, [
  activeId,
  messages,
  streamState.isStreaming,
  isCurrentChatStreaming,
  voiceOutputEnabled,
  voiceAutoplay,
]);

  // Resume hands-free listening after voice playback finishes.
  useEffect(() => {
    if (!voiceTurnPendingRef.current) return;

    if (ttsState === 'loading' || ttsState === 'speaking') {
      voiceTtsStartedRef.current = true;
      return;
    }

    if (ttsState === 'idle' && voiceTtsStartedRef.current) {
      resumeVoiceSession();
    }
  }, [ttsState]);

  // Handle wake acknowledgement and resume hands-free after TTS.
// Handle wake acknowledgement and resume hands-free after TTS.
  useEffect(() => {
    // First handle the wake-word acknowledgement.
    if (wakeAckPendingRef.current) {
      if (ttsState === 'loading' || ttsState === 'speaking') {
        wakeAckStartedRef.current = true;
        return;
      }

      if (ttsState === 'idle' && wakeAckStartedRef.current) {
        const ws = voiceSocketRef.current;

        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ack_done' }));
          console.log('[Jarvis] Wake acknowledgement completed');
        }

        wakeAckPendingRef.current = false;
        wakeAckStartedRef.current = false;
        return;
      }

      return;
    }

    // Then handle the normal assistant response.
    if (!voiceTurnPendingRef.current) return;

    if (ttsState === 'loading' || ttsState === 'speaking') {
      voiceTtsStartedRef.current = true;
      return;
    }

    if (ttsState === 'idle' && voiceTtsStartedRef.current) {
      resumeVoiceSession();
    }
  }, [ttsState]);

  const status: HudStatus =
    ttsState === 'speaking'
      ? 'SPEAKING'
      : speechState === 'recording'
        ? 'LISTENING'
        : speechState === 'transcribing'
          ? 'TRANSCRIBING'
          : streamState.isStreaming
            ? 'THINKING'
            : 'IDLE';

  const active = status !== 'IDLE';
  const showLive = streamState.isStreaming && !!streamState.content;

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamState.content]);

  const voiceInput =
    speechState === 'recording'
      ? 'MICROPHONE ACTIVE'
      : speechState === 'transcribing'
        ? 'TRANSCRIBING'
        : 'STANDBY';

  return (
    <main className={`jarvis-hud jarvis-${status.toLowerCase()}`}>
      <header className="jarvis-header">
        <div className="jarvis-brand">
          <div className="jarvis-eyebrow">STARK INDUSTRIES · SYSTEMS DIVISION</div>
          <h1>J.A.R.V.I.S.</h1>
        </div>

        <div className="jarvis-status">
          <span className={`jarvis-dot ${active ? 'is-active' : ''}`} />
          <div>
            <div className="jarvis-eyebrow">SYSTEM STATUS</div>
            <strong>{status}</strong>
          </div>
          <div className="jarvis-status-sep" />
          <div>
            <div className="jarvis-eyebrow">ACTIVE MODEL</div>
            <strong>{selectedModel || 'NONE'}</strong>
          </div>
        </div>

        <div className="jarvis-header-right">
          <div className="jarvis-clock">
            <div className="jarvis-eyebrow">LOCAL TIME</div>
            <HudClock />
          </div>
          
          <button
            type="button"
            className="jarvis-exit"
            onClick={toggleHandsfree}
          >
            {handsfreeStatus === 'idle' || handsfreeStatus === 'error'
              ? 'ENABLE HANDS-FREE'
              : handsfreeStatus === 'connecting'
                ? 'CONNECTING...'
                : 'DISABLE HANDS-FREE'}
          </button>

          <button
            type="button"
            className="jarvis-exit"
            onClick={() => navigate('/')}
          >
            EXIT HUD <span>↗</span>
          </button>
        </div>
      </header>

      <section className="jarvis-main">
        <aside className="jarvis-side jarvis-left">
          <div className="jarvis-side-title">
            <span>01</span> SYSTEM
          </div>

          <div className="jarvis-row">
            <div className="jarvis-label">ACTIVE MODEL</div>
            <div className="jarvis-value">{selectedModel || 'NO MODEL SELECTED'}</div>
          </div>
          <div className="jarvis-row">
            <div className="jarvis-label">RUNTIME</div>
            <div className="jarvis-value">OPENJARVIS</div>
          </div>
          <div className="jarvis-row">
            <div className="jarvis-label">VOICE INPUT</div>
            <div className="jarvis-value">{voiceInput}</div>
          </div>
          <div className="jarvis-row">
            <div className="jarvis-label">HANDS-FREE</div>
            <div className="jarvis-value">
              {handsfreeStatus.toUpperCase().replace('_', ' ')}
            </div>
          </div>

          {handsfreeError && (
            <div className="jarvis-row">
              <div className="jarvis-label">VOICE ERROR</div>
              <div className="jarvis-value">{handsfreeError}</div>
            </div>
          )}
          <div className="jarvis-row">
            <div className="jarvis-label">VOICE OUTPUT</div>
            <div className="jarvis-value">{String(ttsState).toUpperCase()}</div>
          </div>
          <div className="jarvis-row">
            <div className="jarvis-label">RESPONSE STREAM</div>
            <div className="jarvis-value">{streamState.isStreaming ? 'STREAMING' : 'IDLE'}</div>
          </div>
          <div className="jarvis-row">
            <div className="jarvis-label">SESSION MESSAGES</div>
            <div className="jarvis-value">{String(messages.length).padStart(3, '0')}</div>
          </div>
        </aside>

        <div className="jarvis-stage">
          <div className="jarvis-reactor">
            <ReactorSvg />
            <div className="jarvis-core-readout">
              <div className="jarvis-core-letter">J</div>
              <div className="jarvis-core-state">{status}</div>
            </div>
          </div>
        </div>

        <aside className="jarvis-side jarvis-right">
          <div className="jarvis-side-title">
            <span>02</span> LIVE FEED
            <span className="jarvis-count">{String(messages.length).padStart(2, '0')}</span>
          </div>

          <div className="jarvis-feed" ref={feedRef}>
            {messages.slice(-8).map((message) => (
              <div
                key={message.id}
                className={`jarvis-msg ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                <div className="jarvis-msg-role">
                  {message.role === 'user' ? 'USER' : message.role.toUpperCase()}
                </div>
                <p>{message.content}</p>
              </div>
            ))}

            {showLive && (
              <div className="jarvis-msg is-assistant is-live">
                <div className="jarvis-msg-role">LIVE RESPONSE</div>
                <p>{streamState.content}</p>
              </div>
            )}

            {messages.length === 0 && !showLive && (
              <div className="jarvis-empty">AWAITING INPUT…</div>
            )}
          </div>
        </aside>
      </section>

      <footer className="jarvis-console">
        <div className="jarvis-console-label">
          <span className={`jarvis-dot ${active ? 'is-active' : ''}`} />
          VOICE COMMAND INTERFACE
        </div>
        <div className="jarvis-console-body">
          
          <InputArea
            variant="hud"
            onSpeechStateChange={setSpeechState}
            externalMessage={externalMessage}
          />
        </div>
      </footer>

      <style>{`
        .jarvis-hud {
          --j-bg: #020711;
          --j-navy: #061426;
          --j-cyan: #00D9FF;
          --j-ice: #8DEBFF;
          --j-blue: #147BBD;
          --j-muted: #52758A;
          --spd: 1;
          --pulse: 4s;
          --bar-dur: 3s;
          --bar-max: .4;
          --core-glow: .55;
          --sweep-op: 0;
          --sweep-dur: 6s;
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: var(--j-ice);
          font-family: 'IBM Plex Mono', Consolas, 'Courier New', monospace;
          background:
            radial-gradient(ellipse at 50% 46%, rgba(20,123,189,.20), transparent 52%),
            linear-gradient(160deg, var(--j-bg), var(--j-navy) 55%, var(--j-bg));
        }
        .jarvis-hud::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(0deg, rgba(0,217,255,.025) 0 1px, transparent 1px 4px);
        }

        /* ---------- state tuning ---------- */
        .jarvis-idle { --spd: 1; --pulse: 4.5s; --bar-dur: 3s; --bar-max: .4; --core-glow: .55; }
        .jarvis-listening { --spd: .8; --pulse: 1.1s; --bar-dur: .4s; --bar-max: 1; --core-glow: 1; }
        .jarvis-transcribing { --spd: .6; --pulse: 1.8s; --bar-dur: .8s; --bar-max: .6; --core-glow: .8; --sweep-op: 1; --sweep-dur: 2.4s; }
        .jarvis-thinking { --spd: .3; --pulse: 1.4s; --bar-dur: .6s; --bar-max: .7; --core-glow: .85; --sweep-op: .8; --sweep-dur: 3.2s; }
        .jarvis-speaking { --spd: .55; --pulse: .9s; --bar-dur: .35s; --bar-max: 1; --core-glow: 1; }

        /* ---------- header ---------- */
        .jarvis-header {
          position: relative;
          z-index: 3;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 16px;
          padding: 14px 3.2%;
          border-bottom: 1px solid rgba(0,217,255,.2);
          background: linear-gradient(180deg, rgba(6,20,38,.85), rgba(2,7,17,.6));
        }
        .jarvis-eyebrow { color: var(--j-muted); font-size: 9px; letter-spacing: .26em; }
        .jarvis-brand h1 {
          margin: 3px 0 0;
          color: #e6fbff;
          font-size: 22px;
          font-weight: 300;
          letter-spacing: .34em;
          text-shadow: 0 0 16px rgba(0,217,255,.4);
        }
        .jarvis-status { display: flex; align-items: center; gap: 12px; }
        .jarvis-status strong {
          display: block;
          margin-top: 4px;
          color: var(--j-ice);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: .16em;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .jarvis-status-sep { width: 1px; align-self: stretch; margin: 0 6px; background: rgba(0,217,255,.2); }
        .jarvis-dot {
          display: inline-block;
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 50%;
          background: var(--j-muted);
        }
        .jarvis-dot.is-active {
          background: var(--j-cyan);
          box-shadow: 0 0 10px var(--j-cyan);
          animation: jarvis-blink 1.4s ease-in-out infinite;
        }
        .jarvis-header-right { display: flex; align-items: center; justify-content: flex-end; gap: 22px; }
        .jarvis-clock { text-align: right; font-size: 13px; letter-spacing: .14em; color: var(--j-ice); }
        .jarvis-clock .jarvis-eyebrow { margin-bottom: 3px; }
        .jarvis-exit {
          padding: 9px 14px;
          border: 1px solid rgba(0,217,255,.35);
          color: var(--j-ice);
          background: rgba(20,123,189,.12);
          font: inherit;
          font-size: 9px;
          letter-spacing: .16em;
          cursor: pointer;
          transition: background .2s, box-shadow .2s;
        }
        .jarvis-exit:hover { background: rgba(0,217,255,.14); box-shadow: 0 0 16px rgba(0,217,255,.2); }
        .jarvis-exit span { margin-left: 6px; }

        /* ---------- main grid ---------- */
        .jarvis-main {
          position: relative;
          z-index: 2;
          flex: 1;
          min-height: 0;
          display: grid;
          grid-template-columns: minmax(210px, 290px) minmax(0, 1fr) minmax(250px, 360px);
          gap: 28px;
          padding: 22px 3.2%;
        }

        .jarvis-side {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 0;
          padding: 4px 0 4px 18px;
          border-left: 1px solid rgba(0,217,255,.22);
        }
        .jarvis-right { padding: 4px 18px 4px 0; border-left: 0; border-right: 1px solid rgba(0,217,255,.22); }
        .jarvis-side::before {
          content: '';
          position: absolute;
          top: 0;
          width: 16px;
          height: 16px;
          border-top: 2px solid var(--j-cyan);
          border-left: 2px solid var(--j-cyan);
          left: -1px;
        }
        .jarvis-right::before {
          left: auto;
          right: -1px;
          border-left: 0;
          border-right: 2px solid var(--j-cyan);
        }
        .jarvis-side-title {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-bottom: 14px;
          color: var(--j-ice);
          font-size: 10px;
          letter-spacing: .24em;
        }
        .jarvis-side-title span:first-child { color: var(--j-blue); }
        .jarvis-count { margin-left: auto; color: var(--j-muted); }

        .jarvis-row { padding: 14px 0; border-top: 1px solid rgba(0,217,255,.12); }
        .jarvis-label { color: var(--j-muted); font-size: 9px; letter-spacing: .2em; }
        .jarvis-value { margin-top: 7px; color: #d6f7ff; font-size: 12px; letter-spacing: .06em; overflow-wrap: anywhere; }

        /* ---------- reactor ---------- */
        .jarvis-stage { display: grid; place-items: center; min-width: 0; min-height: 0; }
        .jarvis-reactor {
          position: relative;
          width: min(100%, 72vh, 700px);
          aspect-ratio: 1;
        }
        .reactor-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }

        .reactor-layer, .reactor-sweep, .reactor-core-glow, .reactor-core-ring {
          transform-box: view-box;
          transform-origin: center;
        }
        .reactor-line { fill: none; stroke: var(--j-cyan); stroke-opacity: .35; stroke-width: 1; }
        .reactor-dashed { stroke-dasharray: 10 8; }
        .reactor-dotted { stroke-dasharray: 2 6; stroke-opacity: .55; }
        .reactor-tick { stroke: var(--j-cyan); stroke-opacity: .45; stroke-width: 1; }
        .reactor-tick-major { stroke: var(--j-ice); stroke-opacity: .9; stroke-width: 1.6; }
        .reactor-label { fill: var(--j-muted); font-size: 9px; letter-spacing: .12em; font-family: inherit; }
        .reactor-arc { fill: none; stroke: var(--j-cyan); stroke-opacity: .75; stroke-width: 3; stroke-linecap: butt; }
        .reactor-arc-thick { fill: none; stroke: var(--j-blue); stroke-opacity: .85; stroke-width: 7; stroke-linecap: butt; }
        .reactor-cardinal line { stroke: var(--j-ice); stroke-opacity: .7; stroke-width: 1.5; }

        .layer-a { animation: reactor-spin calc(120s * var(--spd)) linear infinite; }
        .layer-b { animation: reactor-spin calc(70s * var(--spd)) linear infinite reverse; }
        .layer-c { animation: reactor-spin calc(160s * var(--spd)) linear infinite; }
        .layer-d { animation: reactor-spin calc(45s * var(--spd)) linear infinite reverse; }
        .layer-e { animation: reactor-spin calc(30s * var(--spd)) linear infinite; }

        .reactor-sweep {
          opacity: var(--sweep-op);
          transition: opacity .4s;
          animation: reactor-spin var(--sweep-dur) linear infinite;
        }
        .reactor-sweep-fill { fill: var(--j-cyan); fill-opacity: .10; }
        .reactor-sweep-edge { stroke: var(--j-cyan); stroke-opacity: .7; stroke-width: 1.4; }

        .reactor-bar {
          fill: var(--j-cyan);
          fill-opacity: .85;
          transform-box: fill-box;
          transform-origin: center bottom;
          animation: reactor-bar var(--bar-dur) ease-in-out infinite alternate;
        }
        .reactor-core-glow {
          opacity: var(--core-glow);
          animation: reactor-pulse var(--pulse) ease-in-out infinite;
        }
        .reactor-core-ring { stroke-opacity: .8; stroke-width: 1.5; }
        .reactor-core-disc { fill: #031020; fill-opacity: .88; stroke: var(--j-ice); stroke-opacity: .55; stroke-width: 1; }

        .jarvis-core-readout {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .jarvis-core-letter {
          color: #eafcff;
          font-family: 'Chakra Petch', 'Segoe UI', sans-serif;
          font-size: clamp(48px, 9vh, 96px);
          font-weight: 300;
          line-height: 1;
          text-shadow: 0 0 12px var(--j-cyan), 0 0 40px var(--j-blue);
        }
        .jarvis-core-state {
          margin-top: 10px;
          color: var(--j-cyan);
          font-size: clamp(8px, 1.2vh, 11px);
          letter-spacing: .3em;
        }

        /* ---------- live feed ---------- */
        .jarvis-feed {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding-right: 8px;
          scrollbar-width: thin;
          scrollbar-color: rgba(0,217,255,.25) transparent;
        }
        .jarvis-msg { padding: 10px 0 10px 12px; border-left: 2px solid rgba(82,117,138,.5); margin-bottom: 10px; }
        .jarvis-msg.is-user { border-left-color: var(--j-blue); }
        .jarvis-msg.is-assistant { border-left-color: var(--j-cyan); }
        .jarvis-msg-role { font-size: 8px; letter-spacing: .22em; color: var(--j-muted); }
        .jarvis-msg.is-assistant .jarvis-msg-role { color: var(--j-cyan); }
        .jarvis-msg p {
          margin: 6px 0 0;
          font-size: 11px;
          line-height: 1.7;
          color: #bfeaf6;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .jarvis-msg.is-user p { color: #8fb8cc; }
        .jarvis-msg.is-live p { color: var(--j-ice); }
        .jarvis-empty {
          display: grid;
          place-items: center;
          height: 100%;
          min-height: 160px;
          color: var(--j-muted);
          font-size: 9px;
          letter-spacing: .24em;
        }

        /* ---------- command console ---------- */
        .jarvis-console {
          position: relative;
          z-index: 4;
          flex-shrink: 0;
          padding: 8px 3.2% 12px;
          border-top: 1px solid rgba(0,217,255,.22);
          background: rgba(2,7,17,.94);
        }
        .jarvis-console-label {
          display: flex;
          align-items: center;
          gap: 9px;
          padding-bottom: 6px;
          color: var(--j-muted);
          font-size: 8px;
          letter-spacing: .24em;
        }
        .jarvis-console-body { max-width: 1100px; margin: 0 auto; }

        /* ---------- keyframes ---------- */
        @keyframes reactor-spin { to { transform: rotate(360deg); } }
        @keyframes reactor-pulse {
          0%, 100% { transform: scale(.96); }
          50% { transform: scale(1.04); }
        }
        @keyframes reactor-bar {
          from { transform: scaleY(.15); }
          to { transform: scaleY(var(--bar-max)); }
        }
        @keyframes jarvis-blink { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }

        /* ---------- responsive ---------- */
        @media (max-width: 1100px) {
          .jarvis-main {
            grid-template-columns: 1fr 1fr;
            overflow-y: auto;
            gap: 18px;
          }
          .jarvis-stage { grid-column: 1 / -1; order: -1; }
          .jarvis-reactor { width: min(100%, 60vh, 520px); }
          .jarvis-side { max-height: 300px; }
        }
        @media (max-width: 640px) {
          .jarvis-header { grid-template-columns: 1fr auto; padding: 10px 14px; }
          .jarvis-status { display: none; }
          .jarvis-clock { display: none; }
          .jarvis-brand h1 { font-size: 17px; }
          .jarvis-main { grid-template-columns: 1fr; padding: 14px; }
          .jarvis-reactor { width: min(88vw, 400px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .jarvis-hud *, .jarvis-hud *::before, .jarvis-hud *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>
    </main>
  );
}