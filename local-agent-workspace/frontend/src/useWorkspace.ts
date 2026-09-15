import { useCallback, useEffect, useRef, useState } from 'react'
import { api, refreshToken, setToken, streamProtocols, streamUrl } from './api'
import type { AgentEvent, Connection, PermissionMode, Session, Settings } from './types'

type Selection = { id: string | null; key: string; creating?: Promise<Session> }
const sessionInUrl = () => new URL(window.location.href).searchParams.get('session')

export function useWorkspace() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [selection, setSelection] = useState(() => {
    const id = sessionInUrl()
    return { id, key: id || crypto.randomUUID() }
  })
  const selected = useRef<Selection>({ ...selection })
  const draftKeys = useRef(new Map<string, string>())
  const activeId = selection.id
  const [error, setError] = useState('')
  const [online, setOnline] = useState(true)
  const [ready, setReady] = useState(false)
  const [draftMode, setDraftMode] = useState<PermissionMode>('manual')

  const updateUrl = useCallback((id: string | null, replace = false) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('session', id)
    else url.searchParams.delete('session')
    if (url.href !== window.location.href) window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
  }, [])
  const selectSession = useCallback((id: string | null, fromHistory = false) => {
    if (id && id === selected.current.id) return
    const next = { id, key: id ? draftKeys.current.get(id) || id : crypto.randomUUID() }
    selected.current = next
    setSelection({ ...next }); setSession(null); setError(''); setOnline(true)
    if (!id) setDraftMode('manual')
    if (!fromHistory) updateUrl(id)
  }, [updateUrl])

  const refreshSessions = useCallback(async () => setSessions(await api<Session[]>('/sessions')), [])
  const checkConnection = useCallback(async () => {
    setConnection(null)
    const result = await api<Connection>('/connection')
    setConnection(result)
    return result
  }, [])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const bootstrap = await api<{ token: string; settings: Settings }>('/bootstrap')
      if (!mounted) return
      setToken(bootstrap.token)
      setSettings(bootstrap.settings)
      const list = await api<Session[]>('/sessions')
      if (!mounted) return
      setSessions(list)
      // Only an explicit conversation URL resumes history. The root page is new.
      if (selected.current.id && !list.some(s => s.id === selected.current.id)) {
        selectSession(null, true)
        updateUrl(null, true)
        setError('That conversation no longer exists. Start a new conversation below.')
      }
      setReady(true)
      await checkConnection()
    })().catch(e => setError(e.message))
    return () => { mounted = false }
  }, [checkConnection, selectSession, updateUrl])

  useEffect(() => {
    const onPopState = () => selectSession(sessionInUrl(), true)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [selectSession])

  useEffect(() => {
    if (!activeId || !ready) { setSession(null); return }
    const target = selected.current
    let socket: WebSocket
    let timer: ReturnType<typeof setTimeout>
    let closed = false
    const isCurrent = () => !closed && selected.current === target
    setSession(null)
    let reconnect = false
    const connect = async () => {
      if (reconnect) {
        try { await refreshToken() }
        catch { if (!closed) timer = setTimeout(() => void connect(), 2000); return }
      }
      if (!isCurrent()) return
      socket = new WebSocket(streamUrl(activeId), streamProtocols())
      socket.onopen = () => { if (isCurrent()) setOnline(true) }
      socket.onmessage = message => {
        if (!isCurrent()) return
        const data = JSON.parse(message.data)
        if (data.type === 'snapshot' && data.session.id === activeId) setSession(data.session)
        if (data.type === 'permissions') setSession(current => current?.id === activeId ? {
          ...current, permission_mode: data.permission_mode, allowed_directories: data.allowed_directories,
        } : current)
        if (data.type === 'event') setSession(current => {
          if (!current || current.id !== activeId) return current
          const event = data.event as AgentEvent
          return { ...current, events: current.events.some(e => e.id === event.id)
            ? current.events.map(e => e.id === event.id ? event : e) : [...current.events, event] }
        })
        if (data.type === 'delta') setSession(current => current?.id === activeId ? {
          ...current, events: current.events.map(e => e.id === data.id ? { ...e, text: (e.text || '') + data.text } : e),
        } : current)
        if (data.type === 'status') {
          setSession(current => current?.id === activeId ? { ...current, status: data.status } : current)
          if (data.status === 'idle') void refreshSessions().catch(e => setError(e.message))
        }
        if (data.type === 'title') {
          setSession(current => current?.id === activeId ? { ...current, title: data.title } : current)
          void refreshSessions().catch(e => setError(e.message))
        }
      }
      socket.onclose = () => {
        if (isCurrent()) { reconnect = true; setOnline(false); timer = setTimeout(() => void connect(), 2000) }
      }
    }
    void connect()
    return () => { closed = true; clearTimeout(timer); socket?.close() }
  }, [activeId, selection.key, ready, refreshSessions])

  const newConversation = () => selectSession(null)
  const ensureSession = async (target: Selection) => {
    if (!target.id) {
      // Concurrent first actions in one draft share its creation request.
      target.creating ||= api<Session>('/sessions', 'POST', { permission_mode: draftMode })
      let created: Session
      try { created = await target.creating }
      catch (error) { target.creating = undefined; throw error }
      target.id = created.id
      draftKeys.current.set(created.id, target.key)
      // A slow creation must not reopen a chat the user has already left.
      if (selected.current === target) {
        setSelection({ id: created.id, key: target.key })
        updateUrl(created.id)
      }
      void refreshSessions().catch(e => setError(e.message))
    }
    return target.id
  }
  const send = async (text: string) => {
    const id = await ensureSession(selected.current)
    await api(`/sessions/${id}/messages`, 'POST', { text })
  }
  const saveSettings = async (next: Settings) => {
    const saved = await api<Settings>('/settings', 'PUT', next)
    setSettings(saved)
    void checkConnection().catch(e => setError(e.message))
  }
  const deleteSession = async (id: string) => {
    await api(`/sessions/${id}`, 'DELETE')
    if (selected.current.id === id) newConversation()
    await refreshSessions()
  }
  const setPermissionMode = async (permission_mode: PermissionMode) => {
    const target = selected.current
    if (activeId) {
      const updated = await api<Session>(`/sessions/${activeId}/permissions`, 'PUT', { permission_mode })
      if (selected.current === target) setSession(updated)
    } else setDraftMode(permission_mode)
  }
  const allowFolder = async (path: string) => {
    const target = selected.current
    const id = await ensureSession(target)
    const updated = await api<Session>(`/sessions/${id}/folders`, 'POST', { path })
    if (selected.current === target) setSession(updated)
  }
  const removeFolder = async (path: string) => {
    const target = selected.current
    if (activeId) {
      const updated = await api<Session>(`/sessions/${activeId}/folders`, 'DELETE', { path })
      if (selected.current === target) setSession(updated)
    }
  }
  const activeSession = session?.id === activeId ? session : null
  const reportError = (message: string) => { if (selected.current.key === selection.key) setError(message) }
  return { settings, connection, sessions, session: activeSession, activeId, viewKey: selection.key, error, online, ready,
    setError: reportError, setActiveId: selectSession, newConversation, send, saveSettings, deleteSession,
    checkConnection, refreshSessions, permissionMode: activeSession?.permission_mode || draftMode, setPermissionMode, allowFolder, removeFolder }
}
