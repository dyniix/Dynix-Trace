export class ScannerEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScannerEngineError";
    this.code = code;
  }
}
