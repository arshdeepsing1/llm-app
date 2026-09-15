import { ArrowLeftRight, Code2, Folder, Plus, Settings as SettingsIcon, Trash2, X } from 'lucide-react'
import type { Connection, Session, Settings } from '../types'

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand-symbol ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>
}

type Props = {
  settings: Settings | null; connection: Connection | null; sessions: Session[]; activeId: string | null;
  open: boolean; close: () => void; onNew: () => void; onSelect: (id: string) => void;
  onSettings: () => void; onDelete: (id: string) => void;
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
          props.sessions.map(s => <div className={`conversation-row ${props.activeId === s.id ? 'selected' : ''}`} key={s.id}>
            <button onClick={() => { props.onSelect(s.id); props.close() }} title={`${s.title}\nSession: ${s.id}`} aria-current={props.activeId === s.id ? 'page' : undefined}>
              {s.status !== 'idle' ? <span className="activity-dot" /> : null}<span>{s.title}<small className="session-id"> · {s.id.slice(0, 8)}</small></span>
            </button>
            <button className="delete-session" aria-label={`Delete ${s.title}`} onClick={() => {
              if (confirm('Delete this conversation? Your project files will remain.')) props.onDelete(s.id)
            }}><Trash2 size={14} /></button>
          </div>)}
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
