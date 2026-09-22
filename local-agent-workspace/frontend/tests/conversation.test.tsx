import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Conversation from '../src/components/Conversation'
import type { AgentEvent, Session } from '../src/types'

const makeSession = (events: AgentEvent[], overrides: Partial<Session> = {}): Session => ({
  id: 'parent', title: 'Parent task', workspace: '/project', model: 'test-model', status: 'idle',
  events, updated: 1, permission_mode: 'manual', allowed_directories: [], ...overrides,
})
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => { cleanup(); Reflect.deleteProperty(navigator, 'clipboard'); vi.restoreAllMocks() })

it('updates compact child progress without expanding the delegation tool or exposing child contents', () => {
  const onSelectSession = vi.fn()
  const event: AgentEvent = { id: 'delegate', type: 'tool', name: 'delegate_task', input: { task: 'Review the parser' },
    state: 'running', child_session_id: 'child-1', delegation: { status: 'running', completed_tools: 0 } }
  const view = render(<Conversation session={makeSession([event])} onError={vi.fn()} onSelectSession={onSelectSession} />)
  const heading = screen.getByRole('button', { name: 'delegate task Review the parser' })
  expect(heading.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByLabelText('Subagent progress').textContent).toContain('Subagent: running')
  view.rerender(<Conversation session={makeSession([{ ...event, delegation: {
    status: 'awaiting_approval', completed_tools: 1, last_tool: 'run_command',
  } }])} onError={vi.fn()} onSelectSession={onSelectSession} />)
  expect(screen.getByText('Subagent: Waiting for approval')).toBeTruthy()
  expect(screen.getByText('1 completed action')).toBeTruthy()
  expect(screen.getByText('Last tool: run command')).toBeTruthy()
  expect(screen.queryByLabelText('Input')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open subagent' }))
  expect(onSelectSession).toHaveBeenCalledWith('child-1')
  view.rerender(<Conversation session={makeSession([{ ...event, state: 'completed', delegation: {
    status: 'failed', completed_tools: 2, last_tool: 'read_file', terminal_reason: 'step_limit',
  } }])} onError={vi.fn()} onSelectSession={onSelectSession} />)
  expect(screen.getByText('Subagent: failed')).toBeTruthy()
  expect(screen.getByText('Reason: step limit')).toBeTruthy()
  expect(screen.getByText('2 completed actions')).toBeTruthy()
  expect(heading.getAttribute('aria-expanded')).toBe('false')
})

it('labels only the initial delegated prompt with provenance', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([
    { id: 'delegated', type: 'user', text: 'Review source', origin: {
      kind: 'delegated', parent_session_id: 'parent', parent_event_id: 'delegate-1', parent_call_id: 'call-1',
    } },
    { id: 'human', type: 'user', text: 'Check one more thing' },
  ], { id: 'child', parent_session_id: 'parent', is_subagent: true })} />)
  expect(screen.getAllByText('Delegated by parent conversation')).toHaveLength(1)
  expect(screen.getByText('Check one more thing').textContent).toBe('Check one more thing')
})

it('copies raw user and assistant text independently while preserving child navigation', async () => {
  const onSelectSession = vi.fn()
  const userText = 'Review this path:\n/project/file.ts'
  const assistantText = 'I reviewed **the file**.'
  render(<Conversation onError={vi.fn()} onSelectSession={onSelectSession} session={makeSession([
    { id: 'user', type: 'user', text: userText, child_session_id: 'child' },
    { id: 'empty-user', type: 'user', text: '' },
    { id: 'reply', type: 'assistant', text: assistantText },
  ])} />)
  const writeText = vi.mocked(navigator.clipboard.writeText)
  expect(screen.getAllByRole('button', { name: 'Copy message' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
  await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, userText))
  fireEvent.click(screen.getByRole('button', { name: 'Copy response' }))
  await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, assistantText))
  fireEvent.click(screen.getByRole('button', { name: 'Open subagent' }))
  expect(onSelectSession).toHaveBeenCalledWith('child')
})

it('keeps provider reasoning collapsed by default and expands it separately from the answer', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'reply', type: 'assistant', text: 'The answer is ready.', reasoning_summary: 'Provider considered **two approaches**.',
  }])} />)
  const summary = screen.getByText('Provider reasoning summary')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  const answer = screen.getByText('The answer is ready.')
  expect(details.contains(answer)).toBe(false)
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  expect(within(details).getByText('Supplied by the model endpoint.')).toBeTruthy()
  expect(within(details).getByText('two approaches').tagName).toBe('STRONG')
  expect(screen.getAllByText('The answer is ready.')).toHaveLength(1)
  fireEvent.click(summary)
  expect(details.open).toBe(false)
  expect(answer.isConnected).toBe(true)
})

it('does not invent reasoning or activity for ordinary user and assistant messages', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([
    { id: 'user', type: 'user', text: 'Please explain the parser.' },
    { id: 'reply', type: 'assistant', text: 'I considered two approaches. Here is the answer.' },
  ])} />)
  expect(screen.getByText('I considered two approaches. Here is the answer.')).toBeTruthy()
  expect(screen.queryByText('Provider reasoning summary')).toBeNull()
  expect(screen.queryByText(/Activity ·/)).toBeNull()
  expect(screen.queryByText('Summary display limit reached.')).toBeNull()
  expect(screen.queryByText(/Request details/)).toBeNull()
})

it('shows a collapsed provider usage snapshot for an assistant event with no answer text', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'request', type: 'assistant', request_info: {
      model: 'databricks-test-model', status: 'completed', finish_reason: 'tool_calls', http_status: 200,
      usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_tokens: 50 },
    },
  }])} />)
  const summary = screen.getByText('Request details · completed')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  expect(screen.queryByRole('button', { name: 'Copy response' })).toBeNull()
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  expect(within(details).getByText('Model endpoint').nextElementSibling?.textContent).toBe('databricks-test-model')
  expect(within(details).getByText('Finish reason').nextElementSibling?.textContent).toBe('tool_calls')
  expect(within(details).getByText('HTTP status').nextElementSibling?.textContent).toBe('200')
  for (const [label, value] of [['Input tokens', '1,000'], ['Output tokens', '200'], ['Total tokens', '1,200'], ['Cache read input tokens', '0'], ['Cache creation input tokens', '0'], ['Reasoning tokens', '50']]) {
    expect(within(details).getByText(label).nextElementSibling?.textContent).toBe(value)
  }
  expect(within(details).getByText(/excludes title and summary calls/)).toBeTruthy()
  expect(within(details).queryByText('Usage received before completion may be partial.')).toBeNull()
  expect(details.textContent).not.toContain('%')
  fireEvent.click(summary)
  expect(details.open).toBe(false)
})

it('updates request metadata independently while preserving unavailable fields and reported zeros', () => {
  const running: AgentEvent = { id: 'request', type: 'assistant', request_info: { model: 'model-a', status: 'running' } }
  const view = render(<Conversation onError={vi.fn()} session={makeSession([running])} />)
  const summary = screen.getByText('Request details · running')
  const details = summary.closest('details')!
  fireEvent.click(summary)
  expect(within(details).getByText('Input tokens').nextElementSibling?.textContent).toBe('Unavailable')
  view.rerender(<Conversation onError={vi.fn()} session={makeSession([{
    ...running, request_info: { model: 'model-a', status: 'completed', usage: { input_tokens: 12, output_tokens: 0 } },
  }])} />)
  expect(details.open).toBe(true)
  expect(screen.getByText('Request details · completed')).toBeTruthy()
  expect(within(details).getByText('Input tokens').nextElementSibling?.textContent).toBe('12')
  expect(within(details).getByText('Output tokens').nextElementSibling?.textContent).toBe('0')
  expect(within(details).getByText('Total tokens').nextElementSibling?.textContent).toBe('Unavailable')
  expect(within(details).getByText('Finish reason').nextElementSibling?.textContent).toBe('Unavailable')
  expect(within(details).getByText('HTTP status').nextElementSibling?.textContent).toBe('Unavailable')
  expect(within(details).queryByText('Error category')).toBeNull()
})

it.each(['authentication', 'permission', 'rate_limit', 'invalid_request', 'server', 'network', 'output_limit', 'invalid_tool_arguments', 'incomplete_response', 'invalid_response', 'unknown'])('shows the %s request error category without requiring response text', errorKind => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'failed', type: 'assistant', request_info: { model: 'model-b', status: 'error', error_kind: errorKind, http_status: 429 },
  }])} />)
  fireEvent.click(screen.getByText('Request details · error'))
  expect(screen.getByText('Error category').nextElementSibling?.textContent).toBe(errorKind.replace(/_/g, ' '))
  expect(screen.getByText('HTTP status').nextElementSibling?.textContent).toBe('429')
  expect(screen.getByText('Input tokens').nextElementSibling?.textContent).toBe('Unavailable')
  expect(screen.queryByRole('button', { name: 'Copy response' })).toBeNull()
})

it('keeps separate per-model request snapshots for cancelled and interrupted attempts', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([
    { id: 'cancelled', type: 'assistant', request_info: { model: 'model-a', status: 'cancelled', usage: { total_tokens: 15 } } },
    { id: 'interrupted', type: 'assistant', request_info: { model: 'model-b', status: 'interrupted' } },
    { id: 'legacy-empty', type: 'assistant' },
  ])} />)
  const cancelled = screen.getByText('Request details · cancelled').closest('details')!
  const interrupted = screen.getByText('Request details · interrupted').closest('details')!
  expect(screen.getAllByText(/Request details ·/)).toHaveLength(2)
  expect(within(cancelled).getByText('Model endpoint').nextElementSibling?.textContent).toBe('model-a')
  expect(within(cancelled).getByText('Total tokens').nextElementSibling?.textContent).toBe('15')
  expect(within(cancelled).getByText('Usage received before completion may be partial.')).toBeTruthy()
  expect(within(interrupted).getByText('Model endpoint').nextElementSibling?.textContent).toBe('model-b')
  expect(within(interrupted).getByText('Total tokens').nextElementSibling?.textContent).toBe('Unavailable')
  expect(within(interrupted).queryByText('Usage received before completion may be partial.')).toBeNull()
})

it('identifies usage returned before a failed request as potentially partial', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'failed-stream', type: 'assistant', request_info: { model: 'model-a', status: 'error', error_kind: 'incomplete_response', usage: { output_tokens: 0 } },
  }])} />)
  fireEvent.click(screen.getByText('Request details · error'))
  expect(screen.getByText('Usage received before completion may be partial.')).toBeTruthy()
  expect(screen.getByText('Output tokens').nextElementSibling?.textContent).toBe('0')
})

it.each([true, false])('shows the provider-summary display limit only when truncated=%s', truncated => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'reply', type: 'assistant', reasoning_summary: 'A provider-supplied partial summary.', reasoning_truncated: truncated,
  }])} />)
  const summary = screen.getByText('Provider reasoning summary')
  expect(summary.closest('details')!.open).toBe(false)
  fireEvent.click(summary)
  expect(screen.getByText('A provider-supplied partial summary.')).toBeTruthy()
  expect(!!screen.queryByText('Summary display limit reached.')).toBe(truncated)
})

it('collapses activity while retaining actual tool states and independent approval controls', () => {
  const states: NonNullable<AgentEvent['state']>[] = ['running', 'pending', 'completed', 'rejected', 'cancelled', 'error']
  const events: AgentEvent[] = states.map((state, index) => ({ id: `tool-${index}`, type: 'tool', name: `action_${index}`, state, input: { path: `file-${index}` } }))
  const view = render(<Conversation onError={vi.fn()} session={makeSession(events)} />)
  const summary = screen.getByText('Activity · 6 actions')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  fireEvent.click(summary)
  expect(details.open).toBe(true)
  const rows = within(details).getAllByRole('listitem')
  expect(rows).toHaveLength(states.length)
  states.forEach((state, index) => {
    expect(within(rows[index]).getByText(`action ${index}`)).toBeTruthy()
    expect(within(rows[index]).getByText(`Action: ${state}`)).toBeTruthy()
  })
  view.rerender(<Conversation onError={vi.fn()} session={makeSession(events.map(event => ({ ...event, state: 'completed' })))} />)
  expect(within(details).getAllByText('Action: completed')).toHaveLength(6)
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  fireEvent.click(summary)
  expect(details.open).toBe(false)
})

it('shows distinct tool diagnostics while failed actions are collapsed', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([
    { id: 'file', type: 'tool', name: 'search_files', state: 'error', input: { path: 'run.log' }, output: 'Search path must be a regular file or directory.' },
    { id: 'timeout', type: 'tool', name: 'search_files', state: 'error', input: { path: '/large' }, output: 'File query time limit reached; narrow the path, glob, or line range.' },
    { id: 'regex', type: 'tool', name: 'search_files', state: 'error', input: { query: 'connect(' }, output: 'Invalid regular expression: missing ).' },
  ])} />)
  expect(screen.getByText('Search path must be a regular file or directory.')).toBeTruthy()
  expect(screen.getByText('File query time limit reached; narrow the path, glob, or line range.')).toBeTruthy()
  expect(screen.getByText('Invalid regular expression: missing ).')).toBeTruthy()
  expect(screen.queryByText('Tool returned an error')).toBeNull()
})

it('names persisted task actions and distinguishes task status from action success', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([
    { id: 'create', type: 'tool', name: 'create_task', state: 'completed', input: { title: 'Write exporter script' },
      output: JSON.stringify({ id: 'task-1', title: 'Write exporter script', status: 'pending' }) },
    { id: 'create-other', type: 'tool', name: 'create_task', state: 'completed', input: { title: 'Render portable HTML' },
      output: JSON.stringify({ id: 'task-2', title: 'Render portable HTML', status: 'pending' }) },
    { id: 'update', type: 'tool', name: 'update_task', state: 'completed', input: { task_id: 'task-1', status: 'in_progress' },
      output: JSON.stringify({ id: 'task-1', title: 'Write exporter script', status: 'in_progress' }) },
  ])} />)
  const create = screen.getByRole('button', { name: 'create task Write exporter script Task: pending' })
  const update = screen.getByRole('button', { name: 'update task Write exporter script Task: in progress' })
  expect(create.getAttribute('aria-expanded')).toBe('false')
  expect(update.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByRole('button', { name: 'create task Render portable HTML Task: pending' })).toBeTruthy()
  fireEvent.click(screen.getByText('Activity · 3 actions'))
  const rows = screen.getAllByRole('listitem')
  expect(rows[2].textContent).toContain('Write exporter script')
  expect(within(rows[2]).getByText('Task: in progress')).toBeTruthy()
  expect(within(rows[2]).getByText('Action: completed')).toBeTruthy()
})

it('resolves task IDs for running and failed updates without claiming the requested status succeeded', () => {
  const events: AgentEvent[] = [
    { id: 'create', type: 'tool', name: 'create_task', state: 'completed', input: { title: 'Verify exported HTML' },
      output: JSON.stringify({ id: 'task-1', status: 'pending' }) },
    { id: 'update', type: 'tool', name: 'update_task', state: 'running', input: { task_id: 'task-1', status: 'completed' }, output: '' },
  ]
  const view = render(<Conversation onError={vi.fn()} session={makeSession(events)} />)
  expect(screen.getByRole('button', { name: 'update task Verify exported HTML' })).toBeTruthy()
  expect(screen.queryByText('Task: completed')).toBeNull()
  view.rerender(<Conversation onError={vi.fn()} session={makeSession([events[0], { ...events[1], state: 'error', output: 'Complete dependencies first.' }])} />)
  fireEvent.click(screen.getByRole('button', { name: 'update task Verify exported HTML' }))
  expect(screen.getByLabelText('Output').textContent).toBe('Complete dependencies first.')
  expect(screen.queryByText('Task: completed')).toBeNull()
})

it('shows the complete Python command and its options separately from output only after expansion', () => {
  const command = `python - <<'PY'\n# ${'script content '.repeat(50)}\nprint('Export ready')\nPY`
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'python', type: 'tool', name: 'run_command', state: 'completed', input: { command, timeout_seconds: 90 }, output: 'Export ready',
  }])} />)
  expect(screen.queryByLabelText('Command')).toBeNull()
  expect(screen.queryByLabelText('Output')).toBeNull()
  const heading = screen.getByRole('button', { name: /run command/ })
  expect(heading.textContent!.length).toBeLessThan(270)
  fireEvent.click(heading)
  expect(screen.getByLabelText('Command').textContent).toBe(command)
  expect(screen.getByLabelText('Options').textContent).toContain('"timeout_seconds": 90')
  expect(screen.getByLabelText('Output').textContent).toBe('Export ready')
  fireEvent.click(heading)
  expect(screen.queryByLabelText('Command')).toBeNull()
  expect(screen.queryByLabelText('Output')).toBeNull()
})

it('retains tool input after completion even when the tool returns no output', () => {
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'write', type: 'tool', name: 'write_file', state: 'completed', input: { path: 'result.txt', content: 'Report contents' }, output: '',
  }])} />)
  fireEvent.click(screen.getByRole('button', { name: 'write file result.txt' }))
  expect(screen.getByLabelText('Input').textContent).toContain('Report contents')
  expect(screen.getByLabelText('Output').textContent).toBe('No output.')
})

it('keeps the command and approval details visible while sending the original approval decision', async () => {
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
  const command = "python -c \"print('ready')\""
  const preview = `${command}\n\nTimeout: 60 seconds · Output limit: 80000 bytes\nForeground command: Stop response also stops this job.`
  render(<Conversation onError={vi.fn()} session={makeSession([{
    id: 'approval', type: 'tool', name: 'run_command', state: 'pending', input: { command }, preview,
  }])} />)
  expect(screen.getByLabelText('Command').textContent).toBe(preview)
  expect(screen.queryByLabelText('Output')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/sessions/parent/approvals/approval', expect.objectContaining({ method: 'POST', body: '{"allowed":true}' })))
})

it.each(['notice', 'user'] as const)('navigates from a %s child link and back to the parent conversation', type => {
  const parent = makeSession([{ id: 'link', type, text: 'Delegated parser review.', child_session_id: 'child' }])
  const child = makeSession([{ id: 'child-reply', type: 'assistant', text: 'Child findings.' }], {
    id: 'child', title: 'Child task', parent_session_id: parent.id, is_subagent: true,
  })
  function Navigation() {
    const [active, setActive] = useState(parent)
    return <Conversation key={active.id} session={active} onError={vi.fn()} onSelectSession={id => setActive(id === 'child' ? child : parent)} />
  }
  render(<Navigation />)
  expect(screen.queryByRole('button', { name: 'Back to parent conversation' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open subagent' }))
  expect(screen.getByText('Child findings.')).toBeTruthy()
  expect(screen.queryByText('Delegated parser review.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to parent conversation' }))
  expect(screen.getByText('Delegated parser review.')).toBeTruthy()
  expect(screen.queryByText('Child findings.')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Open subagent' })).toHaveLength(1)
})
