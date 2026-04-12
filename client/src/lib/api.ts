const SESSION_KEY = 'ai_twin_session_id'

export function getStoredSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY)
}

export function setStoredSessionId(id: string) {
  localStorage.setItem(SESSION_KEY, id)
}

export function clearStoredSessionId() {
  localStorage.removeItem(SESSION_KEY)
}

export async function adminFetch(path: string, init?: RequestInit) {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(msg)
  }
  return data
}

export async function adminLogin(password: string) {
  return adminFetch('/login', { method: 'POST', body: JSON.stringify({ password }) })
}

export async function adminLogout() {
  return adminFetch('/logout', { method: 'POST', body: '{}' })
}

export type StreamEvent =
  | { type: 'meta'; session_id: string }
  | { type: 'text'; text: string }
  | { type: 'error'; error: { code: string; message: string } }
  | { type: 'done' }

export async function streamChat(
  token: string,
  body: {
    session_id?: string
    mode: string
    user_message: string
    context_override?: string
  },
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    const msg = (j as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(msg)
  }

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const line = block.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const raw = line.slice(6).trim()
      if (!raw) continue
      try {
        onEvent(JSON.parse(raw) as StreamEvent)
      } catch {
        /* ignore */
      }
    }
  }
}
