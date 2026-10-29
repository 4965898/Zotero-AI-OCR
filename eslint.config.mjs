// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      // Node 脚本（如 fix-prefs.js）运行于 Node 环境，可用 console
      files: ["scripts/**/*.js"],
      languageOptions: {
        globals: {
          console: "readonly",
        },
      },
    },
  ],
});
