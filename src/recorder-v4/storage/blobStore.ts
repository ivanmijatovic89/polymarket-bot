import { assertArchiveKey } from './namespace.js'
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'

/** All object bodies are streamed. Implementations must return null only for a missing key. */
export interface BlobStore {
  putFile(key: string, file: string, contentType: string, signal?: AbortSignal): Promise<void>
  get(key: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array> | null>
  list(prefix: string, signal?: AbortSignal): AsyncIterable<string>
}

export type R2BlobStoreOptions = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  timeoutMs?: number
}

/** This adapter deliberately has no dependency on the bot's environment or wallet configuration. */
export class R2BlobStore implements BlobStore {
  private readonly client: S3Client
  private readonly timeoutMs: number
  private readonly lifetime = new AbortController()

  constructor(private readonly options: R2BlobStoreOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.client = new S3Client({
      region: 'auto',
      endpoint: options.endpoint,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 1,
    })
  }

  private requestSignal(signal?: AbortSignal): AbortSignal {
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    return AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.timeoutMs),
      ...(signal ? [signal] : []),
    ])
  }

  async putFile(
    key: string,
    file: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<void> {
    assertArchiveKey(key)
    const abortSignal = this.requestSignal(signal)
    const body = createReadStream(file)
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: body,
          ContentLength: (await stat(file)).size,
          ContentType: contentType,
          IfNoneMatch: '*',
        }),
        { abortSignal },
      )
    } finally {
      body.destroy()
    }
  }

  async get(key: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array> | null> {
    assertArchiveKey(key)
    const abortSignal = this.requestSignal(signal)
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { abortSignal },
      )
      if (!response.Body || !(Symbol.asyncIterator in response.Body)) {
        throw new Error('R2 returned a non-streaming or missing object body')
      }
      const body = response.Body as Readable
      // A caller can cancel immediately after headers, before its async iterator attaches.
      body.on('error', () => undefined)
      const abort = () => body.destroy(new Error('R2 object read aborted'))
      abortSignal.addEventListener('abort', abort, { once: true })
      if (abortSignal.aborted) abort()
      return (async function* () {
        try {
          abortSignal.throwIfAborted()
          for await (const bytes of body) {
            abortSignal.throwIfAborted()
            yield bytes as Uint8Array
          }
        } finally {
          abortSignal.removeEventListener('abort', abort)
          body.destroy()
        }
      })()
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
        return null
      }
      throw error
    }
  }

  async *list(prefix: string, signal?: AbortSignal): AsyncIterable<string> {
    assertArchiveKey(prefix, true)
    let token: string | undefined
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
        { abortSignal: this.requestSignal(signal) },
      )
      for (const object of response.Contents ?? [])
        if (object.Key) {
          assertArchiveKey(object.Key)
          if (!object.Key.startsWith(prefix))
            throw new Error('R2 listing escaped the selected prefix')
          yield object.Key
        }
      if (response.IsTruncated && !response.NextContinuationToken) {
        throw new Error('R2 returned a truncated listing without a cursor')
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (token)
  }

  close(): void {
    this.lifetime.abort()
    this.client.destroy()
  }
}
