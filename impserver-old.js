const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const SOURCE_DIR = path.join(__dirname, 'SOURCE');
const TEMP_DIR = path.join(__dirname, 'TEMP');
const SAV_DIR = path.join(__dirname, 'SAV');

// Set to track files that are already being processed
const processingFiles = new Set();

function processImpFile(filename) {
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

      console.log('Original content:', data); // Debug log

      // Process the file content
      const modifiedContent = data.split('\n').map(line => {
        if (!line.trim()) return line; // Skip empty lines
        const columns = line.split(';');
        if (columns.length < 2) return line; // Skip lines with insufficient columns
        
        const lastColumn = columns[columns.length - 1].trim(); // Trim any whitespace
        const lastValue = parseInt(lastColumn);
        
        // Calculate value for the new column
        let newColumnValue = Math.ceil(lastValue / 4);
        // Ensure the value doesn't exceed 50
        newColumnValue = Math.min(newColumnValue, 50);
        
        // Insert the new column before the last column
        columns.splice(columns.length - 1, 0, newColumnValue.toString());
        
        // Join columns back together
        return columns.join(';');
      }).join('\n');

      console.log('Modified content:', modifiedContent); // Debug log

      // Write to TEMP folder
      fs.writeFile(tempPath, modifiedContent, (err) => {
        if (err) {
          console.error(`Error writing ${filename} to TEMP:`, err);
        } else {
          console.log(`Modified and copied ${filename} to TEMP (overwriting if existed).`);
        }
      });

      // Write to SAV folder and then delete the source file
      fs.writeFile(savPath, modifiedContent, (err) => {
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
                                value: columns[columns.length - 1].trim()
                            };
                        }
                        return null;
                    })
                    .filter(entry => entry !== null)
                    .slice(0, 3000); // Get only first 12 entries

                res.json({ entries });
            } catch (error) {
                res.status(500).json({ error: 'Error processing file data' });
            }
        });
    });
});

// Add this at the bottom of your file if not already present
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
