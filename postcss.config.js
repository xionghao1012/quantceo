export default {
  plugins: {
    autoprefixer: {
      overrideBrowserslist: ['last 10 versions', '> 1%', 'ie >= 11', 'Android >= 4.4', 'iOS >= 9'],
      cascade: false,
    },
  },
}
