'use strict';

const EventEmitter = require('events');

class Connection extends EventEmitter {}
const connection = new Connection();

exports.init = function() {
    require('powwow-server-common').wsConnectionListener(connection);
};

exports.handler = function(request, response) {
    if (request.method === 'POST') {
        readData(request).then(function(data) {
            return submitData(data);
        }).then(function(result) {
            response.writeHead(200, { 
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json-rpc'
            });
            response.write(result, 'utf8');
            response.end();
        });

        return true;
    }
    return false;
};

function readData(request) {
    return new Promise(function(resolve, reject) {
        var buffer = "";

        request.on('data', function(data) {
            buffer += data;
        });

        request.on('end', function() {
            resolve(buffer);
        });

        request.on('error', function(error) {
            reject(error);
        });
    });
};

function submitData(data) {
    connection.emit('message', {
        type: 'utf8',
        utf8Data: data
    });

    return waitForResponse();
};

function waitForResponse() {
    return new Promise(function(resolve, reject) {
        connection.once('result', function(message) {
            resolve(message);
        });
    });
};

Connection.prototype.send = function(message) {
    this.emit('result', message);
};