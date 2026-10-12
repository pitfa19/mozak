/** Expected domain failures, shared by the CLI, MCP and core. */
export class DomainError extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(code: string, message: string, exitCode = 2) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
