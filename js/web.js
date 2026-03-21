// ========== STATE VARIABLES ==========
let isUsbConnected = false;
let isServerRunning = false;
let isReconnecting = false;
let currentUser = null;
let userCredits = 0;
let dailyLimit = 40;
let dailyUsed = 0;
let lastResetDate = "";
let creditDeductedThisSession = false;

// USB monitoring
let lastDataTime = 0;
let usbHealthCheckInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Default = AVON
var CurrentLogic = Logic;

// ========== FIREBASE INIT ==========
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Check authentication
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        await loadUserData();
        if (userCredits <= 0) {
            await auth.signOut();
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

// ========== USER DATA ==========
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

async function loadUserData() {
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            userCredits = data.credits || 0;
            dailyLimit = data.dailyLimit || 40;
            dailyUsed = data.dailyUsed || 0;
            lastResetDate = data.lastResetDate || "";

            const today = getTodayDate();
            if (lastResetDate !== today) {
                dailyUsed = 0;
                lastResetDate = today;
                await db.collection('users').doc(currentUser.uid).update({
                    dailyUsed: 0,
                    lastResetDate: today
                });
            }
            updateCreditsDisplay();
        }
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

function updateCreditsDisplay() {
    const totalDisplay = document.getElementById('creditsDisplay');
    const dailyDisplay = document.getElementById('dailyDisplay');
    
    totalDisplay.textContent = `Credits: ${userCredits}`;
    totalDisplay.classList.remove('low', 'critical');
    if (userCredits <= 10) totalDisplay.classList.add('critical');
    else if (userCredits <= 50) totalDisplay.classList.add('low');

    const remaining = dailyLimit - dailyUsed;
    dailyDisplay.textContent = `Today: ${dailyUsed}/${dailyLimit}`;
    dailyDisplay.classList.remove('warning', 'exhausted');
    if (remaining <= 0) dailyDisplay.classList.add('exhausted');
    else if (remaining <= 5) dailyDisplay.classList.add('warning');
}

function canUseCredit() {
    if (userCredits <= 0) return { allowed: false, reason: "Subscription Expired" };
    if (dailyUsed >= dailyLimit) return { allowed: false, reason: "Daily limit reached!" };
    return { allowed: true, reason: "" };
}

async function deductCredit() {
    if (!currentUser) {
        log('❌ No user logged in', 'error');
        return false;
    }

    if (creditDeductedThisSession) {
        log('⚠️ Credit already deducted this session', 'warning');
        return false;
    }

    const check = canUseCredit();
    if (!check.allowed) {
        showToast(check.reason, 'error');
        log(`❌ ${check.reason}`, 'error');
        
        if (check.reason === "Subscription Expired") {
            setTimeout(async () => {
                await auth.signOut();
                window.location.href = 'index.html';
            }, 2000);
        }
        return false;
    }

    try {
        const today = getTodayDate();
        
        await db.collection('users').doc(currentUser.uid).update({
            credits: firebase.firestore.FieldValue.increment(-1),
            dailyUsed: firebase.firestore.FieldValue.increment(1),
            lastResetDate: today,
            lastReading: firebase.firestore.FieldValue.serverTimestamp()
        });

        userCredits--;
        dailyUsed++;
        updateCreditsDisplay();
        showToast(`💳 Credit Used | Today: ${dailyUsed}/${dailyLimit} | Total: ${userCredits}`, 'success');
        log(`💳 Credit Deducted - Today: ${dailyUsed}/${dailyLimit} | Total: ${userCredits}`, 'credit');

        if (userCredits <= 0) {
            log('⚠️ Credits exhausted! Logging out...', 'error');
            setTimeout(async () => {
                await auth.signOut();
                window.location.href = 'index.html';
            }, 2000);
        }
        
        return true;

    } catch (error) {
        console.error('Error deducting credit:', error);
        log('❌ Credit deduction failed - check internet', 'error');
        return false;
    }
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('creditToast');
    toast.textContent = message;
    toast.classList.remove('error', 'warning');
    if (type === 'error') toast.classList.add('error');
    if (type === 'warning') toast.classList.add('warning');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function logout() {
    stopUsbHealthCheck();
    try {
        // अगर USB connected है तो उसे disconnect करें
        if (isUsbConnected) {
            try { Android.disconnect(); } catch(e) {}
        }
        await auth.signOut();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ========== USB FUNCTIONS ==========
function toggleUsb() {
    if (isReconnecting) {
        log('⏳ Reconnection in progress...', 'warning');
        return;
    }
    
    if (isUsbConnected) {
        disconnectUsb();
    } else {
        connectUsb();
    }
}

function connectUsb() {
    log('🔌 Connecting USB...', 'info');
    updateUsbStatus('connecting');
    
    try {
        // Android native method call
        if (typeof Android !== 'undefined' && Android.connectUSB) {
            Android.connectUSB();
        } else {
            log('❌ Android bridge not available', 'error');
            updateUsbStatus('disconnected');
            showToast('USB not available in browser', 'error');
        }
    } catch(e) {
        log('❌ USB connection failed', 'error');
        updateUsbStatus('disconnected');
    }
}

function disconnectUsb() {
    if (isServerRunning) {
        stopServer();
    }
    
    stopUsbHealthCheck();
    
    try {
        if (typeof Android !== 'undefined' && Android.disconnect) {
            Android.disconnect();
        }
    } catch(e) {}
    
    isUsbConnected = false;
    isReconnecting = false;
    reconnectAttempts = 0;
    updateUsbStatus('disconnected');
    updateServerButton();
    log('🔌 USB Disconnected', 'warning');
}

function updateUsbStatus(status) {
    const card = document.getElementById('usbStatusCard');
    const dot = document.getElementById('usbDot');
    const text = document.getElementById('usbStatusText');
    const sub = document.getElementById('usbStatusSub');
    const signal = document.getElementById('usbSignal');
    const btn = document.getElementById('btnUsb');

    card.classList.remove('connected', 'reconnecting');
    dot.classList.remove('connected', 'reconnecting');
    btn.classList.remove('connected', 'reconnecting');

    switch(status) {
        case 'connected':
            card.classList.add('connected');
            dot.classList.add('connected');
            btn.classList.add('connected');
            text.textContent = '✅ USB Connected';
            sub.textContent = 'CH340 Serial • 9600 baud';
            signal.textContent = '● Active';
            signal.style.color = '#22c55e';
            btn.textContent = '🔌 DISCONNECT USB';
            break;
            
        case 'reconnecting':
            card.classList.add('reconnecting');
            dot.classList.add('reconnecting');
            btn.classList.add('reconnecting');
            text.textContent = '🔄 Reconnecting...';
            sub.textContent = `Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`;
            signal.textContent = '● Weak';
            signal.style.color = '#f97316';
            btn.textContent = '⏳ RECONNECTING...';
            break;
            
        case 'connecting':
            text.textContent = '🔌 Connecting...';
            sub.textContent = 'Please wait';
            signal.textContent = '';
            btn.textContent = '⏳ CONNECTING...';
            break;
            
        case 'disconnected':
        default:
            card.classList.remove('connected', 'reconnecting');
            dot.classList.remove('connected', 'reconnecting');
            text.textContent = '❌ USB Not Connected';
            sub.textContent = 'Connect USB OTG cable to begin';
            signal.textContent = '—';
            btn.textContent = '🔌 CONNECT USB';
            break;
    }
}

// ========== USB HEALTH CHECK ==========
function startUsbHealthCheck() {
    stopUsbHealthCheck();
    
    lastDataTime = Date.now();
    
    usbHealthCheckInterval = setInterval(() => {
        if (!isUsbConnected || !isServerRunning) return;
        
        const timeSinceData = Date.now() - lastDataTime;
        const signal = document.getElementById('usbSignal');
        
        if (timeSinceData < 5000) {
            signal.textContent = '● Active';
            signal.style.color = '#22c55e';
        } else if (timeSinceData < 15000) {
            signal.textContent = '● Idle';
            signal.style.color = '#64748b';
        } else {
            signal.textContent = '● Waiting...';
            signal.style.color = '#f97316';
        }
    }, 2000);
}

function stopUsbHealthCheck() {
    if (usbHealthCheckInterval) {
        clearInterval(usbHealthCheckInterval);
        usbHealthCheckInterval = null;
    }
}

// ========== USB AUTO RECONNECT ==========
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        log('❌ Reconnection failed after ' + MAX_RECONNECT_ATTEMPTS + ' attempts', 'error');
        showToast('USB Connection Lost - Please reconnect manually', 'error');
        isReconnecting = false;
        reconnectAttempts = 0;
        updateUsbStatus('disconnected');
        updateServerButton();
        return;
    }
    
    reconnectAttempts++;
    isReconnecting = true;
    updateUsbStatus('reconnecting');
    log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`, 'warning');
    
    setTimeout(() => {
        try {
            if (typeof Android !== 'undefined' && Android.connectUSB) {
                Android.connectUSB();
            }
        } catch(e) {
            onUsbError("Reconnection failed");
        }
    }, 2000);
}

// ========== SERVER FUNCTIONS ==========
function toggleServer() {
    if (!isUsbConnected) {
        log('⚠️ Connect USB first!', 'warning');
        showToast('Connect USB first!', 'warning');
        return;
    }

    if (isServerRunning) {
        stopServer();
    } else {
        startServer();
    }
}

function startServer() {
    const check = canUseCredit();
    if (!check.allowed) {
        showToast(check.reason, 'error');
        log(`❌ ${check.reason}`, 'error');
        return;
    }

    creditDeductedThisSession = false;

    const meterType = document.getElementById('meterSelect').value;
    if (meterType === 'avon') {
        CurrentLogic = Logic;
    } else if (meterType === 'avon2') {
        CurrentLogic = Logic_Avon2;
    } else if (meterType === 'hpl') {
        CurrentLogic = Logic_HPL;
    } else if (meterType === 'genus') {
        CurrentLogic = Logic_Genus;
    } else {
        CurrentLogic = Logic_MT;
    }

    if (CurrentLogic && CurrentLogic.init) {
        CurrentLogic.init();
    }
    
    updateUIValues();

    isServerRunning = true;
    updateServerButton();
    updateServerStatus();
    lockConfig(true);
    startUsbHealthCheck();

    const meterName = meterType.toUpperCase();
    log(`▶️ Server Started (${meterName})`, 'success');
    log('📡 Waiting for meter reading request...', 'info');
}

function stopServer() {
    isServerRunning = false;
    creditDeductedThisSession = false;
    
    stopUsbHealthCheck();
    updateServerButton();
    updateServerStatus();
    lockConfig(false);
    log('⏹️ Server Stopped', 'warning');
}

function updateServerButton() {
    const btn = document.getElementById('btnServer');
    btn.classList.remove('ready', 'running');

    if (!isUsbConnected) {
        btn.textContent = '▶️ START SERVER';
        btn.classList.remove('ready', 'running');
    } else if (isServerRunning) {
        btn.textContent = '⏹️ STOP SERVER';
        btn.classList.add('running');
    } else {
        btn.textContent = '▶️ START SERVER';
        btn.classList.add('ready');
    }
}

function updateServerStatus() {
    const status = document.getElementById('serverStatus');
    const text = document.getElementById('serverStatusText');
    
    status.classList.remove('running');
    
    if (isServerRunning) {
        status.classList.add('running');
        text.textContent = '🟢 Server Running - Ready for Reading';
    } else {
        text.textContent = 'Server Stopped';
    }
}

function lockConfig(lock) {
    const inputs = document.querySelectorAll('#configPanel input, #configPanel select');
    inputs.forEach(el => el.disabled = lock);
}

function updateUIValues() {
    if (!CurrentLogic) return;
    
    CurrentLogic.uiValues = CurrentLogic.uiValues || {};
    CurrentLogic.uiValues.serial = document.getElementById('val_serial').value || "0000000";
    CurrentLogic.uiValues.kwh = parseFloat(document.getElementById('val_kwh').value) || 0;
    CurrentLogic.uiValues.kvah = parseFloat(document.getElementById('val_kvah').value) || 0;
    CurrentLogic.uiValues.md_kw = parseFloat(document.getElementById('val_md_kw').value) || 0;
    CurrentLogic.uiValues.md_kva = parseFloat(document.getElementById('val_md_kva').value) || 0;
}

// ========== LOGGING ==========
function log(msg, type = '') {
    const box = document.getElementById('logBox');
    if (!box) return;
    
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="time">[${time}]</span> ${msg}`;
    
    box.appendChild(entry);
    box.scrollTop = box.scrollHeight;
    
    while (box.children.length > 100) {
        box.removeChild(box.firstChild);
    }
}

function clearLogs() {
    const box = document.getElementById('logBox');
    if (box) {
        box.innerHTML = '';
        log('📜 Logs cleared', 'info');
    }
}

// ========== ANDROID CALLBACKS ==========
// ये functions Android native code से call होंगे

// ✅ USB Connected Successfully - यह तभी call होगा जब असली USB OTG कनेक्ट हो
function onConnected(message) {
    isUsbConnected = true;
    isReconnecting = false;
    reconnectAttempts = 0;
    updateUsbStatus('connected');
    updateServerButton();
    log('✅ USB Connected Successfully', 'success');
    showToast('USB Connected', 'success');
    
    // वाइब्रेट करें (अगर available हो)
    try { if (typeof Android !== 'undefined' && Android.vibrate) Android.vibrate(100); } catch(e) {}
}

// ✅ USB Attached (Plugged in) - जब USB OTG केबल लगाई जाए
function onUsbAttached() {
    log('🔌 USB OTG Cable Detected', 'info');
    showToast('USB Detected - Connecting...', 'success');
    
    // ऑटो-कनेक्ट
    setTimeout(() => {
        if (!isUsbConnected) {
            connectUsb();
        }
    }, 500);
}

// ✅ USB Detached (Unplugged) - जब USB OTG केबल हटाई जाए
function onUsbDetached() {
    log('⚠️ USB OTG Cable Disconnected!', 'error');
    showToast('USB Disconnected!', 'error');
    
    const wasRunning = isServerRunning;
    
    isUsbConnected = false;
    isServerRunning = false;
    updateUsbStatus('disconnected');
    updateServerButton();
    updateServerStatus();
    stopUsbHealthCheck();
    
    // वाइब्रेट करें
    try { if (typeof Android !== 'undefined' && Android.vibrate) Android.vibrate(200); } catch(e) {}
    
    if (wasRunning) {
        log('⏹️ Server stopped due to USB disconnect', 'warning');
    }
}

// ✅ USB Error
function onUsbError(errorMessage) {
    log(`❌ USB Error: ${errorMessage}`, 'error');
    
    if (isUsbConnected && !isReconnecting) {
        isUsbConnected = false;
        attemptReconnect();
    } else if (isReconnecting) {
        setTimeout(attemptReconnect, 2000);
    } else {
        updateUsbStatus('disconnected');
        showToast('USB Connection Failed', 'error');
    }
}

// ✅ USB Permission Denied
function onUsbPermissionDenied() {
    log('❌ USB Permission Denied - Please allow access', 'error');
    showToast('Please allow USB access!', 'error');
    updateUsbStatus('disconnected');
}

// ✅ Data received from meter reading app
function onDataReceived(hexData) {
    if (!isServerRunning) return;
    
    lastDataTime = Date.now();

    // Detect request type
    if (hexData.includes("935A64")) {
        log('🔄 Connection request received...', 'info');
    } else if (hexData.includes("A041034110") || hexData.includes("A044034110")) {
        log('🔄 Authentication in progress...', 'info');
    } else if (hexData.includes("0100010800")) {
        log('📊 Reading meter clock...', 'info');
    } else if (hexData.includes("0100600100")) {
        log('📊 Reading meter serial...', 'info');
    } else if (hexData.includes("0201020204")) {
        log('📊 Reading billing data...', 'info');
        
        // क्रेडिट deduct करें
        if (!creditDeductedThisSession) {
            const success = deductCredit();
            if (success !== false) {
                creditDeductedThisSession = true;
            }
        }
    } else if (hexData.includes("0100010700") || hexData.includes("0100030700")) {
        log('📊 Reading instant values...', 'info');
    } else if (hexData.includes("5356A2")) {
        log('✅ Reading Complete!', 'success');
        // वाइब्रेट करें
        try { if (typeof Android !== 'undefined' && Android.vibrate) Android.vibrate(100); } catch(e) {}
    }

    // Process and send response
    if (CurrentLogic && CurrentLogic.processPacket) {
        const reply = CurrentLogic.processPacket(hexData);
        if (reply) {
            setTimeout(() => {
                try {
                    if (typeof Android !== 'undefined' && Android.sendData) {
                        Android.sendData(reply);
                        log(`📤 Response sent`, 'info');
                    }
                } catch(e) {
                    log('❌ Failed to send response', 'error');
                }
            }, 50);
        }
    }
}

// General log from Java
function onLog(message) {
    // Filter out technical messages
    if (message.includes("RX:") || message.includes("TX:")) return;
    if (message.includes("hex") || message.includes("byte")) return;
    
    if (message.includes("error") || message.includes("Error")) {
        log(`❌ ${message}`, 'error');
    }
}

// ========== INIT ==========
window.onload = function() {
    if (typeof Logic !== 'undefined') {
        CurrentLogic = Logic;
        if (CurrentLogic.init) {
            CurrentLogic.init();
        }
    }
    
    updateUsbStatus('disconnected');
    updateServerStatus();
    
    if (typeof initNetGuard === 'function') {
        initNetGuard();
    }
    
    log('🚀 WEBPERA Ready to use', 'success');
    log('📱 Connect USB OTG cable to begin', 'info');
    
    // चेक करें कि Android ब्रिज उपलब्ध है या नहीं
    if (typeof Android === 'undefined') {
        log('⚠️ Running in browser mode - USB will not work', 'warning');
        log('📱 Please use Android app for USB connectivity', 'warning');
    }
};