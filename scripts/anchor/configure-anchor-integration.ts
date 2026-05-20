import { createApiToken } from '@documenso/lib/server-only/public-api/create-api-token';
import { createWebhook } from '@documenso/lib/server-only/webhooks/create-webhook';
import { prisma } from '@documenso/prisma';
import { WebhookTriggerEvents } from '@prisma/client';

const REQUIRED_EVENTS = [
  WebhookTriggerEvents.DOCUMENT_COMPLETED,
  WebhookTriggerEvents.DOCUMENT_RECIPIENT_COMPLETED,
  WebhookTriggerEvents.DOCUMENT_REJECTED,
  WebhookTriggerEvents.DOCUMENT_CANCELLED,
  WebhookTriggerEvents.RECIPIENT_EXPIRED,
  WebhookTriggerEvents.DOCUMENT_SENT,
];

const trimTrailingSlash = (value: string) => value.replace(/\/+$/u, '');

const requireEnv = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const optionalEnv = (key: string) => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

const parsePositiveInt = (key: string, value: string | null) => {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

async function resolveTeam(userId: number) {
  const teamId = parsePositiveInt('ANCHOR_INTEGRATION_TEAM_ID', optionalEnv('ANCHOR_INTEGRATION_TEAM_ID'));
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new Error(`No Documenso team found for ANCHOR_INTEGRATION_TEAM_ID=${teamId}`);
    }
    return team;
  }

  const teamName = optionalEnv('ANCHOR_INTEGRATION_TEAM_NAME');
  if (teamName) {
    const team = await prisma.team.findFirst({ where: { name: teamName }, orderBy: { id: 'asc' } });
    if (!team) {
      throw new Error(`No Documenso team found for ANCHOR_INTEGRATION_TEAM_NAME=${teamName}`);
    }
    return team;
  }

  const ownedTeam = await prisma.team.findFirst({
    where: {
      organisation: {
        ownerUserId: userId,
      },
    },
    orderBy: { id: 'asc' },
  });

  if (!ownedTeam) {
    throw new Error('No Documenso team found. Set ANCHOR_INTEGRATION_TEAM_ID or ANCHOR_INTEGRATION_TEAM_NAME.');
  }

  return ownedTeam;
}

async function main() {
  const userEmail = requireEnv('ANCHOR_INTEGRATION_USER_EMAIL').toLowerCase();
  const anchorAppUrl = trimTrailingSlash(requireEnv('ANCHOR_APP_URL'));
  const webhookSecret = requireEnv('ANCHOR_DOCUMENSO_WEBHOOK_SECRET');
  const webhookUrl = `${anchorAppUrl}/api/webhooks/agreements`;
  const tokenName = optionalEnv('ANCHOR_DOCUMENSO_TOKEN_NAME') ?? 'Anchor Production Integration';
  const createToken = process.env.ANCHOR_DOCUMENSO_CREATE_API_TOKEN === 'true';

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    throw new Error(`No Documenso user found for ANCHOR_INTEGRATION_USER_EMAIL=${userEmail}`);
  }

  const team = await resolveTeam(user.id);

  const existingWebhook = await prisma.webhook.findFirst({
    where: {
      teamId: team.id,
      webhookUrl,
    },
    orderBy: { createdAt: 'desc' },
  });

  const webhook = existingWebhook
    ? await prisma.webhook.update({
        where: { id: existingWebhook.id },
        data: {
          eventTriggers: REQUIRED_EVENTS,
          secret: webhookSecret,
          enabled: true,
          userId: user.id,
        },
      })
    : await createWebhook({
        webhookUrl,
        eventTriggers: REQUIRED_EVENTS,
        secret: webhookSecret,
        enabled: true,
        userId: user.id,
        teamId: team.id,
      });

  console.log(`Anchor webhook configured: ${webhook.webhookUrl}`);
  console.log(`Documenso team: ${team.name} (${team.id})`);

  if (createToken) {
    const { token } = await createApiToken({
      userId: user.id,
      teamId: team.id,
      tokenName,
      expiresIn: null,
    });
    console.log('Created API token. Store this once in Anchor as DOCUMENSO_API_TOKEN:');
    console.log(token);
  } else {
    console.log('API token was not created. Set ANCHOR_DOCUMENSO_CREATE_API_TOKEN=true to create one.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
