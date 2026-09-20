import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, Copy, FileText, LoaderCircle, Terminal, X } from 'lucide-react'
import { api } from '../api'
import type { AgentEvent, RequestInfo, Session } from '../types'
import { Brand } from './Sidebar'
import RequestDetails from './RequestDetails'

type ToolSummary = { subject: string; taskStatus?: string }

function summarizeTools(events: AgentEvent[]) {
  const taskTitles = new Map<string, string>()
  const summaries = new Map<string, ToolSummary>()
  for (const event of events) {
    if (event.type !== 'tool') continue
    const input = event.input || {}
    let subject = String(input.path || input.file_path || input.command || input.query || input.task || input.title || '')
    let taskStatus: string | undefined
    if (event.name === 'create_task' || event.name === 'update_task') {
      let task: Record<string, unknown> = {}
      try {
        const result: unknown = JSON.parse(event.output || '{}')
        if (result && typeof result === 'object' && !Array.isArray(result)) task = result as Record<string, unknown>
      } catch { /* Older or failed events can contain plain-text output. */ }
      subject = String(task.title || input.title || taskTitles.get(String(input.task_id)) || input.task_id || '')
      if (event.state === 'completed') {
        if (typeof task.id === 'string' && subject) taskTitles.set(task.id, subject)
        const status = task.status || input.status
        if (typeof status === 'string') taskStatus = status.replace(/_/g, ' ')
      }
    }
    summaries.set(event.id, { subject: subject.slice(0, 240).replace(/\s+/g, ' '), taskStatus })
  }
  return summaries
}

function ToolDetails({ event, pending }: { event: AgentEvent; pending: boolean }) {
  const { command, ...options } = event.input || {}
  const hasCommand = typeof command === 'string'
  return <>
    <p className="tool-detail-label">{hasCommand ? 'Command' : 'Input'}</p>
    <pre aria-label={hasCommand ? 'Command' : 'Input'}>{hasCommand ? (pending && event.preview ? event.preview : command) : JSON.stringify(event.input || {}, null, 2)}</pre>
    {hasCommand && Object.keys(options).length && !(pending && event.preview) ? <><p className="tool-detail-label">Options</p><pre aria-label="Options">{JSON.stringify(options, null, 2)}</pre></> : null}
    {pending && !hasCommand && event.preview ? <><p className="tool-detail-label">Approval preview</p><pre aria-label="Approval preview">{event.preview}</pre></> : null}
    {!pending || event.output ? <><p className="tool-detail-label">Output</p><pre aria-label="Output">{event.output || (event.state === 'running' ? 'Waiting for output…' : 'No output.')}</pre></> : null}
  </>
}

function DelegationStatus({ event, onSelectSession }: { event: AgentEvent; onSelectSession?: (id: string) => void }) {
  const progress = event.delegation
  if (!progress) return null
  const status = progress.status === 'awaiting_approval' ? 'Waiting for approval' : progress.status.replace(/_/g, ' ')
  return <div className="delegation-progress" aria-label="Subagent progress">
    <span>Subagent: {status}</span><span>{progress.completed_tools} completed {progress.completed_tools === 1 ? 'action' : 'actions'}</span>
    {progress.last_tool ? <span>Last tool: {progress.last_tool.replace(/_/g, ' ')}</span> : null}
    {progress.terminal_reason ? <span>Reason: {progress.terminal_reason.replace(/_/g, ' ')}</span> : null}
    {event.child_session_id && onSelectSession ? <button className="outline" onClick={() => onSelectSession(event.child_session_id!)}>Open subagent</button> : null}
  </div>
}

const ToolCard = memo(function ToolCard({ event, summary, sessionId, onError, onSelectSession }: { event: AgentEvent; summary: ToolSummary; sessionId: string; onError: (error: string) => void; onSelectSession?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const pending = event.state === 'pending'
  const title = (event.name || 'Tool').replace(/_/g, ' ')
  const isTask = event.name === 'create_task' || event.name === 'update_task'
  const decide = async (allowed: boolean) => {
    setDeciding(true)
    try { await api(`/sessions/${sessionId}/approvals/${event.id}`, 'POST', { allowed }) }
    catch (e) { onError((e as Error).message) }
    finally { setDeciding(false) }
  }
  return <div className={`tool-card ${isTask ? 'tool-task' : ''} ${pending ? 'needs-approval' : ''}`}>
    <button className="tool-heading" onClick={() => setExpanded(v => !v)} aria-expanded={expanded || pending}
      aria-label={[title, summary.subject, summary.taskStatus ? `Task: ${summary.taskStatus}` : ''].filter(Boolean).join(' ')}>
      {event.name?.toLowerCase().includes('command') || event.name === 'Bash' ? <Terminal size={16} /> : <FileText size={16} />}
      <span className="tool-name">{title}</span><span className="tool-subject" title={summary.subject}>{summary.subject}</span>
      {summary.taskStatus ? <span className="tool-task-status">Task: {summary.taskStatus}</span> : null}
      {event.state === 'running' ? <LoaderCircle size={14} className="spin" /> : event.state === 'completed' ? <Check size={14} className="success-icon" /> : null}
      {expanded || pending ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    <DelegationStatus event={event} onSelectSession={onSelectSession} />
    {expanded || pending ? <div className="tool-body">
      {pending ? <><p>Local needs your approval to {title.toLowerCase()}.</p>
        <ToolDetails event={event} pending />
        <div className="approval-buttons"><button className="outline" disabled={deciding} onClick={() => void decide(false)}><X size={15} />Decline</button>
          <button className="primary" disabled={deciding} onClick={() => void decide(true)}><Check size={15} />Approve</button></div>
      </> : <><ToolDetails event={event} pending={false} /><small className="muted">Action: {event.state}</small></>}
    </div> : null}
    {!expanded && (event.state === 'rejected' || event.state === 'cancelled' || event.state === 'error') ? <p className="tool-outcome">{event.state === 'rejected' ? 'Action declined' : event.state === 'cancelled' ? 'Action cancelled' : 'Tool returned an error'}</p> : null}
  </div>
})

const Reply = memo(function Reply({ text, reasoning, truncated, requestInfo }: { text: string; reasoning?: string; truncated?: boolean; requestInfo?: RequestInfo }) {
  const [copied, setCopied] = useState(false)
  return <div className="assistant-reply"><Brand small />
    <div className="reply-content">{reasoning ? <details className="reasoning-summary"><summary>Provider reasoning summary</summary>
      <p className="muted">Supplied by the model endpoint.</p><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoning}</ReactMarkdown></div>
      {truncated ? <p className="muted">Summary display limit reached.</p> : null}</details> : null}<div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
      {text ? <button className="copy-button icon-button" aria-label="Copy response" onClick={() => {
        void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button> : null}
      {requestInfo ? <RequestDetails info={requestInfo} /> : null}
    </div></div>
})

export default function Conversation({ session, onError, onSelectSession }: { session: Session; onError: (error: string) => void; onSelectSession?: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const toolSummaries = useMemo(() => summarizeTools(session.events), [session.events])
  const last = session.events[session.events.length - 1]
  useEffect(() => { if (follow.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [session.events.length, last?.text, last?.state])
  useEffect(() => { follow.current = true; bottom.current?.scrollIntoView({ block: 'end' }) }, [session.id])
  return <div className="transcript" ref={container} onScroll={() => {
    const el = container.current
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }}><div className="transcript-inner">
    {session.events.some(event => event.type === 'tool') ? <details className="activity-summary"><summary>Activity · {session.events.filter(event => event.type === 'tool').length} actions</summary>
      <ol>{session.events.filter(event => event.type === 'tool').map(event => {
        const summary = toolSummaries.get(event.id)!
        return <li key={event.id}><span>{(event.name || 'Tool').replace(/_/g, ' ')}</span>{summary.subject ? <span className="activity-subject"> · {summary.subject}</span> : null}
          {summary.taskStatus ? <small>Task: {summary.taskStatus}</small> : null}<small>Action: {event.state}</small></li>
      })}</ol>
    </details> : null}
    {session.parent_session_id && onSelectSession ? <button className="outline parent-conversation" onClick={() => onSelectSession(session.parent_session_id!)}>Back to parent conversation</button> : null}
    {session.events.map(event => {
      if (event.type === 'user') return <div className="user-message" key={event.id}>{event.origin?.kind === 'delegated' ? <small className="delegation-origin">Delegated by parent conversation</small> : null}{event.text}{event.child_session_id && onSelectSession ? <button className="outline" onClick={() => onSelectSession(event.child_session_id!)}>Open subagent</button> : null}</div>
      if (event.type === 'tool') return <ToolCard key={event.id} event={event} summary={toolSummaries.get(event.id)!} sessionId={session.id} onError={onError} onSelectSession={onSelectSession} />
      if (event.type === 'assistant') return event.text || event.reasoning_summary || event.request_info ? <Reply key={event.id} text={event.text || ''} reasoning={event.reasoning_summary} truncated={event.reasoning_truncated} requestInfo={event.request_info} /> : null
      return <div className={`conversation-notice ${event.type === 'error' ? 'error' : ''}`} key={event.id}>{event.text}<DelegationStatus event={event} onSelectSession={onSelectSession} />{!event.delegation && event.child_session_id && onSelectSession ? <button className="outline" onClick={() => onSelectSession(event.child_session_id!)}>Open subagent</button> : null}</div>
    })}
    {['running', 'delegating'].includes(session.status) ? <div className="working-indicator"><span /><span /><span /><span className="sr-only">Working</span></div> : null}
    <div ref={bottom} />
  </div></div>
}
