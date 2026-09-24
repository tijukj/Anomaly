// scripts/doctor.js - Plain-English ANOMALY Connectivity Health Check
import os from 'os';
import net from 'net';
import { execSync } from 'child_process';
import { CONFIG } from '../server/config.js';

const PORT = CONFIG.PORT || 3000;
const RULE_NAME = `ANOMALY Game ${PORT}`;

console.log('\n' + '='.repeat(62));
console.log('  🩺 ANOMALY CONNECTION & NETWORK HEALTH CHECK');
console.log('='.repeat(62) + '\n');

// -------------------------------------------------------------
// 1. LAN IPv4 Interfaces & Virtual Adapter Detection
// -------------------------------------------------------------
console.log('📡 [1/5] DETECTED NETWORK INTERFACES:');
console.log('-'.repeat(62));

const interfaces = os.networkInterfaces();
const ipv4List = [];

for (const [name, nets] of Object.entries(interfaces)) {
  for (const netInfo of nets) {
    if (netInfo.family === 'IPv4' && !netInfo.internal) {
      const isVirtual = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|Tailscale|ZeroTier|TAP|VPN|Loopback/i.test(name);
      const isWifi = /wi-?fi|wlan|wireless/i.test(name);
      const isEthernet = /eth|ethernet|en[0-9]/i.test(name);

      ipv4List.push({
        name,
        address: netInfo.address,
        netmask: netInfo.netmask,
        isVirtual,
        isWifi,
        isEthernet
      });
    }
  }
}

if (ipv4List.length === 0) {
  console.log('  ❌ No LAN IPv4 network interfaces found! Please connect to Wi-Fi.');
} else {
  ipv4List.forEach((iface, idx) => {
    let tag = '';
    if (iface.isVirtual) {
      tag = '⚠️  [VIRTUAL / VPN ADAPTER - Do NOT use for phones]';
    } else if (iface.isWifi) {
      tag = '⭐ [RECOMMENDED WI-FI ADAPTER]';
    } else if (iface.isEthernet) {
      tag = '🔌 [ETHERNET / LAN]';
    }

    console.log(`  ${idx + 1}. Interface: "${iface.name}"`);
    console.log(`     IP Address: http://${iface.address}:${PORT}/play`);
    if (tag) console.log(`     Type      : ${tag}`);
    console.log('');
  });
}

// -------------------------------------------------------------
// 2. Port Availability Check
// -------------------------------------------------------------
console.log('🔌 [2/5] SERVER PORT STATUS (Port ' + PORT + '):');
console.log('-'.repeat(62));

async function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve('in-use');
      } else {
        resolve('error: ' + err.code);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve('free');
    });
    server.listen(port, '0.0.0.0');
  });
}

const portStatus = await checkPort(PORT);
if (portStatus === 'in-use') {
  console.log(`  ℹ️  Port ${PORT} is currently IN USE.`);
  console.log(`     (If your ANOMALY server is already running in another window, this is normal!)`);
} else if (portStatus === 'free') {
  console.log(`  ✅ Port ${PORT} is FREE and ready for the game server.`);
} else {
  console.log(`  ⚠️  Port ${PORT} status: ${portStatus}`);
}
console.log('');

// -------------------------------------------------------------
// 3. Windows Defender Firewall Rule Check
// -------------------------------------------------------------
console.log('🛡️  [3/5] WINDOWS DEFENDER FIREWALL STATUS:');
console.log('-'.repeat(62));

let firewallRuleFound = false;
try {
  const fwOutput = execSync(
    `powershell -NoProfile -Command "Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue | Select-Object -Property DisplayName, Enabled, Direction, Action | ConvertTo-Json"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
  ).trim();

  if (fwOutput) {
    const ruleObj = JSON.parse(fwOutput);
    const isEnabled = ruleObj.Enabled === 1 || ruleObj.Enabled === true || ruleObj.Enabled === 'True';
    if (isEnabled) {
      firewallRuleFound = true;
      console.log(`  ✅ Rule "${RULE_NAME}" is ACTIVE and allowing incoming connections.`);
    } else {
      console.log(`  ⚠️  Rule "${RULE_NAME}" exists but is currently DISABLED.`);
    }
  }
} catch (e) {
  // Not found or error
}

if (!firewallRuleFound) {
  console.log(`  ❌ Inbound firewall rule "${RULE_NAME}" NOT FOUND.`);
  console.log(`     Windows Defender may block incoming phone traffic on port ${PORT}.`);
  console.log(`     👉 FIX: Open PowerShell as Administrator and run: npm run firewall`);
}
console.log('');

// -------------------------------------------------------------
// 4. Windows Network Connection Profile (Private vs Public)
// -------------------------------------------------------------
console.log('📶 [4/5] WI-FI NETWORK PROFILE TYPE:');
console.log('-'.repeat(62));

try {
  const profileOutput = execSync(
    `powershell -NoProfile -Command "Get-NetConnectionProfile | Select-Object -Property InterfaceAlias, NetworkCategory | ConvertTo-Json"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
  ).trim();

  if (profileOutput) {
    let profiles = JSON.parse(profileOutput);
    if (!Array.isArray(profiles)) profiles = [profiles];

    profiles.forEach((prof) => {
      const category = prof.NetworkCategory === 1 ? 'Private' : (prof.NetworkCategory === 0 ? 'Public' : 'DomainAuthenticated');
      console.log(`  • Network Interface "${prof.InterfaceAlias}": Profile = [${category}]`);
      if (category === 'Public') {
        console.log(`    ℹ️  Public profiles enable stricter Windows security.`);
        console.log(`       If phones cannot connect, running 'npm run firewall' ensures Public profiles are also allowed.`);
      } else {
        console.log(`    ✅ Private network mode allows seamless local device discovery.`);
      }
    });
  }
} catch (e) {
  console.log('  ℹ️  Could not query Windows Network Profile (Requires standard permissions).');
}
console.log('');

// -------------------------------------------------------------
// 5. Manual Connectivity Checklist
// -------------------------------------------------------------
console.log('📋 [5/5] MANUAL CONNECTION CHECKLIST:');
console.log('-'.repeat(62));
console.log('  [ ] 1. Phone & Laptop must be on the EXACT SAME Wi-Fi network.');
console.log('  [ ] 2. Turn Phone Cellular/Mobile Data OFF (prevents phones routing LAN requests over 4G/5G).');
console.log('  [ ] 3. Turn VPN OFF on both phone and laptop (VPNs create virtual subnets).');
console.log('  [ ] 4. Test reaching http://<YOUR-IP>:' + PORT + '/ping from your phone browser.');
console.log('  [ ] 5. CAMPUS / OFFICE WI-FI NOTE:');
console.log('         Some college, hotel, or office networks block device-to-device traffic (AP Isolation).');
console.log('         👉 SOLUTION: Enable your Phone\'s Mobile Hotspot, connect your laptop to it, and play!\n');

console.log('='.repeat(62) + '\n');
