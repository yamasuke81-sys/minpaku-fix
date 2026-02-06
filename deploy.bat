@echo off
chcp 65001 >nul
title 民泊アプリ デプロイ

REM このバッチファイルがあるフォルダ（minpaku-gas-app）で実行
cd /d "%~dp0"

echo ========================================
echo  民泊予約・清掃管理 Webアプリ デプロイ
echo ========================================
echo.
echo 作業フォルダ: %cd%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo エラー: npm が見つかりません。Node.js をインストールしてください。
  echo.
  pause
  exit /b 1
)

echo デプロイを実行しています...
echo.
call npm run deploy
set EXIT_CODE=%errorlevel%
echo.
if %EXIT_CODE% equ 0 (
  echo デプロイが完了しました。
) else (
  echo エラーが発生しました。コード: %EXIT_CODE%
)
echo.
pause
