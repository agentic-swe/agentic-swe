# Static site: S3 + CloudFront

This project’s marketing/docs site can be deployed to AWS as a **private S3 bucket** in front of **CloudFront** (Origin Access Control). Objects are not publicly readable from S3; only the CloudFront distribution can read them.

For how this fits **product distribution** (public vs private repo, GitHub Pages, custom domains), see [distribution.md](../site/src/content/docs/distribution.md).

## Configure deploy (local only)

Do **not** commit real bucket names, distribution IDs, or account-specific values. Use environment variables:

1. Copy the example file:

   ```bash
   cp infra/.env.example infra/.env
   ```

2. Edit `infra/.env` with your **S3 bucket name**, **CloudFront distribution ID**, and optional **site URL** (from the AWS console).

`infra/.env` is listed in `.gitignore`.

## Deploy updates (from repo root)

```bash
./infra/deploy-static-site.sh
```

This runs **`npm run build:site`** (Vite + React in `site/` → output in **`site/dist/`**), then syncs **`site/dist/`** to the bucket and creates a **cache invalidation** for `/*`.

### SPA routing (CloudFront)

The marketing site is a **single-page app**: routes such as `/guide`, `/documentation`, and `/capabilities` are handled in the browser. Configure the distribution so **403 and 404 responses from S3** return **`/index.html`** with status **200** (custom error responses), or deep links and refreshes on those paths will fail.

Manual one-liner (after exporting the same variables):

```bash
aws s3 sync ./site/dist/ "s3://${S3_STATIC_BUCKET}/" --delete --region "${AWS_REGION:-us-east-1}"
aws cloudfront create-invalidation --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" --paths "/*"
```

After creation, CloudFront status is **InProgress** for several minutes before the URL returns `200`.

## Custom domain (optional)

1. Request an ACM certificate in **us-east-1** (required for CloudFront) for `www.example.com` or `example.com`.
2. In CloudFront → distribution → **Alternate domain names (CNAMEs)** → add the name; attach the ACM certificate.
3. In Route 53 (or your DNS), create an **Alias** A/AAAA record to the CloudFront distribution.

## Files

- `cloudfront-distribution-config.example.json` — example shape used once to create a distribution (replace placeholders with your account’s bucket domain and OAC ID).
- `.env.example` — variable names for `deploy-static-site.sh`.
