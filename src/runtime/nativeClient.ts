import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { TextDecoder } from 'node:util'
import {
  MAX_NATIVE_REQUEST_BYTES,
  NATIVE_PROTOCOL_VERSION,
  isJsonValue,
  parseNativeResponse,
  validProtocolIdentifier,
  type JsonValue,
  type NativeRequest,
  type NativeResponse,
  type NativeSuccessResponse,
} from './contracts.js'

export class NativeRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'NativeRuntimeError'
  }
}

export type NativeClientOptions = {
  /** An explicit absolute executable path. No shell, PATH lookup or legacy fallback. */
  executablePath: string
  args?: readonly string[]
  cwd?: string
  timeoutMs?: number
  killGraceMs?: number
  maxInputBytes?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Optional pinned release version, checked against the responding process. */
  expectedEngineVersion?: string
  /** Keep an inherited watchdog pipe open; supported native executables exit on parent loss. */
  parentWatch?: boolean
}

export type NativeOperation = { requestId?: string; operation: string; input: JsonValue }

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new NativeRuntimeError(
      'invalid_configuration',
      `${label} must be a positive integer.`,
      false,
    )
  }
  return value
}

/** Run one whole operation and wait for a clean process exit before accepting its result. */
export async function runNativeOperation(
  options: NativeClientOptions,
  operation: NativeOperation,
): Promise<NativeSuccessResponse> {
  if (!isAbsolute(options.executablePath)) {
    throw new NativeRuntimeError(
      'invalid_configuration',
      'Native executable path must be absolute.',
      false,
    )
  }
  const timeoutMs = positiveLimit(options.timeoutMs ?? 120_000, 'timeoutMs')
  const killGraceMs = positiveLimit(options.killGraceMs ?? 1000, 'killGraceMs')
  if (timeoutMs > 2 ** 31 - 1 || killGraceMs > 2 ** 31 - 1) {
    throw new NativeRuntimeError(
      'invalid_configuration',
      'Native timer limits exceed the supported range.',
      false,
    )
  }
  const maxInputBytes = positiveLimit(
    options.maxInputBytes ?? MAX_NATIVE_REQUEST_BYTES,
    'maxInputBytes',
  )
  const maxOutputBytes = positiveLimit(options.maxOutputBytes ?? 64 * 1024 * 1024, 'maxOutputBytes')
  if (maxInputBytes > MAX_NATIVE_REQUEST_BYTES) {
    throw new NativeRuntimeError(
      'invalid_configuration',
      'Input limit exceeds the native protocol limit.',
      false,
    )
  }
  if (options.signal?.aborted) {
    throw new NativeRuntimeError('canceled', 'Native operation was canceled before launch.', false)
  }
  const requestId = operation.requestId ?? randomUUID()
  if (
    !validProtocolIdentifier(requestId, 128) ||
    !validProtocolIdentifier(operation.operation, 64) ||
    !isJsonValue(operation.input)
  ) {
    throw new NativeRuntimeError(
      'invalid_request',
      'Native operation requires valid JSON input and identifiers.',
      false,
    )
  }
  const request: NativeRequest = {
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    requestId,
    operation: operation.operation,
    input: operation.input,
  }
  let input: Buffer
  try {
    input = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8')
  } catch {
    throw new NativeRuntimeError(
      'invalid_request',
      'Native input cannot be serialized as JSON.',
      false,
    )
  }
  if (input.length > maxInputBytes) {
    throw new NativeRuntimeError(
      'input_limit',
      'Native request exceeds the configured byte limit.',
      false,
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      options.executablePath,
      [
        ...(options.args ?? []),
        ...(options.parentWatch === false ? [] : ['--parent-watch-fd', '3']),
      ],
      {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        shell: false,
      },
    )
    let failure: NativeRuntimeError | undefined
    let response: NativeResponse | undefined
    let outputBytes = 0
    let line = ''
    let closed = false
    let inputOffset = 0
    let killTimer: NodeJS.Timeout | undefined
    // Fatal UTF-8 decoding prevents corrupt bytes from silently becoming replacement characters.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

    const onParentExit = (): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    const stop = (error: NativeRuntimeError): void => {
      if (closed || failure) return
      failure = error
      child.stdin.destroy()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }, killGraceMs)
        killTimer.unref()
      }
    }
    const canceled = (): void => {
      stop(new NativeRuntimeError('canceled', 'Native operation was canceled.', false))
    }
    process.once('exit', onParentExit)
    options.signal?.addEventListener('abort', canceled, { once: true })
    const timeout = setTimeout(() => {
      stop(new NativeRuntimeError('timeout', 'Native operation exceeded its time limit.', true))
    }, timeoutMs)
    timeout.unref()

    const acceptLine = (text: string): void => {
      if (response || text.length === 0) {
        stop(
          new NativeRuntimeError(
            'invalid_response',
            'Native process returned extra or empty response lines.',
            false,
          ),
        )
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        stop(
          new NativeRuntimeError(
            'invalid_response',
            'Native process returned malformed JSON.',
            false,
          ),
        )
        return
      }
      const envelope = parseNativeResponse(parsed)
      if (!envelope) {
        stop(
          new NativeRuntimeError(
            'invalid_response',
            'Native response violates the protocol schema.',
            false,
          ),
        )
        return
      }
      if (envelope.requestId !== requestId) {
        stop(
          new NativeRuntimeError(
            'request_mismatch',
            'Native response does not match the submitted request.',
            false,
          ),
        )
        return
      }
      if (
        options.expectedEngineVersion !== undefined &&
        envelope.engine.version !== options.expectedEngineVersion
      ) {
        stop(
          new NativeRuntimeError(
            'engine_mismatch',
            'Native response does not match the pinned engine version.',
            false,
          ),
        )
        return
      }
      response = envelope
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        stop(
          new NativeRuntimeError(
            'output_limit',
            'Native response exceeds the configured byte limit.',
            false,
          ),
        )
        return
      }
      try {
        line += decoder.decode(chunk, { stream: true })
      } catch {
        stop(
          new NativeRuntimeError('invalid_response', 'Native response is not valid UTF-8.', false),
        )
        return
      }
      let newline: number
      while (!failure && (newline = line.indexOf('\n')) !== -1) {
        const complete = line.slice(0, newline)
        line = line.slice(newline + 1)
        acceptLine(complete)
      }
    })
    // Always drain diagnostics to prevent a full stderr pipe blocking the runtime.
    // They are intentionally neither retained nor included in thrown errors.
    child.stderr.resume()
    child.stdout.on('error', () => {
      stop(
        new NativeRuntimeError('output_error', 'Could not read the native response stream.', true),
      )
    })
    child.stderr.on('error', () => {
      stop(new NativeRuntimeError('output_error', 'Could not drain native diagnostics.', true))
    })
    child.stdin.on('error', () => {
      stop(new NativeRuntimeError('input_error', 'Could not send the native request.', true))
    })
    child.on('error', () => {
      stop(
        new NativeRuntimeError(
          'process_error',
          'Could not launch or signal the native runtime.',
          true,
        ),
      )
    })
    child.once('close', (code, signal) => {
      closed = true
      clearTimeout(timeout)
      clearTimeout(killTimer)
      child.stdio[3]?.destroy()
      options.signal?.removeEventListener('abort', canceled)
      process.removeListener('exit', onParentExit)
      if (failure) return reject(failure)
      if (code !== 0 || signal !== null) {
        return reject(
          new NativeRuntimeError('process_exit', 'Native runtime did not exit successfully.', true),
        )
      }
      try {
        line += decoder.decode()
      } catch {
        return reject(
          new NativeRuntimeError(
            'invalid_response',
            'Native response contains incomplete UTF-8.',
            false,
          ),
        )
      }
      if (line.length !== 0 || !response) {
        return reject(
          new NativeRuntimeError(
            'incomplete_response',
            'Native runtime did not return one complete JSONL response.',
            false,
          ),
        )
      }
      if (response.status === 'failed') {
        return reject(
          new NativeRuntimeError(
            response.error.code,
            response.error.message,
            response.error.retryable,
          ),
        )
      }
      resolve(response)
    })

    // Write bounded chunks and wait for drain rather than queueing the whole request in the pipe.
    const sendInput = (): void => {
      while (!failure && !closed && inputOffset < input.length) {
        const end = Math.min(inputOffset + 64 * 1024, input.length)
        const accepted = child.stdin.write(input.subarray(inputOffset, end))
        inputOffset = end
        if (!accepted) {
          child.stdin.once('drain', sendInput)
          return
        }
      }
      if (!failure && !closed) child.stdin.end()
    }
    // The signal may have become aborted between the initial check and listener registration.
    if (options.signal?.aborted) canceled()
    else sendInput()
  })
}
