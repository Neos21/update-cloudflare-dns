Option Explicit

' 本 VBS ファイルと同階層にある JS ファイルのフルパスを組み立てて実行する
' 0 = ウィンドウを非表示にする
' True = Node.js の終了まで待つ
WScript.CreateObject("WScript.Shell").Run "node.exe """ & Replace(WScript.ScriptFullName, ".vbs", ".js") & """", 0, True
