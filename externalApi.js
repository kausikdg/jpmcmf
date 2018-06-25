'use strict';

const S3270 = require('s3270-node');
var terminal;
var connected = false;

exports.AFSLogin = async function(data, resolve) {
    console.log("AFSLogin: " + JSON.stringify(data));

    terminal = S3270.connect('66.119.255.93:9923');

    let status = await terminal.status();

    // select casfrbu4 application
    let screen = await terminal.readScreen();
    setFieldValue(screen, /ENTER APPLICATION NAME/, "casfrbu4"); 
    await terminal.applyScreen(screen);
    await terminal.sendCommand("enter");
    await terminal.sendCommand("wait(InputField)");
    
    // log in
    screen = await terminal.readScreen();
    setFieldValue(screen, /Userid/, data.username);
    setFieldValue(screen, /Password/, data.password);
    delete data.username;
    delete data.password;
    await terminal.applyScreen(screen);
    await terminal.sendCommand("enter");

    // did login succeed?
    screen = await terminal.readScreen();
    //await printScreen();
    if (!screen.firstFieldWithText(/DFHCE3549/)) {
        data.success = false;
        return resolve(data);
    }

    // enter loan mode
    await terminal.sendKeys("loan");
    await terminal.sendCommand("enter");

    // return success
    data.success = true;
    connected = true;
    return resolve(data);
}

exports.AFSGetBillingScheduleDetails = async function(data, resolve) {
    console.log("AFS GetBillingScheduleDetails: " + JSON.stringify(data));
    
    try {
        let screen = await terminal.readScreen();
        setFieldValue(screen, /REQ:/, "0104");
        setFieldValueIfEmpty(screen, /BANK:/, "21");
        setFieldValueIfEmpty(screen, /APPL:/, "1");
        setFieldValueIfEmpty(screen, /BATCH:/, data.loan_details.batch);
        setFieldValueIfEmpty(screen, /OBGOR:/, data.loan_details.obgor_id);
        setFieldValueIfEmpty(screen, /OBGAT:/, data.loan_details.obgat);
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        // get name
        screen = await terminal.readScreen();
        await printScreen();        
        data.loan_details.obgor_name = getFieldValue(screen, /OBGAT:/, 3);
        data.loan_details.proc_type = getFieldValue(screen, /PROC TYPE:/);

        // go to page 8
        setFieldValue(screen, /PAGE:/, "0008");
        console.log("Set page to 0008");
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        // get ACH transit number
        screen = await terminal.readScreen();
        await printScreen();        
        data.loan_details.ach_account = getFieldValue(screen, /ACH ACCOUNT #/);
        data.loan_details.ach_transit = getFieldValue(screen, /ACH TRANSIT #/);

        // move to page 0122
        setFieldValue(screen, /REQ:/, "0122");
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        // read fields from first page
        screen = await terminal.readScreen();
        await printScreen();        
        data.billing_schedule = {
            page_id: "0122",
            due_dt: getFieldValue(screen, /DUE DT/),
            mat_moc: getFieldValue(screen, /MAT MOC/),
            mat_moc_desc: getFieldValue(screen, /MAT MOC/, 2),
            dda: getFieldValue(screen, /DDA/, 1, (field) => field.lineNum === 15), // multiple instances of text "DDA"
            repay_tp: getFieldValue(screen, /REPAY TP/),
            repay_tp_desc: getFieldValue(screen, /REPAY TP/, 2),
            bill_freq: getFieldValue(screen, /BILL FREQ/),
            bill_freq_desc: getFieldValue(screen, /BILL FREQ/, 2),
            lead_days: getFieldValue(screen, /LEAD DAYS/),
            spl_mail: getFieldValue(screen, /SPL MAIL/),
            coll_meth: getFieldValue(screen, /COLL METH/),
            coll_meth_desc: getFieldValue(screen, /COLL METH/, 2),
            transit: getFieldValue(screen, /TRANSIT/)        
        }

        // find prev due date on page 2 or 3
        await terminal.sendCommand("enter");
        screen = await terminal.readScreen();
        await printScreen();        
        if (screen.firstFieldWithText(/PREV DUE DATE/)) {
            data.billing_schedule.prev_due_date = getFieldValue(screen, /PREV DUE DATE/);
        } else {
            await terminal.sendCommand("enter");
            screen = await terminal.readScreen();
            await printScreen();            
            data.billing_schedule.prev_due_date = getFieldValue(screen, /PREV DUE DATE/);
        }

        // move to page 0136
        setFieldValue(screen, /REQ:/, "0136");
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");
        
        // go to last page
        screen = await terminal.readScreen();
        await printScreen();        
        let page = getFieldValue(screen, /PAGE/, 3);
        setFieldValue(screen, /PAGE:/, page);
        console.log("Set page to " + page);
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        // there are two entries -- check if there is data in the second one
        // if there is data in the second entry, use it, otherwise use the first
        screen = await terminal.readScreen();
        let secondEntry = (field) => field.lineNum > 13;
        let useBottom = getFieldValue(screen, /FROM DT/, 1, secondEntry);
        if (!useBottom) {
            secondEntry = null;
        }

        // read fields
        data.repayment_schedule = {
            page_id: "0136",
            from_dt: getFieldValue(screen, /FROM DT/, 1, secondEntry),
            thru_dt: getFieldValue(screen, /THRU/, 1, secondEntry),
            bill_dt_due: getFieldValue(screen, /BILL DT/, 3, secondEntry),
            bill_freq: getFieldValue(screen, /BILL FREQ/, 1, secondEntry),
            bill_freq_desc: getFieldValue(screen, /BILL FREQ/, 2, secondEntry),
            coll_method: getFieldValue(screen, /COLL METHOD/, 1, secondEntry),
            coll_method_desc: getFieldValue(screen, /COLL METHOD/, 2, secondEntry),
            repay_type: getFieldValue(screen, /REPAY TYPE/, 1, secondEntry),
            repay_type_desc: getFieldValue(screen, /REPAY TYPE/, 2, secondEntry),
            amount_due: getFieldValue(screen, /AMOUNT DUE/, 1, secondEntry),
        }
        await printScreen();
        
    } catch (err) {
        console.log("Caught error: " + JSON.stringify(err));
        data.err = err;
    }
    
    return resolve(data);    
}

exports.AFSChangeBillingScheduleDetails = async function(data, resolve) {
    console.log("AFS ChangeBillingScheduleDetails: " + JSON.stringify(data));
    
    try {
        // create short form schedule
        let screen = await terminal.readScreen();
        setFieldValue(screen, /REQ:/, "1313");
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        screen = await terminal.readScreen(); 
        setFieldValueIfEmpty(screen, /BANK:/, "21");
        setFieldValueIfEmpty(screen, /APPL:/, "1");
        setFieldValueIfEmpty(screen, /BATCH:/, data.batch);
        setFieldValueIfEmpty(screen, /OBGOR:/, data.obgor_id);
        setFieldValueIfEmpty(screen, /OBGAT:/, data.obgat);
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        screen = await terminal.readScreen(); 
        setFieldValue(screen, /CHARGE CD/, "100");
        setFieldValue(screen, /EFF FROM/, data.eff_from);
        setFieldValue(screen, /PERIOD/, data.period);
        setFieldValue(screen, /LEAD DAYS/, data.lead_days);
        setFieldValue(screen, /COLL METH/, data.coll_meth);
        setFieldValue(screen, /REPAY/, data.repay_type);
        setFieldValue(screen, /SPEC MAIL/, data.spec_mail); 
        setFieldValue(screen, /INT DUE DT/, data.due_dt);
        setFieldValue(screen, /PRIN DUE DT/, data.due_dt);
        setFieldValue(screen, /MAT COL METH/, data.mat_coll_meth);
        setFieldValue(screen, /DDA/, data.dda);
        setFieldValue(screen, /TRANSIT/, data.transit);
        setFieldValue(screen, /ADDL PRIN/, "0");
        setFieldValue(screen, /INSTALL AMT/, data.install_amt);

        await terminal.applyScreen(screen);
        await printScreen();
        await terminal.sendCommand("enter");
        
        // check for errors
        screen = await terminal.readScreen();
        if (!screen.firstFieldWithText(/TRANSACTION ACCEPTED/)) {
            let errorMsg = "Unknown error, check logs for details";
            let errorMsgFields = screen.fieldsByLine(22);
            if (errorMsgFields.length > 0 && errorMsgFields[0].val) {
                errorMsg = errorMsgFields[0].val;
            }

            // transaction not accepted
            await printScreen();
            throw("Error on screen 1313: " + errorMsg);
        }

        // create current billing schedule
        // screen = await terminal.readScreen();
        // setFieldValue(screen, /REQ:/, "1370");
        // setFieldValueIfEmpty(screen, /BANK:/, "21");
        // setFieldValueIfEmpty(screen, /APPL:/, "1");
        // setFieldValueIfEmpty(screen, /BATCH:/, data.batch);
        // setFieldValueIfEmpty(screen, /OBGOR:/, data.obgor_id);
        // setFieldValueIfEmpty(screen, /OBGAT:/, data.obgat);
        // await terminal.applyScreen(screen);
        // await terminal.sendCommand("enter");
        
        // screen = await terminal.readScreen(); 
        // setFieldValue(screen, /CHARGE CD/, "001");
        // setFieldValue(screen, /EFF FROM/, data.eff_from);
        // setFieldValue(screen, /PERIOD/, data.period);
        // setFieldValue(screen, /LEAD DAYS/, data.lead_days);
        // setFieldValue(screen, /BILL DUE DT/, data.due_dt);
        // setFieldValue(screen, /COLL METH/, data.coll_meth);
        // setFieldValue(screen, /MAT COL METH/, "11");
        // setFieldValue(screen, /INSTALL AMT/, data.install_amt);
        // setFieldValue(screen, /REPAY TYPE/, "1");    
        // await terminal.applyScreen(screen);
        // await printScreen();
        // await terminal.sendCommand("enter");
        // await printScreen();
        
        // change current obligations
        
        setFieldValue(screen, /REQ:/, "2305");
        setFieldValueIfEmpty(screen, /BANK:/, "21");
        setFieldValueIfEmpty(screen, /APPL:/, "1");
        setFieldValueIfEmpty(screen, /BATCH:/, data.batch);
        setFieldValueIfEmpty(screen, /OBGOR:/, data.obgor_id);
        setFieldValueIfEmpty(screen, /OBGAT:/, data.obgat);
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");

        screen = await terminal.readScreen(); 
        setFieldValue(screen, /DDA NUM/, data.dda);
        setFieldValue(screen, /DDA BNK TRNSIT/, data.transit);
        await printScreen();
        await terminal.applyScreen(screen);
        await terminal.sendCommand("enter");
        await printScreen();
        
        // check for errors
        screen = await terminal.readScreen();
        if (!screen.firstFieldWithText(/TRANSACTION ACCEPTED/)) {
            let errorMsg = "Unknown error, check logs for details";
            let errorMsgFields = screen.fieldsByLine(22);
            if (errorMsgFields.length > 0 && errorMsgFields[0].val) {
                errorMsg = errorMsgFields[0].val;
            }

            // transaction not accepted
            await printScreen();
            throw("Error on screen 2305: " + errorMsg);
        }

        data.success = true;

    } catch (err) {
        console.log("Caught error: " + err + " " + JSON.stringify(err));
        data.success = false;
        data.errorMessage = err;
    }

    clearData(data);    
    return resolve(data);
}

function clearData(data) {
    delete data.obgor_id;
    delete data.obgat;
    delete data.batch;
    delete data.eff_from;
    delete data.due_dt;
    delete data.period;
    delete data.spec_mail;
    delete data.lead_days;
    delete data.coll_meth;
    delete data.repay_type;
    delete data.mat_coll_meth;
    delete data.dda;
    delete data.transit;
    delete data.install_amt;
}

async function printScreen() {
    let ascii = await terminal.sendCommand("ascii");
    console.log(ascii);
}

function getFieldValue(screen, text, offset = 1, acceptFunc) {
    let field = screen.firstFieldWithText(text, acceptFunc);
    if (!field) {
        console.log("Not found: " + text);
        return;
    }
    field = screen.fieldByIndex(field.idx + offset);
    return field.val.trim();
}

function setFieldValue(screen, text, value, acceptFunc) {
    let field = screen.editableFieldAfterText(text, acceptFunc);
    if (!field) {
        console.log("Not found: " + text);
        return;
    }
    field.setValue(value);
}

function setFieldValueIfEmpty(screen, text, value, acceptFunc) {
    let field = screen.editableFieldAfterText(text, acceptFunc);
    if (!field) {
        console.log("Not found: " + text);
        return;
    }
    if (!field.val.trim()) {
        field.setValue(value);
    }
}

