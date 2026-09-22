import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Connection, Settings } from '../types'
import { modelLabel } from '../types'

export default function SettingsDialog({ settings, connection, onSave, onClose }: {
  settings: Settings; connection: Connection | null; onSave: (settings: Settings) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputBudget = form.context_window - form.max_output_tokens - 2048
  const claudeQuotaExceeded = form.model === 'databricks-claude-opus-4-8' && form.max_output_tokens > 20000
  const claudeQuotaConsumed = form.model === 'databricks-claude-opus-4-8' && form.max_output_tokens === 20000
  useEffect(() => { dialog.current?.showModal() }, [])
  const field = (key: 'workspace' | 'model' | 'env_file', value: string) => setForm(current => ({ ...current, [key]: value }))
  return <dialog ref={dialog} className="settings-dialog" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="dialog-content"><header><div><h2>Make yourself at home.</h2><p>Configure your local workspace.</p></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X /></button></header>
      <form onSubmit={e => { e.preventDefault(); setSaving(true); setError(''); void onSave(form).then(onClose).catch(e => setError(e.message)).finally(() => setSaving(false)) }}>
        <label>Project folder<input autoFocus value={form.workspace} required onChange={e => field('workspace', e.target.value)} placeholder="/path/to/project" /></label>
        <p className="field-help">A tool-calling agent for your Databricks models. Reads files, edits code, and runs approved commands.</p>
        <label>Databricks model endpoint<input list="settings-models" required value={form.model} onChange={e => field('model', e.target.value)} placeholder="databricks-gpt-oss-120b" /></label>
        <datalist id="settings-models">{connection?.models.map(m => <option key={m} value={m}>{modelLabel(m)}</option>)}</datalist>
        <label>Context budget (tokens)<input type="number" required min={16384} max={1048576} step={1}
          value={form.context_window || ''} onChange={e => setForm(current => ({ ...current, context_window: Number(e.target.value) }))} /></label>
        <p className="field-help">Set at or below your endpoint's total context limit, not your account usage quota. We reserve the output budget below plus 2,048 tokens for safety; the remainder is the estimated input budget. Applies on the next turn.</p>
        <label>Max output tokens per request<input type="number" required min={1024} max={131072} step={1}
          value={form.max_output_tokens || ''} onChange={e => setForm(current => ({ ...current, max_output_tokens: Number(e.target.value) }))} /></label>
        <p className="field-help">The endpoint must support this value. A larger response budget leaves less context for input and can increase usage. Current estimated input budget: {inputBudget.toLocaleString()} tokens.</p>
        {inputBudget < 16384 ? <p className="form-error" role="alert">This leaves too little room for a working conversation. Lower Max output tokens or increase the context budget; raising output does not fix a full context.</p> : null}
        {claudeQuotaExceeded ? <p className="form-error" role="alert">Standard Databricks Claude Opus 4.8 pay-per-token quota reserves max_tokens against a 20,000 output-tokens-per-minute limit. Use 20,000 or less unless your workspace quota is higher.</p> : null}
        {claudeQuotaConsumed ? <p className="settings-note" role="status">A 20,000-token request reserves the full standard Claude Opus 4.8 output-per-minute quota. It is useful for a single long response, but follow-up agent and tool steps can receive 429 responses until earlier output leaves the rolling window. The 8,192 default leaves room for multi-step work.</p> : null}
        <label>Agent steps per message<input type="number" required min={1} max={64} step={1}
          value={form.max_agent_steps || ''} onChange={e => setForm(current => ({ ...current, max_agent_steps: Number(e.target.value) }))} /></label>
        <p className="field-help">Limits model round trips for one message, not individual tool calls. One model response can request several tools. The default is 32.</p>
        <label>Credential file<input value={form.env_file} onChange={e => field('env_file', e.target.value)} placeholder="/path/to/env_vars.txt" /></label>
        <p className="field-help">Read on the server. Use DBRICKS_URL and DBRICKS_TOKEN assignments. Environment variables also work.</p>
        <p className="settings-note">Project and model changes apply to new conversations. Use Folder access above the chat input to allow additional folders. Commands run according to your selected permission mode.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
      </form>
    </div>
  </dialog>
}
