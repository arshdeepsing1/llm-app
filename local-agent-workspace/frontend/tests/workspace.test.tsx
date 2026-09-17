import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { useWorkspace } from '../src/useWorkspace'
import type { ContextInfo, Session, Settings } from '../src/types'

const settings: Settings = {
  workspace: '/project', model: 'test-model', env_file: '', context_window: 32768, host: '', configured: true,
}
const contextInfo: ContextInfo = {
  estimated_tokens: 12000, input_budget: 24000, context_window: 32768, reply_reserve: 8192,
  compactions: 1, summarized_messages: 8, estimate_method: 'conservative_utf8',
  instruction_files: ['AGENTS.md', 'src/AGENTS.md'], warnings: ['Project instructions were truncated.'],
}
const makeSession = (id: string, title = id): Session => ({
  id, title, workspace: '/project', model: 'test-model', status: 'idle',
  events: [], updated: 1, permission_mode: 'manual', allowed_directories: [],
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

class TestSocket {
  static instances: TestSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) { TestSocket.instances.push(this) }
  close() { this.onclose?.() }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

let sessions: Map<string, Session>
let override: (path: string, options: RequestInit) => Promise<Response> | undefined
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  sessions = new Map([['a', makeSession('a', 'Other conversation')]])
  TestSocket.instances = []
  override = () => undefined
  fetchMock = vi.fn<typeof fetch>(async (input, options = {}) => {
    const path = String(input)
    const response = override(path, options)
    if (response) return response
    if (path === '/api/bootstrap') return json({ token: 'test-token', settings })
    if (path === '/api/connection') return json({ connected: true, models: ['test-model'], error: null })
    if (path === '/api/sessions' && options.method === 'POST') {
      const created = makeSession('created', 'Created conversation')
      sessions.set(created.id, created)
      return json(created)
    }
    if (path === '/api/sessions') return json([...sessions.values()])
    if (path.startsWith('/api/files?')) return json([{ path: 'note.txt', name: 'note.txt', directory: false }])
    if (path.startsWith('/api/file?')) return json({ content: 'original' })
    if (path === '/api/file' || path.endsWith('/messages')) return json({ ok: true })
    const id = path.match(/^\/api\/sessions\/([^/]+)$/)?.[1]
    if (id) {
      if (options.method === 'DELETE') { sessions.delete(id); return json({ ok: true }) }
      return sessions.has(id) ? json(sessions.get(id)) : json({ detail: 'Conversation not found.' }, 404)
    }
    throw new Error(`Unexpected test request: ${options.method || 'GET'} ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', TestSocket)
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function socketFor(id: string) {
  await waitFor(() => expect(TestSocket.instances.some(socket => socket.url.endsWith(`/${id}/stream`))).toBe(true))
  return [...TestSocket.instances].reverse().find(socket => socket.url.endsWith(`/${id}/stream`))!
}
async function showSession(id: string) {
  const socket = await socketFor(id)
  act(() => { socket.onopen?.(); socket.emit({ type: 'snapshot', session: sessions.get(id) }) })
  return socket
}
async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  fireEvent.click(await screen.findByRole('button', { name: 'note.txt' }))
  return await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' })
}
async function renderApp() {
  render(<App />)
  await waitFor(() => expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement).value).toBe('test-model'))
}

it('opens Databricks-only settings and saves only the editable Databricks fields', async () => {
  override = (path, options) => {
    if (path === '/api/bootstrap') return Promise.resolve(json({ token: 'test-token', settings: {
      ...settings, runtime: 'claude', claude_cli_path: '/old/cli', claude_mcp_config: '/old/mcp.json', claude_skills: true,
    } }))
    if (path === '/api/settings' && options.method === 'PUT') return Promise.resolve(json({
      ...settings, ...JSON.parse(options.body as string),
    }))
  }
  await renderApp()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByLabelText('Project folder')).toBeTruthy()
  expect(dialog.getByLabelText('Databricks model endpoint')).toBeTruthy()
  expect(dialog.getByLabelText('Credential file')).toBeTruthy()
  const budget = dialog.getByLabelText<HTMLInputElement>('Context budget (tokens)')
  expect(budget.value).toBe('32768')
  expect(budget.min).toBe('16384')
  expect(budget.max).toBe('1048576')
  expect(dialog.getByText('Set at or below your endpoint limit. Applies on the next turn.')).toBeTruthy()
  expect(dialog.queryByLabelText('Agent runtime')).toBeNull()
  expect(dialog.queryByText(/Claude|MCP|skills/i)).toBeNull()
  expect(dialog.queryByRole('checkbox')).toBeNull()
  fireEvent.change(dialog.getByLabelText('Project folder'), { target: { value: '/updated-project' } })
  fireEvent.change(dialog.getByLabelText('Databricks model endpoint'), { target: { value: 'databricks-gpt-oss-120b' } })
  fireEvent.change(dialog.getByLabelText('Credential file'), { target: { value: '/credentials/env_vars.txt' } })
  fireEvent.change(budget, { target: { value: '65536' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const request = fetchMock.mock.calls.find(([path, options]) => path === '/api/settings' && options?.method === 'PUT')
  expect(JSON.parse(request![1]!.body as string)).toEqual({
    workspace: '/updated-project', model: 'databricks-gpt-oss-120b', env_file: '/credentials/env_vars.txt', context_window: 65536,
  })
})

describe('context budget', () => {
  it('keeps one composer after creating a conversation and switching away and back', async () => {
    await renderApp()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Start a conversation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    const socket = await showSession('created')
    act(() => {
      socket.emit({ type: 'event', event: { id: 'user', type: 'user', text: 'Start a conversation' } })
      socket.emit({ type: 'context', context_info: contextInfo })
    })
    expect(screen.getAllByRole('textbox', { name: 'Message' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Permissions:/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Other conversation/ }))
    await showSession('a')
    expect(screen.getAllByRole('textbox', { name: 'Message' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Permissions:/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Created conversation/ }))
    await waitFor(() => expect(TestSocket.instances.filter(socket => socket.url.endsWith('/created/stream'))).toHaveLength(2))
    await showSession('created')
    expect(screen.getAllByRole('textbox', { name: 'Message' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^Permissions:/ })).toHaveLength(1)
  })

  it('shows the last model input estimate and project instructions, isolated by conversation', async () => {
    sessions.set('a', { ...makeSession('a', 'Other conversation'), context_info: contextInfo })
    sessions.set('b', makeSession('b', 'Empty conversation'))
    await renderApp()
    expect(screen.getByText('Context usage is estimated after the first turn.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Other conversation/ }))
    const firstSocket = await showSession('a')
    expect(screen.getByText('Last model input · ~50%')).toBeTruthy()
    const meter = screen.getByRole('progressbar', { name: 'Estimated model input usage' })
    expect(meter.getAttribute('aria-valuetext')).toBe('Approximately 50% of input budget')
    fireEvent.click(screen.getByText('Last model input · ~50%'))
    expect(screen.getByText('Approximately 12,000 of 24,000 input tokens used.')).toBeTruthy()
    expect(screen.getByText(/Conservative UTF-8 estimate, not a provider token count/)).toBeTruthy()
    expect(screen.getByText(/Estimate for the last request; updates each model call/)).toBeTruthy()
    expect(screen.getByText(/8,192 tokens are reserved for the response and 576 for safety/)).toBeTruthy()
    expect(screen.getByText('Compactions: 1. Messages summarized: 8.')).toBeTruthy()
    expect(screen.getByText('AGENTS.md')).toBeTruthy()
    expect(screen.getByText('src/AGENTS.md')).toBeTruthy()
    expect(screen.getByText('Project instructions were truncated.')).toBeTruthy()
    act(() => firstSocket.emit({ type: 'context', context_info: { ...contextInfo, estimated_tokens: 18000, compactions: 2 } }))
    expect(screen.getByText('Last model input · ~75%')).toBeTruthy()
    expect(screen.getByText('· 2 compactions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Empty conversation/ }))
    await showSession('b')
    act(() => firstSocket.emit({ type: 'context', context_info: contextInfo }))
    expect(screen.getByText('Context usage is estimated after the first turn.')).toBeTruthy()
    expect(screen.queryByRole('progressbar', { name: 'Estimated model input usage' })).toBeNull()
    expect(screen.queryByText('AGENTS.md')).toBeNull()
  })

  it('updates active and sidebar context without replacing events and ignores abandoned sockets', async () => {
    window.history.replaceState(null, '', '/?session=a')
    sessions.set('b', makeSession('b'))
    const { result } = renderHook(useWorkspace)
    const firstSocket = await showSession('a')
    await waitFor(() => expect(result.current.sessions).toHaveLength(2))
    act(() => {
      firstSocket.emit({ type: 'status', status: 'running' })
      firstSocket.emit({ type: 'event', event: { id: 'reply', type: 'assistant', text: 'New response' } })
      firstSocket.emit({ type: 'context', context_info: contextInfo })
    })
    expect(result.current.session?.context_info).toEqual(contextInfo)
    expect(result.current.sessions.find(session => session.id === 'a')?.context_info).toEqual(contextInfo)
    expect(result.current.session?.status).toBe('running')
    expect(result.current.session?.events[0].text).toBe('New response')
    act(() => result.current.setActiveId('b'))
    const nextSocket = await showSession('b')
    const nextContext = { ...contextInfo, estimated_tokens: 6000, instruction_files: [], warnings: [] }
    act(() => {
      nextSocket.emit({ type: 'context', context_info: nextContext })
      firstSocket.emit({ type: 'context', context_info: { ...contextInfo, estimated_tokens: 99999 } })
    })
    expect(result.current.session?.id).toBe('b')
    expect(result.current.session?.context_info).toEqual(nextContext)
    expect(result.current.sessions.find(session => session.id === 'b')?.context_info).toEqual(nextContext)
    expect(result.current.sessions.find(session => session.id === 'a')?.context_info?.estimated_tokens).not.toBe(99999)
  })

  it('displays compaction as busy and keeps Stop available', async () => {
    window.history.replaceState(null, '', '/?session=a')
    override = path => path === '/api/sessions/a/stop' ? Promise.resolve(json({ ok: true })) : undefined
    await renderApp()
    const socket = await showSession('a')
    act(() => socket.emit({ type: 'status', status: 'compacting' }))
    expect(screen.getByRole('status').textContent).toBe('Compacting context…')
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/sessions/a/stop' && options?.method === 'POST')).toBe(true))
  })

  it('keeps newer context when an older sidebar summary request completes', async () => {
    window.history.replaceState(null, '', '/?session=a')
    const { result } = renderHook(useWorkspace)
    const socket = await showSession('a')
    const pending = deferred<Response>()
    override = path => path === '/api/sessions' ? pending.promise : undefined
    let refresh!: Promise<void>
    act(() => { refresh = result.current.refreshSessions() })
    act(() => socket.emit({ type: 'context', context_info: contextInfo }))
    await act(async () => {
      pending.resolve(json([...sessions.values()]))
      await refresh
    })
    expect(result.current.session?.context_info).toEqual(contextInfo)
    expect(result.current.sessions.find(session => session.id === 'a')?.context_info).toEqual(contextInfo)
  })
})

describe('editor drafts', () => {
  it('ignores a file read from a closed panel after reopening and editing the file', async () => {
    const firstRead = deferred<Response>()
    let reads = 0
    override = path => path.startsWith('/api/file?') && ++reads === 1 ? firstRead.promise : undefined
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(await screen.findByRole('button', { name: 'note.txt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))
    fireEvent.change(await openEditor(), { target: { value: 'new unsaved editor draft' } })
    await act(async () => { firstRead.resolve(json({ content: 'old read result' })) })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' }).value).toBe('new unsaved editor draft')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('keeps edits typed during Save and advances only the saved baseline', async () => {
    const saving = deferred<Response>()
    override = (path, options) => path === '/api/file' && options.method === 'PUT' ? saving.promise : undefined
    await renderApp()
    const editor = await openEditor()
    fireEvent.change(editor, { target: { value: 'first edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    fireEvent.change(editor, { target: { value: 'second edit while saving' } })
    await act(async () => { saving.resolve(json({ ok: true })) })
    expect(editor.value).toBe('second edit while saving')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    override = () => undefined
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    await waitFor(() => {
      const writes = fetchMock.mock.calls.filter(([path, options]) => path === '/api/file' && options?.method === 'PUT')
      expect(writes).toHaveLength(2)
      expect(JSON.parse(writes[1][1]!.body as string)).toMatchObject({ content: 'second edit while saving', original: 'first edit' })
    })
  })

  it('ignores an older save completion after reopening and restoring the original file text', async () => {
    const firstSave = deferred<Response>()
    let disk = 'original'
    let writes = 0
    override = (path, options) => {
      if (path.startsWith('/api/file?')) return Promise.resolve(json({ content: disk }))
      if (path === '/api/file' && options.method === 'PUT') {
        disk = JSON.parse(options.body as string).content
        return ++writes === 1 ? firstSave.promise : Promise.resolve(json({ ok: true }))
      }
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderApp()
    fireEvent.change(await openEditor(), { target: { value: 'first edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to files' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close workspace' }))
    fireEvent.change(await openEditor(), { target: { value: 'original' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save file' }))
    await screen.findByText('Saved on disk')
    await act(async () => { firstSave.resolve(json({ ok: true })) })
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' }).value).toBe('original')
    expect(screen.getByText('Saved on disk')).toBeTruthy()
  })

  it.each(['Workspace', 'Close workspace', 'Add this file to chat'])('preserves an editor draft after %s closes the panel', async (button) => {
    await renderApp()
    const editor = await openEditor()
    fireEvent.change(editor, { target: { value: 'unsaved editor draft' } })
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.queryByRole('textbox', { name: 'Edit note.txt' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' }).value).toBe('unsaved editor draft')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('preserves the draft through first session creation and isolates it when switching conversations', async () => {
    await renderApp()
    fireEvent.change(await openEditor(), { target: { value: 'created conversation draft' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Start a conversation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await showSession('created')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' }).value).toBe('created conversation draft')
    fireEvent.click(screen.getByRole('button', { name: /^Other conversation/ }))
    await showSession('a')
    fireEvent.click(await screen.findByRole('button', { name: 'note.txt' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit note.txt' }), { target: { value: 'other conversation draft' } })
    fireEvent.click(screen.getByRole('button', { name: /^Created conversation/ }))
    await waitFor(() => expect(TestSocket.instances.filter(socket => socket.url.endsWith('/created/stream'))).toHaveLength(2))
    await showSession('created')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Edit note.txt' }).value).toBe('created conversation draft')
  })
})

describe('session synchronization', () => {
  it('shows a generated title immediately and ignores an older sidebar response', async () => {
    window.history.replaceState(null, '', '/?session=a')
    const { result } = renderHook(useWorkspace)
    const socket = await showSession('a')
    const oldList = [...sessions.values()]
    const older = deferred<Response>()
    const newer = deferred<Response>()
    let requests = 0
    override = path => path === '/api/sessions' ? ++requests === 1 ? older.promise : newer.promise : undefined
    let oldRefresh!: Promise<void>
    act(() => { oldRefresh = result.current.refreshSessions() })
    const title = 'Fix Parser Token Boundaries'
    sessions.set('a', { ...sessions.get('a')!, title })
    act(() => socket.emit({ type: 'title', title }))
    expect(result.current.session?.title).toBe(title)
    expect(result.current.sessions.find(item => item.id === 'a')?.title).toBe(title)
    await act(async () => { newer.resolve(json([...sessions.values()])) })
    await act(async () => { older.resolve(json(oldList)); await oldRefresh })
    expect(result.current.session?.title).toBe(title)
    expect(result.current.sessions.find(item => item.id === 'a')?.title).toBe(title)
  })

  it('preserves generated sidebar and topbar titles through conversation switches and late old responses', async () => {
    window.history.replaceState(null, '', '/?session=a')
    sessions.set('b', makeSession('b', 'Second conversation'))
    await renderApp()
    const firstSocket = await showSession('a')
    const oldList = [...sessions.values()]
    const older = deferred<Response>()
    let requests = 0
    override = path => path === '/api/sessions' && ++requests === 1 ? older.promise : undefined
    act(() => firstSocket.emit({ type: 'status', status: 'idle' }))
    const title = 'Fix Parser Token Boundaries'
    sessions.set('a', { ...sessions.get('a')!, title })
    act(() => firstSocket.emit({ type: 'title', title }))
    expect(screen.getByRole('button', { name: /^Fix Parser Token Boundaries/ })).toBeTruthy()
    expect(within(screen.getByRole('main')).getByText(title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Second conversation/ }))
    await showSession('b')
    await act(async () => {
      firstSocket.emit({ type: 'title', title: 'Ignored abandoned socket title' })
      older.resolve(json(oldList))
    })
    expect(within(screen.getByRole('main')).getByText('Second conversation')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Fix Parser Token Boundaries/ })).toBeTruthy()
    expect(screen.queryByText('Ignored abandoned socket title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Fix Parser Token Boundaries/ }))
    await waitFor(() => expect(TestSocket.instances.filter(socket => socket.url.endsWith('/a/stream'))).toHaveLength(2))
    await showSession('a')
    expect(within(screen.getByRole('main')).getByText(title)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Fix Parser Token Boundaries/ })).toBeTruthy()
  })

  it('refreshes sidebar summaries for title and status changes missed before the initial snapshot', async () => {
    window.history.replaceState(null, '', '/?session=a')
    const { result } = renderHook(useWorkspace)
    const socket = await socketFor('a')
    sessions.set('a', { ...makeSession('a', 'The completed first turn'), status: 'idle' })
    act(() => socket.emit({ type: 'snapshot', session: sessions.get('a') }))
    await waitFor(() => expect(result.current.sessions[0].title).toBe('The completed first turn'))
    expect(result.current.sessions[0].status).toBe('idle')
  })

  it.each(['permissions', 'allow folder', 'remove folder'])('does not replace streamed events with a late %s response', async (action) => {
    window.history.replaceState(null, '', '/?session=a')
    const pending = deferred<Response>()
    override = path => path === '/api/sessions/a/permissions' || path === '/api/sessions/a/folders' ? pending.promise : undefined
    const { result } = renderHook(useWorkspace)
    const socket = await showSession('a')
    let request!: Promise<void>
    act(() => {
      request = action === 'permissions' ? result.current.setPermissionMode('plan')
        : action === 'allow folder' ? result.current.allowFolder('/extra') : result.current.removeFolder('/extra')
    })
    act(() => {
      socket.emit({ type: 'status', status: 'running' })
      socket.emit({ type: 'event', event: { id: 'user', type: 'user', text: 'Hello' } })
      socket.emit({ type: 'event', event: { id: 'reply', type: 'assistant', text: 'New response' } })
    })
    await act(async () => {
      pending.resolve(json({ ...sessions.get('a'), permission_mode: 'plan', allowed_directories: ['/extra'] }))
      await request
    })
    expect(result.current.session?.events.map(event => event.id)).toEqual(['user', 'reply'])
    expect(result.current.session?.status).toBe('running')
    if (action === 'permissions') expect(result.current.permissionMode).toBe('plan')
    else expect(result.current.session?.allowed_directories).toEqual(['/extra'])
  })

  it('recovers when browser history returns to a deleted conversation', async () => {
    window.history.replaceState(null, '', '/?session=a')
    const { result } = renderHook(useWorkspace)
    await showSession('a')
    await act(async () => { await result.current.deleteSession('a') })
    expect(result.current.activeId).toBeNull()
    act(() => {
      window.history.replaceState(null, '', '/?session=a')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(result.current.error).toContain('no longer exists'))
    expect(result.current.activeId).toBeNull()
    expect(window.location.search).toBe('')
    expect(TestSocket.instances).toHaveLength(1)
  })

  it('stops reconnecting if the conversation was deleted while disconnected', async () => {
    window.history.replaceState(null, '', '/?session=a')
    const { result } = renderHook(useWorkspace)
    const socket = await showSession('a')
    sessions.delete('a')
    vi.useFakeTimers()
    act(() => socket.close())
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.error).toContain('no longer exists')
    expect(result.current.activeId).toBeNull()
    expect(TestSocket.instances).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
