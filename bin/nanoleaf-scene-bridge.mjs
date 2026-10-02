#!/usr/bin/env node
// Command line helper: pair with a Nanoleaf device and list its scenes.
//
//   nanoleaf-scene-bridge pair <host>           waits up to 60 s for pairing mode, prints the token
//   nanoleaf-scene-bridge info <host> <token>   prints the device info and its scenes

const PORT = 16021;

const [command, host, token] = process.argv.slice(2);

function baseUrl(h) {
  const hostPart = h.includes(':') && !h.startsWith('[') ? `[${h}]` : h;
  return `http://${hostPart}:${PORT}/api/v1`;
}

async function pair() {
  console.log('Hold the power button on the Nanoleaf for 5-7 seconds until the light flashes...');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl(host)}/new`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const { auth_token: authToken } = await res.json();
        console.log(`Paired. Token: ${authToken}`);
        return;
      }
    } catch (err) {
      console.error(`Request failed: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.error('Timed out waiting for pairing mode.');
  process.exitCode = 1;
}

async function info() {
  const res = await fetch(`${baseUrl(host)}/${token}/`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  console.log(`${data.name} - ${data.model}, serial ${data.serialNo}, firmware ${data.firmwareVersion}`);
  console.log(`Power: ${data.state.on.value ? 'on' : 'off'}, active scene: ${data.effects.select}`);
  console.log('Scenes:');
  for (const effect of data.effects.effectsList) {
    console.log(`  - ${effect}`);
  }
}

if (command === 'pair' && host) {
  await pair();
} else if (command === 'info' && host && token) {
  await info();
} else {
  console.log('Usage:\n  nanoleaf-scene-bridge pair <host>\n  nanoleaf-scene-bridge info <host> <token>');
  process.exitCode = 1;
}
