const express = require("express");
const cors = require("cors");
const ModbusRTU = require("modbus-serial");

const app = express();
app.use(cors());
app.use(express.json());

// PLC 1 (Modbus Server 1) - Read Holding Registers
const modbusClient1 = new ModbusRTU();
const MODBUS_SERVER_1_IP = "192.168.0.15";
const MODBUS_SERVER_1_PORT = 502;
const MODBUS_ID_1 = 1;
const START_REGISTER = 0;
const NUMBER_OF_REGISTERS = 13;

// Add retry configuration
const RETRY_INTERVAL = 5000; // 5 seconds between retry attempts
let isConnected = false;

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
        return data.data;
    } catch (error) {
        isConnected = false;
        if (error.message.includes("Illegal data address")) {
            throw new Error(`Register range ${START_REGISTER}-${START_REGISTER + NUMBER_OF_REGISTERS - 1} not available`);
        } else {
            console.error("Error reading Holding Registers from PLC 1:", error);
            // Attempt to reconnect
            setTimeout(connectModbus1, RETRY_INTERVAL);
            throw new Error("Connection lost to Modbus server");
        }
    }
}

// Modified reading loop with error handling
async function startReadingLoop1() {
    setInterval(async () => {
        try {
            const values = await readHoldingRegistersFromPLC1();
            if (values) {
                const combinedString = values.join('');
                console.log('Combined string:', combinedString);
            }
        } catch (error) {
            console.error('Reading loop error:', error.message);
        }
    }, 1000);
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

// New endpoint for the boolean register
app.get("/modbus-plc1/status", async (req, res) => {
    try {
        const values = await readHoldingRegistersFromPLC1();
        if (values) {
            const booleanValue = values[12] === 1;
            res.json({ 
                status: booleanValue,
                timestamp: new Date().toISOString()
            });
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

const PORT = 5000;
app.listen(PORT, async () => {
    await connectModbus1();
    console.log(`Modbus Server API running on port ${PORT}`);
});
