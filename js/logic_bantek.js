const logic_bantek = {
    currentMeter: null,
    uiValues: {},
    sessionData: {
        mdTimeCurrent: null, 
        dateLatestB2: null,
        mdTimeLatestB2: null,
        dateHistB1: null,
        mdTimeHistB1: null,
        dateHistB2: null,
        mdTimeHistB2: null
    },
    
    pendingBillFrame2: null,
    
    // ✅ Bantek Password for validation
    Bantek_PASSWORD: "3131313131313131",  // "11111111" in hex
    
    // ✅ Session authentication flag
    isAuthenticated: false,

    init: function() {
        this.currentMeter = Bantek_PROFILE; 
        this.isAuthenticated = false;  // Reset on init
        
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

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

        let dLatestB2 = new Date(currentYear, currentMonth, 1);
        this.sessionData.dateLatestB2 = Utils.getDLMSTime(dLatestB2);
        
        let dLatestB2MD = new Date(currentYear, currentMonth - 1, 5 + Math.floor(Math.random() * 20));
        dLatestB2MD.setHours(Math.floor(Math.random() * 20) + 1);
        dLatestB2MD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeLatestB2 = Utils.getDLMSTime(dLatestB2MD);

        let dHistB1 = new Date(currentYear, currentMonth - 10, 1);
        this.sessionData.dateHistB1 = Utils.getDLMSTime(dHistB1);
        
        let dHistB1MD = new Date(currentYear, currentMonth - 11, 5 + Math.floor(Math.random() * 20));
        dHistB1MD.setHours(Math.floor(Math.random() * 20) + 1);
        dHistB1MD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeHistB1 = Utils.getDLMSTime(dHistB1MD);

        let dHistB2 = new Date(currentYear, currentMonth - 11, 1);
        this.sessionData.dateHistB2 = Utils.getDLMSTime(dHistB2);
        
        let dHistB2MD = new Date(currentYear, currentMonth - 12, 5 + Math.floor(Math.random() * 20));
        dHistB2MD.setHours(Math.floor(Math.random() * 20) + 1);
        dHistB2MD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeHistB2 = Utils.getDLMSTime(dHistB2MD);
        
        this.pendingBillFrame2 = null;
    },

    // ✅ VALIDATE AARQ PASSWORD
    validateAARQ: function(hexStr) {
        // Check if Bantek password exists in AARQ
        // Bantek Password: "11111111" = 3131313131313131
        if (hexStr.toUpperCase().includes(this.Bantek_PASSWORD.toUpperCase())) {
            return true;
        }
        return false;
    },

    processPacket: function(hexStr) {
        hexStr = hexStr.toUpperCase();
        const profile = this.currentMeter;
        
        // Bantek SPECIFIC: Check for NEXT FRAME request first
        if (hexStr.includes("E6E600C00281000000")) {
            if (!this.isAuthenticated) return null;  // ❌ Not authenticated
            
            if (this.pendingBillFrame2) {
                let frame2 = this.pendingBillFrame2;
                this.pendingBillFrame2 = null;
                
                let payload = Utils.extractPayloadFroBantekemplate(frame2);
                if (payload) {
                    return Utils.buildFrame(payload, hexStr);
                }
                return frame2;
            }
        }
        
        // PURE STATIC - Connection commands
        const pureStaticKeys = [
            "935A64",           // SNRM
            "5356A2",           // PORT CLOSE
            "E6E600C0018100070100620100FF07", // BILL_ENTRY Check
            "E6E600C0018100010000600101FF02", // MAKER NAME
            "E6E600C00181000100005E5B0BFF02", // CATEGORY
            "E6E600C00181000100005E5B09FF02"  // METER TYPE
        ];
        
        // ✅ AARQ CHECK - Password validation
        if (hexStr.includes("A041034110") || hexStr.includes("A044034110")) {
            if (this.validateAARQ(hexStr)) {
                this.isAuthenticated = true;
                // Return AARE success
                return profile.static_replies["A044034110"] || profile.static_replies["A041034110"];
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
                if (pureStaticKeys.includes(key)) {
                    return profile.static_replies[key];
                }
                
                let staticFrame = profile.static_replies[key];
                let payload = Utils.extractPayloadFroBantekemplate(staticFrame);
                
                if (!payload) {
                    return staticFrame;
                }
                
                return Utils.buildFrame(payload, hexStr);
            }
        }
        
        // Check dynamic templates
        for (let key in profile.dynamic_templates) {
            if (hexStr.includes(key)) {
                return this.generateDynamic(profile.dynamic_templates[key], hexStr);
            }
        }
        
        return null; 
    },

    generateDynamic: function(tmpl, requestHex) {
        let fullFrame = tmpl.template;
        
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

        let payload = Utils.extractPayloadFroBantekemplate(fullFrame);
        if (payload) {
            return Utils.buildFrame(payload, requestHex);
        }
        
        return fullFrame;
    },

    injectClock: function(frame) {
        const nowTime = Utils.getDLMSTime(new Date());
        return frame.replace(/090C[0-9A-F]{24}/i, nowTime);
    },

    injectSerial: function(frame) {
        let serial = this.uiValues.serial.toString().trim();
        serial = serial.padStart(7, '0').substring(0, 7);
        
        let hex = "";
        for (let i = 0; i < serial.length; i++) {
            hex += serial.charCodeAt(i).toString(16).padStart(2, '0');
        }
        
        return frame.replace(/0907[0-9A-F]{14}/i, "0907" + hex.toUpperCase());
    },

    injectInstantValues: function(frame, tmpl) {
        const vKwh = Math.floor(this.uiValues.kwh * 100);
        const vKvah = Math.floor(this.uiValues.kvah * 100);
        const md_kw = Math.floor(this.uiValues.md_kw * 100);
        const md_kva = Math.floor(this.uiValues.md_kva * 100);
        
        const nowTime = Utils.getDLMSTime(new Date());
        const mdTime = this.sessionData.mdTimeCurrent;
        
        let parts = frame.split(/090C[0-9A-F]{24}/i);
        if (parts.length >= 4) {
            frame = parts[0] + nowTime + parts[1] + mdTime + parts[2] + mdTime + parts[3];
        }
        
        frame = frame.replace(/050002CA70/i, "05" + vKwh.toString(16).padStart(8, '0').toUpperCase());
        frame = frame.replace(/0500031026/i, "05" + vKvah.toString(16).padStart(8, '0').toUpperCase());
        
        let mdCount = 0;
        frame = frame.replace(/0600000016/gi, function(match) {
            mdCount++;
            if (mdCount === 1) {
                return "06" + md_kw.toString(16).padStart(8, '0').toUpperCase();
            } else {
                return "06" + md_kva.toString(16).padStart(8, '0').toUpperCase();
            }
        });
        
        return frame;
    },

    injectBillValues: function(frame, tmpl, requestHex) {
        const now = new Date();
        
        const replaceAt = (str, index, replacement) => {
            if(!index) return str;
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        const toHex = (val, multiplier) => "05" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        const toHexMD = (val, multiplier) => "05" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        
        const getZones = (val) => {
            let z1 = Math.floor(val * 0.25);
            let z2 = Math.floor(val * 0.15);
            let z3 = Math.floor(val * 0.35);
            let z4 = Math.floor(val * 0.25);
            let z5 = 0;
            return { z1, z2, z3, z4, z5 };
        };

        const vCurKwh = this.uiValues.kwh;
        const vCurKvah = this.uiValues.kvah;
        const vCurMd = this.uiValues.md_kw;
        const vCurMdKva = this.uiValues.md_kva;
        const zCurKwh = getZones(vCurKwh);
        const zCurKvah = getZones(vCurKvah);

        const vPrevKwh = this.uiValues.kwh - 50;
        const vPrevKvah = this.uiValues.kvah - 60;
        const vPrevMd = Math.max(0, this.uiValues.md_kw - 0.2);
        const vPrevMdKva = Math.max(0, this.uiValues.md_kva - 0.2);
        const zPrevKwh = getZones(vPrevKwh);
        const zPrevKvah = getZones(vPrevKvah);

        const vHistKwh = this.uiValues.kwh - 500;
        const vHistKvah = this.uiValues.kvah - 600;
        const vHistMd = Math.max(0, this.uiValues.md_kw - 0.1);
        const vHistMdKva = Math.max(0, this.uiValues.md_kva - 0.1);
        const zHistKwh = getZones(vHistKwh);
        const zHistKvah = getZones(vHistKvah);

        const vHistOldKwh = this.uiValues.kwh - 550;
        const vHistOldKvah = this.uiValues.kvah - 660;
        const vHistOldMd = Math.max(0, this.uiValues.md_kw - 0.15);
        const vHistOldMdKva = Math.max(0, this.uiValues.md_kva - 0.15);
        const zHistOldKwh = getZones(vHistOldKwh);
        const zHistOldKvah = getZones(vHistOldKvah);

        if (tmpl.subtype === "LATEST") {
            frame = replaceAt(frame, tmpl.idxs.b1_date, Utils.getDLMSTime(now));
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vCurKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zCurKwh.z1, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zCurKwh.z2, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zCurKwh.z3, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zCurKwh.z4, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z5, toHex(zCurKwh.z5, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vCurKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zCurKvah.z1, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zCurKvah.z2, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zCurKvah.z3, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zCurKvah.z4, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz5, toHex(zCurKvah.z5, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vCurMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vCurMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimeCurrent);
            
            let frame2 = tmpl.frame2;
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_date, this.sessionData.dateLatestB2);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kwh, toHex(vPrevKwh, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z1, toHex(zPrevKwh.z1, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z2, toHex(zPrevKwh.z2, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z3, toHex(zPrevKwh.z3, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z4, toHex(zPrevKwh.z4, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z5, toHex(zPrevKwh.z5, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kvah, toHex(vPrevKvah, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz1, toHex(zPrevKvah.z1, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz2, toHex(zPrevKvah.z2, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz3, toHex(zPrevKvah.z3, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz4, toHex(zPrevKvah.z4, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz5, toHex(zPrevKvah.z5, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md, toHexMD(vPrevMd, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_t, this.sessionData.mdTimeLatestB2);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva_t, this.sessionData.mdTimeLatestB2);
            
            this.pendingBillFrame2 = frame2;
            
        } else {
            frame = replaceAt(frame, tmpl.idxs.b1_date, this.sessionData.dateHistB1);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vHistKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zHistKwh.z1, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zHistKwh.z2, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zHistKwh.z3, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zHistKwh.z4, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z5, toHex(zHistKwh.z5, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vHistKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zHistKvah.z1, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zHistKvah.z2, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zHistKvah.z3, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zHistKvah.z4, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz5, toHex(zHistKvah.z5, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vHistMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimeHistB1);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vHistMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimeHistB1);
            
            let frame2 = tmpl.frame2;
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_date, this.sessionData.dateHistB2);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kwh, toHex(vHistOldKwh, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z1, toHex(zHistOldKwh.z1, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z2, toHex(zHistOldKwh.z2, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z3, toHex(zHistOldKwh.z3, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z4, toHex(zHistOldKwh.z4, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z5, toHex(zHistOldKwh.z5, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kvah, toHex(vHistOldKvah, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz1, toHex(zHistOldKvah.z1, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz2, toHex(zHistOldKvah.z2, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz3, toHex(zHistOldKvah.z3, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz4, toHex(zHistOldKvah.z4, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz5, toHex(zHistOldKvah.z5, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md, toHexMD(vHistOldMd, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_t, this.sessionData.mdTimeHistB2);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva, toHexMD(vHistOldMdKva, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva_t, this.sessionData.mdTimeHistB2);
            
            this.pendingBillFrame2 = frame2;
        }
        
        return frame;
    }
};
