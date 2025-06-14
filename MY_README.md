# Playwright Reports Server - Quick Start Guide

## Starting the Server

```bash
# Navigate to the server directory
cd /home/muly/reporter-playwright-reports-server

# Build the project (if changes were made)
yarn build

# Start the server
nohup ./start.sh > server.log 2>&1 &

# Check if server is running
curl http://localhost:3001/api/ping
```

## Server Status Commands

```bash
# Check server status
curl -s http://localhost:3001/api/ping

# Stop server
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# View server logs
tail -f /home/muly/reporter-playwright-reports-server/server.log
```

## Important Note: Data Storage Location Change

⚠️ **Data Folder Location Changed**: After building and running the server, the data is now stored in:
- **New Location**: `/home/muly/reporter-playwright-reports-server/.next/standalone/data/`
- **Old Location**: `/home/muly/reporter-playwright-reports-server/data/` *(no longer used)*

### Data Directories:
- **Reports**: `/.next/standalone/data/reports/`
- **Results**: `/.next/standalone/data/results/`

### Clean Data (if needed):
```bash
# Stop server first
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Clear all data
rm -rf /home/muly/reporter-playwright-reports-server/.next/standalone/data/reports/*
rm -rf /home/muly/reporter-playwright-reports-server/.next/standalone/data/results/*

# Restart server
nohup ./start.sh > server.log 2>&1 &
```

## UI Enhancement
The server now displays metadata (`workingDir`, `branch`, `environment`) as chips below each report title. Any additional fields in your `resultDetails` will automatically appear in the UI.