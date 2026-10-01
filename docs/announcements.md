# Announcement cards for Telegram and X

When a new `ecosystem/<slug>.json` is merged into `main`, the existing
announcement workflow renders a card from its `name` and `logo` and attaches
the same PNG to both announcements: Telegram sends it as a photo with the
existing HTML caption, and X uploads it and attaches it to the existing post
text. Neither channel's text changes.

If the card can't be rendered, Telegram still sends its text announcement,
while X sends nothing.

## Render

```sh
npm ci
npx playwright install chromium
npm run preview:announcement -- telegram-wallet vooi insilico-terminal
```

Each argument is a filename stem in `ecosystem/`. The renderer reads `name`
and `logo` directly from that JSON, resolves `/logos/...` under `public/`, and
writes a 1600 × 900 PNG to `output/announcements/<slug>.png`. All rendering is
offline. The layout uses the approved first composition, the wording
`is live on Lit Hub`, and no logo construction lines.

Long names wrap and shrink within the title area. Original logos retain their
aspect ratio. PNG, JPEG, SVG, WebP, AVIF, GIF and ICO use Chromium's image decoder.
An empty logo produces initials; a configured missing or invalid logo fails
instead of silently substituting another project's logo.

The bundled **Arimo** font is an open, Arial-metric-compatible alternative in
the Helvetica style. It is not the proprietary Helvetica font. Bundling it
keeps the same typeface on macOS and Linux without redistributing a system font.

## Local checks

```sh
npm test
```

The X integration (`scripts/x-card.mjs`) uploads a generated PNG with
`POST /2/media/upload`, then sends the existing post text and returned media ID
to `POST /2/tweets`. Upload failure prevents a text-only post.

Telegram receives the PNG as a multipart `sendPhoto` upload. `chat_id`,
`caption` and `parse_mode` go in the query string, because multipart encoding
would turn the caption's line breaks into `\r\n`. If Telegram rejects the
photo, the text is sent on its own, as before.

Tests use a fake transport and fake credentials; they do not contact X or
Telegram or read real secrets. There are no automatic publication retries.

## Workflow and safe previews

The workflow installs locked dependencies and Chromium, then runs
`scripts/notify-telegram.mjs`. It uses the existing `X_API_KEY`, `X_API_SECRET`,
`X_ACCESS_TOKEN`, and `X_ACCESS_SECRET` secrets; no AI service or extra credential
is needed. Rendering is deterministic with bundled fonts and local logos.

For an end-to-end preview without publishing to **either** channel:

```sh
DRY_RUN=true SLUG=telegram-wallet,vooi node scripts/notify-telegram.mjs
```

This writes, for each slug, the card (`<slug>.png`), the X post text
(`<slug>.txt`) and the Telegram caption (`<slug>.telegram.txt`) to
`output/announcements/`, even when no secrets are set. Manual workflow runs default to `dry_run: true`;
uncheck it only when intentionally publishing the requested slugs. Automatic
push runs still publish newly added projects. Editing an existing listing does
not reannounce it, and merging changes to the renderer alone sends no posts.

Before posting, the notifier waits for the project's page
(`https://lit-hub.org/ecosystem/<slug>`) to load, checking every 15 seconds for
up to 10 minutes, since the site only lists a project once it has picked up the
rebuilt index. If the page never loads, nothing is posted for that project and
the run fails; once the page is live, run the workflow manually with that slug
and `dry_run` unchecked. Dry runs don't wait.

Generated cards and text are saved as workflow artifacts for 14 days, including
cards generated before a failed upload. A separate pull-request workflow tests
the renderer and fake X transport on Linux and saves previews without secrets.
On an Ubuntu runner Chromium is installed with
`npx playwright install --with-deps chromium`.

Do not re-run a live workflow indiscriminately after partial channel success;
the existing notifier does not deduplicate already-published announcements.

Sources: [X upload reference](https://docs.x.com/x-api/media/upload-media.md)
(OpenAPI accepts OAuth 1.0a `UserToken`), and
[X create-post reference](https://docs.x.com/x-api/posts/create-post).
Real account permissions and end-to-end publication have not been tested.

## Examples

These PNGs were rendered from the catalog with the bundled fonts.

![Telegram Wallet](announcement-examples/telegram-wallet.png)
![Vooi](announcement-examples/vooi.png)
![Insilico Terminal](announcement-examples/insilico-terminal.png)
