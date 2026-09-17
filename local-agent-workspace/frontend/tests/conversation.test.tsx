import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Conversation from '../src/components/Conversation'
import type { AgentEvent, Session } from '../src/types'

const makeSession = (events: AgentEvent[], overrides: Partial<Session> = {}): Session => ({
  id: 'parent', title: 'Parent task', workspace: '/project', model: 'test-model', status: 'idle',
  events, updated: 1, permission_mode: 'manual', allowed_directories: [], ...overrides,
})
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
    expect(within(rows[index]).getByText(state)).toBeTruthy()
  })
  view.rerender(<Conversation onError={vi.fn()} session={makeSession(events.map(event => ({ ...event, state: 'completed' })))} />)
  expect(within(details).getAllByText('completed')).toHaveLength(6)
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  fireEvent.click(summary)
  expect(details.open).toBe(false)
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
