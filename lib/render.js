/**
 * Shared result rendering and semantic validation for the shim tools.
 * Mirrors the shipped pwsh/bash tool conventions so agent-facing output stays
 * familiar, with ONE deliberate difference: no escalation hint is ever
 * appended (see SECURITY.md — these tools intentionally have no escalation
 * surface; escalations belong to the regular pwsh tool).
 */

export function validateCommon(args) {
  if (typeof args.description !== 'string' || args.description.trim().length === 0) {
    return 'invalid description: expected a non-empty string'
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    return `invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`
  }
  return undefined
}

function streamText(stream) {
  return stream && typeof stream.text === 'string' ? stream.text : ''
}

/** Foreground text rendering: stdout tail, optional [stderr], then markers. */
export function renderForegroundText(value) {
  let body = streamText(value.stdout)
  const err = streamText(value.stderr)
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers = []
  if (value.sandbox && value.sandbox.denied) {
    markers.push(`[sandbox: file access denied under ${value.sandbox.mode} mode]`)
  }
  if (value.timedOut) markers.push(`[timed out after ${value.timeoutMs}ms]`)
  if (value.signal !== null && value.signal !== undefined) markers.push(`[killed by signal: ${value.signal}]`)
  else if (value.exitCode !== 0 && value.exitCode !== null && value.exitCode !== undefined) {
    markers.push(`[exit code: ${value.exitCode}]`)
  }
  if (markers.length === 0) return body
  return (body.endsWith('\n') ? body : body + '\n') + markers.join('\n')
}

/** One consuming background read, shaped for `job_output` (no escalation hint). */
export function renderProcessRead(read, sandbox) {
  const notices = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path) => path !== undefined)
    notices.push(
      '[some output was dropped from memory; full output: ' +
        (paths.length > 0 ? paths.join(', ') : '(unavailable)') +
        ']',
    )
  }
  if (sandbox && sandbox.runnerFailed) {
    notices.push(
      '[sandbox: the sandbox runner itself failed under ' + sandbox.mode +
        ' mode — the command did not run; this is a sandbox problem, not a command failure]',
    )
  } else if (sandbox && sandbox.denied) {
    notices.push('[sandbox: file access denied under ' + sandbox.mode + ' mode]')
  }
  if (notices.length === 0) return read.delta
  return read.delta + (read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : '') + notices.join('\n')
}

/** Terminal outcome for a background process, in the jobs-registry vocabulary. */
export function processOutcome(proc) {
  if (proc.status === 'killed') {
    return {
      status: 'killed',
      detail: proc.signal !== null && proc.signal !== undefined ? 'signal: ' + proc.signal : 'killed before exit',
    }
  }
  return {
    status: 'completed',
    detail: 'exit code: ' + (proc.exitCode === undefined || proc.exitCode === null ? 0 : proc.exitCode),
  }
}
