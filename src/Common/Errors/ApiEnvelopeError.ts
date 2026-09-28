import { serializeForLog } from '@wexample/js-helpers/Helper/Serialize';
import AbstractAppError from '@wexample/js-api/Common/Errors/AbstractAppError';

export type ApiEnvelopeErrorOptions = {
  message: string;
  // Server error key (e.g. "ERR_INVALID_CREDENTIALS").
  code?: string;
  // Numeric code carried by the envelope (usually the HTTP status).
  responseCode?: number;
  // The raw envelope, kept for inspection and logging.
  envelope?: unknown;
  cause?: unknown;
};

export default class ApiEnvelopeError extends AbstractAppError {
  public readonly responseCode?: number;
  public readonly envelope?: unknown;

  constructor(options: ApiEnvelopeErrorOptions) {
    super({
      message: options.message,
      kind: 'api.envelope',
      code: options.code,
      context: {
        responseCode: options.responseCode,
      },
      cause: options.cause,
    });
    this.responseCode = options.responseCode;
    this.envelope = options.envelope;
  }

  override toLogPayload() {
    return {
      ...super.toLogPayload(),
      envelope: serializeForLog(this.envelope),
    };
  }
}
