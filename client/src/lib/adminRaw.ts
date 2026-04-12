/** Admin requests without forcing JSON Content-Type (e.g. multipart). */
export async function adminFetchRaw(path: string, init?: RequestInit) {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    credentials: 'include',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw new Error(msg)
  }
  return data
}
