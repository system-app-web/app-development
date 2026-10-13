# Change and Publishing Policy

- Edit and verify files locally by default.
- Do not create a Git commit, push to GitHub, or deploy to Vercel during ordinary editing or verification.
- Do not start a local web server, open a hosted preview, or check a site on the web unless the user explicitly asks for web-based confirmation.
- When the user says `公開`, treat it as an explicit instruction to perform the following actions for the current project's intended changes, in this order and without asking for another confirmation: Git commit, GitHub push, then Vercel production deployment.
- Do not include API keys, `.env` files, personal information, secrets, generated credentials, or unintended changes from other projects in a commit.
- When the user says `公開`, do not explain Vercel dashboard steps or settings. Only report briefly if an action cannot be completed.

# New App Data Protection Check

- Before creating a new app that will save user-entered data, ask whether to implement the IndexedDB automatic-backup standard.
- When the user says `indexeddb.mdを使って` or `IndexedDBバックアップを入れて`, read and follow `/Users/uragoshi/Documents/アプリ開発/indexeddb.md`.
