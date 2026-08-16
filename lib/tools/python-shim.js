/**
 * `python_shim` — run ANY Python command with the tempfile shim injected,
 * through the sandboxed shell executor. The generic entry point of the
 * plugin; `pytest_run` is a thin convenience wrapper on top of it.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderForegroundText, validateCommon } from '../render.js'
import { buildCommand, runCommand } from '../runner.js'

const STREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
}

/** Shared output schema: background job | foreground run | error text. */
export const OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'background' },
        jobId: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, const: 'foreground' },
        exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
        signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
        timedOut: { type: 'boolean', required: true },
        aborted: { type: 'boolean', required: true },
        timeoutMs: { type: 'number' },
        stdout: STREAM_SCHEMA,
        stderr: STREAM_SCHEMA,
        sandbox: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: { type: 'string', required: true },
            denied: { type: 'boolean', required: true },
            enforcement: { type: 'string' },
            runnerFailed: { type: 'boolean' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        error: { type: 'string', required: true },
      },
    },
  ],
}

export function renderOutputText(value) {
  if (value && typeof value.error === 'string') return value.error
  if (value && value.kind === 'background') return `started background job ${value.jobId}`
  return renderForegroundText(value)
}

/** Shared render: error text | background notice | foreground terminal text. */
export const OUTPUT_RENDER = (_args, value) => [{ type: 'text', text: renderOutputText(value) }]

const SANDBOX_NOTE =
  ' Runs through the SAME sandbox executor as the pwsh tool (workspace-write applies; no escalation needed). ' +
  'These shim tools intentionally expose NO sandbox_permissions/justification fields: if a run is denied for a ' +
  'different reason, re-run the exact command through the regular pwsh tool with its escalation surface.'

export function registerPythonShimTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'python_shim',
      description:
        'Run a Python command on Windows with a per-process tempfile shim injected, inside the DSH sandbox. ' +
        'Fixes the verified incompatibility where CPython builds owner-only (0o700) DACLs for tempfile.mkdtemp ' +
        'directories (and pytest basetemps), which the sandbox restricted token cannot read/write — the root cause ' +
        'of pytest tmp_path/tmpdir failures with [Errno 13]/WinError 5 or "[sandbox: file access denied]" markers. ' +
        'The shim (sitecustomize.py via PYTHONPATH) makes os.mkdir ignore the mode so new directories inherit the ' +
        'parent ACL carrying the sandbox write ACEs; it propagates to subprocesses (tox/nox). ' +
        'The sandbox boundary itself is untouched.' +
        SANDBOX_NOTE,
      parameters: {
        args: {
          type: 'string',
          required: true,
          description:
            'The Python command line exactly as after `python` in a shell, e.g. "-m pytest -q tests", "script.py --flag", or "-c \\"print(1)\\". The shim directory is prepended to PYTHONPATH automatically.',
        },
        description: {
          type: 'string',
          required: true,
          description:
            'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).',
        },
        workdir: {
          type: 'string',
          description:
            'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.',
        },
      },
      output: { schema: OUTPUT_SCHEMA, render: OUTPUT_RENDER },
      async execute(args, exec) {
        const invalid = validateCommon(args)
        if (invalid !== undefined) return { error: invalid }
        try {
          const command = buildCommand(ctx, args.args)
          return await runCommand(ctx, command, args, exec, 'python-shim')
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'terminal',
        title: `python ${String(args.args).trim()}`,
        description: args.description,
        ...(typeof args.workdir === 'string' ? { cwd: args.workdir } : {}),
      }),
    }),
  )
}
