const Logic_HPL = {
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

    // HPL Password: "1111111111111111" (16 bytes of ASCII '1')
    HPL_PASSWORD: "31313131313131313131313131313131",

    isAuthenticated: false,

    // HPL uses deviation 00014A00 (IST +5:30) instead of FF800000
    getDLMSTimeHPL: function(date) {
        const Y = date.getFullYear().toString(16).padStart(4, '0').toUpperCase();
        const M = (date.getMonth() + 1).toString(16).padStart(2, '0').toUpperCase();
        const D = date.getDate().toString(16).padStart(2, '0').toUpperCase();
        const h = date.getHours().toString(16).padStart(2, '0').toUpperCase();
        const m = date.getMinutes().toString(16).padStart(2, '0').toUpperCase();
        const s = date.getSeconds().toString(16).padStart(2, '0').toUpperCase();
        return `090C${Y}${M}${D}FF${h}${m}${s}00014A00`;
    },

    init: function() {
        this.currentMeter = HPL_PROFILE;
        this.isAuthenticated = false;

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
        this.sessionData.mdTimeCurrent = this.getDLMSTimeHPL(d1);

        let dPrev = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        this.sessionData.datePrev = this.getDLMSTimeHPL(dPrev);

        let dPrevMD = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        dPrevMD.setDate(5 + Math.floor(Math.random() * 20));
        dPrevMD.setHours(Math.floor(Math.random() * 20) + 1);
        dPrevMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimePrev = this.getDLMSTimeHPL(dPrevMD);

        let dOld = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        this.sessionData.dateOld = this.getDLMSTimeHPL(dOld);

        let dOldMD = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        dOldMD.setDate(5 + Math.floor(Math.random() * 20));
        dOldMD.setHours(Math.floor(Math.random() * 20) + 1);
        dOldMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeOld = this.getDLMSTimeHPL(dOldMD);

        let dArch = new Date(now.getFullYear() - 1, 0, 1);
        this.sessionData.dateArchive = this.getDLMSTimeHPL(dArch);

        let dArchMD = new Date(now.getFullYear() - 1, 11, 1);
        dArchMD.setDate(5 + Math.floor(Math.random() * 20));
        dArchMD.setHours(Math.floor(Math.random() * 20) + 1);
        dArchMD.setMinutes(Math.floor(Math.random() * 60));
        this.sessionData.mdTimeArchive = this.getDLMSTimeHPL(dArchMD);
    },

    validateAARQ: function(hexStr) {
        if (hexStr.toUpperCase().includes(this.HPL_PASSWORD.toUpperCase())) {
            return true;
        }
        return false;
    },

    processPacket: function(hexStr) {
        hexStr = hexStr.toUpperCase();
        const profile = this.currentMeter;

        const pureStaticKeys = [
            "935A64",
            "5356A2",
            "E6E600C0018100070100620100FF07",
            "E6E600C0018100010000600101FF02",
            "E6E600C00181000100005E5B0BFF02",
            "E6E600C00181000100005E5B09FF02"
        ];

        // AARQ - HPL uses A04C034110
        if (hexStr.includes("A04C034110")) {
            if (this.validateAARQ(hexStr)) {
                this.isAuthenticated = true;
                return profile.static_replies["A04C034110"];
            } else {
                this.isAuthenticated = false;
                return null;
            }
        }

        // SNRM
        if (hexStr.includes("935A64")) {
            this.isAuthenticated = false;
            return profile.static_replies["935A64"];
        }

        // DISC
        if (hexStr.includes("5356A2")) {
            this.isAuthenticated = false;
            return profile.static_replies["5356A2"];
        }

        // All other - auth check
        if (!this.isAuthenticated) {
            return null;
        }

        // Static replies
        for (let key in profile.static_replies) {
            if (hexStr.includes(key)) {
                if (pureStaticKeys.includes(key)) {
                    return profile.static_replies[key];
                }
                let staticFrame = profile.static_replies[key];
                let payload = Utils.extractPayloadFromTemplate(staticFrame);
                if (!payload) {
                    return staticFrame;
                }
                return Utils.buildFrame(payload, hexStr);
            }
        }

        // Dynamic templates
        for (let key in profile.dynamic_templates) {
            if (hexStr.includes(key)) {
                return this.generateDynamic(profile.dynamic_templates[key], hexStr);
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
        const newTime = this.getDLMSTimeHPL(now);
        // HPL clock deviation: 00014A00
        const timePattern = /090C[0-9A-F]{24}/;
        return frame.replace(timePattern, newTime);
    },

    injectSerial: function(frame) {
        // HPL Meter No uses tag 06 (unsigned32), NOT tag 09 (string)
        let serial = this.uiValues.serial.toString().trim();
        serial = serial.replace(/[^0-9]/g, ''); // Only digits for uint32

        if (!serial || serial.length === 0) {
            serial = "0000000";
        }

        // Convert to unsigned32 hex
        let serialNum = parseInt(serial, 10);
        if (isNaN(serialNum)) serialNum = 0;

        let hexVal = "06" + serialNum.toString(16).padStart(8, '0').toUpperCase();

        // Replace existing 06XXXXXXXX pattern after C4018100
        const serialPattern = /06[0-9A-F]{8}/;
        // Find position after C4018100
        let payloadStart = frame.toUpperCase().indexOf("C4018100");
        if (payloadStart !== -1) {
            let afterPayload = frame.substring(payloadStart + 8);
            afterPayload = afterPayload.replace(serialPattern, hexVal);
            frame = frame.substring(0, payloadStart + 8) + afterPayload;
        }

        return frame;
    },

    injectInstantValues: function(frame, tmpl) {
        const vKwh = Math.floor(this.uiValues.kwh * 100);
        const vKvah = Math.floor(this.uiValues.kvah * 100);
        const md_kw = Math.floor(this.uiValues.md_kw * 100);
        const md_kva = Math.floor(this.uiValues.md_kva * 100);

        const nowTime = this.getDLMSTimeHPL(new Date());
        const mdTime = this.sessionData.mdTimeCurrent;

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
        return frame;
    },

    injectBillValues: function(frame, tmpl, requestHex) {
        const now = new Date();

        let subtype = "HISTORY";
        if (requestHex.includes("0201020204060000000106000000021200011200")) {
            subtype = "LATEST";
        } else if (requestHex.includes("0201020204060000000C060000000D1200011200")) {
            subtype = "HISTORY";
        }

        const replaceAt = (str, index, replacement) => {
            if (!index && index !== 0) return str;
            return str.substring(0, index) + replacement + str.substring(index + replacement.length);
        };

        // HPL tags: 06 for kWh/kVAh (unsigned32), 12 for MD (unsigned16)
        const toHex = (val, multiplier) => "06" + Math.floor(val * multiplier).toString(16).padStart(8, '0').toUpperCase();
        const toHexMD = (val, multiplier) => "12" + Math.floor(val * multiplier).toString(16).padStart(4, '0').toUpperCase();

        // HPL zone percentages: Z1≈29%, Z2≈5%, Z3≈49%, Z4≈17%
        const getZones = (val) => {
            let z1 = Math.floor(val * 0.29);
            let z2 = Math.floor(val * 0.05);
            let z3 = Math.floor(val * 0.49);
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

        // HPL: Zones use SAME scaler as total (/100), NOT /1000 like Avon!
        const ZONE_MULT = 100;

        if (subtype === "LATEST") {
            frame = replaceAt(frame, tmpl.idxs.b1_date, this.getDLMSTimeHPL(now));
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimeCurrent);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vCurKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vCurKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vCurMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vCurMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zCurKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zCurKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zCurKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zCurKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zCurKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zCurKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zCurKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zCurKvah.z4, ZONE_MULT));

            frame = replaceAt(frame, tmpl.idxs.b2_date, this.sessionData.dateArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_md_t, this.sessionData.mdTimeArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva_t, this.sessionData.mdTimeArchive);
            frame = replaceAt(frame, tmpl.idxs.b2_kwh, toHex(vArchKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_kvah, toHex(vArchKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_z1, toHex(zArchKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z2, toHex(zArchKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z3, toHex(zArchKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z4, toHex(zArchKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz1, toHex(zArchKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz2, toHex(zArchKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz3, toHex(zArchKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz4, toHex(zArchKvah.z4, ZONE_MULT));

        } else {
            // HISTORY
            frame = replaceAt(frame, tmpl.idxs.b1_date, this.sessionData.datePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_md_t, this.sessionData.mdTimePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva_t, this.sessionData.mdTimePrev);
            frame = replaceAt(frame, tmpl.idxs.b1_kwh, toHex(vPrevKwh, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_kvah, toHex(vPrevKvah, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b1_z1, toHex(zPrevKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z2, toHex(zPrevKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z3, toHex(zPrevKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_z4, toHex(zPrevKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz1, toHex(zPrevKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz2, toHex(zPrevKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz3, toHex(zPrevKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b1_kz4, toHex(zPrevKvah.z4, ZONE_MULT));

            frame = replaceAt(frame, tmpl.idxs.b2_date, this.sessionData.dateOld);
            frame = replaceAt(frame, tmpl.idxs.b2_md_t, this.sessionData.mdTimeOld);
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva_t, this.sessionData.mdTimeOld);
            frame = replaceAt(frame, tmpl.idxs.b2_kwh, toHex(vPrevKwh - 50, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_kvah, toHex(vPrevKvah - 60, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md, toHexMD(vPrevMd, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_md_kva, toHexMD(vPrevMdKva, 100));
            frame = replaceAt(frame, tmpl.idxs.b2_z1, toHex(zPrevKwh.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z2, toHex(zPrevKwh.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z3, toHex(zPrevKwh.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_z4, toHex(zPrevKwh.z4, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz1, toHex(zPrevKvah.z1, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz2, toHex(zPrevKvah.z2, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz3, toHex(zPrevKvah.z3, ZONE_MULT));
            frame = replaceAt(frame, tmpl.idxs.b2_kz4, toHex(zPrevKvah.z4, ZONE_MULT));
        }

        return frame;
    }
};
