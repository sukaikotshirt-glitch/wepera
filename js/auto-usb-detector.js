// ========== AUTO USB DEVICE DETECTOR ==========
// Ye file automatically detect karegi ki CH340 hai ya FT232R

let activeUsbHandler = null;
let currentDeviceType = null;
let isDetecting = false;

// USB Device IDs
const USB_IDS = {
    CH340: { vendor: '1A86', products: ['7523', '5523'] },
    FT232R: { vendor: '0403', products: ['6001', '6015'] }
};

// Function to detect USB device type from Android
function detectUsbDevice() {
    return new Promise((resolve) => {
        try {
            if (typeof Android === 'undefined') {
                console.log('Android bridge not available');
                resolve('CH340'); // Default to CH340
                return;
            }

            // Check if device already connected
            if (Android.getConnectedDeviceType) {
                const deviceType = Android.getConnectedDeviceType();
                if (deviceType === 'FT232R') {
                    resolve('FT232R');
                } else {
                    resolve('CH340');
                }
                return;
            }
            
            // Try to get device info
            if (Android.getDeviceVendorId) {
                const vendorId = Android.getDeviceVendorId();
                const productId = Android.getDeviceProductId();
                
                if (vendorId === '0403' && (productId === '6001' || productId === '6015')) {
                    resolve('FT232R');
                } else {
                    resolve('CH340');
                }
                return;
            }
            
            // Default to CH340 if can't detect
            resolve('CH340');
            
        } catch(e) {
            console.error('Detection error:', e);
            resolve('CH340');
        }
    });
}

// Function to load appropriate USB handler
async function loadUsbHandler(deviceType) {
    return new Promise((resolve, reject) => {
        // Remove existing handlers
        if (activeUsbHandler) {
            try {
                if (activeUsbHandler.disconnectUsb) {
                    activeUsbHandler.disconnectUsb();
                }
            } catch(e) {}
        }
        
        // Clear global USB functions
        const usbFunctions = ['toggleUsb', 'connectUsb', 'disconnectUsb', 'updateUsbStatus', 
                              'startUsbHealthCheck', 'stopUsbHealthCheck', 'attemptReconnect',
                              'onConnected', 'onUsbAttached', 'onUsbDetached', 'onUsbError', 
                              'onUsbPermissionDenied', 'onDataReceived', 'onLog', 'toggleServer',
                              'startServer', 'stopServer', 'updateServerButton', 'updateServerStatus'];
        
        usbFunctions.forEach(fn => {
            if (window[fn]) {
                delete window[fn];
            }
        });
        
        // Choose script based on device type
        let scriptSrc = deviceType === 'FT232R' ? 'js/FT232R.js' : 'js/CH340.js';
        
        console.log(`🔄 Loading ${deviceType} handler...`);
        
        // Remove existing script if present
        const oldScript = document.querySelector(`script[src="${scriptSrc}"]`);
        if (oldScript) {
            oldScript.remove();
        }
        
        // Load new script
        const script = document.createElement('script');
        script.src = scriptSrc;
        script.onload = () => {
            console.log(`✅ ${deviceType} handler loaded successfully`);
            
            // Store active handler references
            activeUsbHandler = {
                toggleUsb: window.toggleUsb,
                connectUsb: window.connectUsb,
                disconnectUsb: window.disconnectUsb,
                toggleServer: window.toggleServer,
                startServer: window.startServer,
                stopServer: window.stopServer,
                updateUsbStatus: window.updateUsbStatus,
                onConnected: window.onConnected,
                onUsbDetached: window.onUsbDetached,
                onUsbError: window.onUsbError,
                onDataReceived: window.onDataReceived
            };
            
            resolve();
        };
        script.onerror = () => {
            console.error(`❌ Failed to load ${deviceType} handler`);
            reject(new Error(`Failed to load ${scriptSrc}`));
        };
        
        document.head.appendChild(script);
    });
}

// Main USB toggle function - Ye button click pe call hoga
window.toggleUsb = async function() {
    console.log('🔌 USB button clicked - detecting device...');
    
    // Agar already connected hai to disconnect karo
    if (activeUsbHandler && window.isUsbConnected === true) {
        if (activeUsbHandler.disconnectUsb) {
            activeUsbHandler.disconnectUsb();
        }
        return;
    }
    
    // Detect device type
    if (!isDetecting) {
        isDetecting = true;
        
        // Show detecting status
        const btnUsb = document.getElementById('btnUsb');
        const originalText = btnUsb.textContent;
        btnUsb.textContent = '🔍 DETECTING...';
        btnUsb.disabled = true;
        
        try {
            // Detect device
            const deviceType = await detectUsbDevice();
            currentDeviceType = deviceType;
            console.log(`🎯 Device detected: ${deviceType}`);
            
            // Load appropriate handler
            await loadUsbHandler(deviceType);
            
            // Connect after loading
            setTimeout(() => {
                if (activeUsbHandler && activeUsbHandler.connectUsb) {
                    activeUsbHandler.connectUsb();
                }
            }, 100);
            
        } catch(error) {
            console.error('Detection failed:', error);
            // Fallback to CH340
            await loadUsbHandler('CH340');
            setTimeout(() => {
                if (activeUsbHandler && activeUsbHandler.connectUsb) {
                    activeUsbHandler.connectUsb();
                }
            }, 100);
        } finally {
            btnUsb.textContent = originalText;
            btnUsb.disabled = false;
            isDetecting = false;
        }
    }
};

// Server toggle wrapper
window.toggleServer = function() {
    if (activeUsbHandler && activeUsbHandler.toggleServer) {
        activeUsbHandler.toggleServer();
    } else {
        console.log('Please connect USB first');
        if (typeof showToast === 'function') {
            showToast('Please connect USB first!', 'warning');
        }
    }
};

// Android bridge callbacks wrapper
window.onConnected = function(message) {
    if (activeUsbHandler && activeUsbHandler.onConnected) {
        activeUsbHandler.onConnected(message);
    }
};

window.onUsbAttached = function() {
    console.log('USB device attached');
    // Auto connect when USB is plugged
    setTimeout(() => {
        if (!window.isUsbConnected && window.toggleUsb) {
            window.toggleUsb();
        }
    }, 500);
};

window.onUsbDetached = function() {
    if (activeUsbHandler && activeUsbHandler.onUsbDetached) {
        activeUsbHandler.onUsbDetached();
    }
};

window.onUsbError = function(errorMessage) {
    if (activeUsbHandler && activeUsbHandler.onUsbError) {
        activeUsbHandler.onUsbError(errorMessage);
    }
};

window.onUsbPermissionDenied = function() {
    if (activeUsbHandler && activeUsbHandler.onUsbPermissionDenied) {
        activeUsbHandler.onUsbPermissionDenied();
    } else if (typeof showToast === 'function') {
        showToast('USB Permission Denied!', 'error');
    }
};

window.onDataReceived = function(hexData) {
    if (activeUsbHandler && activeUsbHandler.onDataReceived) {
        activeUsbHandler.onDataReceived(hexData);
    }
};

window.onLog = function(message) {
    if (activeUsbHandler && activeUsbHandler.onLog) {
        activeUsbHandler.onLog(message);
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Auto USB Detector initialized');
    console.log('📱 Ready to detect CH340 or FT232R devices');
    
    // Default to CH340 initially
    loadUsbHandler('CH340').catch(console.error);
});