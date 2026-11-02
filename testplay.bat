@echo off
chcp 65001 > nul
rem すごろくのテストプレイ用。ダブルクリックで開発用サーバーを起動し、ブラウザで開く。
cd /d "%~dp0"

set URL=http://localhost:5180

where npm > nul 2> nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ からインストールしてください。
  pause
  exit /b 1
)

rem すでに起動しているときはブラウザで開くだけにする
netstat -ano | findstr ":5180 " | findstr "LISTENING" > nul
if not errorlevel 1 (
  echo すでに起動しています。ブラウザで開きます: %URL%
  start "" %URL%
  ping -n 3 127.0.0.1 > nul
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

echo すごろくを起動します: %URL%
echo 終了するときは、このウィンドウを閉じてください。
echo.
call npm run dev -- --open
pause
