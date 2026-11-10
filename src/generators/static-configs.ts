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

// Without this, a Windows checkout with core.autocrlf=true holds CRLF files
// that Prettier reports as unformatted, so format:check fails on a tree
// nobody edited. Prettier compares against LF.
export const GITATTRIBUTES = `* text=auto eol=lf
*.sh text eol=lf
`;

export const COMMITLINT_CONFIG = `export default {
  extends: ['@commitlint/config-conventional'],
};
`;
