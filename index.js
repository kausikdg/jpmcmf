'use strict';

const _ = require('lodash');
const rp = require('request-promise-native');
var URL = require('url');
var xml2jsonParser = require('xml-js');

var cookiejar = rp.jar();

var cookies = require('tough-cookie');
var Cookie = cookies.Cookie;

const configFile = process.env['config'] ? require(process.env['config']) : require.main.require('./config');
const config = configFile.connectors.HPPPM;

let savedToken = '';
let savedUser = '';
let messageType = 'alt=application/json';

var weeks = [];
var allDefaultDays = [];

// Checking for valid basic autharization token
exports.authenticate = async function (data) {
    //return {"blah": "blah blah"};
    var token = '';
    if (data.username || data.password) {
        token = _token(data.username, data.password);
    } else if (data.token) {
        token = data.token;
    } else {
        token = config.basicAuthToken;
    }

    let options = {
        headers: {
            'Authorization': 'Basic ' + token
        },
        body: JSON.stringify({})
    };
    var res;
    try {
        res = await _get('/authenticate', options);
    } catch (err) {
        res = { "error" : "Something went wrong"};
        return res;
    }

    // if we get here, login was successful
    savedToken = token;
    savedUser = data.username;
    return cleanJson(res);
}

function _token(username, password) {
    return new Buffer(username + ':' + password).toString('base64');
}

// Getting Time Periods (time period id given a time)
exports.getTimePeriods = async function (data) {
    if (!data.date) {
        let date = new Date();
        data.date = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + 'T:00:00:00Z'
    }

    let res = await _get('/timePeriods/date/' + data.date);

    // creating the week structure
    let cleanRes = cleanJson(res)
    var startDate = new Date(cleanRes.periods.period.startDate);
    var endDate = new Date(cleanRes.periods.period.endDate);
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var weekNo = 0;
    for (var i = 0; startDate < endDate;) {
        allDefaultDays.push({ "dayOfWeek": days[startDate.getDay()], "date": startDate.getDate() });

        // increment the day and then check if it completed a week
        i++;
        // Are we at a week boundy? If yes, then insert in into weeks and reset allDefaultDays
        if ((i % 7) === 0) {
            weeks[weekNo] = allDefaultDays;
            allDefaultDays = [];
            weekNo++;
        }

        startDate.setDate(startDate.getDate() + 1);
    }
    // insert the last week in the buffer into the weeks array
    if (allDefaultDays.length > 0) {
        weeks[weekNo] = allDefaultDays;
    }

    cleanRes.periods.period.weeks = weeks;

    return cleanRes;
};

// Getting Time Sheets (All time sheets per owner id per time period)
exports.getTimeSheetsForApproval = async function (data) {
    let res = await _get('/timeSheets?ownerUserId=' + data.ownerUserId + '&periodId=' + data.periodId);
    return cleanJson(res);
};

// Getting a Time Sheet (single time sheet per time sheet id)
exports.getTimeSheetDetails = async function (data) {
    let res = await _get('/timeSheets/id/' + data.timeSheetId);
    return cleanJson(res);
};

// Getting a Time Sheet Line Items (per time sheet id)
exports.getTimeSheetLineItems = async function (data) {
    let res = await _get('/timeSheets/id/timeSheetLines/' + data.timeSheetId);

    let cleanRes = cleanJson(res)
    for (var i = 0; i < cleanRes.timeSheetLines.timeSheetLine.length; i++) {
        var efforts = [];
        for (var a = 0; a < weeks.length; a++) {
            var effort = [];
            for (var b = 0; b < weeks[a].length; b++) {
                var dailyEffort = weeks[a][b];
                dailyEffort.effort = 0;
                effort.push(dailyEffort);
            }
            efforts.push(effort);
        }

        if (cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual) {
            // convert object in a single item array
            if (!Array.isArray(cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual)) {
                let temp = Object.assign({}, cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual);;
                delete cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual;
                cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual = [];
                cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual.push(temp);
            }
            for (var j = 0; j < cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual.length; j++) {
                if (cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts) {
                    // convert object in a single item array
                    if (!Array.isArray(cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts)) {
                        let temp = Object.assign({}, cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts);;
                        delete cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts;
                        cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts = [];
                        cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts.push(temp);
                    }
                    for (var k = 0; k < cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts.length; k++) {
                        addEffort(efforts, cleanRes.timeSheetLines.timeSheetLine[i].actuals.actual[j].efforts[k])
                    }
                }
            }
        }
        
        cleanRes.timeSheetLines.timeSheetLine[i].efforts = JSON.parse(JSON.stringify(efforts));
    }

    return cleanRes;
};

// Approve Timesheet (by time sheet id)
exports.approveTimeSheet = async function (data) {
    var body = {}
    body['tns:approveActions'] = { "_attributes": { "xmlns:tns": "http://www.hp.com/ppm/tm/" } };
    body['tns:approveActions'].type = { "_text": data.type };
    body['tns:approveActions'].note = { "_text": data.note };
    body['tns:approveActions'].asynchronized = { "_text": data.asynchronized };
    body['tns:approveActions'].action = { "_text": data.action };
    body['tns:approveActions'].approveAction = { "timeSheetId": { "_text": data.timeSheetId } };

    let options = {
        body: xml2jsonParser.js2xml(body, { compact: true, spaces: 4 })
    };

    let res = await _post('/timesheets/approveTimeSheets', options);
    return cleanJson(res);
};

// Logout
exports.logout = function () {
    savedToken = '';
    savedUser = '';
};

// POST
async function _post(url, options) {
    let _options = _.merge({
        url: config.baseUrl + url,
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + savedToken,
            'Content-Type': 'application/xml'
        },
        jar: cookiejar
    }, options);
    var res = await rp(_options)
        .then(function (body) {
            var parsedBody = JSON.parse(body);
            return parsedBody;
        })
        .catch(function (err) {
            throw (new Error(err));
        });

    return res;
}

// GET
async function _get(url, options) {
    var finalUrl = config.baseUrl + url;
    var parsedUrl = URL.parse(finalUrl, true);
    if (parsedUrl.search) {
        finalUrl = finalUrl + '&' + messageType
    } else {
        finalUrl = finalUrl + '?' + messageType
    }
    let _options = _.merge({
        url: finalUrl,
        method: 'GET',
        headers: {
            'Authorization': 'Basic ' + savedToken
        },
        simple: false,
        resolveWithFullResponse: true,
        jar: cookiejar
    }, options);

    let res = await rp(_options);

    if (res.statusCode === 200) {
        var cookie;
        if (res.headers['set-cookie']) {
            if (res.headers['set-cookie'] instanceof Array) {
                cookie = res.headers['set-cookie'].map(Cookie.parse);
            } else {
                cookie = [Cookie.parse(res.headers['set-cookie'])];
            }
            for (var i = 0; i < cookie.length; i++) {
                cookiejar.setCookie(cookie[i]);
            }
        }
        return JSON.parse(res.body);
    } else if (res.statusCode === 401) {
        throw (new Error("Invalid username or password"));
    } else {
        throw (new Error(res.statusMessage));
    }
}

function cleanJson(res) {
    var resString = JSON.stringify(res);
    resString = resString.replace('ns2:', '');
    resString = resString.replace(':ns2', '');

    return JSON.parse(resString);
}

function addEffort(efforts, value) {
    for (var i = 0; i < efforts.length; i++) {
        for (var j = 0; j < efforts[i].length; j++) {
            if (efforts[i][j].date === Number(value.dayNum)) {
                efforts[i][j].effort = efforts[i][j].effort + Number(value.effort);
            }
        }
    }
}