@echo off
chcp 65001 >nul 2>nul

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

:: Get latest code - use current local branch
echo [1/3] Fetching latest code ...

:: Get current branch name
set BRANCH=
for /f "delims=" %%b in ('git branch --show-current') do set BRANCH=%%b

if "%BRANCH%"=="" (
    echo [Error] Not on any branch (detached HEAD?).
    echo         Run: git checkout claude/xxx
    pause
    exit /b 1
)

echo    Current branch: %BRANCH%
git fetch origin %BRANCH%
git reset --hard origin/%BRANCH%
for /f "tokens=*" %%a in ('git log --oneline -1 2^>nul') do echo    Latest: %%a
echo.

:: clasp install check
if not exist "node_modules\.bin\clasp.cmd" (
    echo    clasp not found. Installing @google/clasp ...
    call npm install @google/clasp --save-dev
    echo.
)

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
