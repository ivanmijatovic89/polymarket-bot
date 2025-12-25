/**
 * Worker pool for parallel backtest execution.
 * Manages a pool of worker threads for processing files concurrently.
 */

import { Worker } from 'worker_threads'
import { cpus } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export type WorkerTask<T, R> = {
  data: T
  resolve: (result: R) => void
  reject: (error: Error) => void
}

export class WorkerPool<T, R> {
  private workers: Worker[] = []
  private availableWorkers: Worker[] = []
  private queue: WorkerTask<T, R>[] = []
  private workerScriptPath: string

  constructor(options: { workerScript: string; poolSize?: number }) {
    this.workerScriptPath = join(__dirname, options.workerScript)
    const poolSize = options.poolSize ?? cpus().length

    // Create worker pool
    for (let i = 0; i < poolSize; i++) {
      this.createWorker()
    }
  }

  private createWorker(): void {
    const worker = new Worker(this.workerScriptPath, {
      execArgv: ['--loader', 'tsx/esm'],
    })

    worker.on('message', (result: R) => {
      // Worker completed task, make it available again
      this.availableWorkers.push(worker)
      this.processQueue()
    })

    worker.on('error', (error) => {
      console.error('[worker-pool] Worker error:', error)
      // Remove failed worker from pool
      const idx = this.workers.indexOf(worker)
      if (idx >= 0) this.workers.splice(idx, 1)
      const availIdx = this.availableWorkers.indexOf(worker)
      if (availIdx >= 0) this.availableWorkers.splice(availIdx, 1)
    })

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[worker-pool] Worker stopped with exit code ${code}`)
      }
    })

    this.workers.push(worker)
    this.availableWorkers.push(worker)
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.queue.shift()!
      const worker = this.availableWorkers.shift()!
      this.runTask(worker, task)
    }
  }

  private runTask(worker: Worker, task: WorkerTask<T, R>): void {
    const messageHandler = (result: R) => {
      worker.off('message', messageHandler)
      worker.off('error', errorHandler)
      task.resolve(result)
      this.availableWorkers.push(worker)
      this.processQueue()
    }

    const errorHandler = (error: Error) => {
      worker.off('message', messageHandler)
      worker.off('error', errorHandler)
      task.reject(error)
      // Worker errored, remove it and create a new one
      const idx = this.workers.indexOf(worker)
      if (idx >= 0) this.workers.splice(idx, 1)
      this.createWorker()
      this.processQueue()
    }

    worker.once('message', messageHandler)
    worker.once('error', errorHandler)
    worker.postMessage(task.data)
  }

  public execute(data: T): Promise<R> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask<T, R> = { data, resolve, reject }

      if (this.availableWorkers.length > 0) {
        const worker = this.availableWorkers.shift()!
        this.runTask(worker, task)
      } else {
        this.queue.push(task)
      }
    })
  }

  public async executeAll(items: T[]): Promise<R[]> {
    return Promise.all(items.map((item) => this.execute(item)))
  }

  public async terminate(): Promise<void> {
    await Promise.all(
      this.workers.map((worker) =>
        worker.terminate().catch((err) => {
          console.error('[worker-pool] Error terminating worker:', err)
        }),
      ),
    )
    this.workers = []
    this.availableWorkers = []
    this.queue = []
  }

  public getPoolSize(): number {
    return this.workers.length
  }

  public getActiveWorkers(): number {
    return this.workers.length - this.availableWorkers.length
  }

  public getQueueSize(): number {
    return this.queue.length
  }
}
