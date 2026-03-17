const Logic = {
    currentMeter: null,
    uiValues: {},
    sessionData: {
        mdTimeCurrent: null, 
        datePrev: null,
        mdTimePrev: null,
        dateOld: null,
        mdTimeOld: null,
        dateArchive: null,
        mdTimeArchive: null
    },
    
    // ✅ AVON Password for validation
    AVON_PASSWORD: "48656c6c6f",  // "Hello" in hex
    
    // ✅ Session authentication flag
    isAuthenticated: false,

    init: function() {
        this.currentMeter = AVON_PROFILE; 
        this.isAuthenticated = false;  // Reset on init
        
        const now = new Date();

        let d1 = new Date(now);
        const currentDay = now.getDate();
        
        if (currentDay > 4) {
            d1.setDate(currentDay - (Math.floor(Math.random() * 3) + 1));
        } else {
            d1.setDate(Math.max(1, currentDay - Math.floor(Math.random() * 2)));
        }
        
        d1.setHours(Math.floor(Math.random() * 20) + 1);
        d1.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeCurrent = Utils.getDLMSTime(d1);

        let dPrev = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        this.sessionData.datePrev = Utils.getDLMSTime(dPrev);
        
        let dPrevMD = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        dPrevMD.setDate(5 + Math.floor(Math.random() * 20));
        dPrevMD.setHours(Math.floor(Math.random() * 20) + 1);
        dPrevMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimePrev = Utils.getDLMSTime(dPrevMD);

        let dOld = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        this.sessionData.dateOld = Utils.getDLMSTime(dOld);
        
        let dOldMD = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        dOldMD.setDate(5 + Math.floor(Math.random() * 20));
        dOldMD.setHours(Math.floor(Math.random() * 20) + 1);
        dOldMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeOld = Utils.getDLMSTime(dOldMD);

        let dArch = new Date(now.getFullYear() - 1, 0, 1);
        this.sessionData.dateArchive = Utils.getDLMSTime(dArch);

        let dArchMD = new Date(now.getFullYear() - 1, 11, 1);
        dArchMD.setDate(5 + Math.floor(Math.random() * 20));
        dArchMD.setHours(Math.floor(Math.random() * 20) + 1);
        dArchMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeArchive = Utils.getDLMSTime(dArchMD);
    },

    // ✅ VALIDATE AARQ PASSWORD
    validateAARQ: function(hexStr) {
        // Check if AVON password exists in AARQ
        // AVON Password: "Hello" = 48656c6c6f
        if (hexStr.toUpperCase().includes(this.AVON_PASSWORD.toUpperCase())) {
            return true;
        }
        return false;
    },

    processPacket: function(hexStr) {
        hexStr = hexStr.toUpperCase();
        const profile = this.currentMeter;
        
        // PURE STATIC - Connection aur Identification commands
        const pureStaticKeys = [
            "935A64",           // SNRM
            "5356A2",           // PORT CLOSE
            "E6E600C0018100070100620100FF07", // BILL_ENTRY Check
            "E6E600C0018100010000600101FF02", // MAKER NAME
            "E6E600C00181000100005E5B0BFF02", // FIRMWARE/CATEGORY
            "E6E600C00181000100005E5B09FF02"  // METER TYPE
        ];
        
        // ✅ AARQ CHECK - Password validation
        if (hexStr.includes("A041034110") || hexStr.includes("A044034110")) {
            if (this.validateAARQ(hexStr)) {
                this.isAuthenticated = true;
                // Return AARE success
                return profile.static_replies["A041034110"] || profile.static_replies["A044034110"];
            } else {
                this.isAuthenticated = false;
                // Return null or rejection - Don't respond
                return null;
            }
        }
        
        // ✅ SNRM - Always respond (before authentication)
        if (hexStr.includes("935A64")) {
            this.isAuthenticated = false;  // Reset auth on new connection
            return profile.static_replies["935A64"];
        }
        
        // ✅ DISC - Always respond
        if (hexStr.includes("5356A2")) {
            this.isAuthenticated = false;  // Reset auth on disconnect
            return profile.static_replies["5356A2"];
        }
        
        // ❌ ALL OTHER REQUESTS - Check authentication first
        if (!this.isAuthenticated) {
            return null;  // Not authenticated, don't respond
        }
        
        // Check static replies
        for (let key in profile.static_replies) {
            if (hexStr.includes(key)) {
                
                // Agar pure static list mein hai, toh seedha hardcoded return
                if (pureStaticKeys.includes(key)) {
                    return profile.static_replies[key];
                }
                
                // Baaki sab ko rebuild karo
                let staticFrame = profile.static_replies[key];
                
                // Extract payload from static template
                let payload = Utils.extractPayloadFromTemplate(staticFrame);
                
                if (!payload) {
                    console.error("Failed to extract payload from static reply for key:", key);
                    return staticFrame; // Fallback to original frame
                }
                
                // Build fresh frame with correct control field, HCS, FCS
                return Utils.buildFrame(payload, hexStr);
            }
        }
        
        // Check dynamic templates (universal approach)
        for (let key in profile.dynamic_templates) {
            if (hexStr.includes(key)) {
                return this.generateDynamic(profile.dynamic_templates[key], hexStr);
            }
        }
        
        return null; 
    },

    // ==================== UNIVERSAL APPROACH ====================
    generateDynamic: function(tmpl, requestHex) {
        
        // STEP 1: Get full template frame
        let fullFrame;
        
        // Handle both formats (template OR head/body/tail)
        if (tmpl.template) {
            // Standard template approach
            fullFrame = tmpl.template;
        } else if (tmpl.head && tmpl.body && tmpl.tail) {
            // INST special case - combine head/body/tail
            fullFrame = tmpl.head + tmpl.body + tmpl.tail;
        } else {
            console.error("Template format not recognized for type:", tmpl.type);
            return null;
        }
        
        // STEP 2: Inject values based on type (BEFORE extraction)
        switch(tmpl.type) {
            case "CLOCK":
                fullFrame = this.injectClock(fullFrame);
                break;
            case "METER_NO":
                fullFrame = this.injectSerial(fullFrame);
                break;
            case "INST":
                fullFrame = this.injectInstantValues(fullFrame, tmpl);
                break;
            case "BILL":
                fullFrame = this.injectBillValues(fullFrame, tmpl, requestHex);
                break;
        }
        
        // STEP 3: Extract payload (values already injected!)
        let payload = Utils.extractPayloadFromTemplate(fullFrame);
        
        if (!payload) {
            console.error("Failed to extract payload from frame");
            return null;
        }
        
        // STEP 4: Build fresh frame with proper checksums
        return Utils.buildFrame(payload, requestHex);
    },

    // ==================== INJECTION HELPERS ====================
    
    injectClock: function(frame) {
        const now = new Date();
        const newTime = Utils.getDLMSTime(now);
        
        // Find and replace old time pattern (090C...)
        const timePattern = /090C[0-9A-F]{24}/;
        
        return frame.replace(timePattern, newTime);
    },

    injectSerial: function(frame) {
        let serial = this.uiValues.serial.toString().trim();
        serial = serial.replace(/[^A-Za-z0-9]/g, '');
        
        if (!serial || serial.length === 0) {
            serial = "0000000";
        }
        
        if (serial.length > 11) {
            serial = serial.substring(0, 11);
        }
        
        let hasLetters = /[A-Za-z]/.test(serial);
        
        let hexSerial = "";
        for (let i = 0; i < serial.length; i++) {
            hexSerial += serial.charCodeAt(i).toString(16).padStart(2, '0');
        }
        hexSerial = hexSerial.toUpperCase();
        
        let lengthByte = serial.length.toString(16).padStart(2, '0').toUpperCase();
        let newSerialBlock = "09" + lengthByte + hexSerial;
        
        // Find existing serial pattern (09 + length + hex chars)
        const serialPattern = /09[0-9A-F]{2}[0-9A-F]{10,22}/;
        
        return frame.replace(serialPattern, newSerialBlock);
    },

    injectInstantValues: function(frame, tmpl) {
        // Get user values
        const vKwh = Math.floor(this.uiValues.kwh * 100);
        const vKvah = Math.floor(this.uiValues.kvah * 100);
        const md_kw = Math.floor(this.uiValues.md_kw * 100);
        const md_kva = Math.floor(this.uiValues.md_kva * 100);
        
        // Current time
        const nowTime = Utils.getDLMSTime(new Date());
        const mdTime = this.sessionData.mdTimeCurrent;
        
        // Position-based injection using head/body/tail + clock
        if (tmpl.head && tmpl.body && tmpl.tail) {
            const replaceAt = (str, index, replacement) => {
                return str.substring(0, index) + replacement + str.substring(index + replacement.length);
            };
            
            let kwh = "06" + vKwh.toString(16).padStart(8, '0').toUpperCase();
            let kvah = "06" + vKvah.toString(16).padStart(8, '0').toUpperCase();
            let mdKwHex = "12" + md_kw.toString(16).padStart(4, '0').toUpperCase();
            let mdKvaHex = "12" + md_kva.toString(16).padStart(4, '0').toUpperCase();
            
            // Build full frame: head + CLOCK + body + tail
            frame = tmpl.head + nowTime + tmpl.body + tmpl.tail;
            
            // Inject at correct positions using inst_idxs
            if (tmpl.inst_idxs) {
                frame = replaceAt(frame, tmpl.inst_idxs.kwh, kwh);
                frame = replaceAt(frame, tmpl.inst_idxs.kvah, kvah);
                frame = replaceAt(frame, tmpl.inst_idxs.md_kw, mdKwHex);
                frame = replaceAt(frame, tmpl.inst_idxs.md_kw_t, mdTime);
                frame = replaceAt(frame, tmpl.inst_idxs.md_kva, mdKvaHex);
                frame = replaceAt(frame, tmpl.inst_idxs.md_kva_t, mdTime);
            }
            
            return frame;
        }
    },

    injectBillValues: function(frame, tmpl, requestHex) {
        const now = new Date();
        
        // Detect subtype from request
        let subtype = "HISTORY"; // Default
        
        if (requestHex.includes("0201020204060000000106000000021200011200")) {
            subtype = "LATEST";
        } else if (requestHex.includes("0201020204060000000C060000000D1200011200")) {
            subtype = "HISTORY";
        }
        
        // Helper functions
        const replaceAt = (str, index, replacement) => {
            if(!index) return str;
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        const toHex = (val, multiplier) => "06" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        const toHexMD = (val, multiplier) => "12" + Math.floor(val * multiplier).toString(16).padStart(4, '0').toUpperCase();
        
        const getZones = (val) => {
            let z1 = Math.floor(val * 0.25);
            let z2 = Math.floor(val * 0.15);
            let z3 = Math.floor(val * 0.40);
            let z4 = Math.floor(val - (z1 + z2 + z3));
            return { z1, z2, z3, z4 };
        };

        // Calculate values
        const vCurKwh = this.uiValues.kwh;
        const vCurKvah = this.uiValues.kvah;
        const vCurMd = this.uiValues.md_kw;
        const vCurMdKva = this.uiValues.md_kva;
        const zCurKwh = getZones(vCurKwh);
        const zCurKvah = getZones(vCurKvah);

        const vPrevKwh = this.uiValues.kwh - 50;
        const vPrevKvah = this.uiValues.kvah - 60;
        const vPrevMd = this.uiValues.md_kw - 0.2;
        const vPrevMdKva = this.uiValues.md_kva - 0.2;
        const zPrevKwh = getZones(vPrevKwh);
        const zPrevKvah = getZones(vPrevKvah);

        const vArchKwh = this.uiValues.kwh - 500; 
        const vArchKvah = this.uiValues.kvah - 600;
        const zArchKwh = getZones(vArchKwh);
        const zArchKvah = getZones(vArchKvah);

        // Inject values at positions
        if (subtype === "LATEST") {
            frame = replaceAt(frame, tmpl.idxs.b1_date, Utils.getDLMSTime(now));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vCurKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vCurKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vCurMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vCurMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zCurKwh.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zCurKwh.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zCurKwh.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zCurKwh.z4, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zCurKvah.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zCurKvah.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zCurKvah.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zCurKvah.z4, 1000));

            frame = replaceAt(frame, tmpl.idxs.b2_date, this.sessionData.dateArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_md_t, this.sessionData.mdTimeArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva_t, this.sessionData.mdTimeArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_kwh, toHex(vArchKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_kvah, toHex(vArchKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_z1, toHex(zArchKwh.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_z2, toHex(zArchKwh.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_z3, toHex(zArchKwh.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_z4, toHex(zArchKwh.z4, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz1, toHex(zArchKvah.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz2, toHex(zArchKvah.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz3, toHex(zArchKvah.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz4, toHex(zArchKvah.z4, 1000));

        } else {
            // HISTORY
            frame = replaceAt(frame, tmpl.idxs.b1_date, this.sessionData.datePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vPrevKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vPrevKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zPrevKwh.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zPrevKwh.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zPrevKwh.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zPrevKwh.z4, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zPrevKvah.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zPrevKvah.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zPrevKvah.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zPrevKvah.z4, 1000));

            frame = replaceAt(frame, tmpl.idxs.b2_date, this.sessionData.dateOld);
            frame = replaceAt(frame, tmpl.idxs.b2_md_t, this.sessionData.mdTimeOld);
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva_t, this.sessionData.mdTimeOld);
            frame = replaceAt(frame, tmpl.idxs.b2_kwh, toHex(vPrevKwh - 50, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_kvah, toHex(vPrevKvah - 60, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_z1, toHex(zPrevKwh.z1, 1000)); 
            frame = replaceAt(frame, tmpl.idxs.b2_z2, toHex(zPrevKwh.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_z3, toHex(zPrevKwh.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_z4, toHex(zPrevKwh.z4, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz1, toHex(zPrevKvah.z1, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz2, toHex(zPrevKvah.z2, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz3, toHex(zPrevKvah.z3, 1000));
            frame = replaceAt(frame, tmpl.idxs.b2_kz4, toHex(zPrevKvah.z4, 1000));
        }
        
        return frame;
    }
};
