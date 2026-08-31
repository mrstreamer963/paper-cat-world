export class CoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.details = details;
  }
}

export const fail = (code, message, details) => new CoreError(code, message, details);
