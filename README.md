# Update Cloudflare DNS

Cloudflare API を利用してダイナミック DNS として実行マシンのグローバル IP 情報を定期更新するスクリプト。

メインロジック (グローバル IP の取得と Cloudflare API のコール) は Node.js スクリプトとして実装してあるため、単発実行は Node.js で直接実行 (もしくは VBScript 経由で起動) すれば良い。定期実行は Windows タスクスケジューラにて設定する想定。


## 初回セットアップ

- Cloudflare 管理画面のドメイン一覧ページ (`/domains/overview`) より、対象のドメインから「ゾーン ID をコピー」を選択し、ゾーン ID を把握しておく
- Cloudflare 管理画面の対象ドメインページ (`/dns/records`) にて、A レコードの DNS レコードを作成しておく
    - 以下では `dns.example.com` と例記する
    - プロキシステータス : OFF (DNS のみ) にする
- Cloudflare 管理画面より[ユーザ API トークン](https://dash.cloudflare.com/profile/api-tokens)を作成する
    - 権限 : 「ゾーン」「DNS」「編集」(= DNS Write 権限)
- `config.example.json` を参考に、確認した情報を記入して `config.json` として作成しておく

```bash
# API トークンが有効かどうかチェックする
$ curl 'https://api.cloudflare.com/client/v4/user/tokens/verify' -H 'Authorization: Bearer 【API トークン】' | jq .
{
  "result": {
    "id": "【ID】",
    "status": "active"
  },
  "success": true,
  "errors": [],
  "messages": [
    {
      "code": 10000,
      "message": "This API Token is valid and active",
      "type": null
    }
  ]
}
```

- Windows タスクスケジューラ `taskschd.msc` より以下の要領でタスクを作成する
    - 「タスクの作成...」から作成する
    - 「全般」タブ
        - 名前 : Update Cloudflare DNS
        - ユーザーがログオンしているときのみ実行する : 選択する
        - 最上位の特権で実行する : チェック不要
        - 表示しない : チェックすることでバックグラウンド実行できる
        - 構成 : Windows 10
    - 「トリガー」タブ
        - トリガー1 : マシンログオン時
            - タスクの開始 : ログオン時
            - 任意のユーザー : 選択する
            - 遅延時間を設定する : 30 秒間 (念のためログオンから30秒後に初回実行する)
        - トリガー2 : 定期実行 (トリガーは分けて定義しておくと正しく動作する)
            - タスクの開始 : スケジュールに従う
            - 設定 : 「毎日」を選択する
            - 開始 : `2026-01-01 00:00:00` など過去日時
            - 間隔 : 1 日
            - 繰り返し間隔 : 10 分間 (お好みの間隔でチェック・更新させる)
            - 継続時間 : 無制限
    - 「操作」タブ (Windows Terminal 等のウィンドウを表示させずに実行するため VBScript 経由で起動する)
        - 操作 : プログラムの開始
        - プログラム/スクリプト : `C:\Windows\System32\wscript.exe`
        - 引数の追加 (オプション) : `"C:\PATH\TO\update-cloudflare-dns.vbs"` (VBScript へのフルパスを指定する・ダブルクォートで囲んでおく)
        - 開始 (オプション) : 空白で良い (実行プログラムにとってのカレントディレクトリとなる)
    - 「条件」タブ
        - 全てチェックを外し、タスクが実行されないタイミングが発生しないようにする
    - 「設定」タブ
        - タスクを要求時に実行する : チェックする
        - スケジュールされた時刻にタスクを開始できなかった場合、すぐにタスクを実行する : チェックする
        - 要求時に実行中のタスクが終了しない場合、タスクを強制的に停止する : チェックする
        - タスクが既に実行中の場合に適用される規則 : 「既存のインスタンスの停止」を選択する
- ※ タスクスケジューラより「エクスポート」した設定例を `taskschd-example.xml` として格納してある。コレを参考にインポート・設定すると良い


## `curl` での API コール例

```bash
# A レコードの DNS レコード一覧を取得する
$ curl 'https://api.cloudflare.com/client/v4/zones/【ゾーン ID】/dns_records?type=A&per_page=500' -H 'Authorization: Bearer 【API トークン】' | jq .
{
  "result": [
    {
      "id": "【レコード ID】",
      "name": "dns.example.com",
      "type": "A",
      "content": "【IP アドレス】",
      "proxiable": false,
      "proxied": false,  // ← `false` になっていること
      "ttl": 1,
      "settings": {},
      "meta": {},
      "comment": "DNS",
      "tags": [],
      "created_on": "2026-01-01T00:00:00.000000Z",
      "modified_on": "2026-01-01T00:00:00.000000Z",
      "comment_modified_on": "2026-01-01T00:00:00.000000Z"
    },
    // …
  ],
  "success": true,
  "errors": [],
  "messages": [],
  "result_info": {
    "page": 1,
    "per_page": 500,
    "count": 6,
    "total_count": 6,
    "total_pages": 1
  }
}

# DNS レコードを更新する
$ curl 'https://api.cloudflare.com/client/v4/zones/【ゾーン ID】/dns_records/【レコード ID】' -X PATCH -H 'Content-Type: application/json' -H 'Authorization: Bearer 【API トークン】' -d '{ "content": "【IP アドレス】", "proxied": false }'
{
  "result": {
    "id": "【レコード ID】",
    "name": "dns.example.com",
    "type": "A",
    "content": "【IP アドレス】",
    "proxiable": false,
    "proxied": false,
    "ttl": 1,
    "settings": {},
    "meta": {},
    "comment": "DNS",
    "tags": [],
    "created_on": "2026-01-01T00:00:00.000000Z",
    "modified_on": "2026-01-01T00:00:00.000000Z",
    "comment_modified_on": "2026-01-01T00:00:00.000000Z"
  },
  "success": true,
  "errors": [],
  "messages": []
}
```


## Links

- [Neo's World](https://neos21.net/)
