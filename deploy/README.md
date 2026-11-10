# Deploying Pixel Atlas

The site is a static Vite build served as a static-assets-only Cloudflare Worker (new Cloudflare Pages projects are created as Workers now). The streaming atlas (`public/atlas/`, about 340 MB and 3,000 files, not in git) lives in an R2 bucket behind a custom domain. The site finds it through `VITE_ATLAS_BASE`, which Vite inlines at build time.

Addresses: site `https://pixelatlas.org` (and `www`), atlas `https://cdn.pixelatlas.org/atlas/v1`.

Everything below runs with Wrangler (a dev dependency) after `npx wrangler login`. The `pixelatlas.org` zone must be in the same Cloudflare account.

## 1. Atlas on R2

1. **Enable R2** once in the dashboard (R2 → enable; the free tier needs a payment method on file).
2. **Bucket:**

   ```bash
   npx wrangler r2 bucket create pixel-atlas
   ```

3. **Upload.** Build the atlas with `pipeline/build_atlas.py`, then:

   ```bash
   R2_BUCKET=pixel-atlas ./deploy/upload-atlas-wrangler.sh
   ```

   It uploads in parallel (`JOBS`, default 8) with `Cache-Control: public, max-age=31536000, immutable`, so a rebuilt atlas must go to a new prefix (`ATLAS_PREFIX=atlas/v2`), followed by a change of `VITE_ATLAS_BASE`. If you prefer the S3 API, `upload-atlas.sh` does the same with rclone (needs an R2 API token).
4. **CORS.** Bucket → Settings → CORS Policy → JSON tab, paste [`r2-cors.json`](r2-cors.json). Origins are `scheme://host[:port]` with no trailing slash; one `*` per origin is allowed (`https://*.example.com`), not in the port. Add any mirror's exact origin, such as the Hugging Face Space.
5. **Custom domain.** Bucket → Settings → Custom Domains → add `cdn.pixelatlas.org`.
6. **Check.**

   ```bash
   curl -sI -H 'Origin: https://pixelatlas.org' https://cdn.pixelatlas.org/atlas/v1/meta.json
   ```

   The response should carry `access-control-allow-origin` and the `cache-control` above. R2 only sends CORS headers when the request has an `Origin` header.

Notes:

- After a change to the CORS policy, purge the cache for `cdn.pixelatlas.org`, or cached objects keep their old headers.
- Cloudflare caches `.webp`, `.png` and `.bin` at the edge by default, but not `.json`. To cache the caption chunks too, add a Cache Rule for `cdn.pixelatlas.org` with "Eligible for cache".

## 2. Site

```bash
npm run deploy
```

This builds with `VITE_ATLAS_BASE=https://cdn.pixelatlas.org/atlas/v1` (override it in the environment), removes `dist/atlas`, and runs `wrangler deploy --config deploy/wrangler.jsonc`, which also attaches `pixelatlas.org` and `www.pixelatlas.org` as custom domains. Cache headers come from `public/_headers`. Finish part 1 first: without the atlas on R2 the deployed site cannot load the planet.

Do not run bare `wrangler deploy` or `wrangler pages project create` in the repo root: recent Wrangler versions then auto-configure the project and rewrite `package.json` and the Vite config.

## Local check against another origin

```bash
VITE_ATLAS_BASE=https://cdn.pixelatlas.org/atlas/v1 npm run dev
```

The dev server's origin (for example `http://localhost:5179`) must be in the CORS policy.
