# Supabase JavaScript client (browser build)

- Package: `@supabase/supabase-js`
- Version: 2.118.0 (published 2026-10-15)
- File: `supabase-js-2.118.0.umd.js` (the package's own `dist/umd/supabase.js`, renamed to carry the version; not modified)
- Source: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js`, byte-identical to `dist/umd/supabase.js` inside the npm tarball
- npm tarball integrity: `sha512-FxI8UXMVC2UG7IkeiI8fuQZqq2oI3JeSuN8MPIC2RLVaoEAxKS0nqE6kii9Ewpq8f9gNPM6git1Y8f0vN/QLFw==` (recomputed from the downloaded tarball and equal to the npm registry value; the npm record carries provenance attestations)
- Size: 218,252 bytes
- SHA-256: `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3`
- Subresource Integrity: `sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK`
- License: MIT; see `LICENSE.txt` (copied from the package).

It is a classic script that defines the global `supabase`. `index.html` loads it from the same origin with the `integrity` attribute above, and `config/supabase.js` calls `supabase.createClient(url, anonKey)`. Nothing is imported from a CDN at run time. `.gitattributes` marks this directory `-text` so a checkout never rewrites the bytes that the hash covers.

The full dependency list, with every other runtime asset and what is and is not verified, is `../dependency-manifest.json`. The update and rollback procedure is in `docs/03_Development_Workflow.md`, section "Updating a runtime dependency".

## Re-verifying this file

```bash
npm view @supabase/supabase-js@2.118.0 dist.integrity
curl -sL https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.118.0.tgz -o supabase-js.tgz
openssl dgst -sha512 -binary supabase-js.tgz | openssl base64 -A   # must equal the value above, after the "sha512-" prefix
tar xzf supabase-js.tgz package/dist/umd/supabase.js
sha256sum package/dist/umd/supabase.js vendor/supabase/supabase-js-2.118.0.umd.js
```
