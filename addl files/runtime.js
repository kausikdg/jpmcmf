angular.module('webexplorer').service('runtimeEventCallbacks', function (
    injectableService, pageModelService, pageService, powwowService
) {
    'use strict';

    var _contextCreatedTimeoutMap = {};

    function initializeExecutionContextIfNotDestroyed(executionContextId) {
        delete _contextCreatedTimeoutMap[executionContextId];
        // logger.info("Testing if should inject in context:", executionContextId);
        _contextCreatedTimeoutMap[executionContextId] = setTimeout(function () {
            powwowService.evaluate({ contextId: executionContextId, expression: 'window === window.top' })
                .then(function (response) {
                    if (response.result && response.result.value === true) {
                        // logger.info("Injecting in context now:", executionContextId);
                        clearAllInjections(executionContextId)
                            .then(() => injectPowwowScript(executionContextId))
                            .then(() => injectDescriptors(executionContextId))
                            .then(() => injectInjectables(executionContextId))
                            .then(() => {
                                pageService.getMatchedConnections();
                                window.document.dispatchEvent(new CustomEvent("POWWOW_INJECTED"));
                            })
                            .catch(() => {
                                console.log("Failed to initialize ExecutionContext");
                            });
                        // logger.info("Injected in context:", executionContextId);
                    }
                }).catch(function (error) {
                    console.log("Failed window === window.top", error);
                });
        }, 0);
    }

    this.executionContextCreated = function (params) {
        initializeExecutionContextIfNotDestroyed(params.context.id);
    };

    this.executionContextDestroyed = function (params) {
        if (_contextCreatedTimeoutMap && _contextCreatedTimeoutMap[params.executionContextId]) {
            clearTimeout(_contextCreatedTimeoutMap[params.executionContextId]);
            delete _contextCreatedTimeoutMap[params.executionContextId];
        }
    };

    this.executionContextsCleared = function (params) {
        if (_contextCreatedTimeoutMap) {
            let timeoutKeys = Object.keys(_contextCreatedTimeoutMap);
            for (let key of timeoutKeys) {
                clearTimeout(_contextCreatedTimeoutMap[key]);
                delete _contextCreatedTimeoutMap[key];
            }
        }
        _contextCreatedTimeoutMap = {};
    };

    // Helpers

    function clearAllInjections(contextId) {
        return powwowService.evaluate({
            contextId: contextId,
            expression: 'window.powwow = window.powwow || {};'
        });
    }

    function injectPowwowScript(contextId) {
        let powwowScript = injectableService.getPowwowScript();
        return powwowService.evaluate({
            contextId: contextId,
            expression: powwowScript
        });
    }

    function injectDescriptors(contextId) {
        let descriptors = pageModelService.getAllDescriptorsToInject();
        return powwowService.evaluate({
            contextId: contextId,
            expression: descriptors
        });
    }

    function injectInjectables(contextId) {
        return powwowService.evaluate({
            contextId: contextId,
            expression: injectableService.getInjectString()
        });
    }

});