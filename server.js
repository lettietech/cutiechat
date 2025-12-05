const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS settings for client connections
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Stores user objects waiting for a match: { id, username, country, partnerId }
let waitingUsers = []; 

// The 'public' directory will hold our frontend files (index.html, client.js)
app.use(express.static('public'));

// Basic route to serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// --- Socket.IO Real-Time Logic ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Handles user joining the queue with their data
    socket.on('start-matching', (userData) => {
        const { username, country } = userData;
        
        console.log(`${socket.id} (${username}, ${country}) requested matching.`);

        // Remove the current socket from the queue if they were already waiting (re-queuing)
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        
        let partnerUser = null;
        
        // --- SMART MATCHMAKING LOGIC: Worldwide First ---
        
        // A. Search for a Worldwide Partner (Different Country)
        let worldwidePartnerIndex = waitingUsers.findIndex(user => user.country !== country);
        
        if (worldwidePartnerIndex !== -1) {
            // Found worldwide match! Remove partner from queue.
            partnerUser = waitingUsers.splice(worldwidePartnerIndex, 1)[0];
            console.log(`Match found! Worldwide priority. ${username} (${country}) paired with ${partnerUser.username} (${partnerUser.country})`);
        } else {
            // B. Search for a Local Partner (Same Country) - Fallback
            let localPartnerIndex = waitingUsers.findIndex(user => user.country === country);

            if (localPartnerIndex !== -1) {
                // Found local match (fallback). Remove partner from queue.
                partnerUser = waitingUsers.splice(localPartnerIndex, 1)[0];
                console.log(`Match found! Local fallback. ${username} (${country}) paired with ${partnerUser.username} (${partnerUser.country})`);
            }
        }

        if (partnerUser) {
            const partnerSocket = io.sockets.sockets.get(partnerUser.id);
            
            if (partnerSocket) {
                // Send match info to both users
                // User 1 gets partner's details
                socket.emit('match-found', { 
                    partnerId: partnerUser.id, 
                    partnerUsername: partnerUser.username,
                    partnerCountry: partnerUser.country 
                });
                
                // User 2 gets user 1's details
                partnerSocket.emit('match-found', { 
                    partnerId: socket.id, 
                    partnerUsername: username,
                    partnerCountry: country
                });
            } else {
                // Partner was stale/disconnected, re-add current user to queue
                waitingUsers.push({ id: socket.id, username, country });
                socket.emit('waiting-in-queue');
                console.log(`Potential partner ${partnerUser.id} was stale. ${socket.id} remains in queue.`);
            }

        } else {
            // No match found, add current user to queue
            waitingUsers.push({ id: socket.id, username, country });
            console.log(`${socket.id} (${country}) added to queue. Total waiting: ${waitingUsers.length}`);
            socket.emit('waiting-in-queue');
        }
    });

    // 2. Handles WebRTC signaling data exchange (Offer, Answer, ICE Candidates)
    socket.on('signal', (data) => {
        // Relay the signal directly to the intended recipient socket ID
        io.to(data.target).emit('signal', {
            sender: socket.id,
            type: data.type,
            payload: data.payload
        });
    });

    // 3. Handles Manual Hang-up (user clicks button or auto-detects failure)
    socket.on('user-hangup', ({ partnerId }) => {
        if (partnerId) {
            console.log(`${socket.id} hung up on partner ${partnerId}.`);
            // Tell the partner's socket that their partner dropped
            io.to(partnerId).emit('partner-dropped');
        }
        // Ensure user is not waiting in the queue if they hung up
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
    });


    // 4. Handles Unexpected Disconnect (browser close/network failure)
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find if the disconnected user had a partner in the waiting list (shouldn't happen, but safe check)
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        
        // Note: The logic for finding an *active* partner who dropped is harder to manage in a simple queue,
        // so we rely on the `user-hangup` signal from the client (peerConnection.oniceconnectionstatechange) 
        // to handle mid-call drops. We primarily clean up the queue here.
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});