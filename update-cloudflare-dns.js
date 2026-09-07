const fs   = require('node:fs');
const path = require('node:path');

/** ログファイルは本ファイルと同階層に出力する */
const logFilePath = path.join(__dirname, 'update-cloudflare-dns.log');

/** 実行環境に関わらず JST で `YYY-MM-DD HH:mm:SS を取得する */
const jstTimeStamp = () => {
  const jstNow = new Date(Date.now() + ((new Date().getTimezoneOffset() + (9 * 60)) * 60 * 1000));
  const year    = jstNow.getFullYear();
  const month   = String(jstNow.getMonth() + 1).padStart(2, '0');
  const date    = String(jstNow.getDate()     ).padStart(2, '0');
  const hours   = String(jstNow.getHours()    ).padStart(2, '0');
  const minutes = String(jstNow.getMinutes()  ).padStart(2, '0');
  const seconds = String(jstNow.getSeconds()  ).padStart(2, '0');
  return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
};

/** ログファイル末尾に追記する */
const appendLog = message => {
  const line = `[${jstTimeStamp()}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, line, 'utf-8');
  }
  catch(error) {
    console.error(`[ERROR] Failed To Append Log : ${line}`);
  }
};

/** 設定ファイルを読み込む */
const loadConfig = () => {
  try {
    const text = fs.readFileSync(path.join(__dirname, './config.json'), 'utf-8');
    const json = JSON.parse(text);
    
    const config = {
      apiToken  : json.api_token,
      recordName: json.record_name,
      zoneId    : json.zone_id
    };
    if(Object.values(config).some(value => value == null || String(value).trim() === '')) throw new Error('[ERROR] Load Config : Empty Config Value');
    
    return config;
  }
  catch(error) {
    console.error('[ERROR] Load Config : Failed', error);
    appendLog(`[ERROR] Load Config : Failed : ${error}`);
    throw error;
  }
};

/** グローバル IP を取得する */
const getGlobalIp = async () => {
  // フォールバックサイトを複数用意しておけたらより安定できるかも
  const response = await fetch('https://api.ipify.org?format=json');
  if(!response.ok) throw new Error(`[ERROR] Get Global IP : Response Error : HTTP ${response.status}`);
  
  const { ip: globalIp } = await response.json();
  if(!(/^(?:\d{1,3}\.){3}\d{1,3}$/).test(globalIp)) throw new Error(`[ERROR] Get Global IP : Invalid IP V4 Address : ${ip}`);
  
  return globalIp;
};

/** A レコード一覧から DNS 用レコード1件を取得する (更新要否判定・更新時の ID 参照のため) https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/ */
const getDnsRecord = async (zoneId, apiToken, recordName) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A&per_page=500`, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if(!response.ok) throw new Error(`[ERROR] Get DNS Record : Response Error : HTTP ${response.status}`);
  
  const json = await response.json();
  if(!json.success) throw new Error(`[ERROR] Get DNS Record : API Error : HTTP ${response.status} : ${JSON.stringify(json.errors)}`);
  
  const record = json.result.find(record => record.type === 'A' && record.name === recordName);
  if(record == null) throw new Error(`[ERROR] Get DNS Record : DNS Record Not Found : ${recordName}`);
  
  return record;
};

/** 対象の DNS レコードを更新する https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/ */
const updateDnsRecord = async (zoneId, recordId, apiToken, globalIp) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
    method: 'PATCH',
    body: JSON.stringify({
      content: globalIp,
      proxied: false  // Wake On WAN 用なので必ず DNS Only にする
    })
  });
  if(!response.ok) throw new Error(`[ERROR] Update DNS Record : Response Error : HTTP ${response.status}`);
  
  const json = await response.json();
  if(!json.success) throw new Error(`[ERROR] Update DNS Record : API Error : HTTP ${response.status} : ${JSON.stringify(json.errors)}`);
  
  return json.result;
};

// Main
(async () => {
  try {
    appendLog('Start DNS Check');
    
    const { apiToken, recordName, zoneId } = loadConfig();
    
    const globalIp = await getGlobalIp();
    appendLog(`Global IP : ${globalIp}`);
    
    const record = await getDnsRecord(zoneId, apiToken, recordName);
    if(record.content === globalIp && record.proxied === false) {
      appendLog('[OK] DNS Record Is Already Up-To-Date. End');
      return;
    }
    
    appendLog(`Start Update : Record ID : ${record.id} : ${record.content} → ${globalIp}`);
    await updateDnsRecord(zoneId, record.id, apiToken, globalIp);
    appendLog('[SUCCEEDED] Updated Successfully. End');
    process.exit(0);  // タスクスケジューラ向けに明示的に終了する
  }
  catch(error) {
    console.error('[ERROR]', error);
    appendLog(`[ERROR] ${error.message}`);
    appendLog('[ERROR] Error. End');
    process.exit(1);  // タスクスケジューラ向けに明示的に終了する
  }
})();
