import createRouter from './router';
import requester from './requester';
import { parseVersion } from './utils.js'

let pluginSchemasCache;
let kongVersionCache;
let resultsCache = {};

export default ({host, https, ignoreConsumers, cache}) => {
    const router = createRouter(host, https);

    return createApi({
        router,
        ignoreConsumers,
        getPaginatedJson: cache ? getPaginatedJsonCache : getPaginatedJson,
    });
}

function createApi({ router, getPaginatedJson, ignoreConsumers }) {
    return {
        router,
        fetchApis: () => getPaginatedJson(router({name: 'apis'})),
        fetchGlobalPlugins: () => getPaginatedJson(router({name: 'plugins'})),
        fetchPlugins: apiId => getPaginatedJson(router({name: 'api-plugins', params: {apiId}})),
        fetchConsumers: () => ignoreConsumers ? fetchFewConsumers(router) : getPaginatedJson(router({name: 'consumers'})),
        fetchConsumerCredentials: (consumerId, plugin) => getPaginatedJson(router({name: 'consumer-credentials', params: {consumerId, plugin}})),
        fetchConsumerAcls: (consumerId) => getPaginatedJson(router({name: 'consumer-acls', params: {consumerId}})),
        fetchUpstreams: () => getPaginatedJson(router({name: 'upstreams'})),
        fetchTargets: (upstreamId) => getPaginatedJson(router({name: 'upstream-targets', params: {upstreamId}})),
        fetchTargetsV11Active: (upstreamId) => getPaginatedJson(router({name: 'upstream-targets-active', params: {upstreamId}})),
        fetchCertificates: () => getPaginatedJson(router({name: 'certificates'})),

        // this is very chatty call and doesn't change so its cached
        fetchPluginSchemas: () => {
            if (pluginSchemasCache) {
                return Promise.resolve(pluginSchemasCache);
            }

            return getPaginatedJson(router({name: 'plugins-enabled'}))
                .then(json => Promise.all(getEnabledPluginNames(json.enabled_plugins).map(plugin => getPluginScheme(plugin, plugin => router({name: 'plugins-scheme', params: {plugin}})))))
                .then(all => pluginSchemasCache = new Map(all));
        },
        fetchKongVersion: () => {
            if (kongVersionCache) {
                return Promise.resolve(kongVersionCache);
            }

            return getPaginatedJson(router({name: 'root'}))
                .then(json => Promise.resolve(json.version))
                .then(version => kongVersionCache = parseVersion(version));
        },
        requestEndpoint: (endpoint, params) => {
            resultsCache = {};
            return requester.request(router(endpoint), prepareOptions(params));
        }
    };
}

function getEnabledPluginNames(enabledPlugins) {
  if (!Array.isArray(enabledPlugins)) {
    return Object.keys(enabledPlugins);
  }

  return enabledPlugins;
}

function getPaginatedJsonCache(uri) {
    if (resultsCache.hasOwnProperty(uri)) {
        return resultsCache[uri];
    }

    let result = getPaginatedJson(uri);
    resultsCache[uri] = result;

    return result;
}

function getPluginScheme(plugin, schemaRoute) {
    return getPaginatedJson(schemaRoute(plugin))
        .then(({fields}) => [plugin, fields]);
}

function getPaginatedJson(uri) {
    return requester.get(uri)
    .then(response => {
      if (!response.ok) {
          const error = new Error(`${uri}: ${response.status} ${response.statusText}`);
          error.response = response;

          throw error;
      }

      return response;
    })
    .then(r => r.json())
    .then(json => {
        if (!json.hasOwnProperty('data')) return json;
        if (!json.hasOwnProperty('next')) {
            if (Object.keys(json.data).length === 0 && json.data.constructor === Object) {
                // when no results were found
                // sometimes the data attribute is set to an empty object `{}` rather than a list `[]`
                return [];
            }

            return json.data;
        }

        if (json.data.length < 100) {
            // FIXME an hopeful hack to prevent a loop
            return json.data;
        }

        return getPaginatedJson(json.next).then(data => json.data.concat(data));
    });
}


async function fetchFewConsumers(router) {
  let result = [];
  for (let c of (global.KONG_CONSUMERS_CONFIG || [])) {
    let response = await requester.get(router({name: 'consumer', params: {consumerId: c.username}}))
    if (response.ok) {
      result.push(await response.json())
    }
  }
  return result;
}

const prepareOptions = ({method, body}) => {
    if (body) {
        return {
            method: method,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
            body: JSON.stringify(body)
        };
    }

    return {
        method: method,
        headers: {
            'Accept': 'application/json',
        }
    };
}
