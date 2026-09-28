import type LiveUpdatesConnection from './LiveUpdatesConnection';
import type { LiveUpdatesConnectionStatus } from './LiveUpdatesConnection';

// Aggregated view of every registered connection, one counter per
// non-closed status; hasActiveConnection is true when at least one
// connection is open.
export type LiveUpdatesAggregatedStatus = {
  total: number;
  connecting: number;
  reconnecting: number;
  open: number;
  error: number;
  reconnectStopped: number;
  hasActiveConnection: boolean;
};

export type LiveUpdatesRegistryEvent =
  | {
      type: 'connection-registered';
      connection: LiveUpdatesConnection;
      aggregated: LiveUpdatesAggregatedStatus;
    }
  | {
      type: 'connection-status';
      connection: LiveUpdatesConnection;
      status: LiveUpdatesConnectionStatus;
      previousStatus: LiveUpdatesConnectionStatus;
      aggregated: LiveUpdatesAggregatedStatus;
    }
  | {
      type: 'connection-message';
      connection: LiveUpdatesConnection;
      payload: unknown;
      aggregated: LiveUpdatesAggregatedStatus;
    }
  | {
      type: 'connection-unregistered';
      connection: LiveUpdatesConnection;
      aggregated: LiveUpdatesAggregatedStatus;
    };

export type LiveUpdatesRegistryListener = (event: LiveUpdatesRegistryEvent) => void;

// Tracks the live connections of a client and exposes their aggregated
// status plus lifecycle events, so a UI (status widget, activity dot) can
// reflect real connections without owning them. Connections are registered
// by whoever creates them and unregister themselves when closed.
export default class LiveUpdatesConnectionRegistry {
  private readonly entries = new Map<LiveUpdatesConnection, () => void>();
  private readonly listeners = new Set<LiveUpdatesRegistryListener>();

  register(connection: LiveUpdatesConnection): void {
    if (this.entries.has(connection) || connection.getStatus() === 'closed') {
      return;
    }

    const unobserve = connection.observe({
      onStatusChange: (status, previousStatus) => {
        if (status === 'closed') {
          this.unregister(connection);
          return;
        }

        this.emit({
          type: 'connection-status',
          connection,
          status,
          previousStatus,
          aggregated: this.getAggregatedStatus(),
        });
      },
      onMessage: (payload) => {
        this.emit({
          type: 'connection-message',
          connection,
          payload,
          aggregated: this.getAggregatedStatus(),
        });
      },
    });

    this.entries.set(connection, unobserve);
    this.emit({
      type: 'connection-registered',
      connection,
      aggregated: this.getAggregatedStatus(),
    });
  }

  unregister(connection: LiveUpdatesConnection): void {
    const unobserve = this.entries.get(connection);
    if (!unobserve) {
      return;
    }

    unobserve();
    this.entries.delete(connection);
    this.emit({
      type: 'connection-unregistered',
      connection,
      aggregated: this.getAggregatedStatus(),
    });
  }

  getConnections(): LiveUpdatesConnection[] {
    return [...this.entries.keys()];
  }

  getAggregatedStatus(): LiveUpdatesAggregatedStatus {
    const aggregated: LiveUpdatesAggregatedStatus = {
      total: this.entries.size,
      connecting: 0,
      reconnecting: 0,
      open: 0,
      error: 0,
      reconnectStopped: 0,
      hasActiveConnection: false,
    };

    for (const connection of this.entries.keys()) {
      switch (connection.getStatus()) {
        case 'connecting':
          aggregated.connecting += 1;
          break;
        case 'reconnecting':
          aggregated.reconnecting += 1;
          break;
        case 'open':
          aggregated.open += 1;
          break;
        case 'error':
          aggregated.error += 1;
          break;
        case 'reconnect-stopped':
          aggregated.reconnectStopped += 1;
          break;
      }
    }

    aggregated.hasActiveConnection = aggregated.open > 0;

    return aggregated;
  }

  // Registers a listener notified on every lifecycle event; returns its
  // unsubscribe function.
  onEvent(listener: LiveUpdatesRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: LiveUpdatesRegistryEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
