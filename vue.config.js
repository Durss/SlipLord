const fs = require('fs');
module.exports = {
	// publicPath:"/dtc/ambients/",//Just used to push on https://durss.ninja/dtc/ambients

	chainWebpack: (config) => {
		//Avoids auto preload of lazylaoded routes
		config.plugins.delete("prefetch");
		
		//Disabling that shitty minifier on index or many <meta> tags would miss
		//double quotes on attributes which would break the whatsapp share preview.
		config.plugin('html')
		.tap(args => {
			if(args[0]) {
				args[0].minify = false
			}
			return args
		})
	},

	configureWebpack: {
		resolve: {
			alias: {
				'@': __dirname + '/src_front'
			}
		},
		entry: {
			app: './src_front/main.ts'
		},
		optimization: {
			minimize: false,//Avoids minifying the index which would break share meta for whtasapp
			splitChunks: {
				// minSize: 10000,
				// maxSize: 250000,
				cacheGroups: {
					commons: {
						test: /[\\/]node_modules[\\/]/,
						name: 'vendors',
						chunks: 'all'
					}
				}
			}
		}
	},

	css: {
		loaderOptions: {
			less: {
				additionalData: `@import (reference) "@/less/index.less";@import (reference) "@/less/_includes.less";`
			}
		}
	}
}