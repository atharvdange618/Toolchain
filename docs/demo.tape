# Records `init` in a fresh Next.js app. Run from the repo root:
#   vhs docs/demo.tape
# Needs vhs, ttyd, ffmpeg, Git for Windows and network access. Takes a few
# minutes, most of it in the hidden setup.
#
# Windows only as written: ttyd resolves a bare `bash` through System32 first,
# which is WSL's launcher, so the tape starts in cmd and launches Git Bash by
# full path. On macOS or Linux, set Shell to "bash" and drop that line.

Output docs/demo.gif

Require npx
Require git

Set Shell "cmd"
Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set WaitTimeout 600s
# The prompt is "> " and the default pattern />$/ misses the trailing space.
Set WaitPattern />\s*$/

# Setup, not recorded: a fresh create-next-app project, plus a throwaway copy
# that runs init once so the recorded install comes from a warm npm cache.
Hide
Type `"C:\Program Files\Git\bin\bash.exe" --noprofile --norc`
Enter
Sleep 3s
# The recorded install reuses the warm cache and skips npm's audit and fund
# requests, which cuts most of the idle spinner from the GIF.
Type "export npm_config_prefer_offline=true npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false" Enter
Sleep 1s
Type "export PS1='> ' && rm -rf /tmp/toolchain-demo && mkdir -p /tmp/toolchain-demo && cd /tmp/toolchain-demo" Enter
Wait
Type "npx --yes create-next-app@latest my-app --yes --use-npm --disable-git >/dev/null 2>&1" Enter
Wait
Type "cd my-app && git init -q && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm init && cd .." Enter
Wait
Type "cp -r my-app warm && (cd warm && npx --yes @atharvdange/toolchain init --yes >/dev/null 2>&1); rm -rf warm" Enter
Wait
Type "cd my-app && clear" Enter
Wait
Show

Type "npx @atharvdange/toolchain init --yes"
Sleep 600ms
Enter
Wait
Sleep 2s

Type "git status --short"
Sleep 400ms
Enter
Wait
Sleep 2s

# oxlint prints nothing on a clean run; the echo only runs when lint exits 0.
Type 'npm run lint && echo "lint passed"'
Sleep 400ms
Enter
Wait
Sleep 3s
