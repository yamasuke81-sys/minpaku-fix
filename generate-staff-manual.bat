@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   スタッフ操作マニュアル 自動生成
echo ========================================
echo.
echo   実際のアプリからスクリーンショットを撮影し、
echo   それを使ったHTMLマニュアルを生成します。
echo.

REM カレントディレクトリをこのbatファイルの場所に固定
cd /d "%~dp0"

REM manual-generator フォルダ確認
if not exist "manual-generator\package.json" (
    echo [エラー] manual-generator フォルダが見つかりません。
    echo         git pull を実行してください:
    echo.
    echo         git pull origin claude/update-handoff-docs-897D8
    echo.
    pause
    exit /b 1
)

REM deploy-config.json 確認
if not exist "deploy-config.json" (
    echo [エラー] deploy-config.json が見つかりません。
    echo         ownerDeploymentId を設定した deploy-config.json を
    echo         リポジトリルートに配置してください。
    echo.
    echo         例:
    echo         {
    echo           "ownerDeploymentId": "AKfycb..."
    echo         }
    echo.
    echo         または --url オプション付きで直接実行:
    echo         cd manual-generator
    echo         node staff-manual-screenshot.js --url "https://script.google.com/macros/s/.../exec"
    echo.
    pause
    exit /b 1
)

REM node_modules がなければ npm install
if not exist "manual-generator\node_modules" (
    echo [1/3] npm install 実行中（初回のみ・Chromiumダウンロード含む）...
    echo       少し時間がかかります...
    cd manual-generator
    call npm install
    if errorlevel 1 (
        echo.
        echo [エラー] npm install に失敗しました。
        echo         Node.js がインストールされているか確認してください。
        echo         https://nodejs.org/
        pause
        exit /b 1
    )
    cd ..
    echo.
) else (
    echo [1/3] npm install ... スキップ（インストール済み）
)

echo [2/3] アプリのスクリーンショット撮影中...
echo       （ブラウザが自動起動します。Googleログイン後にEnterで撮影開始）
echo.
cd manual-generator
call node staff-manual-screenshot.js --login
if errorlevel 1 (
    echo.
    echo [警告] スクリーンショット撮影でエラーがありました。
    echo        カレンダーに予約・清掃がある月で再実行してください。
    echo.
)

echo.
echo [3/3] HTMLマニュアル生成中...
call node generate-staff-manual.js
cd ..

echo.
echo ========================================
echo   完了！
echo ========================================
echo.
echo   出力ファイル: staff-manual.html
echo.

REM 生成したHTMLを自動で開く
if exist "staff-manual.html" (
    echo   ブラウザで開きます...
    start "" "staff-manual.html"
)

echo.
pause
