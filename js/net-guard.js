// Net Guard - Internet Connection Monitor
// Black screen when internet is lost

function initNetGuard() {
    // Check on load
    checkConnection();

    // Browser native events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic check every 5 seconds
    setInterval(checkConnection, 5000);
}

function handleOffline() {
    console.log('NetGuard: Offline detected');
    showBlackScreen();
}

function handleOnline() {
    console.log('NetGuard: Online detected');
    // Verify with actual request
    checkConnection();
}

function checkConnection() {
    // First check navigator.onLine
    if (!navigator.onLine) {
        showBlackScreen();
        return;
    }

    // Double check with a small fetch request
    fetch('https://www.google.com/generate_204', { 
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store'
    })
    .then(() => {
        hideBlackScreen();
    })
    .catch(() => {
        // Try Firebase as backup
        checkFirebaseConnection();
    });
}

function checkFirebaseConnection() {
    // Try to reach Firebase
    fetch('https://firestore.googleapis.com/', {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store'
    })
    .then(() => {
        hideBlackScreen();
    })
    .catch(() => {
        showBlackScreen();
    });
}

function showBlackScreen() {
    const blackout = document.getElementById('blackout');
    if (blackout) {
        blackout.classList.add('active');
    }
}

function hideBlackScreen() {
    const blackout = document.getElementById('blackout');
    if (blackout) {
        blackout.classList.remove('active');
    }
}

// Prevent any interaction when offline
document.addEventListener('click', function(e) {
    if (!navigator.onLine) {
        e.preventDefault();
        e.stopPropagation();
        showBlackScreen();
    }
}, true);

// Prevent form submissions when offline
document.addEventListener('submit', function(e) {
    if (!navigator.onLine) {
        e.preventDefault();
        e.stopPropagation();
        showBlackScreen();
    }
}, true);
