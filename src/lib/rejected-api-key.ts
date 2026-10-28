export class RejectedApiKeyError extends Error {
  constructor() {
    super("rejected_api_key")
    this.name = "RejectedApiKeyError"
  }
}
