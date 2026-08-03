Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'PDFを保存したフォルダを選択してください'
$dialog.ShowNewFolderButton = $false

if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
  exit
}

Get-ChildItem -LiteralPath $dialog.SelectedPath -Filter '*.pdf' -File | ForEach-Object {
  Unblock-File -LiteralPath $_.FullName
}

[System.Windows.Forms.MessageBox]::Show(
  'PDFのプレビュー警告を解除しました。',
  'PDF変換アプリ',
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
