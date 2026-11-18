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
  let savedConfig: Record<string, any> = {};

  const possibleConfigPaths = [
    configFilePath,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VertexSaaS', 'Agent', 'config.json') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'VertexSaaS', 'Agent', 'config.json') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'VertexSaaS', 'Agent', 'config.json') : null,
  ].filter(Boolean) as string[];

  for (const p of possibleConfigPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
        const parsed = JSON.parse(raw);
        savedConfig = { ...savedConfig, ...parsed };
      } catch (e) {
        console.warn(`[Config] Failed to parse ${p}:`, e);
      }
    }
  }

  // Also check agent_credentials.json
  const possibleCredPaths = [
    path.resolve(process.cwd(), 'agent_credentials.json'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VertexSaaS', 'Agent', 'agent_credentials.json') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'VertexSaaS', 'Agent', 'agent_credentials.json') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'VertexSaaS', 'Agent', 'agent_credentials.json') : null,
  ].filter(Boolean) as string[];

  for (const p of possibleCredPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
        const creds = JSON.parse(raw);
        if (creds.agent) {
          savedConfig.agentId = creds.agent.id;
          savedConfig.organizationId = creds.agent.organization_id;
        }
        if (creds.agentAuthToken) {
          savedConfig.agentAuthToken = creds.agentAuthToken;
        }
      } catch (e) {
        console.warn(`[Config] Failed to parse credentials at ${p}:`, e);
      }
    }
  }

  // Detect bundled scrcpy and adb
  const possibleAdbPaths = [
    process.env.ADB_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VertexSaaS', 'Agent', 'scrcpy', 'adb.exe') : null,
    path.resolve(__dirname, '../resources/scrcpy-win64-v3.3.4/adb.exe'),
    path.resolve(__dirname, '../../resources/scrcpy-win64-v3.3.4/adb.exe'),
    path.resolve(process.cwd(), 'resources/scrcpy-win64-v3.3.4/adb.exe'),
    'adb.exe',
  ].filter(Boolean) as string[];

  let adbPath = 'adb.exe';
  for (const p of possibleAdbPaths) {
    if (fs.existsSync(p)) {
      adbPath = p;
      break;
    }
  }

  const possibleScrcpyPaths = [
    process.env.SCRCPY_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'VertexSaaS', 'Agent', 'scrcpy', 'scrcpy.exe') : null,
    path.resolve(__dirname, '../resources/scrcpy-win64-v3.3.4/scrcpy.exe'),
    path.resolve(__dirname, '../../resources/scrcpy-win64-v3.3.4/scrcpy.exe'),
    path.resolve(process.cwd(), 'resources/scrcpy-win64-v3.3.4/scrcpy.exe'),
    'scrcpy.exe',
  ].filter(Boolean) as string[];

  let scrcpyPath = 'scrcpy.exe';
  for (const p of possibleScrcpyPaths) {
    if (fs.existsSync(p)) {
      scrcpyPath = p;
      break;
    }
  }

  const scrcpyDir = path.dirname(scrcpyPath);
  const scrcpyServerPath = path.join(scrcpyDir, 'scrcpy-server');

  return {
    backendUrl: savedConfig.backendUrl || process.env.BACKEND_URL || 'https://api-streams.sam.co.ke',
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
