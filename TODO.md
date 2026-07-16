# MindAtlas — Production Fix List

## Priority 1: Database table name fix
- [ ] Full sweep of all `"user"` references → change to `users` across entire codebase (items service, keys, webhooks, middleware, etc.)

## Priority 2: Items not working
- [ ] Debug why items can't be added — check items routes/service for `"user"` table refs or other issues
- [ ] Verify items CRUD works end-to-end after table name fix

## Priority 3: User profile/settings
- [ ] Fix inability to change user information — identify which endpoint handles profile updates and fix table refs

## Priority 4: Admin Console access
- [ ] Fix `/admin` returning "Authentication required" — the admin SPA route needs the JWT token passed correctly (client-side routing issue vs API route conflict)
- [ ] Verify MFA gate works with `mfa_enabled: false`
- [ ] Test admin credential management page (OpenAI, Twilio, Stripe config)

## Priority 5: Deployment automation
- [ ] Add `npm run migrate:up` to Docker entrypoint or CI/CD deploy step
- [ ] Configure GitHub Actions secrets: `LIGHTSAIL_HOST`, `LIGHTSAIL_USER`, `LIGHTSAIL_SSH_KEY`, `GHCR_TOKEN`
- [ ] Test auto-deploy on push to main

## Priority 6: Security
- [ ] Rotate database password (connection string was exposed in chat)
- [ ] Verify `.env` on Lightsail has production-grade JWT and encryption secrets (not dev defaults)
