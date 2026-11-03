// モデルの変更はここだけで行います。
export const GEMINI_MODEL = 'gemini-3.8-flash';
const AUTH_URL = 'https://script.google.com/macros/s/AKfycbyBLa2UzLgaxu7wb6GKqIJ_uiEbet4fW1QjCGGh83_Yb1JdJrq0ygF2ai6O5oJencw-/exec';
const TYPES = new Set(['application/pdf','image/png','image/jpeg','image/webp','image/gif']);
const CATEGORIES = new Set(['認定調査票','主治医意見書','ケアプラン原案','介護保険証','負担割合証','薬情','退院サマリー','その他の基本情報']);
const LIMIT = 3 * 1024 * 1024;
const CORRECTION_165 = '【No.165についての補足（上記の記載より優先）】資料に該当事項があるかどうかの情報がない場合は、推測せず「記載なし」と出力してください。該当事項がないことが資料ではっきり確認できる場合は「なし」と出力してください。';

export async function generate(body, credentials, { fetcher = fetch, apiKey = process.env.GEMINI_API_KEY, prompt } = {}) {
  if (!credentials?.deviceId || !credentials?.accessToken || credentials.deviceId.length > 200 || credentials.accessToken.length > 2048) return { status: 401, error: 'ポータルにログインし直してください。' };
  let valid = false;
  try {
    const auth = await fetcher(AUTH_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action:'validateDeviceSession',payload:credentials}), redirect:'follow', signal:AbortSignal.timeout(15000) });
    const result = await auth.json(); valid = auth.ok && result.ok === true && result.valid === true;
  } catch { return { status:503, error:'端末の認証を確認できませんでした。通信を確認してやり直してください。' }; }
  if (!valid) return { status:401, error:'端末の認証が切れています。ポータルにログインし直してください。' };
  if (!apiKey) return { status:503, error:'AIの設定がまだ完了していません。管理者に確認してください。' };
  const documents = body?.documents;
  if (!Array.isArray(documents) || !documents.length || documents.length > 24) return { status:400, error:'資料を1つ以上、24個以内で選んでください。' };
  let total = 0;
  for (const doc of documents) {
    if (!doc || !CATEGORIES.has(doc.category) || !TYPES.has(doc.mimeType) || typeof doc.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(doc.data)) return { status:400, error:'PDFまたは対応する画像を選んでください。' };
    total += Math.floor(doc.data.length * 3 / 4);
    if (total > LIMIT) return { status:413, error:'資料は合計3MB以内にしてください。' };
  }
  try {
    const instruction = prompt ?? process.env.ASSESSMENT_PROMPT;
    if (!instruction?.trim()) return { status:503, error:'アセスメント用プロンプトが設定されていません。管理者に確認してください。' };
    const parts = [{text:`${instruction}\n\n${CORRECTION_165}`}];
    for (const doc of documents) parts.push({text:`【${doc.category}】`},{inline_data:{mime_type:doc.mimeType,data:doc.data}});
    const result = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':apiKey}, body:JSON.stringify({contents:[{parts}]}), signal:AbortSignal.timeout(120000) });
    if (!result.ok) return { status:502, error:result.status === 429 ? 'AIの利用上限に達しました。時間をおいて再度お試しください。' : 'AIで作成できませんでした。設定や資料を確認して再度お試しください。' };
    const json = await result.json();
    const text = (json.candidates?.[0]?.content?.parts || []).filter(part=>!part.thought && typeof part.text === 'string').map(part=>part.text).join('');
    if (!text || json.candidates?.[0]?.finishReason !== 'STOP') return { status:502, error:'AIの回答を最後まで受け取れませんでした。もう一度お試しください。' };
    return { status:200, text };
  } catch { return { status:502, error:'AIに接続できませんでした。通信を確認して再度お試しください。' }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'この操作は利用できません。'});
  const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
  try { if (!origin || new URL(origin).host !== host) return res.status(403).json({error:'この操作は利用できません。'}); } catch { return res.status(403).json({error:'この操作は利用できません。'}); }
  const credentials = {deviceId:req.headers['x-assessment-device'],accessToken:req.headers['x-assessment-session']};
  const result = await generate(req.body, credentials);
  return res.status(result.status).json(result.status === 200 ? {text:result.text} : {error:result.error});
}
