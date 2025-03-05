const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const SOURCE_DIR = path.join(__dirname, 'SOURCE');
const TEMP_DIR = path.join(__dirname, 'TEMP');
const SAV_DIR = path.join(__dirname, 'SAV');

// Add settings file path and read settings
const SETTINGS_PATH = path.join(__dirname, 'settings.txt');
let divisionFactor = 4; // Default value

// Set to track files that are already being processed
const processingFiles = new Set();

function processImpFile(filename) {
  // Read settings at the start of processing each file
  try {
    const settingsContent = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsedValue = parseInt(settingsContent.trim());
    if (!isNaN(parsedValue) && parsedValue > 0) {
      divisionFactor = parsedValue;
      console.log(`Using division factor: ${divisionFactor} from settings.txt`);
    } else {
      console.warn('Invalid division factor in settings.txt, using default value of 4');
      divisionFactor = 4;
    }
  } catch (err) {
    console.warn('Could not read settings.txt, using default division factor of 4');
    divisionFactor = 4;
  }

  const sourcePath = path.join(SOURCE_DIR, filename);
  const tempPath = path.join(TEMP_DIR, filename);
  const savPath = path.join(SAV_DIR, filename);

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
        console.error(`Error reading ${filename}:`, err);
        return;
      }

      // Remove initial file content logging
      console.log('\n=== Processing File:', filename, '===');

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

      console.log('\nInitial run distribution:');
      Object.entries(runCounts).sort((a, b) => a[0] - b[0]).forEach(([run, count]) => {
        console.log(`Run ${run}: ${count} entries`);
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
            console.log(`\nSplitting run ${runNumber} (${runCounts[runNumber]} entries) into:`);
            console.log(`Run ${runNumber}: ${Math.floor(runCounts[runNumber] / 2)} entries`);
            console.log(`Run ${runNumber + 1}: ${runCounts[runNumber] - Math.floor(runCounts[runNumber] / 2)} entries`);
            
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

      console.log('\nFinal run distribution:');
      Object.entries(runCounts).sort((a, b) => a[0] - b[0]).forEach(([run, count]) => {
        console.log(`Run ${run}: ${count} entries`);
      });
      console.log('\n');

      // Remove all other content logging
      const finalContent = lines.join('\n');

      // Write to TEMP folder
      fs.writeFile(tempPath, finalContent, (err) => {
        if (err) {
          console.error(`Error writing ${filename} to TEMP:`, err);
        } else {
          console.log(`Modified and copied ${filename} to TEMP (overwriting if existed).`);
        }
      });

      // Write to SAV folder and then delete the source file
      fs.writeFile(savPath, finalContent, (err) => {
        if (err) {
          console.error(`Error writing ${filename} to SAV:`, err);
        } else {
          console.log(`Modified and copied ${filename} to SAV.`);
          fs.unlink(sourcePath, (err) => {
            if (err) {
              console.error(`Error deleting ${filename} from SOURCE:`, err);
            } else {
              console.log(`Deleted ${filename} from SOURCE.`);
            }
          });
        }
      });
    });
  });
}

// Function to create a watcher for a specific directory
function createDirectoryWatcher(directory, dirName) {
  fs.watch(directory, (eventType, filename) => {
    if (filename && path.extname(filename) === '.imp') {
      if (eventType === 'rename') {
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
                                value: columns[columns.length - 2].trim()
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

// Add this at the bottom of your file if not already present
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
