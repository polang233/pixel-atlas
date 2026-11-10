# Deploying Pixel Atlas

The site is a static Vite build on Cloudflare Pages. The streaming atlas (`public/atlas/`, about 340 MB, not in git) lives in an R2 bucket behind a custom domain. The site finds it through `VITE_ATLAS_BASE`, which Vite inlines at build time.

Planned addresses: site `https://pixelatlas.org`, atlas `https://cdn.pixelatlas.org/atlas/v1`.

## 1. Atlas on R2

1. **Bucket.** Cloudflare dashboard → R2 → Create bucket, for example `pixel-atlas`. Leave the public development URL (`r2.dev`) disabled.
2. **API token.** R2 → API Tokens → Manage → create a token with **Object Read & Write**, scoped to that bucket. Copy the Access Key ID and the Secret Access Key (shown once), and note your account ID.
3. **rclone remote.** Install [rclone](https://rclone.org/install/) 1.59 or newer, run `rclone config`, and create a remote named `r2`: type `s3`, provider `Cloudflare`. It ends up in `rclone.conf` like this (keep that file out of the repo):

   ```ini
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = <access key id>
   secret_access_key = <secret access key>
   endpoint = https://<account id>.r2.cloudflarestorage.com
   acl = private
   no_check_bucket = true
   ```

4. **Upload.** Build the atlas with `pipeline/build_atlas.py`, then:

   ```bash
   R2_BUCKET=pixel-atlas ./deploy/upload-atlas.sh --dry-run   # check first
   R2_BUCKET=pixel-atlas ./deploy/upload-atlas.sh
   ```

   `RCLONE_REMOTE` (default `r2`) and `ATLAS_PREFIX` (default `atlas/v1`) can be overridden. Objects get `Cache-Control: public, max-age=31536000, immutable`, so a rebuilt atlas must go to a new prefix (`ATLAS_PREFIX=atlas/v2`), followed by a change of `VITE_ATLAS_BASE`.
5. **CORS.** Bucket → Settings → CORS Policy → Add CORS policy → JSON tab, paste [`r2-cors.json`](r2-cors.json). Add any other origin that serves the site, such as Pages preview deployments (`https://*.<project>.pages.dev`) or a mirror. Origins are `scheme://host[:port]` with no trailing slash; one `*` wildcard per origin is allowed (`https://*.example.com`), but not in the port. This file is in the dashboard and S3 API format; `wrangler r2 bucket cors set` expects a different shape.
6. **Custom domain.** Bucket → Settings → Custom Domains → add `cdn.pixelatlas.org`. The `pixelatlas.org` zone must be in the same Cloudflare account.
7. **Check.**

   ```bash
   curl -sI -H 'Origin: https://pixelatlas.org' https://cdn.pixelatlas.org/atlas/v1/meta.json
   ```

   The response should carry `access-control-allow-origin` and the `cache-control` above. R2 only sends CORS headers when the request has an `Origin` header.

Notes:

- After any later change to the CORS policy, purge the cache for `cdn.pixelatlas.org` (Caching → Configuration → Purge), or cached objects keep their old CORS headers.
- Cloudflare caches `.webp`, `.png` and `.bin` at the edge by default, but not `.json`. To have the caption chunks cached at the edge too, add a Cache Rule for hostname `cdn.pixelatlas.org` with "Eligible for cache".

## 2. Site on Cloudflare Pages

1. Workers & Pages → Create → Pages → Connect to Git, pick this repo, production branch `main`.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Environment variable | `VITE_ATLAS_BASE` = `https://cdn.pixelatlas.org/atlas/v1` |

   The Node version comes from `.node-version`. Set the variable for Preview too if preview deployments should load the atlas, and allow their origin in the CORS policy.
3. Custom domains → add `pixelatlas.org` and `www.pixelatlas.org`.

Cache headers for the site come from `public/_headers`.

Without `VITE_ATLAS_BASE` the build falls back to `/atlas` on the site's own origin. That only works locally, where `public/atlas/` exists, so finish part 1 before the first production deploy. The variable is read at build time: after changing it, redeploy.

## Local check against another origin

```bash
VITE_ATLAS_BASE=https://cdn.pixelatlas.org/atlas/v1 npm run dev
```

`http://localhost:5173` must be among the allowed origins in the CORS policy.
