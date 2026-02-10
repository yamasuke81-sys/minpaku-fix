@echo off

:: UTF-8
%SystemRoot%\system32\chcp.com 65001 >nul 2>nul

echo ==========================================
echo   minpaku app - Deploy All
echo   (1) git pull  (2) Main app  (3) Checklist
echo ==========================================
echo.

cd /d "%~dp0"

:: Node.js check (use node directly, not "where")
node --version >nul 2>nul
if errorlevel 1 (
    echo [Info] Node.js not in PATH. Searching...
    :: Try common install locations
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
        goto :node_found
    )
    if exist "%LOCALAPPDATA%\fnm_multishells" (
        for /f "delims=" %%d in ('dir /b /ad /o-d "%LOCALAPPDATA%\fnm_multishells" 2^>nul') do (
            if exist "%LOCALAPPDATA%\fnm_multishells\%%d\node.exe" (
                set "PATH=%LOCALAPPDATA%\fnm_multishells\%%d;%PATH%"
                goto :node_found
            )
        )
    )
    if exist "%APPDATA%\nvm" (
        for /f "delims=" %%d in ('dir /b /ad "%APPDATA%\nvm\v*" 2^>nul') do (
            if exist "%APPDATA%\nvm\%%d\node.exe" (
                set "PATH=%APPDATA%\nvm\%%d;%PATH%"
                goto :node_found
            )
        )
    )
    echo [Error] Node.js not found.
    echo   Please install from https://nodejs.org/
    echo   After install, restart PC.
    pause
    exit /b 1
)

:node_found
echo [OK] Node.js:
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
call npx clasp push
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
    echo [Skip] checklist-app/.clasp.json not found.
    cd /d "%~dp0"
    goto :done
)
call npx clasp push
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
echo   Done! Both apps pushed via clasp.
echo   Next: Open GAS editor
echo   Deploy - Manage deployments - Edit
echo   - New version - Deploy
echo ==========================================
echo.
pause
