@echo off
chcp 65001 >nul
title デプロイ環境チェック
cd /d "%~dp0"

echo ========================================
echo  デプロイに必要な環境のチェック
echo ========================================
echo.

set OK=0
set NG=0

REM Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [NG] Node.js が見つかりません。インストールしてください: https://nodejs.org/
  set NG=1
) else (
  for /f "tokens=*" %%v in ('node -v 2^>nul') do echo [OK] Node.js: %%v
  set OK=1
)

REM npm
where npm >nul 2>nul
if errorlevel 1 (
  echo [NG] npm が見つかりません。Node.js をインストールすると付属します。
  set NG=1
) else (
  for /f "tokens=*" %%v in ('npm -v 2^>nul') do echo [OK] npm: %%v
  set OK=1
)

REM .clasp.json
if not exist ".clasp.json" (
  echo [NG] .clasp.json がありません。.clasp.json.sample をコピーし、scriptId を設定してください。
  set NG=1
) else (
  echo [OK] .clasp.json あり
)

REM deploy-config.json
if not exist "deploy-config.json" (
  echo [NG] deploy-config.json がありません。deploy-config.sample.json をコピーし、デプロイIDを設定してください。
  set NG=1
) else (
  echo [OK] deploy-config.json あり
)

echo.
if %NG% neq 0 (
  echo 上記の [NG] を解消してください。
  echo 解消後、もう一度このバッチを実行するか、deploy-minpaku.bat を実行してください。
) else (
  echo 環境は問題なさそうです。
  echo.
  echo 初回のみ: npx clasp login を実行して Google にログインしてください。
  echo   → コマンドプロンプトで「npx clasp login」と入力し Enter
  echo   → ブラウザが開いたら Google アカウントで許可
  echo.
  echo その後、NotifyInbox フォルダの deploy-minpaku.bat をダブルクリックでデプロイできます。
)
echo.
pause
