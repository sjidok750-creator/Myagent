@echo off
chcp 65001 >nul
title 헤뤼싀 비서실 (이 창을 닫으면 헤뤼싀가 잠듭니다)
cd /d "%~dp0"

REM 내 설정을 읽는다. 없으면 만들라고 알려준다.
REM 헤뤼싀설정.bat 은 저장소에 올라가지 않는다 (접속 코드가 들어 있으므로).
if exist "헤뤼싀설정.bat" (
  call "헤뤼싀설정.bat"
) else (
  echo.
  echo   설정 파일이 없습니다.
  echo   이 폴더에 헤뤼싀설정.bat 을 만들고 아래 두 줄을 넣으세요:
  echo.
  echo       set HERUSHI_HOME=D:\
  echo       set HERUSHI_CODE=원하는숫자
  echo.
  echo   (헤뤼싀설정.예시.bat 을 복사해서 고치면 됩니다)
  echo.
  pause
  exit /b 1
)

npm run herushi

REM 어떤 이유로든 멈추면 창을 남겨 원인을 볼 수 있게 한다
echo.
echo   헤뤼싀가 멈췄습니다. 위 메시지를 확인하세요.
pause
