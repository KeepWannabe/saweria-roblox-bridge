import express from 'express';

const app = express();
app.use(express.json());

app.post('*', async (req, res) => {
    const payload = req.body || {};

    const donationData = {
        donator_name: payload.donator_name || "Someone",
        amount: payload.etc?.amount_to_display || payload.amount_raw || 0,
        message: payload.message || ""
    };

    const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
    const UNIVERSE_ID = process.env.UNIVERSE_ID;
    const TOPIC = "SaweriaDonation";

    if (!ROBLOX_API_KEY || !UNIVERSE_ID) {
        return res.status(500).json({ error: "Missing Environment Variables" });
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
            return res.status(500).json({ error: "Roblox API Error", details: errorText });
        }

        return res.status(200).json({ success: true, message: "Donation forwarded to Roblox" });
    } catch (error) {
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// Fallback GET route to verify deployment
app.get('*', (req, res) => {
    res.send("Saweria Roblox Bridge is Live!");
});

export default app;
