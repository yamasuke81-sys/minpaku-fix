@echo off

:: UTF-8
%SystemRoot%\system32\chcp.com 65001 >nul 2>nul

echo ==========================================
echo   minpaku app - Full Auto Deploy
echo   (1) git pull
echo   (2) Main app: push + deploy new version
echo   (3) Checklist: push + deploy new version
echo ==========================================
echo.

cd /d "%~dp0"

:: Node.js check
node --version >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js not found in PATH.
    echo   Install from https://nodejs.org/
    echo   After install, restart PC.
    pause
    exit /b 1
)

echo [OK] Node.js:
node --version
echo.

:: 1. git pull（ブランチ情報表示付き）
echo [1/3] git pull ...
for /f "tokens=*" %%a in ('git branch --show-current 2^>nul') do set CURRENT_BRANCH=%%a
echo    Branch: %CURRENT_BRANCH%
git pull
if errorlevel 1 (
    echo [Warning] git pull failed. Continuing with local code.
)
for /f "tokens=*" %%a in ('git log --oneline -1 2^>nul') do set LATEST_COMMIT=%%a
echo    Latest: %LATEST_COMMIT%
echo.

:: 2. Main app: deploy.js (push + deploy both owner and staff)
echo [2/3] Main app: push + deploy ...
if not exist "deploy.js" (
    echo [Error] deploy.js not found.
    pause
    exit /b 1
)
if not exist "deploy-config.json" (
    echo [Error] deploy-config.json not found.
    echo   Copy deploy-config.sample.json to deploy-config.json
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

:: 3. Checklist app: deploy-checklist.js (push + deploy)
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
echo   All done! Both apps deployed.
echo   No manual steps needed.
echo ==========================================
echo.
pause
