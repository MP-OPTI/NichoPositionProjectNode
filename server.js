const express = require("express");
const cors = require("cors");
const ModbusRTU = require("modbus-serial");

const app = express();
app.use(cors());
app.use(express.json());

// PLC 1 (Modbus Server 1) - Read Coils (Outputs Q1-Q8)
const modbusClient1 = new ModbusRTU();
const MODBUS_SERVER_1_IP = "10.2.1.235";
const MODBUS_SERVER_1_PORT = 502;
const MODBUS_ID_1 = 1;
const COIL_REGISTER = 8256; // Read Q1-Q8 (Modbus address 0-7)

// PLC 2 (Modbus Server 2) - Read Discrete Inputs (I1-I8)
const modbusClient2 = new ModbusRTU();
const MODBUS_SERVER_2_IP = "10.2.1.233";
const MODBUS_SERVER_2_PORT = 502;
const MODBUS_ID_2 = 1;
const DISCRETE_INPUT_REGISTER = 8192; // Read I1-I8 (Modbus address 0-7)

// Connect to PLC 1
async function connectModbus1() {
    try {
        await modbusClient1.connectTCP(MODBUS_SERVER_1_IP, { port: MODBUS_SERVER_1_PORT });
        await modbusClient1.setID(MODBUS_ID_1);
        console.log("Connected to Modbus Server 1 (PLC 1)!");
        startReadingLoop1();
    } catch (error) {
        console.error("Modbus Server 1 connection failed:", error);
    }
}

// Connect to PLC 2
async function connectModbus2() {
    try {
        await modbusClient2.connectTCP(MODBUS_SERVER_2_IP, { port: MODBUS_SERVER_2_PORT });
        await modbusClient2.setID(MODBUS_ID_2);
        console.log("Connected to Modbus Server 2 (PLC 2)!");
        startReadingLoop2();
    } catch (error) {
        console.error("Modbus Server 2 connection failed:", error);
    }
}

// Read Coils from PLC 1
async function readCoilsFromPLC1() {
    try {
        const data = await modbusClient1.readCoils(COIL_REGISTER, 8); // Read Q1-Q8
        return data.data;
    } catch (error) {
        console.error("Error reading Coils from PLC 1:", error);
        return null;
    }
}

// Read Discrete Inputs from PLC 2
async function readDiscreteInputsFromPLC2() {
    try {
        const data = await modbusClient2.readCoils(DISCRETE_INPUT_REGISTER, 8); // Read I1-I8
        return data.data;
    } catch (error) {
        console.error("Error reading Discrete Inputs from PLC 2:", error);
        return null;
    }
}

// Periodically log PLC 1 values
async function startReadingLoop1() {
    setInterval(async () => {
        const values = await readCoilsFromPLC1();
        if (values) {
            console.log(`PLC 1: ${values.join(" | ")}`);
        }
    }, 1000);
}

// Periodically log PLC 2 values
async function startReadingLoop2() {
    setInterval(async () => {
        const values = await readDiscreteInputsFromPLC2();
        if (values) {
            console.log(`PLC 2: ${values.join(" | ")}`);
        }
    }, 1000);
}

// API endpoint for React frontend to get PLC 1 Coil Data
app.get("/modbus-coils-plc1", async (req, res) => {
    const values = await readCoilsFromPLC1();
    res.json({ values });
});

// API endpoint for React frontend to get PLC 2 Discrete Input Data
app.get("/modbus-discrete-inputs-plc2", async (req, res) => {
    const values = await readDiscreteInputsFromPLC2();
    res.json({ values });
});

const PORT = 5000;
app.listen(PORT, async () => {
    await connectModbus1();
    await connectModbus2();
    console.log(`Modbus Server API running on port ${PORT}`);
});
