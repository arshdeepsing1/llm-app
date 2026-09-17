import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TerminalPanel from '../src/components/TerminalPanel'
import type { Job } from '../src/types'

const makeJob = (id: string, overrides: Partial<Job> = {}): Job => ({
  id, session_id: 'a', workspace: '/project', command: `command-${id}`, state: 'running',
  created: 1, updated: 1, exit_code: null, output: '', truncated: false,
  timeout_seconds: 60, max_output_bytes: 80000, background: false, ...overrides,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
let jobs: Map<string, Job>
let override: (path: string, options: RequestInit) => Promise<Response> | undefined
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  vi.useFakeTimers()
  jobs = new Map()
  override = () => undefined
  fetchMock = vi.fn<typeof fetch>(async (input, options = {}) => {
    const path = String(input)
    const custom = override(path, options)
    if (custom) return custom
    const url = new URL(path, 'http://localhost')
    const sessionId = url.searchParams.get('session_id')
    if (url.pathname === '/api/jobs' && options.method === 'POST') {
      const job = makeJob(`job-${jobs.size + 1}`, { ...JSON.parse(options.body as string), session_id: sessionId })
      jobs.set(job.id, job)
      return json(job)
    }
    if (url.pathname === '/api/jobs') return json([...jobs.values()].filter(job => job.session_id === sessionId).map(({ output: _output, ...summary }) => summary))
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(\/stop)?$/)
    const job = match && jobs.get(match[1])
    if (job) {
      if (match[2]) { job.state = 'cancelled'; job.updated++; job.exit_code = -15 }
      return json(job)
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function openTerminal(sessionId: string | null = 'a', workspace = '/project') {
  let view!: ReturnType<typeof render>
  await act(async () => { view = render(<TerminalPanel sessionId={sessionId} workspace={workspace} />) })
  return view
}
async function run(command = 'print progress') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Shell command' }), { target: { value: command } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })) })
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

it('launches immediately and displays live output before foreground completion', async () => {
  await openTerminal()
  await run()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run' }).disabled).toBe(true)
  const request = fetchMock.mock.calls.find(([path, options]) => path === '/api/jobs?session_id=a' && options?.method === 'POST')
  expect(JSON.parse(request![1]!.body as string)).toEqual({ command: 'print progress', timeout_seconds: 60, max_output_bytes: 80000, background: false })
  jobs.set('job-1', { ...jobs.get('job-1')!, output: 'first line\n', updated: 2 })
  await tick(500)
  expect(screen.getByLabelText('Job output').textContent).toContain('first line')
  expect(screen.getByRole('status').textContent).toBe('running')
  expect(screen.getByRole('button', { name: 'Stop job print progress' })).toBeTruthy()
  jobs.set('job-1', { ...jobs.get('job-1')!, output: 'first line\nfinished\n', updated: 3, state: 'completed', exit_code: 0, truncated: true })
  await tick(500)
  expect(screen.getByLabelText('Job output').textContent).toContain('finished')
  expect(screen.getByRole('status').textContent).toBe('completed · exit 0 · output truncated')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run' }).disabled).toBe(false)
  await tick(1000)
  const calls = fetchMock.mock.calls.filter(([path]) => path === '/api/jobs/job-1?session_id=a').length
  await tick(3000)
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/jobs/job-1?session_id=a')).toHaveLength(calls)
})

it('stops a running job and ignores a pre-cancellation poll that returns late', async () => {
  jobs.set('one', makeJob('one', { output: 'started' }))
  await openTerminal()
  const pending = deferred<Response>()
  override = path => path === '/api/jobs/one?session_id=a' ? pending.promise : undefined
  await tick(500)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop job command-one' })) })
  expect(screen.getByRole('status').textContent).toBe('cancelled · exit -15')
  await act(async () => { pending.resolve(json(makeJob('one', { output: 'stale running output' }))) })
  expect(screen.getByRole('status').textContent).toBe('cancelled · exit -15')
  expect(screen.getByLabelText('Job output').textContent).not.toContain('stale running output')
})

it('allows multiple background jobs, sends limits, and restores history after reopening', async () => {
  const view = await openTerminal()
  fireEvent.change(screen.getByLabelText('Timeout (seconds)'), { target: { value: '300' } })
  fireEvent.change(screen.getByLabelText('Output limit (bytes)'), { target: { value: '120000' } })
  fireEvent.click(screen.getByLabelText('Run in background'))
  await run('background-one')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run' }).disabled).toBe(false)
  await run('background-two')
  expect(jobs.get('job-1')).toMatchObject({ background: true, timeout_seconds: 300, max_output_bytes: 120000 })
  expect(screen.getAllByRole('button', { name: /^Stop job / })).toHaveLength(2)
  await act(async () => { view.unmount() })
  expect(vi.getTimerCount()).toBe(0)
  await openTerminal()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show job background-two · running/ })) })
  expect(screen.getByLabelText('Job output').textContent).toContain('$ background-two')
  expect(screen.getByText(/Background jobs continue after Stop response/)).toBeTruthy()
})

it('ignores old workspace and conversation polls and clears state on a scope change', async () => {
  jobs.set('one', makeJob('one', { output: 'session A output' }))
  jobs.set('two', makeJob('two', { session_id: 'b', output: 'session B output', state: 'completed', exit_code: 0 }))
  const view = await openTerminal()
  const pending = deferred<Response>()
  override = path => path === '/api/jobs/one?session_id=a' ? pending.promise : undefined
  await tick(500)
  await act(async () => { view.rerender(<TerminalPanel sessionId="b" workspace="/other" />) })
  expect(screen.getByLabelText('Job output').textContent).toContain('session B output')
  await act(async () => { pending.resolve(json(makeJob('one', { output: 'late A output', updated: 2 }))) })
  expect(screen.getByLabelText('Job output').textContent).toContain('session B output')
  expect(screen.queryByText(/late A output/)).toBeNull()
  expect(vi.getTimerCount()).toBe(1)
  await act(async () => { view.rerender(<TerminalPanel sessionId={null} workspace="/global" />) })
  expect(screen.getByLabelText('Job output').textContent).toBe('Command output will appear here.')
  await run('global command')
  expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/jobs' && options?.method === 'POST')).toBe(true)
})

it('ignores an old selected-job response after selecting another job', async () => {
  jobs.set('one', makeJob('one', { background: true, output: 'one output' }))
  jobs.set('two', makeJob('two', { background: true, output: 'two output' }))
  await openTerminal()
  const pending = deferred<Response>()
  override = path => path === '/api/jobs/one?session_id=a' ? pending.promise : undefined
  await tick(500)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show job command-two · running/ })) })
  await act(async () => { pending.resolve(json(makeJob('one', { output: 'late first job', updated: 2 }))) })
  expect(screen.getByLabelText('Job output').textContent).toContain('two output')
  expect(screen.getByLabelText('Job output').textContent).not.toContain('late first job')
})

it('does not move a late job launch into a different workspace scope', async () => {
  const pending = deferred<Response>()
  override = (path, options) => path === '/api/jobs?session_id=a' && options.method === 'POST' ? pending.promise : undefined
  const view = await openTerminal()
  await run('slow launch')
  expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy()
  await act(async () => { view.rerender(<TerminalPanel sessionId="b" workspace="/other" />) })
  await act(async () => { pending.resolve(json(makeJob('late', { command: 'slow launch', output: 'old scope output' }))) })
  expect(screen.queryByRole('listitem')).toBeNull()
  expect(screen.getByLabelText('Job output').textContent).toBe('Command output will appear here.')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Shell command' }).value).toBe('')
  expect(vi.getTimerCount()).toBe(1)
})

it('discovers a model-launched job while the terminal was idle', async () => {
  await openTerminal()
  expect(screen.queryByRole('listitem')).toBeNull()
  jobs.set('model-job', makeJob('model-job', { background: true, output: 'model command output' }))
  await tick(3000)
  expect(screen.getByRole('button', { name: /Show job command-model-job · running/ })).toBeTruthy()
  expect(screen.getByLabelText('Job output').textContent).toContain('model command output')
  const listCalls = fetchMock.mock.calls.filter(([path]) => path === '/api/jobs?session_id=a').length
  await tick(1000)
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/jobs?session_id=a')).toHaveLength(listCalls + 1)
})

it('stops polling on error until an explicit refresh', async () => {
  override = () => Promise.resolve(json({ detail: 'Server unavailable' }, 500))
  await openTerminal()
  expect(screen.getByRole('alert').textContent).toBe('Server unavailable')
  const calls = fetchMock.mock.calls.length
  await tick(3000)
  expect(fetchMock.mock.calls).toHaveLength(calls)
  override = () => undefined
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh jobs' })) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(fetchMock.mock.calls.length).toBe(calls + 1)
})
