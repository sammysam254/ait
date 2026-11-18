import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export interface AgentConfig {
  backendUrl: string;
  agentId?: string;
  agentAuthToken?: string;
  organizationId?: string;
  computerName: string;
  agentVersion: string;
  adbPath: string;
  scrcpyPath: string;
  scrcpyServerPath: string;
}

const configFilePath = path.resolve(process.cwd(), 'agent_config.json');

export function loadAgentConfig(): AgentConfig {
  let savedConfig: Partial<AgentConfig> = {};
  if (fs.existsSync(configFilePath)) {
    try {
      savedConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    } catch (e) {
      console.warn('[Config] Failed to parse agent_config.json:', e);
    }
  }

  // Detect bundled scrcpy and adb
  const baseResourceDir = path.resolve(__dirname, '../resources/scrcpy-win64-v3.3.4');
  const adbPath = process.env.ADB_PATH || path.join(baseResourceDir, 'adb.exe');
  const scrcpyPath = process.env.SCRCPY_PATH || path.join(baseResourceDir, 'scrcpy.exe');
  const scrcpyServerPath = path.join(baseResourceDir, 'scrcpy-server');

  return {
    backendUrl: savedConfig.backendUrl || process.env.BACKEND_URL || 'http://localhost:4000',
    agentId: savedConfig.agentId || process.env.AGENT_ID,
    agentAuthToken: savedConfig.agentAuthToken || process.env.AGENT_AUTH_TOKEN,
    organizationId: savedConfig.organizationId || process.env.ORGANIZATION_ID,
    computerName: savedConfig.computerName || process.env.COMPUTERNAME || 'Windows-Host',
    agentVersion: '1.0.0',
    adbPath,
    scrcpyPath,
    scrcpyServerPath,
  };
}

export function saveAgentConfig(updates: Partial<AgentConfig>): void {
  const current = loadAgentConfig();
  const merged = { ...current, ...updates };
  fs.writeFileSync(configFilePath, JSON.stringify(merged, null, 2), 'utf8');
}
