import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Code2, Folder, Pencil, Plus, Settings as SettingsIcon, Trash2, X } from 'lucide-react'
import type { Connection, Session, Settings } from '../types'

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand-symbol ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>
}

type Props = {
  settings: Settings | null; connection: Connection | null; sessions: Session[]; activeId: string | null;
  open: boolean; close: () => void; onNew: () => void; onSelect: (id: string) => void;
  onSettings: () => void; onDelete: (id: string) => void; onRename: (id: string, title: string) => Promise<void>;
}

function ConversationRow({ session, selected, onSelect, onDelete, onRename }: {
  session: Session; selected: boolean; onSelect: () => void; onDelete: () => void;
  onRename: (id: string, title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const renameButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      renameButton.current?.focus()
      restoreFocus.current = false
    }
  }, [editing])
  const finish = () => { restoreFocus.current = true; setEditing(false) }
  const save = async () => {
    if (saving || !title.trim()) return
    setSaving(true); setError('')
    try { await onRename(session.id, title); finish() }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not rename this conversation.') }
    finally { setSaving(false) }
  }
  return <div className={`conversation-row ${selected ? 'selected' : ''}`}>
    {editing ? <form className="conversation-rename" aria-label={`Rename ${session.title}`} aria-busy={saving}
      onSubmit={event => { event.preventDefault(); void save() }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (!saving) finish() } }}>
      <label htmlFor={`rename-${session.id}`}>Conversation name</label>
      <input id={`rename-${session.id}`} autoFocus required maxLength={160} value={title} disabled={saving}
        aria-invalid={!!error} aria-describedby={error ? `rename-error-${session.id}` : undefined}
        onFocus={event => event.currentTarget.select()} onChange={event => { setTitle(event.target.value); setError('') }} />
      <div><button type="submit" className="primary" disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save name'}</button>
        <button type="button" className="outline" disabled={saving} onClick={finish}>Cancel rename</button></div>
      {error ? <p id={`rename-error-${session.id}`} className="form-error" role="alert">{error}</p> : null}
    </form> : <>
      <button onClick={onSelect} title={`${session.title}\nSession: ${session.id}`} aria-current={selected ? 'page' : undefined}>
        {session.status !== 'idle' ? <span className="activity-dot" /> : null}<span>{session.title}<small className="session-id"> · {session.id.slice(0, 8)}</small></span>
      </button>
      <button ref={renameButton} className="rename-session" aria-label={`Rename ${session.title}`} title="Rename conversation"
        onClick={() => { setTitle(session.title); setError(''); setEditing(true) }}><Pencil size={14} /></button>
      <button className="delete-session" aria-label={`Delete ${session.title}`} onClick={() => {
        if (confirm('Delete this conversation? Your project files will remain.')) onDelete()
      }}><Trash2 size={14} /></button>
    </>}
  </div>
}

export default function Sidebar(props: Props) {
  const folder = props.settings?.workspace.split('/').filter(Boolean).pop() || 'Choose a project'
  return <>
    {props.open ? <button className="sidebar-scrim" aria-label="Close sidebar" onClick={props.close} /> : null}
    <aside className={`sidebar ${props.open ? 'visible' : ''}`}>
      <div className="brand"><Brand /><div><span>Local</span></div><span className="code-label"><Code2 size={17} />Code</span>
        <button className="icon-button mobile-only" onClick={props.close} aria-label="Close sidebar"><X /></button>
      </div>
      <button className="new-conversation outline" aria-label="New conversation" onClick={() => { props.onNew(); props.close() }}><Plus />New</button>
      <button className="project-button" onClick={props.onSettings} title={props.settings?.workspace}>
        <Folder /><span>{folder}</span><ArrowLeftRight size={15} />
      </button>
      <div className="conversation-list">
        <p className="section-label">Conversations</p>
        {props.sessions.length === 0 ? <p className="empty-sessions">Your conversations will appear here.</p> :
          props.sessions.map(s => <ConversationRow key={s.id} session={s} selected={props.activeId === s.id}
            onSelect={() => { props.onSelect(s.id); props.close() }} onDelete={() => props.onDelete(s.id)} onRename={props.onRename} />)}
      </div>
      <footer className="sidebar-footer">
        <button className="settings-button" onClick={props.onSettings}><SettingsIcon />Settings</button>
        <div className="connection-state" title={props.connection?.error || props.settings?.host || 'Checking connection'}>
          <span className={`status-dot ${props.connection?.connected ? 'connected' : props.connection ? 'disconnected' : ''}`} />
          {props.connection === null ? 'Checking Databricks…' : props.connection.connected ? 'Databricks connected' : 'Connection needs attention'}
        </div>
      </footer>
    </aside>
  </>
}
