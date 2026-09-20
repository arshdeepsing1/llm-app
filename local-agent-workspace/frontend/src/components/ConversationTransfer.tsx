import { useEffect, useRef, useState } from 'react'
import { api, apiJsonText } from '../api'

type Props = {
  sessionId?: string; workspace: string; busy?: boolean;
  onSelectSession: (id: string) => void; onError: (message: string) => void;
}
const MAX_BYTES = 16 * 1024 * 1024

export default function ConversationTransfer({ sessionId, workspace, busy = false, onSelectSession, onError }: Props) {
  const [destination, setDestination] = useState(workspace)
  const [file, setFile] = useState<File | null>(null)
  const [includeChildren, setIncludeChildren] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const disabled = busy || pending

  async function run(operation: () => Promise<void>) {
    if (busy || inFlight.current) return
    inFlight.current = true
    setPending(true); setError(''); setNotice('')
    try { await operation() } catch (e) {
      if (alive.current) { const message = (e as Error).message; setError(message); onError(message) }
    } finally { inFlight.current = false; if (alive.current) setPending(false) }
  }

  return <section className="agent-tools-section" aria-label="Conversation transfer">
    <h3>Export, import, and fork</h3>
    <p>Conversation files include messages, tool output, summaries, and reported usage, which may contain private data or pasted secrets. Review before sharing. Credential/settings files, file checkpoints, task-board records, and managed jobs are not copied.</p>
    <div className="agent-tools-actions">
      <button className="outline" disabled={disabled || !sessionId} onClick={() => void run(async () => {
        const bundle = await api<unknown>(`/sessions/${encodeURIComponent(sessionId!)}/export?include_children=${includeChildren}`)
        if (!alive.current) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url; link.download = `conversation-${sessionId}.json`
        document.body.appendChild(link)
        try { link.click() } finally { link.remove(); URL.revokeObjectURL(url) }
        setNotice('Conversation file exported.')
      })}>Export conversation</button>
      <button className="outline" disabled={disabled || !sessionId} onClick={() => void run(async () => {
        const created = await api<{ id: string }>(`/sessions/${encodeURIComponent(sessionId!)}/fork`, 'POST')
        if (alive.current) onSelectSession(created.id)
      })}>Fork completed conversation</button>
    </div>
    <label className="agent-tools-task"><input type="checkbox" disabled={disabled || !sessionId} checked={includeChildren} onChange={e => setIncludeChildren(e.target.checked)} />Include subagent conversations in export (up to 32 total)</label>
    <p className="field-help">Fork copies the full completed conversation into the same workspace. It does not copy child conversations or modify the source. Stop any active response before exporting or forking.</p>
    <form className="agent-tools-form" onSubmit={e => { e.preventDefault(); void run(async () => {
      if (!file) throw new Error('Choose a conversation JSON file.')
      if (file.size > MAX_BYTES) throw new Error('Conversation file exceeds the 16 MiB limit.')
      const text = await file.text()
      const result = await apiJsonText<{ session: { id: string }; imported_count: number }>(`/sessions/import?workspace=${encodeURIComponent(destination.trim())}`, text)
      if (alive.current) onSelectSession(result.session.id)
    }) }}>
      <label>Conversation JSON file<input type="file" accept=".json,application/json" disabled={disabled} onChange={e => setFile(e.target.files?.[0] || null)} /></label>
      <label>Import destination workspace<input required disabled={disabled} value={destination} onChange={e => setDestination(e.target.value)} placeholder="/absolute/path/to/project" /></label>
      <p className="field-help">Each import creates a new copy in this selected folder, never overwrites an existing conversation, and starts with manual permissions, no folder grants, and no active skills. Imported paths and tool requests are historical data; nothing is executed during import.</p>
      <button className="primary" disabled={disabled || !file || !destination.trim()}>Import as new conversation</button>
    </form>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </section>
}
