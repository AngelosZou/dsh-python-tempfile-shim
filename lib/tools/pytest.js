/**
 * `pytest_run` — convenience wrapper: `python -m pytest <args>` with the same
 * shim injection and sandboxed execution as `python_shim`.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateCommon } from '../render.js'
import { buildCommand, runCommand } from '../runner.js'
import { OUTPUT_RENDER, OUTPUT_SCHEMA } from './python-shim.js'

export function registerPytestTool(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'pytest_run',
      description:
        'Run pytest on Windows with the per-process tempfile shim injected, inside the DSH sandbox. ' +
        'Convenience wrapper for python_shim with "-m pytest". Use it when pytest tmp_path/tmpdir tests fail with ' +
        '[Errno 13] Permission denied / WinError 5 or a "[sandbox: file access denied under workspace-write mode]" ' +
        'marker (the CPython 0o700 owner-only temp directory × WRITE_RESTRICTED token incompatibility). ' +
        'Zero escalation; the sandbox boundary is untouched. ' +
        'If a run is denied for a different reason, re-run through the regular pwsh tool with its escalation surface.',
      parameters: {
        args: {
          type: 'string',
          description:
            'pytest arguments, e.g. "-q tests/unit --tb=short". Omit to run plain pytest in the working directory.',
        },
        description: {
          type: 'string',
          required: true,
          description:
            'Clear, concise description of what this pytest run does in active voice, 5-10 words (shown in the UI).',
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
          const argv =
            typeof args.args === 'string' && args.args.trim().length > 0
              ? `-m pytest ${args.args.trim()}`
              : '-m pytest'
          const command = buildCommand(ctx, argv)
          return await runCommand(ctx, command, args, exec, 'pytest-run')
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      },
      presentCall: (args) => ({
        card: 'terminal',
        title: `python -m pytest${typeof args.args === 'string' && args.args.trim().length > 0 ? ' ' + args.args.trim() : ''}`,
        description: args.description,
        ...(typeof args.workdir === 'string' ? { cwd: args.workdir } : {}),
      }),
    }),
  )
}
