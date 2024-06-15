setlocal
cd /d %~dp0
@REM call ts-node "%~dp0upload.ts" %1
call npm run ts-node %1
endlocal

