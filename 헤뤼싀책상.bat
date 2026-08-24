@echo off
chcp 65001 >nul
title 헤뤼싀 책상 - 폰에서 하던 대화를 여기서 이어서
cd /d "%~dp0"

REM 괄호 블록을 쓰지 않는다. echo 문 안의 괄호가 블록을 조기에 닫는다.

if not exist "tools\herushi-desk.mjs" goto WRONGFOLDER
if not exist "헤뤼싀설정.bat" goto NOSETTINGS

call "헤뤼싀설정.bat"
npm run herushi:desk -- %1

echo.
pause
exit /b


:WRONGFOLDER
echo.
echo   여기는 Myagent 폴더가 아닙니다.
echo   지금 위치: %CD%
echo.
echo   이 파일은 Myagent 폴더 안에서 실행해야 합니다.
echo.
pause
exit /b 1


:NOSETTINGS
echo.
echo   설정 파일이 없습니다.
echo.
echo   이 폴더에서 아래 두 줄을 실행하세요:
echo       copy 헤뤼싀설정.예시.bat 헤뤼싀설정.bat
echo       notepad 헤뤼싀설정.bat
echo.
pause
exit /b 1
