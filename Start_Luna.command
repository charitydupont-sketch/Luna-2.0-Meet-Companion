#!/bin/bash

# Move to the directory containing this script (portable path resolution)
cd "$(dirname "$0")"

echo "========================================="
echo "  Starting Luna 2.0 Meet Companion...   "
echo "========================================="

# Automatically open the Quick Portal in the default browser after 1.5 seconds
(sleep 1.5 && open "http://localhost:8000") &

# Start the Node.js server
node server.js
