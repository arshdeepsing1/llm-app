import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../api'
import type { Job } from '../types'

export default function TerminalPanel({ sessionId, workspace }: { sessionId: string | null; workspace: string }) {
  return <TerminalJobs key={JSON.stringify([sessionId, workspace])} sessionId={sessionId} />
}

const jobState = (job: Job) => `${job.state.replace('_', ' ')}${job.exit_code === null ? '' : ` · exit ${job.exit_code}`}${job.background ? ' · background' : ''}${job.truncated ? ' · output truncated' : ''}`

function TerminalJobs({ sessionId }: { sessionId: string | null }) {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  const [command, setCommand] = useState('')
  const [timeout, setTimeoutSeconds] = useState(60)
  const [outputLimit, setOutputLimit] = useState(80000)
  const [background, setBackground] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Job | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState<string[]>([])
  const [error, setError] = useState('')
  const alive = useRef(false)
  const mutations = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const version = mutations.current
      try {
        const list = await api<Job[]>(`/jobs${query}`)
        if (disposed || version !== mutations.current) return
        setJobs(current => list.map(job => {
          const previous = current.find(item => item.id === job.id)
          return previous && previous.updated > job.updated ? previous : job
        }))
        setSelectedId(current => list.some(job => job.id === current) ? current : list[0]?.id || null)
        timer = setTimeout(() => void load(), list.some(job => job.state === 'running') ? 1000 : 3000)
      } catch (e) { if (!disposed) setError((e as Error).message) }
    }
    void load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [query, refresh])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    setDetail(current => current?.id === selectedId ? current : null)
    const load = async () => {
      const version = mutations.current
      try {
        const job = await api<Job>(`/jobs/${selectedId}${query}`)
        if (disposed || version !== mutations.current) return
        setDetail(current => current?.id === job.id && current.updated > job.updated ? current : job)
        setJobs(current => current.map(item => item.id === job.id && item.updated <= job.updated ? job : item))
        if (job.state === 'running') timer = setTimeout(() => void load(), 500)
      } catch (e) { if (!disposed) setError((e as Error).message) }
    }
    if (selectedId) void load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [query, selectedId, refresh])

  const run = async () => {
    if (!command.trim() || launching || jobs.some(job => job.state === 'running' && !job.background)) return
    setLaunching(true); setError('')
    try {
      const job = await api<Job>(`/jobs${query}`, 'POST', {
        command, timeout_seconds: timeout, max_output_bytes: outputLimit, background,
      })
      if (!alive.current) return
      mutations.current++
      setJobs(current => [job, ...current.filter(item => item.id !== job.id)])
      setSelectedId(job.id); setDetail(job); setRefresh(current => current + 1)
    } catch (e) { if (alive.current) setError((e as Error).message) }
    finally { if (alive.current) setLaunching(false) }
  }
  const stop = async (id: string) => {
    setStopping(current => [...current, id]); setError('')
    try {
      const job = await api<Job>(`/jobs/${id}/stop${query}`, 'POST')
      if (!alive.current) return
      mutations.current++
      setJobs(current => current.map(item => item.id === id ? job : item))
      setDetail(current => current?.id === id ? job : current)
      setRefresh(current => current + 1)
    } catch (e) { if (alive.current) setError((e as Error).message) }
    finally { if (alive.current) setStopping(current => current.filter(item => item !== id)) }
  }
  const selected = detail?.id === selectedId ? detail : jobs.find(job => job.id === selectedId)
  const foregroundRunning = jobs.some(job => job.state === 'running' && !job.background)
  return <div className="terminal-view">
    <p>Run a command in your project folder.</p>
    <form className="terminal-run" onSubmit={e => { e.preventDefault(); void run() }}>
      <div className="terminal-command"><span>$</span><input aria-label="Shell command" placeholder="git status" value={command} onChange={e => setCommand(e.target.value)} />
        <button className="primary" disabled={launching || foregroundRunning || !command.trim()}>{launching ? 'Starting…' : 'Run'}</button></div>
      <div className="terminal-options">
        <label>Timeout (seconds)<input type="number" min={1} max={3600} step={1} required value={timeout || ''} onChange={e => setTimeoutSeconds(Number(e.target.value))} /></label>
        <label>Output limit (bytes)<input type="number" min={1024} max={1000000} step={1} required value={outputLimit || ''} onChange={e => setOutputLimit(Number(e.target.value))} /></label>
      </div>
      <label className="terminal-background"><input type="checkbox" checked={background} onChange={e => setBackground(e.target.checked)} />Run in background</label>
    </form>
    <p className="field-help">Commands can access your machine. Background jobs continue after Stop response; use Stop job to end one. Server shutdown also stops jobs.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="terminal-history-heading"><span>Job history</span><button className="icon-button" aria-label="Refresh jobs" onClick={() => { setError(''); setRefresh(current => current + 1) }}><RefreshCw size={14} /></button></div>
    <div className="terminal-jobs" role="list" aria-label="Job history">
      {jobs.map(job => <div className="terminal-job" role="listitem" key={job.id}>
        <button className="terminal-job-select" aria-label={`Show job ${job.command} · ${jobState(job)}`} aria-pressed={job.id === selectedId} onClick={() => setSelectedId(job.id)}><span>{job.command}</span><small>{jobState(job)}</small></button>
        {job.state === 'running' ? <button className="outline terminal-stop" aria-label={`Stop job ${job.command}`} disabled={stopping.includes(job.id)} onClick={() => void stop(job.id)}>{stopping.includes(job.id) ? 'Stopping…' : 'Stop job'}</button> : null}
      </div>)}
      {!jobs.length ? <p>No jobs in this workspace scope yet.</p> : null}
    </div>
    {selected ? <p className="terminal-job-status" role="status">{jobState(selected)}</p> : null}
    <pre className="terminal-output" aria-label="Job output">{selected ? `$ ${selected.command}\n\n${selected.output ?? 'Loading job output…'}` : 'Command output will appear here.'}</pre>
  </div>
}
