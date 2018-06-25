const assert = require('assert');
const should = require('chai').should();
const rs = require('../');
const config = require('./config').connectors.HPPPM;

describe('Authenticate', () => {
    it('should fail after an invalid login', async () => {
        try {
            await rs.authenticate({
                username: 'fake',
                password: 'user'
            });
            should.fail('No error thrown');
        } catch (err) {
            err.should.exist;
            err.message.should.exist;
        }
    });

    it('should work', async () => {
        let res = await rs.authenticate({
            username: 'charles',
            password: 'bony'
        });
        res.should.exist;
    });

    it('should succeed after a valid login', async () => {
        let res = await rs.authenticate({
            token: config.basicAuthToken
        });
        res.should.exist;
    });

    it('should allow signout', async () => {
        await rs.logout();
    });
});

describe('Connector', () => {
    before(async () => {
        await rs.authenticate({
            token: config.basicAuthToken
        });
    });

    describe('Get Time Period', () => {
        it('Should return the time period against a given time.', async () => {
            var options = {};
            //options.date = "2018-04-24T00:00:00.000-08:00";

            let res = await rs.getTimePeriods(options);
            console.log(JSON.stringify(res, null, 2));
            res['periods'].period.exist;
        });
    });

    describe('Get Time Sheets for Approval', () => {
        it('Should list the time sheets waiting for approval', async () => {
            var options = {};
            options.ownerUserId = "234237";
            options.periodId = "102320";

            let res = await rs.getTimeSheetsForApproval(options);
            console.log(JSON.stringify(res, null, 2));
            res['timesheets'].exist;
            res['timesheets'].timeSheet.should.be.an('array').that.is.not.empty;
        });
    });

    describe('Get Time Sheet Details', () => {
        it('Should return details of a time sheet given a time sheet id', async () => {
            var options = {};
            options.timeSheetId = "446363";

            let res = await rs.getTimeSheetDetails(options);
            console.log(JSON.stringify(res, null, 2));
            res['timesheet'].exist;
        });
    });


    describe('Get Time Sheet Line Items', () => {
        it('Should return time card line items given a time sheet id', async () => {
            var options = {};
            options.timeSheetId = "446363";

            let res = await rs.getTimeSheetLineItems(options);
            console.log(JSON.stringify(res, null, 2));
            res['timeSheetLines'].exist;
            res['timeSheetLines'].timeSheetLine.should.be.an('array').that.is.not.empty;
        });
    });

    describe('Approve time sheet', () => {
        it('Should return success or failure', async () => {
            var options = {};
            options.type = "1";
            options.note = "This is Approved";
            options.asynchronized = true;
            options.action = "1";
            options.timeSheetId = "446363";

            let res = await rs.approveTimeSheet(options);
            console.log(JSON.stringify(res, null, 2));
            res['Status'].exist;
        });
    });

    after(async () => {
        await rs.logout();
    });
});
