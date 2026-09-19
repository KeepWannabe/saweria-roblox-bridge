import express from 'express';

const app = express();
app.use(express.json());

const TAG = '[Saweria Bridge]';

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
// Webhook receiver
// ---------------------------------------------------------------------------
app.post('*', async (req, res) => {
    const payload = req.body || {};

    // Log the RAW body so Vercel logs show exactly what Saweria sent.
    // Use this to confirm the real payload shape if fields ever look wrong.
    console.log(`${TAG} Raw payload:`, JSON.stringify(payload));

    const donationData = pickDonation(payload);
    console.log(`${TAG} Extracted donation:`, JSON.stringify(donationData));

    const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
    const UNIVERSE_ID = process.env.UNIVERSE_ID;
    const TOPIC = "SaweriaDonation";

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
                // Double-stringify is intentional: Open Cloud wants
                // { "message": "<string>" }, and DonationHandler.luau
                // does the matching single JSONDecode on message.Data.
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

        console.log(`${TAG} Forwarded to Roblox OK`);
        return res.status(200).json({
            success: true,
            message: "Donation forwarded to Roblox",
            data: donationData,
        });
    } catch (error) {
        console.error(`${TAG} Exception:`, error);
        return res.status(500).json({ error: "Internal Server Error", details: String(error) });
    }
});

// ---------------------------------------------------------------------------
// Fallback GET route — verifies the deployment and that env vars are present
// (booleans only — never leaks the key itself).
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
    const hasApiKey = !!process.env.ROBLOX_API_KEY;
    const hasUniverseId = !!process.env.UNIVERSE_ID;
    res.send(
        `Saweria Roblox Bridge is Live!<br>` +
        `ROBLOX_API_KEY set: ${hasApiKey}<br>` +
        `UNIVERSE_ID set: ${hasUniverseId}`
    );
});

export default app;
