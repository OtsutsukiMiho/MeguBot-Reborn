@echo off
:loop
node . 
timeout /t 3 > nul
goto loop
