# RequireJS Module Support

Looks up modules and identifiers in CJS/AMD/ES projects using RequireJS.

* Go To Definition and Find All References for imported identifiers and string literals with module names.
* Autocomplete module names when typing.
* Show module paths when hovering above module names.
* Rename imported and exported symbols.
* Support module formats CJS, AMD, UMD and ES.
* Support modern JavaScript (ES2021).

This project started by enhancing the extension [Require Module Support], but was rewritten to use parsing and AST traversal instead of regexp string matching, when the original approach started making further improvements difficult. It might behave differently than the original extension, but it should follow the language more correctly.

## Installation

Look for [RequireJS Module Support] in the [Visual Studio Marketplace], [Open VSX Registry], or [install the extension by the command line], if you have the VS Code or VS Codium binary in `PATH`:

    code --install-extension amu.vscode-requirejs
    vscodium --install-extension amu.vscode-requirejs

If you used the extension [Require Module Support], uninstall it or disable it to prevent conflicts.

## Navigation

You can navigate to the source file from locations marked with the caret (^):

    // main
    require('moduleA').foo()
               ^       ^

    // moduleC
    define(['moduleA', 'moduleB'], function(a, b) {
               ^           ^                ^  ^
      var foo = a
           ^    ^
      var bar = new b()
           ^        ^
      foo.baz()
       ^  ^
      bar.prop
       ^    ^
    })

    // moduleC ESM
    import a from 'moduleA'
           ^          ^
    import b from 'moduleB'
           ^          ^
    const foo = a
           ^    ^
    const bar = b
           ^    ^
    foo.baz()
     ^   ^
    bar.prop
     ^   ^

    // moduleA
    define(() => {
      return {
        foo: function() { ... },
        bar: function() { ... },
        baz: function() { ... }
      }
    })

    // moduleB
    export default {
      prop: 6
    }

## Settings

The following properties can be set in `settings.json` to override the default values. The names from the table below have to be prefixed with `requireModuleSupport.`, which is omitted in the table to save space. Paths in property values should be relative to the workspace root. See also the [project examples].

| Name | Type | Default | Description |
| ---- | ---- | ------- | ----------- |
| enableDefinitionProvider | `boolean` | `true` | Enables cross-module symbol lookup in the "Go to Definition" command. |
| enableReferenceProvider | `boolean` | `true` | Enables cross-module symbol lookup in the "Find All References" command. |
| enableCompletionItemProvider | `boolean` | `true` | Enables selecting from the module directory content when typing "/" inside a string with a module path. |
| enableHoverProvider | `boolean` | `true` | Enables displaying the file-system path, which the module path resolves to, when hovering with the mouse cursor above a string with a module path. |
| enableRenameProvider | `boolean` | `true` | Enables cross-module symbol lookup in the "Rename Symbol" command. |
| showGoToDefinitionModuleCommand | `boolean` | `true` | Shows the "Go to Definition Module" command in context menus. |
| showRenameExportedSymbolCommand | `boolean` | `true` | Shows the "Rename Exported Symbol" command in context menus. |
| configFile | `string` | `` | Path of the RequireJS configuration file relative to workspace root |
| enableCjsModules | `boolean` | `false` | Parse source files as pure CommonJS modules |
| enableJsxModules | `boolean` | `false` | Enable support for the JSX language extension |
| enableEsModules | `boolean` | `false` | Enable detection of ES modules in addition to AMD or CJS modules |
| moduleCacheSize | `integer` | `10000` | Maximum count of parsed modules and their dependencies kept in memory as cache to improve performance |
| dynamicModuleCacheSize | `boolean` | `true` | Make cache sizes depend on the count of JavaScript modules in the project |
| dynamicModuleCacheSizeExtra | `integer` | `10` | How many percent of the JavaScript module count should be reserved not to exhaust the cache so quickly |
| includeModulePattern | `string` | `**/*.js` | File globbing pattern to find JavaScript modules in this project |
| excludeModulePattern | `string` | `` | File globbing pattern to exclude when looking for JavaScript modules in this project |
| cutFileCompletionExtensions | `array` | `.js,.jsx,.css,.less,.scss,.hbs,.html` | File extensions to cut, if the file name is offered in module path completion |
| includeFileCompletionExtensions | `array` | `` | Only the specified file extensions will be included for module path completion; all will be included, if empty |
| excludeFileCompletionExtensions | `array` | `` | The specified file extensions will not be included for module path completion |
| modulePath | `string` | `.` | Module path relative to workspace root |
| onlyNavigateToFile | `boolean` | `false` | When set to true, it will prevent the final search for the identifier in the landing module and instead just reference the file. |
| pluginExtensions | `object` | `{}` | Assigns default file extensions to target module paths used with RequireJS plugins |
| moduleProcessingBatchSize | `number` | `30` | How many documents should be opened and searched before cancelling of the operation is possible |

### Disable Functionality

If you want to omit a provider or a command registered by this extension, you can set the corresponding property to `false`: `enableDefinitionProvider`, `enableReferenceProvider`, `enableCompletionItemProvider`, `enableHoverProvider`, `enableRenameProvider`, `showGoToDefinitionModuleCommand`, `showRenameExportedSymbolCommand`.

### Plugins and File Extensions

If you use RequireJS plugins in your projects, which do not require appending file extensions to their target modules, you will need to supply these extensions too. For example:

    "requireModuleSupport.pluginExtensions": {
      "css": ".css"
    }

This will ensure, that a module reference like "css!views/panel" will be handled as "css!views/panel.css" before resolving the actual module path.

If you use module path completion, you can customise what file extensions will be omitted, because the corresponding plugin does not expect an extension. For example:

    "requireModuleSupport.cutFileCompletionExtensions": [
      ".js", ".css"
    ]

### Module Format

If you use pure CommonJS syntax instead of AMD in your sources (not CommonJS wrappers in `define()` statements) and then compile them together with `r.js`, which generates AMD wrappers for you, you have to set the following flag to `true`:

    "requireModuleSupport.enableCjsModules"

CJS modules cannot be mixed with other module formats.

The following flags can be set to `true` to enable the ES module format and the JSX syntax:

    "requireModuleSupport.enableEsModules"
    "requireModuleSupport.enableJsxModules"

### RequireJS Config Files

RequireJS configuration properties like `paths`, `bundles` and `config` are usually maintained in a separate file in a single `require.config()` statement. This file can be evaluated, when the project is loaded on debug pages, when the project is built (for root components) and in other situations - like this editor plugin.

Example:

    // config.js
    require.config({
      paths: {
        ui: 'ui/src',        // The "ui" component is located elsewere.
        css: 'libraries/css' // A shortcut for the full module path.
      }
    })

    // main.js
    require(['ui/views/panel'], function (Panel) {
      const panel = new Panel()
      document.body.appendChild(panel.el)
    })

    // ui/src/views/panel.js
    define(['css!./panel'], function () {
      function Panel () {
        this.el = ...
      }
      return Panel
    })

    // ui/src/views/panel.css
    .panel {
      ...
    }

If you specify a `requireModuleSupport.configFile`, which does not contain `baseUrl`, the value of `requireModuleSupport.modulePath` will be used as `baseUrl`.

### Performance

The original extension used regexp string matching, which limited the correctness of language construct recognition. This extension traverses a ESTree AST, which has to be parsed from the source files, which slows down the operation.

Once parsed files are cached to avoid repetitive parsing of the same file. You can increase the default cache size for large projects:

    "requireModuleSupport.enableEsModules": 50000

While Go To Definition parses only the target module source, Find All References does the same for all files in the project. The static cache size may be increased to satisfy this operation and set to a little more percent to avoid fast exhaustion:

    "requireModuleSupport.dynamicModuleCacheSize": true
    "requireModuleSupport.dynamicModuleCacheSizeExtra": 5

Find All References can be further optimised by specifying what files should be included and what files should be further excluded from the inclusion pattern:

    "requireModuleSupport.includeModulePattern": "src/**/*.js"
    "requireModuleSupport.excludeModulePattern": "src/vendor/**/*.js"

Find All References can process a limited batch of files in parallel to prevent CPU exhaustion by analysing thousands of files in parallel:

    "requireModuleSupport.excludeModulePattern": 50

You can also limit files, which are suggested by the moule path autocompletion by listing either included or excluded file extensions:

    "requireModuleSupport.includeFileCompletionExtensions": [".js", ".css"]
    "requireModuleSupport.excludeFileCompletionExtensions": [".txt"]

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding
style. Run `npm test` to validate your changes. Use the examples
in the `pkg/examples` directory to check the effect of your changes.

## License

Copyright (c) 2020-2022 Ferdinand Prantl<br>
Copyright (c) 2020      Ali Naci Erdem

Licensed under the [MIT license].

[RequireJS Module Support]: https://marketplace.visualstudio.com/items?itemName=amu.vscode-requirejs
[Visual Studio Marketplace]: https://marketplace.visualstudio.com/items?itemName=amu.vscode-requirejs
[Open VSX Registry]: https://open-vsx.org/extension/carvinlo/vscode-requirejs
[Require Module Support]: https://marketplace.visualstudio.com/items?itemName=lici.require-js
[project examples]: ./examples/#readme
[install the extension by the command line]: https://code.visualstudio.com/docs/editor/command-line
[MIT license]: ./LICENSE
