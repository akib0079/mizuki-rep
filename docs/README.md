# Studio Handbook

The client-facing guide to the admin console: how to add classes, confirm payments, manage
students, and what each email does.

`index.html` is the published page. It is one self-contained file with every screenshot embedded,
so it can be emailed, opened offline, or served as-is.

## Published at

GitHub Pages, from this folder on `main`. Turn it on once under
**Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**.

## Changing the wording

Edit `handbook.src.html` — the same page with `{{IMG:name}}` placeholders where the screenshots
go — then rebuild:

```
node docs/build.mjs
```

Do not hand-edit `index.html`. It is generated, and the next build overwrites it.

## Changing the screenshots

Replace the matching file in `screenshots/` and rebuild. Every screenshot needs a line in the
`ALT` map in `build.mjs`; the build fails rather than shipping an image a screen reader cannot
describe.

The screenshots come from a demo copy of the console seeded with invented students, so no real
student's details appear in the published page.
