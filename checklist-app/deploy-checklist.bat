@echo off
chcp 65001 >nul
echo ==========================================
echo  チェックリストアプリ デプロイ
echo ==========================================
echo.

cd /d "%~dp0"

echo 事前チェック: Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js がインストールされていません。
    echo https://nodejs.org/ からインストールしてください。
    pause
    exit /b 1
)

node deploy-checklist.js %*
if errorlevel 1 (
    echo.
    echo [エラー] デプロイに失敗しました。上のメッセージを確認してください。
    pause
    exit /b 1
)

echo.
pause
