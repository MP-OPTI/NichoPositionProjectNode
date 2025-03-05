const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const net = require('net');

const app = express();
app.use(cors());
app.use(express.json());

// Device configuration for the LC device
const DEVICE_IP = "192.168.0.20";
const DEVICE_PORT = 8050;

/**
 * Function to calculate checksum (XOR of all bytes in data)
 * Excludes STX (0x02) and ETX (0x03)
 */
function calculateChecksum(data) {
    return data.reduce((acc, byte) => acc ^ byte, 0);
}

/**
 * Function to send a command to the LC device.
 * The command will be wrapped with STX, ETX, and a checksum.
 * @param {string} command - The command to send
 * @returns {Promise<string>} - The response from the device
 */
function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        // Convert the command to a byte buffer
        const commandBuffer = Buffer.from(command, "utf-8");
        // Construct the full message with STX, command, ETX, and checksum
        const fullMessage = Buffer.concat([
            Buffer.from([0x02, 0x05]), // STX
            commandBuffer,           // Command
            Buffer.from([0x03]),      // ETX
            Buffer.from([calculateChecksum(commandBuffer)]) // Checksum
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

// Retry configuration for fetching modbus data
const RETRY_DELAY = 5000;    // 5 seconds
let isConnected = false;

// Add this variable to track the last matched string
let lastMatchedString = null;

/**
 * Fetches data from modbus and dimter endpoints.
 * It then checks for a match and sends a print command to the LC device.
 */
async function fetchData() {
    try {
        // Fetch modbus data
        const stringResponse = await fetch('http://localhost:5000/modbus-plc1');
        const stringData = await stringResponse.json();
        const modbusString = stringData.combinedString;

        // Fetch modbus status (if needed)
        const statusResponse = await fetch('http://localhost:5000/modbus-plc1/status');
        const statusData = await statusResponse.json();

        // Fetch dimter numbers
        const dimterResponse = await fetch('http://localhost:3001/api/dimter-numbers');
        const dimterData = await dimterResponse.json();
        if (dimterData.entries) {            
            // Check for match between modbus string and dimter numbers
            const hasMatch = dimterData.entries.some(entry => entry.id === modbusString);
            
            // Only send print command if we have a new match
            if (hasMatch && modbusString !== lastMatchedString) {
                lastMatchedString = modbusString; // Update the last matched string
                
                try {
                    // Find the matching entry to get its value
                    const matchingEntry = dimterData.entries.find(entry => entry.id === modbusString);
                    if (matchingEntry) {
                        // Send print command with the matched value instead of ID
                        const printResponse = await sendCommand(`seta:data#v1=${matchingEntry.value}`);
                        console.log('Successfully sent print command:', {
                            modbusString,
                            value: matchingEntry.value,
                            response: printResponse
                        });
                    }
                } catch (err) {
                    console.error('Error sending print command:', err.message);
                }
            } else if (!hasMatch) {
                lastMatchedString = null; // Reset last matched string when no match is found
            }
        }

        // Success - reset to normal polling interval if previously disconnected
        if (!isConnected) {
            isConnected = true;
            clearInterval(fetchInterval);
            fetchInterval = setInterval(fetchData, 250);
        }

    } catch (error) {
        isConnected = false;
        console.error('Error fetching data:', error.message);
        
        // Clear the existing interval and set a new one with retry delay
        clearInterval(fetchInterval);
        fetchInterval = setInterval(fetchData, RETRY_DELAY);
    }
}

// Store interval reference so we can clear it if needed
let fetchInterval = setInterval(fetchData, 250);

const PORT = 3002;
app.listen(PORT, () => {
    console.log(`Laser Server running on port ${PORT}`);
    fetchData(); // Initial fetch
});
