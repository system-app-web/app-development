---
name: アセスメントシート
description: 資料からシートを作成し、必要な項目を確認するための画面
colors:
  primary: "#27614a"
  background: "#f6f7f5"
  surface: "#ffffff"
  text: "#25332d"
  muted: "#68786e"
  border: "#dfe7e1"
  field-label: "#edf1ee"
  review-field: "#fff61d"
  review-notice: "#fff8d7"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Hiragino Sans, Yu Gothic, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Hiragino Sans, Yu Gothic, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  button: "8px"
  drop-area: "14px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "11px 25px"
---

# Design System: アセスメントシート

## Overview

**Creative North Star: "資料から、次の一手へ"**

操作の入口を大きく、書類の中は見出しと入力欄の区別を明確にする。利用者が今必要な作業に集中できる、落ち着いた業務画面。

**Key Characteristics:**

- 資料の投入先を中央に大きく置く。
- 深緑は主な操作と選択中の状態に使う。
- 黄色は確認が必要な空欄を示す。

## Colors

白い面と薄い灰緑の余白を土台に、深緑で操作を示す。帳票の黄色い空欄と淡い確認案内は状態を伝えるために使う。

## Typography

日本語を読みやすいシステムフォントで統一する。トップの見出しは30px、説明文は16pxを基本とする。

## Layout

トップは最大1000pxの中央寄せ。シートは上部のタブで切り替え、詳細な編集ツールは必要なときに開く。760px以下ではナビゲーションと書類を横にスクロールできる。

## Elevation & Depth

通常の面には強い影を使わない。保存メニューは境界線と控えめな影で前後関係を示す。

## Shapes

主なボタンは8px、資料投入枠は14pxの角丸。帳票は細い罫線を使い、項目同士の境界を明確にする。

## Components

- 資料投入枠はドラッグとファイル選択に対応する。
- 「保存する」からPDF・Excel・ドライブ・バックアップの操作を選ぶ。
- 「詳しく編集」で書式や非表示のツールを開く。
- 空欄の案内から次の黄色い入力欄へ移動する。

## Do's and Don'ts

### Do:

- **Do** 送信や保存などの操作結果が分かる日本語を使う。
- **Do** 高齢のスタッフにも押しやすい大きさのボタンを使う。

### Don't:

- **Don't** 紫のグラデーションや光る効果を使う。
- **Don't** 入力欄の黄色を装飾色として使う。
