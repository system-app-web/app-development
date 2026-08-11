/**
 * 提供票レイアウトごとの調整点をこのファイルに集約しています。
 * 実PDFを確認後、ラベル・正規表現・見出し判定をここで追加してください。
 */
export type TextItem = { text: string; x: number; y: number };
export type PageFacts = {
  clientName?: string;
  providerName?: string;
  serviceMonth?: string;
  isSlipHeading: boolean;
  textFound: boolean;
};

const clean = (value: string) => value.replace(/[\u3000\t]/g, ' ').replace(/\s+/g, ' ').trim();
const usable = (value?: string) => Boolean(value && value.length >= 2 && value.length <= 45);

function afterLabel(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*(?:[:：]\\s*)?([^\\n]{2,42})`, 'i'));
    if (match) {
      const value = clean(match[1])
        .replace(/(?:事業所番号|提供年月|利用者(?:氏名|名)|被保険者(?:氏名|名)|担当者).*$/u, '')
        .trim();
      if (usable(value)) return value;
    }
  }
}

function monthFrom(text: string): string | undefined {
  const reiwa = text.match(/令和\s*([0-9０-９]+)\s*年\s*([0-9０-９]+)\s*月/u);
  if (reiwa) return `令和${toAscii(reiwa[1])}年${toAscii(reiwa[2])}月`;
  const western = text.match(/(20[0-9]{2})\s*(?:年|[.\/-])\s*([0-9]{1,2})\s*月?/u);
  if (western) return `${western[1]}年${western[2]}月`;
}

function toAscii(value: string) {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function lineText(items: TextItem[]) {
  const lines = new Map<number, TextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y / 4) * 4;
    lines.set(key, [...(lines.get(key) ?? []), item]);
  }
  return [...lines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(''));
}

export function extractPageFacts(items: TextItem[]): PageFacts {
  const lines = lineText(items);
  const text = lines.join('\n');
  // ラベル直後の値を優先。座標付きitemsを受け取るため、将来はここに位置判定を追加できます。
  const clientName = afterLabel(text, ['利用者氏名', '利用者名', '被保険者氏名', '被保険者名']);
  const providerName = afterLabel(text, ['サービス事業所名', 'サービス提供事業所', '提供事業所名', '事業所名']);
  return {
    clientName,
    providerName,
    serviceMonth: monthFrom(text),
    isSlipHeading: /サービス提供票|提供票別表|居宅サービス計画/u.test(text),
    textFound: clean(text).length > 0,
  };
}

export function shouldStartNewSlip(current: PageFacts | undefined, next: PageFacts): boolean {
  if (!current) return true;
  // 続きページは氏名・事業所が欠けることがあるため、明確に異なる値を取得できた時だけ区切ります。
  const clientChanged = Boolean(next.clientName && current.clientName && next.clientName !== current.clientName);
  const providerChanged = Boolean(next.providerName && current.providerName && next.providerName !== current.providerName);
  // 見出しが各ページに繰り返される製品もあるため、見出しだけでは区切りません。
  // 同一利用者・同一事業所の連続ページを分断しないことを優先します。
  return clientChanged || providerChanged;
}
