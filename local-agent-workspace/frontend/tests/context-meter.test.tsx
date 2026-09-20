import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ContextMeter from '../src/components/ContextMeter'
import type { ContextInfo } from '../src/types'

const info: ContextInfo = {
  estimated_tokens: 6000, input_budget: 22768, context_window: 33008, reply_reserve: 8192,
  compactions: 1, summarized_messages: 4, estimate_method: 'weighted_utf8',
  instruction_files: ['AGENTS.md'], warnings: [],
}

const contextInfo: ContextInfo = {
  estimated_tokens: 6000, input_budget: 120832, context_window: 131072, reply_reserve: 8192,
  compactions: 1, summarized_messages: 6, estimate_method: 'weighted_utf8', instruction_files: [], warnings: [],
}

afterEach(cleanup)

it('shows the approximate input breakdown and actual input-budget compaction threshold', () => {
  render(<ContextMeter info={{ ...contextInfo, breakdown: {
    system_instructions: 1000, tool_definitions: 2000, messages_and_results: 2500, summary: 400, request_overhead: 100,
  } }} />)
  const summary = screen.getByText('Last model input · ~5%').closest('summary')!
  expect(summary.closest('details')!.open).toBe(false)
  fireEvent.click(summary)
  expect(screen.getByText('Approximate input breakdown')).toBeTruthy()
  for (const [label, value] of [['System instructions', '~1,000 tokens'], ['Tool definitions', '~2,000 tokens'], ['Messages and tool results', '~2,500 tokens'], ['Conversation summary', '~400 tokens'], ['Request overhead', '~100 tokens']]) {
    expect(screen.getByText(label).nextElementSibling?.textContent).toBe(value)
  }
  expect(screen.getByText('Approximately 6,000 of 120,832 input tokens used.')).toBeTruthy()
  expect(screen.getByText('Automatic compaction threshold: approximately 120,832 input tokens.')).toBeTruthy()
  expect(screen.getByText('Compactions: 1. Messages summarized: 6.')).toBeTruthy()
})

it('shows a zero-token summary and does not fabricate a breakdown for saved records', () => {
  const view = render(<ContextMeter info={{ ...contextInfo, breakdown: {
    system_instructions: 1000, tool_definitions: 2000, messages_and_results: 2900, summary: 0, request_overhead: 100,
  } }} />)
  fireEvent.click(screen.getByText('Last model input · ~5%'))
  expect(screen.getByText('Conversation summary').nextElementSibling?.textContent).toBe('~0 tokens')
  view.rerender(<ContextMeter info={contextInfo} />)
  expect(screen.queryByText('Approximate input breakdown')).toBeNull()
  expect(screen.getByText('Automatic compaction threshold: approximately 120,832 input tokens.')).toBeTruthy()
})

it('keeps legacy byte estimates marked outdated instead of presenting an approximate breakdown', () => {
  render(<ContextMeter info={{ ...contextInfo, estimate_method: 'conservative_utf8' }} />)
  fireEvent.click(screen.getByText('Last model input · estimate outdated'))
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByText('Approximate input breakdown')).toBeNull()
  expect(screen.getByText(/The saved meter counted bytes as tokens/)).toBeTruthy()
})

it('shows instruction source scopes, estimated costs, and omitted reasons without adding usage', () => {
  render(<ContextMeter info={{ ...info, instruction_sources: [
    { path: 'AGENTS.md', scope: '.', status: 'loaded', estimated_tokens: 54 },
    { path: 'nested/CLAUDE.md', scope: 'nested', status: 'omitted', estimated_tokens: 0, reason: 'Instruction limit exceeded.' },
  ] }} />)
  fireEvent.click(screen.getByText(/Last model input/))
  expect(screen.getByText('AGENTS.md').closest('li')?.textContent).toContain('scope: . and descendants · ~54 tokens')
  expect(screen.getByText('nested/CLAUDE.md').closest('li')?.textContent).toContain('scope: nested and descendants · Omitted · 0 tokens loaded')
  expect(screen.getByText('Instruction limit exceeded.')).toBeTruthy()
  expect(screen.getByText(/File costs are estimates included in system instructions above/)).toBeTruthy()
  expect(screen.getByText('Approximately 6,000 of 22,768 input tokens used.')).toBeTruthy()
})

it('submits an optional preservation note once and prevents duplicate requests', async () => {
  let resolve!: () => void
  const onCompact = vi.fn(() => new Promise<void>(done => { resolve = done }))
  render(<ContextMeter info={info} onCompact={onCompact} />)
  fireEvent.click(screen.getByText(/Last model input/))
  fireEvent.change(screen.getByRole('textbox', { name: 'Preservation note (optional)' }), { target: { value: '  Keep migration decisions  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Compact now' }))
  expect(onCompact).toHaveBeenCalledExactlyOnceWith('Keep migration decisions')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Starting compaction…' }).disabled).toBe(true)
  resolve()
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Compact now' }).disabled).toBe(false))
})

it('shows rejected requests and keeps the note available to retry', async () => {
  const onCompact = vi.fn().mockRejectedValue(new Error('No earlier turns to compact.'))
  render(<ContextMeter info={info} onCompact={onCompact} />)
  fireEvent.click(screen.getByText(/Last model input/))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep decisions' } })
  fireEvent.click(screen.getByRole('button', { name: 'Compact now' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No earlier turns to compact.')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('Keep decisions')
})

it('disables compaction while busy and labels the prepared context as a preview', () => {
  const onCompact = vi.fn()
  render(<ContextMeter info={{ ...info, prepared_for_next_turn: true }} busy onCompact={onCompact} />)
  fireEvent.click(screen.getByText(/Context preview/))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Compact now' }).disabled).toBe(true)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').disabled).toBe(true)
  expect(screen.getByText(/Preview after compaction using saved tool definitions/)).toBeTruthy()
  expect(screen.queryByText(/Last model input/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Compact now' }))
  expect(onCompact).not.toHaveBeenCalled()
})
