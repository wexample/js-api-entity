import type { RetryBackoffScheduleContext } from '@wexample/js-helpers/Common/RetryBackoffScheduler';
import type { ReconnectBackoffOptions } from '@wexample/js-helpers/Helper/Reconnect';
import LiveUpdatesConnection, { type LiveUpdatesConnectionStatus } from './LiveUpdatesConnection';
import type { LiveUpdatesDriverInterface } from './LiveUpdatesDriver';

export type LiveUpdatesSubscriptionOptions = {
  topics: string[];
  onMessage?: (payload: unknown, event: MessageEvent) => void;
  onStatusChange?: (
    status: LiveUpdatesConnectionStatus,
    previousStatus: LiveUpdatesConnectionStatus
  ) => void;
  onReconnectScheduled?: (context: RetryBackoffScheduleContext) => void;
};

export type LiveUpdatesSubscription = {
  getTopics(): string[];
  getStatus(): LiveUpdatesConnectionStatus;
  close(): void;
};

export type LiveUpdatesMultiplexerOptions = {
  driver: LiveUpdatesDriverInterface;
  reconnect?: ReconnectBackoffOptions;
  // How long the set of topics is left to settle before the stream is opened
  // again: the components of a page mount together, and ask for one stream.
  settleMs?: number;
  // Every stream opened, so whoever counts connections sees the one there is.
  onConnection?: (connection: LiveUpdatesConnection) => void;
};

type Entry = {
  topics: string[];
  options: LiveUpdatesSubscriptionOptions;
  status: LiveUpdatesConnectionStatus;
};

type Stream = {
  // Null while the connection is being built: building it may already report.
  connection: LiveUpdatesConnection | null;
  topics: Set<string>;
  key: string;
};

const DEFAULT_SETTLE_MS = 50;

// How many update ids are remembered to drop what two streams both delivered.
const RECENT_EVENT_IDS = 100;

// One stream for every subscriber of a page, instead of one each.
//
// A browser speaking HTTP/1.1 keeps six connections per host, and every stream
// held open is one fewer for the page's own requests: past a few live
// components, ajax calls queue behind them until they time out. Here the
// subscribers share a single connection opened on the union of their topics,
// and each one is handed what was published on its own.
//
// What travels has to say where it was published for that: the payload's
// `topics`, which symfony-live LivePublisherService adds. A payload without it
// goes to every subscriber, which is what a stream of their own gave them.
//
// The union changing opens a replacement next to the stream in place, which
// only steps aside once the replacement answers — no update is lost in the
// swap, and those both deliver reach their subscribers once.
export default class LiveUpdatesMultiplexer {
  private readonly driver: LiveUpdatesDriverInterface;
  private readonly reconnect?: ReconnectBackoffOptions;
  private readonly settleMs: number;
  private readonly onConnection?: (connection: LiveUpdatesConnection) => void;
  private readonly entries = new Set<Entry>();
  private readonly recentEventIds: string[] = [];
  private stream: Stream | null = null;
  private pending: Stream | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveUpdatesMultiplexerOptions) {
    this.driver = options.driver;
    this.reconnect = options.reconnect;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.onConnection = options.onConnection;
  }

  subscribe(options: LiveUpdatesSubscriptionOptions): LiveUpdatesSubscription {
    const entry: Entry = {
      topics: [...options.topics],
      options,
      status: 'connecting',
    };

    this.entries.add(entry);

    // Already served: told so once the caller holds its subscription.
    if (this.stream && this.covers(this.stream, entry)) {
      const stream = this.stream;
      queueMicrotask(() => {
        if (this.entries.has(entry) && this.stream === stream && stream.connection) {
          this.announce(entry, stream.connection.getStatus());
        }
      });
    }

    this.scheduleSync();

    return {
      getTopics: () => [...entry.topics],
      getStatus: () => entry.status,
      close: () => this.unsubscribe(entry),
    };
  }

  getConnection(): LiveUpdatesConnection | null {
    return this.stream?.connection ?? null;
  }

  close(): void {
    this.entries.clear();
    this.closeStreams();
  }

  private unsubscribe(entry: Entry): void {
    if (!this.entries.delete(entry)) {
      return;
    }

    if (!this.entries.size) {
      this.closeStreams();
      return;
    }

    // Narrowed too, not only widened: the hub's list of who listens where is
    // what a server reads to know whether anyone is still looking.
    this.scheduleSync();
  }

  private scheduleSync(): void {
    if (this.settleTimer) {
      return;
    }

    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.sync();
    }, this.settleMs);
  }

  private sync(): void {
    if (!this.entries.size) {
      this.closeStreams();
      return;
    }

    const topics = new Set<string>();
    this.entries.forEach((entry) => entry.topics.forEach((topic) => topics.add(topic)));
    const key = [...topics].sort().join('\n');

    if ((this.pending ?? this.stream)?.key === key) {
      return;
    }

    const previous = this.pending ?? this.stream;
    const stream: Stream = { connection: null, topics, key };

    // A replacement not yet answering is replaced in turn, not stacked.
    const superseded = this.pending;
    if (this.stream) {
      this.pending = stream;
    } else {
      this.stream = stream;
    }
    superseded?.connection?.close();

    stream.connection = new LiveUpdatesConnection({
      driver: this.driver,
      topics: [...topics],
      reconnect: this.reconnect,
      lastEventId: previous?.connection?.getLastEventId() ?? null,
      onMessage: (payload, event) => this.dispatch(payload, event),
      onStatusChange: (status) => this.handleStatus(stream, status),
      onReconnectScheduled: (context) => this.handleReconnectScheduled(stream, context),
    });

    this.onConnection?.(stream.connection);
  }

  private handleStatus(stream: Stream, status: LiveUpdatesConnectionStatus): void {
    if (stream === this.pending) {
      // The replacement takes over as soon as it has anything to say — open, or
      // failing, which is then the truth about the topics the page wants.
      if (status === 'connecting' || status === 'closed') {
        return;
      }

      const replaced = this.stream;
      this.stream = stream;
      this.pending = null;
      replaced?.connection?.close();
    } else if (stream !== this.stream) {
      return;
    }

    this.entries.forEach((entry) => {
      if (this.covers(stream, entry)) {
        this.announce(entry, status);
      }
    });
  }

  private handleReconnectScheduled(stream: Stream, context: RetryBackoffScheduleContext): void {
    if (stream !== this.stream) {
      return;
    }

    this.entries.forEach((entry) => {
      if (this.covers(stream, entry)) {
        entry.options.onReconnectScheduled?.(context);
      }
    });
  }

  private dispatch(payload: unknown, event: MessageEvent): void {
    // Two streams overlap during a swap, and both carry what is published then.
    if (event.lastEventId) {
      if (this.recentEventIds.includes(event.lastEventId)) {
        return;
      }

      this.recentEventIds.push(event.lastEventId);
      if (this.recentEventIds.length > RECENT_EVENT_IDS) {
        this.recentEventIds.shift();
      }
    }

    const topics = this.readTopics(payload);

    Array.from(this.entries).forEach((entry) => {
      if (!topics || entry.topics.some((topic) => topics.includes(topic))) {
        entry.options.onMessage?.(payload, event);
      }
    });
  }

  private readTopics(payload: unknown): string[] | null {
    const topics = (payload as { topics?: unknown } | null)?.topics;

    return Array.isArray(topics) ? topics.filter((topic) => typeof topic === 'string') : null;
  }

  private covers(stream: Stream, entry: Entry): boolean {
    return entry.topics.every((topic) => stream.topics.has(topic));
  }

  private announce(entry: Entry, status: LiveUpdatesConnectionStatus): void {
    if (entry.status === status) {
      return;
    }

    const previousStatus = entry.status;
    entry.status = status;
    entry.options.onStatusChange?.(status, previousStatus);
  }

  private closeStreams(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }

    const streams = [this.pending, this.stream];
    this.pending = null;
    this.stream = null;
    streams.forEach((stream) => stream?.connection?.close());
  }
}
