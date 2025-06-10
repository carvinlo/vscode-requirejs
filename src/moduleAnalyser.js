const { workspace, window, Uri } = require('vscode')
const nls = require('vscode-nls')
const { findDependencies, findCjsDependencies }
= require('@prantlf/amodro-trace/parse')
const { detectDefinesOrRequires, detectImportsAndExports }
  = require('requirejs-esm/dist/api')
const { parseModule, findIdentifierOrLiteralWithinRange }
  = require('./codeParser')
const { findModuleExport, findBodyReturn, findOriginatingModuleDependency }
  = require('./codeAnalyser')
const ModuleResolver = require('./moduleResolver')
const CacheByDocumentOrFile = require('./cacheByDocumentOrFile')
const { hostOrCreateDisposable, disposeAll } = require('./disposableHost')
const { configureLocalization, choosePlural } = require('./nlsHelpers')
const glob = require('glob')
const { join, posix } = require('path')

configureLocalization(nls)
const localize = nls.loadMessageBundle()

/**
 * Analyses JavaScript files to find out, if they are RequireJS modules
 * and to extract their module dependencies and exports. This relates
 * to an analysis of an identifier - which module it came from. Analyses
 * and parsed JavaScript AST trees are cached, as long as source
 * documents do not change.
 */
class ModuleAnalyser {
  /**
   * Initializes a new instance.
   * @param {ModuleResolver} moduleResolver Module to file path resolution helper.
   */
  constructor (moduleResolver) {
    hostOrCreateDisposable(this, 'moduleResolver', ModuleResolver, moduleResolver)
    hostOrCreateDisposable(this, 'parsedCache', CacheByDocumentOrFile)
    hostOrCreateDisposable(this, 'analysedCache', CacheByDocumentOrFile)
    this.errors = []
  }

  /**
   * Adapt cache sizes, so that they can handle at least the specified
   * module count.
   * @param {number} moduleCount The expected module count to handle
   * @returns {Void} Nothing.
   */
  adaptCacheSizes (moduleCount) {
    this.parsedCache.adaptCacheSize(moduleCount)
    this.analysedCache.adaptCacheSize(moduleCount)
  }

  /**
   * Starts collecting parsing errors durng a multi-file operation by clearing
   * the remembered error list.
   */
  startCollectingErrors() {
    this.errors = []
  }

  /**
   * Report the parsing errors if there are any and clear the error list.
   */
  reportErrors() {
    const { errors } = this
    if (errors.length) {
      window.showWarningMessage(choosePlural(errors.length, localize('analysingFailed',
          'Analysing {0} file failed.|||Analysing {0} files failed.', errors.length)))
      console.warn('File analysis failed:', errors.map(({ path }) => workspace.asRelativePath(path, false)))
    }
    this.errors = []
  }

  /**
   * Returns AST of the specified document to be used in other functions
   * @param {TextDocument} document Original document
   * @returns {Object} JavaScript AST
   */
  getParsedModule (document /*, documentPath*/) {
    let astRoot = this.parsedCache.getCachedObject(document)

    if (!astRoot) {
      const supportJsx = !!process.env.VSCODE_REQUIREJS_SUPPORT_JSX || workspace
        .getConfiguration('requireModuleSupport')
        .get('enableJsxModules')
      const supportEsm = !!process.env.VSCODE_REQUIREJS_SUPPORT_ESM || workspace
        .getConfiguration('requireModuleSupport')
        .get('enableEsModules')
      try {
        // Support getting content from both documents and files.
        // const message = `Parsing "${workspace.asRelativePath(documentPath || document.fileName, false)}"`
        // console.time(message)
        astRoot = parseModule(document.getText && document.getText()
          || document.content || '', { loc: true, jsx: supportJsx, module: supportEsm })
        // console.timeEnd(message)
      } catch (error) {
        console.warn('Parsing "'
          + (document.fileName || document.path)
          + '" failed:', error)
        astRoot = {
          type: 'Program',
          sourceType: supportEsm ? 'module' : 'script',
          body: []
        }
        this.errors.push({ error, path: document.fileName || document.path })
      }
      this.parsedCache.setCachedObject(document, astRoot)
    }

    return astRoot
  }

  /**
   * Returns named and unnamed imports and exports of the specified document.
   *
   * @param {TextDocument} document The document with the module source.
   * @param {Object} astRoot The parsed module source.
   * @returns {Object} Object `{namedDependencies, unnamedDependencies, exports}`/
   * `namedDependencies` is a map `{name: path}` pointing formal parameters
   * to module paths, were their value came from. `unnamedDependencies` is
   * an array or module paths. `exports` is an object with the key `default`
   * pointing to the name of the local variable, which is exported.
   */
  getAnalysedModule (document, astRoot) {
    let analysis = this.analysedCache.getCachedObject(document)

    if (!analysis) {
      let namedDependencies, unnamedDependencies, moduleExports

      // Pure CommonJS syntax needs a different lookup method.
      const enableCjsModules = workspace
        .getConfiguration('requireModuleSupport')
        .get('enableCjsModules')
      if (enableCjsModules) {
        const { params, modules } = findCjsDependencies(astRoot)
        // Create a map {formal parameter -> module path} from
        // the two arrays with keys and vales.
        namedDependencies = params.reduce((result, param, index) => {
          result[param] = { source: modules[index] }
          return result
        }, {})
        unnamedDependencies = modules.slice(params.length)
        moduleExports = { default: findModuleExport(astRoot) }
      } else {
        const amds = detectDefinesOrRequires(astRoot)
        if (amds.length) {
          const { deps, params = [], factory, body } = amds[0]
          const { body: block = {} } = factory || body || {}
          if (deps) {
            const depNodes = (deps.elements || []).map((item) => {
              if(item.type === 'CallExpression' && item.callee.object.name === 'ELMP'){
                return {
                  type: 'Literal',
                  value: item.arguments[0].value,
                  loc: item.loc,
                }
              }
              if(item.type === 'BinaryExpression' && item.right.callee.object.name === 'ELMP'){
                return {
                  type: 'Literal',
                  value: item.right.arguments[0].value,
                  loc: item.loc,
                }
              }
              return item;
            })
            namedDependencies = params.reduce((result, param, index) => {
              if (param.type === 'Identifier') {
                const dep = depNodes[index]
                if (dep && dep.type === 'Literal') {
                  result[param.name] = { source: dep.value }
                }
              } else if (param.type === 'ObjectPattern') {
                const dep = depNodes[index]
                if (dep && dep.type === 'Literal') {
                  const source = dep.value
                  for (const { key, value } of param.properties) {
                    if (key.type === 'Identifier') {
                      const { type } = value
                      if (type === 'Identifier') {
                        // Support parameter "{ local }"
                        result[value.name] = { property: key.name, source }
                      } else if (type === 'AssignmentPattern') {
                        // Support parameter "{ local = ... }"
                        if (value.left && value.left.type === 'Identifier') {
                          result[value.left.name] = { property: key.name, local: rightValue }
                        }
                      }
                    }
                  }
                }
              }
              return result
            }, {})
            unnamedDependencies = depNodes
              .slice(params.length)
              .reduce((result, dep) => {
                if (dep.type === 'Literal') {
                  result.push(dep.value)
                }
                return result
              }, [])
          } else {
            namedDependencies = {}
            unnamedDependencies = []
          }
          moduleExports = { default: findBodyReturn(block) }
        } else {
          const { imports, exports } = detectImportsAndExports(astRoot)
          if (imports.length || exports.length) {
            namedDependencies = {}
            unnamedDependencies = []
            for (const { source, local, specifiers } of imports) {
              if (source.type === 'Literal') {
                if (local) {
                  if (local.type === 'Identifier') {
                    namedDependencies[local.name] = { source: source.value }
                  }
                } else if (specifiers) {
                  const { value } = source
                  for (const { imported, local } of specifiers) {
                    namedDependencies[local.name] = { property: imported.name, source: value }
                  }
                } else {
                  unnamedDependencies.push(source.value)
                }
              }
            }
            moduleExports = {}
            for (const { node, default: alone } of exports) {
              if (alone) {
                const { declaration } = node
                if (declaration.type === 'Identifier') {
                  moduleExports.default = declaration.name
                }
              }
            }
          } else {
            const { params, modules } = findDependencies(astRoot)
            namedDependencies = params.reduce((result, param, index) => {
              result[param] = { source: modules[index] }
              return result
            }, {})
            unnamedDependencies = modules.slice(params.length)
            moduleExports = { default: findModuleExport(astRoot) }
          }
        }
      }

      analysis = { namedDependencies, unnamedDependencies, exports: moduleExports }
      this.analysedCache.setCachedObject(document, analysis)
    }

    return analysis
  }

  /**
   * Returns module path of RequireJS dependencies of the specified
   * document, with the formal parameter names that expose their
   * exports.
   * @param {TextDocument} document The document with the module source.
   * @param {Object} astRoot The parsed module source.
   * @returns {Object} Map `{name: path}` pointing formal parameter
   * to module paths, were their value came from.
   */
  getModuleDependencies (document, astRoot) {
    return this.getAnalysedModule(document, astRoot).namedDependencies
  }

  /**
   * Returns the name of the exported object identifier. It works well,
   * only if module set their exports to a variable first and return
   * the export by that variable. Modules, which depend on it usually
   * use the same name for formal parameters carrying the same object.
   * @param {TextDocument} document The document with the module source.
   * @param {Object} astRoot The parsed module source.
   * @returns {string} The name of the exported object identifier.
   */
  getModuleExport (document, astRoot) {
    return this.getAnalysedModule(document, astRoot).exports.default
  }

  /**
   * Returns information about the originating module of the currently
   * selected identifier, if it can be tracked to a module, which the
   * current module depends on, or it it can be tracked to the export
   * returned from the current module (the current module is the
   * originating module).
   * @param {TextDocument} document The document with the module source.
   * @param {Position} position The position of the identifier to
   * investigate.
   * @returns {Object} Object describing the identifier origin:
   * - {String} selected The actually selected identifier at the
   *   specified position in the document.
   * - {String} imported Object identifier, which points to the tracked
   *   dependency export. It will be different, than the selected
   *   identifier, if the latter is a member property or method.
   * - {String} modulePath Is set, if the identifier was tracked to
   *   other module's export.
   * - {Array} referencePaths Is set, if the identifier is exported from
   *   the current module and contains possible module paths, which the
   *   current module can be referenced by.
   * - {String} filePath Is set, if the identifier was tracked to
   *   an originating module.
   * If the identifier cannot be tracked to any module dependency,
   * either exported or imported, neither `modulePath` nor
   * `referencePaths` will be set.
   */
  getOriginatingModuleDependency (document, position) {
    const range = document.getWordRangeAtPosition(position)
    let moduleDependency

    if (range) {
      const astRoot = this.getParsedModule(document)
      const identifier = findIdentifierOrLiteralWithinRange(astRoot, range)

      if (identifier) {
        const dependencies = this.getModuleDependencies(document, astRoot)
        const currentFilePath = document.fileName

        // Try matching a module path in the selected literal.
        if (identifier.type === 'Literal') {
          const modulePath = identifier.value

          if (modulePath && typeof modulePath === 'string') {
            const erdcPath = getFilePath(modulePath, currentFilePath)
            const filePath = erdcPath || this.moduleResolver.resolveModulePath(modulePath, currentFilePath)
            return workspace.fs
              .stat(Uri.file(filePath))
              .then(() => ({ filePath }))
              .catch(() => {
                window.showWarningMessage(localize('fileDoesNotExist',
                  '"{0}" does not exist.', workspace.asRelativePath(filePath, false)))
              })
          }

          window.showErrorMessage(localize('noStringWithModulePath',
            'No string resembling a module path was selected.'))
          return
        }

        moduleDependency = findOriginatingModuleDependency(astRoot, identifier, dependencies)
        const modulePath = moduleDependency.modulePath

        if (modulePath) {
          const erdcPath = getFilePath(modulePath, currentFilePath)
          // If the identifier was tracked to o single module dependency,
          // resolve its module path to the file path.
          moduleDependency.filePath = erdcPath || this.moduleResolver.resolveModulePath(modulePath, currentFilePath)
        } else {
          // If the identifier was not tracked to o single module dependency,
          // expect, that it current file is its originating module.
          const moduleExport = this.getModuleExport(document, astRoot)

          if (moduleExport === moduleDependency.imported) {
            const referencePaths = this.moduleResolver.unresolveFilePath(currentFilePath)

            if (referencePaths) {
              moduleDependency.referencePaths = referencePaths
              moduleDependency.filePath = currentFilePath
            }
          }
        }
      }
    }

    return moduleDependency
  }

  /**
   * Disposes of disposable child objects.
   * @returns {void} Nothing.
   */
  dispose () {
    disposeAll(this)
  }
}

function getFilePath(modulePath) {
  // erdcloud-plat-frontend/erdc-libs/erdc-app/index.js
  const moduleMaps = {
      'erdc-auth': '/erdc-libs/erdc-auth/auth-login.js',
      'erdc-kit': '/erdc-libs/erdc-app/kit.js',
      'erdc-idle': '/erdc-libs/erdc-app/erdc-idle.js',
      'erdc-socket': '/erdc-libs/erdc-app/erdc-socket.js',
      'el-socket': '/erdc-libs/erdc-app/plugins/el-socket.js'
  };
  if(moduleMaps[modulePath]) modulePath = moduleMaps[modulePath];
  // 处理 css! 前缀
  if(modulePath.includes('!')) modulePath = modulePath.substr(modulePath.indexOf('!') + 1)
  let rootPath = workspace.workspaceFolders[0].uri.fsPath
  if(rootPath.includes('erdcloud-')){
    rootPath = join(rootPath, '..')
  }
  const projectContexts = ['*']
  const moduleContexts = ['erdc-app/*/apps/resource', 'erdc-app/*/apps/widget', 'erdc-libs', 'erdc-resource', ''] // ‘’ 以支持匹配 erdcloud-plat-frontend/erdc-layout erdcloud-plat-frontend/erdc-theme
  const frameworkContext = 'erdcloud-plat-frontend/erdc-libs/framework'
  const rjsConfigPath = 'rjs.config.js'

  const filePaths = projectContexts.reduce((paths, projectRoot) => {
    moduleContexts.forEach((folderRoot) => {
      paths.push(join(rootPath, projectRoot, folderRoot, modulePath))
    })
    return paths;
  }, []).map((filePath) => {
    const paths = glob.sync(filePath.replace(/\\/g, posix.sep))
    let path = paths.length ? paths[0] : ''
    return path;
  }).filter(path => path)
  if(!filePaths[0]){
    const moduleMaps = {
      TreeUtil: '../erdc-kit/packages/tree-util/index',
      EventBus: '../erdc-kit/packages/event-bus/index',
      'erdcloud.kit': '../erdc-kit/src/index'
    }
    const frameworkRoot = join(rootPath, frameworkContext)
    const rjsConfigFile = join(frameworkRoot, rjsConfigPath)
    const rjsConfig = require(rjsConfigFile)('')
    rjsConfig.paths = {
      ...rjsConfig.paths,
      ...moduleMaps,
    }
    if(rjsConfig.paths[modulePath]){
      return join(frameworkRoot, rjsConfig.paths[modulePath]) + '.js'
    }
  }
  return filePaths[0];
}

module.exports = ModuleAnalyser
