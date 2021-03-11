import url from "url";
import path from "path";
import fs from "fs";

import { klona } from "klona/full";
import async from "neo-async";

function getDefaultSassImplementation() {
  let sassImplPkg = "sass";

  try {
    require.resolve("sass");
  } catch (error) {
    try {
      require.resolve("node-sass");
      sassImplPkg = "node-sass";
    } catch (ignoreError) {
      sassImplPkg = "sass";
    }
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(sassImplPkg);
}

/**
 * @public
 * This function is not Webpack-specific and can be used by tools wishing to
 * mimic `sass-loader`'s behaviour, so its signature should not be changed.
 */
function getSassImplementation(loaderContext, implementation) {
  let resolvedImplementation = implementation;

  if (!resolvedImplementation) {
    try {
      resolvedImplementation = getDefaultSassImplementation();
    } catch (error) {
      loaderContext.emitError(error);

      return;
    }
  }

  const { info } = resolvedImplementation;

  if (!info) {
    loaderContext.emitError(new Error("Unknown Sass implementation."));

    return;
  }

  const infoParts = info.split("\t");

  if (infoParts.length < 2) {
    loaderContext.emitError(
      new Error(`Unknown Sass implementation "${info}".`)
    );

    return;
  }

  const [implementationName] = infoParts;

  if (implementationName === "dart-sass") {
    // eslint-disable-next-line consistent-return
    return resolvedImplementation;
  } else if (implementationName === "node-sass") {
    // eslint-disable-next-line consistent-return
    return resolvedImplementation;
  }

  loaderContext.emitError(
    new Error(`Unknown Sass implementation "${implementationName}".`)
  );
}

function isProductionLikeMode(loaderContext) {
  return loaderContext.mode === "production" || !loaderContext.mode;
}

function proxyCustomImporters(importers, loaderContext) {
  return [].concat(importers).map(
    (importer) =>
      function proxyImporter(...args) {
        this.webpackLoaderContext = loaderContext;

        return importer.apply(this, args);
      }
  );
}

/**
 * Derives the sass options from the loader context and normalizes its values with sane defaults.
 *
 * @param {object} loaderContext
 * @param {object} loaderOptions
 * @param {string} content
 * @param {object} implementation
 * @param {boolean} useSourceMap
 * @returns {Object}
 */
async function getSassOptions(
  loaderContext,
  loaderOptions,
  content,
  implementation,
  useSourceMap
) {
  const options = klona(
    loaderOptions.sassOptions
      ? typeof loaderOptions.sassOptions === "function"
        ? loaderOptions.sassOptions(loaderContext) || {}
        : loaderOptions.sassOptions
      : {}
  );

  const isDartSass = implementation.info.includes("dart-sass");

  if (isDartSass) {
    const shouldTryToResolveFibers = !options.fiber && options.fiber !== false;

    if (shouldTryToResolveFibers) {
      let fibers;

      try {
        fibers = require.resolve("fibers");
      } catch (_error) {
        // Nothing
      }

      if (fibers) {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        options.fiber = require(fibers);
      }
    } else if (options.fiber === false) {
      // Don't pass the `fiber` option for `sass` (`Dart Sass`)
      delete options.fiber;
    }
  } else {
    // Don't pass the `fiber` option for `node-sass`
    delete options.fiber;
  }

  options.file = loaderContext.resourcePath;
  options.data = loaderOptions.additionalData
    ? typeof loaderOptions.additionalData === "function"
      ? await loaderOptions.additionalData(content, loaderContext)
      : `${loaderOptions.additionalData}\n${content}`
    : content;

  // opt.outputStyle
  if (!options.outputStyle && isProductionLikeMode(loaderContext)) {
    options.outputStyle = "compressed";
  }

  if (useSourceMap) {
    // Deliberately overriding the sourceMap option here.
    // node-sass won't produce source maps if the data option is used and options.sourceMap is not a string.
    // In case it is a string, options.sourceMap should be a path where the source map is written.
    // But since we're using the data option, the source map will not actually be written, but
    // all paths in sourceMap.sources will be relative to that path.
    // Pretty complicated... :(
    options.sourceMap = true;
    options.outFile = path.join(loaderContext.rootContext, "style.css.map");
    options.sourceMapContents = true;
    options.omitSourceMapUrl = true;
    options.sourceMapEmbed = false;
  }

  const { resourcePath } = loaderContext;
  const ext = path.extname(resourcePath);

  // If we are compiling sass and indentedSyntax isn't set, automatically set it.
  if (
    ext &&
    ext.toLowerCase() === ".sass" &&
    typeof options.indentedSyntax === "undefined"
  ) {
    options.indentedSyntax = true;
  } else {
    options.indentedSyntax = Boolean(options.indentedSyntax);
  }

  // Allow passing custom importers to `sass`/`node-sass`. Accepts `Function` or an array of `Function`s.
  options.importer = options.importer
    ? proxyCustomImporters(
        Array.isArray(options.importer) ? options.importer : [options.importer],
        loaderContext
      )
    : [];

  options.includePaths = []
    .concat(process.cwd())
    .concat(
      // We use `includePaths` in context for resolver, so it should be always absolute
      (options.includePaths || []).map((includePath) =>
        path.isAbsolute(includePath)
          ? includePath
          : path.join(process.cwd(), includePath)
      )
    )
    .concat(
      process.env.SASS_PATH
        ? process.env.SASS_PATH.split(process.platform === "win32" ? ";" : ":")
        : []
    );

  return options;
}

const MODULE_REQUEST_REGEX = /^[^?]*~/;

// Examples:
// - ~package
// - ~package/
// - ~@org
// - ~@org/
// - ~@org/package
// - ~@org/package/
const IS_MODULE_IMPORT = /^~([^/]+|[^/]+\/|@[^/]+[/][^/]+|@[^/]+\/?|@[^/]+[/][^/]+\/)$/;

/**
 * When `sass`/`node-sass` tries to resolve an import, it uses a special algorithm.
 * Since the `sass-loader` uses webpack to resolve the modules, we need to simulate that algorithm.
 * This function returns an array of import paths to try.
 * The last entry in the array is always the original url to enable straight-forward webpack.config aliases.
 *
 * We don't need emulate `dart-sass` "It's not clear which file to import." errors (when "file.ext" and "_file.ext" files are present simultaneously in the same directory).
 * This reduces performance and `dart-sass` always do it on own side.
 *
 * @param {string} url
 * @param {boolean} forWebpackResolver
 * @param {string} rootContext
 * @returns {Array<string>}
 */
function getPossibleRequests(
  // eslint-disable-next-line no-shadow
  url,
  forWebpackResolver = false
) {
  let request = url;

  // In case there is module request, send this to webpack resolver
  if (forWebpackResolver) {
    if (MODULE_REQUEST_REGEX.test(url)) {
      request = request.replace(MODULE_REQUEST_REGEX, "");
    }

    if (IS_MODULE_IMPORT.test(url)) {
      request = request[request.length - 1] === "/" ? request : `${request}/`;

      return [...new Set([request, url])];
    }
  }

  // Keep in mind: ext can also be something like '.datepicker' when the true extension is omitted and the filename contains a dot.
  // @see https://github.com/webpack-contrib/sass-loader/issues/167
  const ext = path.extname(request).toLowerCase();

  // Because @import is also defined in CSS, Sass needs a way of compiling plain CSS @imports without trying to import the files at compile time.
  // To accomplish this, and to ensure SCSS is as much of a superset of CSS as possible, Sass will compile any @imports with the following characteristics to plain CSS imports:
  //  - imports where the URL ends with .css.
  //  - imports where the URL begins http:// or https://.
  //  - imports where the URL is written as a url().
  //  - imports that have media queries.
  //
  // The `node-sass` package sends `@import` ending on `.css` to importer, it is bug, so we skip resolve
  if (ext === ".css") {
    return [];
  }

  const dirname = path.dirname(request);
  const basename = path.basename(request);

  return [
    ...new Set(
      [`${dirname}/_${basename}`, request].concat(
        forWebpackResolver ? [`${path.dirname(url)}/_${basename}`, url] : []
      )
    ),
  ];
}

function promiseResolve(callbackResolve) {
  return (context, request) =>
    new Promise((resolve, reject) => {
      callbackResolve(context, request, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
}

const IS_SPECIAL_MODULE_IMPORT = /^~[^/]+$/;
// `[drive_letter]:\` + `\\[server]\[sharename]\`
const IS_NATIVE_WIN32_PATH = /^[a-z]:[/\\]|^\\\\/i;

/**
 * @public
 * Create the resolve function used in the custom Sass importer.
 *
 * Can be used by external tools to mimic how `sass-loader` works, for example
 * in a Jest transform. Such usages will want to wrap `resolve.create` from
 * [`enhanced-resolve`]{@link https://github.com/webpack/enhanced-resolve} to
 * pass as the `resolverFactory` argument.
 *
 * @param {Function} resolverFactory - A factory function for creating a Webpack
 *   resolver.
 * @param {Object} implementation - The imported Sass implementation, both
 *   `sass` (Dart Sass) and `node-sass` are supported.
 * @param {string[]} [includePaths] - The list of include paths passed to Sass.
 *
 * @throws If a compatible Sass implementation cannot be found.
 */
function getWebpackResolver(
  resolverFactory,
  implementation,
  includePaths = []
) {
  async function startResolving(resolutionMap) {
    if (resolutionMap.length === 0) {
      return Promise.reject();
    }

    const [{ possibleRequests }] = resolutionMap;

    if (possibleRequests.length === 0) {
      return Promise.reject();
    }

    const [{ resolve, context }] = resolutionMap;

    try {
      return await resolve(context, possibleRequests[0]);
    } catch (_ignoreError) {
      const [, ...tailResult] = possibleRequests;

      if (tailResult.length === 0) {
        const [, ...tailResolutionMap] = resolutionMap;

        return startResolving(tailResolutionMap);
      }

      // eslint-disable-next-line no-param-reassign
      resolutionMap[0].possibleRequests = tailResult;

      return startResolving(resolutionMap);
    }
  }

  const isDartSass = implementation.info.includes("dart-sass");
  const sassResolve = promiseResolve(
    resolverFactory({
      alias: [],
      aliasFields: [],
      conditionNames: [],
      descriptionFiles: [],
      extensions: [".sass", ".scss", ".css"],
      exportsFields: [],
      mainFields: [],
      mainFiles: ["_index", "index"],
      modules: [],
      restrictions: [/\.((sa|sc|c)ss)$/i],
      preferRelative: true,
    })
  );
  const webpackResolve = promiseResolve(
    resolverFactory({
      dependencyType: "sass",
      conditionNames: ["sass", "style"],
      mainFields: ["sass", "style", "main", "..."],
      mainFiles: ["_index", "index", "..."],
      extensions: [".sass", ".scss", ".css"],
      restrictions: [/\.((sa|sc|c)ss)$/i],
      preferRelative: true,
    })
  );

  return (context, request) => {
    // See https://github.com/webpack/webpack/issues/12340
    // Because `node-sass` calls our importer before `1. Filesystem imports relative to the base file.`
    // custom importer may not return `{ file: '/path/to/name.ext' }` and therefore our `context` will be relative
    if (!isDartSass && !path.isAbsolute(context)) {
      return Promise.reject();
    }

    const originalRequest = request;
    const isFileScheme = originalRequest.slice(0, 5).toLowerCase() === "file:";

    if (isFileScheme) {
      try {
        // eslint-disable-next-line no-param-reassign
        request = url.fileURLToPath(originalRequest);
      } catch (ignoreError) {
        // eslint-disable-next-line no-param-reassign
        request = request.slice(7);
      }
    }

    let resolutionMap = [];

    const needEmulateSassResolver =
      // `sass` doesn't support module import
      !IS_SPECIAL_MODULE_IMPORT.test(request) &&
      // We need improve absolute paths handling.
      // Absolute paths should be resolved:
      // - Server-relative URLs - `<context>/path/to/file.ext` (where `<context>` is root context)
      // - Absolute path - `/full/path/to/file.ext` or `C:\\full\path\to\file.ext`
      !isFileScheme &&
      !originalRequest.startsWith("/") &&
      !IS_NATIVE_WIN32_PATH.test(originalRequest);

    if (includePaths.length > 0 && needEmulateSassResolver) {
      // The order of import precedence is as follows:
      //
      // 1. Filesystem imports relative to the base file.
      // 2. Custom importer imports.
      // 3. Filesystem imports relative to the working directory.
      // 4. Filesystem imports relative to an `includePaths` path.
      // 5. Filesystem imports relative to a `SASS_PATH` path.
      //
      // `sass` run custom importers before `3`, `4` and `5` points, we need to emulate this behavior to avoid wrong resolution.
      const sassPossibleRequests = getPossibleRequests(request);

      // `node-sass` calls our importer before `1. Filesystem imports relative to the base file.`, so we need emulate this too
      if (!isDartSass) {
        resolutionMap = resolutionMap.concat({
          resolve: sassResolve,
          context: path.dirname(context),
          possibleRequests: sassPossibleRequests,
        });
      }

      resolutionMap = resolutionMap.concat(
        // eslint-disable-next-line no-shadow
        includePaths.map((context) => {
          return {
            resolve: sassResolve,
            context,
            possibleRequests: sassPossibleRequests,
          };
        })
      );
    }

    const webpackPossibleRequests = getPossibleRequests(request, true);

    resolutionMap = resolutionMap.concat({
      resolve: webpackResolve,
      context: path.dirname(context),
      possibleRequests: webpackPossibleRequests,
    });

    return startResolving(resolutionMap);
  };
}

const matchCss = /\.css$/i;

function getWebpackImporter(loaderContext, implementation, includePaths) {
  const resolve = getWebpackResolver(
    loaderContext.getResolve,
    implementation,
    includePaths
  );

  return (originalUrl, prev, done) => {
    resolve(prev, originalUrl)
      .then((result) => {
        // Add the result as dependency.
        // Although we're also using stats.includedFiles, this might come in handy when an error occurs.
        // In this case, we don't get stats.includedFiles from node-sass/sass.
        loaderContext.addDependency(path.normalize(result));

        // By removing the CSS file extension, we trigger node-sass to include the CSS file instead of just linking it.
        done({ file: result.replace(matchCss, "") });
      })
      // Catch all resolving errors, return the original file and pass responsibility back to other custom importers
      .catch(() => {
        done({ file: originalUrl });
      });
  };
}

let nodeSassJobQueue = null;

/**
 * Verifies that the implementation and version of Sass is supported by this loader.
 *
 * @param {Object} implementation
 * @returns {Function}
 */
function getRenderFunctionFromSassImplementation(implementation) {
  const isDartSass = implementation.info.includes("dart-sass");

  if (isDartSass) {
    return implementation.render.bind(implementation);
  }

  // There is an issue with node-sass when async custom importers are used
  // See https://github.com/sass/node-sass/issues/857#issuecomment-93594360
  // We need to use a job queue to make sure that one thread is always available to the UV lib
  if (nodeSassJobQueue === null) {
    const threadPoolSize = Number(process.env.UV_THREADPOOL_SIZE || 4);

    nodeSassJobQueue = async.queue(
      implementation.render.bind(implementation),
      threadPoolSize - 1
    );
  }

  return nodeSassJobQueue.push.bind(nodeSassJobQueue);
}

const ABSOLUTE_SCHEME = /^[A-Za-z0-9+\-.]+:/;

function getURLType(source) {
  if (source[0] === "/") {
    if (source[1] === "/") {
      return "scheme-relative";
    }

    return "path-absolute";
  }

  if (IS_NATIVE_WIN32_PATH.test(source)) {
    return "path-absolute";
  }

  return ABSOLUTE_SCHEME.test(source) ? "absolute" : "path-relative";
}

function normalizeSourceMap(map, rootContext) {
  const newMap = map;

  // result.map.file is an optional property that provides the output filename.
  // Since we don't know the final filename in the webpack build chain yet, it makes no sense to have it.
  // eslint-disable-next-line no-param-reassign
  delete newMap.file;

  // eslint-disable-next-line no-param-reassign
  newMap.sourceRoot = "";

  // node-sass returns POSIX paths, that's why we need to transform them back to native paths.
  // This fixes an error on windows where the source-map module cannot resolve the source maps.
  // @see https://github.com/webpack-contrib/sass-loader/issues/366#issuecomment-279460722
  // eslint-disable-next-line no-param-reassign
  newMap.sources = newMap.sources.map((source) => {
    const sourceType = getURLType(source);

    // Do no touch `scheme-relative`, `path-absolute` and `absolute` types
    if (sourceType === "path-relative") {
      return path.resolve(rootContext, path.normalize(source));
    }

    return source;
  });

  return newMap;
}
const getAllStyleVarFiles = (loaderContext, options) => {
  const styleVarFiles = options.multipleScopeVars;
  let allStyleVarFiles = [{ scopeName: "", path: "" }];
  if (Array.isArray(styleVarFiles)) {
    allStyleVarFiles = styleVarFiles.filter((item) => {
      if (!item.scopeName) {
        loaderContext.emitError(
          new Error("Not found scopeName in sass-loader multipleScopeVars")
        );
        return false;
      }
      if (Array.isArray(item.path)) {
        return item.path.every((pathstr) => {
          const exists = pathstr && fs.existsSync(pathstr);
          if (!exists) {
            loaderContext.emitError(
              new Error(
                `Not found path: ${pathstr} in sass-loader multipleScopeVars`
              )
            );
          }
          return exists;
        });
      }
      if (
        !item.path ||
        typeof item.path !== "string" ||
        !fs.existsSync(item.path)
      ) {
        loaderContext.emitError(
          new Error(
            `Not found path: ${item.path} in sass-loader multipleScopeVars`
          )
        );
        return false;
      }
      return true;
    });
  }
  return allStyleVarFiles;
};

const cssFragReg = /[^{}/\\]+{[^{}]*?}/g;
const classNameFragReg = /[^{}/\\]+(?={)/;
const addScopeName = (css, scopeName) => {
  const splitCodes = css.match(cssFragReg) || [];

  if (splitCodes.length && scopeName) {
    const fragments = [];
    const resultCode = splitCodes.reduce((codes, curr) => {
      const replacerFragment = curr.replace(classNameFragReg, (a) =>
        a.split(",").reduce((tol, c) => {
          if (/^html/i.test(c)) {
            return tol;
          }
          return tol.replace(c, `.${scopeName} ${c}`);
        }, a)
      );
      fragments.push(replacerFragment);
      return codes.replace(curr, replacerFragment);
    }, css);
    return {
      cssCode: resultCode,
      sourceFragments: splitCodes,
      fragments,
    };
  }

  return {
    cssCode: css,
    sourceFragments: splitCodes,
    fragments: splitCodes,
  };
};

const getScropProcessResult = (cssResults = [], allStyleVarFiles = []) => {
  const preprocessResult = { deps: [], code: "", errors: [] };
  const fragmentsGroup = [];
  const sourceFragmentsGroup = [];
  cssResults.forEach((item, i) => {
    const { fragments, sourceFragments } = addScopeName(
      item.code,
      allStyleVarFiles[i].scopeName
    );
    fragmentsGroup.push(fragments);
    sourceFragmentsGroup.push(sourceFragments);
    preprocessResult.errors = [
      ...(preprocessResult.errors || []),
      ...(item.errors || []),
    ];
    const deps = Array.isArray(allStyleVarFiles[i].path)
      ? allStyleVarFiles[i].path
      : [allStyleVarFiles[i].path];
    deps.forEach((str) => {
      if (str) {
        preprocessResult.deps.push(str);
      }
    });
  });
  if (cssResults.length && sourceFragmentsGroup.length) {
    preprocessResult.code = sourceFragmentsGroup[0].reduce(
      (tol, curr, i) =>
        tol.replace(curr, () => fragmentsGroup.map((g) => g[i]).join("\n")),
      cssResults[0].code
    );
    preprocessResult.map = cssResults[0].map;
    preprocessResult.deps = [...preprocessResult.deps, ...cssResults[0].deps];
  }

  return preprocessResult;
};

const replaceFormLess = (url) => {
  let code = url ? fs.readFileSync(url).toString() : "";
  if (/\.less$/i.test(url)) {
    code = code.replace(/@/g, "$");
  }
  return code.replace(/!default/g, "");
};

const getVarsContent = (url) => {
  let content = "";
  if (Array.isArray(url)) {
    url.forEach((p) => {
      content += replaceFormLess(p);
    });
  } else {
    content = replaceFormLess(url);
  }
  return content;
};
export {
  getSassImplementation,
  getSassOptions,
  getWebpackResolver,
  getWebpackImporter,
  getRenderFunctionFromSassImplementation,
  normalizeSourceMap,
  getAllStyleVarFiles,
  addScopeName,
  getScropProcessResult,
  getVarsContent,
};
