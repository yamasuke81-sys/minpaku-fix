@echo off

:: UTF-8
%SystemRoot%\system32\chcp.com 65001 >nul 2>nul

echo ==========================================
echo   minpaku app - Full Auto Deploy
echo ==========================================
echo.

cd /d "%~dp0"

:: Node.js check
node --version >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js not found in PATH.
    pause
    exit /b 1
)

:: ブランチ切り替え＋最新コード取得
echo [1/3] Updating code ...
git stash -u -q 2>nul
git fetch origin claude/fix-sheet-name-variable-tBTum
git checkout -f claude/fix-sheet-name-variable-tBTum 2>nul
git reset --hard origin/claude/fix-sheet-name-variable-tBTum
for /f "tokens=*" %%a in ('git log --oneline -1 2^>nul') do echo    Latest: %%a
echo.

:: Main app
echo [2/3] Main app: push + deploy ...
if not exist "deploy-config.json" (
    echo [Error] deploy-config.json not found.
    pause
    exit /b 1
)
call node deploy.js
if errorlevel 1 (
    echo [Error] Main app deploy failed.
    pause
    exit /b 1
)
echo.

:: Checklist app
echo [3/3] Checklist app: push + deploy ...
cd /d "%~dp0checklist-app"
if not exist "deploy-checklist.js" (
    echo [Skip] checklist-app/deploy-checklist.js not found.
    cd /d "%~dp0"
    goto :done
)
call node deploy-checklist.js
if errorlevel 1 (
    echo [Error] Checklist app deploy failed.
    cd /d "%~dp0"
    pause
    exit /b 1
)
cd /d "%~dp0"

:done
echo.
echo ==========================================
echo   All done!
echo ==========================================
echo.
pause
