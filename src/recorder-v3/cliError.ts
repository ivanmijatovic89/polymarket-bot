/** Only deliberately credential-free argument/configuration messages may reach CLI stderr. */
export class RecorderCliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecorderCliError'
  }
}
