# @zougt/sass-loader

**此包停止维护，请使用[@zougt/some-loader-utils](https://github.com/GitOfZGT/some-loader-utils)**

fork 自[webpack-contrib/sass-loader](https://github.com/webpack-contrib/sass-loader)，在`sass-loader`的基础上增加了`multipleScopeVars`属性，用于根据多个 scss 变量文件编译出多种添加了权重类名的样式（不得不修改 sass-loader 的源码达到此目的）

> 没有添加`multipleScopeVars`属性时，`@zougt/sass-loader`跟`sass-loader`是一致的  
> `@zougt/sass-loader v10.2.0+` 对应 `sass-loader v10.1.1+`  
> `@zougt/sass-loader v11.1.0+` 对应 `sass-loader v11.0.1+`

## 使用

```console
$ npm install sass @zougt/sass-loader --save-dev
```

在 webpack.config.js 使用`sass-loader`的地方替换成`@zougt/sass-loader`, 并添加`multipleScopeVars`属性

### multipleScopeVars

Type `object[]`

#### multipleScopeVars[].scopeName

Type `string`

#### multipleScopeVars[].path

Type `string | string[]`

```js
const path = require("path");
module.exports = {
  module: {
    rules: [
      {
        test: /\.scss$/i,
        // loader: "sass-loader",
        loader: "@zougt/sass-loader",
        options: {
          multipleScopeVars: [
            {
              scopeName: "theme-default",
              path: path.resolve("src/theme/default-vars.scss"),
            },
            {
              scopeName: "theme-mauve",
              path: path.resolve("src/theme/mauve-vars.scss"),
            },
          ],
        },
      },
    ],
  },
};
```

## 示例

```scss
//src/theme/default-vars.scss
/**
*此scss变量文件作为multipleScopeVars去编译时，会自动移除!default以达到变量提升
*同时此scss变量文件作为默认主题变量文件，被其他.scss通过 @import 时，必需 !default
*/
$primary-color: #0081ff !default;
```

```scss
//src/theme/mauve-vars.scss
$primary-color: #9c26b0;
```

```scss
//src/components/Button/style.scss
@import "../../theme/default-vars";
.un-btn {
  position: relative;
  display: inline-block;
  font-weight: 400;
  white-space: nowrap;
  text-align: center;
  border: 1px solid transparent;
  background-color: @primary-color;
  .anticon {
    line-height: 1;
  }
}
```

编译之后

src/components/Button/style.css

```css
.theme-default .un-btn {
  position: relative;
  display: inline-block;
  font-weight: 400;
  white-space: nowrap;
  text-align: center;
  border: 1px solid transparent;
  background-color: #0081ff;
}
.theme-mauve .un-btn {
  position: relative;
  display: inline-block;
  font-weight: 400;
  white-space: nowrap;
  text-align: center;
  border: 1px solid transparent;
  background-color: #9c26b0;
}
.theme-default .un-btn .anticon {
  line-height: 1;
}
.theme-mauve .un-btn .anticon {
  line-height: 1;
}
```

冗余的 css 通过[postcss-loader](https://github.com/webpack-contrib/postcss-loader)的插件[cssnano](https://github.com/cssnano/cssnano)合并

```css
.theme-default .un-btn,
.theme-mauve .un-btn {
  position: relative;
  display: inline-block;
  font-weight: 400;
  white-space: nowrap;
  text-align: center;
  border: 1px solid transparent;
}
.theme-default .un-btn {
  background-color: #0081ff;
}
.theme-mauve .un-btn {
  background-color: #9c26b0;
}
.theme-default .un-btn .anticon,
.theme-mauve .un-btn .anticon {
  line-height: 1;
}
```

在`html`中改变 classname 切换主题，只作用于 html 标签 ：

```html
<!DOCTYPE html>
<html lang="zh" class="theme-default">
  <head>
    <meta charset="utf-8" />
    <title>title</title>
  </head>
  <body>
    <div id="app"></div>
    <!-- built files will be auto injected -->
  </body>
</html>
```

## 使用 Css Modules

如果是模块化的 less，得到的 css 类似：

```css
.src-components-ContentWrapper-style_theme-default-3CPvz
  .src-components-ContentWrapper-style_content-wrapper-1n85E,
.src-components-ContentWrapper-style_theme-mauve-3yajX
  .src-components-ContentWrapper-style_content-wrapper-1n85E {
  max-width: 1400px;
  margin: 0 auto;
}
```

实际需要的结果应该是这样：

```css
.theme-default .src-components-ContentWrapper-style_content-wrapper-1n85E,
.theme-mauve .src-components-ContentWrapper-style_content-wrapper-1n85E {
  max-width: 1400px;
  margin: 0 auto;
}
```

在 webpack.config.js 需要对`css-loader` (v4.0+) 的 modules 属性修改:

```js
const path = require("path");
const { interpolateName } = require("loader-utils");
function normalizePath(file) {
  return path.sep === "\\" ? file.replace(/\\/g, "/") : file;
}
const multipleScopeVars = [
  {
    scopeName: "theme-default",
    path: path.resolve("src/theme/default-vars.scss"),
  },
  {
    scopeName: "theme-mauve",
    path: path.resolve("src/theme/mauve-vars.scss"),
  },
];
module.exports = {
  module: {
    rules: [
      {
        test: /\.module.scss$/i,
        use: [
          {
            loader: "css-loader",
            options: {
              importLoaders: 1,
              modules: {
                localIdentName: "[path][name]_[local]-[hash:base64:5]",
                //使用 getLocalIdent 自定义模块化名称 ， css-loader v4.0+
                getLocalIdent: (
                  loaderContext,
                  localIdentName,
                  localName,
                  options
                ) => {
                  if (
                    multipleScopeVars.some(
                      (item) => item.scopeName === localName
                    )
                  ) {
                    //localName 属于 multipleScopeVars 的不用模块化
                    return localName;
                  }
                  const { context, hashPrefix } = options;
                  const { resourcePath } = loaderContext;
                  const request = normalizePath(
                    path.relative(context, resourcePath)
                  );
                  // eslint-disable-next-line no-param-reassign
                  options.content = `${hashPrefix + request}\x00${localName}`;
                  const inname = interpolateName(
                    loaderContext,
                    localIdentName,
                    options
                  );

                  return inname.replace(/\\?\[local\\?]/gi, localName);
                },
              },
            },
          },
          {
            // loader: "sass-loader",
            loader: "@zougt/sass-loader",
            options: {
              multipleScopeVars,
            },
          },
        ],
      },
    ],
  },
};
```

# **以下是 sass-loader 原文档**

<div align="center">
  <img height="170"
    src="https://worldvectorlogo.com/logos/sass-1.svg">
  <a href="https://github.com/webpack/webpack">
    <img width="200" height="200"
      src="https://webpack.js.org/assets/icon-square-big.svg">
  </a>
</div>

[![npm][npm]][npm-url]
[![node][node]][node-url]
[![deps][deps]][deps-url]
[![tests][tests]][tests-url]
[![coverage][cover]][cover-url]
[![chat][chat]][chat-url]
[![size][size]][size-url]

# sass-loader

Loads a Sass/SCSS file and compiles it to CSS.

## Getting Started

To begin, you'll need to install `sass-loader`:

```console
npm install sass-loader sass webpack --save-dev
```

`sass-loader` requires you to install either [Dart Sass](https://github.com/sass/dart-sass) or [Node Sass](https://github.com/sass/node-sass) on your own (more documentation can be found below).

This allows you to control the versions of all your dependencies, and to choose which Sass implementation to use.

> ℹ️ We highly recommend using [Dart Sass](https://github.com/sass/dart-sass).

> ⚠ [Node Sass](https://github.com/sass/node-sass) does not work with [Yarn PnP](https://classic.yarnpkg.com/en/docs/pnp/) feature and doesn't support [@use rule](https://sass-lang.com/documentation/at-rules/use).

Chain the `sass-loader` with the [css-loader](https://github.com/webpack-contrib/css-loader) and the [style-loader](https://github.com/webpack-contrib/style-loader) to immediately apply all styles to the DOM or the [mini-css-extract-plugin](https://github.com/webpack-contrib/mini-css-extract-plugin) to extract it into a separate file.

Then add the loader to your Webpack configuration. For example:

**app.js**

```js
import "./style.scss";
```

**style.scss**

```scss
$body-color: red;

body {
  color: $body-color;
}
```

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          // Creates `style` nodes from JS strings
          "style-loader",
          // Translates CSS into CommonJS
          "css-loader",
          // Compiles Sass to CSS
          "sass-loader",
        ],
      },
    ],
  },
};
```

Finally run `webpack` via your preferred method.

### Resolving `import` at-rules

Webpack provides an [advanced mechanism to resolve files](https://webpack.js.org/concepts/module-resolution/).

The `sass-loader` uses Sass's custom importer feature to pass all queries to the Webpack resolving engine.
Thus you can import your Sass modules from `node_modules`.

```scss
@import "bootstrap";
```

Using `~` is deprecated and can be removed from your code (**we recommend it**), but we still support it for historical reasons.
Why you can remove it? The loader will first try to resolve `@import` as relative, if it cannot be resolved, the loader will try to resolve `@import` inside [`node_modules`](https://webpack.js.org/configuration/resolve/#resolve-modules).
Just prepend them with a `~` which tells webpack to look up the [`modules`](https://webpack.js.org/configuration/resolve/#resolve-modules).

```scss
@import "~bootstrap";
```

It's important to only prepend it with `~`, because `~/` resolves to the home directory.
Webpack needs to distinguish between `bootstrap` and `~bootstrap` because CSS and Sass files have no special syntax for importing relative files.
Writing `@import "style.scss"` is the same as `@import "./style.scss";`

### Problems with `url(...)`

Since Sass implementations don't provide [url rewriting](https://github.com/sass/libsass/issues/532), all linked assets must be relative to the output.

- If you pass the generated CSS on to the `css-loader`, all urls must be relative to the entry-file (e.g. `main.scss`).
- If you're just generating CSS without passing it to the `css-loader`, it must be relative to your web root.

You will be disrupted by this first issue. It is natural to expect relative references to be resolved against the `.sass`/`.scss` file in which they are specified (like in regular `.css` files).

Thankfully there are a two solutions to this problem:

- Add the missing url rewriting using the [resolve-url-loader](https://github.com/bholloway/resolve-url-loader). Place it before `sass-loader` in the loader chain.
- Library authors usually provide a variable to modify the asset path. [bootstrap-sass](https://github.com/twbs/bootstrap-sass) for example has an `$icon-font-path`.

## Options

|                   Name                    |         Type         |                 Default                 | Description                                                       |
| :---------------------------------------: | :------------------: | :-------------------------------------: | :---------------------------------------------------------------- |
|  **[`implementation`](#implementation)**  |      `{Object}`      |                 `sass`                  | Setup Sass implementation to use.                                 |
|     **[`sassOptions`](#sassoptions)**     | `{Object\|Function}` | defaults values for Sass implementation | Options for Sass.                                                 |
|       **[`sourceMap`](#sourcemap)**       |     `{Boolean}`      |           `compiler.devtool`            | Enables/Disables generation of source maps.                       |
|  **[`additionalData`](#additionaldata)**  | `{String\|Function}` |               `undefined`               | Prepends/Appends `Sass`/`SCSS` code before the actual entry file. |
| **[`webpackImporter`](#webpackimporter)** |     `{Boolean}`      |                 `true`                  | Enables/Disables the default Webpack importer.                    |

### `implementation`

Type: `Object`
Default: `sass`

The special `implementation` option determines which implementation of Sass to use.

By default the loader resolve the implementation based on your dependencies.
Just add required implementation to `package.json` (`sass` or `node-sass` package) and install dependencies.

Example where the `sass-loader` loader uses the `sass` (`dart-sass`) implementation:

**package.json**

```json
{
  "devDependencies": {
    "sass-loader": "^7.2.0",
    "sass": "^1.22.10"
  }
}
```

Example where the `sass-loader` loader uses the `node-sass` implementation:

**package.json**

```json
{
  "devDependencies": {
    "sass-loader": "^7.2.0",
    "node-sass": "^5.0.0"
  }
}
```

Beware the situation when `node-sass` and `sass` were installed! By default the `sass-loader` prefers `sass`.
In order to avoid this situation you can use the `implementation` option.

The `implementation` options either accepts `sass` (`Dart Sass`) or `node-sass` as a module.

For example, to use Dart Sass, you'd pass:

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              // Prefer `dart-sass`
              implementation: require("sass"),
            },
          },
        ],
      },
    ],
  },
};
```

Note that when using `sass` (`Dart Sass`), **synchronous compilation is twice as fast as asynchronous compilation** by default, due to the overhead of asynchronous callbacks.
To avoid this overhead, you can use the [fibers](https://www.npmjs.com/package/fibers) package to call asynchronous importers from the synchronous code path.

We automatically inject the [`fibers`](https://github.com/laverdet/node-fibers) package (setup `sassOptions.fiber`) if is possible (i.e. you need install the [`fibers`](https://github.com/laverdet/node-fibers) package).

**package.json**

```json
{
  "devDependencies": {
    "sass-loader": "^7.2.0",
    "sass": "^1.22.10",
    "fibers": "^4.0.1"
  }
}
```

You can disable automatically injecting the [`fibers`](https://github.com/laverdet/node-fibers) package by passing a `false` value for the `sassOptions.fiber` option.

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              implementation: require("sass"),
              sassOptions: {
                fiber: false,
              },
            },
          },
        ],
      },
    ],
  },
};
```

You can also pass the `fiber` value using this code:

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              implementation: require("sass"),
              sassOptions: {
                fiber: require("fibers"),
              },
            },
          },
        ],
      },
    ],
  },
};
```

### `sassOptions`

Type: `Object|Function`
Default: defaults values for Sass implementation

Options for [Dart Sass](http://sass-lang.com/dart-sass) or [Node Sass](https://github.com/sass/node-sass) implementation.

> ℹ️ The `indentedSyntax` option has `true` value for the `sass` extension.

> ℹ️ Options such as `data` and `file` are unavailable and will be ignored.

> ℹ We recommend not to set the `outFile`, `sourceMapContents`, `sourceMapEmbed`, `sourceMapRoot` options because `sass-loader` automatically sets these options when the `sourceMap` option is `true`.

> ℹ️ Access to the [loader context](https://webpack.js.org/api/loaders/#the-loader-context) inside the custom importer can be done using the `this.webpackLoaderContext` property.

There is a slight difference between the `sass` (`dart-sass`) and `node-sass` options.

Please consult documentation before using them:

- [Dart Sass documentation](https://github.com/sass/dart-sass#javascript-api) for all available `sass` options.
- [Node Sass documentation](https://github.com/sass/node-sass/#options) for all available `node-sass` options.

#### `Object`

Use and object for the Sass implementation setup.

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              sassOptions: {
                indentWidth: 4,
                includePaths: ["absolute/path/a", "absolute/path/b"],
              },
            },
          },
        ],
      },
    ],
  },
};
```

#### `Function`

Allows to setup the Sass implementation by setting different options based on the loader context.

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              sassOptions: (loaderContext) => {
                // More information about available properties https://webpack.js.org/api/loaders/
                const { resourcePath, rootContext } = loaderContext;
                const relativePath = path.relative(rootContext, resourcePath);

                if (relativePath === "styles/foo.scss") {
                  return {
                    includePaths: ["absolute/path/c", "absolute/path/d"],
                  };
                }

                return {
                  includePaths: ["absolute/path/a", "absolute/path/b"],
                };
              },
            },
          },
        ],
      },
    ],
  },
};
```

### `sourceMap`

Type: `Boolean`
Default: depends on the `compiler.devtool` value

Enables/Disables generation of source maps.

By default generation of source maps depends on the [`devtool`](https://webpack.js.org/configuration/devtool/) option.
All values enable source map generation except `eval` and `false` value.

> ℹ If a `true` the `sourceMap`, `sourceMapRoot`, `sourceMapEmbed`, `sourceMapContents` and `omitSourceMapUrl` from `sassOptions` will be ignored.

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              sourceMap: true,
            },
          },
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
};
```

> ℹ In some rare cases `node-sass` can output invalid source maps (it is a `node-sass` bug).

> > In order to avoid this, you can try to update `node-sass` to latest version or you can try to set within `sassOptions` the `outputStyle` option to `compressed`.

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
              sassOptions: {
                outputStyle: "compressed",
              },
            },
          },
        ],
      },
    ],
  },
};
```

### `additionalData`

Type: `String|Function`
Default: `undefined`

Prepends `Sass`/`SCSS` code before the actual entry file.
In this case, the `sass-loader` will not override the `data` option but just **prepend** the entry's content.

This is especially useful when some of your Sass variables depend on the environment:

#### `String`

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              additionalData: "$env: " + process.env.NODE_ENV + ";",
            },
          },
        ],
      },
    ],
  },
};
```

#### `Function`

##### Sync

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              additionalData: (content, loaderContext) => {
                // More information about available properties https://webpack.js.org/api/loaders/
                const { resourcePath, rootContext } = loaderContext;
                const relativePath = path.relative(rootContext, resourcePath);

                if (relativePath === "styles/foo.scss") {
                  return "$value: 100px;" + content;
                }

                return "$value: 200px;" + content;
              },
            },
          },
        ],
      },
    ],
  },
};
```

##### Async

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              additionalData: async (content, loaderContext) => {
                // More information about available properties https://webpack.js.org/api/loaders/
                const { resourcePath, rootContext } = loaderContext;
                const relativePath = path.relative(rootContext, resourcePath);

                if (relativePath === "styles/foo.scss") {
                  return "$value: 100px;" + content;
                }

                return "$value: 200px;" + content;
              },
            },
          },
        ],
      },
    ],
  },
};
```

### `webpackImporter`

Type: `Boolean`
Default: `true`

Enables/Disables the default Webpack importer.

This can improve performance in some cases. Use it with caution because aliases and `@import` at-rules starting with `~` will not work.
You can pass own `importer` to solve this (see [`importer docs`](https://github.com/sass/node-sass#importer--v200---experimental)).

**webpack.config.js**

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          {
            loader: "sass-loader",
            options: {
              webpackImporter: false,
            },
          },
        ],
      },
    ],
  },
};
```

## Examples

### Extracts CSS into separate files

For production builds it's recommended to extract the CSS from your bundle being able to use parallel loading of CSS/JS resources later on.

There are two possibilities to extract a style sheet from the bundle:

- [mini-css-extract-plugin](https://github.com/webpack-contrib/mini-css-extract-plugin)
- [extract-loader](https://github.com/peerigon/extract-loader) (simpler, but specialized on the css-loader's output)

**webpack.config.js**

```js
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          // fallback to style-loader in development
          process.env.NODE_ENV !== "production"
            ? "style-loader"
            : MiniCssExtractPlugin.loader,
          "css-loader",
          "sass-loader",
        ],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      // Options similar to the same options in webpackOptions.output
      // both options are optional
      filename: "[name].css",
      chunkFilename: "[id].css",
    }),
  ],
};
```

### Source maps

Enables/Disables generation of source maps.

To enable CSS source maps, you'll need to pass the `sourceMap` option to the `sass-loader` _and_ the css-loader.

**webpack.config.js**

```javascript
module.exports = {
  devtool: "source-map", // any "source-map"-like devtool is possible
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              sourceMap: true,
            },
          },
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
};
```

If you want to edit the original Sass files inside Chrome, [there's a good blog post](https://medium.com/@toolmantim/getting-started-with-css-sourcemaps-and-in-browser-sass-editing-b4daab987fb0). Checkout [test/sourceMap](https://github.com/webpack-contrib/sass-loader/tree/master/test) for a running example.

## Contributing

Please take a moment to read our contributing guidelines if you haven't yet done so.

[CONTRIBUTING](./.github/CONTRIBUTING.md)

## License

[MIT](./LICENSE)

[npm]: https://img.shields.io/npm/v/sass-loader.svg
[npm-url]: https://npmjs.com/package/sass-loader
[node]: https://img.shields.io/node/v/sass-loader.svg
[node-url]: https://nodejs.org
[deps]: https://david-dm.org/webpack-contrib/sass-loader.svg
[deps-url]: https://david-dm.org/webpack-contrib/sass-loader
[tests]: https://github.com/webpack-contrib/sass-loader/workflows/sass-loader/badge.svg
[tests-url]: https://github.com/webpack-contrib/sass-loader/actions
[cover]: https://codecov.io/gh/webpack-contrib/sass-loader/branch/master/graph/badge.svg
[cover-url]: https://codecov.io/gh/webpack-contrib/sass-loader
[chat]: https://badges.gitter.im/webpack/webpack.svg
[chat-url]: https://gitter.im/webpack/webpack
[size]: https://packagephobia.now.sh/badge?p=sass-loader
[size-url]: https://packagephobia.now.sh/result?p=sass-loader
