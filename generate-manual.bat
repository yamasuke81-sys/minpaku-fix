@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   マニュアル自動生成ツール
echo ========================================
echo.

REM カレントディレクトリをこのbatファイルの場所に固定
cd /d "%~dp0"

REM manual-generator フォルダがなければエラー
if not exist "manual-generator\package.json" (
    echo [エラー] manual-generator フォルダが見つかりません。
    echo         git pull を実行してください:
    echo.
    echo         git pull origin claude/update-handoff-docs-897D8
    echo.
    pause
    exit /b 1
)

REM node_modules がなければ npm install
if not exist "manual-generator\node_modules" (
    echo [1/3] npm install 実行中...
    cd manual-generator
    call npm install
    if errorlevel 1 (
        echo.
        echo [エラー] npm install に失敗しました。Node.js がインストールされているか確認してください。
        pause
        exit /b 1
    )
    cd ..
    echo.
) else (
    echo [1/3] npm install ... スキップ（インストール済み）
)

echo [2/3] スクリーンショット撮影中...
cd manual-generator
call node screenshot.js
if errorlevel 1 (
    echo.
    echo [警告] スクリーンショット撮影でエラーがありました。
    echo        マニュアルは画像なしで生成を続けます。
    echo.
)

echo [3/3] HTMLマニュアル生成中...
call node generate-manual.js
cd ..

echo.
echo ========================================
echo   完了！
echo ========================================
echo.
echo   出力ファイル: manual-generator\manual.html
echo.

REM 生成したHTMLを自動で開く
if exist "manual-generator\manual.html" (
    echo   ブラウザで開きます...
    start "" "manual-generator\manual.html"
)

echo.
pause
