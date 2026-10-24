# Change and Publishing Policy

- Edit and verify files locally by default.
- Do not create a Git commit, push to GitHub, or deploy to Vercel during ordinary editing or verification.
- Do not start a local web server, open a hosted preview, or check a site on the web unless the user explicitly asks for web-based confirmation.
- When the user says `公開`, treat it as an explicit instruction to perform the following actions for the current project's intended changes, in this order and without asking for another confirmation: Git commit, GitHub push, then Vercel production deployment.
- Do not include API keys, `.env` files, personal information, secrets, generated credentials, or unintended changes from other projects in a commit.
- When the user says `公開`, do not explain Vercel dashboard steps or settings. Only report briefly if an action cannot be completed.

# Learned Preferences

- 制限や権限でこちらが操作できない場合は、ユーザーに追加で質問させる前に、必要な操作場所・手順・結果の見方まで先回りして一度に案内する。
- 前回追加料金が発生しなかった既存の通常公開では、条件や利用サービスが変わらない限り費用確認を繰り返さない。新しい有料サービスや具体的な追加料金リスクが出た時だけ事前に確認する。
- 確認用HTMLは画像のような静止見本にせず、入力や主要な操作を実際に試せるようにする。
- 画面には制作過程の説明文（「確認用」など）を表示しない。
- タイトル変更はメニューに置かず、タイトルを直接クリックして編集する。
- タイトルは太字で表示する。
- 事業所マスタは「事業所番号と事業所名の両方が一致」したときだけ重複扱いにし、番号が同じでも名称が異なる行は別々に残す。
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
- When you finish a task, suggest one useful next improvement in one sentence.
- Learn from corrections: when Takuya corrects you or states a preference, add it as a short rule to the "Learned Preferences" section of this file so you remember it next time. Tell him in one line what you added.
- Keep answers short. No long explanations unless he asks.

# Design Policy
- For any work that affects how a screen looks (new screens, layout, colors, buttons, icons), always use Open Design first to plan the design, even if Takuya does not ask for it, then implement it.
- Goal: a natural, simple, stylish design that does not look AI-made. It should feel like a calm, well-made business app that people really use.
- Do not use: purple or blue-purple gradients, sparkle or glow effects, heavy shadows, lots of emoji, or decoration with no purpose.
- Limit colors to 2-3 (white or light gray background, dark gray text, one accent color).
- Keep font sizes and spacing consistent. Make buttons and input fields large enough for older staff to tap easily.
- After implementing, check the layout at both PC width and phone width and make sure nothing breaks.
- When changing an existing app, match that app's current look.
