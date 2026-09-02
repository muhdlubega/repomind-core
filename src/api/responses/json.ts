export function success<T>(data: T): { data: T } { return { data }; }
export function failure(code: string, message: string, details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
