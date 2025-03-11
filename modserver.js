const express = require("express");
const cors = require("cors");
const ModbusRTU = require("modbus-serial");
const { createServer } = require("http");
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// PLC 1 (Modbus Server 1) - Read Holding Registers
const modbusClient1 = new ModbusRTU();
const MODBUS_SERVER_1_IP = "192.168.0.15";
const MODBUS_SERVER_1_PORT = 502;
const MODBUS_ID_1 = 1;
const START_REGISTER = 0;
const NUMBER_OF_REGISTERS = 12;

// Add retry configuration
const RETRY_INTERVAL = 5000; // 5 seconds between retry attempts
let isConnected = false;

// Add variable to store previous values
let previousValues = null;

// Add at the top with other constants
const NO_CHANGE_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

// Add with other global variables
let lastChangeTime = Date.now();

// Create HTTP server and Socket.IO instance
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Configure this according to your frontend URL
        methods: ["GET", "POST"]
    }
});

// Add logging utility functions
function getLogFileName() {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    return path.join(__dirname, 'LOGS/MODSERVER', `modbus_${date}.log`);
}

function ensureLogDirectory() {
    const logDir = path.join(__dirname, 'LOGS/MODSERVER');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir);
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

// Modified connect function with retry logic
async function connectModbus1() {
    try {
        await modbusClient1.connectTCP(MODBUS_SERVER_1_IP, { port: MODBUS_SERVER_1_PORT });
        await modbusClient1.setID(MODBUS_ID_1);
        console.log("Connected to Modbus Server!");
        isConnected = true;
        startReadingLoop1();
    } catch (error) {
        console.error("Modbus Server connection failed:", error);
        isConnected = false;
        // Retry connection
        setTimeout(connectModbus1, RETRY_INTERVAL);
    }
}

async function readHoldingRegistersFromPLC1() {
    if (!isConnected) {
        throw new Error("Not connected to Modbus server");
    }
    try {
        const data = await modbusClient1.readHoldingRegisters(START_REGISTER, NUMBER_OF_REGISTERS);
        // If we successfully read data, ensure isConnected is true
        isConnected = true;
        return data.data;
    } catch (error) {
        console.error("Error reading Holding Registers from PLC 1:", error);
        isConnected = false;
        
        // Close the connection explicitly on error
        try {
            await modbusClient1.close();
        } catch (closeError) {
            console.error("Error closing connection:", closeError);
        }

        // Attempt to reconnect
        setTimeout(connectModbus1, RETRY_INTERVAL);
        throw new Error("Connection lost to Modbus server");
    }
}

// Modified reading loop with WebSocket emission and console logging
async function startReadingLoop1() {
    setInterval(async () => {
        try {
            const values = await readHoldingRegistersFromPLC1();
            if (values) {
                const combinedString = values.join('');
                const currentTime = Date.now();
                
                // Only emit and log if values have changed
                if (!previousValues || !arraysEqual(values, previousValues)) {
                    const data = {
                        combinedString: combinedString,
                        connectionStatus: isConnected,
                        timestamp: new Date().toISOString()
                    };
                    
                    io.emit('modbusData', data);
                    
                    // Log the changed values
                    const logMessage = JSON.stringify(data);
                    writeToLog(logMessage);
                    
                    previousValues = [...values];
                    lastChangeTime = currentTime;
                } else if (currentTime - lastChangeTime >= NO_CHANGE_INTERVAL) {
                    // Log current state with NO CHANGES flag if 10 minutes have passed
                    const data = {
                        combinedString: combinedString,
                        connectionStatus: isConnected,
                        timestamp: new Date().toISOString(),
                        status: "NO CHANGES"
                    };
                    
                    writeToLog(JSON.stringify(data));
                    lastChangeTime = currentTime; // Reset the timer
                }
            }
        } catch (error) {
            const errorMessage = JSON.stringify({
                error: error.message,
                connectionStatus: isConnected,
                timestamp: new Date().toISOString()
            });
            
            io.emit('modbusError', JSON.parse(errorMessage));
            writeToLog(`ERROR: ${errorMessage}`);
        }
    }, 50);
}

// Helper function to compare arrays
function arraysEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) &&
        a.length === b.length &&
        a.every((val, index) => val === b[index]);
}

// Modified API endpoint to exclude the last register
app.get("/modbus-plc1", async (req, res) => {
    try {
        const values = await readHoldingRegistersFromPLC1();
        if (values) {
            // Only combine the first 12 registers
            const combinedString = values.slice(0, 13).join('');
            res.json({ combinedString });
        } else {
            throw new Error("No values received from PLC");
        }
    } catch (error) {
        res.status(503).json({ 
            error: error.message,
            status: "disconnected",
            timestamp: new Date().toISOString()
        });
    }
});

// Modify the server startup to ensure log directory exists
const PORT = 5000;
httpServer.listen(PORT, async () => {
    ensureLogDirectory();
    await connectModbus1();
    writeToLog('Server started');
    console.log(`Modbus Server API running on port ${PORT}`);
});
