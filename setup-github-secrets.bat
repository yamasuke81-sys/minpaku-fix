@echo off
chcp 65001 >nul
echo ========================================
echo   GitHub Actions 自動デプロイ セットアップ
echo ========================================
echo.

:: gh CLI がインストールされているかチェック
where gh >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [エラー] GitHub CLI (gh) がインストールされていません。
    echo.
    echo 以下のコマンドでインストールしてください:
    echo   winget install --id GitHub.cli
    echo.
    echo インストール後、このスクリプトを再実行してください。
    pause
    exit /b 1
)

:: gh にログインしているかチェック
gh auth status >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [情報] GitHub CLI にログインします...
    gh auth login
    if %ERRORLEVEL% neq 0 (
        echo [エラー] ログインに失敗しました。
        pause
        exit /b 1
    )
)

echo [1/3] clasp認証情報をGitHub Secretsに登録中...
set CLASPRC=%USERPROFILE%\.clasprc.json
if not exist "%CLASPRC%" (
    echo [エラー] %CLASPRC% が見つかりません。
    echo   先に clasp login を実行してください。
    pause
    exit /b 1
)
gh secret set CLASPRC_JSON --repo yamasuke81-sys/minpaku-fix < "%CLASPRC%"
if %ERRORLEVEL% equ 0 (
    echo   OK - CLASPRC_JSON を登録しました
) else (
    echo   [エラー] CLASPRC_JSON の登録に失敗しました
    pause
    exit /b 1
)

echo.
echo [2/3] deploy-config.json をGitHub Secretsに登録中...
set DEPLOY_CFG=%~dp0deploy-config.json
if not exist "%DEPLOY_CFG%" (
    echo [警告] deploy-config.json が見つかりません。スキップします。
    echo   初回デプロイ時に自動生成されますが、URLが変わる可能性があります。
) else (
    gh secret set DEPLOY_CONFIG_JSON --repo yamasuke81-sys/minpaku-fix < "%DEPLOY_CFG%"
    if %ERRORLEVEL% equ 0 (
        echo   OK - DEPLOY_CONFIG_JSON を登録しました
    ) else (
        echo   [エラー] DEPLOY_CONFIG_JSON の登録に失敗しました
    )
)

echo.
echo [3/3] 設定確認...
gh secret list --repo yamasuke81-sys/minpaku-fix
echo.
echo ========================================
echo   セットアップ完了！
echo ========================================
echo.
echo これ以降、claude/* ブランチや main ブランチに
echo コードがpushされると自動でデプロイされます。
echo.
echo 手動デプロイも引き続き使えます:
echo   node deploy-all.js
echo.
pause
