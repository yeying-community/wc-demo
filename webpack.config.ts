const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    dapp: './src/dapp/index.ts',
    wapp: './src/wallet/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-bundle.js',
    library: {
      name: '[name]',
      type: 'umd',
      export: 'default'
    },
    globalObject: 'this',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "assert": require.resolve("assert"),
      "buffer": require.resolve("buffer"),
      "console": require.resolve("console-browserify"),
      "constants": require.resolve("constants-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "domain": require.resolve("domain-browser"),
      "events": require.resolve("events"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "path": require.resolve("path-browserify"),
      "punycode": require.resolve("punycode"),
      "process": require.resolve("process/browser"),
      "querystring": require.resolve("querystring-es3"),
      "stream": require.resolve("stream-browserify"),
      "string_decoder": require.resolve("string_decoder"),
      "sys": require.resolve("util"),
      "timers": require.resolve("timers-browserify"),
      "tty": require.resolve("tty-browserify"),
      "url": require.resolve("url"),
      "util": require.resolve("util"),
      "vm": require.resolve("vm-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "fs": false,
      "net": false,
      "tls": false
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.DefinePlugin({
      'process.env': JSON.stringify(process.env),
      'global': 'globalThis',
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html',
      chunks: []
    }),
    new HtmlWebpackPlugin({
      template: './public/dapp.html',
      filename: 'dapp.html',
      chunks: ['dapp']
    }),
    new HtmlWebpackPlugin({
      template: './public/wallet.html',
      filename: 'wallet.html',
      chunks: ['wallet']
    })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 3001,
    open: true
  },
  mode: 'development'
};
