import { loadAgentConfig, saveAgentConfig } from './config';
import { AdbManager, DiscoveredDevice } from './adb/adbManager';
import { ScrcpyManager } from './scrcpy/scrcpyManager';
import { StreamBridge } from './streaming/streamBridge';
import { CloudflareTunnelManager } from './cloudflare/tunnelManager';

async function main() {
  console.log('=======================================================');
  console.log('📱 Vertex SaaS Windows Host Agent & scrcpy 3.3.4 Bridge');
  console.log('=======================================================');

  const config = loadAgentConfig();
  console.log(`[Agent] Host: ${config.computerName}`);
  console.log(`[Agent] Backend URL: ${config.backendUrl}`);
  console.log(`[Agent] ADB Path: ${config.adbPath}`);
  console.log(`[Agent] scrcpy Path: ${config.scrcpyPath}`);

  const adbManager = new AdbManager(config.adbPath);
  const scrcpyManager = new ScrcpyManager(config.scrcpyPath, config.scrcpyServerPath);
  const tunnelManager = new CloudflareTunnelManager();

  // Check ADB
  if (!adbManager.isAdbAvailable()) {
    console.warn('[Agent] WARNING: adb.exe not found at specified path. Please check scrcpy distribution directory.');
  } else {
    console.log('[Agent] ADB is verified and available.');
  }

  // Check scrcpy
  if (!scrcpyManager.isScrcpyAvailable()) {
    console.warn('[Agent] WARNING: scrcpy.exe not found at specified path.');
  } else {
    console.log('[Agent] scrcpy 3.3.4 is verified and ready.');
  }

  // Verify enrollment credentials
  if (!config.agentId || !config.agentAuthToken || !config.organizationId) {
    console.log('\n[Agent] This host is not yet enrolled.');
    console.log('[Agent] Please run your personalized setup.bat from your Vertex dashboard,');
    console.log('[Agent] or configure AGENT_ID, AGENT_AUTH_TOKEN and ORGANIZATION_ID.\n');
  } else {
    console.log(`[Agent] Enrolled Agent ID: ${config.agentId}`);
    console.log(`[Agent] Organization ID: ${config.organizationId}`);

    // Initialize Streaming Bridge
    const wsUrl = config.backendUrl.replace(/^http/, 'ws');
    const streamBridge = new StreamBridge({
      backendWsUrl: wsUrl,
      agentAuthToken: config.agentAuthToken,
      adbManager,
      scrcpyManager,
    });

    streamBridge.connect();

    // 1. Device Discovery & Sync Loop
    let knownSerials = new Set<string>();
    setInterval(async () => {
      try {
        const devices = await adbManager.getConnectedDevices();
        const currentSerials = new Set(devices.map(d => d.adbSerial));

        // Check for new devices
        for (const dev of devices) {
          if (!knownSerials.has(dev.adbSerial)) {
            console.log(`[Agent] New Android device detected: ${dev.deviceName} (${dev.adbSerial}) [${dev.connectionType}]`);
          }
        }

        // Check for disconnected devices
        for (const serial of knownSerials) {
          if (!currentSerials.has(serial)) {
            console.log(`[Agent] Android device disconnected: ${serial}`);
          }
        }

        knownSerials = currentSerials;

        // Sync with Cloud Backend API
        const resp = await fetch(`${config.backendUrl}/api/devices/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: config.agentId,
            organizationId: config.organizationId,
            devices,
          }),
        });

        if (resp.ok) {
          const data: any = await resp.json();
          // Register device producers on stream bridge
          if (Array.isArray(data.devices)) {
            for (const d of data.devices) {
              streamBridge.registerDeviceProducer(d.id);
            }
          }
        } else if (resp.status === 403) {
          console.error('[Agent] Agent has been revoked by customer or admin. Terminating operations.');
          process.exit(1);
        }
      } catch (err: any) {
        // Network or ADB temporary drop; keep looping
        // console.warn('[Agent] Sync failed (retrying):', err.message);
      }
    }, 3000);

    // 2. Periodic Heartbeat Loop
    setInterval(async () => {
      try {
        const resp = await fetch(`${config.backendUrl}/api/agents/${config.agentId}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (resp.status === 403) {
          console.error('[Agent] Agent was revoked. Stopping agent process.');
          process.exit(1);
        }
      } catch (err) {
        // Network temporary interruption
      }
    }, 10000);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Agent] Shutting down cleanly...');
    scrcpyManager.stopAll();
    tunnelManager.stopTunnel();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Agent Fatal Error]', err);
});
