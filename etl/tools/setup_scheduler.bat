@echo off
REM KR 일별 ETL — Windows 작업 스케줄러 등록
REM 실행: 관리자 권한으로 setup_scheduler.bat 실행

set TASK_NAME=CANSLIM_Daily_ETL
set PROJECT_DIR=C:\Projects\canslim
set PYTHON=C:\Users\sanghyun\AppData\Local\Programs\Python\Python312\python.exe

echo 기존 작업 삭제 (있으면)...
schtasks /Delete /TN "%TASK_NAME%" /F 2>nul

echo 작업 등록 중...
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /TR "cmd /c \"cd /d %PROJECT_DIR% && set PYTHONUTF8=1 && \"%PYTHON%\" -m etl.kr_adapter.run_daily >> etl_daily.log 2>&1\"" ^
  /SC WEEKLY ^
  /D MON,TUE,WED,THU,FRI ^
  /ST 16:10 ^
  /SD 01/01/2026 ^
  /RL HIGHEST ^
  /RU "%USERNAME%" ^
  /IT ^
  /F

echo.
echo [작업 스케줄러 설정 완료]
echo   작업명: %TASK_NAME%
echo   실행:   평일(월~금) 오후 4시 10분
echo   경로:   %PROJECT_DIR%
echo.
echo 수동 실행 테스트:
echo   schtasks /Run /TN "%TASK_NAME%"
pause
