@echo off
chcp 65001 >nul
echo ========================================
echo 民泊管理アプリ - 自動デプロイ（分離版）
echo ========================================
echo.

REM カレントディレクトリを保存
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

echo [1/4] プロジェクトディレクトリを確認中...
if not exist ".git" (
    echo エラー: Gitリポジトリが見つかりません
    echo このスクリプトはプロジェクトのルートディレクトリに配置してください
    pause
    exit /b 1
)
echo ✓ プロジェクトディレクトリ: %SCRIPT_DIR%
echo.

echo [2/4] ブランチを切り替え中...
git checkout claude/add-owner-page-url-y5SdA
if errorlevel 1 (
    echo エラー: ブランチの切り替えに失敗しました
    pause
    exit /b 1
)
echo ✓ ブランチ: y5SdA（チェックリスト分離版）
echo.

echo [3/4] リモートから最新を取得中...
git pull origin claude/add-owner-page-url-y5SdA
if errorlevel 1 (
    echo 警告: プルに失敗しました（続行します）
)
echo ✓ リモート同期完了
echo.

echo [4/4] 予約管理アプリをデプロイ中...
call npm run deploy
if errorlevel 1 (
    echo エラー: デプロイに失敗しました
    pause
    exit /b 1
)
echo.

echo ========================================
echo ✓ 予約管理アプリのデプロイ完了！
echo ========================================
echo.
echo 【重要】次の手順で設定を確認してください:
echo.
echo 1. Script Properties の確認
echo    - Apps Scriptエディタを開く
echo    - 「プロジェクトの設定」→「スクリプト プロパティ」
echo    - CHECKLIST_APP_URL が設定されているか確認
echo    - 値: https://script.google.com/macros/s/AKfycbyhVlj_IiLIk0tjKUFKjDBA4SNQ4EEVpgj_0WsSBw3JVMtcclOs5XzwHUfy9x9pExK_/exec
echo.
echo 2. ブラウザでテスト
echo    - Ctrl+Shift+R でハードリフレッシュ
echo    - 清掃詳細モーダルを開く
echo    - 「チェックリスト」ボタンをクリック
echo    - チェックリストアプリが新しいタブで開くはずです
echo.
echo ========================================
echo.
pause
