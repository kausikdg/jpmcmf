/**
 * @module chrome
 */

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const logger = require('./logger');
const mainConfig = require.main.require('./config');
const transformEventDetector = require('./transformEventDetector');
let injectScript = require('./injectScript');
var fileDownloader = require('./fileDownloader');

const CHROME_FLAGS = ['--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-web-security',
    '--user-data-dir', // To allow '--disable-web-security' to work.
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    '--disable-popup-blocking',
    '--no-sandbox',
    '--incognito',
    '--utility'];

let chrome = null;
let mapTargets = {}; // All the "main" tabs - we reuse tabs when one is "closed", so we keep track of how many there are, and which ones are free to use.
let connectedApps = {}; // All the connected apps.
let chromeLaunched = false;
let startingApp = false;

function getAppConfig(appId) {
    return require.main.require('../transform/' + appId + '/config');
}

exports.startApp = async function (appId) {
    startingApp = true;
    if (!chromeLaunched) {
        chromeLaunched = await exports.launchChrome();
    }
    if (chromeLaunched) {
        let appConfig = getAppConfig(appId);
        let client = await exports.newClient(appId);
        connectedApps[appId] = { appId: appId, clients: [client] };
        fileDownloader.startMonitoring(connectedApps[appId]);

        await exports.setupClient(client, appId, appConfig);

        // Open the Start URL if there is one.
        if (appConfig.startURL) {
            await exports.openURL(client, appConfig.startURL);
        } else {
            logger.info(`[${appId}]: No start URL set.`);
        }
        //console.log(appId, "URL", client.webSocketUrl);
    }
    startingApp = false;
};

exports.isLaunched = function () {
    return chromeLaunched;
};

exports.stopApp = async function (appId) {
    let clientStack = connectedApps[appId].clients;
    // Close any popups.
    while (clientStack.length > 1) {
        let topClient = clientStack.shift();
        await new Page(topClient).close();
    }
    let client = clientStack[0];

    fileDownloader.stopMonitoring(connectedApps[appId]);

    delete connectedApps[appId];
    await exports.releaseClient(client);
};

exports.getClient = function (appId) {
    return connectedApps[appId].clients[0];
};

exports.getClientContainer = function (appId) {
    return connectedApps[appId];
};

exports.getFirstClientStack = function () {
    for (let app in connectedApps) {
        return connectedApps[app].clients;
    }
};

exports.refreshAppDescriptors = async function (appId) {
    let client = connectedApps[appId].clients[0];
    await exports.setInjectScript(client, injectScript.createInjectScript(appId));
    await exports.updateInjectedJS(client);
};

exports.getPreviousEvent = function (appId) {
    return connectedApps[appId]._previousEvent;
};

exports.isAppStarted = function (appId) {
    return connectedApps.hasOwnProperty(appId);
};

exports.getChromePort = function () {
    return chrome.port;
};

exports.launchChrome = async function () {
    try {
        logger.info('Chrome starting');
        let flags = CHROME_FLAGS;

        // Set proxy server if configured.
        if (mainConfig.chrome && mainConfig.chrome.proxy) {
            let proxyURL = config.proxy.host;
            if (mainConfig.chrome.proxy.scheme) { // Prefix with scheme if present.
                proxyURL = mainConfig.chrome.proxy.scheme + '://' + proxyURL;
            }
            if (mainConfig.chrome.proxy.port) { // suffix with port if provided.
                proxyURL = proxyURL + ':' + mainConfig.chrome.proxy.port;
            }
            flags = flags.concat('--proxy-server=' + proxyURL);
        }

        // If there is an auth server whitelist provided, use it.
        // See: https://www.chromium.org/developers/design-documents/http-authentication
        if (mainConfig.chrome && mainConfig.chrome.hasOwnProperty('authServerWhiteList')) {
            flags = flags.concat('--auth-server-whitelist=' + mainConfig.chrome.authServerWhiteList);
        }

        chrome = await chromeLauncher.launch({
            chromeFlags: flags
        });

        logger.info(`Chrome started (${chrome.pid}), debugger URL: http://localhost:${chrome.port}/`);
        let cdpOptions = { host: 'localhost', port: chrome.port };
        let versionInfo = await CDP.Version(cdpOptions);
        // let protocol = await CDP.Protocol({ host: 'localhost', port: chrome.port, remote: true });
        // console.log(JSON.stringify(protocol.descriptor, null, 2));
        //logger.info(`Connected to ${versionInfo.Browser} at URL ${versionInfo.webSocketDebuggerUrl}`);
        chrome._userAgent = versionInfo['User-Agent'];
        chrome._version = versionInfo.Browser;
        logger.info(`Chrome UA: ${versionInfo['User-Agent']}`);
        let existingTargets = await CDP.List(cdpOptions);
        for (let existingTarget of existingTargets) {
            existingTarget.free = true;
            mapTargets[existingTarget.id] = existingTarget;
        }
        return true;
    } catch (err) {
        logger.warn(`Chrome failed to start: ${err}`);
        return false;
    }
};

exports.newClient = async function (appId) {
    let targetToUse = null;
    for (let existingTargetId of Object.keys(mapTargets)) {
        let existingTarget = mapTargets[existingTargetId];
        if (existingTarget.free) {
            existingTarget.free = false;
            targetToUse = existingTarget;
            break;
        }
    }
    if (!targetToUse) {
        // Create a new target.
        targetToUse = await CDP.New({ host: 'localhost', port: chrome.port });
        targetToUse.free = false;
        mapTargets[targetToUse.id] = targetToUse;
    }
    logger.info(`[${appId}]: Using target with id ${targetToUse.id}`);
    let client = await CDP({ host: 'localhost', port: chrome.port, target: targetToUse.id });
    return client;
};

exports.setupClient = async function (client, appId, appConfig, noResize, authenticationConfig) {
    client.appId = appId;

    exports.setAppConfig(client, appConfig);
    exports.setInjectScript(client, injectScript.createInjectScript(client.appId));

    if (appConfig.viewportSize && !noResize) {
        await exports.setViewPortSize(client, appConfig.viewportSize);
    }
    if (appConfig.userAgentSuffix) {
        await exports.setUserAgentSuffix(client, appConfig.userAgentSuffix);
    } else if (appConfig.userAgentReplacement) {
        await exports.setUserAgent(client, appConfig.userAgentReplacement);
    }

    listenToNetworkEvents(client);
    listenToPageEvents(client);
    listenToDOMEvents(client);
    listenToRuntimeEvents(client);
    listenToTargetEvents(client);
    listenToSecurityEvents(client);

    client.chromeVersion = chrome._version;

    await client.Network.enable();
    if (authenticationConfig) {
        await setupAuthentication(client, authenticationConfig);
    }

    await client.Security.enable();
    await client.Security.setOverrideCertificateErrors({ override: true });

    await client.Page.enable();
    await client.DOM.enable();
    await client.Runtime.enable();
    await client.Target.setDiscoverTargets({ discover: true });
    await client.Target.setAttachToFrames({ value: true });
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: fileDownloader.getDownloadFolder(appId) });
    if (appConfig.useCookies) {
        await setCookies(client);
    }
    return client;
};

async function setupAuthentication(client, authenticationConfig) {
    if (!authenticationConfig.username) {
        delete client.authenticationConfig;
        if (client.chromeVersion.indexOf("/62") >= 0) {
            // START: Chrome 62:
            await client.Network.setRequestInterceptionEnabled({ enabled: false });
            // END: Chrome 62.
        } else {
            // START: Chrome 64 or greater:
            await client.Network.setRequestInterception({ patterns: [] });
            // END: Chrome 64 or greater.
        }
        return;
    }

    client.authenticationConfig = {
        username: authenticationConfig.username,
        password: authenticationConfig.password,
        arrUrlPatterns: authenticationConfig.arrURLPatterns
    };

    if (client.chromeVersion.indexOf("/62") >= 0) {
        // START: Chrome 62:
        let requestInterceptionRequest = {
            enabled: true
        };
        if (authenticationConfig.arrURLPatterns) {
            requestInterceptionRequest.patterns = authenticationConfig.arrURLPatterns;
        }
        await client.Network.setRequestInterceptionEnabled(requestInterceptionRequest);
        // END: Chrome 62.
    } else {
        // START: Chrome 64 or greater:
        let patterns = [];
        if (authenticationConfig.arrURLPatterns) {
            for (let urlPattern of authenticationConfig.arrURLPatterns) {
                patterns.push({
                    interceptionStage: 'Response',
                    urlPattern: urlPattern
                });
            }
        } else {
            patterns.push({
                interceptionStage: 'Response'
            });
        }
        await client.Network.setRequestInterception({ patterns: patterns });
        // END: Chrome 64 or greater.
    }

};

async function setCookies(client) {
    // If cookies are provided during launch, add the cookies 
    if (launchparams.hasOwnProperty('cookies')) {
        await client.Network.setCookies(launchparams.cookies);
    }
}

async function unsetupClient(client) {
    client.removeAllListeners();

    if (client._contextCreatedTimeoutMap) {
        let timeoutKeys = Object.keys(client._contextCreatedTimeoutMap);
        for (let key of timeoutKeys) {
            clearTimeout(client._contextCreatedTimeoutMap[key]);
            delete client._contextCreatedTimeoutMap[key];
        }
    }
    if (client._checkStateTimeout) {
        clearTimeout(client._checkStateTimeout);
    }
    delete client._contextCreatedTimeoutMap;
    delete client._checkStateTimeout;
    delete client._injectedJSExecutionContextId;
    delete client._injectScript;
    delete client._appConfig;
    delete client._forceNextStateCheck;
    delete client.authChallengeInterceptions;

    await setupAuthentication(client, { username: null });
    await client.Network.disable();
    await client.Page.disable();
    await client.DOM.disable();
    await client.Runtime.disable();
    await client.Target.setDiscoverTargets({ discover: false });
    await client.Target.setAttachToFrames({ value: false });

    return client;
}

exports.setInjectScript = function (client, injectScript) {
    client._injectScript = injectScript;
};

exports.setAppConfig = function (client, appConfig) {
    client._appConfig = appConfig;
};

exports.openURL = async function (client, url) {
    await client.Page.navigate({ url: url });
};

exports.setUserAgent = async function (client, userAgent) {
    await client.Network.setUserAgentOverride({ userAgent: userAgent });
};

exports.setUserAgentSuffix = async function (client, userAgentSuffix) {
    let newUserAgent = chrome._userAgent + ' ' + userAgentSuffix;
    await client.Network.setUserAgentOverride({ userAgent: newUserAgent });
};

exports.setViewPortSize = async function (client, newBounds) {
    let existingWidthHeight = await client.Runtime.evaluate({ expression: 'window.innerWidth + \'x\' + window.innerHeight' });
    logger.info(`[${client.appId}]: Changing window size from ${existingWidthHeight.result.value} to ${newBounds.width}x${newBounds.height}`);
    await client.Emulation.setDeviceMetricsOverride({ width: newBounds.width, height: newBounds.height, mobile: false, deviceScaleFactor: 0 });
};

exports.releaseClient = async function (client) {
    // Navigate to about blank and free up the client.
    await unsetupClient(client);
    await client.Page.navigate({ url: 'about:blank' });
    mapTargets[client.target].free = true;
    delete client.appId; // Remove the appId.
};

exports.stopChrome = async function () {
    if (chrome) {
        await chrome.kill();
    }
};

function checkState(client) {
    if (connectedApps[client.appId].clients[0] == client) {
        if (client._injectedJSExecutionContextId > 0) {
            if (client._checkStateTimeout) {
                clearTimeout(client._checkStateTimeout);
            }
            client._checkStateTimeout = setTimeout(async function () {
                //console.log(`[${client.appId}] Checking state, exec id: ${client._injectedJSExecutionContextId}`);
                await transformEventDetector.test(connectedApps[client.appId], client._forceNextStateCheck);
                delete client._forceNextStateCheck;
            }, client._appConfig.eventDetection.debounceTime);
        }
    }
}

exports.updateInjectedJS = async function (client) {
    injectJS(client, client._injectedJSExecutionContextId);
};

function injectJS(client, id) {
    //logger.info(`[${client.appId}] Injecting Powwow JS and descriptors into context=${_id}`);
    client.Runtime.evaluate({ expression: client._injectScript, contextId: id }, function (error, result) {
        if (result.exceptionDetails) {
            logger.error(`[${client.appId}]: Error when injecting JS:`, result.exceptionDetails);
        } else {
            client._injectedJSExecutionContextId = id;
            //console.log(client.appId, result.result.objectId, client._injectedJSExecutionContextId);
            checkState(client);
        }
    });
}

/* eslint-disable no-unused-vars */
function listenToNetworkEvents(client) {
    client.Network.resourceChangedPriority(function (params) { /* logger.info(`[${client.appId}]:`, "Network.resourceChangedPriority"); */ });
    client.Network.requestWillBeSent(function (params) {
        if (client._appConfig.eventDetection.debug) {
            logger.info(`[${client.appId}]: Network.requestWillBeSent`, params);
        }
    });
    client.Network.requestServedFromCache(function (params) { /* logger.info(`[${client.appId}]:`, "Network.requestServedFromCache"); */ });
    client.Network.responseReceived(function (params) {
        if (client._appConfig.eventDetection.debug) {
            logger.info(`[${client.appId}]: Network.responseReceived`, params);
        }
    });
    client.Network.dataReceived(function (params) { /* logger.info(`[${client.appId}]:`, "Network.dataReceived"); */ });
    client.Network.loadingFinished(function (params) {
        if (client._appConfig.eventDetection.debug) {
            logger.info(`[${client.appId}]:`, "Network.loadingFinished", params);
        }
    });
    client.Network.loadingFailed(function (params) {
        if (client._appConfig.eventDetection.debug) {
            logger.info(`[${client.appId}]:`, "Network.loadingFailed", params);
        }
    });
    client.Network.webSocketWillSendHandshakeRequest(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketWillSendHandshakeRequest"); */ });
    client.Network.webSocketHandshakeResponseReceived(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketHandshakeResponseReceived"); */ });
    client.Network.webSocketCreated(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketCreated"); */ });
    client.Network.webSocketClosed(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketClosed"); */ });
    client.Network.webSocketFrameReceived(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketFrameReceived"); */ });
    client.Network.webSocketFrameError(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketFrameError"); */ });
    client.Network.webSocketFrameSent(function (params) { /* logger.info(`[${client.appId}]:`, "Network.webSocketFrameSent"); */ });
    client.Network.eventSourceMessageReceived(function (params) { /* logger.info(`[${client.appId}]:`, "Network.eventSourceMessageReceived");  */ });
    client.Network.requestIntercepted(function (params) {
        if (client._appConfig.eventDetection.debug) {
            logger.info(`[${client.appId}]:`, "Network.requestIntercepted", params);
        }
        if (params.authChallenge) {
            if (!client.authChallengeInterceptions) { client.authChallengeInterceptions = {}; }
            if (client.authChallengeInterceptions[params.interceptionId]) {
                // we already tried and failed
                delete client.authChallengeInterceptions[params.interceptionId];
                logger.info(`[${client.appId}]:`, "Authentication failed, cancelling auth request.");
                client.Network.continueInterceptedRequest({
                    'interceptionId': params.interceptionId,
                    'authChallengeResponse': {
                        'response': 'CancelAuth'
                    }
                });
            } else {
                client.authChallengeInterceptions[params.interceptionId] = true;
                logger.info(`[${client.appId}]:`, "Received authentication challenge, providing credentials for username:", client.authenticationConfig.username);
                client.Network.continueInterceptedRequest({
                    'interceptionId': params.interceptionId,
                    'authChallengeResponse': {
                        'response': 'ProvideCredentials',
                        'username': client.authenticationConfig.username,
                        'password': client.authenticationConfig.password
                    }
                });
            }
            // When we got an authChallenge, no matter what happens, we want to make sure
            // we get to a new state.  This is to handle cases where the user entered in the
            // wrong password twice in a row.
            client._forceNextStateCheck = true;
        } else {
            client.Network.continueInterceptedRequest({ 'interceptionId': params.interceptionId });
        }
    });
}

function listenToPageEvents(client) {
    client.Page.loadEventFired(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.loadEventFired', params);
    });
    // client.Page.navigationRequested(function (params) {
    //     logger.info(`[${client.appId}]:`, "Page.navigationRequested");
    // });
    client.Page.javascriptDialogOpening(function (params) {
        logger.info(`[${client.appId}]:`, 'Page.javascriptDialogOpening', params);
        transformEventDetector.javascriptDialogOpening(connectedApps[client.appId], params);
    });
    client.Page.javascriptDialogClosed(function (params) {
        logger.info(`[${client.appId}]:`, 'Page.javascriptDialogClosed', params);
        client._forceNextStateCheck = true;
        checkState(client);
    });
    client.Page.domContentEventFired(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.domContentEventFired', params);
    });
    client.Page.frameAttached(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameAttached', params);
    });
    client.Page.frameNavigated(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameNavigated', { frameId: params.frame.id, parentFrameId: params.frame.parentId, name: params.frame.name, url: params.frame.url });
    });
    client.Page.frameDetached(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameDetached');
    });
    client.Page.frameResized(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameResized');
    });
    client.Page.frameScheduledNavigation(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameScheduledNavigation');
    });
    client.Page.frameStartedLoading(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameStartedLoading', params);
    });
    client.Page.frameStoppedLoading(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.frameStoppedLoading', params);
        client.DOM.getDocument({ depth: -1, pierce: true }).then(function () {
            checkState(client);
        });
    });

    // client.Page.windowOpen(function (params) {
    //    if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'Page.windowOpen', params);
    // });
}

function listenToDOMEvents(client) {
    client.DOM.attributeModified(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.attributeModified', params);
        checkState(client);
    });
    client.DOM.attributeRemoved(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.attributeRemoved', params);
        checkState(client);
    });
    client.DOM.characterDataModified(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.characterDataModified', params);
        checkState(client);
    });
    client.DOM.childNodeInserted(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.childNodeInserted', { parentNodeId: params.parentNodeId, nodeId: params.node.nodeId, nodeName: params.node.nodeName });
        // If an IFRAME is added, re-do getDocument so that we start getting DOM events from
        // within the IFRAME.
        if (params.node.nodeName != '#text' || params.node.nodeName != '#comment') {
            client.DOM.getDocument({ depth: -1, pierce: true }).then(function () {
                checkState(client);
            });
        } else {
            checkState(client);
        }
    });
    client.DOM.childNodeRemoved(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.childNodeRemoved', params);
        checkState(client);
    });
    client.DOM.childNodeCountUpdated(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.childNodeCountUpdated', params);
        checkState(client);
    });
    client.DOM.distributedNodesUpdated(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.distributedNodesUpdated', params);
        checkState(client);
    });
    client.DOM.setChildNodes(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.setChildNodes', params);
        checkState(client);
    });
    client.DOM.documentUpdated(function (params) {
        if (client._appConfig.eventDetection.debug) logger.info(`[${client.appId}]:`, 'DOM.documentUpdated', params);
        client.DOM.getDocument({ depth: -1, pierce: true }).then(function () {
            checkState(client);
        });
    });
}
/* eslint-disable no-unused-vars */

function initializeExecutionContextIfNotDestroyed(client, executionContextId) {
    // Wait a bit before injecting JS in case execution context is destroyed later.
    if (!client._contextCreatedTimeoutMap) {
        client._contextCreatedTimeoutMap = {};
    }
    delete client._contextCreatedTimeoutMap[executionContextId];
    // logger.info("Testing if should inject in context:", executionContextId);
    client._contextCreatedTimeoutMap[executionContextId] = setTimeout(function () {
        client.Runtime.evaluate({ contextId: executionContextId, expression: 'window === window.top' }, function (err, response) {
            if (response.result && response.result.value === true) {
                // logger.info("Injecting in context now:", executionContextId);
                injectJS(client, executionContextId);
                // logger.info("Injected in context:", executionContextId);
            }
        });
    }, 0);
}

function listenToRuntimeEvents(client) {

    client.Runtime.executionContextCreated(function (params) {
        if (client._appConfig.eventDetection.debug)
            logger.info(`[${client.appId}]:`, "Runtime.executionContextCreated", params);
        if (params.context.origin == '://') {
            if (client._appConfig && client._appConfig.hasOwnProperty('startURL') && client._appConfig.startURL.indexOf('about') == 0) {
                // Special case for "about:*" - this is a valid execution context.
            } else {
                return;
            }
        }
        initializeExecutionContextIfNotDestroyed(client, params.context.id);
    });

    client.Runtime.executionContextDestroyed(function (params) {
        if (client._appConfig.eventDetection.debug)
            logger.info(`[${client.appId}]:`, "Runtime.executionContextDestroyed", params);
        if (client._contextCreatedTimeoutMap && client._contextCreatedTimeoutMap[params.executionContextId]) {
            clearTimeout(client._contextCreatedTimeoutMap[params.executionContextId]);
            delete client._contextCreatedTimeoutMap[params.executionContextId];
        }
    });

    client.Runtime.executionContextsCleared(function (params) {
        if (client._appConfig.eventDetection.debug)
            logger.info(`[${client.appId}]:`, "Runtime.executionContextsCleared", params);
        if (client._contextCreatedTimeoutMap) {
            let timeoutKeys = Object.keys(client._contextCreatedTimeoutMap);
            for (let key of timeoutKeys) {
                clearTimeout(client._contextCreatedTimeoutMap[key]);
                delete client._contextCreatedTimeoutMap[key];
            }
        }
        delete client._contextCreatedTimeoutMap;
        delete client._injectedJSExecutionContextId;
    });

    client.Runtime.exceptionThrown(function (params) { logger.info(`[${client.appId}]:`, "Runtime.exceptionThrown", params); });
    client.Runtime.exceptionRevoked(function (params) { logger.info(`[${client.appId}]:`, "Runtime.exceptionRevoked", params); });

    client.Runtime.consoleAPICalled(function (params) {
        var logEntry = `[${client.appId}]: console.${params.type}: `;
        for (var i = 0; i < params.args.length; i++) {
            if (i > 0) {
                logEntry += ' ';
            }
            logEntry += params.args[i].value;
        }
        logger.info(logEntry);
    });

    client.Runtime.inspectRequested(function (params) { logger.info(`[${client.appId}]:`, 'Runtime.inspectRequested', params); });
}

function listenToTargetEvents(client) {
    client.Target.targetCreated(async function (params) {
        if (client._appConfig.eventDetection.debug)
            logger.info(`[${client.appId}]:`, 'Target.targetCreated', params);
        if (!startingApp && params.targetInfo.type == 'page' && client.target !== params.targetInfo.targetId) {
            let clientstack = connectedApps[client.appId].clients;
            for (var c of clientstack) {
                if (c.target == params.targetInfo.targetId) {
                    return;
                }
            }
            logger.info(`[${client.appId}]:`, "Attaching to new window with targetId =", params.targetInfo.targetId);
            let newClient = await CDP({ target: params.targetInfo.targetId, host: 'localhost', port: chrome.port });
            connectedApps[client.appId].clients.unshift(newClient);
            await exports.setupClient(newClient, client.appId, client._appConfig, true, client.authenticationConfig);
        }
    });
    client.Target.targetDestroyed(function (params) {
        let clientstack = connectedApps[client.appId].clients;
        for (var i = 0; i < clientstack.length; i++) {
            if (clientstack[i].webSocketUrl.indexOf(params.targetId) >= 0) {
                logger.info(`[${client.appId}]:`, "Detaching from window with targetId =", params.targetId, "attaching to previous window.");
                clientstack.splice(i, 1);
                if (i == 0) {
                    checkState(clientstack[0]);
                }
                return;
            }
        }
        if (client._appConfig.eventDetection.debug)
            logger.info('Target.targetDestroyed', params);
    });
    client.Target.attachedToTarget(function (params) { logger.info(`[${client.appId}]:`, 'Target.attachedToTarget', params); });
    client.Target.detachedFromTarget(function (params) { logger.info(`[${client.appId}]:`, 'Target.detachedFromTarget', params); });
    client.Target.receivedMessageFromTarget(function (params) { logger.info(`[${client.appId}]:`, 'Target.receivedMessageFromTarget', params); });
}

function listenToSecurityEvents(client) {
    client.Security.certificateError(function (params) {
        client.Security.handleCertificateError({
            eventId: params.eventId,
            action: 'continue'
        });
    });
}
