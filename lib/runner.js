/**
 * Command construction + sandboxed execution core shared by both tools.
 *
 * Execution ALWAYS goes through `ctx.shell` (the seam the shipped pwsh/bash
 * tools use), never through a direct child-process spawn: a direct spawn would
 * run with the full, unrestricted token and turn this plugin into a sandbox
 * escape. `ctx.shell.run(ctx.shell.resolve({...}))` keeps every run confined
 * by the mounted executor exactly like a pwsh call.
 */

import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { processOutcome, renderProcessRead } from './render.js'

const here = dirname(fileURLToPath(import.meta.url))
/** Absolute path of the bundled shim directory (assets/sitecustomize.py). */
export const SHIM_DIR = join(here, '..', 'assets')

/** Quote one PowerShell single-quoted string literal. */
const psSingleQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** Resolve an explicit workdir against the session workspace; else use it. */
export function resolveWorkdir(modelWorkdir, headerCwd) {
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) return resolve(headerCwd, modelWorkdir)
  return modelWorkdir
}

/**
 * Build the PowerShell command for one python invocation.
 *
 * @param ctx - the Cordis context (shell resolved via ctx.get at call time).
 * @param pythonArgv - the command line exactly as after `python` in a shell.
 * @returns `python <argv>`, prefixed with the PYTHONPATH shim injection only
 *   when the mounted executor confines (sandboxMode defined).
 */
export function buildCommand(ctx, pythonArgv) {
  const shell = ctx.get('shell')
  if (shell === undefined) {
    throw new Error('python-tempfile-shim: no shell executor is mounted (cannot run commands)')
  }
  const argv = String(pythonArgv).trim()
  if (argv.length === 0) throw new Error('invalid args: expected a non-empty python command line')
  // Outside a confined composition CPython's 0o700 semantics are left alone.
  if (shell.sandboxMode === undefined) return `python ${argv}`
  return `$env:PYTHONPATH = ${psSingleQuote(SHIM_DIR)} + $(if ($env:PYTHONPATH) { ';' + $env:PYTHONPATH }); python ${argv}`
}

/**
 * Run one command through the sandboxed shell executor and shape the result.
 * Supports foreground and background (`ctx.jobs`) paths, mirroring the
 * shipped pwsh tool so `job_output`/`job_kill` and finish notices keep working.
 *
 * @returns a registry value: {kind:'foreground', ...} or {kind:'background', jobId}.
 */
export async function runCommand(ctx, command, args, exec, jobKind) {
  const shell = ctx.get('shell')
  if (shell === undefined) {
    throw new Error('python-tempfile-shim: no shell executor is mounted (cannot run commands)')
  }
  const confined = shell.sandboxMode !== undefined
  const sandboxPolicy = ctx.get('sandboxPolicy')
  if (confined && sandboxPolicy === undefined) {
    throw new Error('python-tempfile-shim: the shell executor confines but no sandboxPolicy service is mounted')
  }
  const standing = confined
    ? sandboxPolicy.resolve(exec.agent !== undefined ? { session: exec.agent.session } : {})
    : undefined
  const shellEnv = ctx.get('shellEnv')
  const headerCwd =
    exec.agent && exec.agent.session && exec.agent.session.header
      ? exec.agent.session.header.cwd
      : undefined
  const workdir = resolveWorkdir(args.workdir, headerCwd)
  const request = {
    command,
    ...(workdir !== undefined ? { workdir } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(shellEnv !== undefined ? { dshEnv: shellEnv.collect(exec) } : {}),
    ...(standing !== undefined ? { sandboxPolicy: standing } : {}),
  }

  if (args.run_in_background === true) {
    if (exec.signal !== undefined && exec.signal.aborted) throw new Error('tool call aborted')
    const jobs = ctx.get('jobs')
    if (jobs === undefined) {
      throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    const jobId = jobs.start({
      kind: jobKind,
      label: command,
      ...(exec.agent !== undefined ? { owner: exec.agent } : {}),
      run: () => {
        const proc = shell.start(shell.resolve(request))
        return {
          cancel: () => void proc.kill(),
          done: proc.done.then(() => processOutcome(proc)),
          readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox),
        }
      },
    })
    return { kind: 'background', jobId }
  }

  const result = await shell.run(shell.resolve({ ...request, signal: exec.signal }))
  if (result.aborted) throw new Error('tool call aborted')
  return canonicalForeground(result)
}

function streamShape(stream) {
  return {
    text: stream && typeof stream.text === 'string' ? stream.text : '',
    truncated: !!(stream && stream.truncated),
    ...(stream && stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {}),
  }
}

/** Detach the executor DTO into the plain foreground value the schema declares. */
function canonicalForeground(result) {
  return {
    kind: 'foreground',
    exitCode: result.exitCode === undefined ? null : result.exitCode,
    signal: result.signal === undefined ? null : result.signal,
    timedOut: !!result.timedOut,
    aborted: false,
    ...(result.timeoutMs !== undefined ? { timeoutMs: result.timeoutMs } : {}),
    stdout: streamShape(result.stdout),
    stderr: streamShape(result.stderr),
    ...(result.sandbox !== undefined
      ? {
          sandbox: {
            mode: String(result.sandbox.mode),
            denied: !!result.sandbox.denied,
            ...(result.sandbox.enforcement !== undefined
              ? { enforcement: String(result.sandbox.enforcement) }
              : {}),
            ...(result.sandbox.runnerFailed !== undefined
              ? { runnerFailed: !!result.sandbox.runnerFailed }
              : {}),
          },
        }
      : {}),
  }
}
