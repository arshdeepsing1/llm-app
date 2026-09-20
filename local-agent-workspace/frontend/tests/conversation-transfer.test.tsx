import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ConversationTransfer from '../src/components/ConversationTransfer'
import { setToken } from '../src/api'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let onSelectSession: ReturnType<typeof vi.fn<(id: string) => void>>
let onError: ReturnType<typeof vi.fn<(message: string) => void>>
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => json({ session: { id: 'new-copy' }, imported_count: 1 }))
  vi.stubGlobal('fetch', fetchMock)
  setToken('local-token')
  onSelectSession = vi.fn(); onError = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function view(busy = false, sessionId: string | undefined = 'source') {
  return <ConversationTransfer sessionId={sessionId} workspace="/chosen/workspace" busy={busy} onSelectSession={onSelectSession} onError={onError} />
}
function chooseFile(text = '{"format":"bundle"}') {
  const file = new File([text], 'conversation.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) })
  fireEvent.change(screen.getByLabelText('Conversation JSON file'), { target: { files: [file] } })
  return file
}

it('imports exact JSON text with authentication into the explicitly selected workspace', async () => {
  render(view())
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Import destination workspace' }).value).toBe('/chosen/workspace')
  const text = '{"source_workspace":"/old/machine","version":1,"version":2,"large":9007199254740993}'
  chooseFile(text)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '/new/project' } })
  fireEvent.click(screen.getByRole('button', { name: 'Import as new conversation' }))
  await waitFor(() => expect(onSelectSession).toHaveBeenCalledExactlyOnceWith('new-copy'))
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/sessions/import?workspace=%2Fnew%2Fproject', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': 'local-token' }, body: text,
  })
  expect(screen.getByText(/manual permissions, no folder grants, and no active skills/)).toBeTruthy()
})

it('rejects oversized files before reading them or sending a request', async () => {
  render(view())
  const file = chooseFile()
  Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 })
  fireEvent.click(screen.getByRole('button', { name: 'Import as new conversation' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Conversation file exceeds the 16 MiB limit.')
  expect(file.text).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(onSelectSession).not.toHaveBeenCalled()
})

it('reports rejected malformed imports and retains the selected file and workspace', async () => {
  fetchMock.mockResolvedValue(json({ detail: 'Conversation bundle contains duplicate JSON keys.' }, 400))
  render(view())
  chooseFile('{"version":1,"version":2}')
  fireEvent.click(screen.getByRole('button', { name: 'Import as new conversation' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Conversation bundle contains duplicate JSON keys.')
  expect(onError).toHaveBeenCalledExactlyOnceWith('Conversation bundle contains duplicate JSON keys.')
  expect(onSelectSession).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import as new conversation' }).disabled).toBe(false)
  expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('/chosen/workspace')
})

it('forks the full current conversation and selects only the new ID', async () => {
  fetchMock.mockResolvedValue(json({ id: 'fork-id' }))
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Fork completed conversation' }))
  await waitFor(() => expect(onSelectSession).toHaveBeenCalledExactlyOnceWith('fork-id'))
  expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/source/fork')
  expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
})

it('exports with the selected child scope and downloads the returned JSON without extra requests', async () => {
  const bundle = { format: 'local-agent-workspace.conversations', version: 1 }
  fetchMock.mockResolvedValue(json(bundle))
  const create = vi.fn(() => 'blob:conversation')
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(view())
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Export conversation' }))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Conversation file exported.')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/source/export?include_children=true')
  expect(create).toHaveBeenCalledOnce()
  expect(click).toHaveBeenCalledOnce()
  expect(revoke).toHaveBeenCalledWith('blob:conversation')
  expect(document.querySelector('a[download]')).toBeNull()
  expect(onSelectSession).not.toHaveBeenCalled()
})

it('prevents duplicate requests and disables actions while the conversation is busy', async () => {
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValue(new Promise(done => { resolve = done }))
  const rendered = render(view())
  const fork = screen.getByRole<HTMLButtonElement>('button', { name: 'Fork completed conversation' })
  fireEvent.click(fork); fireEvent.click(fork)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fork.disabled).toBe(true)
  resolve(json({ id: 'new-id' }))
  await waitFor(() => expect(onSelectSession).toHaveBeenCalled())
  rendered.rerender(view(true))
  expect(fork.disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Export conversation' }).disabled).toBe(true)
})

it('allows import without a selected conversation but disables export and fork', () => {
  render(<ConversationTransfer workspace="/default" onSelectSession={onSelectSession} onError={onError} />)
  chooseFile()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import as new conversation' }).disabled).toBe(false)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Export conversation' }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fork completed conversation' }).disabled).toBe(true)
})

it('ignores the completion of an import after the transfer panel is unmounted', async () => {
  let resolve!: (value: Response) => void
  fetchMock.mockReturnValue(new Promise(done => { resolve = done }))
  const rendered = render(view())
  chooseFile()
  fireEvent.click(screen.getByRole('button', { name: 'Import as new conversation' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
  rendered.unmount()
  resolve(json({ session: { id: 'created-after-close' }, imported_count: 1 }))
  await new Promise(done => setTimeout(done, 0))
  expect(onSelectSession).not.toHaveBeenCalled()
})
