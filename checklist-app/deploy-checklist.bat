@echo off
chcp 65001 >nul
echo ====================================
echo チェックリストアプリ - 自動デプロイ
echo ====================================
echo.

cd /d "%~dp0"

echo 1. コードをプッシュしています...
call npx clasp push
if errorlevel 1 (
    echo.
    echo [エラー] clasp push に失敗しました
    pause
    exit /b 1
)

echo.
echo ====================================
echo デプロイ完了！
echo ====================================
echo.
echo チェックリストアプリのURL:
echo https://script.google.com/macros/s/AKfycbyhVlj_IiLIk0tjKUFKjDBA4SNQ4EEVpgj_0WsSBw3JVMtcclOs5XzwHUfy9x9pExK_/exec
echo.
echo ※ ブラウザで Ctrl+Shift+R してください（ハードリフレッシュ）
echo.
pause
