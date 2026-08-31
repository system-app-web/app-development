(() => {
  const requested = new URLSearchParams(window.location.search).has('install');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;
  let notice;

  if (!requested || isStandalone) return;

  const showNotice = (mode) => {
    if (notice) notice.remove();

    notice = document.createElement('aside');
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('aria-label', 'アプリとしてインストール');
    notice.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;width:min(360px,calc(100% - 32px));padding:18px;border:1px solid #b8d5ee;border-radius:12px;background:#fff;color:#1d3348;box-shadow:0 18px 48px rgba(20,58,89,.24);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.style.cssText = 'float:right;border:0;background:transparent;color:#55738c;font-size:13px;cursor:pointer;';
    closeButton.addEventListener('click', () => notice.remove());
    notice.append(closeButton);

    const title = document.createElement('strong');
    title.textContent = 'アプリとしてインストール';
    title.style.cssText = 'display:block;margin:0 44px 8px 0;font-size:16px;';
    notice.append(title);

    const text = document.createElement('p');
    text.style.cssText = 'margin:0;color:#4d6579;font-size:14px;line-height:1.65;';
    notice.append(text);

    if (mode === 'ready') {
      text.textContent = 'この端末のホーム画面やアプリ一覧へ追加できます。';
      const installButton = document.createElement('button');
      installButton.type = 'button';
      installButton.textContent = 'このアプリをインストール';
      installButton.style.cssText = 'width:100%;min-height:44px;margin-top:14px;border:0;border-radius:8px;background:#1678d3;color:#fff;font-weight:700;cursor:pointer;';
      installButton.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        deferredPrompt = null;
        notice.remove();
      });
      notice.append(installButton);
    } else if (isIos) {
      text.textContent = 'Safariの共有ボタンから「ホーム画面に追加」を選ぶと、指定アイコンで登録できます。';
    } else {
      text.textContent = 'このページをしばらく開くと、インストールを開始できます。表示されない場合はブラウザのメニューから「アプリをインストール」を選んでください。';
    }

    document.body.append(notice);
  };

  if (isIos) showNotice('manual');
  else showNotice('waiting');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showNotice('ready');
  });

  window.addEventListener('appinstalled', () => notice?.remove());
})();
