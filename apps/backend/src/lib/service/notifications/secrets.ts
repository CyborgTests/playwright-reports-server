import {
  isOpaqueMaskSentinel,
  isUrlMaskSentinel,
  type NotificationChannel,
  type NotificationsConfig,
  SECRET_MASK,
  type SlackChannelConfig,
  type WebhookChannelConfig,
} from '@playwright-reports/shared';

function maskUrl(url: string): string {
  if (!url) return SECRET_MASK;
  if (url.length <= 16) return SECRET_MASK;
  return `${url.slice(0, 14)}…${SECRET_MASK}`;
}

function maskOpaque(_value: string): string {
  return SECRET_MASK;
}

function maskHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const isSensitive =
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower.endsWith('-token') ||
      lower.endsWith('-secret');
    masked[name] = isSensitive ? maskOpaque(value) : value;
  }
  return masked;
}

export function maskChannel(channel: NotificationChannel): NotificationChannel {
  if (channel.type === 'slack') {
    const config = channel.config as SlackChannelConfig;
    return {
      ...channel,
      config: { webhookUrl: maskUrl(config.webhookUrl) },
    };
  }
  const config = channel.config as WebhookChannelConfig;
  return {
    ...channel,
    config: {
      url: maskUrl(config.url),
      headers: maskHeaders(config.headers),
      secretHmacKey: config.secretHmacKey ? maskOpaque(config.secretHmacKey) : undefined,
    },
  };
}

export function maskNotifications(config: NotificationsConfig): NotificationsConfig {
  return {
    enabled: config.enabled,
    channels: config.channels.map(maskChannel),
  };
}

export function mergeWithStored(
  incoming: NotificationsConfig,
  stored: NotificationsConfig | undefined
): NotificationsConfig {
  if (!stored) return incoming;
  const storedById = new Map(stored.channels.map((c) => [c.id, c]));

  const channels = incoming.channels.map((channel) => {
    const prior = storedById.get(channel.id);
    if (!prior) return channel;

    if (channel.type === 'slack' && prior.type === 'slack') {
      const next = channel.config as SlackChannelConfig;
      const prev = prior.config as SlackChannelConfig;
      return {
        ...channel,
        config: {
          webhookUrl: isUrlMaskSentinel(next.webhookUrl) ? prev.webhookUrl : next.webhookUrl,
        },
      };
    }

    if (channel.type === 'webhook' && prior.type === 'webhook') {
      const next = channel.config as WebhookChannelConfig;
      const prev = prior.config as WebhookChannelConfig;
      const headers = next.headers ? { ...next.headers } : undefined;
      if (headers && prev.headers) {
        for (const [k, v] of Object.entries(headers)) {
          if (isOpaqueMaskSentinel(v) && prev.headers[k]) headers[k] = prev.headers[k];
        }
      }
      return {
        ...channel,
        config: {
          url: isUrlMaskSentinel(next.url) ? prev.url : next.url,
          headers,
          secretHmacKey:
            next.secretHmacKey && isOpaqueMaskSentinel(next.secretHmacKey)
              ? prev.secretHmacKey
              : next.secretHmacKey,
        },
      };
    }

    return channel;
  });

  return { enabled: incoming.enabled, channels };
}
