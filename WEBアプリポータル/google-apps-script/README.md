# KTM portal authentication service

This folder is the reviewed Google Apps Script source for the KTM portal device-approval flow. It is not deployed yet.

## What it does

- Checks the selected employee and their three-digit PIN against `社員一覧`.
- Sends a six-digit one-time code to the administrator email.
- Keeps an approved device enabled until an administrator disables it.
- Records approval requests in `端末承認` and portal/app usage in `利用履歴`.
- Limits repeated approval requests to three per employee/device in 30 minutes.

## Initial Script Properties

Set these in the Apps Script project's Script properties before deploying.

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | `1YOsGQ8pBbEeRQkozCAWnjaQR12XG552Nlw-AOE5lmOg` |
| `ADMIN_EMAIL` | `uragoshi@gmail.com` |

## Deployment boundary

The script must be deployed as a web app and connected to the portal before it can send email or write live logs. That deployment has not been performed yet. The portal must also receive a server-side access gate before individual Vercel app URLs can be protected; a static page alone cannot safely hold the approval secret.
