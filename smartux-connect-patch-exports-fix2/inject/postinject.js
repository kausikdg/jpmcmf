if (window.powwow) {
    window.powwow.models_loaded = true;
    window.powwow.stateModels = [];

    // Loop through the loaded page models, and do 2 things:
    // 1) Make a parallel set of page identifier models that just contain the identifiers.
    // 2) Resolve any references to other models (since we are traversing them anyway)
    for (i = 0; i < window.powwow._listModels.length; i++) {
        if (pageModelHasIdentifiersToRun(window.powwow._listModels[i])) {
            var pageIdentifier = {};
            copyOverPageModelIdentifiersAndResolveSubModels(window.powwow._listModels[i], pageIdentifier, null, window.powwow.models, window.powwow._listModels[i]);
            window.powwow.stateModels.push(pageIdentifier);
        }
    }
    delete window.powwow._listModels;

    function copyOverPageModelIdentifiersAndResolveSubModels(node, nodetoCopyTo, id, mapPageModels, nodeParent) {
        if (node.type == "object") {
            if (id) {
                nodetoCopyTo[id] = {};
                nodetoCopyTo = nodetoCopyTo[id];
            }

            // Copy over properties to nodetoCopyTo.
            for (var prop in node) {
                nodetoCopyTo[prop] = node[prop];
            }
            // Clear the properties.  We just want to copy over identifiers, not all properties.
            nodetoCopyTo.properties = {};

            // Recurse over the properties to look for identifiers.
            for (var prop in node.properties) {
                copyOverPageModelIdentifiersAndResolveSubModels(node.properties[prop], nodetoCopyTo.properties, prop, mapPageModels, node.properties);
            }
        } else if (node.type == "array") {
            nodetoCopyTo[id] = {};
            // Copy over properties to nodetoCopyTo.
            for (var prop in node) {
                nodetoCopyTo[id][prop] = node[prop];
            }

            // Clear the items.  We just want to copy over identifiers, not all items.
            nodetoCopyTo[id].items = {};

            // Recurse over the properties to look for identifiers.
            copyOverPageModelIdentifiersAndResolveSubModels(node.items, nodetoCopyTo[id].items, null, mapPageModels, node.items);
        } else if (node.type == "identifier") {
            nodetoCopyTo[id] = node;
            // Remove identifier from main descriptor.
            delete nodeParent[id];
        } else if (node.type == "descriptor") {
            // console.log("**** Resolving", node.descriptor, ", id=", id);
            var subDescriptor = mapPageModels[node.descriptor];
            for (var prop in subDescriptor) {
                node[prop] = subDescriptor[prop];
            }
            delete node.connect;
            delete node.descriptor;
            nodetoCopyTo[id] = {};
            copyOverPageModelIdentifiersAndResolveSubModels(node, nodetoCopyTo[id], null, mapPageModels, node);
        }
    }

    function pageModelHasIdentifiersToRun(pageModel) {
        if (pageModel.connect) {
            for (var i = 0; i < pageModel.connect.length; i++) {
                if (pageModel.connect[i].match && pageModel.connect[i].match.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }
}
})();