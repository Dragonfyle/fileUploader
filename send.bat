setlocal
cd /d %~dp0
call ts-node "%~dp0upload.ts" %1
endlocal

