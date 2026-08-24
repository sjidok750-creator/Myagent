@echo off
chcp 65001 >nul
title 헤뤼싀 비서실 - 이 창을 닫으면 헤뤼싀가 잠듭니다
cd /d "%~dp0"

REM 괄호 블록을 쓰지 않는다. echo 문 안의 괄호가 블록을 조기에 닫는다.
REM goto 라벨 방식이라 본문에 어떤 글자가 와도 안전하다.

if not exist "tools\herushi-bridge.mjs" goto WRONGFOLDER
if not exist "헤뤼싀설정.bat" goto NOSETTINGS

call "헤뤼싀설정.bat"
npm run herushi

echo.
echo   헤뤼싀가 멈췄습니다. 위 메시지를 확인하세요.
pause
exit /b


:WRONGFOLDER
echo.
echo   여기는 Myagent 폴더가 아닙니다.
echo   지금 위치: %CD%
echo.
echo   이 파일은 Myagent 폴더 안에서 실행해야 합니다:
echo       %USERPROFILE%\Documents\Myagent
echo.
echo   바탕화면에 두고 쓰시려면 복사하지 말고 바로 가기를 만드세요.
echo   헤뤼싀.bat 오른쪽 클릭 - 바로 가기 만들기 - 바탕화면으로 옮기기
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
echo   메모장에서 두 줄을 고치고 저장하면 됩니다:
echo       set HERUSHI_HOME=D:\
echo       set HERUSHI_CODE=원하는숫자
echo.
pause
exit /b 1
