var _ = require('underscore');
var join = require('path').join;
var fs = require('../../services/fs');

/**
 * @param {DI} di
 * @constructor
 */
var Injectables = function (di) {
    this.di = di;
    this.path = di.path;
};

Injectables.prototype.getInjectScripts = function () {
    var scripts = this.readSubDir(this.path.injectDir);

    return scripts;
};

Injectables.prototype.getInjectFiles = function () {
    var result = {};

    result['controls'] = [...this.readSubDir(this.path.controlDir), ...this.readSubDir(join(this.path.injectDir, 'controls'))];
    result['extract'] = this.readSubDir(this.path.extractDir);
    result['find'] = this.readSubDir(this.path.findDir);

    return result;
};

Injectables.prototype.readSubDir = function (fullDir) {
    var results = [];

    if (!fs.exists(fullDir)) {
        return results;
    }

    var filesList = fs.getFilesList(fullDir).filter(fileName => fileName.match(/\.js$/));

    _.each(filesList, function (fileName) {
        var data = fs.getFile(join(fullDir, fileName));
        results.push({
            name: fileName.replace(/\.js$/, ''),
            src: data
        });
    });

    return results;
};

Injectables.prototype.update = function (node) {
    var dir = this.getDirByType(node.type);

    fs.updateFile(join(dir, node.name + '.js'), node.src);
    return { success: true };
};

Injectables.prototype.rename = function (oldName, newName, type) {
    // rename injectable js:
    oldName = oldName + '.js';
    newName = newName + '.js';

    var dir = this.getDirByType(type);

    fs.rename(dir, oldName, newName);
    return { success: true };
};

Injectables.prototype.delete = function (name, type) {
    var dir = this.getDirByType(type);

    fs.remove(join(dir, name + '.js'));
    return { success: true };
};

Injectables.prototype.getDirByType = function (type) {
    switch (type) {
        default:
            return '';
        case 'find':
            return this.path.findDir;
        case 'extract':
            return this.path.extractDir;
        case 'controls':
            return this.path.controlDir;
    }
}

module.exports = Injectables;