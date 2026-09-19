const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const UNIVERSE_ID = process.env.UNIVERSE_ID;
const TOPIC = "SaweriaDonation";

app.post('/saweria-webhook', async (req, res) => {
    const payload = req.body;

    const donationData = {
        donator_name: payload.donator_name || "Someone",
        amount: payload.etc?.amount_to_display || payload.amount_raw || 0,
        message: payload.message || ""
    };

    try {
        // Publish to Roblox via Open Cloud Messaging Service API
        await axios.post(
            `https://apis.roblox.com/messaging-service/v1/universes/${UNIVERSE_ID}/topics/${TOPIC}`,
            { message: JSON.stringify(donationData) },
            {
                headers: {
                    'x-api-key': ROBLOX_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.status(200).send("OK");
    } catch (error) {
        console.error("Roblox API Error:", error.response?.data || error.message);
        res.status(500).send("Failed to deliver donation to Roblox");
    }
});

app.get('/', (req, res) => res.send("Saweria Roblox Bridge is Active"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));