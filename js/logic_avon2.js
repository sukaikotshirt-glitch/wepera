const Logic_Avon2 = {
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

    // ✅ Pending Frame 2 for NEXT FRAME (like MT meter)
    pendingBillFrame2: null,
    // ✅ Pending NEXT FRAME for static multi-frame responses
    pendingNextFrame: null,

    // Avon 2 Password: "Hello" in hex
    AVON2_PASSWORD: "48656c6c6f",

    isAuthenticated: false,

    init: function() {
        this.currentMeter = AVON2_PROFILE;
        this.isAuthenticated = false;
        this.pendingBillFrame2 = null;
        this.pendingNextFrame = null;

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

    validateAARQ: function(hexStr) {
        if (hexStr.toUpperCase().includes(this.AVON2_PASSWORD.toUpperCase())) {
            return true;
        }
        return false;
    },

    processPacket: function(hexStr) {
        hexStr = hexStr.toUpperCase();
        const profile = this.currentMeter;

        // ✅ NEXT FRAME REQUEST - Check FIRST (like MT meter does)
        if (hexStr.includes("E6E600C00281000000")) {
            if (!this.isAuthenticated) return null;

            // Bill Frame 2 pending?
            if (this.pendingBillFrame2) {
                let frame2 = this.pendingBillFrame2;
                this.pendingBillFrame2 = null;

                let payload = Utils.extractPayloadFromTemplate(frame2);
                if (payload) {
                    return Utils.buildFrame(payload, hexStr);
                }
                return frame2;
            }

            // Static multi-frame pending? (INST_PARAMS, BILL_SCAL_PARAMS, BILL_PARAMS etc.)
            if (this.pendingNextFrame) {
                let nextFrame = this.pendingNextFrame;
                this.pendingNextFrame = null;

                let payload = Utils.extractPayloadFromTemplate(nextFrame);
                if (payload) {
                    return Utils.buildFrame(payload, hexStr);
                }
                return nextFrame;
            }
            
            return null;
        }

        // PURE STATIC Keys
        const pureStaticKeys = [
            "935A64",
            "5356A2",
            "E6E600C0018100070100620100FF07",
            "E6E600C0018100010000600101FF02",
            "E6E600C00181000100005E5B0BFF02",
            "E6E600C00181000100005E5B09FF02"
        ];

        // ✅ Multi-frame static responses (Frame 1 needs NEXT FRAME for Frame 2)
        // These are the keys whose responses are too big for 1 frame in Avon 2
        const multiFrameStaticKeys = {
            // INST_PARAMETERS - Frame 1 reply, then NEXT FRAME gets Frame 2
            "E6E600C00181000701005E5B00FF03": "7EA03A4103969232E6E700C4028101000000020024020412000309060100010200FF0F02120000020412000309060100090200FF0F021200000D497E",
            // BILL_SCAL_PARAMS - Frame 1 reply, then NEXT FRAME gets Frame 2
            "E6E600C00181000701005E5B06FF03": "7EA04C41037451E7E6E700C4028101000000020036020412000309060000606302FF0F03120000020412000309060000606303FF0F03120000020412000309060000606304FF0F031200003C4A7E",
            // BILL_PARAMETERS - Frame 1 reply, then NEXT FRAME gets Frame 2
            "E6E600C0018100070100620100FF03": "7EA0704103B8F730E6E700C402810100000002005A020412000309060000606300FF0F02120000020412000309060000606301FF0F02120000020412000309060000606302FF0F02120000020412000309060000606303FF0F02120000020412000309060000606304FF0F0212000004A07E"
        };

        // AARQ CHECK
        if (hexStr.includes("A041034110") || hexStr.includes("A044034110")) {
            if (this.validateAARQ(hexStr)) {
                this.isAuthenticated = true;
                return profile.static_replies["A041034110"] || profile.static_replies["A044034110"];
            } else {
                this.isAuthenticated = false;
                return null;
            }
        }

        // SNRM
        if (hexStr.includes("935A64")) {
            this.isAuthenticated = false;
            this.pendingBillFrame2 = null;
            this.pendingNextFrame = null;
            return profile.static_replies["935A64"];
        }

        // DISC
        if (hexStr.includes("5356A2")) {
            this.isAuthenticated = false;
            this.pendingBillFrame2 = null;
            this.pendingNextFrame = null;
            return profile.static_replies["5356A2"];
        }

        // All other - auth check
        if (!this.isAuthenticated) {
            return null;
        }

        // ✅ Check dynamic templates FIRST (longer keys match first, prevents partial match)
        for (let key in profile.dynamic_templates) {
            if (hexStr.includes(key)) {
                return this.generateDynamic(profile.dynamic_templates[key], hexStr);
            }
        }

        // Check static replies (with multi-frame support)
        for (let key in profile.static_replies) {
            if (hexStr.includes(key)) {
                if (pureStaticKeys.includes(key)) {
                    return profile.static_replies[key];
                }

                // ✅ Check if this key has a pending Frame 2
                if (multiFrameStaticKeys[key]) {
                    this.pendingNextFrame = multiFrameStaticKeys[key];
                }

                let staticFrame = profile.static_replies[key];
                let payload = Utils.extractPayloadFromTemplate(staticFrame);
                if (!payload) {
                    return staticFrame;
                }
                return Utils.buildFrame(payload, hexStr);
            }
        }

        return null;
    },

    generateDynamic: function(tmpl, requestHex) {
        let fullFrame;
        if (tmpl.template) {
            fullFrame = tmpl.template;
        } else if (tmpl.head && tmpl.body && tmpl.tail) {
            fullFrame = tmpl.head + tmpl.body + tmpl.tail;
        } else {
            return null;
        }

        switch (tmpl.type) {
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

        let payload = Utils.extractPayloadFromTemplate(fullFrame);
        if (!payload) return null;
        return Utils.buildFrame(payload, requestHex);
    },

    // ==================== INJECTION HELPERS ====================

    injectClock: function(frame) {
        const now = new Date();
        const newTime = Utils.getDLMSTime(now);
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

        // Avon 2 uses string format (09 tag) for serial
        let hexSerial = "";
        for (let i = 0; i < serial.length; i++) {
            hexSerial += serial.charCodeAt(i).toString(16).padStart(2, '0');
        }
        hexSerial = hexSerial.toUpperCase();

        let lengthByte = serial.length.toString(16).padStart(2, '0').toUpperCase();
        let newSerialBlock = "09" + lengthByte + hexSerial;

        const serialPattern = /09[0-9A-F]{2}[0-9A-F]{10,22}/;
        return frame.replace(serialPattern, newSerialBlock);
    },

    injectInstantValues: function(frame, tmpl) {
        const vKwh = Math.floor(this.uiValues.kwh * 100);
        const vKvah = Math.floor(this.uiValues.kvah * 100);
        const md_kw = Math.floor(this.uiValues.md_kw * 100);
        const md_kva = Math.floor(this.uiValues.md_kva * 100);

        const nowTime = Utils.getDLMSTime(new Date());
        const mdTime = this.sessionData.mdTimeCurrent;

        if (tmpl.head && tmpl.body && tmpl.tail) {
            const replaceAt = (str, index, replacement) => {
                return str.substring(0, index) + replacement + str.substring(index + replacement.length);
            };

            // kWh/kVAh = U32 (06 tag), MD = U16 (12 tag)
            let kwh = "06" + vKwh.toString(16).padStart(8, '0').toUpperCase();
            let kvah = "06" + vKvah.toString(16).padStart(8, '0').toUpperCase();
            let mdKwHex = "12" + md_kw.toString(16).padStart(4, '0').toUpperCase();
            let mdKvaHex = "12" + md_kva.toString(16).padStart(4, '0').toUpperCase();

            // Build: head + CLOCK + body + tail
            frame = tmpl.head + nowTime + tmpl.body + tmpl.tail;

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
        return frame;
    },

    // ✅ BILL VALUES - 2 Frame approach like MT meter
    injectBillValues: function(frame, tmpl, requestHex) {
        const now = new Date();

        const replaceAt = (str, index, replacement) => {
            if (!index && index !== 0) return str;
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        // Avon 2 tags: kWh/kVAh = U32 (06), MD = U16 (12)
        const toHex = (val, multiplier) => "06" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        const toHexMD = (val, multiplier) => "12" + Math.floor(val * multiplier).toString(16).padStart(4, '0').toUpperCase();

        // Zone distribution: Z1≈25%, Z2≈15%, Z3≈40%, Z4≈remaining
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

        // Avon 2 Bill zones use /1000 multiplier
        const ZONE_MULT = 1000;

        if (tmpl.subtype === "LATEST") {
            // ===== Frame 1 (Slot 1) = Current data =====
            frame = replaceAt(frame, tmpl.idxs.b1_date, Utils.getDLMSTime(now));
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vCurKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zCurKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zCurKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zCurKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zCurKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vCurKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zCurKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zCurKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zCurKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zCurKvah.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vCurMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vCurMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimeCurrent);

            // ===== Frame 2 (Slot 2) = Archive data =====
            let frame2 = tmpl.frame2;
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_date, this.sessionData.dateArchive);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kwh, toHex(vArchKwh, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z1, toHex(zArchKwh.z1, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z2, toHex(zArchKwh.z2, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z3, toHex(zArchKwh.z3, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z4, toHex(zArchKwh.z4, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kvah, toHex(vArchKvah, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz1, toHex(zArchKvah.z1, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz2, toHex(zArchKvah.z2, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz3, toHex(zArchKvah.z3, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz4, toHex(zArchKvah.z4, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md, toHexMD(vPrevMd, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_t, this.sessionData.mdTimeArchive);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva_t, this.sessionData.mdTimeArchive);

            // ✅ Store Frame 2 for NEXT FRAME request
            this.pendingBillFrame2 = frame2;

        } else {
            // HISTORY
            // ===== Frame 1 (Slot 1) = Previous billing period =====
            frame = replaceAt(frame, tmpl.idxs.b1_date, this.sessionData.datePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vPrevKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zPrevKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zPrevKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zPrevKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zPrevKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vPrevKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zPrevKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zPrevKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zPrevKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zPrevKvah.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimePrev);

            // ===== Frame 2 (Slot 2) = Older billing period =====
            let frame2 = tmpl.frame2;
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_date, this.sessionData.dateOld);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kwh, toHex(vPrevKwh - 50, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z1, toHex(zPrevKwh.z1, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z2, toHex(zPrevKwh.z2, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z3, toHex(zPrevKwh.z3, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_z4, toHex(zPrevKwh.z4, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kvah, toHex(vPrevKvah - 60, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz1, toHex(zPrevKvah.z1, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz2, toHex(zPrevKvah.z2, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz3, toHex(zPrevKvah.z3, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_kz4, toHex(zPrevKvah.z4, ZONE_MULT));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md, toHexMD(vPrevMd, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_t, this.sessionData.mdTimeOld);
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame2 = replaceAt(frame2, tmpl.idxs2.b2_md_kva_t, this.sessionData.mdTimeOld);

            // ✅ Store Frame 2 for NEXT FRAME request
            this.pendingBillFrame2 = frame2;
        }

        return frame;
    }
};
