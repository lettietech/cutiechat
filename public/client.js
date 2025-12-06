// --- DOM Elements ---
const lobbyView = document.getElementById('lobby-view');
const videoChatView = document.getElementById('video-chat-view');
const signupForm = document.getElementById('signup-form');
const waitingMessage = document.getElementById('waiting-message');
const statusMessage = document.getElementById('status-message');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const hangupButton = document.getElementById('hangup-button');
const localInfo = document.getElementById('local-info');
const remoteInfo = document.getElementById('remote-info');
const remoteVideoContainer = document.getElementById('remote-video-container');

// --- Global State ---
const socket = io(); // Connects to the Socket.IO server on port 3000
let localStream;
let peerConnection;
let partnerId = null;

let localUserData = {
    username: '',
    country: ''
};

// --- WebRTC Configuration ---
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Utility Functions ---

/**
 * Gets the user's local media stream (camera and microphone).
 * ⭐️ FEATURE: Used to start local video immediately upon joining the queue.
 */
async function startLocalMedia() {
    try {
        if (!localStream) {
            // Request both video and audio access from the browser
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            localVideo.play();
        }
        localInfo.textContent = `${localUserData.username} (${localUserData.country})`;

    } catch (error) {
        console.error("Error accessing media devices: ", error);
        statusMessage.textContent = "Error: Could not access camera/microphone. Please check permissions.";
    }
}

/**
 * Initializes the RTCPeerConnection object and sets up event listeners.
 */
function createPeerConnection(isInitiator) {
    if (peerConnection) {
        peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection(iceServers);

    // Add local media tracks to the peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Handle remote track arrival
    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play();
            // ⭐️ FEATURE: Updated status message text
            statusMessage.textContent = "Connected! Your Live Stream is Active."; 
            
            // Secondary Accent Color: Green for positive status
            statusMessage.classList.remove('text-blue-600'); 
            statusMessage.classList.add('text-green-600'); 
            
            // *** GREEN BORDER CODE REMOVED HERE ***
        }
    };

    // Handle ICE candidate discovery (finding the best connection path)
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                target: partnerId,
                type: 'ice-candidate',
                payload: event.candidate
            });
        }
    };

    // Handle unexpected disconnections or failures
    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        console.log('ICE Connection State:', state);
        
        // If the connection drops unexpectedly, signal server and requeue
        if (state === 'disconnected' || state === 'failed') {
            if (partnerId) {
                // Signal server that we are hanging up, so the partner knows
                socket.emit('user-hangup', { partnerId: partnerId });
            }
            // Clear local state and start searching again
            clearConnectionState();
            requeueForMatch();
        }
    };
    
    // If we are the initiator (the one who creates the offer), start the process
    if (isInitiator) {
        createOffer();
    }
}

/**
 * Creates and sends an SDP offer.
 */
async function createOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', {
            target: partnerId,
            type: 'sdp-offer',
            payload: peerConnection.localDescription
        });
        statusMessage.textContent = "Offering connection to partner...";
    } catch (error) {
        console.error("Error creating offer:", error);
    }
}

/**
 * Creates and sends an SDP answer.
 */
async function createAnswer(offer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', {
            target: partnerId,
            type: 'sdp-answer',
            payload: peerConnection.localDescription
        });
        statusMessage.textContent = "Sending connection response...";
    } catch (error) {
        console.error("Error creating answer:", error);
    }
}

/**
 * Stops media tracks and resets WebRTC objects/UI.
 */
function clearConnectionState() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Reset video elements and state
    remoteVideo.srcObject = null;
    remoteInfo.textContent = '';
    partnerId = null;
    
    // *** GREEN BORDER RESET CODE REMOVED HERE ***
}


/**
 * Handles the "Hang Up" action (manual button click).
 * NOTE: This function is only used internally if user data is missing.
 */
function handleHangUp(isAutomatic = false) {
    if (partnerId) {
        // 1. Tell the server we are hanging up (so the partner is notified)
        socket.emit('user-hangup', { partnerId: partnerId });
    }
    
    // 2. Clear connection state
    clearConnectionState();
    
    // 3. Stop local media only if manually stopping (keep it running if we are requeuing)
    if (!isAutomatic && localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
        localInfo.textContent = '';
    }

    // Reset UI to the lobby view
    console.log("Connection ended. Returning to lobby.");
    
    // Show the lobby view for a full restart
    lobbyView.classList.remove('hidden');
    videoChatView.classList.add('hidden');
    waitingMessage.classList.add('hidden');
    
    statusMessage.textContent = "Disconnected. Join the lobby to find a new chat.";
    statusMessage.classList.remove('text-green-600');
    statusMessage.classList.add('text-blue-600');
}

/**
 * Auto-Requeue logic (key functional requirement).
 */
function requeueForMatch() {
    // Hide video view, ensure waiting message is visible
    videoChatView.classList.add('hidden');
    lobbyView.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
    
    // Update status message
    statusMessage.textContent = "Partner dropped. Automatically searching for a new International match...";
    statusMessage.classList.remove('text-green-600');
    statusMessage.classList.add('text-blue-600');
    
    // Use the existing user data to immediately re-enter the queue
    if (localUserData.username && localUserData.country) {
        socket.emit('start-matching', localUserData);
        console.log("Auto-Requeuing for a new match with data:", localUserData);
    } else {
        // If data is lost, force a return to the full lobby view
        handleHangUp(false);
    }
}

// --- Socket.IO Event Handlers ---

// 1. Match Found Event
socket.on('match-found', async (data) => {
    partnerId = data.partnerId;
    const { partnerUsername, partnerCountry } = data;

    console.log(`Match found with ${partnerUsername} (${partnerCountry})!`);
    
    // Update UI
    waitingMessage.classList.add('hidden');
    lobbyView.classList.add('hidden');
    videoChatView.classList.remove('hidden');
    statusMessage.textContent = `Match found! Setting up video...`;
    remoteInfo.textContent = `${partnerUsername} (${partnerCountry})`;
    
    // Determine who creates the initial offer (smaller socket ID initiates)
    const isInitiator = socket.id < partnerId;
    createPeerConnection(isInitiator);
});

// 2. Signaling Data Event (WebRTC negotiation)
socket.on('signal', async (data) => {
    // If we receive a signal before the connection is fully initialized, initialize it as the answerer.
    if (!peerConnection && data.type === 'sdp-offer') {
        // Start local media here for the answerer if it hasn't started yet
        await startLocalMedia(); 
        createPeerConnection(false); // False because the person who sent the signal is the initiator
    }

    try {
        if (data.type === 'sdp-offer') {
            await createAnswer(data.payload);
        } else if (data.type === 'sdp-answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.payload));
            statusMessage.textContent = "Secure connection established, waiting for video...";
        } else if (data.type === 'ice-candidate') {
            if (data.payload) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.payload));
            }
        }
    } catch (error) {
        console.error("Error processing signal:", data.type, error);
    }
});

// 3. Waiting in Queue Event
socket.on('waiting-in-queue', () => {
    waitingMessage.classList.remove('hidden');
    statusMessage.textContent = "Searching for a partner... Worldwide priority first!";
});

// 4. Partner Dropped Event (Crucial Logic from server.js)
socket.on('partner-dropped', () => {
    console.log("SERVER ALERT: Partner disconnected unexpectedly. Starting auto-requeue.");
    
    // Clear the current connection state
    clearConnectionState();
    
    // Auto-requeue immediately
    requeueForMatch();
});


// --- UI Event Handlers ---

// 1. Handle Sign-up and Match Request
signupForm.addEventListener('submit', async (event) => {
    // 🛑 CRITICAL FIX: PREVENT DEFAULT FORM SUBMISSION/RELOAD 🛑
    event.preventDefault(); 
    console.log("Form submit intercepted. Starting video and matchmaking...");
    
    // Get user input from the form
    localUserData.username = document.getElementById('username').value.trim();
    localUserData.country = document.getElementById('country').value;

    if (localUserData.username && localUserData.country) {
        
        // ⭐️ FEATURE: Start local media (show video) immediately upon joining the queue
        await startLocalMedia();
        
        // Hide the form and show the waiting status
        lobbyView.classList.add('hidden');
        waitingMessage.classList.remove('hidden');

        // Send user data to the server for matchmaking
        socket.emit('start-matching', localUserData);

    } else {
        alert("Please enter your Name and select your Country to start.");
    }
});

// 2. Handle Manual Hang Up Button
hangupButton.addEventListener('click', () => {
    // ⭐️ FEATURE: Implement auto-requeue logic for manual hang-up
    
    // 1. Tell the server we are hanging up (so the partner is notified)
    if (partnerId) {
        socket.emit('user-hangup', { partnerId: partnerId });
    }
    
    // 2. Clear connection state (stops video feeds, etc.)
    clearConnectionState(); 
    
    // 3. Immediately requeue the user (using existing name/country)
    requeueForMatch();
});