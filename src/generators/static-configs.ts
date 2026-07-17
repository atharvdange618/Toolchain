export const EDITORCONFIG = `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
`;

export const PRETTIERRC = `{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100
}
`;

export const PRETTIERIGNORE = `node_modules
dist
.next
build
.pnpm-store
*.env
*.log
pnpm-lock.yaml
coverage
`;

// commitlint expects CommonJS - do not convert to ESM
export const COMMITLINT_CONFIG = `module.exports = {
  extends: ['@commitlint/config-conventional'],
};
`;
