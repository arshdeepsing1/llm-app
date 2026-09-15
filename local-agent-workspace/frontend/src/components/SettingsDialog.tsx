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
  const field = (key: keyof Settings, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))
  return <dialog ref={dialog} className="settings-dialog" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="dialog-content"><header><div><h2>Make yourself at home.</h2><p>Configure your local workspace.</p></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X /></button></header>
      <form onSubmit={e => { e.preventDefault(); setSaving(true); setError(''); void onSave(form).then(onClose).catch(e => setError(e.message)).finally(() => setSaving(false)) }}>
        <label>Project folder<input autoFocus value={form.workspace} required onChange={e => field('workspace', e.target.value)} placeholder="/path/to/project" /></label>
        <label>Agent runtime<select value={form.runtime} onChange={e => {
          const runtime = e.target.value as Settings['runtime']
          setForm(current => ({ ...current, runtime, model: runtime === settings.runtime ? settings.model : runtime === 'claude' ? '' : 'databricks-gpt-oss-120b' }))
        }}><option value="databricks">Databricks · local tool agent</option><option value="claude">Claude Agent SDK</option></select></label>
        <p className="field-help">{form.runtime === 'claude' ? 'Uses your SDK checkout and Claude Code runtime. Requires an accessible Claude model.' : 'A tool-calling agent for your Databricks models. Reads files, edits code, and runs approved commands.'}</p>
        <label>Model or model-service ID<input list="settings-models" required value={form.model} onChange={e => field('model', e.target.value)} placeholder={form.runtime === 'claude' ? 'system.ai.your-claude-model' : 'databricks-gpt-oss-120b'} /></label>
        <datalist id="settings-models">{form.runtime === settings.runtime ? connection?.models.map(m => <option key={m} value={m}>{modelLabel(m)}</option>) : null}</datalist>
        <label>Credential file<input value={form.env_file} onChange={e => field('env_file', e.target.value)} placeholder="/path/to/env_vars.txt" /></label>
        <p className="field-help">Read on the server. Use DBRICKS_URL and DBRICKS_TOKEN assignments. Environment variables also work.</p>
        {form.runtime === 'claude' ? <div className="sdk-settings">
          <label>Claude CLI path<input value={form.claude_cli_path} onChange={e => field('claude_cli_path', e.target.value)} placeholder="Leave blank to use bundled or installed CLI" /></label>
          <label>MCP configuration file<input value={form.claude_mcp_config} onChange={e => field('claude_mcp_config', e.target.value)} placeholder="Optional /path/to/mcp.json" /></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.claude_skills} onChange={e => field('claude_skills', e.target.checked)} />Load project skills and instructions</label>
        </div> : null}
        <p className="settings-note">Changes apply to new conversations. Use Folder access above the chat input to allow additional folders. Commands run according to your selected permission mode.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer><button type="button" className="outline" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
      </form>
    </div>
  </dialog>
}
