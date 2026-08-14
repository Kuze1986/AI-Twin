import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId, streamChat } from '../lib/api'
import type { ChatMode } from '../types'
import { MODES } from '../types'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  incomplete?: boolean
  rating?: 1 | -1
}

type SearchResult = {
  id: string
  session_id: string
  role: string
  snippet: string
  created_at: string
}

const MODE_LABEL: Record<ChatMode, string> = {
  default: 'Conversation',
  sales: 'Sales',
  ops: 'Operations',
  outreach: 'Outreach',
  debrief: 'Debrief',
}

const ONBOARDED_KEY = 'ai_twin_onboarded_v1'

const TOOL_LABELS: Record<string, string> = {
  query_shift: 'Checking The Shift data',
  query_stripe: 'Checking Stripe billing',
  get_aegis_state: 'Checking AEGIS alerts',
}
function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? `Running ${tool}`
}

export function ChatPage() {
  const { session, user, signOut } = useAuth()
  const [twinName, setTwinName] = useState<string>('Twin')
  const [mode, setMode] = useState<ChatMode>('default')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [toolChip, setToolChip] = useState<{ tool: string; state: 'running' | 'done' | 'error' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUserMsg, setLastUserMsg] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(() => getStoredSessionId())
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(ONBOARDED_KEY) !== '1'
  })

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const dismissOnboarding = () => {
    setShowOnboarding(false)
    try {
      window.localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  const token = session?.access_token

  const discardMissingSession = useCallback(() => {
    clearStoredSessionId()
    setSessionId(null)
    setMessages([])
  }, [])

  useEffect(() => {
    fetch('/api/public/identity')
      .then((r) => r.json())
      .then((d) => {
        if (d.twin_name) setTwinName(d.twin_name)
      })
      .catch(() => {})
  }, [])

  const loadHistory = useCallback(async () => {
    const sid = getStoredSessionId()
    if (!sid || !token) return
    const res = await fetch(`/api/sessions/${sid}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 404) {
      // A database reset or an expired/deleted session can leave a stale ID in
      // local storage. Drop it so the next message creates a fresh session.
      discardMissingSession()
      return
    }
    if (!res.ok) return
    const rows = (await res.json()) as { id: string; role: string; content: string }[]
    setMessages(
      rows.map((r) => ({
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
      })),
    )
  }, [discardMissingSession, token])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const startListening = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string
        interimResults: boolean
        onresult: ((ev: { results: { 0: { 0: { transcript: string } } } }) => void) | null
        onerror: (() => void) | null
        start: () => void
      }
      webkitSpeechRecognition?: new () => {
        lang: string
        interimResults: boolean
        onresult: ((ev: { results: { 0: { 0: { transcript: string } } } }) => void) | null
        onerror: (() => void) | null
        start: () => void
      }
    }
    const SpeechRecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setError('Speech recognition not supported in this browser.')
      return
    }
    const rec = new SpeechRecognitionCtor()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript
      if (text) setInput((prev) => (prev ? `${prev} ${text}` : text))
    }
    rec.onerror = () => setError('Voice input failed.')
    rec.start()
  }

  const doSend = async (userMsg: string) => {
    if (!token || !userMsg.trim() || streaming) return
    setError(null)
    setLastUserMsg(userMsg)
    setInput('')
    const uid = crypto.randomUUID()
    setMessages((m) => [...m, { id: uid, role: 'user', content: userMsg }])
    setStreaming(true)
    setToolChip(null)

    const assistantId = crypto.randomUUID()
    let assistantText = ''
    let gotDone = false

    try {
      await streamChat(
        token,
        {
          session_id: sessionId ?? undefined,
          mode,
          user_message: userMsg,
        },
        (ev) => {
          if (ev.type === 'meta') {
            setSessionId(ev.session_id)
            setStoredSessionId(ev.session_id)
          }
          if (ev.type === 'text') {
            assistantText += ev.text
            setMessages((prev) => {
              const rest = prev.filter((x) => x.id !== assistantId)
              return [...rest, { id: assistantId, role: 'assistant', content: assistantText }]
            })
          }
          if (ev.type === 'tool_status') {
            // Keep the chip visible until real text streams; a 'done'/'error' just recolors it.
            setToolChip({ tool: ev.tool, state: ev.state })
          }
          if (ev.type === 'done') {
            gotDone = true
          }
          if (ev.type === 'error') {
            setError(ev.error.message)
          }
        },
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Request failed'
      if (message === 'Session not found') {
        discardMissingSession()
        setError('Your previous session is no longer available. Retry to start a new one.')
      } else {
        setError(message)
      }
    } finally {
      setStreaming(false)
      setToolChip(null)
      // If stream closed without a done event and we have partial text, mark incomplete
      if (!gotDone && assistantText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, incomplete: true } : m,
          ),
        )
      }
      void loadHistory()
    }
  }

  const send = () => void doSend(input.trim())

  const retry = () => {
    if (lastUserMsg) void doSend(lastUserMsg)
  }

  const rate = async (messageId: string, rating: 1 | -1) => {
    if (!token || !sessionId) return
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, rating } : m)))
    try {
      await fetch(`/api/sessions/${sessionId}/messages/${messageId}/rate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      })
    } catch {
      // non-fatal — optimistic UI already updated
    }
  }

  const doSearch = async () => {
    if (!token || !searchQuery.trim()) return
    setSearchLoading(true)
    setSearchResults([])
    try {
      const res = await fetch(
        `/api/sessions/search?q=${encodeURIComponent(searchQuery)}&limit=10`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) throw new Error(`${res.status}`)
      const d = (await res.json()) as { items: SearchResult[] }
      setSearchResults(d.items)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearchLoading(false)
    }
  }

  const loadSearchSession = (sid: string) => {
    clearStoredSessionId()
    setStoredSessionId(sid)
    setSessionId(sid)
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    void loadHistory()
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="nx-label nx-label--accent mb-2">Kuze</p>
        <p className="mb-6 text-[var(--nx-text-2)]">Sign in to continue.</p>
        <Link className="nx-btn nx-btn--primary" to="/login">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
        <div>
          <p className="nx-label nx-label--accent mb-1">AI Twin</p>
          <h1 className="nx-display text-3xl sm:text-4xl">{twinName}</h1>
          <p className="mt-1 text-sm text-[var(--nx-text-2)]">
            Mode: <span className="text-[var(--nx-text)]">{MODE_LABEL[mode]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSearchOpen((o) => !o)} className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]">
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              discardMissingSession()
              setLastUserMsg(null)
            }}
            className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]"
          >
            New session
          </button>
          <button type="button" onClick={() => void signOut()} className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]">
            Sign out
          </button>
          <Link to="/admin" className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]">
            Admin
          </Link>
        </div>
      </header>

      {searchOpen && (
        <div className="nx-panel nx-panel--strong mb-4 p-3">
          <div className="flex gap-2">
            <input
              className="nx-input flex-1"
              placeholder="Search past conversations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch()
              }}
            />
            <button type="button" onClick={() => void doSearch()} className="nx-btn nx-btn--primary">
              Go
            </button>
          </div>
          {searchLoading && <p className="mt-2 text-xs text-[var(--nx-text-muted)]">Searching…</p>}
          {searchResults.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {searchResults.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left hover:bg-[var(--nx-surface-2)]"
                    onClick={() => loadSearchSession(r.session_id)}
                  >
                    <span className="nx-label capitalize">{r.role}</span>{' '}
                    <span className="text-[var(--nx-text)]">{r.snippet}</span>
                    <span className="nx-mono ml-1 text-[var(--nx-text-muted)]">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!searchLoading && searchResults.length === 0 && searchQuery && (
            <p className="mt-2 text-xs text-[var(--nx-text-muted)]">No results.</p>
          )}
        </div>
      )}

      <div className="nx-panel nx-corners mb-4 p-3 text-left text-sm sm:p-4">
        <p className="nx-label nx-label--accent mb-2">Context</p>
        <p className="font-medium text-[var(--nx-text)]">Who am I talking to?</p>
        <p className="mt-1 text-[var(--nx-text-2)]">
          You are speaking with <span className="text-[var(--nx-text)]">{twinName}</span> in{' '}
          <span className="text-[var(--nx-text)]">{MODE_LABEL[mode]}</span> mode.
        </p>
      </div>

      {showOnboarding && messages.length === 0 && (
        <div className="nx-panel nx-panel--active mb-4 p-3 text-left text-sm sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="nx-label nx-label--accent mb-1">First contact</p>
              <p className="font-medium text-[var(--nx-text)]">First time here?</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--nx-text-2)]">
                <li>
                  Pick a <span className="font-medium text-[var(--nx-text)]">mode</span> below.
                </li>
                <li>Ask a real question; replies stream live and persist for this session.</li>
                <li>
                  Use <span className="font-medium text-[var(--nx-text)]">New session</span> to start fresh.
                </li>
              </ul>
            </div>
            <button type="button" onClick={dismissOnboarding} className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]">
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <label className="nx-label shrink-0">Mode</label>
        <div className="flex gap-1.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`nx-chip shrink-0 cursor-pointer ${mode === m ? 'nx-chip--cyan' : ''}`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded border border-[var(--nx-red)] bg-[rgba(224,64,64,0.1)] px-3 py-2 text-sm text-[var(--nx-red)]">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={retry} className="nx-btn nx-btn--danger !px-2 !py-0.5 text-[11px]">
            Retry
          </button>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.map((m) => (
          <div key={m.id}>
            <div
              className={
                m.role === 'user'
                  ? 'ml-4 rounded-[var(--nx-r-2)] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 py-2 text-left text-[var(--nx-text)] sm:ml-8'
                  : 'nx-panel mr-4 px-3 py-2 text-left sm:mr-8'
              }
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
              {m.incomplete && (
                <p className="mt-1 text-xs text-[var(--nx-text-muted)] italic">(response incomplete)</p>
              )}
            </div>
            {m.role === 'assistant' && !streaming && (
              <div className="mr-4 mt-1 flex justify-end gap-2 sm:mr-8">
                <button
                  type="button"
                  onClick={() => void rate(m.id, 1)}
                  title="Helpful"
                  className={`text-xs ${m.rating === 1 ? 'text-[var(--nx-green)]' : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void rate(m.id, -1)}
                  title="Not helpful"
                  className={`text-xs ${m.rating === -1 ? 'text-[var(--nx-red)]' : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}`}
                >
                  ↓
                </button>
              </div>
            )}
          </div>
        ))}
        {streaming &&
          (toolChip ? (
            <span
              className={`nx-chip ${
                toolChip.state === 'error'
                  ? 'nx-chip--red'
                  : toolChip.state === 'done'
                    ? 'nx-chip--green'
                    : 'nx-chip--cyan'
              }`}
              aria-live="polite"
            >
              {toolChip.state === 'running' && <i className="nx-pulse" />}
              {toolLabel(toolChip.tool)}
              {toolChip.state === 'running' ? '…' : toolChip.state === 'error' ? ' — failed' : ' ✓'}
            </span>
          ) : (
            <p className="nx-label flex items-center gap-2" aria-live="polite">
              <i className="nx-pulse" /> Thinking…
            </p>
          ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-auto flex gap-2 border-t border-[var(--nx-border)] pt-3 sm:pt-4">
        <textarea
          className="nx-input nx-input--body min-h-[44px] flex-1 resize-none text-base sm:text-sm"
          placeholder="Message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
        />
        <div className="flex flex-col gap-1">
          <button type="button" disabled={streaming} onClick={send} className="nx-btn nx-btn--primary disabled:opacity-50">
            Send
          </button>
          <button
            type="button"
            onClick={startListening}
            className="nx-btn nx-btn--ghost !px-2 !py-1 text-[11px]"
            title="Voice input (Web Speech API)"
          >
            Voice
          </button>
        </div>
      </div>
    </div>
  )
}
