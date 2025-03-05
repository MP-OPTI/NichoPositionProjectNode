const net = require("net");
const express = require("express");
const cors = require("express");

const DEVICE_IP = "192.168.0.20";
const DEVICE_PORT = 8050;

const app = express();
app.use(cors({
  origin: 'http://localhost:5173' // Replace with your React app's URL
}));
app.use(express.json());

/**
 * Function to calculate checksum (XOR of all bytes in data)
 * Excludes STX (0x02) and ETX (0x03)
 */
function calculateChecksum(data) {
    return data.reduce((acc, byte) => acc ^ byte, 0);
}

/**
 * Function to send a command to the LC device
 * @param {string} command - The command to send
 * @returns {Promise<string>} - The response from the device
 */
function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();

        // Convert the command to a byte buffer
        const commandBuffer = Buffer.from(command, "utf-8");

        // Create message without checksum first
        const messageWithoutChecksum = Buffer.concat([
            Buffer.from([0x02, 0x05]), // STX
            commandBuffer,              // Command
            Buffer.from([0x03])        // ETX
        ]);

        // Calculate checksum on all bytes except STX and ETX
        const checksumData = messageWithoutChecksum.slice(2, -1); // Skip first 2 bytes (STX) and last byte (ETX)
        const checksum = calculateChecksum(checksumData);

        // Construct the full message
        const fullMessage = Buffer.concat([
            messageWithoutChecksum,
            Buffer.from([checksum])
        ]);

        client.connect(DEVICE_PORT, DEVICE_IP, () => {
            console.log(`Connected to LC device at ${DEVICE_IP}:${DEVICE_PORT}`);
            client.write(fullMessage);
        });

        client.on("data", (data) => {
            console.log("Received:", data.toString());
            client.destroy();
            resolve(data.toString());
        });

        client.on("error", (err) => {
            reject(err);
        });

        client.on("close", () => {
            console.log("Connection closed");
        });
    });
}

// REST API Endpoints

app.post("/load", async (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: "Filename is required" });

    try {
        const response = await sendCommand(`load:${filename} ETX`);
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/start", async (req, res) => {
    try {
        const response = await sendCommand("start: ETX");
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/stop", async (req, res) => {
    try {
        const response = await sendCommand("stop: ETX");
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/status", async (req, res) => {
    try {
        const response = await sendCommand("sys_sta: ETX");
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// New endpoint to send a print command with data matching
app.post("/print", async (req, res) => {
    const { variable, plcString } = req.body;
    if (!variable || !plcString) {
        return res.status(400).json({ error: "Both 'variable' and 'plcString' fields are required." });
    }
    
    try {
        // Fetch Dimter Numbers from impserver
        const dimterResponse = await fetch('http://localhost:3001/api/dimter-numbers');
        const dimterData = await dimterResponse.json();
        
        // Find matching entry
        let textValue = "0"; // Default value if no match found
        if (dimterData.entries) {
            const matchingEntry = dimterData.entries.find(entry => 
                entry.id.trim() === plcString.trim()
            );
            if (matchingEntry) {
                textValue = matchingEntry.value;
            }
        }
        
        // Construct the print command with the matched value
        const command = `seta:data#${variable}=${textValue}`;
        
        const response = await sendCommand(command);
        res.json({ success: true, response, matchedValue: textValue });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
