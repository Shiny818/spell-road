@echo off
chcp 65001 > nul
rem スマホでのテストプレイ用。PCと同じWi-Fiにつないだスマホから遊べるように、開発用サーバーを起動する。
cd /d "%~dp0"

where npm > nul 2> nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ からインストールしてください。
  pause
  exit /b 1
)

rem 同じネットワーク内でのPCのアドレス（インターネットにつながっている接続のもの）
set IP=
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"`) do set IP=%%a
if "%IP%"=="" (
  echo PCのネットワークのアドレスが分かりませんでした。Wi-Fiまたは有線LANにつながっているか確認してください。
  pause
  exit /b 1
)
set URL=http://%IP%:5180

rem すでに起動しているとき
netstat -ano | findstr ":5180 " | findstr "LISTENING" > nul
if not errorlevel 1 (
  netstat -ano | findstr "0.0.0.0:5180 \[::\]:5180 " | findstr "LISTENING" > nul
  if errorlevel 1 (
    echo PC用の testplay.bat で起動中のため、スマホからはつながりません。
    echo そちらのウィンドウを閉じてから、もう一度このファイルを開いてください。
    pause
    exit /b 1
  )
  echo すでにスマホ用で起動しています。
  echo スマホのブラウザで次のアドレスを開いてください: %URL%
  pause
  exit /b 0
)

if not exist node_modules (
  echo 初回のため、必要なパッケージをインストールします...
  call npm install
  if errorlevel 1 (
    echo インストールに失敗しました。
    pause
    exit /b 1
  )
)

echo ================================================================
echo  スマホのブラウザで次のアドレスを開いてください
echo.
echo      %URL%
echo.
echo  ・スマホはPCと同じWi-Fiにつないでください。
echo  ・初回に「Windows セキュリティの重要な警告」が出たら、
echo    「プライベート ネットワーク」にチェックを入れて「アクセスを許可する」を押してください。
echo  ・つながらないときは README.md の「スマホでつながらないとき」を見てください。
echo  ・終了するときは、このウィンドウを閉じてください。
echo ================================================================
echo.
call npm run dev -- --host
pause
