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
    echo     USB and adb device streaming will work normally.
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

REM 5. Deploy scrcpy Distribution
echo [*] Checking bundled scrcpy and ADB distribution...
set "SCRCPY_DIR=%VERTEX_DIR%\\scrcpy"

if exist "%~dp0windows-agent\\resources\\scrcpy-win64-v3.3.4\\scrcpy.exe" (
    echo [*] Found local scrcpy 3.3.4 distribution. Deploying to agent directory...
    xcopy /Y /E /I "%~dp0windows-agent\\resources\\scrcpy-win64-v3.3.4\\*" "%SCRCPY_DIR%\\" >nul
) else if exist "%~dp0resources\\scrcpy-win64-v3.3.4\\scrcpy.exe" (
    echo [*] Found local scrcpy 3.3.4 distribution. Deploying to agent directory...
    xcopy /Y /E /I "%~dp0resources\\scrcpy-win64-v3.3.4\\*" "%SCRCPY_DIR%\\" >nul
) else if exist "%SCRCPY_DIR%\\scrcpy.exe" (
    echo [*] scrcpy already installed in %SCRCPY_DIR%
) else (
    echo [*] Fetching scrcpy 3.3.4 official binaries from controller...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference = 'Stop'; " ^
      "try { " ^
      "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "  Invoke-WebRequest -Uri '${backendUrl}/api/enrollment/download-scrcpy' -OutFile '%VERTEX_DIR%\\scrcpy.zip'; " ^
      "  Expand-Archive -Path '%VERTEX_DIR%\\scrcpy.zip' -DestinationPath '%VERTEX_DIR%\\scrcpy_extract' -Force; " ^
      "  Remove-Item '%VERTEX_DIR%\\scrcpy.zip' -Force; " ^
      "  if (Test-Path '%VERTEX_DIR%\\scrcpy_extract\\scrcpy-win64-v3.3.4') { " ^
      "    Copy-Item -Path '%VERTEX_DIR%\\scrcpy_extract\\scrcpy-win64-v3.3.4\\*' -Destination '%SCRCPY_DIR%' -Recurse -Force; " ^
      "  } else { " ^
      "    Copy-Item -Path '%VERTEX_DIR%\\scrcpy_extract\\*' -Destination '%SCRCPY_DIR%' -Recurse -Force; " ^
      "  }; " ^
      "  Remove-Item '%VERTEX_DIR%\\scrcpy_extract' -Recurse -Force; " ^
      "  Write-Host '[OK] scrcpy binaries successfully deployed.' -ForegroundColor Green; " ^
      "} catch { " ^
      "  Write-Host ('[ERROR] Failed to download scrcpy: ' + $_.Exception.Message) -ForegroundColor Red; " ^
      "  exit 1; " ^
      "}"
)

REM 6. Test ADB Availability
if exist "%SCRCPY_DIR%\\adb.exe" (
    echo [OK] ADB is ready at "%SCRCPY_DIR%\\adb.exe"
) else (
    echo [ERROR] adb.exe was not found in %SCRCPY_DIR%.
    echo.
    pause
    exit /b 1
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
