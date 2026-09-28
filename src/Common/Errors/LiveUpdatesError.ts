import AbstractAppError from '@wexample/js-api/Common/Errors/AbstractAppError';

export type LiveUpdatesErrorOptions = {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
  cause?: unknown;
};

export default class LiveUpdatesError extends AbstractAppError {
  constructor(options: LiveUpdatesErrorOptions) {
    super({
      message: options.message,
      kind: 'api.live-updates',
      code: options.code,
      context: options.context,
      cause: options.cause,
    });
  }
}
