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
  isAppendix: boolean;
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

function providerAppendixFacts(items: TextItem[]): { providerName?: string; providerNumber?: string } {
  const nameHeaders = items.filter((item) => /^事業所名(?:[_＿]?公費|（公費）)?$/u.test(clean(item.text).replace(/\s/g, '')));
  const numberHeaders = items.filter((item) => clean(item.text).replace(/\s/g, '') === '事業所番号');

  for (const nameHeader of nameHeaders) {
    const numberHeader = numberHeaders
      .filter((item) => item.x > nameHeader.x && Math.abs(item.y - nameHeader.y) <= 8)
      .sort((a, b) => a.x - b.x)[0];
    if (!numberHeader) continue;

    // 別表では「事業所番号」の列の下に事業所番号が印字されます。
    // 上部の被保険者番号（同じ10桁）を誤採用しないよう、見出しより下だけを調べます。
    const numberCells = items
      .filter((item) => item.y < numberHeader.y - 2 && item.y > numberHeader.y - 120)
      .flatMap((item) => {
        const compact = toAscii(item.text).replace(/\s/g, '');
        const match = compact.match(/\d{10}/u);
        if (!match || item.x < numberHeader.x - 12 || item.x > numberHeader.x + 35) return [];
        return [{ item, number: match[0] }];
      })
      .sort((a, b) => b.item.y - a.item.y || a.item.x - b.item.x);

    for (const numberCell of numberCells) {
      // 事業所名欄は番号欄の左側。2行に折り返された名称も位置情報で連結します。
      const nameParts = items
        .filter((item) => item.x >= nameHeader.x - 45 && item.x < numberHeader.x - 5)
        .filter((item) => item.y >= numberCell.item.y - 12 && item.y <= numberCell.item.y + 10)
        .filter((item) => {
          const value = clean(item.text).replace(/\s/g, '');
          return value.length > 0 && !/^\d+$/u.test(toAscii(value)) && !/事業所番号|被保険者番号|サービス内容|単位数|利用者氏名/u.test(value);
        })
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text);
      const providerName = clean(nameParts.join('')).replace(/\s/g, '');
      if (providerName.length >= 2 && providerName.length <= 80) {
        return { providerName, providerNumber: numberCell.number };
      }
    }
    // 帳票によって名前欄だけ空でも番号は使えるため、番号は捨てません。
    if (numberCells[0]) return { providerNumber: numberCells[0].number };
  }
  return {};
}

function providerNameFromServiceHeader(items: TextItem[]): string | undefined {
  const header = items.find((item) => /居宅介護支援事業者\s*→\s*サービス事業者/u.test(item.text));
  if (!header) return undefined;
  const candidate = items
    .filter((item) => item.x >= header.x && item.y > header.y && item.y <= header.y + 30)
    .filter((item) => clean(item.text).length >= 2 && clean(item.text).length <= 80 && !/事業所|サービス|電話|番号|年月|計画/u.test(item.text))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => item.text)
    .join('');
  return candidate.length <= 80 ? clean(candidate) : undefined;
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
  const appendix = providerAppendixFacts(items);
  // 利用者名は帳票内の氏名ラベルを優先して抽出します。
  const clientName = insuredName(text) ?? afterLabel(text, ['利用者氏名', '利用者名', '被保険者氏名', '被保険者名']);
  // 別表の「事業所名」列を最優先し、既知の文字ラベル、帳票上部の名称を順に補助利用します。
  const providerName = appendix.providerName ?? lineValue(text, '事業所名_公費') ?? lineValue(text, 'サービス事業所名')
    ?? afterLabel(text, ['サービス提供事業所', '提供事業所名']) ?? providerNameFromServiceHeader(items);
  const providerNumber = appendix.providerNumber ?? providerNumberFromAppendix(text);
  return {
    clientName,
    providerName,
    providerNumber,
    serviceCategory: /居宅療養管理指導/u.test(text) ? '居宅療養' : '',
    serviceMonth: monthFrom(text),
    isSlipHeading: /サービス提供票|提供票別表|居宅サービス計画/u.test(text),
    isAppendix: /サービス提供票別表/u.test(text),
    textFound: clean(text).length > 0,
  };
}

export function shouldStartNewSlip(current: PageFacts | undefined, next: PageFacts): boolean {
  if (!current) return true;
  const bothNumbersKnown = Boolean(current.providerNumber && next.providerNumber);

  // 主票→別表は同じ書類の続きです。主票の右上名称が省略形でも、別表の番号・名称で確定します。
  if (!current.isAppendix && next.isAppendix) {
    return bothNumbersKnown && current.providerNumber !== next.providerNumber;
  }

  // 別表の後に見出し付きの主票が始まったら新しいセットです。
  if (current.isAppendix && !next.isAppendix) {
    if (next.isSlipHeading) return true;
  }

  const clientChanged = Boolean(next.clientName && current.clientName && next.clientName !== current.clientName);
  if (clientChanged) return true;
  if (bothNumbersKnown) return current.providerNumber !== next.providerNumber;

  // 同じ種類の連続ページでは、事業所番号を優先し、番号が欠けているときだけ名称を使います。
  return Boolean(next.providerName && current.providerName
    && clean(next.providerName).replace(/\s/g, '') !== clean(current.providerName).replace(/\s/g, ''));
}
