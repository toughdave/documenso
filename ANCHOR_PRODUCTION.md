# Anchor Production Deployment

This fork contains compatibility code required by Anchor Coaching. Production
must deploy this fork/branch, not the upstream `documenso/documenso:latest`
image.

Recommended public origin:

```text
https://sign.theanchorcoach.com
```

Anchor webhook target:

```text
https://www.theanchorcoach.com/api/webhooks/agreements
```

## Docker Compose

The production Compose file builds this repository with `docker/Dockerfile` and
tags it as `toughdave/documenso-anchor:latest` unless `DOCUMENSO_IMAGE` is set.

```bash
cp docker/production/.env.anchor.example docker/production/.env
# edit docker/production/.env in the server secret store; do not commit it
docker compose --env-file docker/production/.env -f docker/production/compose.yml up -d --build
```

Run migrations before accepting traffic:

```bash
docker compose --env-file docker/production/.env -f docker/production/compose.yml exec documenso \
  npm run prisma:migrate-deploy
```

Mount the production signing certificate at:

```text
/opt/documenso/cert.p12
```

and set `NEXT_PRIVATE_SIGNING_PASSPHRASE`.

## Render/Railway

If deploying through a PaaS, point the service at this repository/branch and use
the repo Dockerfile or Node 24.13.1 with npm 11.11.0. The included `render.yaml`
has been updated to those runtime versions.

Do not configure the PaaS to pull `documenso/documenso:latest`; that image does
not contain Anchor's V1 JSON/base64 create flow, short-lived download URL, or
Anchor webhook payload/HMAC compatibility.

## One-Time Integration Setup

After the production admin user and team exist, run:

```bash
npm run anchor:configure-integration
```

Required env:

```bash
ANCHOR_APP_URL=https://www.theanchorcoach.com
ANCHOR_INTEGRATION_USER_EMAIL=<documenso-admin-email>
ANCHOR_DOCUMENSO_WEBHOOK_SECRET=<same-secret-set-as-anchor-DOCUMENSO_WEBHOOK_SECRET>
```

Optional team selectors:

```bash
ANCHOR_INTEGRATION_TEAM_ID=<team-id>
ANCHOR_INTEGRATION_TEAM_NAME=<team-name>
```

Create the Anchor API token once:

```bash
ANCHOR_DOCUMENSO_CREATE_API_TOKEN=true npm run anchor:configure-integration
```

Store the printed token as `DOCUMENSO_API_TOKEN` in the Anchor production app.

The script creates or updates a webhook with these event triggers:

```text
DOCUMENT_COMPLETED
DOCUMENT_RECIPIENT_COMPLETED
DOCUMENT_REJECTED
DOCUMENT_CANCELLED
RECIPIENT_EXPIRED
DOCUMENT_SENT
```

## Production Smoke

After Anchor and Documenso are both deployed, run this from the Anchor app
environment:

```bash
npm run smoke:documenso
```

Then perform one full manual signing pass:

1. Start an agreement from Anchor `/agreements`.
2. Sign on `https://sign.theanchorcoach.com`.
3. Confirm the Documenso webhook call succeeds.
4. Confirm Anchor marks the agreement signed.
5. Confirm the signed PDF downloads from Anchor storage.
