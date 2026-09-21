import express from 'express';

const app = express();
app.use(express.json());
// Support classic form posts too (in case JS is disabled)
app.use(express.urlencoded({ extended: true }));

const TAG = '[Saweria Bridge]';
const TOPIC = "SaweriaDonation";

// ---------------------------------------------------------------------------
// Defensive Saweria field extraction
//
// Saweria may send the donation FLAT (top-level fields) or WRAPPED under a
// `data` object, and the amount can live under several names. Read from every
// known location so a reshaping of their payload never silently zeroes us out.
// ---------------------------------------------------------------------------
function pickDonation(payload) {
    const data = payload?.data ?? {};
    const etc = payload?.etc ?? data.etc ?? {};

    const donator_name =
        payload.donator_name ??
        data.donator_name ??
        payload.user?.name ??
        data.user?.name ??
        "Someone";

    const amount =
        etc.amount_to_display ??
        payload.amount_raw ??
        payload.amount ??
        data.amount ??
        data.amount_raw ??
        data.amount_to_display ??
        0;

    const message = payload.message ?? data.message ?? "";

    return { donator_name, amount, message };
}

// ---------------------------------------------------------------------------
// Shared forwarder — used by BOTH the Saweria webhook and the test form.
// Double-stringify is intentional: Open Cloud wants { "message": "<string>" },
// and DonationHandler.luau does the matching single JSONDecode on message.Data.
// ---------------------------------------------------------------------------
async function forwardToRoblox(donationData, res) {
    const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
    const UNIVERSE_ID = process.env.UNIVERSE_ID;

    if (!ROBLOX_API_KEY || !UNIVERSE_ID) {
        console.error(`${TAG} Missing env vars`, {
            hasApiKey: !!ROBLOX_API_KEY,
            hasUniverseId: !!UNIVERSE_ID,
        });
        return res.status(500).json({
            error: "Missing Environment Variables",
            hasApiKey: !!ROBLOX_API_KEY,
            hasUniverseId: !!UNIVERSE_ID,
        });
    }

    try {
        const response = await fetch(
            `https://apis.roblox.com/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${TOPIC}`,
            {
                method: 'POST',
                headers: {
                    'x-api-key': ROBLOX_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: JSON.stringify(donationData) })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${TAG} Roblox API error`, {
                status: response.status,
                statusText: response.statusText,
                body: errorText,
            });
            return res.status(502).json({
                error: "Roblox API Error",
                status: response.status,
                details: errorText,
            });
        }

        console.log(`${TAG} Forwarded to Roblox OK:`, JSON.stringify(donationData));
        return res.status(200).json({
            success: true,
            message: "Donation forwarded to Roblox",
            data: donationData,
        });
    } catch (error) {
        console.error(`${TAG} Exception:`, error);
        return res.status(500).json({ error: "Internal Server Error", details: String(error) });
    }
}

// ---------------------------------------------------------------------------
// Webhook receiver (Saweria). /webhook is the primary path; root POST kept as
// an alias so an already-registered Saweria webhook URL keeps working.
// ---------------------------------------------------------------------------
async function handleWebhook(req, res) {
    const payload = req.body || {};
    console.log(`${TAG} Raw payload:`, JSON.stringify(payload));
    const donationData = pickDonation(payload);
    console.log(`${TAG} Extracted donation:`, JSON.stringify(donationData));
    return forwardToRoblox(donationData, res);
}

app.post('/webhook', handleWebhook);
app.post('/', handleWebhook);

// ---------------------------------------------------------------------------
// Test sender — used by the form on GET /
// Accepts { name, amount, message, token? } and forwards the same shape as a
// real Saweria donation, so the Roblox side can't tell the difference.
//
// Optional protection: set TEST_TOKEN in Vercel env vars and the form must
// provide the same value, otherwise anyone who finds the URL can spam your
// game with fake donations.
// ---------------------------------------------------------------------------
app.post('/test', async (req, res) => {
    const body = req.body || {};

    const testToken = process.env.TEST_TOKEN;
    if (testToken) {
        const provided = body.token || req.get('x-test-token');
        if (provided !== testToken) {
            return res.status(401).json({ error: "Invalid or missing test token" });
        }
    }

    const donationData = {
        donator_name: String(body.name || body.donator_name || "TestDonor").slice(0, 40) || "TestDonor",
        amount: Math.max(0, Math.floor(Number(body.amount) || 0)),
        message: String(body.message ?? "").slice(0, 200),
    };

    console.log(`${TAG} Test send:`, JSON.stringify(donationData));
    return forwardToRoblox(donationData, res);
});

// ---------------------------------------------------------------------------
// Landing page: deployment status + test notification form
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const hasApiKey = !!process.env.ROBLOX_API_KEY;
    const hasUniverseId = !!process.env.UNIVERSE_ID;
    const needsToken = !!process.env.TEST_TOKEN;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Saweria &rarr; Roblox Bridge</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 16px; min-height: 100vh;
    background: #0b0d12; color: #e8e4ea;
    font-family: "Segoe UI", system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  .wrap { width: 100%; max-width: 460px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #f0eaee; }
  .sub { color: #8a7f8f; font-size: 13px; margin-bottom: 18px; }
  .status {
    background: #131019; border: 1px solid #2a1620; border-radius: 10px;
    padding: 12px 14px; font-size: 13px; margin-bottom: 22px; line-height: 1.7;
  }
  .ok { color: #63ff9a; } .bad { color: #ff5c6e; }
  label { display: block; font-size: 12px; letter-spacing: 0.4px;
    text-transform: uppercase; color: #a08fa0; margin: 14px 0 6px; }
  input, textarea {
    width: 100%; padding: 10px 12px; background: #17141d;
    border: 1px solid #3a2030; border-radius: 8px;
    color: #f0eaee; font-size: 15px; font-family: inherit;
  }
  textarea { min-height: 70px; resize: vertical; }
  input:focus, textarea:focus { outline: none; border-color: #be1826; }
  button {
    width: 100%; margin-top: 20px; padding: 12px;
    background: #8a0c18; color: #fff; font-size: 16px; font-weight: 700;
    border: none; border-radius: 8px; cursor: pointer;
  }
  button:hover { background: #a51020; }
  button:disabled { opacity: 0.5; cursor: wait; }
  #result {
    display: none; margin-top: 18px; padding: 12px 14px;
    border-radius: 8px; font-size: 13px; white-space: pre-wrap;
    word-break: break-word; font-family: Consolas, monospace;
  }
  #result.ok { display: block; background: #0f1f14; border: 1px solid #1d5c34; color: #63ff9a; }
  #result.err { display: block; background: #241014; border: 1px solid #6e1d28; color: #ff8c98; }
  .hint { font-size: 11px; color: #6e5f6e; margin-top: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>&#128736;&#65039; Saweria &rarr; Roblox Bridge</h1>
  <div class="sub">Webhook forwarder + manual test sender</div>

  <div class="status">
    ROBLOX_API_KEY: <span class="${hasApiKey ? 'ok' : 'bad'}">${hasApiKey ? 'set &#10003;' : 'MISSING'}</span><br>
    UNIVERSE_ID: <span class="${hasUniverseId ? 'ok' : 'bad'}">${hasUniverseId ? 'set &#10003;' : 'MISSING'}</span><br>
    TEST_TOKEN: <span class="${needsToken ? 'ok' : ''}">${needsToken ? 'required' : 'not set (open to anyone)'}</span>
  </div>

  <form id="f">
    <label for="name">Donator name</label>
    <input id="name" maxlength="40" placeholder="Someguy" value="TestDonor">

    <label for="amount">Amount (raw IDR)</label>
    <input id="amount" type="number" min="0" step="1" placeholder="150000" value="150000">
    <div class="hint">Raw number &mdash; 150000 shows as 150,000K in game, and triggers the Blood Moon (threshold 100000).</div>

    <label for="message">Message</label>
    <textarea id="message" maxlength="200" placeholder="Awaken the blood moon!">The night accepts your offering.</textarea>

    ${needsToken ? `
    <label for="token">Test token</label>
    <input id="token" placeholder="TEST_TOKEN value">` : ''}

    <button id="btn" type="submit">Send test donation</button>
  </form>

  <div id="result"></div>
</div>

<script>
  var form = document.getElementById('f');
  var btn = document.getElementById('btn');
  var result = document.getElementById('result');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true;
    result.className = '';
    result.style.display = 'none';

    var body = {
      name: document.getElementById('name').value,
      amount: Number(document.getElementById('amount').value) || 0,
      message: document.getElementById('message').value
    };
    var tokenField = document.getElementById('token');
    if (tokenField) body.token = tokenField.value;

    fetch('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (r) {
        if (r.status === 200) {
          result.className = 'ok';
          result.textContent = 'Forwarded to Roblox!\\n\\n' + JSON.stringify(r.json.data, null, 2);
        } else {
          result.className = 'err';
          result.textContent = 'Failed (HTTP ' + r.status + ')\\n\\n' + JSON.stringify(r.json, null, 2);
        }
      })
      .catch(function (err) {
        result.className = 'err';
        result.textContent = 'Request error: ' + err;
      })
      .finally(function () { btn.disabled = false; });
  });
</script>
</body>
</html>`;
    res.send(html);
});

// ---------------------------------------------------------------------------
// Fallback GET — anything else gets a 404-style notice (the form lives at /)
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
    res.status(404).send('Nothing here. The test form lives at /.');
});

export default app;
