export type GeminiSuggestion = {
  providerName: string | null;
  providerNumber: string | null;
  isHomeMedicalCare: boolean | null;
  confidence: number;
  reason: string;
  requiresReview: true;
};

/** ブラウザ側でも氏名・被保険者番号の典型表記を消してから送る。 */
function redact(value: string) {
  return value
    .replace(/被保険者番号\s*[:：]?\s*[0-9０-９\s-]{8,20}/gu, '被保険者番号: [伏せ字]')
    .replace(/(?:被保険者氏名|利用者(?:氏名|名)|氏名[_＿](?:姓|名))\s*[:：]?\s*[^\n]{1,40}/gu, '利用者名: [伏せ字]');
}

export async function requestGeminiSuggestion(input: { excerpt: string; providerName: string; providerNumber: string; missing: string[] }) {
  let deviceId = '';
  let accessToken = '';
  try {
    deviceId = localStorage.getItem('ktm-portal:device-id') || '';
    const session = JSON.parse(localStorage.getItem('ktm-portal:device-session') || 'null') as { accessToken?: unknown } | null;
    accessToken = typeof session?.accessToken === 'string' ? session.accessToken : '';
  } catch { /* 下でログインし直すよう案内する */ }
  if (!deviceId || !accessToken) throw new Error('スタッフポータルのログインを確認できません。ポータルからアプリを開き直してください。');

  const response = await fetch('/api/gemini-assist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      excerpt: redact(input.excerpt).slice(0, 1600),
      knownProviderName: input.providerName,
      knownProviderNumber: input.providerNumber,
      missing: input.missing,
      deviceId,
      accessToken,
    }),
  });
  const body = await response.json() as GeminiSuggestion & { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.error || body.detail || 'Gemini補助判定に失敗しました。');
  return body;
}
