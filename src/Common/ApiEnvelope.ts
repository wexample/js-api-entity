import ApiEnvelopeError from './Errors/ApiEnvelopeError';

export const API_RESPONSE_TYPE_SUCCESS = 'success';
export const API_RESPONSE_TYPE_ERROR = 'error';

export type ApiResponseType = typeof API_RESPONSE_TYPE_SUCCESS | typeof API_RESPONSE_TYPE_ERROR;

// Standard envelope produced by wexample/symfony-api controllers
// (AbstractApiController::apiResponse).
export type ApiEnvelope<T = unknown> = {
  type: ApiResponseType;
  code: number;
  message?: string;
  data: T;
};

export function isApiEnvelope(value: unknown): value is ApiEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    'data' in record &&
    (record.type === API_RESPONSE_TYPE_SUCCESS || record.type === API_RESPONSE_TYPE_ERROR)
  );
}

// Returns the envelope "data" payload, throwing ApiEnvelopeError on
// malformed envelopes or explicit error responses, so callers never
// have to retest `type === 'success'` themselves.
export function unwrapApiEnvelope<T = unknown>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiEnvelopeError({
      message: 'Invalid API response: expected an envelope object.',
      envelope: value,
    });
  }

  const envelope = value as Partial<ApiEnvelope<T>>;

  if (envelope.type === API_RESPONSE_TYPE_ERROR) {
    throw new ApiEnvelopeError({
      message: envelope.message || 'ERR_UNDEFINED',
      code: envelope.message,
      responseCode: typeof envelope.code === 'number' ? envelope.code : undefined,
      envelope: value,
    });
  }

  if (!('data' in envelope)) {
    throw new ApiEnvelopeError({
      message: 'Invalid API response: missing "data" in envelope.',
      envelope: value,
    });
  }

  return envelope.data as T;
}
