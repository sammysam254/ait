import { EnrollmentService } from './enrollmentService';
import { inMemoryDb } from '../database/supabaseClient';
import { config } from '../config';

export class ScriptGeneratorService {
  /**
   * Generates a personalized setup.bat script dynamically for the authenticated customer.
   */
  static generateCustomerSetupScript(
    organizationId: string,
    userId: string,
    userEmail: string
  ): { filename: string; content: string; token: string; expiresAt: string } {
    const org = inMemoryDb.organizations.get(organizationId);
    const orgName = org ? org.name : 'Cloud Device Farm';
    const safeOrgSlug = (org ? org.slug : 'customer').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Generate fresh enrollment token
    const { token, expiresAt } = EnrollmentService.generateEnrollmentToken(
      organizationId,
      userId,
      `Auto-generated setup script for ${userEmail}`
    );

    const filename = `setup_${safeOrgSlug}.bat`;
    let backendUrl = process.env.PUBLIC_BACKEND_URL || config.backendUrl || 'https://api-streams.sam.co.ke';
    if (backendUrl.includes('13.60.183.142') || backendUrl.includes(':5000')) {
      backendUrl = 'https://api-streams.sam.co.ke';
    }

    const content = `@echo off
chcp 65001 >nul
title Vertex SaaS - Cloud Device Farm Automated Setup
cls

echo ===============================================================================
echo                 VERTEX SAAS CLOUD DEVICE MANAGEMENT PLATFORM
echo                           WINDOWS HOST AGENT SETUP
echo ===============================================================================
echo.
echo Customer Organization : ${orgName}
echo Account Email         : ${userEmail}
echo Cloud Controller Host : ${backendUrl}
echo Enrollment Token      : ${token}
echo Token Valid Until     : ${expiresAt}
echo.
echo ===============================================================================
echo.

REM 1. Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] NOTE: Running with standard user privileges.
    echo     USB and ADB device streaming will work normally.
    echo.
)

REM 2. Check Architecture
if "%PROCESSOR_ARCHITECTURE%" neq "AMD64" if "%PROCESSOR_ARCHITEW6432%" neq "AMD64" (
    echo [ERROR] Vertex SaaS Windows Agent requires a 64-bit x64 Windows OS.
    echo Architecture detected: %PROCESSOR_ARCHITECTURE%
    echo.
    pause
    exit /b 1
)

REM 3. Configure Target Directory
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\\AppData\\Local"
set "VERTEX_DIR=%LOCALAPPDATA%\\VertexSaaS\\Agent"
echo [*] Initializing agent directory: "%VERTEX_DIR%"
if not exist "%VERTEX_DIR%" mkdir "%VERTEX_DIR%" 2>nul
if not exist "%VERTEX_DIR%" (
    set "VERTEX_DIR=%USERPROFILE%\\VertexSaaS\\Agent"
    mkdir "%VERTEX_DIR%" 2>nul
)
if not exist "%VERTEX_DIR%" (
    set "VERTEX_DIR=%~dp0agent_data"
    mkdir "%VERTEX_DIR%" 2>nul
)

set "SCRCPY_DIR=%VERTEX_DIR%\\scrcpy"
if not exist "%SCRCPY_DIR%" mkdir "%SCRCPY_DIR%" 2>nul

REM 4. Write Configuration File
echo [*] Writing agent configuration...
(
    echo {
    echo   "backendUrl": "${backendUrl}",
    echo   "enrollmentToken": "${token}",
    echo   "organizationId": "${organizationId}",
    echo   "computerName": "%COMPUTERNAME%",
    echo   "agentVersion": "1.0.0"
    echo }
) > "%VERTEX_DIR%\\config.json"

REM 5. Search System for Existing ADB & scrcpy Dependencies
echo.
echo [*] Checking and locating ADB and scrcpy dependencies...

REM Check local bundled packages first
if exist "%~dp0windows-agent\\resources\\scrcpy-win64-v3.3.4\\scrcpy.exe" (
    echo [FOUND] Local scrcpy distribution detected in repository. Deploying...
    xcopy /Y /E /I "%~dp0windows-agent\\resources\\scrcpy-win64-v3.3.4\\*" "%SCRCPY_DIR%\\" >nul 2>&1
) else if exist "%~dp0resources\\scrcpy-win64-v3.3.4\\scrcpy.exe" (
    echo [FOUND] Local scrcpy distribution detected. Deploying...
    xcopy /Y /E /I "%~dp0resources\\scrcpy-win64-v3.3.4\\*" "%SCRCPY_DIR%\\" >nul 2>&1
)

REM Search Windows host system for already-installed ADB
if not exist "%SCRCPY_DIR%\\adb.exe" (
    for /f "delims=" %%I in ('where adb.exe 2^>nul') do (
        if exist "%%~I" if not exist "%SCRCPY_DIR%\\adb.exe" (
            echo [FOUND] Discovered existing ADB on system: "%%~I"
            copy /Y "%%~dpIadb.exe" "%SCRCPY_DIR%\\" >nul 2>&1
            copy /Y "%%~dpIAdbWinApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
            copy /Y "%%~dpIAdbWinUsbApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
        )
    )
)

if not exist "%SCRCPY_DIR%\\adb.exe" if exist "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\adb.exe" (
    echo [FOUND] Discovered Android SDK platform-tools ADB.
    copy /Y "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\adb.exe" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\AdbWinApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "%LOCALAPPDATA%\\Android\\Sdk\\platform-tools\\AdbWinUsbApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
)

if not exist "%SCRCPY_DIR%\\adb.exe" if exist "C:\\Program Files (x86)\\ONIRENT\\adb.exe" (
    echo [FOUND] Discovered existing ADB at ONIRENT.
    copy /Y "C:\\Program Files (x86)\\ONIRENT\\adb.exe" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "C:\\Program Files (x86)\\ONIRENT\\AdbWinApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "C:\\Program Files (x86)\\ONIRENT\\AdbWinUsbApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
)

if not exist "%SCRCPY_DIR%\\adb.exe" if exist "C:\\cln\\smartphonetestfarm\\.tools\\platform-tools\\adb.exe" (
    echo [FOUND] Discovered existing ADB at platform-tools.
    copy /Y "C:\\cln\\smartphonetestfarm\\.tools\\platform-tools\\adb.exe" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "C:\\cln\\smartphonetestfarm\\.tools\\platform-tools\\AdbWinApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
    copy /Y "C:\\cln\\smartphonetestfarm\\.tools\\platform-tools\\AdbWinUsbApi.dll" "%SCRCPY_DIR%\\" >nul 2>&1
)

REM Search Windows host system for already-installed scrcpy
if not exist "%SCRCPY_DIR%\\scrcpy.exe" (
    for /f "delims=" %%I in ('where scrcpy.exe 2^>nul') do (
        if exist "%%~I" if not exist "%SCRCPY_DIR%\\scrcpy.exe" (
            echo [FOUND] Discovered existing scrcpy on system: "%%~I"
            xcopy /Y /E /I "%%~dpI*" "%SCRCPY_DIR%\\" >nul 2>&1
        )
    )
)

REM If scrcpy or adb is still missing, automatically install the official distribution
if not exist "%SCRCPY_DIR%\\scrcpy.exe" (
    set "NEED_INSTALL=1"
) else if not exist "%SCRCPY_DIR%\\adb.exe" (
    set "NEED_INSTALL=1"
) else (
    set "NEED_INSTALL=0"
)

if "%NEED_INSTALL%" equ "1" (
    echo [*] Downloading and installing official scrcpy 3.3.4 ^& ADB binaries...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference = 'Stop'; " ^
      "try { " ^
      "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "  $zip = '%VERTEX_DIR%\\scrcpy.zip'; " ^
      "  $extract = '%VERTEX_DIR%\\scrcpy_extract'; " ^
      "  $downloaded = $false; " ^
      "  try { " ^
      "    Write-Host '[*] Fetching bundle from cloud controller...' -ForegroundColor Cyan; " ^
      "    Invoke-WebRequest -Uri '${backendUrl}/api/enrollment/download-scrcpy' -OutFile $zip -TimeoutSec 30; " ^
      "    if ((Get-Item $zip).Length -gt 100000) { $downloaded = $true; } " ^
      "  } catch { " ^
      "    Write-Host '[!] Cloud controller bundle unavailable, falling back to official release...' -ForegroundColor Yellow; " ^
      "  } " ^
      "  if (-not $downloaded) { " ^
      "    Write-Host '[*] Downloading scrcpy 3.3.4 from Genymobile official release...' -ForegroundColor Cyan; " ^
      "    Invoke-WebRequest -Uri 'https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-win64-v3.3.4.zip' -OutFile $zip -TimeoutSec 60; " ^
      "  } " ^
      "  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force; } " ^
      "  Expand-Archive -Path $zip -DestinationPath $extract -Force; " ^
      "  Remove-Item $zip -Force; " ^
      "  $bin = Get-ChildItem -Path $extract -Recurse -Filter 'scrcpy.exe' | Select-Object -First 1; " ^
      "  if ($bin) { " ^
      "    Copy-Item -Path ($bin.Directory.FullName + '\\*') -Destination '%SCRCPY_DIR%' -Recurse -Force; " ^
      "    Write-Host '[OK] scrcpy 3.3.4 and ADB binaries deployed successfully.' -ForegroundColor Green; " ^
      "  } else { " ^
      "    Write-Host '[ERROR] scrcpy.exe was not found in downloaded package.' -ForegroundColor Red; exit 1; " ^
      "  }; " ^
      "  Remove-Item $extract -Recurse -Force; " ^
      "} catch { " ^
      "  Write-Host ('[ERROR] Failed to install scrcpy/ADB: ' + $_.Exception.Message) -ForegroundColor Red; " ^
      "  exit 1; " ^
      "}"
)

REM 6. Verify ADB and scrcpy Availability
echo.
if exist "%SCRCPY_DIR%\\adb.exe" (
    echo [OK] ADB is operational:
    "%SCRCPY_DIR%\\adb.exe" version
) else (
    echo [ERROR] adb.exe could not be found or installed.
    echo.
    pause
    exit /b 1
)

if exist "%SCRCPY_DIR%\\scrcpy.exe" (
    echo [OK] scrcpy is operational:
    "%SCRCPY_DIR%\\scrcpy.exe" --version
) else (
    echo [!] WARNING: scrcpy.exe was not found. Basic ADB device management will work.
)

REM 7. Contact Cloud Controller to Complete Enrollment
echo.
echo [*] Enrolling computer "%COMPUTERNAME%" to ${orgName}...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$body = @{ token = '${token}'; computerName = $env:COMPUTERNAME; osVersion = [System.Environment]::OSVersion.VersionString; arch = $env:PROCESSOR_ARCHITECTURE } | ConvertTo-Json; " ^
  "try { " ^
  "  $resp = Invoke-RestMethod -Uri '${backendUrl}/api/enrollment/enroll' -Method POST -Body $body -ContentType 'application/json'; " ^
  "  if ($resp.success) { " ^
  "    Write-Host '[SUCCESS] Enrolled successfully with Cloud Controller!' -ForegroundColor Green; " ^
  "    Write-Host ('Agent ID : ' + $resp.agent.id); " ^
  "    $resp | ConvertTo-Json | Out-File -FilePath '%VERTEX_DIR%\\agent_credentials.json' -Encoding utf8; " ^
  "  } else { " ^
  "    Write-Host ('[FAILED] ' + $resp.error) -ForegroundColor Red; " ^
  "    exit 1; " ^
  "  } " ^
  "} catch { " ^
  "  Write-Host ('[ERROR] Failed to enroll with controller: ' + $_.Exception.Message) -ForegroundColor Red; " ^
  "  exit 1; " ^
  "}"

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Agent enrollment failed. Please verify your internet connection.
    echo.
    pause
    exit /b 1
)

REM 8. Deploy & Start Agent Runner
echo.
echo [*] Starting Vertex Windows Agent...
where node >nul 2>&1
if %errorLevel% equ 0 (
    if exist "%~dp0windows-agent\\dist\\agent.js" (
        start "Vertex SaaS Host Agent" /b node "%~dp0windows-agent\\dist\\agent.js"
        echo [OK] Vertex Agent started in background via Node.js.
    ) else if exist "%VERTEX_DIR%\\dist\\agent.js" (
        start "Vertex SaaS Host Agent" /b node "%VERTEX_DIR%\\dist\\agent.js"
        echo [OK] Vertex Agent started in background via Node.js.
    ) else (
        echo [*] Agent configured. Start it anytime with: node windows-agent\\dist\\agent.js
    )
) else (
    echo [!] Node.js not detected in system PATH.
    echo     Please install Node.js (https://nodejs.org) to run the background agent worker.
)

echo.
echo ===============================================================================
echo [SUCCESS] SETUP COMPLETE!
echo.
echo Your Windows host is now registered to your Vertex SaaS dashboard.
echo Any Android phones connected via USB (with USB Debugging enabled) will
echo automatically appear on your cloud dashboard at:
echo ${backendUrl}
echo ===============================================================================
echo.
pause
exit /b 0
`;

    return {
      filename,
      content,
      token,
      expiresAt,
    };
  }
}
