/**
 * 提供票レイアウトごとの調整点をこのファイルに集約しています。
 * 実PDFを確認後、ラベル・正規表現・見出し判定をここで追加してください。
 */
export type TextItem = { text: string; x: number; y: number };
export type PageFacts = {
  clientName?: string;
  providerName?: string;
  providerNumber?: string;
  serviceCategory: '居宅療養' | '';
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

/** Gemini補助判定に渡す場合も、事業所に関係する行だけを選ぶ。 */
export function providerEvidence(items: TextItem[]): string {
  return lineText(items)
    .filter((line) => /事業所番号|事業所名|サービス事業所|居宅療養管理指導/u.test(line))
    .filter((line) => !/被保険者|利用者氏名|利用者名/u.test(line))
    .slice(0, 12)
    .join('\n')
    .slice(0, 1600);
}

/** SVF形式の提供票では、ページ下部に確定した氏名が印字される。
 * 表の見出しにある「利用者氏名」等ではなく、被保険者氏名を優先する。 */
function insuredName(text: string): string | undefined {
  const match = text.match(/被保険者氏名\s*[:：]?\s*([^\s\n]{1,20})\s+([^\s\n]{1,20})\s*様?/u);
  return match ? clean(`${match[1]} ${match[2]}`).replace(/様$/u, '') : undefined;
}

function lineValue(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...text.matchAll(new RegExp(`${escaped}\\s*([^\\n]+)`, 'gu'))];
  for (const match of matches) {
    const value = clean(match[1]).replace(/^(?:休日FLG|事業所名|サービス内容).*$/u, '').trim();
    if (usable(value) && !/[<>_]/u.test(value)) return value;
  }
}

/**
 * 被保険者番号も10桁なので、別表の「事業所番号」列見出しより後の番号だけを採用する。
 * このPDFでは同じ事業所番号が複数行に現れるが、先頭の一件で十分である。
 */
function providerNumberFromAppendix(text: string): string | undefined {
  if (!/サービス提供票別表/u.test(text)) return undefined;
  const compact = toAscii(text).replace(/[\s-]/g, '');
  const heading = compact.indexOf('事業所番号');
  if (heading < 0) return undefined;
  const afterHeading = compact.slice(heading + '事業所番号'.length);
  return afterHeading.match(/[0-9]{10}/u)?.[0];
}

export function extractPageFacts(items: TextItem[]): PageFacts {
  const lines = lineText(items);
  const text = lines.join('\n');
  // ラベル直後の値を優先。座標付きitemsを受け取るため、将来はここに位置判定を追加できます。
  const clientName = insuredName(text) ?? afterLabel(text, ['利用者氏名', '利用者名', '被保険者氏名', '被保険者名']);
  // 右上の名称ではなく、帳票下部のサービス事業所名／別表の公費欄を優先する。
  const providerName = lineValue(text, '事業所名_公費') ?? lineValue(text, 'サービス事業所名') ?? afterLabel(text, ['サービス提供事業所', '提供事業所名']);
  const providerNumber = providerNumberFromAppendix(text);
  return {
    clientName,
    providerName,
    providerNumber,
    serviceCategory: /居宅療養管理指導/u.test(text) ? '居宅療養' : '',
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
