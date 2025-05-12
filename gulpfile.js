const gulp = require('gulp')
const del = require('del')
const sourcemaps = require('gulp-sourcemaps')
const { ensureMappings } = require('gulp-sourcemaps-identity')
const nls = require('@prantlf/vscode-nls-dev')

const languages = [
	{ id: 'cs', folderName: 'csy' }
]

const transifexApiHostname = 'www.transifex.com'
const transifexApiName = 'api'
const transifexApiToken = process.env.TRANSIFEX_API_TOKEN
const transifexProjectName = 'vscode-requirejs'
const transifexExtensionName = 'vscode-requirejs'
const vscodeExtensionId = 'amu.vscode-requirejs'

const cleanTask = () => del(['out/**', 'package.nls.*.json'])

const sourceTask = () =>
	gulp.src('src/**/*.js')
		.pipe(sourcemaps.init())
		.pipe(ensureMappings())
		.pipe(nls.createMetaDataFiles())
		.pipe(nls.rewriteLocalizeCalls())
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n', 'out'))
		.pipe(nls.bundleMetaDataFiles(vscodeExtensionId, 'out'))
		.pipe(nls.bundleLanguageFiles())
		.pipe(sourcemaps.write('../out', {
			includeContent: false,
			sourceRoot: '../src'
		}))
		.pipe(gulp.dest('out'))

const packageTask = () =>
	gulp.src('package.nls.json')
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
		.pipe(gulp.dest('.'))

gulp.task('clean', cleanTask)

gulp.task('default', gulp.series(cleanTask, sourceTask, packageTask))

gulp.task('xlf-export', () =>
	gulp.src(['package.nls.json', 'out/nls.metadata.json', 'out/nls.metadata.header.json'])
		.pipe(nls.createXlfFiles(transifexProjectName, transifexExtensionName))
		.pipe(gulp.dest('xlf')))

gulp.task('xlf-export-lang', () =>
	Promise.all(languages.map(language =>
		gulp.src(['package.nls.json', `package.nls.${language.id}.json`,
				'out/nls.metadata.json', `out/nls.bundle.${language.id}.json`, 'out/nls.metadata.header.json'])
			.pipe(nls.createXlfFiles(transifexProjectName, transifexExtensionName, language))
			.pipe(gulp.dest('xlf')))))

gulp.task('xlf-push', () =>
	gulp.src(`xlf/${transifexProjectName}/${transifexExtensionName}.xlf`)
		.pipe(nls.pushXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken)))

gulp.task('xlf-push-lang', () =>
	gulp.src(`xlf/${transifexProjectName}/${transifexExtensionName}.*.xlf`)
		.pipe(nls.pushXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken, languages)))

gulp.task('xlf-pull-lang', () =>
		nls.pullXlfFiles(transifexApiHostname, transifexApiName, transifexApiToken,
			languages, [{ name: transifexExtensionName, project: transifexProjectName }])
		.pipe(gulp.dest('xlf')))

gulp.task('xlf-import', () =>
	gulp.src(`xlf/${transifexProjectName}/${transifexExtensionName}.xlf`)
		.pipe(nls.prepareJsonFiles())
		.pipe(gulp.dest('i18n')))

gulp.task('xlf-import-lang', () =>
	gulp.src(`xlf/${transifexProjectName}/${transifexExtensionName}.*.xlf`)
		.pipe(nls.prepareJsonFiles(languages))
		.pipe(gulp.dest('i18n')))
