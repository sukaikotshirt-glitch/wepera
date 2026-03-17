// Auth Helper Functions for HRB Server

// Start server function (called from app.html)
async function startServer() {
    // Get UI values
    const currentLogic = window.CurrentLogic || Logic;
    
    currentLogic.uiValues = {
        serial: document.getElementById('val_serial').value || "0000000",
        kwh: parseFloat(document.getElementById('val_kwh').value) || 0,
        kvah: parseFloat(document.getElementById('val_kvah').value) || 0,
        md_kw: parseFloat(document.getElementById('val_md_kw').value) || 0,
        md_kva: parseFloat(document.getElementById('val_md_kva').value) || 0
    };
    
    // Validate values
    if (currentLogic.uiValues.kwh < 0) currentLogic.uiValues.kwh = 0;
    if (currentLogic.uiValues.kvah < 0) currentLogic.uiValues.kvah = 0;
    if (currentLogic.uiValues.md_kw < 0) currentLogic.uiValues.md_kw = 0;
    if (currentLogic.uiValues.md_kva < 0) currentLogic.uiValues.md_kva = 0;
    
    currentLogic.init();
    
    try {
        // Call Android USB connect
        Android.connectUSB();
        return true;
    } catch (error) {
        console.error('USB Connection Error:', error);
        return false;
    }
}

// Session tracking
let sessionStarted = false;

// Track session for credit deduction
function onSessionStart() {
    sessionStarted = true;
    console.log('Session started');
}

function onSessionEnd() {
    if (sessionStarted) {
        sessionStarted = false;
        console.log('Session ended - credit should be deducted');
    }
}
