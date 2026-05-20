import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { fetchWithTimeout } from '../../utils/timeout';
import { assertNotPrivateUrl } from './assert-webhook-url';

const WEBHOOK_TIMEOUT_MS = 10_000;

const ANCHOR_AGREEMENTS_WEBHOOK_PATH = '/api/webhooks/agreements';

const ANCHOR_WEBHOOK_EVENT_MAP: Record<string, string> = {
  DOCUMENT_COMPLETED: 'document.completed',
  DOCUMENT_RECIPIENT_COMPLETED: 'document.signed',
  DOCUMENT_SIGNED: 'document.signed',
  DOCUMENT_REJECTED: 'document.rejected',
  DOCUMENT_CANCELLED: 'document.rejected',
  RECIPIENT_EXPIRED: 'document.expired',
  DOCUMENT_SENT: 'document.sent',
  DOCUMENT_OPENED: 'document.opened',
};

export type WebhookCallResult = {
  success: boolean;
  responseCode: number;
  responseBody: Prisma.InputJsonValue | Prisma.JsonNullValueInput;
  responseHeaders: Record<string, string>;
};

const parseBody = (text: string): Prisma.InputJsonValue => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const shouldUseAnchorAgreementsPayload = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith(ANCHOR_AGREEMENTS_WEBHOOK_PATH);
  } catch {
    return false;
  }
};

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const createAnchorAgreementsPayload = (body: unknown) => {
  const bodyRecord = toRecord(body);
  const payload = toRecord(bodyRecord.payload);
  const event = typeof bodyRecord.event === 'string' ? bodyRecord.event : 'unknown';
  const documentId = typeof payload.id === 'number' ? payload.id : null;
  const createdAt = typeof bodyRecord.createdAt === 'string' ? bodyRecord.createdAt : new Date().toISOString();

  return {
    ...bodyRecord,
    event: ANCHOR_WEBHOOK_EVENT_MAP[event] ?? event,
    data: {
      ...payload,
      id: `${event}:${documentId ?? 'unknown'}:${createdAt}`,
      documentId,
      externalId: typeof payload.externalId === 'string' ? payload.externalId : null,
    },
  };
};

export const executeWebhookCall = async (options: {
  url: string;
  body: unknown;
  secret: string | null;
}): Promise<WebhookCallResult> => {
  const { url, body, secret } = options;

  try {
    await assertNotPrivateUrl(url);

    const requestBody = shouldUseAnchorAgreementsPayload(url) ? createAnchorAgreementsPayload(body) : body;
    const serializedBody = JSON.stringify(requestBody);
    const hmacSignature = createHmac('sha256', secret ?? '')
      .update(serializedBody)
      .digest('hex');

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      body: serializedBody,
      redirect: 'manual',
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Secret': secret ?? '',
        'x-documenso-signature-256': hmacSignature,
      },
    });

    const text = await response.text();

    return {
      success: response.ok,
      responseCode: response.status,
      responseBody: parseBody(text),
      responseHeaders: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    return {
      success: false,
      responseCode: 0,
      responseBody: err instanceof Error ? err.message : 'Unknown error',
      responseHeaders: {},
    };
  }
};
