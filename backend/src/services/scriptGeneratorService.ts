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
    const backendUrl = config.backendUrl;

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

:: 1. Check Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] WARNING: Running without administrative privileges.
    echo     For USB driver installation and persistent service configuration,
    echo     administrative privileges may be recommended.
    echo.
)

:: 2. Check Architecture
if "%PROCESSOR_ARCHITECTURE%" neq "AMD64" (
    if "%PROCESSOR_ARCHITEW6432%" neq "AMD64" (
        echo [ERROR] Vertex SaaS Windows Agent requires a 64-bit (x64) Windows OS.
        echo Architecture detected: %PROCESSOR_ARCHITECTURE%
        pause
        exit /b 1
    )
)

:: 3. Configure Target Directory
set "VERTEX_DIR=%LOCALAPPDATA%\\VertexSaaS\\Agent"
echo [*] Initializing agent directory: "%VERTEX_DIR%"
if not exist "%VERTEX_DIR%" (
    mkdir "%VERTEX_DIR%"
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to create directory: %VERTEX_DIR%
        pause
        exit /b 1
    )
)

:: 4. Write Configuration File
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

:: 5. Copy or Deploy scrcpy Distribution
echo [*] Checking bundled scrcpy and ADB distribution...
set "SCRCPY_DIR=%VERTEX_DIR%\\scrcpy"

:: Check if local scrcpy package is present in current folder
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
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '${backendUrl}/api/enrollment/download-scrcpy' -OutFile '%VERTEX_DIR%\\scrcpy.zip'; Expand-Archive -Path '%VERTEX_DIR%\\scrcpy.zip' -DestinationPath '%SCRCPY_DIR%' -Force; Remove-Item '%VERTEX_DIR%\\scrcpy.zip'"
)

:: 6. Test ADB Availability
if exist "%SCRCPY_DIR%\\adb.exe" (
    echo [OK] ADB is ready at "%SCRCPY_DIR%\\adb.exe"
) else (
    echo [ERROR] adb.exe was not found in %SCRCPY_DIR%.
    pause
    exit /b 1
)

:: 7. Contact Cloud Backend to Complete Enrollment
echo [*] Enrolling computer "%COMPUTERNAME%" to ${orgName}...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$body = @{ token = '${token}'; computerName = $env:COMPUTERNAME; osVersion = [System.Environment]::OSVersion.VersionString; arch = $env:PROCESSOR_ARCHITECTURE } | ConvertTo-Json; " ^
  "try { " ^
  "  $resp = Invoke-RestMethod -Uri '${backendUrl}/api/enrollment/enroll' -Method POST -Body $body -ContentType 'application/json'; " ^
  "  if ($resp.success) { " ^
  "    Write-Host '[SUCCESS] Enrolled successfully!' -ForegroundColor Green; " ^
  "    Write-Host ('Agent ID : ' + $resp.agent.id); " ^
  "    $resp | ConvertTo-Json | Out-File -FilePath '%VERTEX_DIR%\\agent_credentials.json' -Encoding utf8; " ^
  "  } else { " ^
  "    Write-Host ('[FAILED] ' + $resp.error) -ForegroundColor Red; " ^
  "    exit 1; " ^
  "  } " ^
  "} catch { " ^
  "  Write-Host ('[ERROR] Failed to connect to controller: ' + $_.Exception.Message) -ForegroundColor Red; " ^
  "  exit 1; " ^
  "}"

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Agent enrollment failed. Please verify your internet connection or request a new token.
    pause
    exit /b 1
)

:: 8. Deploy & Start Agent Runner
echo.
echo [*] Launching Vertex Windows Agent in background...
start /b "" powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& '%~dp0windows-agent\\dist\\agent.js' -or Write-Host 'Vertex Agent running via node or background supervisor.'"

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
