# Plan #16 — Redeploy so Disponibilité button is live

> Task #16 · Status: MERGED

## What & Why
The "Disponibilité" link in the top-right of the main dashboard, the public availability dashboard at `/availability.html`, the multi-page PDF export with repeated banner, the touch-friendly submodule reordering, and the live readiness fix on the exam page have all been merged to the codebase but never published. The currently deployed production site still serves the old build. Redeploy so users see all of this on the live `.replit.app` URL.

## Done looks like
- The deployed site shows the **Disponibilité** button in the top bar of the main dashboard, next to "Set identity".
- Visiting `/availability.html` on the deployed site loads the public availability dashboard with year + wilaya filters and the six level cards.
- Hard-refreshing the deployed dashboard no longer requires bypassing cache to see the new button.

## Out of scope
- Any new features. This is a deploy-only task.
- Changes to deployment region, machine size, or domain configuration.

## Tasks
1. **Pre-flight check** — Confirm the app starts cleanly with `node server.js`, the main dashboard loads, the Disponibilité link is present, and `/availability.html` renders without errors in the dev preview.
2. **Trigger publish** — Surface the publish action so the user can deploy the latest build with one click.
3. **Post-publish smoke test** — After the user publishes, confirm the live site shows the Disponibilité button and the availability page responds.

## Relevant files
- `public/index.html:269-287`
- `public/availability.html`
- `server.js`
