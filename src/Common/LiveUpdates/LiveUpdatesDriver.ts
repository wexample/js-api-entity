// Transport abstraction for live updates: a driver only knows how to open
// an EventSource-like stream for a set of topics. Reconnection, parsing and
// topic knowledge live elsewhere (LiveUpdatesConnection, API clients).
export type LiveUpdatesDriverConnectOptions = {
  topics: string[];
};

// connect() may be async, e.g. when the driver has to fetch a fresh
// subscriber token before opening the stream.
export interface LiveUpdatesDriverInterface {
  connect(options: LiveUpdatesDriverConnectOptions): EventSource | Promise<EventSource>;
}
