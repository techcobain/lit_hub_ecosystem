# Lit Hub Ecosystem

Public ecosystem data for [Lit Hub](https://www.lit-hub.org).

This repository is the source for project listings and Request a Protocol entries shown on Lit Hub. Each project is stored as a JSON file in `ecosystem/`, protocol requests are stored in `request-a-protocol/`, logos live in `public/logos/`, and generated indexes in `public/` are consumed by the website.

## Repository Structure

```txt
ecosystem/<slug>.json          Project listing data
request-a-protocol/<slug>.json               Request a Protocol data
public/logos/<slug>_logo.<ext> Logo assets
public/ecosystem.json          Generated project index
public/request-a-protocol.json               Generated protocol request index
scripts/build-ecosystem.mjs    Index builder
scripts/build-request-a-protocol.mjs         Protocol request index builder
.github/workflows/build-ecosystem.yml
```

## Add A Project

1. Create a new JSON file in `ecosystem/`.
   - Use a lowercase slug with hyphens, for example `my-project.json`.
   - The slug is taken from the filename.
2. Add the project logo to `public/logos/`, if available.
3. Point the project `logo` field to `/logos/<filename>`.
4. Open a pull request against this repository.

Example:

```json
{
  "name": "My Project",
  "description": "Short one-line description.",
  "url": "https://example.com",
  "twitter": "https://x.com/example",
  "discord": "",
  "telegram": "",
  "logo": "/logos/my-project_logo.png",
  "categories": ["Apps"],
  "status": "Live",
  "official": false
}
```

At least one useful public link should be provided. If `url` is empty, Lit Hub can fall back to another provided link such as Twitter, Telegram, or Discord.

## Edit A Project

Edit the existing file in `ecosystem/` and open a pull request.

Common edits include:

- Updating the project name or description.
- Changing links.
- Updating categories.
- Replacing a logo.
- Changing status.

Keep descriptions short. They are displayed on project cards and should be easy to scan.

## Remove A Project

Open a pull request that removes the project JSON file from `ecosystem/`.

If the project has a logo that is no longer used by any other listing, remove the related file from `public/logos/` in the same pull request.

## Add A Request a Protocol Entry

Request a Protocol entries are community requests for things people want builders to create.

1. Create a new JSON file in `request-a-protocol/`.
   - Use a lowercase slug with hyphens, for example `portfolio-pnl-dashboard.json`.
   - The slug is taken from the filename.
2. Fill out the title, summary, description, category, status, and creation date.
3. Add optional links if useful.
4. Add public contact details only if the submitter explicitly wants builders to contact them publicly.
5. Open a pull request against this repository.

Example:

```json
{
  "title": "Portfolio PnL dashboard",
  "summary": "A dashboard showing realized and unrealized PnL across Lighter accounts.",
  "description": "Builders should be able to track account-level PnL, open positions, funding, and historical performance.",
  "category": "Data",
  "status": "Open",
  "createdAt": "2026-06-10",
  "links": [],
  "contact": {
    "channel": "telegram",
    "handle": "@example"
  }
}
```

If the submitter does not want their contact to be public, use:

```json
"contact": null
```

Do not add private submitter contact details to public protocol request files.

## Edit Or Remove A Request a Protocol Entry

To edit a protocol request, change the relevant file in `request-a-protocol/` and open a pull request.

To remove a protocol request, open a pull request that removes the relevant JSON file from `request-a-protocol/`.

## Logo Guidelines

Logos should be stored in `public/logos/`.

Recommended naming:

```txt
public/logos/<slug>_logo.png
public/logos/<slug>_logo.jpg
public/logos/<slug>_logo.svg
```

Supported formats include PNG, JPG, SVG, WebP, AVIF, and ICO.

Use these rules:

- Prefer square images when possible.
- Keep files reasonably small.
- Use transparent backgrounds when the mark needs it.
- Use white or transparent padding if the mark gets cropped visually.
- Do not include private contact details or submitter information in project files.
- If no logo is available, leave `"logo": ""`; the website will use a fallback icon.

When replacing a logo, keep the same filename if possible so existing references continue to work. If you change the filename, update the project JSON `logo` field.

## Categories

Use one or two categories.

Current categories:

```txt
Agents
Apps
Bots
Copytrade
Data
Developers
Lending
Taxes
Terminal
Yield
```

The first category is treated as the primary category on the ecosystem map.

## Generated Index

The website does not fetch every source file individually. It fetches generated indexes:

```txt
public/ecosystem.json
public/request-a-protocol.json
```

Those files are generated from all project and protocol request JSON files.

After changes are merged into `main`, the GitHub Action in `.github/workflows/build-ecosystem.yml` runs:

```bash
node scripts/build-ecosystem.mjs
node scripts/build-request-a-protocol.mjs
```

If `public/ecosystem.json` or `public/request-a-protocol.json` changes, the action commits the regenerated index back to `main`.

You can also regenerate it locally before opening a pull request:

```bash
node scripts/build-ecosystem.mjs
node scripts/build-request-a-protocol.mjs
```

Then include the generated file in `public/` in your commit if it changed.

## Review Notes

Listings are for discovery and are not endorsements. Maintainers may edit, reject, remove, or recategorize entries to keep the directory useful and safe.

Do not add:

- Private submitter contact details.
- Spam or referral-only listings.
- Phishing, impersonation, malware, or misleading links.
- Claims that cannot be verified from the project’s public materials.
