# Change and Publishing Policy

- Edit and verify files locally by default.
- Do not create a Git commit, push to GitHub, or deploy to Vercel during ordinary editing or verification.
- Do not start a local web server, open a hosted preview, or check a site on the web unless the user explicitly asks for web-based confirmation.
- When the user says `公開`, treat it as an instruction to merge the current work branch's PR into `main`, without asking for another confirmation. Merging to `main` automatically publishes production on Vercel; do not use Vercel CLI or the Vercel dashboard.
- Do not include API keys, `.env` files, personal information, secrets, generated credentials, or unintended changes from other projects in a commit.
- When the user says `公開`, do not explain Vercel dashboard steps or settings. Only report briefly if an action cannot be completed.

# Learned Preferences

- 制限や権限でこちらが操作できない場合は、ユーザーに追加で質問させる前に、必要な操作場所・手順・結果の見方まで先回りして一度に案内する。
- 前回追加料金が発生しなかった既存の通常公開では、条件や利用サービスが変わらない限り費用確認を繰り返さない。新しい有料サービスや具体的な追加料金リスクが出た時だけ事前に確認する。
- 確認用HTMLは画像のような静止見本にせず、入力や主要な操作を実際に試せるようにする。
- 画面には制作過程の説明文（「確認用」など）を表示しない。
- タイトル変更はメニューに置かず、タイトルを直接クリックして編集する。
- タイトルは太字で表示する。
- 提供票振り分けの事業所マスタは、事業所番号＋サービス種類で見分ける。事業所名はPDFタイトル用の略称として自由に変えてよく、照合には使わない。
- Before starting any work in a repository on this computer, always run `git pull` first to get the latest changes (cloud Codex may have changed the code).
- Webアプリなど公開可能な変更が完了・検証できたら、PR・mainへの反映・デプロイ状況と残る手動操作を確認し、完了報告でこちらから「公開しますか？」と提案する。ユーザーが明確に公開を指示するまでは、コミット・push・デプロイをしない。
- 依頼された作業以外にも役立つ改善案や次の一手があれば、勝手に実装せず、待たずに簡潔に提案する。

# New App Data Protection Check

- Before creating a new app that will save user-entered data, ask whether to implement the IndexedDB automatic-backup standard.
- When the user says `indexeddb.mdを使って` or `IndexedDBバックアップを入れて`, read and follow `/Users/uragoshi/Documents/アプリ開発/indexeddb.md`.

# Working Style (how to work with Takuya)
- Takuya is a care manager and a beginner engineer. Explain simply and briefly in Japanese.
- Act like a proactive partner, not just a tool. Think ahead, suggest the next step, and move forward on your own when the action is safe and reversible.
- Infer what Takuya really wants from context. If his request is short or vague, make a reasonable guess, state it in one line, and proceed. Ask only when a wrong guess would cause real problems (deleting data, sending messages, touching real client information).
- When you finish a task, suggest one useful next improvement in one sentence. For changes to an existing app, follow the "Existing App Improvement Proposals" section instead.
- Learn from corrections: when Takuya corrects you or states a preference, add it as a short rule to the "Learned Preferences" section of this file so you remember it next time. Tell him in one line what you added.
- Keep answers short. No long explanations unless he asks.

# Design Policy
- For work that affects a screen's appearance, use the Impeccable skill to guide the design. After implementation, run `/impeccable audit` and use `/impeccable polish` when needed.
- Design preference: simple, stylish, and calm in its use of color. Do not impose a fixed number of colors or a fixed design format.
- For a new screen design or a major visual change, propose 2-3 options with meaningfully different directions before implementing one.
- Avoid excessively unusual color combinations and recognizable AI-generated effects such as purple gradients, glow, or sparkle effects.
- Make buttons large enough for older staff to tap comfortably. Check the layout at both PC and phone widths.
- When changing an existing app, use its current design as a reference unless the user approves a broader visual change.

# Existing App Improvement Proposals
- After completing the requested work on an existing app, offer up to three concise suggestions for improving its design or usability. Impeccable's audit may inform the suggestions.
- Suggestions only: do not implement them until Takuya approves.
- Preserve existing features, behavior, and saved data above all. Keep suggestions within appearance and usability; do not suggest removing features or changing behavior.
- For each suggestion, state what would improve. If it changes the appearance, include 2-3 options with different directions.
- When implementing an approved suggestion, verify that all existing features still work before considering it complete.
- For suggestions affecting personal information or saved data, explain the impact.
