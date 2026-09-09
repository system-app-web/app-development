# Change and Publishing Policy

- Edit and verify files locally by default.
- Do not create a Git commit unless the user explicitly asks to commit in the current task.
- Do not push to GitHub unless the user explicitly asks to push in the current task.
- Do not start a Vercel deployment, redeployment, promotion, publishing action, or hosting configuration unless the user explicitly asks to deploy in the current task.
- Treat `commit`, `push`, and `deploy` as separate actions. Editing files does not imply any of them.
- Do not start a local web server, open a hosted preview, or check a site on the web unless the user explicitly asks for web-based confirmation.

# New App Data Protection Check

- Before creating a new app that will save user-entered data, ask whether to implement the IndexedDB automatic-backup standard.
- When the user says `indexeddb.mdを使って` or `IndexedDBバックアップを入れて`, read and follow `/Users/uragoshi/Documents/アプリ開発/indexeddb.md`.
