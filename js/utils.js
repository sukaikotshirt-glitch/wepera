const Utils = {
    hexToBytes: function(hex) {
        if (!hex) return new Uint8Array();
        hex = hex.replace(/\s+/g, '').toUpperCase();
        return new Uint8Array(hex.match(/[\dA-F]{2}/gi).map(s => parseInt(s, 16)));
    },

    bytesToHex: function(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join('');
    },

    asciiToHex: function(str) {
        let hex = "";
        for (let i = 0; i < str.length; i++) {
            hex += str.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return hex.toUpperCase();
    },

    calculateFCS: function(hexStr) {
        const bytes = this.hexToBytes(hexStr);
        let fcs = 0xFFFF;
        const fcstab = [
            0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf, 0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
            0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e, 0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
            0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd, 0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
            0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c, 0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
            0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb, 0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
            0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a, 0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
            0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9, 0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
            0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738, 0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
            0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7, 0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cff,
            0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036, 0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
            0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5, 0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
            0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134, 0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
            0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3, 0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
            0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232, 0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
            0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1, 0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
            0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330, 0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78
        ];
        
        for (let i = 0; i < bytes.length; i++) {
            fcs = (fcs >> 8) ^ fcstab[(fcs ^ bytes[i]) & 0xFF];
        }
        fcs = fcs ^ 0xFFFF;
        
        return (fcs & 0xFF).toString(16).padStart(2, '0').toUpperCase() + 
               ((fcs >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
    },

    getDLMSTime: function(date) {
        const Y = date.getFullYear().toString(16).padStart(4, '0').toUpperCase();
        const M = (date.getMonth() + 1).toString(16).padStart(2, '0').toUpperCase();
        const D = date.getDate().toString(16).padStart(2, '0').toUpperCase();
        const h = date.getHours().toString(16).padStart(2, '0').toUpperCase();
        const m = date.getMinutes().toString(16).padStart(2, '0').toUpperCase();
        const s = date.getSeconds().toString(16).padStart(2, '0').toUpperCase();
        
        return `090C${Y}${M}${D}FF${h}${m}${s}FF800000`;
    },

    // ==================== EXTRACT PAYLOAD FROM TEMPLATE ====================
    extractPayloadFromTemplate: function(templateFrame) {
        if (!templateFrame || templateFrame.length < 20) {
            console.error("Invalid template frame");
            return null;
        }

        let frame = templateFrame.toUpperCase();
        
        // Only remove leading 7E (frame start flag)
        if (frame.startsWith("7E")) {
            frame = frame.substring(2);
        }
        
        // Only remove trailing 7E (frame end flag)
        if (frame.endsWith("7E")) {
            frame = frame.substring(0, frame.length - 2);
        }
        
        if (frame.length < 18) {
            console.error("Frame too short to extract payload");
            return null;
        }

        // Frame structure positions:
        // Format(4) + Addr(4) + Control(2) + HCS(4) + Payload(...) + FCS(4)
        let payloadStart = 14; // After format + addr + control + HCS
        let payloadEnd = frame.length - 4; // Before FCS
        
        let payload = frame.substring(payloadStart, payloadEnd);
        
        return payload;
    },

    // ==================== BUILD FRAME ====================
    buildFrame: function(payloadHex, requestHex) {
        if (!payloadHex || !requestHex) {
            console.error("Missing payload or request");
            return null;
        }

        // Only remove START and END 7E from request
        let reqClean = requestHex.toUpperCase();
        if (reqClean.startsWith("7E")) {
            reqClean = reqClean.substring(2);
        }
        if (reqClean.endsWith("7E")) {
            reqClean = reqClean.substring(0, reqClean.length - 2);
        }
        
        if (reqClean.length < 10) {
            console.error("Invalid request format");
            return null;
        }

        const reqControl = reqClean.substring(8, 10);
        
        // Calculate response control (request + 0x20)
        let respControlInt = parseInt(reqControl, 16) + 0x20;
        let respControl = (respControlInt & 0xFF).toString(16).padStart(2, '0').toUpperCase();
        
        // Handle LLC header
        let fullPayload = payloadHex.toUpperCase();
        
        // If payload doesn't start with LLC header, add it
        if (!fullPayload.startsWith("E6E700") && !fullPayload.startsWith("E6E7")) {
            fullPayload = "E6E700" + fullPayload;
        }
        
        let payloadBytes = fullPayload.length / 2;
        
        // Calculate total length
        let totalLength = 2 + 2 + 1 + 2 + payloadBytes + 2;
        
        // HDLC Format field: 0xA000 | (length & 0x7FF)
        // A0xx = 0-255, A1xx = 256-511, A2xx = 512-767, etc.
        let formatInt = 0xA000 | (totalLength & 0x7FF);
        let formatField = formatInt.toString(16).padStart(4, '0').toUpperCase();
        
        // Build header (Format + Dest + Src + Control)
        let destAddr = "41";
        let srcAddr = "03";
        let header = formatField + destAddr + srcAddr + respControl;
        
        // Calculate HCS (Header Check Sequence)
        let hcs = this.calculateFCS(header);
        
        // Build frame without final FCS
        let frameWithoutFCS = header + hcs + fullPayload;
        
        // Calculate final FCS
        let fcs = this.calculateFCS(frameWithoutFCS);
        
        // Return complete frame with flags
        return "7E" + frameWithoutFCS + fcs + "7E";
    }
};
