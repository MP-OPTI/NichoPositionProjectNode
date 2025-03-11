const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createServer } = require("http");
const { Server } = require("socket.io");

const SOURCE_DIR = path.join(__dirname, 'SOURCE');
const TEMP_DIR = path.join(__dirname, 'TEMP');
const SAV_DIR = path.join(__dirname, 'SAV');
const LOG_DIR = path.join(__dirname, 'LOGS', 'IMPSERVER');

// Add settings file path and read settings
const SETTINGS_PATH = path.join(__dirname, 'settings.txt');
let divisionFactor = 4; // Default value

// Add filesettings path and array to store patterns
const FILESETTINGS_PATH = path.join(__dirname, 'filesettings.txt');
let skipPatterns = ['-VKa']; // Default value with original pattern

// Set to track files that are already being processed
const processingFiles = new Set();

// Add this near the top of the file with other global variables
let currentDimterData = { entries: [] };

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Function to get current date formatted as YYYY-MM-DD
function getFormattedDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Function to write to log file
function writeToLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  const logFile = path.join(LOG_DIR, `${getFormattedDate()}.txt`);
  
  fs.appendFile(logFile, logMessage, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });
}

function loadSkipPatterns() {
  try {
    const patternsContent = fs.readFileSync(FILESETTINGS_PATH, 'utf8');
    const patterns = patternsContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (patterns.length > 0) {
      skipPatterns = patterns;
      console.log('Loaded skip patterns:', skipPatterns);
    } else {
      console.warn('filesettings.txt is empty, using default pattern: -VKa');
    }
  } catch (err) {
    console.warn('Could not read filesettings.txt, using default pattern: -VKa');
  }
}

// Load patterns when server starts
loadSkipPatterns();

// Watch for changes in filesettings.txt
fs.watch(FILESETTINGS_PATH, (eventType) => {
  if (eventType === 'change') {
    loadSkipPatterns();
  }
});

function processImpFile(filename) {
  const sourcePath = path.join(SOURCE_DIR, filename);
  const tempPath = path.join(TEMP_DIR, filename);
  const savPath = path.join(SAV_DIR, filename);

  writeToLog(`Processing file: ${filename}`);

  // First, check if the file contains any skip patterns in the first line
  fs.readFile(sourcePath, 'utf8', (err, data) => {
    if (err) {
      const errorMsg = `Error reading ${filename}: ${err}`;
      console.error(errorMsg);
      writeToLog(errorMsg);
      return;
    }

    const firstLine = data.split('\n')[0];
    if (firstLine && skipPatterns.some(pattern => firstLine.includes(pattern))) {
      const skipMsg = `${filename} contains skip pattern, moving to SAV without processing`;
      console.log(skipMsg);
      writeToLog(skipMsg);
      
      // Move directly to SAV and delete from SOURCE
      fs.writeFile(savPath, data, (err) => {
        if (err) {
          const errorMsg = `Error writing ${filename} to SAV: ${err}`;
          console.error(errorMsg);
          writeToLog(errorMsg);
        } else {
          const successMsg = `Copied ${filename} to SAV.`;
          console.log(successMsg);
          writeToLog(successMsg);
          fs.unlink(sourcePath, (err) => {
            if (err) {
              const errorMsg = `Error deleting ${filename} from SOURCE: ${err}`;
              console.error(errorMsg);
              writeToLog(errorMsg);
            } else {
              const deleteMsg = `Deleted ${filename} from SOURCE.`;
              console.log(deleteMsg);
              writeToLog(deleteMsg);
            }
          });
        }
      });
      return;
    }

    // Read settings at the start of processing each file
    try {
      const settingsContent = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const parsedValue = parseInt(settingsContent.trim());
      if (!isNaN(parsedValue) && parsedValue > 0) {
        divisionFactor = parsedValue;
        const settingsMsg = `Using division factor: ${divisionFactor} from settings.txt`;
        console.log(settingsMsg);
        writeToLog(settingsMsg);
      } else {
        const warnMsg = 'Invalid division factor in settings.txt, using default value of 4';
        console.warn(warnMsg);
        writeToLog(warnMsg);
        divisionFactor = 4;
      }
    } catch (err) {
      const warnMsg = 'Could not read settings.txt, using default division factor of 4';
      console.warn(warnMsg);
      writeToLog(warnMsg);
      divisionFactor = 4;
    }

    // Check if file exists to avoid processing an already-removed file
    fs.stat(sourcePath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') {
          console.log(`${filename} no longer exists, skipping.`);
        } else {
          console.error(`Error stating ${filename}:`, err);
        }
        return;
      }

      // Read and modify the file content
      fs.readFile(sourcePath, 'utf8', (err, data) => {
        if (err) {
          const errorMsg = `Error reading ${filename}: ${err}`;
          console.error(errorMsg);
          writeToLog(errorMsg);
          return;
        }

        const processingMsg = `\n=== Processing File: ${filename} ===`;
        console.log(processingMsg);
        writeToLog(processingMsg);

        // Process the file content (first run - adding the run numbers)
        const modifiedContent = data.split('\n').map(line => {
          if (!line.trim()) return line;
          const columns = line.split(';');
          if (columns.length < 2) return line;
          
          const lastColumn = columns[columns.length - 1].trim();
          const lastValue = parseInt(lastColumn);
          
          let newColumnValue = Math.ceil(lastValue / divisionFactor); // Using the value from settings
          newColumnValue = Math.min(newColumnValue, 50);
          
          columns.splice(columns.length - 1, 0, newColumnValue.toString());
          
          return columns.join(';');
        }).join('\n');

        // Remove the first run content logging
        let lines = modifiedContent.split('\n');
        
        // Count occurrences of each run number
        const runCounts = {};
        lines.forEach(line => {
          if (!line.trim()) return;
          const columns = line.split(';');
          const runNumber = parseInt(columns[columns.length - 2]); // Get run number
          runCounts[runNumber] = (runCounts[runNumber] || 0) + 1;
        });

        writeToLog('\nInitial run distribution:');
        Object.entries(runCounts).sort((a, b) => a[0] - b[0]).forEach(([run, count]) => {
          const runMsg = `Run ${run}: ${count} entries`;
          console.log(runMsg);
          writeToLog(runMsg);
        });

        // Process run numbers that exceed 999
        let needsReprocessing;
        let iteration = 0;
        do {
          needsReprocessing = false;
          iteration++;
          
          // Sort run numbers to process them in order
          const sortedRunNumbers = Object.keys(runCounts)
            .map(Number)
            .sort((a, b) => a - b);

          for (const runNumber of sortedRunNumbers) {
            if (runCounts[runNumber] > 999) {
              needsReprocessing = true;
              
              // Simplified logging for splits
              const splitMsg = `\nSplitting run ${runNumber} (${runCounts[runNumber]} entries) into:`;
              console.log(splitMsg);
              writeToLog(splitMsg);
              
              const split1 = `Run ${runNumber}: ${Math.floor(runCounts[runNumber] / 2)} entries`;
              const split2 = `Run ${runNumber + 1}: ${runCounts[runNumber] - Math.floor(runCounts[runNumber] / 2)} entries`;
              console.log(split1);
              console.log(split2);
              writeToLog(split1);
              writeToLog(split2);
              
              let processed = 0;
              
              // First, shift all higher run numbers up by 1
              const oldRunCounts = {...runCounts};
              Object.keys(oldRunCounts)
                .map(Number)
                .filter(run => run > runNumber)
                .sort((a, b) => b - a)  // Process in reverse order to avoid overwriting
                .forEach(run => {
                  runCounts[run + 1] = oldRunCounts[run];
                  delete runCounts[run];
                });
              
              // Now split the current run
              lines = lines.map(line => {
                if (!line.trim()) return line;
                const columns = line.split(';');
                const currentRunNumber = parseInt(columns[columns.length - 2]);
                
                if (currentRunNumber === runNumber) {
                  processed++;
                  const newRunNumber = processed <= Math.floor(runCounts[runNumber] / 2) ? runNumber : runNumber + 1;
                  columns[columns.length - 2] = newRunNumber.toString();
                } else if (currentRunNumber > runNumber) {
                  columns[columns.length - 2] = (currentRunNumber + 1).toString();
                }
                
                return columns.join(';');
              });
              
              // Update run counts for the split run
              runCounts[runNumber] = Math.floor(oldRunCounts[runNumber] / 2);
              runCounts[runNumber + 1] = oldRunCounts[runNumber] - Math.floor(oldRunCounts[runNumber] / 2);
            }
          }
        } while (needsReprocessing);

        writeToLog('\nFinal run distribution:');
        Object.entries(runCounts).sort((a, b) => a[0] - b[0]).forEach(([run, count]) => {
          const runMsg = `Run ${run}: ${count} entries`;
          console.log(runMsg);
          writeToLog(runMsg);
        });
        console.log('\n');

        // Remove all other content logging
        const finalContent = lines.join('\n');

        // Write to TEMP folder
        fs.writeFile(tempPath, finalContent, (err) => {
          if (err) {
            const errorMsg = `Error writing ${filename} to TEMP: ${err}`;
            console.error(errorMsg);
            writeToLog(errorMsg);
          } else {
            const successMsg = `Modified and copied ${filename} to TEMP (overwriting if existed).`;
            console.log(successMsg);
            writeToLog(successMsg);
          }
        });

        // Write to SAV folder and then delete the source file
        fs.writeFile(savPath, finalContent, (err) => {
          if (err) {
            const errorMsg = `Error writing ${filename} to SAV: ${err}`;
            console.error(errorMsg);
            writeToLog(errorMsg);
          } else {
            const successMsg = `Modified and copied ${filename} to SAV.`;
            console.log(successMsg);
            writeToLog(successMsg);
            fs.unlink(sourcePath, (err) => {
              if (err) {
                const errorMsg = `Error deleting ${filename} from SOURCE: ${err}`;
                console.error(errorMsg);
                writeToLog(errorMsg);
              } else {
                const deleteMsg = `Deleted ${filename} from SOURCE.`;
                console.log(deleteMsg);
                writeToLog(deleteMsg);
              }
            });
          }
        });
      });
    });
  });
}

// Function to create a watcher for a specific directory
function createDirectoryWatcher(directory, dirName) {
  fs.watch(directory, (eventType, filename) => {
    if (filename && path.extname(filename) === '.imp') {
      if (eventType === 'rename' || eventType === 'change') {
        if (dirName === 'TEMP' && filename === 'Dimter.imp') {
          // Emit updated dimter data when the file changes
          setTimeout(emitDimterData, 100); // Small delay to ensure file is written
        }
        // In fs.watch, 'rename' event occurs for both creation and deletion
        fs.stat(path.join(directory, filename), (err) => {
          if (err && err.code === 'ENOENT') {
            console.log(`File ${filename} was deleted from ${dirName}`);
          } else if (!err) {
            if (dirName === 'SOURCE') {
              // Only process new files from SOURCE directory
              if (processingFiles.has(filename)) return;
              processingFiles.add(filename);
              console.log(`Detected new file ${filename} in SOURCE`);
              
              setTimeout(() => {
                processImpFile(filename);
                setTimeout(() => {
                  processingFiles.delete(filename);
                }, 500);
              }, 100);
            } else {
              console.log(`File ${filename} was created in ${dirName}`);
            }
          }
        });
      }
    }
  });
}

// Create watchers for all three directories
createDirectoryWatcher(SOURCE_DIR, 'SOURCE');
createDirectoryWatcher(SAV_DIR, 'SAV');
createDirectoryWatcher(TEMP_DIR, 'TEMP');

console.log('IMP Server started successfully');
console.log(`Watching for .imp files in:`);
console.log(`SOURCE: ${SOURCE_DIR}`);
console.log(`SAV: ${SAV_DIR}`);
console.log(`TEMP: ${TEMP_DIR}`);
writeToLog('IMP Server started successfully');
writeToLog(`Watching directories - SOURCE: ${SOURCE_DIR}, SAV: ${SAV_DIR}, TEMP: ${TEMP_DIR}`);

const app = express();
app.use(cors());

// Add this endpoint to your impserver.js
app.get('/api/dimter-numbers', (req, res) => {
    const tempPath = path.join(__dirname, 'TEMP', 'Dimter.imp');
    
    // Check if file exists
    fs.access(tempPath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.json({ message: 'NO DIMTER FILER' });
        }

        fs.readFile(tempPath, 'utf8', (err, data) => {
            if (err) {
                return res.status(500).json({ error: 'Error reading Dimter.imp file' });
            }

            try {
                const lines = data.split('\n');
                const entries = lines
                    .filter(line => line.trim()) // Remove empty lines
                    .map(line => {
                        const columns = line.split(';');
                        if (columns.length >= 9) {
                            return {
                                id: columns[8].substring(0, 12),
                                value: columns[columns.length - 1].trim()
                            };
                        }
                        return null;
                    })
                    .filter(entry => entry !== null)
                    .slice(0, 5000); // Get only first 5000 entries

                res.json({ entries });
            } catch (error) {
                res.status(500).json({ error: 'Error processing file data' });
            }
        });
    });
});

// Add these endpoints before the app.listen line
app.get('/api/settings', (req, res) => {
    fs.readFile(SETTINGS_PATH, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ 
                error: 'Error reading settings', 
                value: 4 // Return default value if file can't be read
            });
        }
        const value = parseInt(data.trim()) || 4;
        res.json({ value });
    });
});

app.post('/api/settings', express.json(), (req, res) => {
    const { value } = req.body;
    const numValue = parseInt(value);

    // Validate the input
    if (isNaN(numValue) || numValue <= 0) {
        return res.status(400).json({ error: 'Invalid value. Must be a positive number.' });
    }

    fs.writeFile(SETTINGS_PATH, numValue.toString(), 'utf8', (err) => {
        if (err) {
            return res.status(500).json({ error: 'Error saving settings' });
        }
        res.json({ value: numValue });
    });
});

// Create HTTP server and Socket.IO instance
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Modify the emitDimterData function to store the current data
function emitDimterData() {
    const tempPath = path.join(__dirname, 'TEMP', 'Dimter.imp');
    
    fs.access(tempPath, fs.constants.F_OK, (err) => {
        if (err) {
            const msg = 'Initial Dimter data: NO DIMTER FILER';
            writeToLog(msg);
            currentDimterData = { message: 'NO DIMTER FILER' };
            io.emit('dimterData', currentDimterData);
            return;
        }

        fs.readFile(tempPath, 'utf8', (err, data) => {
            if (err) {
                const msg = `Error reading initial Dimter.imp file: ${err}`;
                writeToLog(msg);
                io.emit('dimterError', { error: 'Error reading Dimter.imp file' });
                return;
            }

            try {
                const lines = data.split('\n');
                const entries = lines
                    .filter(line => line.trim())
                    .map(line => {
                        const columns = line.split(';');
                        if (columns.length >= 9) {
                            return {
                                id: columns[8].substring(0, 12),
                                value: columns[columns.length - 1].trim()
                            };
                        }
                        return null;
                    })
                    .filter(entry => entry !== null)
                    .slice(0, 5000);

                currentDimterData = { entries };
                const msg = `Initial Dimter data loaded successfully with ${entries.length} entries`;
                writeToLog(msg);
                io.emit('dimterData', currentDimterData);
            } catch (error) {
                const msg = `Error processing initial Dimter data: ${error}`;
                writeToLog(msg);
                io.emit('dimterError', { error: 'Error processing file data' });
            }
        });
    });
}

// Add this with your other socket.io event handlers
io.on('connection', (socket) => {
    socket.on('requestInitialData', () => {
        // Send the current Dimter data to the requesting client
        socket.emit('dimterData', currentDimterData);
    });
});

// Start server and initialize data
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    writeToLog(`Server started on port ${PORT}`);
    
    // Emit initial Dimter data after server is fully started
    emitDimterData();
});
