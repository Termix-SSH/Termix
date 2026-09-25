/**
 * The shape an axios rejection actually has at the call sites that inspect it.
 * A `catch` binding is `unknown`, and every one of these sites was reaching
 * into it directly; this gives them one narrowing helper instead.
 */
export interface HttpLikeError {
  message?: string;
  code?: string;
  response?: {
    status?: number;
    data?: {
      error?: string;
      message?: string;
      code?: string;
      fileNotFound?: boolean;
    };
  };
}

export function asHttpError(error: unknown): HttpLikeError {
  return (error ?? {}) as HttpLikeError;
}
