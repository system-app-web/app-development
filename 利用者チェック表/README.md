# 利用者チェック表 外部プレビュー手順

このフォルダでは、`cloudflared` を使って現在のローカルプレビューを一時的な外部URLで確認できます。  
ルーターのポート開放は不要です。

## できること

- Windows 上で `利用者チェック表.html` をローカルHTTPサーバーで表示
- Cloudflare Tunnel を使って一時的な公開URLを発行
- 外出先のスマホや iPad から同じ画面を確認

## 使い方

1. `start_cloudflare_preview.bat` をダブルクリックします。
2. 初回は `cloudflared.exe` をプロジェクト内の `.tools` フォルダへ自動ダウンロードします。
3. ローカルサーバーが `http://127.0.0.1:8765/` で起動します。
4. Cloudflare Tunnel が起動すると、外部URL が画面に表示されます。
5. スマホや iPad でその URL を開くと、現在のアプリを確認できます。

## URL の確認場所

- 起動ウィンドウ内に表示されます
- さらに `.preview\public-url.txt` に保存されます

## 停止方法

`stop_cloudflare_preview.bat` をダブルクリックしてください。

停止すると以下が終了します。

- ローカルプレビューサーバー
- Cloudflare Tunnel

## 作成される主なファイル

- `.tools\cloudflared.exe`
- `.preview\public-url.txt`
- `.preview\logs\cloudflared.log`
- `.preview\logs\server.log`

## 注意事項

- この URL を知っている人は、公開中の画面を閲覧できます。
- 利用者名、連絡先、住所、ケース情報などの個人情報が入った状態では外部公開しないでください。
- 実データで確認する前に、必要ならテスト用データへ差し替えてください。
- 使い終わったら必ず `stop_cloudflare_preview.bat` で停止してください。
- Cloudflare Tunnel の URL は一時的です。起動し直すと URL が変わることがあります。

## 補足

- この仕組みは `cloudflared tunnel --url http://127.0.0.1:8765/` を利用しています。
- Python が通常インストールされていない場合でも、Codex 環境の Python を自動で利用するようにしています。
