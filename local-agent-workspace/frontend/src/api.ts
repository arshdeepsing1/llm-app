let token = ''
let reconnecting: Promise<void> | null = null
export function setToken(value: string) { token = value }
export function refreshToken(): Promise<void> {
  if (!reconnecting) reconnecting = (async () => {
    const response = await fetch('/api/bootstrap')
    if (!response.ok) throw new Error('Cannot reconnect to the local server.')
    const data = await response.json()
    setToken(data.token)
  })().finally(() => { reconnecting = null })
  return reconnecting
}
export function streamUrl(id: string) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/sessions/${id}/stream`
}
export function streamProtocols() { return ['local-workspace', token] }
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Local-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  // This response is emitted before the server executes the request, so one
  // retry after replacing an expired local token cannot duplicate an action.
  if (response.status === 403 && data.code === 'reconnect_required' && !retried) {
    await refreshToken()
    return api<T>(path, method, body, true)
  }
  if (!response.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data), response.status)
  return data
}
