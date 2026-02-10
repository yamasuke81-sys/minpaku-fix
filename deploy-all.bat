@echo off
chcp 65001 >nul
echo ==========================================
echo  民泊アプリ 全体デプロイ
echo  (1) git pull  (2) メインアプリ  (3) チェックリスト
echo ==========================================
echo.

cd /d "%~dp0"

:: Node.js チェック
where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js がインストールされていません。
    pause
    exit /b 1
)

:: 1. git pull
echo [1/3] 最新コードを取得中...
git pull
if errorlevel 1 (
    echo [警告] git pull に失敗しました。ローカルのコードでデプロイを続行します。
)
echo.

:: 2. メインアプリ clasp push + deploy
echo [2/3] メインアプリをデプロイ中...
echo   clasp push...
npx clasp push
if errorlevel 1 (
    echo [エラー] メインアプリの clasp push に失敗しました。
    pause
    exit /b 1
)
echo   メインアプリのプッシュ完了。
echo   ※ GASエディタで「デプロイを管理」→ 編集 → 新しいバージョン → デプロイ してください。
echo.

:: 3. チェックリストアプリ clasp push + deploy
echo [3/3] チェックリストアプリをデプロイ中...
cd /d "%~dp0checklist-app"
if not exist ".clasp.json" (
    echo [スキップ] checklist-app/.clasp.json が見つかりません。チェックリストのデプロイをスキップします。
    cd /d "%~dp0"
    goto :done
)
echo   clasp push...
npx clasp push
if errorlevel 1 (
    echo [エラー] チェックリストアプリの clasp push に失敗しました。
    cd /d "%~dp0"
    pause
    exit /b 1
)
echo   チェックリストアプリのプッシュ完了。
echo   ※ GASエディタで「デプロイを管理」→ 編集 → 新しいバージョン → デプロイ してください。
cd /d "%~dp0"

:done
echo.
echo ==========================================
echo  完了！
echo  両アプリとも clasp push 済みです。
echo  GASエディタで「新しいバージョン」でデプロイを更新してください。
echo ==========================================
echo.
pause
