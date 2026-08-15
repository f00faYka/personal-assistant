export class ConfirmedRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ConfirmedRequestError";
  }
}

export function responseError(message: string, status: number): Error {
  return isConfirmedRejection(status) ? new ConfirmedRequestError(message, status) : new Error(message);
}

export function shouldPersistOfflineDraft(error: unknown): boolean {
  return !(error instanceof ConfirmedRequestError);
}

function isConfirmedRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
