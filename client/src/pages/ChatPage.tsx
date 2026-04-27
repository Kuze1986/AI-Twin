import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId, streamChat } from '../lib/api'
import type { ChatMode } from '../types'
import { MODES } from '../types'

type Msg = { id: string; role: 'user' | 'assistant'; content: string }

const MODE_LABEL: Record<ChatMode, string> = {
  default: 'Conversation',
  sales: 'Sales',
  ops: 'Operations',
  outreach: 'Outreach',
  debrief: 'Debrief',
}

const ONBOARDED_KEY = 'ai_twin_onboarded_v1'

export function ChatPage() {
  const { session, user, signOut } = useAuth()
  const [twinName, setTwinName] = useState<string>('Twin')
  const [mode, setMode] = useState<ChatMode>('default')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(() => getStoredSessionId())
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(ONBOARDED_KEY) !== '1'
  })
  const bottomRef = useRef<HTMLDivElement>(null)

  const dismissOnboarding = () => {
    setShowOnboarding(false)
    try {
      window.localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      // ignore storage failures (private mode, etc.) — banner will reappear next visit
    }
  }

  const token = session?.access_token

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
    if (!res.ok) return
    const rows = (await res.json()) as { id: string; role: string; content: string }[]
    setMessages(
      rows.map((r) => ({
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
      })),
    )
  }, [token])

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

  const send = async () => {
    if (!token || !input.trim() || streaming) return
    setError(null)
    const userMsg = input.trim()
    setInput('')
    const uid = crypto.randomUUID()
    setMessages((m) => [...m, { id: uid, role: 'user', content: userMsg }])
    setStreaming(true)

    const assistantId = crypto.randomUUID()
    let assistantText = ''

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
          if (ev.type === 'error') {
            setError(ev.error.message)
          }
        },
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setStreaming(false)
      void loadHistory()
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="mb-4 text-zinc-600 dark:text-zinc-400">Sign in to continue.</p>
        <Link className="text-violet-600 underline" to="/login">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
        <div>
          <h1 className="text-lg font-medium text-zinc-900 sm:text-xl dark:text-zinc-50">{twinName}</h1>
          <p className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-400">
            Mode: <span className="text-zinc-800 dark:text-zinc-200">{MODE_LABEL[mode]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              clearStoredSessionId()
              setSessionId(null)
              setMessages([])
            }}
            className="text-xs text-zinc-500 underline"
          >
            New session
          </button>
          <button type="button" onClick={() => void signOut()} className="text-xs text-zinc-500 underline">
            Sign out
          </button>
          <Link to="/admin" className="text-xs text-violet-600 underline dark:text-violet-400">
            Admin
          </Link>
        </div>
      </header>

      <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">Who am I talking to?</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          You are speaking with <span className="text-zinc-900 dark:text-zinc-100">{twinName}</span> in{' '}
          <span className="text-zinc-900 dark:text-zinc-100">{MODE_LABEL[mode]}</span> mode. This line is tuned to
          mirror their voice and judgment — not a generic assistant.
        </p>
      </div>

      {showOnboarding && messages.length === 0 && (
        <div className="mb-4 rounded-lg border border-violet-300 bg-violet-50 p-3 text-left text-sm sm:p-4 dark:border-violet-900/60 dark:bg-violet-950/40">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-violet-900 dark:text-violet-200">First time here?</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-violet-800 dark:text-violet-200/80">
                <li>
                  Pick a <span className="font-medium">mode</span> below — each shifts tone and
                  what {twinName} prioritises.
                </li>
                <li>Ask a real question; replies stream live and persist for this session.</li>
                <li>
                  Use <span className="font-medium">New session</span> in the header to start fresh.
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={dismissOnboarding}
              className="shrink-0 text-xs text-violet-700 underline dark:text-violet-300"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ChatMode)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user'
                ? 'ml-4 rounded-lg bg-zinc-200 px-3 py-2 text-left text-zinc-900 sm:ml-8 dark:bg-zinc-800 dark:text-zinc-100'
                : 'mr-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-zinc-800 sm:mr-8 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200'
            }
          >
            <p className="whitespace-pre-wrap text-sm">{m.content}</p>
          </div>
        ))}
        {streaming && (
          <p className="text-xs text-zinc-500" aria-live="polite">
            Thinking…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-zinc-200 pt-3 sm:flex-row sm:pt-4 dark:border-zinc-800">
        <textarea
          className="min-h-[44px] flex-1 resize-none rounded border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 sm:text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          placeholder="Message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
        />
        <div className="flex flex-row gap-2 sm:flex-col sm:gap-1">
          <button
            type="button"
            disabled={streaming}
            onClick={() => void send()}
            className="flex-1 rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 sm:flex-none dark:bg-zinc-100 dark:text-zinc-900"
          >
            Send
          </button>
          <button
            type="button"
            onClick={startListening}
            className="text-xs text-zinc-500 underline sm:self-end"
            title="Voice input (Web Speech API)"
          >
            Voice
          </button>
        </div>
      </div>
    </div>
  )
}
