/**
 * KTM portal device approval service.
 *
 * Deploy this as a Google Apps Script web app only after the portal-side
 * integration has been reviewed. Configuration is held in Script Properties,
 * never in the browser.
 */

const CONFIG_KEYS = {
  spreadsheetId: 'SPREADSHEET_ID',
  adminEmail: 'ADMIN_EMAIL',
  administratorRecoveryCode: 'ADMINISTRATOR_RECOVERY_CODE',
};

const SHEETS = {
  employees: '社員一覧',
  approvals: '端末承認',
  audit: '利用履歴',
};

const CODE_LIFETIME_MINUTES = 10;
const REQUEST_LIMIT = 3;
const REQUEST_LIMIT_WINDOW_MINUTES = 30;
const RECOVERY_CODE_USERS = new Set(['浦越　拓哉', '都外川　洋介']);

function doPost(event) {
  try {
    const request = JSON.parse(event && event.postData ? event.postData.contents : '{}');
    const payload = request.payload || {};
    let result;

    switch (request.action) {
      case 'requestDeviceApproval':
        result = requestDeviceApproval_(payload);
        break;
      case 'verifyOneTimePassword':
        result = verifyOneTimePassword_(payload);
        break;
      case 'verifyAdministratorAccess':
        result = verifyAdministratorAccess_(payload);
        break;
      case 'validateDeviceSession':
        result = validateDeviceSession_(payload);
        break;
      case 'writeUsageLog':
        result = writeUsageLog_(payload);
        break;
      default:
        throw new Error('未対応の認証リクエストです。');
    }

    return jsonResponse_({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, message: error.message || '認証処理に失敗しました。' });
  }
}

function requestDeviceApproval_(payload) {
  const employeeName = requiredText_(payload.employeeName, '社員名');
  const employeePin = requiredText_(payload.employeePin, '社員PIN');
  const deviceId = requiredText_(payload.deviceId, '端末ID');
  const deviceName = cleanText_(payload.deviceName) || '名称未取得';
  const browser = cleanText_(payload.browser) || '情報未取得';
  const employee = findEmployee_(employeeName);

  if (!employee || normalizePin_(employee.pin) !== normalizePin_(employeePin)) {
    throw new Error('社員名または社員PINが正しくありません。');
  }

  checkRequestLimit_(employeeName, deviceId);

  const requestId = Utilities.getUuid();
  const code = createOneTimeCode_();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CODE_LIFETIME_MINUTES * 60 * 1000);
  const request = {
    requestId,
    employeeName,
    deviceId,
    deviceName,
    browser,
    codeHash: hash_(code),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  getScriptProperties_().setProperty(`pending:${requestId}`, JSON.stringify(request));
  getSheet_(SHEETS.approvals).appendRow([
    createdAt,
    employeeName,
    deviceName,
    browser,
    '',
    expiresAt,
    '',
    '承認待ち',
    `申請ID: ${requestId}`,
  ]);

  const adminEmail = getConfig_().adminEmail;
  MailApp.sendEmail({
    to: adminEmail,
    subject: `[KTM] 端末認証コード - ${employeeName}`,
    body: [
      'KTMアプリポータルの端末認証申請です。',
      '',
      `社員名: ${employeeName}`,
      `端末: ${deviceName}`,
      `ブラウザ: ${browser}`,
      `認証コード: ${code}`,
      `有効期限: ${formatDate_(expiresAt)}`,
      '',
      'このコードは、申請された端末にのみ直接入力してください。',
    ].join('\n'),
  });

  return { requestId, expiresAt: expiresAt.toISOString(), message: '端末認証コードを管理者へ送信しました。' };
}

function verifyOneTimePassword_(payload) {
  const requestId = requiredText_(payload.requestId, '申請ID');
  const code = requiredText_(payload.code, '認証コード');
  const deviceId = requiredText_(payload.deviceId, '端末ID');
  const properties = getScriptProperties_();
  const pendingKey = `pending:${requestId}`;
  const pendingValue = properties.getProperty(pendingKey);
  if (!pendingValue) throw new Error('認証申請が見つかりません。もう一度申請してください。');

  const request = JSON.parse(pendingValue);
  if (request.deviceId !== deviceId) throw new Error('申請した端末と異なります。');
  if (new Date(request.expiresAt) < new Date()) {
    properties.deleteProperty(pendingKey);
    updateApprovalStatus_(requestId, '期限切れ', '認証コードの有効期限切れ');
    throw new Error('認証コードの有効期限が切れました。もう一度申請してください。');
  }
  if (hash_(code) !== request.codeHash) throw new Error('認証コードが正しくありません。');

  properties.deleteProperty(pendingKey);
  return approveDevice_(request.employeeName, deviceId, 'ポータルログイン', requestId);
}

function verifyAdministratorAccess_(payload) {
  const employeeName = requiredText_(payload.employeeName, '社員名');
  const employeePin = requiredText_(payload.employeePin, '社員PIN');
  const recoveryCode = requiredText_(payload.recoveryCode, '管理者用認証コード');
  const deviceId = requiredText_(payload.deviceId, '端末ID');
  const employee = findEmployee_(employeeName);
  const configuredCode = getScriptProperties_().getProperty(CONFIG_KEYS.administratorRecoveryCode);

  if (!RECOVERY_CODE_USERS.has(employeeName) || !employee || normalizePin_(employee.pin) !== normalizePin_(employeePin) || !configuredCode || recoveryCode !== configuredCode) {
    throw new Error('管理者認証情報が正しくありません。');
  }

  checkRequestLimit_(employeeName, deviceId);
  return approveDevice_(employeeName, deviceId, '管理者固定コード認証');
}

function approveDevice_(employeeName, deviceId, auditAction, requestId) {
  const now = new Date();
  const accessToken = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, '');
  getScriptProperties_().setProperty(`device:${hash_(deviceId)}`, JSON.stringify({
    employeeName,
    deviceId,
    tokenHash: hash_(accessToken),
    approvedAt: now.toISOString(),
    expiresAt: null,
  }));
  if (requestId) updateApprovalStatus_(requestId, '承認済み', '端末利用期限: 無期限（管理者が無効化するまで）', now);
  getSheet_(SHEETS.audit).appendRow([now, employeeName, hash_(deviceId), auditAction, '', '成功']);
  return { accessToken, expiresAt: null, employeeName };
}

function validateDeviceSession_(payload) {
  const deviceId = requiredText_(payload.deviceId, '端末ID');
  const accessToken = requiredText_(payload.accessToken, '端末認証情報');
  const deviceRecord = getScriptProperties_().getProperty(`device:${hash_(deviceId)}`);
  if (!deviceRecord) return { valid: false, reason: '未承認の端末です。' };

  const device = JSON.parse(deviceRecord);
  if (device.expiresAt && new Date(device.expiresAt) < new Date()) return { valid: false, reason: '端末認証の期限が切れました。' };
  if (hash_(accessToken) !== device.tokenHash) return { valid: false, reason: '端末認証情報が一致しません。' };
  return { valid: true, employeeName: device.employeeName, expiresAt: device.expiresAt };
}

function writeUsageLog_(payload) {
  const session = validateDeviceSession_(payload);
  const appName = cleanText_(payload.appName) || '名称未取得';
  const now = new Date();
  getSheet_(SHEETS.audit).appendRow([
    now,
    session.valid ? session.employeeName : cleanText_(payload.employeeName),
    hash_(cleanText_(payload.deviceId)),
    appName,
    '',
    session.valid ? '成功' : '拒否',
  ]);
  return session;
}

function findEmployee_(employeeName) {
  const sheet = getSheet_(SHEETS.employees);
  const rows = sheet.getRange(4, 2, Math.max(sheet.getLastRow() - 3, 0), 2).getDisplayValues();
  const match = rows.find(([name]) => name === employeeName);
  return match ? { name: match[0], pin: match[1] } : null;
}

function checkRequestLimit_(employeeName, deviceId) {
  const key = `rate:${hash_(`${employeeName}:${deviceId}`)}`;
  const properties = getScriptProperties_();
  const now = Date.now();
  const windowStart = now - REQUEST_LIMIT_WINDOW_MINUTES * 60 * 1000;
  const timestamps = JSON.parse(properties.getProperty(key) || '[]').filter((time) => time >= windowStart);
  if (timestamps.length >= REQUEST_LIMIT) throw new Error('申請回数が上限に達しました。しばらくしてから再度お試しください。');
  timestamps.push(now);
  properties.setProperty(key, JSON.stringify(timestamps));
}

function updateApprovalStatus_(requestId, status, note, approvedAt) {
  const sheet = getSheet_(SHEETS.approvals);
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return;
  const notes = sheet.getRange(4, 9, lastRow - 3, 1).getDisplayValues();
  const index = notes.findIndex(([value]) => value.indexOf(requestId) !== -1);
  if (index === -1) return;
  const row = index + 4;
  if (approvedAt) sheet.getRange(row, 7).setValue(approvedAt);
  sheet.getRange(row, 8).setValue(status);
  sheet.getRange(row, 9).setValue(note);
}

function getConfig_() {
  const properties = getScriptProperties_();
  const spreadsheetId = properties.getProperty(CONFIG_KEYS.spreadsheetId);
  const adminEmail = properties.getProperty(CONFIG_KEYS.adminEmail);
  if (!spreadsheetId || !adminEmail) throw new Error('認証サービスの初期設定が完了していません。');
  return {
    spreadsheetId,
    adminEmail,
  };
}

function getScriptProperties_() { return PropertiesService.getScriptProperties(); }
function getSheet_(sheetName) {
  const sheet = SpreadsheetApp.openById(getConfig_().spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error(`シート「${sheetName}」が見つかりません。`);
  return sheet;
}
function createOneTimeCode_() { return String(Math.floor(Math.random() * 1000000)).padStart(6, '0'); }
function normalizePin_(value) { return String(value).replace(/\D/g, '').padStart(3, '0'); }
function cleanText_(value) { return typeof value === 'string' ? value.trim().slice(0, 200) : ''; }
function requiredText_(value, label) { const text = cleanText_(value); if (!text) throw new Error(`${label}を入力してください。`); return text; }
function hash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value)).map((byte) => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join(''); }
function formatDate_(date) { return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'); }
function jsonResponse_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
