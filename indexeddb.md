# IndexedDB Auto-Backup Standard

Use this standard when the user says `indexeddb.mdを使って` or `IndexedDBバックアップを入れて`.

## Save behavior

- Keep the app's usual save mechanism, and additionally create an automatic IndexedDB backup.
- Automatically save the latest state whenever data is added, edited, or deleted. The user must not need to operate a backup control during normal use.
- Use an app-specific, descriptive database name. Use an object store name that clearly indicates backups, such as `daily_snapshots`.
- Keep one snapshot per calendar day. More than one change on the same day must update that day's snapshot to the newest state.
- Store the actual app data in a clear shape such as `payload.data`.

## Retention and recovery

- Keep the last 30 days. Automatically remove snapshots 31 days or older.
- Preserve earlier valid snapshots in case the newest snapshot is corrupt.
- On app launch, load the usual saved data first. If it is empty, missing, corrupt, unreadable, or otherwise unusable, automatically restore the newest valid IndexedDB snapshot without asking the user.
- If the newest backup is corrupt, use the preceding valid backup.

## Manual safety controls

- Add `バックアップ` and `データ挿入` controls following the layout, size, spacing, visual treatment, and interaction of the existing `利用者チェック表` implementation wherever practical.
- `バックアップ` exports the current app data as JSON. Use a filename containing the app name and save date.
- `データ挿入` imports a selected JSON backup only after validating its format and confirming that it belongs to this app. A corrupt or different app's file must leave existing data unchanged.
- After a successful import, update both the usual saved data and IndexedDB.
- Keep these controls as manual insurance; daily automatic backups remain the normal workflow.

## Design and verification

- Do not significantly disturb the established UI. Keep controls usable on desktop, tablet, and phone.
- When the user explicitly asks for browser-based verification, verify in DevTools that the app-specific IndexedDB database and `daily_snapshots` contain one current-day record, whose `payload.data` contains app data.
- Then confirm that an add or edit updates the record; clearing usual saved data triggers automatic restore; JSON export works; and the exported JSON imports correctly. Report the results.
- The project-wide policy still applies: never start a browser, web check, local server, deployment, commit, or push unless the user explicitly asks for that exact action in the current task.
