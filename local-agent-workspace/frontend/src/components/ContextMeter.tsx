import type { ContextInfo } from '../types'

export default function ContextMeter({ info }: { info?: ContextInfo }) {
  if (!info) return <p className="context-empty">Context usage is estimated after the first turn.</p>
  const percent = Math.round(info.estimated_tokens / info.input_budget * 100)
  const safetyReserve = info.context_window - info.input_budget - info.reply_reserve
  return <details className="context-meter">
    <summary>
      <span>Last model input · ~{percent}%</span>
      <progress aria-label="Estimated model input usage" aria-valuetext={`Approximately ${percent}% of input budget`} value={Math.min(percent, 100)} max={100} />
      {info.compactions > 0 ? <span> · {info.compactions} {info.compactions === 1 ? 'compaction' : 'compactions'}</span> : null}
      {info.warnings.length > 0 ? <span> · {info.warnings.length} {info.warnings.length === 1 ? 'warning' : 'warnings'}</span> : null}
    </summary>
    <div className="context-details">
      <p>Approximately {info.estimated_tokens.toLocaleString()} of {info.input_budget.toLocaleString()} input tokens used.</p>
      <p>Conservative UTF-8 estimate, not a provider token count. Estimate for the last request; updates each model call.</p>
      <p>Of the {info.context_window.toLocaleString()}-token context window, {info.reply_reserve.toLocaleString()} tokens are reserved for the response and {safetyReserve.toLocaleString()} for safety.</p>
      <p>Compactions: {info.compactions}. Messages summarized: {info.summarized_messages}.</p>
      <p className="context-heading">Loaded project instructions</p>
      {info.instruction_files.length ? <ul>{info.instruction_files.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p>No project instruction files loaded.</p>}
      {info.warnings.length ? <><p className="context-heading">Warnings</p><ul className="context-warnings">{info.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></> : null}
    </div>
  </details>
}
