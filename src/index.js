import path from "path";

import {
  getScropProcessResult,
  getAllStyleVarFiles,
  getVarsContent,
} from "@zougt/some-loader-utils";

import schema from "./options.json";
import {
  getSassImplementation,
  getSassOptions,
  getWebpackImporter,
  getRenderFunctionFromSassImplementation,
  normalizeSourceMap,
} from "./utils";

import SassError from "./SassError";

/**
 * The sass-loader makes node-sass and dart-sass available to webpack modules.
 *
 * @this {object}
 * @param {string} content
 */
async function loader(content) {
  const options = this.getOptions(schema);
  const callback = this.async();
  const implementation = getSassImplementation(this, options.implementation);

  if (!implementation) {
    callback();

    return;
  }

  const useSourceMap =
    typeof options.sourceMap === "boolean" ? options.sourceMap : this.sourceMap;
  const sassOptions = await getSassOptions(
    this,
    options,
    content,
    implementation,
    useSourceMap
  );
  const shouldUseWebpackImporter =
    typeof options.webpackImporter === "boolean"
      ? options.webpackImporter
      : true;

  if (shouldUseWebpackImporter) {
    const { includePaths } = sassOptions;

    sassOptions.importer.push(
      getWebpackImporter(this, implementation, includePaths)
    );
  }

  const render = getRenderFunctionFromSassImplementation(implementation);
  const { data } = sassOptions;
  const preProcessor = (code) =>
    new Promise((resolve, reject) => {
      render({ ...sassOptions, data: code }, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  const allStyleVarFiles = getAllStyleVarFiles(this, options);
  Promise.all(
    allStyleVarFiles.map((file) => {
      const varscontent = getVarsContent(file.path, "sass");
      return preProcessor(`${varscontent}\n${data}`);
    })
  )
    .then((prs) =>
      getScropProcessResult(
        prs.map((item) => {
          return {
            ...item,
            code: item.css.toString(),
            deps: item.stats.includedFiles,
          };
        }),
        allStyleVarFiles,
        this.resourcePath
      )
    )
    .then((result) => {
      const css = result.code;
      const imports = result.deps;
      let map = result.map ? JSON.parse(result.map) : null;

      // Modify source paths only for webpack, otherwise we do nothing
      if (map && useSourceMap) {
        map = normalizeSourceMap(map, this.rootContext);
      }
      imports.forEach((includedFile) => {
        const normalizedIncludedFile = path.normalize(includedFile);

        // Custom `importer` can return only `contents` so includedFile will be relative
        if (path.isAbsolute(normalizedIncludedFile)) {
          this.addDependency(normalizedIncludedFile);
        }
      });
      callback(null, css, map);
    })
    .catch((error) => {
      if (error) {
        // There are situations when the `file` property do not exist
        if (error.file) {
          // `node-sass` returns POSIX paths
          this.addDependency(path.normalize(error.file));
        }

        callback(new SassError(error));
      }
    });
}

export default loader;
