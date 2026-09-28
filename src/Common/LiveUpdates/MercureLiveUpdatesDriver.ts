import LiveUpdatesError from '../Errors/LiveUpdatesError';
import type {
  LiveUpdatesDriverConnectOptions,
  LiveUpdatesDriverInterface,
} from './LiveUpdatesDriver';

export type MercureDriverConfig = {
  hubUrl: string;
  jwt?: string | null;
  hubPath?: string;
  topicParamName?: string;
  jwtParamName?: string;
  withCredentials?: boolean;
  additionalParams?: Record<string, string | number | boolean>;
};

// Called on every connect, so a reconnection can carry a token the previous one no
// longer had — see LiveSubscriberInfoResolver.
export type MercureDriverConfigResolver = () => MercureDriverConfig | Promise<MercureDriverConfig>;

export default class MercureLiveUpdatesDriver implements LiveUpdatesDriverInterface {
  private readonly configResolver: MercureDriverConfigResolver;

  constructor(config: MercureDriverConfig | MercureDriverConfigResolver) {
    this.configResolver = typeof config === 'function' ? config : () => config;
  }

  // A synchronous resolver still opens synchronously: only a resolver that has to go
  // and fetch a token defers, and the interface has always allowed that.
  connect(options: LiveUpdatesDriverConnectOptions): EventSource | Promise<EventSource> {
    const config = this.configResolver();

    if (config instanceof Promise) {
      return config.then((resolved) => this.open(resolved, options));
    }

    return this.open(config, options);
  }

  private open(config: MercureDriverConfig, options: LiveUpdatesDriverConnectOptions): EventSource {
    const hubPath = config.hubPath ?? '/.well-known/mercure';
    const topicParamName = config.topicParamName ?? 'topic';
    // Mercure hubs expect the subscriber JWT in the "authorization" query
    // param (EventSource cannot set an Authorization header).
    const jwtParamName = config.jwtParamName ?? 'authorization';
    const withCredentials = config.withCredentials ?? true;

    if (!config.hubUrl) {
      throw new LiveUpdatesError({
        message: 'Mercure hubUrl is required.',
        code: 'ERR_MERCURE_HUB_URL_REQUIRED',
      });
    }

    const url = new URL(hubPath, config.hubUrl);

    options.topics.forEach((topic) => {
      url.searchParams.append(topicParamName, topic);
    });

    if (config.jwt) {
      url.searchParams.append(jwtParamName, config.jwt);
    }

    Object.entries(config.additionalParams || {}).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });

    return new EventSource(url.toString(), {
      withCredentials,
    });
  }
}
