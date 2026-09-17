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
        <p className="field-help">Set at or below your endpoint limit. Applies on the next turn.</p>
        <label>Credential file<input value={form.env_file} onChange={e => field('env_file', e.target.value)} placeholder="/path/to/env_vars.txt" /></label>
        <p className="field-help">Read on the server. Use DBRICKS_URL and DBRICKS_TOKEN assignments. Environment variables also work.</p>
        <p className="settings-note">Project and model changes apply to new conversations. Use Folder access above the chat input to allow additional folders. Commands run according to your selected permission mode.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
      </form>
    </div>
  </dialog>
}
