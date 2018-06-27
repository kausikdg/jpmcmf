angular.module('webexplorer').service('injectableService', function (
    $q, explorerService, commonHelperService, xBatchRequest
) {
    'use strict';

    /**
     * @namespace injectableService
     */
    var injectableService = this;

    /**
     * Cache of all injectables (except Page Models)
     * @type {Object.<E_Injectable>}
     */
    this.injectables = {};
    this.baseControls = ['action', 'attrib', 'checkbox', 'computedstyle', 'constant', 'exists', 'hasClass', 'hasComputedstyle', 'none', 'property', 'radio', 'select', 'style', 'text', 'url'];
    this.powwow = {
        script: null
    };

    // --------------------------------------------------------------------------------------------
    // INJECTABLES:
    // --------------------------------------------------------------------------------------------

    this.getInjectFiles = function () {
        var deferred = $q.defer();

        explorerService.injectables.getInjectFiles().then(function (injectables) {
            injectableService.injectables = injectables || {};
            _processFiles();
            deferred.resolve(injectables);
        }).then(deferred.reject);

        return deferred.promise;
    };

    this.getInjectScripts = function () {
        var deferred = $q.defer();

        explorerService.injectables.getInjectScripts().then(function (scripts) {
            var script = _processScripts(scripts);
            injectableService.powwow.script = script;
            deferred.resolve(script);
        }).then(deferred.reject);

        return deferred.promise;
    };

    this.getPowwowScript = function () {
        return this.powwow.script + injectableService.append('powwow');
    };

    this.getInjectString = function () {
        var injectScriptString = "";
        injectScriptString += this.powwow.preinject.source + "\n";

        _.each(injectableService.injectables, function (folder, type) {
            _.each(folder, function (file) {
                injectScriptString += `${file.src}\n`;
                injectScriptString += `window.powwow['${type.toLowerCase()}']['${file.name}']=exports;\n`
                injectScriptString += injectableService.append(type.toLowerCase(), file.name) + "\n";
            });
        });

        injectScriptString += this.powwow.postinject.source + "\n";

        return injectScriptString;
    };

    this.validateName = function (siblings, name) {
        let id = commonHelperService.filterName(name);
        let valid = !!id && name === id;
        let unique = _.pluck(siblings, 'name').indexOf(id) < 0;
        return valid && unique;
    };

    this.append = function () {
        let name = [].slice.call(arguments).join('.');
        return `//# sourceURL=${name}\n`;
    }

    function _processFiles() {
        _.each(injectableService.injectables, function (folder, type) {
            _.each(folder, function (file) {
                file.type = type;
            });
        });
    }

    function _processScripts(scripts) {
        var files = [];
        var scriptToEvaluate = "";

        if (scripts.length < 3) {
            return scriptToEvaluate;
        }

        files.push({ source: _.find(scripts, { name: 'common' }).src });
        injectableService.powwow.preinject = { source: _.find(scripts, { name: 'preinject' }).src };
        injectableService.powwow.postinject = { source: _.find(scripts, { name: 'postinject' }).src };
        // files.push({ source: _.find(scripts, { name: 'preinject' }).src });

        for (var i = 0; i < files.length; i++) {
            scriptToEvaluate += files[i].source + '\n';
        }

        return scriptToEvaluate;
    }
});