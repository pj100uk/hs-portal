@echo off
setlocal
cls

echo ================================================
echo   HS Portal - Advisor Machine Setup
echo ================================================
echo.
echo Configures your machine so H^&S documents open
echo directly in Word from the portal.
echo No administrator permissions required.
echo.
echo Press any key to start, or close to cancel.
pause >nul

echo.

REM ── Check Datto is running ─────────────────────────────────────────────────
if not exist "W:\Customer Documents\" (
    echo.
    echo [ERROR] W:\Customer Documents\ not found.
    echo Make sure Datto WorkPlace is running and the
    echo W: drive is connected, then run this again.
    echo.
    pause
    exit /b 1
)

echo Applying settings for %COMPUTERNAME%...
echo.

REM ── Local Intranet zone ────────────────────────────────────────────────────
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Domains\%COMPUTERNAME%" /v file /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Ranges\DattoWorkplace" /v :Range /t REG_SZ /d "\\%COMPUTERNAME%\Workplace" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ZoneMap\Ranges\DattoWorkplace" /v file /t REG_DWORD /d 1 /f >nul 2>&1
echo [OK] Datto drive added to Local Intranet zone

REM ── Office hyperlink warning ───────────────────────────────────────────────
reg add "HKCU\Software\Microsoft\Office\Common\Security" /v DisableHyperlinkWarning /t REG_DWORD /d 1 /f >nul 2>&1
echo [OK] Office hyperlink prompt disabled

REM ── Word, Excel, PowerPoint Trusted Locations (Office 2013 + 2016/365) ────
reg add "HKCU\Software\Microsoft\Office\16.0\Word\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\Word\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\Word\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\Excel\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\Excel\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\Excel\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\PowerPoint\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\PowerPoint\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\16.0\PowerPoint\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Word\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Word\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Word\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Excel\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Excel\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\Excel\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\PowerPoint\Security" /v AllowNetworkLocations /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\PowerPoint\Security\Trusted Locations\Location15" /v Path /t REG_SZ /d "\\%COMPUTERNAME%\Workplace\Customer Documents" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Office\15.0\PowerPoint\Security\Trusted Locations\Location15" /v AllowSubfolders /t REG_DWORD /d 1 /f >nul 2>&1
echo [OK] Word, Excel and PowerPoint Trusted Locations set

echo.
echo ================================================
echo   Done! Close and reopen Word before testing.
echo ================================================
echo.
echo In the HS Portal, open Settings and click
echo "Auto-detect" under Datto Path (one-time only).
echo.
echo Note: you may see a one-time "Do you trust this
echo content?" prompt in Word - click Yes to proceed.
echo.
pause
