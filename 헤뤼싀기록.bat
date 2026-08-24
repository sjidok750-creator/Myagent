@echo off
chcp 65001 >nul
title 헤뤼싀 기록 찾기 - 어느 대화가 헤뤼싀 방인가
cd /d "%~dp0"

if not exist "tools\herushi-scan.mjs" goto WRONGFOLDER
if not exist "헤뤼싀설정.bat" goto NOSETTINGS

call "헤뤼싀설정.bat"
call npm run herushi:scan -- %1

echo.
pause
exit /b


:WRONGFOLDER
echo.
echo   여기는 Myagent 폴더가 아닙니다.
echo   지금 위치: %CD%
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
