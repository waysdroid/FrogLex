# Personal vocabulary V0.1

The feature is based on upstream Read Frog 1.61.2, commit `284a532712ec9cfd139cfe4e783f5932ca3ab661`. The built-in Dictionary card accepts English words and phrases selected in ordinary webpages. Its Personal vocabulary controls save through extension messaging to a dedicated IndexedDB database. The options sidebar opens the default collection and the entry details.

The selection adapter uses the current Dictionary request. When generation completes it can use the model's base form and optional fields. When generation is pending or unavailable, the entry can use the selected form. A sentence comes from the captured reading passage when a unique match is available. The app removes query strings and fragments from saved source links. The preview lets the user omit the link. Repeating a save with the same operation ID is idempotent. Saving from a new lookup can add an encounter and a distinct reading context.

The database begins at version 1 and is independent of upstream config, Glossary, translation caches and official Notebase. It uses the existing extension permissions. The new repository, dictionary adapter and schema live in `src/utils/personal-vocabulary`. The selection card and options route each have a dedicated UI component. The selection overlay uses a closed shadow root so webpage scripts cannot directly read vocabulary status or interact with save controls. The sole additional dependency, `fake-indexeddb`, is for tests.

## Build and smoke test

Use the Node.js and pnpm versions pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
WXT_SKIP_ENV_VALIDATION=true pnpm build
WXT_SKIP_ENV_VALIDATION=true pnpm build:edge
pnpm type-check
SKIP_FREE_API=true pnpm test
```

Load `.output/chrome-mv3` or `.output/edge-mv3` in a browser profile that allows unpacked extensions. Use a stable directory and profile so the installed extension keeps access to the same IndexedDB database.

1. Open Dictionary on an English word or phrase in a webpage. Save it and open the entry from the card.
2. Select the same word in a different sentence, open Dictionary again, and record the encounter. Check that the two contexts and both encounters appear in the same entry.
3. Open Dictionary with an unavailable model, then save the selection. Use the preview to edit the base form or definition and omit the source link.
4. Restart the browser and open Personal vocabulary from the options sidebar. Confirm the entries remain. Check that the official Notebase button still behaves as before.
