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
    const backendUrl = 'https://api-streams.sam.co.ke';
    const dashboardUrl = 'https://vertextstreams.netlify.app';

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
    echo Window will stay open for diagnostics.
    cmd /k
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

REM Clean up any legacy file collision where scrcpy was saved as a file instead of a folder
if exist "%SCRCPY_DIR%" if not exist "%SCRCPY_DIR%\\*" del /f /q "%SCRCPY_DIR%" 2>nul
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
      "$ProgressPreference = 'SilentlyContinue'; " ^
      "$ErrorActionPreference = 'Stop'; " ^
      "try { " ^
      "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
      "  $vertexDir = '%VERTEX_DIR%'; " ^
      "  $scrcpyDir = '%SCRCPY_DIR%'; " ^
      "  if (-not (Test-Path $scrcpyDir -PathType Container)) { " ^
      "    if (Test-Path $scrcpyDir) { Remove-Item $scrcpyDir -Force; } " ^
      "    New-Item -ItemType Directory -Force -Path $scrcpyDir | Out-Null; " ^
      "  } " ^
      "  $zip = Join-Path $vertexDir 'scrcpy.zip'; " ^
      "  $extract = Join-Path $vertexDir 'scrcpy_extract'; " ^
      "  $downloaded = $false; " ^
      "  try { " ^
      "    [Console]::WriteLine('[*] Fetching bundle from cloud controller...'); " ^
      "    Invoke-WebRequest -Uri '${backendUrl}/api/enrollment/download-scrcpy' -OutFile $zip -TimeoutSec 30; " ^
      "    if ((Get-Item $zip).Length -gt 100000) { $downloaded = $true; } " ^
      "  } catch { " ^
      "    [Console]::WriteLine('[!] Cloud controller bundle unavailable, falling back to official release...'); " ^
      "  } " ^
      "  if (-not $downloaded) { " ^
      "    [Console]::WriteLine('[*] Downloading scrcpy 3.3.4 from Genymobile official release...'); " ^
      "    Invoke-WebRequest -Uri 'https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/scrcpy-win64-v3.3.4.zip' -OutFile $zip -TimeoutSec 60; " ^
      "  } " ^
      "  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force; } " ^
      "  Expand-Archive -Path $zip -DestinationPath $extract -Force; " ^
      "  Remove-Item $zip -Force; " ^
      "  $bin = Get-ChildItem -Path $extract -Recurse -Filter 'scrcpy.exe' | Select-Object -First 1; " ^
      "  if ($bin) { " ^
      "    Get-ChildItem -Path $bin.Directory.FullName | Copy-Item -Destination $scrcpyDir -Recurse -Force; " ^
      "    [Console]::WriteLine('[OK] scrcpy 3.3.4 and ADB binaries deployed successfully.'); " ^
      "  } else { " ^
      "    [Console]::WriteLine('[ERROR] scrcpy.exe was not found in downloaded package.'); exit 1; " ^
      "  }; " ^
      "  Remove-Item $extract -Recurse -Force; " ^
      "} catch { " ^
      "  [Console]::WriteLine('[ERROR] Failed to install scrcpy/ADB: ' + $_.Exception.Message); " ^
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
    echo Window will stay open for diagnostics.
    cmd /k
)

if exist "%SCRCPY_DIR%\\scrcpy.exe" (
    echo.
    echo [OK] scrcpy is operational:
    "%SCRCPY_DIR%\\scrcpy.exe" --version
) else (
    echo [!] WARNING: scrcpy.exe was not found. Basic ADB device management will work.
)

REM 6b. Check ADB Server Status (Idempotent: Never kill or reset if already running)
echo.
echo [*] Checking ADB background service...
tasklist /fi "imagename eq adb.exe" 2>nul | find /i "adb.exe" >nul
if %errorLevel% equ 0 (
    echo [OK] Active ADB server process detected. Keeping existing daemon running without reset.
) else (
    echo [*] Starting ADB background service...
    "%SCRCPY_DIR%\\adb.exe" devices >nul 2>&1
    echo [OK] ADB service ready.
)

REM 6c. Check Cloudflare Tunnel (Idempotent: Never kill or reset if already active)
tasklist /fi "imagename eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul
if %errorLevel% equ 0 (
    echo [OK] Active Cloudflare tunnel daemon detected. Keeping existing tunnel running.
)

REM 7. Contact Cloud Controller to Complete Enrollment
echo.
echo [*] Enrolling computer "%COMPUTERNAME%" to ${orgName}...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue'; " ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$body = @{ token = '${token}'; organizationId = '${organizationId}'; computerName = $env:COMPUTERNAME; osVersion = [System.Environment]::OSVersion.VersionString; arch = $env:PROCESSOR_ARCHITECTURE } | ConvertTo-Json; " ^
  "try { " ^
  "  $resp = Invoke-RestMethod -Uri '${backendUrl}/api/enrollment/enroll' -Method POST -Body $body -ContentType 'application/json'; " ^
  "  if ($resp.success) { " ^
  "    Write-Host '[SUCCESS] Enrolled successfully with Cloud Controller!'; " ^
  "    Write-Host ('Agent ID : ' + $resp.agent.id); " ^
  "    $resp | ConvertTo-Json | Out-File -FilePath '%VERTEX_DIR%\\agent_credentials.json' -Encoding utf8; " ^
  "  } else { " ^
  "    Write-Host ('[FAILED] ' + $resp.error); " ^
  "    exit 1; " ^
  "  } " ^
  "} catch { " ^
  "  $errMsg = $_.Exception.Message; " ^
  "  if ($_.Exception.Response) { " ^
  "    try { " ^
  "      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); " ^
  "      $raw = $reader.ReadToEnd(); " ^
  "      if ($raw) { $errMsg = $raw; } " ^
  "    } catch {} " ^
  "  } " ^
  "  Write-Host ('[ERROR] Failed to enroll with controller: ' + $errMsg); " ^
  "  exit 1; " ^
  "}"

if %errorLevel% neq 0 (
    if exist "%VERTEX_DIR%\\agent_credentials.json" (
        echo [!] Using cached credentials from previous successful enrollment.
    ) else (
        echo.
        echo ===============================================================================
        echo [ERROR] Agent enrollment failed. Please verify your internet connection.
        echo Window will stay open for diagnostics.
        echo ===============================================================================
        echo.
        cmd /k
    )
)

REM 8. Deploy & Start Real-time Streaming Agent Runner
echo.
echo [*] Deploying Vertex SaaS Streaming Agent Engine...

REM Deploy agent runner directly to %VERTEX_DIR%
if exist "%~dp0windows-agent\\agent_runner.js" (
    copy /Y "%~dp0windows-agent\\agent_runner.js" "%VERTEX_DIR%\\agent_runner.js" >nul 2>&1
) else if exist "%~dp0agent_runner.js" (
    copy /Y "%~dp0agent_runner.js" "%VERTEX_DIR%\\agent_runner.js" >nul 2>&1
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ProgressPreference = 'SilentlyContinue'; " ^
      "try { " ^
      "  Invoke-WebRequest -Uri '${backendUrl}/api/enrollment/download-runner' -OutFile '%VERTEX_DIR%\\agent_runner.js' -TimeoutSec 15; " ^
      "} catch {}"
)

REM Locate Node.js executable
set "NODE_BIN="
if exist "C:\\Program Files\\nodejs\\node.exe" set "NODE_BIN=C:\\Program Files\\nodejs\\node.exe"
if not defined NODE_BIN if exist "C:\\Program Files (x86)\\nodejs\\node.exe" set "NODE_BIN=C:\\Program Files (x86)\\nodejs\\node.exe"
if not defined NODE_BIN if exist "%LOCALAPPDATA%\\Programs\\node\\node.exe" set "NODE_BIN=%LOCALAPPDATA%\\Programs\\node\\node.exe"
if not defined NODE_BIN (
    for /f "delims=" %%I in ('where node.exe 2^>nul') do (
        if exist "%%~I" set "NODE_BIN=%%~I"
    )
)
if not defined NODE_BIN set "NODE_BIN=node"

"%NODE_BIN%" -v >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ===============================================================================
    echo [!] Node.js runtime not found.
    echo     Please install Node.js from https://nodejs.org
    echo ===============================================================================
    echo.
    echo Window will remain open for diagnostics.
    cmd /k
)

echo.
echo ===============================================================================
echo [SUCCESS] SETUP COMPLETE - STARTING LIVE LOG MONITORING
echo ===============================================================================
echo.
echo Connected phones with USB Debugging enabled will appear on your dashboard:
echo ${dashboardUrl}
echo.
echo [IMPORTANT] DO NOT CLOSE THIS WINDOW.
echo All real-time streaming diagnostics, device syncs, and touch inputs appear below.
echo If any issue occurs, full error details will remain visible here.
echo ===============================================================================
echo.

REM 9. Launch Native Ultra-Low Latency scrcpy Hardware Controller
if exist "%SCRCPY_DIR%\\scrcpy.exe" (
    echo [*] Launching native 60 FPS hardware scrcpy window...
    start "" "%SCRCPY_DIR%\\scrcpy.exe" --stay-awake --window-title "Vertex Cloud Device Farm - Live Control"
)

:run_agent
"%NODE_BIN%" "%VERTEX_DIR%\\agent_runner.js"

echo.
echo ===============================================================================
echo [!] Agent process exited. Window will remain open.
echo Press any key to restart the agent...
echo ===============================================================================
pause
goto run_agent
`;

    return {
      filename,
      content,
      token,
      expiresAt,
    };
  }
}
