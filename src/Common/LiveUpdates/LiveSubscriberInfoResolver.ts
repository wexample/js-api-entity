import LiveUpdatesError from '../Errors/LiveUpdatesError';

// The subscribe-info payload as symfony-live serves it: these keys are the wire
// contract, not a local shape.
export type LiveSubscriberInfo = {
  hubUrl: string;
  jwt: string;
  topics: string[];
  expiresAt: string;
};

export type LiveSubscriberInfoResolverOptions = {
  fetchInfo: () => Promise<LiveSubscriberInfo>;
  // How long before expiry the token is renewed. A stream opened just under the
  // wire would otherwise be opened with a token dying during the handshake.
  renewMarginMs?: number;
};

const DEFAULT_RENEW_MARGIN_MS = 60000;

// Holds a subscriber token and replaces it before it expires.
//
// Without this, a token handed out once outlives its usefulness silently: the hub
// never closes an already-open stream, so the failure only surfaces on the next
// reconnection, which then loops on a 401 no listener reports.
export default class LiveSubscriberInfoResolver {
  private readonly fetchInfo: () => Promise<LiveSubscriberInfo>;
  private readonly renewMarginMs: number;
  private cached: LiveSubscriberInfo | null = null;
  private expiresAtMs: number = 0;
  private pending: Promise<LiveSubscriberInfo> | null = null;

  constructor(options: LiveSubscriberInfoResolverOptions) {
    this.fetchInfo = options.fetchInfo;
    this.renewMarginMs = options.renewMarginMs ?? DEFAULT_RENEW_MARGIN_MS;
  }

  resolve(): Promise<LiveSubscriberInfo> {
    if (this.cached && !this.isStale()) {
      return Promise.resolve(this.cached);
    }

    // Connections opening together share one request rather than each asking the
    // server for a token of its own.
    if (!this.pending) {
      this.pending = this.fetchInfo()
        .then((info) => {
          this.store(info);
          return info;
        })
        .finally(() => {
          this.pending = null;
        });
    }

    return this.pending;
  }

  // Drops the token so the next resolve() fetches: for a hub rejecting it for a
  // reason expiry does not explain.
  invalidate(): void {
    this.cached = null;
    this.expiresAtMs = 0;
  }

  private isStale(): boolean {
    return Date.now() >= this.expiresAtMs - this.renewMarginMs;
  }

  private store(info: LiveSubscriberInfo): void {
    const expiresAtMs = Date.parse(info.expiresAt);

    if (Number.isNaN(expiresAtMs)) {
      throw new LiveUpdatesError({
        message: `Unreadable expiresAt in subscriber info: ${info.expiresAt}`,
        code: 'ERR_LIVE_UPDATES_EXPIRES_AT_INVALID',
        context: { expiresAt: info.expiresAt },
      });
    }

    this.cached = info;
    this.expiresAtMs = expiresAtMs;
  }
}
