@echo off

:: UTF-8に切り替え（chcpが使えない環境でもエラーにしない）
%SystemRoot%\system32\chcp.com 65001 >nul 2>nul

echo ==========================================
echo   minpaku app - Deploy All
echo   (1) git pull  (2) Main app  (3) Checklist
echo ==========================================
echo.

cd /d "%~dp0"

:: Node.js PATH補完（よくあるインストール先を追加）
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\Node.js;%USERPROFILE%\AppData\Roaming\nvm\current"

:: Node.js チェック
where node >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js ga install sareteimasen.
    echo   https://nodejs.org/ kara install shitekudasai.
    echo   Install-go, PC wo saikidou shitekudasai.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node --version
echo.

:: 1. git pull
echo [1/3] git pull ...
git pull
if errorlevel 1 (
    echo [Warning] git pull failed. Continuing with local code.
)
echo.

:: 2. Main app clasp push
echo [2/3] Main app clasp push ...
npx clasp push
if errorlevel 1 (
    echo [Error] Main app clasp push failed.
    pause
    exit /b 1
)
echo   Main app push OK.
echo.

:: 3. Checklist app clasp push
echo [3/3] Checklist app clasp push ...
cd /d "%~dp0checklist-app"
if not exist ".clasp.json" (
    echo [Skip] checklist-app/.clasp.json not found. Skipping checklist deploy.
    cd /d "%~dp0"
    goto :done
)
npx clasp push
if errorlevel 1 (
    echo [Error] Checklist app clasp push failed.
    cd /d "%~dp0"
    pause
    exit /b 1
)
echo   Checklist app push OK.
cd /d "%~dp0"

:done
echo.
echo ==========================================
echo   Done!
echo   Both apps pushed via clasp.
echo   Next: Open GAS editor, go to
echo   Deploy - Manage deployments - Edit
echo   - New version - Deploy
echo ==========================================
echo.
pause
