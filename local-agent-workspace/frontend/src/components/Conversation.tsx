import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, ChevronRight, Copy, FileText, LoaderCircle, Terminal, X } from 'lucide-react'
import { api } from '../api'
import type { AgentEvent, Session } from '../types'
import { Brand } from './Sidebar'

const ToolCard = memo(function ToolCard({ event, sessionId, onError }: { event: AgentEvent; sessionId: string; onError: (error: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const pending = event.state === 'pending'
  const title = (event.name || 'Tool').replace(/_/g, ' ')
  const input = event.input || {}
  const subject = String(input.path || input.file_path || input.command || input.query || '')
  const decide = async (allowed: boolean) => {
    setDeciding(true)
    try { await api(`/sessions/${sessionId}/approvals/${event.id}`, 'POST', { allowed }) }
    catch (e) { onError((e as Error).message) }
    finally { setDeciding(false) }
  }
  return <div className={`tool-card ${pending ? 'needs-approval' : ''}`}>
    <button className="tool-heading" onClick={() => setExpanded(v => !v)} aria-expanded={expanded || pending}>
      {event.name?.toLowerCase().includes('command') || event.name === 'Bash' ? <Terminal size={16} /> : <FileText size={16} />}
      <span className="tool-name">{title}</span><span className="tool-subject">{subject}</span>
      {event.state === 'running' ? <LoaderCircle size={14} className="spin" /> : event.state === 'completed' ? <Check size={14} className="success-icon" /> : null}
      {expanded || pending ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    {expanded || pending ? <div className="tool-body">
      {pending ? <><p>Local needs your approval to {title.toLowerCase()}.</p>
        <pre>{event.preview || JSON.stringify(event.input, null, 2)}</pre>
        <div className="approval-buttons"><button className="outline" disabled={deciding} onClick={() => void decide(false)}><X size={15} />Decline</button>
          <button className="primary" disabled={deciding} onClick={() => void decide(true)}><Check size={15} />Approve</button></div>
      </> : <><pre>{event.output || JSON.stringify(event.input, null, 2)}</pre><small className="muted">{event.state}</small></>}
    </div> : null}
    {!expanded && (event.state === 'rejected' || event.state === 'cancelled' || event.state === 'error') ? <p className="tool-outcome">{event.state === 'rejected' ? 'Action declined' : event.state === 'cancelled' ? 'Action cancelled' : 'Tool returned an error'}</p> : null}
  </div>
})

const Reply = memo(function Reply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="assistant-reply"><Brand small />
    <div className="reply-content"><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
      <button className="copy-button icon-button" aria-label="Copy response" onClick={() => {
        void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </div></div>
})

export default function Conversation({ session, onError }: { session: Session; onError: (error: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const last = session.events[session.events.length - 1]
  useEffect(() => { if (follow.current) bottom.current?.scrollIntoView({ block: 'end' }) }, [session.events.length, last?.text, last?.state])
  useEffect(() => { follow.current = true; bottom.current?.scrollIntoView({ block: 'end' }) }, [session.id])
  return <div className="transcript" ref={container} onScroll={() => {
    const el = container.current
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }}><div className="transcript-inner">
    {session.events.map(event => {
      if (event.type === 'user') return <div className="user-message" key={event.id}>{event.text}</div>
      if (event.type === 'tool') return <ToolCard key={event.id} event={event} sessionId={session.id} onError={onError} />
      if (event.type === 'assistant') return event.text ? <Reply key={event.id} text={event.text} /> : null
      return <div className={`conversation-notice ${event.type === 'error' ? 'error' : ''}`} key={event.id}>{event.text}</div>
    })}
    {session.status === 'running' ? <div className="working-indicator"><span /><span /><span /><span className="sr-only">Working</span></div> : null}
    <div ref={bottom} />
  </div></div>
}
