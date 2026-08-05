import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

let cachedClient: S3Client | null = null
let cachedDefaultBucket: string | null = null

function readEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(`[r2] missing required env var: ${name}`)
  }
  return v.trim()
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient
  const endpoint = readEnv('R2_ENDPOINT')
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY')
  // The AWS SDK ignores proxy env vars by default. Sandboxed environments
  // (e.g. protocol sessions under @anthropic-ai/sandbox-runtime) allow HTTPS
  // only through the proxy they inject via HTTPS_PROXY — without this, every
  // R2 call dies with ENOTFOUND/EPERM inside the sandbox.
  const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim()
  cachedClient = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // AWS SDK v3 ≥3.729 auto-adds a SHA256/CRC32 checksum that conflicts with
    // Content-MD5 on Cloudflare R2. Disable auto-checksums so Content-MD5
    // server-side validation works.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(proxyUrl
      ? { requestHandler: new NodeHttpHandler({ httpsAgent: new HttpsProxyAgent(proxyUrl) }) }
      : {}),
  })
  return cachedClient
}

export function getDefaultBucket(): string {
  if (cachedDefaultBucket) return cachedDefaultBucket
  cachedDefaultBucket = readEnv('R2_BUCKET')
  return cachedDefaultBucket
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
  const client = getR2Client()
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!res.Body) {
    throw new Error(`[r2] empty body for r2://${bucket}/${key}`)
  }
  return streamToBuffer(res.Body as Readable)
}

export async function getObjectToFile(
  bucket: string,
  key: string,
  filePath: string,
): Promise<void> {
  const client = getR2Client()
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!res.Body) {
    throw new Error(`[r2] empty body for r2://${bucket}/${key}`)
  }
  await pipeline(res.Body as Readable, createWriteStream(filePath))
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  opts?: { contentMD5?: string },
): Promise<{ etag: string | undefined }> {
  const client = getR2Client()
  const res = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ...(opts?.contentMD5 ? { ContentMD5: opts.contentMD5 } : {}),
    }),
  )
  return { etag: res.ETag?.replace(/^"|"$/g, '') }
}

export async function headObject(bucket: string, key: string): Promise<{ size: number } | null> {
  const client = getR2Client()
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { size: res.ContentLength ?? 0 }
  } catch (err) {
    const name = (err as { name?: string }).name
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (name === 'NotFound' || status === 404) return null
    throw err
  }
}

export async function listObjects(
  bucket: string,
  prefix: string,
): Promise<Array<{ key: string; size: number }>> {
  const client = getR2Client()
  const out: Array<{ key: string; size: number }> = []
  let token: string | undefined
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of res.Contents ?? []) {
      if (obj.Key) out.push({ key: obj.Key, size: obj.Size ?? 0 })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}
