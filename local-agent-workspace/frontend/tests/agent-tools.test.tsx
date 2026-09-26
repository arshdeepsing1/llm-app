import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AgentToolsDialog from '../src/components/AgentToolsDialog'
import type { Session } from '../src/types'

const session = (id = 'a'): Session => ({ id, title: `Conversation ${id}`, workspace: '/project', model: 'test-model', status: 'idle', events: [], updated: 1, permission_mode: 'manual', allowed_directories: [] })
const checkpoint = { id: 'checkpoint', path: 'src/main.py', status: 'available', created: 1 }
const worktree = { id: 'worktree', path: '/project-worktree', branch: 'feature/test', source_workspace: '/project', created: 1 }
const task = { id: 'task', title: 'Inspect source', description: 'Find the parser', status: 'pending', depends_on: [] }
const config = { servers: [], hooks: [] }
const skill = { id: 'skill', name: 'Review code', description: 'Review changes carefully', path: '/skills/review/SKILL.md' }
const metrics = {
  scope: 'session', complete: true,
  totals: { calls: 2, successful: 1, errors: 1, rate_limited: 1, input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 300, cache_creation_input_tokens: 100, reasoning_tokens: 20, estimated_dbu: 0.2039292 },
  calls: [
    { id: 'call-1', purpose: 'agent', model: 'databricks-claude-opus-4-8', created: '2026-09-22T10:00:00Z', status: 'completed', usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 300, cache_creation_input_tokens: 100, reasoning_tokens: 20 }, estimated_dbu: 0.2039292 },
    { id: 'call-2', purpose: 'compaction', model: 'databricks-claude-opus-4-8', created: '2026-09-22T10:01:00Z', status: 'error', http_status: 429, estimated_dbu: 0 },
  ],
  by_purpose: [], by_model: [],
  pricing: { currency: 'DBU', unit: 'per_1m_tokens', label: 'Databricks pay-per-token list-price DBU estimate', source_url: 'https://www.databricks.com/product/pricing/proprietary-foundation-model-serving', effective_at: '2026-09-22', estimated: true },
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let override: (path: string, options: RequestInit) => Promise<Response> | undefined
let onClose: ReturnType<typeof vi.fn<() => void>>
let onSelectSession: ReturnType<typeof vi.fn<(id: string) => void>>
let onError: ReturnType<typeof vi.fn<(message: string) => void>>

beforeEach(() => {
  override = () => undefined
  onClose = vi.fn(); onSelectSession = vi.fn(); onError = vi.fn()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  fetchMock = vi.fn<typeof fetch>(async (input, options = {}) => {
    const path = String(input)
    const result = override(path, options)
    if (result) return result
    if (/^\/api\/checkpoints(?:\?|$)/.test(path)) return json([checkpoint])
    if (path.includes('/preview')) return json({ ...checkpoint, diff: '-new\n+original', expected_current_hash: 'current-hash', can_restore: true })
    if (path.includes('/restore')) return json({ ok: true })
    if (/^\/api\/worktrees(?:\?|$)/.test(path)) return json(options.method === 'POST' ? worktree : [worktree])
    if (path.includes('/worktrees/worktree/session')) return json(session('worktree-session'))
    if (path.includes('/worktrees/worktree') && options.method === 'DELETE') return json({ ok: true })
    if (path.endsWith('/tasks')) return json(options.method === 'POST' ? { ...task, id: 'new-task', ...JSON.parse(options.body as string) } : [task])
    if (path.includes('/tasks/')) return json({ ...task, ...JSON.parse(options.body as string) })
    if (path.endsWith('/children')) return json([{ ...session('child'), title: 'Child review', status: 'awaiting_approval' }])
    if (path.endsWith('/subagent-profile')) return json({ ...session(), subagent_tool_profile: JSON.parse(options.body as string).tool_profile })
    if (path.endsWith('/metrics')) return json(metrics)
    if (path === '/api/extensions') return json(options.method === 'PUT' ? JSON.parse(options.body as string) : config)
    if (path === '/api/extensions/test') return json({ tools: ['example.search'] })
    if (path === '/api/skills' || path.startsWith('/api/skills?')) return json([skill])
    if (path.endsWith('/skills')) return json({ active_skills: JSON.parse(options.body as string).enabled ? ['skill'] : [] })
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function dialog(selected: Session | null = session()) {
  return <AgentToolsDialog session={selected} onClose={onClose} onSelectSession={onSelectSession} onError={onError} />
}
async function openTab(tab: string, selected: Session | null = session()) {
  const view = render(dialog(selected))
  await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' })
  fireEvent.click(screen.getByRole('button', { name: tab }))
  return view
}

it('previews a checkpoint and restores only the previewed file version', async () => {
  render(dialog())
  fireEvent.click(await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' }))
  const restore = await screen.findByRole('button', { name: 'Restore checkpoint' })
  expect(screen.getByText('-new +original')).toBeTruthy()
  fireEvent.click(restore)
  await screen.findByText('Restored src/main.py.')
  const request = fetchMock.mock.calls.find(([path]) => path === '/api/checkpoints/checkpoint/restore?session_id=a')
  expect(request?.[1]?.method).toBe('POST')
  expect(JSON.parse(request![1]!.body as string)).toEqual({ expected_current_hash: 'current-hash' })
  expect(screen.queryByRole('button', { name: 'Restore checkpoint' })).toBeNull()
})

it('keeps an unrestorable checkpoint disabled and displays the server explanation', async () => {
  override = path => path.includes('/preview') ? Promise.resolve(json({ ...checkpoint, diff: '', expected_current_hash: '', can_restore: false, error: 'The file changed externally.' })) : undefined
  render(dialog())
  fireEvent.click(await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' }))
  expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Restore checkpoint' })).disabled).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe('The file changed externally.')
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/restore'))).toBe(false)
})

it('previews a user turn together but restores only the explicitly selected file', async () => {
  const second = { ...checkpoint, id: 'second', path: 'src/helper.py', turn_id: 'turn-1' }
  const first = { ...checkpoint, turn_id: 'turn-1' }
  const selected = session()
  selected.events = [{ id: 'turn-1', type: 'user', text: 'Update both parsers' }]
  override = path => {
    if (path === '/api/checkpoints?session_id=a') return Promise.resolve(json([first, second]))
    if (path === '/api/checkpoint-turns/turn-1/preview?session_id=a&offset=0') return Promise.resolve(json({ turn_id: 'turn-1', next_offset: null, previews: [
      { ...first, diff: '-new\n+old', expected_current_hash: 'first-hash', can_restore: true },
      { ...second, diff: '', expected_current_hash: 'second-hash', can_restore: false, error: 'Changed externally.' },
    ] }))
    return undefined
  }
  render(dialog(selected))
  fireEvent.click(await screen.findByRole('button', { name: 'Preview turn turn-1' }))
  expect(screen.getByText('Update both parsers')).toBeTruthy()
  const firstPreview = await screen.findByRole('group', { name: 'Recovery preview src/main.py' })
  const secondPreview = screen.getByRole('group', { name: 'Recovery preview src/helper.py' })
  expect(within(secondPreview).getByRole<HTMLButtonElement>('button', { name: 'Restore checkpoint' }).disabled).toBe(true)
  expect(screen.getByText(/not a whole-turn undo/)).toBeTruthy()
  fireEvent.click(within(firstPreview).getByRole('button', { name: 'Restore checkpoint' }))
  await screen.findByText('Restored src/main.py.')
  const restores = fetchMock.mock.calls.filter(([path]) => String(path).includes('/restore'))
  expect(restores).toHaveLength(1)
  expect(restores[0][0]).toBe('/api/checkpoints/checkpoint/restore?session_id=a')
  expect(JSON.parse(restores[0][1]!.body as string)).toEqual({ expected_current_hash: 'first-hash' })
})

it('loads bounded turn preview pages and clears them on session switch', async () => {
  override = path => {
    if (path === '/api/checkpoints?session_id=a') return Promise.resolve(json([{ ...checkpoint, turn_id: 'turn-1' }]))
    if (path.startsWith('/api/checkpoint-turns/turn-1/preview?session_id=a')) {
      const offset = new URL(path, 'http://localhost').searchParams.get('offset')
      return Promise.resolve(json({ turn_id: 'turn-1', next_offset: offset === '0' ? 10 : null, previews: [
        { ...checkpoint, id: `page-${offset}`, path: `page-${offset}.py`, diff: 'diff', expected_current_hash: 'hash', can_restore: true },
      ] }))
    }
    return undefined
  }
  const view = render(dialog())
  fireEvent.click(await screen.findByRole('button', { name: 'Preview turn turn-1' }))
  fireEvent.click(await screen.findByRole('button', { name: 'More checkpoints in this turn' }))
  await screen.findByRole('group', { name: 'Recovery preview page-10.py' })
  expect(screen.getByRole('group', { name: 'Recovery preview page-0.py' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'More checkpoints in this turn' })).toBeNull()
  view.rerender(dialog(session('b')))
  await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' })
  expect(screen.queryByRole('group', { name: /Recovery preview/ })).toBeNull()
})

it('creates scoped worktrees from explicit branches and opens their conversations', async () => {
  await openTab('Worktrees')
  await screen.findByRole('button', { name: 'Open conversation in feature/test' })
  expect(screen.getByText(/committed HEAD.*Uncommitted changes are not copied/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('New branch'), { target: { value: 'feature/isolated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create worktree' }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'New branch' }).value).toBe(''))
  const request = fetchMock.mock.calls.find(([path, options]) => path === '/api/worktrees?session_id=a' && options?.method === 'POST')
  expect(JSON.parse(request![1]!.body as string)).toEqual({ branch: 'feature/isolated' })
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation in feature/test' }))
  await waitFor(() => expect(onSelectSession).toHaveBeenCalledWith('worktree-session'))
  expect(onClose).toHaveBeenCalledOnce()
})

it('shows a separate per-conversation usage graph and estimated DBU cost', async () => {
  const view = await openTab('Usage')
  expect(await screen.findByText('0.2039 DBU')).toBeTruthy()
  expect(screen.getAllByText('Uncached input')[0].parentElement?.textContent).toContain('1,200')
  expect(screen.getAllByText('Cache read')[0].parentElement?.textContent).toContain('300')
  expect(screen.getAllByText('Cache write')[0].parentElement?.textContent).toContain('100')
  expect(screen.getByText('Input incl. cache')).toBeTruthy()
  expect(screen.getByRole('img', { name: /Tokens by model call/ })).toBeTruthy()
  expect(screen.getByText('compaction')).toBeTruthy()
  expect(screen.getByText('error · 429')).toBeTruthy()
  expect(screen.getByText(/near-real-time estimate/)).toBeTruthy()
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/sessions/a/metrics')).toBe(true)
  const requests = fetchMock.mock.calls.filter(([path]) => path === '/api/sessions/a/metrics').length
  view.rerender(<AgentToolsDialog session={{ ...session(), status: 'running' }} onClose={onClose} onSelectSession={onSelectSession} onError={vi.fn()} />)
  await act(async () => { await Promise.resolve() })
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/sessions/a/metrics')).toHaveLength(requests)
})

it('exports usage as a CSV download with the local token', async () => {
  const csv = 'n,purpose\n1,agent\n'
  const created: Blob[] = []
  const createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return 'blob:usage' })
  const revokeObjectURL = vi.fn()
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
  Object.assign(URL, { createObjectURL, revokeObjectURL })  // jsdom does not implement these
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('usage-a.csv')
    expect(this.href).toBe('blob:usage')
  })
  override = path => path === '/api/sessions/a/usage.csv' ? Promise.resolve(new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } })) : undefined
  await openTab('Usage')
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
  const request = fetchMock.mock.calls.find(([path]) => path === '/api/sessions/a/usage.csv')
  expect(Object.keys(request![1]!.headers as Record<string, string>)).toContain('X-Local-Token')
  expect(await created[0].text()).toBe(csv)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:usage')
  click.mockRestore()
  Object.assign(URL, original)
})

it('shows an export failure instead of downloading', async () => {
  override = path => path === '/api/sessions/a/usage.csv' ? Promise.resolve(json({ detail: 'Conversation not found.' }, 404)) : undefined
  await openTab('Usage')
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  expect(await screen.findByText('Conversation not found.')).toBeTruthy()
})

it('renders missing provider usage as unavailable rather than zero', async () => {
  override = path => path === '/api/sessions/a/metrics' ? Promise.resolve(json({
    ...metrics,
    totals: { ...metrics.totals, input_tokens: null, output_tokens: null,
      cache_read_input_tokens: null, cache_creation_input_tokens: null,
      reasoning_tokens: null, estimated_dbu: null },
    calls: [{ id: 'missing', purpose: 'agent', model: 'databricks-claude-opus-4-8',
      created: '2026-09-22T10:00:00Z', status: 'error', usage: { input_tokens: 7 },
      estimated_dbu: null }],
  })) : undefined
  await openTab('Usage')
  expect((await screen.findAllByText('Unavailable')).length).toBeGreaterThanOrEqual(3)
  const table = screen.getByRole('table', { name: 'Model calls for this conversation' })
  expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(3)
})

it('explains incomplete legacy usage and does not request metrics without a conversation', async () => {
  override = path => path === '/api/sessions/a/metrics' ? Promise.resolve(json({ ...metrics, complete: false })) : undefined
  await openTab('Usage')
  expect(await screen.findByText(/older conversation has no complete inference ledger/)).toBeTruthy()
  cleanup()
  await openTab('Usage', null)
  expect(screen.getByText('Start a conversation to track its model usage.')).toBeTruthy()
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/sessions/null/metrics')).toBe(false)
})

it('shows refused worktree removal inline without losing the worktree', async () => {
  override = (path, options) => path.includes('/worktrees/worktree') && options.method === 'DELETE' ? Promise.resolve(json({ detail: 'Worktree has uncommitted changes.' }, 409)) : undefined
  await openTab('Worktrees')
  fireEvent.click(await screen.findByRole('button', { name: 'Remove worktree feature/test' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Worktree has uncommitted changes.')
  expect(screen.getByRole('button', { name: 'Open conversation in feature/test' })).toBeTruthy()
  expect(onError).toHaveBeenCalledWith('Worktree has uncommitted changes.')
})

it('creates dependent tasks, updates task status, and opens a child awaiting approval', async () => {
  await openTab('Tasks')
  await screen.findByRole('checkbox', { name: 'Complete task Inspect source' })
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Fix parser' } })
  fireEvent.change(screen.getByLabelText('Task description'), { target: { value: 'Use the inspection findings' } })
  fireEvent.click(screen.getByText('Dependencies'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inspect source' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  await screen.findByRole('checkbox', { name: 'Complete task Fix parser' })
  const create = fetchMock.mock.calls.find(([path, options]) => path === '/api/sessions/a/tasks' && options?.method === 'POST')
  expect(JSON.parse(create![1]!.body as string)).toEqual({ title: 'Fix parser', description: 'Use the inspection findings', depends_on: ['task'] })
  fireEvent.change(screen.getByRole('combobox', { name: 'Status for Inspect source' }), { target: { value: 'in_progress' } })
  await waitFor(() => expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Status for Inspect source' }).value).toBe('in_progress'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Complete task Inspect source' }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Complete task Inspect source' }).checked).toBe(true))
  const statuses = fetchMock.mock.calls.filter(([path]) => path === '/api/sessions/a/tasks/task').map(([, options]) => JSON.parse(options!.body as string))
  expect(statuses).toEqual([{ status: 'in_progress' }, { status: 'completed' }])
  expect(screen.getByText('Waiting for approval')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open subagent Child review' }))
  expect(onSelectSession).toHaveBeenCalledWith('child')
  expect(onClose).toHaveBeenCalledOnce()
})

it('retains the previous task status when dependency validation rejects an update', async () => {
  override = (path, options) => path.includes('/tasks/task') && options.method === 'PATCH' ? Promise.resolve(json({ detail: 'Complete all dependencies first.' }, 400)) : undefined
  await openTab('Tasks')
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete task Inspect source' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Complete all dependencies first.')
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Complete task Inspect source' }).checked).toBe(false)
})

it('saves extensions only on explicit action, tests the saved configuration, and toggles skills', async () => {
  await openTab('Extensions')
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Extension configuration (JSON)' })
  await waitFor(() => expect(editor.value).toContain('servers'))
  const next = { servers: [{ id: 'example', name: 'Example', transport: 'stdio', command: 'example-server', args: [], enabled: true }], hooks: [] }
  fireEvent.change(editor, { target: { value: JSON.stringify(next) } })
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/extensions' && options?.method === 'PUT')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  await screen.findByText('Configuration saved.')
  const save = fetchMock.mock.calls.find(([path, options]) => path === '/api/extensions' && options?.method === 'PUT')
  expect(JSON.parse(save![1]!.body as string)).toEqual(next)
  fireEvent.click(screen.getByRole('button', { name: 'Test saved configuration' }))
  await screen.findByText('example.search')
  expect(fetchMock.mock.calls.find(([path]) => path === '/api/extensions/test')?.[1]?.body).toBeUndefined()
  fireEvent.click(screen.getByRole('checkbox', { name: /Review code/ }))
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Review code/ }).checked).toBe(true))
  const toggle = fetchMock.mock.calls.find(([path]) => path === '/api/sessions/a/skills')
  expect(JSON.parse(toggle![1]!.body as string)).toEqual({ skill_id: 'skill', enabled: true })
})

it('rejects invalid extension JSON inline without sending it', async () => {
  await openTab('Extensions')
  await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Extension configuration (JSON)' }).value).toContain('servers'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Extension configuration (JSON)' }), { target: { value: 'not JSON' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  await screen.findByRole('alert')
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/extensions' && options?.method === 'PUT')).toBe(false)
})

it('locks extension editing until initial load completes and while saving the edited configuration', async () => {
  const loading = deferred<Response>()
  const saving = deferred<Response>()
  override = (path, options) => path === '/api/extensions' ? options.method === 'PUT' ? saving.promise : loading.promise : undefined
  await openTab('Extensions')
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Extension configuration (JSON)' })
  expect(editor.disabled).toBe(true)
  editor.focus()
  expect(document.activeElement).not.toBe(editor)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save configuration' }).disabled).toBe(true)
  const original = { servers: [], hooks: [{ id: 'old-hook', event: 'before_tool', command: 'old-command', timeout_seconds: 10, enabled: true }] }
  await act(async () => { loading.resolve(json(original)) })
  expect(editor.disabled).toBe(false)
  expect(JSON.parse(editor.value)).toEqual(original)
  fireEvent.change(editor, { target: { value: JSON.stringify(config) } })
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  expect(editor.disabled).toBe(true)
  const request = fetchMock.mock.calls.find(([path, options]) => path === '/api/extensions' && options?.method === 'PUT')
  expect(JSON.parse(request![1]!.body as string)).toEqual({ servers: [], hooks: [] })
  await act(async () => { saving.resolve(json(config)) })
  expect(editor.disabled).toBe(false)
  expect(JSON.parse(editor.value)).toEqual(config)
})

it.each([
  ['Worktrees', 'New branch', 'Create worktree', '/api/worktrees?session_id=a'],
  ['Tasks', 'Task title', 'Add task', '/api/sessions/a/tasks'],
])('locks %s creation inputs while their request is pending', async (tab, label, button, path) => {
  const pending = deferred<Response>()
  override = (request, options) => request === path && options.method === 'POST' ? pending.promise : undefined
  await openTab(tab)
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: label })
  await waitFor(() => expect(input.disabled).toBe(false))
  fireEvent.change(input, { target: { value: 'codex/new-task' } })
  fireEvent.click(screen.getByRole('button', { name: button }))
  expect(input.disabled).toBe(true)
  if (tab === 'Tasks') {
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Task description' }).disabled).toBe(true)
    fireEvent.click(screen.getByText('Dependencies'))
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Inspect source' }).disabled).toBe(true)
  }
  await act(async () => { pending.resolve(json(tab === 'Tasks' ? { ...task, id: 'created-task' } : worktree)) })
  expect(input.disabled).toBe(false)
  expect(input.value).toBe('')
})

it('loads skills from the selected conversation workspace rather than the default workspace', async () => {
  override = path => path === '/api/skills?session_id=worktree-session' ? Promise.resolve(json([{ ...skill, id: 'worktree-skill', name: 'Worktree skill', path: '/worktree/.agents/skills/SKILL.md' }])) : undefined
  await openTab('Extensions', session('worktree-session'))
  expect(await screen.findByRole('checkbox', { name: /Worktree skill/ })).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: /Review code/ })).toBeNull()
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/skills?session_id=worktree-session')).toBe(true)
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/skills')).toBe(false)
})

it('requires a conversation for tasks and skill activation but allows draft workspace recovery', async () => {
  await openTab('Tasks', null)
  expect(screen.getByText('Start a conversation to manage tasks and subagents.')).toBeTruthy()
  expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/sessions/'))).toBe(false)
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/checkpoints')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Extensions' }))
  expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: /Review code/ })).disabled).toBe(true)
})

it('ignores a previous conversation preview and errors after switching scope', async () => {
  const pending = deferred<Response>()
  override = path => path === '/api/checkpoints/checkpoint/preview?session_id=a' ? pending.promise : undefined
  const view = render(dialog())
  fireEvent.click(await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' }))
  view.rerender(dialog(session('b')))
  await screen.findByRole('button', { name: 'Preview checkpoint src/main.py' })
  await act(async () => { pending.resolve(json({ detail: 'Old scope error' }, 409)) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Restore checkpoint' })).toBeNull()
  expect(onError).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/checkpoints?session_id=b')).toBe(true)
})

it('does not navigate when an open-worktree request finishes after closing the dialog', async () => {
  const pending = deferred<Response>()
  override = path => path === '/api/worktrees/worktree/session?session_id=a' ? pending.promise : undefined
  const view = await openTab('Worktrees')
  fireEvent.click(await screen.findByRole('button', { name: 'Open conversation in feature/test' }))
  view.unmount()
  await act(async () => { pending.resolve(json(session('late-session'))) })
  expect(onSelectSession).not.toHaveBeenCalled()
})

it('saves a new subagent ceiling only after the server accepts it', async () => {
  await openTab('Tasks')
  await screen.findByRole('button', { name: 'Open subagent Child review' })
  const selector = screen.getByRole<HTMLSelectElement>('combobox', { name: 'New subagent tool ceiling' })
  fireEvent.change(selector, { target: { value: 'read_only' } })
  await screen.findByText('Tool ceiling saved for new subagents.')
  expect(selector.value).toBe('read_only')
  const call = fetchMock.mock.calls.find(([path]) => path === '/api/sessions/a/subagent-profile')
  expect(JSON.parse(call![1]!.body as string)).toEqual({ tool_profile: 'read_only' })
  override = path => path.endsWith('/subagent-profile') ? Promise.resolve(json({ detail: 'Conversation is running.' }, 409)) : undefined
  fireEvent.change(selector, { target: { value: 'inherit' } })
  await screen.findByRole('alert')
  expect(selector.value).toBe('read_only')
})

it('does not offer profile widening for a child conversation', async () => {
  await openTab('Tasks', { ...session(), is_subagent: true, tool_profile: 'read_only' })
  expect(screen.queryByRole('combobox', { name: 'New subagent tool ceiling' })).toBeNull()
  expect(screen.getByText(/This child cannot widen/)).toBeTruthy()
})

it('shows independent healthy, failed and disabled MCP results and clears stale results', async () => {
  override = path => path === '/api/extensions/test' ? Promise.resolve(json({ tools: ['mcp__ok__search'], servers: [
    { id: 'ok', name: 'Search server', status: 'connected', tools: ['mcp__ok__search'] },
    { id: 'bad', name: 'Broken server', status: 'failed', tools: [], error: 'Connection refused' },
    { id: 'off', name: 'Unused server', status: 'disabled', tools: [] },
  ] })) : undefined
  await openTab('Extensions')
  await screen.findByText('Review code')
  fireEvent.click(screen.getByRole('button', { name: 'Test saved configuration' }))
  await screen.findByText('Connection refused')
  expect(screen.getByText('Connected during test · 1 tools')).toBeTruthy()
  expect(screen.getByText('Disabled · not started')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  await screen.findByText('Configuration saved.')
  expect(screen.queryByText('Connection refused')).toBeNull()
})
