const Logic_Genus = {
    currentMeter: null,
    uiValues: {},
    sessionData: {
        mdTimeCurrent: null,
        datePrev: null, mdTimePrev: null,
        dateOld: null, mdTimeOld: null,
        dateArchive: null, mdTimeArchive: null
    },

    pendingBillFrame2: null,
    // Queue for multi-level NEXT FRAME (BILL_PARAMS needs 3 frames)
    pendingNextFrames: [],

    // Genus Password: "1A2B3C4D"
    GENUS_PASSWORD: "3141324233433444",
    isAuthenticated: false,

    init: function() {
        this.currentMeter = GENUS_PROFILE;
        this.isAuthenticated = false;
        this.pendingBillFrame2 = null;
        this.pendingNextFrames = [];

        const now = new Date();
        const cm = now.getMonth();
        const cy = now.getFullYear();

        let d1 = new Date(now);
        d1.setDate(Math.max(1, now.getDate() - Math.floor(Math.random() * 3 + 1)));
        d1.setHours(Math.floor(Math.random() * 20) + 1);
        d1.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeCurrent = Utils.getDLMSTime(d1);

        this.sessionData.datePrev = Utils.getDLMSTime(new Date(cy, cm - 2, 1));
        let dp = new Date(cy, cm - 3, 5 + Math.floor(Math.random() * 20));
        dp.setHours(Math.floor(Math.random() * 20) + 1);
        dp.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimePrev = Utils.getDLMSTime(dp);

        this.sessionData.dateOld = Utils.getDLMSTime(new Date(cy, cm - 1, 1));
        let dOld = new Date(cy, cm - 2, 5 + Math.floor(Math.random() * 20));
        dOld.setHours(Math.floor(Math.random() * 20) + 1);
        dOld.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeOld = Utils.getDLMSTime(dOld);

        this.sessionData.dateArchive = Utils.getDLMSTime(new Date(cy - 1, 0, 1));
        let dArch = new Date(cy - 1, 11, 5 + Math.floor(Math.random() * 20));
        dArch.setHours(Math.floor(Math.random() * 20) + 1);
        dArch.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeArchive = Utils.getDLMSTime(dArch);
    },

    validateAARQ: function(hexStr) {
        return hexStr.toUpperCase().includes(this.GENUS_PASSWORD.toUpperCase());
    },

    processPacket: function(hexStr) {
        hexStr = hexStr.toUpperCase();
        const profile = this.currentMeter;

        // NEXT FRAME REQUEST
        if (hexStr.includes("E6E600C00281000000")) {
            if (!this.isAuthenticated) return null;

            // Bill Frame 2 pending (highest priority)
            if (this.pendingBillFrame2) {
                let f2 = this.pendingBillFrame2;
                this.pendingBillFrame2 = null;
                let payload = Utils.extractPayloadFromTemplate(f2);
                if (payload) return Utils.buildFrame(payload, hexStr);
                return f2;
            }

            // Static multi-frame queue
            if (this.pendingNextFrames.length > 0) {
                let nextFrame = this.pendingNextFrames.shift();
                let payload = Utils.extractPayloadFromTemplate(nextFrame);
                if (payload) return Utils.buildFrame(payload, hexStr);
                return nextFrame;
            }
            return null;
        }

        // AARQ
        if (hexStr.includes("A044034110") || hexStr.includes("A041034110")) {
            if (this.validateAARQ(hexStr)) {
                this.isAuthenticated = true;
                return profile.static_replies["A044034110"] || profile.static_replies["A041034110"];
            }
            this.isAuthenticated = false;
            return null;
        }

        // SNRM
        if (hexStr.includes("935A64")) {
            this.isAuthenticated = false;
            this.pendingBillFrame2 = null;
            this.pendingNextFrames = [];
            return profile.static_replies["935A64"];
        }

        // DISC
        if (hexStr.includes("5356A2")) {
            this.isAuthenticated = false;
            this.pendingBillFrame2 = null;
            this.pendingNextFrames = [];
            return profile.static_replies["5356A2"];
        }

        if (!this.isAuthenticated) return null;

        // Dynamic templates FIRST (longer keys)
        for (let key in profile.dynamic_templates) {
            if (hexStr.includes(key)) {
                return this.generateDynamic(profile.dynamic_templates[key], hexStr);
            }
        }

        // Static replies with multi-frame handling
        // Keys that trigger NEXT FRAME queue
        const multiFrameMap = {
            "E6E600C00181000701005E5B00FF03": ["INST_PARAMS"],
            "E6E600C00181000701005E5B06FF03": ["BILL_SCAL_PARAMS"],
            "E6E600C0018100070100620100FF03": ["BILL_PARAMS_F2", "BILL_PARAMS_F3"]
        };

        for (let key in profile.static_replies) {
            if (hexStr.includes(key)) {
                // Queue NEXT FRAME responses if needed
                if (multiFrameMap[key]) {
                    this.pendingNextFrames = [];
                    for (let nfKey of multiFrameMap[key]) {
                        if (profile.next_frames[nfKey]) {
                            this.pendingNextFrames.push(profile.next_frames[nfKey]);
                        }
                    }
                }

                let staticFrame = profile.static_replies[key];
                let payload = Utils.extractPayloadFromTemplate(staticFrame);
                if (!payload) return staticFrame;
                return Utils.buildFrame(payload, hexStr);
            }
        }

        return null;
    },

    generateDynamic: function(tmpl, requestHex) {
        let fullFrame = tmpl.template;

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

    injectClock: function(frame) {
        const newTime = Utils.getDLMSTime(new Date());
        return frame.replace(/090C[0-9A-F]{24}/i, newTime);
    },

    injectSerial: function(frame) {
        let serial = this.uiValues.serial.toString().trim();
        if (!serial || serial.length === 0) serial = "0000000";
        // Genus uses visible-string (tag 0A), pad with spaces to 11 chars
        serial = serial.padStart(11, ' ').substring(0, 11);
        let hex = "";
        for (let i = 0; i < serial.length; i++) {
            hex += serial.charCodeAt(i).toString(16).padStart(2, '0');
        }
        hex = hex.toUpperCase();
        return frame.replace(/0A0B[0-9A-F]{22}/i, "0A0B" + hex);
    },

    injectInstantValues: function(frame, tmpl) {
        // Genus scaler: kWh/kVAh = +2 (unit Wh), so raw = kWh × 10 (= kWh×1000/100)
        // Genus INST MD scaler: 0 (unit W), so raw = kW × 1000
        const vKwh = Math.floor(this.uiValues.kwh * 10);
        const vKvah = Math.floor(this.uiValues.kvah * 10);
        const md_kw = Math.floor(this.uiValues.md_kw * 1000);
        const md_kva = Math.floor(this.uiValues.md_kva * 1000);
        const nowTime = Utils.getDLMSTime(new Date());
        const mdTime = this.sessionData.mdTimeCurrent;

        const replaceAt = (str, index, replacement) => {
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        // Genus INST: kWh/kVAh/MD all U32 (06 tag)
        let kwh = "06" + vKwh.toString(16).padStart(8, '0').toUpperCase();
        let kvah = "06" + vKvah.toString(16).padStart(8, '0').toUpperCase();
        let mdKw = "06" + md_kw.toString(16).padStart(8, '0').toUpperCase();
        let mdKva = "06" + md_kva.toString(16).padStart(8, '0').toUpperCase();

        // Replace clock (first 090C pattern)
        frame = frame.replace(/090C[0-9A-F]{24}/i, nowTime);

        if (tmpl.inst_idxs) {
            frame = replaceAt(frame, tmpl.inst_idxs.kwh, kwh);
            frame = replaceAt(frame, tmpl.inst_idxs.kvah, kvah);
            frame = replaceAt(frame, tmpl.inst_idxs.md_kw, mdKw);
            frame = replaceAt(frame, tmpl.inst_idxs.md_kw_t, mdTime);
            frame = replaceAt(frame, tmpl.inst_idxs.md_kva, mdKva);
            frame = replaceAt(frame, tmpl.inst_idxs.md_kva_t, mdTime);
        }
        return frame;
    },

    injectBillValues: function(frame, tmpl, requestHex) {
        const now = new Date();
        const replaceAt = (str, index, replacement) => {
            if (!index && index !== 0) return str;
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        // Genus: kWh/kVAh = U32 (06 tag), MD = U16 (12 tag)
        const toHex = (val, multiplier) => "06" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        const toHexMD = (val, multiplier) => "12" + Math.floor(val * multiplier).toString(16).padStart(4, '0').toUpperCase();

        // 8-zone distribution (from real log analysis):
        // Z1≈2.8%, Z2≈23.7%, Z3≈5.5%, Z4≈30.6%, Z5≈3.1%, Z6≈1.1%, Z7≈11.4%, Z8≈21.8%
        const getZones = (val) => {
            let z1 = Math.floor(val * 0.028);
            let z2 = Math.floor(val * 0.237);
            let z3 = Math.floor(val * 0.055);
            let z4 = Math.floor(val * 0.306);
            let z5 = Math.floor(val * 0.031);
            let z6 = Math.floor(val * 0.011);
            let z7 = Math.floor(val * 0.114);
            let z8 = Math.floor(val - (z1+z2+z3+z4+z5+z6+z7));
            return { z1, z2, z3, z4, z5, z6, z7, z8 };
        };

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

        // Genus BILL scaler: kWh/kVAh same as INST = scaler+2 (unit Wh), raw = kWh × 10
        // Genus BILL MD scaler: -3 (unit kW), raw = kW × 1000
        // Zone values are already in kWh (fractions of total), same multiplier ×10
        const ZM = 10;

        const injectSlot = (f, idx, date, kwh, kvah, md, mdKva, mdTime, zKwh, zKvah) => {
            f = replaceAt(f, idx.b1_date || idx.b2_date, date);
            f = replaceAt(f, idx.b1_kwh || idx.b2_kwh, toHex(kwh, 10));
            f = replaceAt(f, idx.b1_z1 || idx.b2_z1, toHex(zKwh.z1, ZM));
            f = replaceAt(f, idx.b1_z2 || idx.b2_z2, toHex(zKwh.z2, ZM));
            f = replaceAt(f, idx.b1_z3 || idx.b2_z3, toHex(zKwh.z3, ZM));
            f = replaceAt(f, idx.b1_z4 || idx.b2_z4, toHex(zKwh.z4, ZM));
            f = replaceAt(f, idx.b1_z5 || idx.b2_z5, toHex(zKwh.z5, ZM));
            f = replaceAt(f, idx.b1_z6 || idx.b2_z6, toHex(zKwh.z6, ZM));
            f = replaceAt(f, idx.b1_z7 || idx.b2_z7, toHex(zKwh.z7, ZM));
            f = replaceAt(f, idx.b1_z8 || idx.b2_z8, toHex(zKwh.z8, ZM));
            f = replaceAt(f, idx.b1_kvah || idx.b2_kvah, toHex(kvah, 10));
            f = replaceAt(f, idx.b1_kz1 || idx.b2_kz1, toHex(zKvah.z1, ZM));
            f = replaceAt(f, idx.b1_kz2 || idx.b2_kz2, toHex(zKvah.z2, ZM));
            f = replaceAt(f, idx.b1_kz3 || idx.b2_kz3, toHex(zKvah.z3, ZM));
            f = replaceAt(f, idx.b1_kz4 || idx.b2_kz4, toHex(zKvah.z4, ZM));
            f = replaceAt(f, idx.b1_kz5 || idx.b2_kz5, toHex(zKvah.z5, ZM));
            f = replaceAt(f, idx.b1_kz6 || idx.b2_kz6, toHex(zKvah.z6, ZM));
            f = replaceAt(f, idx.b1_kz7 || idx.b2_kz7, toHex(zKvah.z7, ZM));
            f = replaceAt(f, idx.b1_kz8 || idx.b2_kz8, toHex(zKvah.z8, ZM));
            f = replaceAt(f, idx.b1_md || idx.b2_md, toHexMD(md, 1000));
            f = replaceAt(f, idx.b1_md_t || idx.b2_md_t, mdTime);
            f = replaceAt(f, idx.b1_md_kva || idx.b2_md_kva, toHexMD(mdKva, 1000));
            f = replaceAt(f, idx.b1_md_kva_t || idx.b2_md_kva_t, mdTime);
            return f;
        };

        if (tmpl.subtype === "LATEST") {
            frame = injectSlot(frame, tmpl.idxs, Utils.getDLMSTime(now),
                vCurKwh, vCurKvah, vCurMd, vCurMdKva, this.sessionData.mdTimeCurrent, zCurKwh, zCurKvah);

            let frame2 = tmpl.frame2;
            frame2 = injectSlot(frame2, tmpl.idxs2, this.sessionData.dateArchive,
                vArchKwh, vArchKvah, vPrevMd, vPrevMdKva, this.sessionData.mdTimeArchive, zArchKwh, zArchKvah);

            this.pendingBillFrame2 = frame2;
        } else {
            frame = injectSlot(frame, tmpl.idxs, this.sessionData.datePrev,
                vPrevKwh, vPrevKvah, vPrevMd, vPrevMdKva, this.sessionData.mdTimePrev, zPrevKwh, zPrevKvah);

            let frame2 = tmpl.frame2;
            frame2 = injectSlot(frame2, tmpl.idxs2, this.sessionData.dateOld,
                vPrevKwh - 50, vPrevKvah - 60, vPrevMd, vPrevMdKva, this.sessionData.mdTimeOld, zPrevKwh, zPrevKvah);

            this.pendingBillFrame2 = frame2;
        }

        return frame;
    }
};
