const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const net = require('net');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to modbus server websocket
const socket = io('http://localhost:5000');

// Device configuration for the LC device
const DEVICE_IP = "192.168.0.20";
const DEVICE_PORT = 8050;

// Add logging utility functions
function getLogFileName() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    return path.join(__dirname, 'LOGS/LASERSERVER', `laser_${date}.log`);
}

function ensureLogDirectory() {
    const logDir = path.join(__dirname, 'LOGS/LASERSERVER');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}

function writeToLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${message}\n`;
    const logFile = getLogFileName();
    
    fs.appendFile(logFile, logEntry, (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        }
    });
}

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

// Add this variable to track the last matched string
let lastMatchedString = null;

// Add variable to store latest dimter data
let latestDimterData = null;

// Add dimter data websocket listener
const dimterSocket = io('http://localhost:3001');

dimterSocket.on('dimterData', (data) => {
    latestDimterData = data;
    writeToLog(JSON.stringify({
        event: 'dimterDataReceived',
        data: data,
        timestamp: new Date().toISOString()
    }));
});

dimterSocket.on('dimterError', (error) => {
    console.error('Dimter data error:', error);
});

// Handle connection errors for dimter socket
dimterSocket.on('connect_error', (error) => {
    console.error('Dimter WebSocket connection error:', error.message);
    writeToLog(`Dimter WebSocket connection error: ${error.message}`);
});

// Add connection event listeners for dimter
dimterSocket.on('connect', () => {
    writeToLog('Successfully connected to Impserver');
    console.log('Successfully connected to Impserver');
});

dimterSocket.on('disconnect', () => {
    writeToLog('Disconnected from Impserver');
    console.log('Disconnected from Impserver');
});

// Modify the modbusData event listener to use both websocket connections
socket.on('modbusData', async (data) => {
    try {
        const modbusString = data.combinedString;
        writeToLog(JSON.stringify({
            event: 'modbusData',
            data: modbusString,
            timestamp: new Date().toISOString()
        }));
        
        if (latestDimterData && latestDimterData.entries) {
            const hasMatch = latestDimterData.entries.some(entry => entry.id === modbusString);
            
            if (hasMatch && modbusString !== lastMatchedString) {
                lastMatchedString = modbusString;
                
                try {
                    const matchingEntry = latestDimterData.entries.find(entry => entry.id === modbusString);
                    if (matchingEntry) {
                        const printResponse = await sendCommand(`seta:data#v1=${matchingEntry.value}`);
                        const logData = {
                            event: 'printCommand',
                            modbusString,
                            value: matchingEntry.value,
                            response: printResponse,
                            timestamp: new Date().toISOString()
                        };
                        writeToLog(JSON.stringify(logData));
                        console.log('Successfully sent print command:', logData);
                    }
                } catch (err) {
                    const errorData = {
                        event: 'error',
                        type: 'printCommand',
                        message: err.message,
                        timestamp: new Date().toISOString()
                    };
                    writeToLog(JSON.stringify(errorData));
                    console.error('Error sending print command:', err.message);
                }
            } else if (!hasMatch) {
                lastMatchedString = null;
            }
        }
    } catch (error) {
        const errorData = {
            event: 'error',
            type: 'modbusProcessing',
            message: error.message,
            timestamp: new Date().toISOString()
        };
        writeToLog(JSON.stringify(errorData));
        console.error('Error processing modbus data:', error.message);
    }
});

// Handle connection errors
socket.on('connect_error', (error) => {
    writeToLog(`WebSocket connection error: ${error.message}`);
    console.error('WebSocket connection error:', error.message);
});

socket.on('modbusError', (error) => {
    console.error('Modbus error:', error);
});

// Add connection event listeners for modbus
socket.on('connect', () => {
    writeToLog('Successfully connected to Modbus server');
    console.log('Successfully connected to Modbus server');
});

socket.on('disconnect', () => {
    writeToLog('Disconnected from Modbus server');
    console.log('Disconnected from Modbus server');
});

// Modify the fetchInitialDimterData function
async function fetchInitialDimterData() {
    return new Promise((resolve) => {
        // Set up a one-time listener for initial data
        dimterSocket.once('dimterData', (data) => {
            latestDimterData = data;
            writeToLog(JSON.stringify({
                event: 'initialDimterDataFetched',
                data: data,
                timestamp: new Date().toISOString()
            }));
            console.log('Initial Dimter data fetched successfully');
            resolve();
        });

        // Request initial data
        dimterSocket.emit('requestInitialData');

        // Set a timeout in case we don't get a response
        setTimeout(() => {
            writeToLog('Timeout waiting for initial Dimter data');
            console.warn('Timeout waiting for initial Dimter data');
            resolve();
        }, 5000);
    });
}

const PORT = 3002;
app.listen(PORT, async () => {
    ensureLogDirectory();
    writeToLog('Server started');
    await fetchInitialDimterData();
    console.log(`Laser Server running on port ${PORT}`);
});
